# Phase 03: Batch content ingestion pipeline (PDF → test bank)

## Context Recap
IELTS Daily (see `docs/plan.md`) is a single-user IELTS self-study app. Phase 02
delivered the timed test player, server-side grading, id-stable test upserts in
`scripts/seed.ts`, and migration `0002`. Read `memory/phase_02_report.md` —
especially "Input for next phase" — and the [Phase 02] discoveries. This phase
builds the content pipeline: the user drops real IELTS PDFs (scanned or text)
into `content/raw/`, a CLI extracts them via a vision-capable LLM into staged
JSON for human review, and a second CLI commits reviewed files into a **test
bank** (`tests` rows with a `slug`, not attached to any unit). Roadmap units
gain the ability to reference bank tests by slug. A minimal `/bank` area lets
the user browse and practice any bank test outside the roadmap — which is also
how this phase's output is verified end-to-end.

**Prerequisite gate:** this phase needs (a) at least one real reading-test PDF
in `content/raw/`, (b) `AI_API_KEY` in `.env.local`, and (c) `pdftoppm`
(poppler) installed. If any is missing, STOP and ask the user — do not fabricate
test content to proceed.

## Goal
`content/raw/*.pdf` → one command → validated staged JSON + human-readable
review summary → user confirms → one command → tests live in the bank, playable
at `/bank/[slug]`, with AI-extracted answer keys never reaching the database
without passing the shared validator and the user's review.

## Non-goals
- No writing-task or speaking material extraction — objective reading/listening
  tests only. Skip such pages; note them in the review file.
- No automatic unit/roadmap generation — units stay architect-authored; this
  phase only adds the `test_ref` mechanism to the seed schema.
- No vocabulary extraction from passages (Phase 4 territory).
- No web UI for ingestion — CLI only. `/bank` is a read/practice surface, not an
  admin surface.
- No OCR engines (tesseract etc.) — the vision model IS the extractor.
- Never auto-insert staged output into the database; the commit step is always a
  separate, human-initiated command (CLAUDE.md invariant).
- Do not modify the Phase 02 grading path or the roadmap contract.

## Interface Contract

### Config change (replaces the Anthropic placeholder — see CLAUDE.md)
In `src/lib/config.ts`, replace `anthropicApiKey` with:
```ts
ai: {
  baseUrl: process.env.AI_BASE_URL ?? "https://api.groq.com/openai/v1",
  apiKey: process.env.AI_API_KEY ?? "",
  model: process.env.AI_MODEL ?? "qwen/qwen3.6-27b",  // current Groq vision model
},
```
Update `.env.example` (remove `ANTHROPIC_API_KEY`; add the three `AI_*` vars with
a comment noting the endpoint is OpenAI-compatible — Groq is the default/known-
good provider; other OpenAI-compatible gateways work by changing `AI_BASE_URL`).

### Migration `supabase/migrations/0003_test_slug.sql` (verbatim)
```sql
alter table tests add column slug text unique;
```
Apply via the repaired MCP connection if available, otherwise hand the SQL to the
user for the SQL editor (never paste tokens into chat). Record the method used.

### `src/lib/ai.ts` (server/CLI-only)
```ts
/** One OpenAI-compatible chat call. images = PNG buffers sent as image_url
 *  data-URLs. Throws on non-200 after 3 retries with backoff. */
export async function visionChat(
  prompt: string, images: Buffer[]
): Promise<string>;
export async function textChat(prompt: string): Promise<string>;
/** Strips ```json fences and parses; throws with the raw string on failure. */
export function parseModelJson<T>(raw: string): T;
```
Reads credentials ONLY via `config.ts`. Keep it dependency-free (plain `fetch`).

### Shared validator `scripts/lib/validate.ts`
Extract Phase 02's seed validation into this module so `seed.ts`,
`ingest_commit.ts` (and future scripts) share ONE validator. Add two rules,
now hard rules for all content:
1. For choice qtypes (`mcq`/`tfng`/`ynng`/`matching`): every `answer_key` entry
   must equal one of `options` under the Phase 02 normalization rule (this
   institutionalizes Phase 02's finding §4).
2. `answer_key` must be non-empty at commit/seed time (staged files may carry
   empty keys + a warning; committing them is refused).

### Staged file format — `content/staged/<basename>.json`
```json
{
  "source": "cam18-test1-reading.pdf",
  "extracted_at": "2026-08-17T...",
  "tests": [{
    "slug": "cam18-test1-reading-p1",
    "skill": "reading",
    "title": "...",
    "duration_minutes": 20,
    "audio_file": null,
    "content": { "passage_md": "...", "transcript_md": null },
    "questions": [{ "qnum": 1, "qtype": "tfng", "prompt": "...",
                    "options": ["TRUE","FALSE","NOT GIVEN"],
                    "answer_key": ["true"], "explanation_md": "..." }]
  }],
  "warnings": ["..."]
}
```
Slug convention: `<pdf-basename>-p<N>` per reading passage, `-s<N>` per
listening section. Duration defaults: reading passage 20, listening section 10
(validator accepts 5–70). Alongside each staged JSON, write
`content/staged/<basename>.review.md`: per test — slug, question count by qtype,
the full answer-key list in one table, plus all warnings. This is what the user
actually reads before committing.

### `scripts/ingest.ts` — extraction (never touches the DB)
`npx tsx scripts/ingest.ts [file.pdf ...]` (no args = every PDF in
`content/raw/` lacking a staged file; `--force` re-extracts).
1. Preflight: `pdftoppm` present (clear install hint if not: `brew install
   poppler` / `apt install poppler-utils`), `AI_API_KEY` set.
2. `pdftoppm -png -r 150` into a temp dir.
3. Vision pass over page chunks (**≤5 pages/call — this matches the current
   Groq vision model's 5-image-per-request limit**; if the configured provider
   allows more, 5 is still the safe default) using the extraction prompt in the
   Appendix; then one text pass to merge chunks into the staged schema.
4. Log every raw model response to `content/staged/logs/<basename>/` for
   debugging; validate softly (hard-rule failures become warnings at this stage);
   write the staged JSON + review.md.
Audio pairing: `<basename>-s<N>.mp3` in `content/raw/` maps to that section;
else `<basename>.mp3` maps to every section from that PDF; else `audio_file:
null` + warning for listening tests.

### `scripts/ingest_commit.ts` — the only path into the DB
`npx tsx scripts/ingest_commit.ts content/staged/<basename>.json`
1. Run the shared validator with hard rules — abort on any violation, naming
   the field path.
2. Upsert each test by `slug` (id-stable, same discipline as Phase 02: existing
   slug → UPDATE the row in place + delete/reinsert its questions; never delete
   a `tests` row).
3. If `audio_file` is set: upload to R2 (`@aws-sdk/client-s3`, path
   `audio/<slug>.mp3`) and store `audio_url = "r2:audio/<slug>.mp3"`. Skip with
   a clear message if R2 env vars are absent.
4. Print a summary table (slug, inserted/updated, question count). Running it
   twice must be a no-op apart from timestamps.

### Audio serving (presigned, keeps copyrighted audio private)
In `src/lib/tests.ts#getTestForUnit` (and the bank read below): when
`audio_url` starts with `r2:`, replace it with a presigned GET URL (1 h expiry)
generated server-side; plain `https://` values pass through unchanged. R2 stays
a private bucket.

### Unit seed extension — `test_ref`
`scripts/seed.ts`: a unit may now carry `"test_ref": "<slug>"` INSTEAD of an
embedded `"test"` object (both present = validation error). `test_ref` resolves
the bank test's id into `units.test_id`; unknown slug aborts the run. Embedded
`"test"` blocks (weeks 1–2) keep working unchanged.

### `/bank` routes (auth-protected like everything else)
- `/bank`: table of all tests that have a slug — title, skill, question count,
  and per-test best score if any attempt exists. Roadmap-embedded tests (null
  slug) are excluded.
- `/bank/[slug]`: the Phase 02 practice player (intro → timed practice → graded
  review) reusing the existing components, with two differences: attempts are
  written with `unit_id = null`, and completion does NOT touch the roadmap
  pointer or `study_log` (`completeUnit` is never called here). Add a small
  "Practice library" link in the app header.

## Steps
1. Config change + `.env.example`; migration `0003`.
2. `src/lib/ai.ts`; extract the shared validator to `scripts/lib/validate.ts`
   and refit `seed.ts` onto it (behavior identical; re-run the Phase 02 seed
   DoD counts to prove it).
3. `scripts/ingest.ts` with the Appendix prompt; run it on the user's PDF(s).
4. Review pause: show the user the review.md(s); proceed on their confirmation.
5. `scripts/ingest_commit.ts`; commit the confirmed staged file(s).
6. Presigned-audio handling in `tests.ts`; `test_ref` support in `seed.ts`.
7. `/bank` and `/bank/[slug]`; verify end-to-end; write the report.

## Definition of Done
- Shared validator refit: re-running both week seeds twice still yields
  `units=12, tests(embedded)=1, questions=13, vocab_words=16` + unchanged ids.
- `scripts/ingest.ts` on ≥1 real reading PDF produces staged JSON + review.md;
  the staged file passes the hard validator; the choice-key⊆options check
  reports 0 mismatches.
- Re-running `ingest.ts` without `--force` skips already-staged files; DB row
  counts are untouched by any `ingest.ts` run (checked before/after).
- `ingest_commit.ts` run twice on the same staged file → `tests` count stable,
  the slug's test id identical both times, questions reinserted to the same
  count.
- `/bank` lists the ingested test(s); a full practice run at `/bank/[slug]`
  grades correctly and writes an `attempts` row with `unit_id IS NULL`; the
  roadmap pointer and `study_log` are byte-identical before/after that run.
- A throwaway seed file with `"test_ref": "<ingested slug>"` on a high-seq unit
  resolves `units.test_id` to the bank test's id (then remove the unit; note the
  check in the report).
- If a listening test with audio was ingested: the served `audioUrl` is a
  presigned URL (contains a signature param), the raw `r2:` key never reaches
  the client, and the file plays. If no listening content exists, state so in
  the report — do not fabricate audio.
- `.gitignore` covers `content/raw/` and `content/staged/`
  (`git check-ignore` both).
- `npx tsc --noEmit`, `npm run build`, `npm run lint` clean; `process.env` only
  in `src/lib/config.ts`; `grep -rn "AI_API_KEY" src/ scripts/` shows no reads
  outside `config.ts`.

## Handoff Obligations
1. Write `memory/phase_03_report.md` — and include the full list of committed
   slugs with their skill + question counts (the architect needs it to author
   the week 3–4 roadmap batch and the diagnostic).
2. Overwrite `memory/STATE.md` (replace, don't append).
3. Log Moderate/Major findings in `memory/discoveries.md`; STOP on Major.

## Appendix — extraction prompt (base text, architect-authored)
Use this as the vision-pass prompt (chunked), adapting only the mechanical parts
(page ranges, continuation context). Do not weaken the fidelity rules.

```
You are transcribing pages from a real IELTS test book into structured data.
Fidelity rules, in priority order:
1. TRANSCRIBE, never paraphrase. Passage text, question prompts and options must
   be copied exactly as printed (rejoin words hyphenated across line breaks;
   keep paragraph breaks; keep paragraph labels like A/B/C).
2. Answer keys come ONLY from a printed answer section. Do not assume it is at
   the end of the document — some sources print the answer key immediately
   after each set of questions (per-passage or per-section), not only in one
   combined section at the back. Search the pages you were given for whichever
   layout applies. If truly not visible in these pages, output "answer_key": []
   and add a warning — NEVER guess an answer.
3. For choice questions (mcq / tfng / ynng / matching), every answer_key entry
   must be copied verbatim from that question's options array.
4. For gap_fill / short_answer, answer_key lists every accepted variant printed
   in the key (e.g. "led lamps / LEDs" becomes two entries).
5. qtype mapping: TRUE/FALSE/NOT GIVEN → tfng; YES/NO/NOT GIVEN → ynng;
   multiple choice → mcq; matching headings/features/endings → matching;
   sentence/summary/note/table completion → gap_fill; short answer →
   short_answer. Anything else (diagrams, writing tasks): skip it and record a
   warning naming the question numbers.
6. After transcribing each question and locating its printed answer, write a
   1–2 sentence explanation_md grounded in the passage text, quoting the exact
   phrase that justifies the answer. Mark nothing you cannot ground.
Output JSON only, no commentary, matching the provided schema.
```
