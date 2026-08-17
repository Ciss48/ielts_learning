# Phase 03 report — batch content ingestion pipeline

**Executed:** 2026-08-17

## Done

### Config + migration
- `src/lib/config.ts`: `anthropicApiKey` replaced with the provider-agnostic
  `ai: { baseUrl, apiKey, model }` block, verbatim from the task file.
- `.env.example` rewritten: `ANTHROPIC_API_KEY` gone, the three `AI_*` vars added
  with a note that the endpoint is OpenAI-compatible and Groq is the known-good
  default. R2 section relabelled (it is used from Phase 3, not Phase 2).
- `.env.local`: the existing `GROK_API_KEY` was renamed to `AI_API_KEY` in place
  (same value, no key ever printed). Later in the session the user switched the
  key to an OpenCode Zen key and `AI_BASE_URL` / `AI_MODEL` were added — see
  "Provider situation" below.
- **Migration `0003_test_slug.sql`** — `alter table tests add column slug text unique;`
  **Applied via the Supabase MCP connection** (`apply_migration`), not by hand.
  The connection was verified *before* writing: `list_tables` returned exactly the
  9 IELTS tables with Phase 02's row counts, proving it is the right project and
  not the habit-tracker one that caused the Phase 02 discovery. Presence of the
  column re-confirmed afterwards via `information_schema.columns`.

### `src/lib/ai.ts` (new)
Dependency-free `fetch` client, credentials read only through `config.ts`.
Contract implemented as specified: `visionChat(prompt, images)`, `textChat(prompt)`,
`parseModelJson<T>(raw)`. Beyond the contract, and needed to make it work against a
real free-tier provider:
- `MAX_IMAGES_PER_CALL = 3` (the live limit, not the 5 the task assumed).
- `max_completion_tokens = 4096`, treated as a **rate-limit budget item** because
  the provider admits a request against `input + max_completion_tokens`.
- `reasoning_effort: "none"`, auto-disabled for the process if a provider rejects
  the parameter, so the module stays provider-agnostic.
- Self-throttling from `x-ratelimit-*` headers; `retry-after` honoured but **capped
  at 90s**, with an explicit error naming the delay asked for; `AbortSignal.timeout`
  of 180s per request. Retryability is decided by the response body as well as the
  status, because a token-per-minute overrun arrives as `413`, not `429`.
- `parseModelJson` strips `<think>…</think>` before any brace scan and reports a
  truncated reasoning block as such.

### `scripts/lib/validate.ts` (new) — the one validator
Phase 02's seed validation extracted here and shared by `seed.ts` and
`ingest_commit.ts`. Both new hard rules implemented:
1. For `mcq`/`tfng`/`ynng`/`matching`, every `answer_key` entry must equal one of
   `options` under the grader's normalization rule. This institutionalizes Phase 02
   §4.
2. `answer_key` must be non-empty at seed/commit time.
Staged files may violate both — `ingest.ts` validates in `soft` mode so violations
surface as review warnings — but `ingest_commit.ts` validates `hard` and refuses.
Also carries the seed-file duplicate-`seq`, duplicate-word and duplicate-`qnum`
checks, plus slug format and the 5–70 duration range for staged tests.

**`src/lib/normalize.ts` (new)** holds the single definition of the normalization
rule, imported by both `src/lib/tests.ts` (grading) and the validator (content), so
the two can never drift. `tests.ts` keeps its own `normalize` name as an alias, so
its behaviour is unchanged.

### `scripts/ingest.ts` (new) — extraction, never touches the DB
`pdftoppm -png -r 150` → per-chunk vision pass → merge pass → staged JSON +
`review.md` + raw responses under `content/staged/logs/<basename>/`.
Structurally provable that it cannot write to the database: the file contains no
Supabase import and no client (`grep -n "supabase\|createAdminClient\|createClient"
scripts/ingest.ts` → no matches). Flags: `--force`, `--resume`, `--from-logs`,
`--no-merge`.

### `scripts/ingest_commit.ts` (new) — the only path into the DB
Hard validation, then slug-keyed id-stable upsert: existing slug → UPDATE in place
+ delete/reinsert questions; a `tests` row is never deleted, so `attempts` are never
orphaned. Stores the PDF filename in the previously unused `tests.source`. Uploads
`audio_file` to R2 as `audio/<slug>.mp3` and stores `audio_url = "r2:audio/<slug>.mp3"`;
skips with a clear message and does **not** clear an existing URL when R2 is absent.
Prints a summary table.

### `src/lib/r2.ts` (new) + presigned audio
Private bucket, never made public. `resolveAudioUrl` turns `r2:<key>` into a 1-hour
presigned GET URL server-side and passes `https://` through unchanged; a signing
failure returns null so a test still renders its questions. Wired into
`src/lib/tests.ts` through the shared `toPlayerTest`, so both the roadmap player and
the bank player get it.

### `test_ref` in the unit seed schema
A unit may carry `"test_ref": "<slug>"` instead of an embedded `"test"`. Both
present is a validation error. All referenced slugs are resolved up front so an
unknown slug aborts before any write. The seeder only *links* a bank test — it never
touches the bank test's row or its questions.

### `/bank` practice area
- `src/lib/tests.ts`: `getTestBySlug`, `listBankTests` (slug-only, so
  roadmap-embedded tests are excluded), `BankTestSummary` with per-test best score.
  `startAttempt` widened to `unitId: string | null`.
- `src/app/bank/page.tsx` — the library table. `src/app/bank/[slug]/page.tsx` +
  `src/components/session/BankSession.tsx` — a two-step player (Practice → Review).
- `src/components/session/PracticePanels.tsx` — Phase 02's `PracticeIntro`,
  `PracticeSplit` and `ReviewPanel` moved out of `TestSession` unchanged, so both
  players share one practice experience. `TestSession`'s own logic is untouched.
- `src/app/bank/actions.ts` — `startBankAttemptAction` (unit_id null). Submission is
  not duplicated: `submitAttemptAction` takes only an attempt id and answers.
- "Practice" tab added to `AppHeader`. Auth comes from the existing middleware
  matcher, which already covers `/bank`.
- Nothing under `/bank` references `completeUnit`, `study_log` or `unit_completions`
  (grep-verified — the only hits are explanatory comments).

## Committed slugs (for the architect authoring weeks 3–4 and the diagnostic)

All from `ielts-academic-reading-sample-tasks-2023.pdf` (official IELTS Academic
Reading sample tasks, 46pp). All `skill = reading`, all `duration_minutes = 20`, all
`audio_url = null`. Reference them from a unit with `"test_ref": "<slug>"`.

| slug | title | qtype(s) | questions | qnums |
| --- | --- | --- | --- | --- |
| `ielts-academic-reading-sample-tasks-2023-p1` | Academic Reading Sample Task – Matching Features | matching | 4 | 7–10 |
| `ielts-academic-reading-sample-tasks-2023-p2` | Academic Reading Sample Task – Table Completion | gap_fill | 5 | 9–13 |
| `ielts-academic-reading-sample-tasks-2023-p3` | How a caloric-restriction mimetic works | gap_fill | 3 | 1–3 |
| `ielts-academic-reading-sample-tasks-2023-p4` | The life and work of Marie Curie | tfng | 3 | 1–3 |
| `ielts-academic-reading-sample-tasks-2023-p5` | The Physics of Traffic Behavior | matching | 4 | 1–4 |
| `ielts-academic-reading-sample-tasks-2023-p6` | Science in 16th-century London | matching | 3 | 1–3 |

**22 questions, every one with a printed answer key.** Note the qnums are as printed
in the source and do not all start at 1 — they are unique per test, which is all the
schema requires. These are single-task extracts, not full 40-question papers, so
`rawToBand` returns null for all of them (correct, per Phase 02).

**Not committed, deliberately** — both remain in the cached logs and will reappear on
re-assembly:
- `…-p7` "Multiple Choice: more than one answer" — **dropped on the user's decision.**
  The source prints "1&2 IN EITHER ORDER: B, G", i.e. one key for a *pair* of
  questions. The schema has no multi-select qtype, so both letters landed on both
  questions and the grader would accept the same letter twice for full marks. See
  "Open issues".
- `…-p8` "Multiple Choice: one answer" — its printed key is on page 29, beyond the
  28 pages extracted before the daily token quota ran out.

## Verification

Definition of Done, item by item.

- **Shared validator refit.** Both week seeds re-run twice after the refit:
  `units=12, embedded tests=1, questions=13, vocab_words=16`. Unit-id hash
  `7e333ad4…` and vocab-id hash `b5ab0245…` are **byte-identical** to the values
  captured before Phase 03 began, and unit 9's `test_id` is still
  `43997c2c-a7ca-4be2-8f22-8fa082f253db`. `scripts/check_grading.ts` still exits 0.
- **Rejection paths abort naming the field, and write nothing.** Verified for
  `test`+`test_ref` together, unknown `test_ref` slug, choice key not in options,
  empty answer key, and staged duration out of range. After all five, `units` was
  still 12 with no `seq 99`, and `tests` still had no `rejection-test%` slug.
- **`ingest.ts` on a real reading PDF** produced the staged JSON + `review.md`.
  After removing p7/p8 the file passed the **hard** validator, and the
  choice-key⊆options check reported **0 mismatches** across all 22 questions.
- **`ingest.ts` never touched the DB.** Row counts before the first extraction and
  after all extraction runs were identical (`tests=1, questions=13, attempts=1`),
  and the file has no DB access at all. `--resume` correctly skipped already-staged
  work; re-running without `--force` skips staged files.
- **`ingest_commit.ts` run twice** → 6 inserted, then 6 updated. `tests` count
  stable at 6, **all six ids identical** across both runs, question counts identical
  (4/5/3/3/4/3).
- **Bank practice run** grades correctly and writes `unit_id IS NULL`: attempt
  `4d802d97…` on `…-p2`, all-correct → 5/5, all-blank → 0/5 with 5 results, band
  null (correct below 40 questions). `unit_completions`, `study_log` and
  `units.test_id` **byte-identical** before and after; pointer still at seq 1.
  *Done one layer below the UI* — see "Open issues".
- **`test_ref`**: a throwaway `seq 90` unit with
  `"test_ref": "ielts-academic-reading-sample-tasks-2023-p3"` resolved
  `units.test_id` to `6525c558…`, exactly the bank test's id. Unit then deleted;
  `units` back to 12, and the bank test survived (never deleted).
- **Bank excludes roadmap tests**: the only null-slug test is week 02's
  "Vertical Farming" attached to unit 9 — absent from the `/bank` query.
- **Audio/presigning**: no listening content exists in this source, so **no audio was
  ingested and none was fabricated.** The mechanism itself is verified:
  `r2:audio/example-s1.mp3` → a presigned URL on
  `ielts-daily.<account>.r2.cloudflarestorage.com` carrying `X-Amz-Signature`,
  `X-Amz-Credential` and `X-Amz-Expires=3600`; no raw `r2:` value in the served URL;
  `https://` passes through; null stays null. **Playback is unverified** for lack of
  real audio.
- **`.gitignore`**: `git check-ignore` matches both `content/raw/` (line 46) and
  `content/staged/` (line 47). `git status` shows zero `content/` entries.
- **`npx tsc --noEmit`, `npm run lint`, `npm run build`** all clean; `/bank` and
  `/bank/[slug]` present in the route table. `process.env` appears only in
  `src/lib/config.ts` (other hits are comments). `grep -rn "AI_API_KEY" src/ scripts/`
  shows it read only in `config.ts` — elsewhere only inside error-message strings.

### Fidelity spot-check against the source
Every committed answer key was compared with the PDF's own printed answer pages
(via `pdftotext -layout`, independent of the vision model):

- p1 ← page 5 (`7 A, 8 A, 9 B, 10 E`) ✅
- p2 ← page 8 (`temperate / early spring / two to five / 2-5 / sub-tropical / …`) ✅
- p3 ← page 11 (`glucose / free radicals / preservation`) ✅
- p4 ← page 14 (`FALSE / NOT GIVEN / TRUE`) ✅
- p5 ← page 18 (`iii / viii / v / vii`) ✅
- p6 ← page 22 (`B / D / F`) ✅

One transcription deviation found and **left uncorrected** (content is the user's
call): p2 q13 is printed `South African tunneling/tunnelling` (US then UK spelling)
and was transcribed `South African tunnelling/tunnelling`. Flagged in review.md.

## New findings

Four Moderate discoveries, all logged in `memory/discoveries.md`, all self-resolved,
**no Major, no `docs/plan.md` change required**:

1. **The ≤5-pages-per-call contract is impossible on this provider.** The real limits
   are 3 images per request and 8,000 tokens/minute admitted as
   `input + max_completion_tokens`. Runs at 1 page/call.
2. **One page per call separates every question from its printed answer key.** The
   model correctly refused to guess (fidelity rule 2), leaving every key empty.
   Fixed with an `answer_pages` channel plus printed-label dereferencing.
3. **The merge pass returns a grouping plan, not merged text** — feeding transcribed
   prose back through an LLM would violate fidelity rule 1.
4. **The free tier's 200k tokens/day cap bounds ingestion throughput** to roughly
   45–50 pages of source per day. One 46-page PDF nearly exhausts a day.
   **This one matters for Phase 05**, which draws on the same daily pool.

### Provider situation (relevant to Phase 05)
- Extraction ran on Groq `qwen/qwen3.6-27b` and stopped at page 28 of 46 when the
  200k/day cap was reached (199,568 used).
- The user then supplied an **OpenCode Zen** key (`https://opencode.ai/zen/v1`).
  Its paid models return `CreditsError: Insufficient balance`; its `-free` models
  work for **text** but **none supports vision** (`404 No endpoints found`, or empty
  content). So the merge pass was completed on `nemotron-3.5-lightning-free`, but the
  remaining 18 pages still need a vision-capable endpoint.
- `.env.local` currently points at OpenCode Zen with
  `AI_MODEL=nemotron-3.5-lightning-free`. **This is text-only — change `AI_MODEL`
  (and probably the key) before the next extraction run.** Groq's
  `qwen/qwen3.6-27b` is the known-good vision setting.
- Worth noting the swap cost no code change at all, which is the provider-agnostic
  design working as intended.

## Decisions made
- **Answer attachment matches by printed heading first, then by document position**,
  guarded by a question-number check, because a passage page and its answers page are
  often headed differently (passage title vs task type). Both positional matches
  (p4, p6) were checked against the PDF and are correct. Every positional match is
  reported in review.md.
- **Printed-label dereferencing**, not invention: a key printed `A` is resolved to
  the option carrying label `A`. 15 such substitutions occurred, each logged
  individually. If no option carries the label the printed value is kept verbatim and
  the hard validator rejects it.
- **Slash-separated alternatives are reported, never split.** The source states
  "Alternative answers are separated by a slash (/)", and the Appendix asks for one
  entry per variant, but splitting is a content edit — CLAUDE.md forbids me making it.
  p2 q11/q13 are flagged instead. **Consequence: p2 q11 and q13 currently accept only
  the literal combined string**, so they will read as wrong for a correct answer.
- **`--no-merge` exists but must not be used for content that will be committed.**
  Measured against the merge pass on this source it is clearly worse: title-only
  grouping strands a passage whose page carries a different heading.
- p7 and p8 dropped before commit, on the user's explicit decision.

## Open issues
1. **18 of 46 pages are not yet ingested** (pages 29–46, roughly 7 more tasks
   including Note Completion, Sentence Completion, two Summary Completions and the
   Diagram Label task the rules say to skip). Needs a vision-capable endpoint with
   budget. Run `npx tsx scripts/ingest.ts --force --resume` — the 28 cached pages
   replay for free.
2. **Slug numbering is positional, so a partial ingest bakes in numbering.** Slugs are
   `-p<N>` by order of appearance, per the locked convention. When pages 29–46 are
   added, **verify that p1–p6 still map to the same six titles before committing**,
   or a committed slug could silently come to mean a different test. Grouping has been
   stable across three different models, but the merge pass is an LLM call.
3. **No multi-select question type.** "Choose TWO letters … IN EITHER ORDER" cannot be
   represented: one key covers a pair of questions jointly. This is a schema gap, not
   an extraction bug — it needs a plan-level decision (a `multi_select` qtype, or a
   convention for pairing). p7 is blocked on it, and full papers contain this type.
   `ingest.ts` now detects the pattern and warns.
4. **No explanations on any ingested question.** Fidelity rule 6 asks for an
   explanation grounded in the passage, but with one page per call the questions were
   never in the same request as their passage, so the model had nothing to quote.
   Grading is unaffected; the Review step just shows no explanation. Larger chunks on
   a paid tier would fix this.
5. **Browser verification is still blocked**, now for a third phase. The Chrome
   extension cannot reach the dev server on `localhost` *or* the LAN IP
   (`192.168.1.11`) — requests never arrive (dev-server log shows only my `curl`).
   So `/bank` and `/bank/[slug]` are **verified at the layer below the UI**: the
   attempt/grading/roadmap-isolation properties are proven directly against the
   database, and the no-roadmap-contact property by grep. What is *not* verified is
   that the pages render and the buttons wire up. Same debt as Phases 01–02.
6. **Phase 02 and 03 are still uncommitted to git.** Nothing has been committed since
   `068e763` (Phase 01).

## Input for next phase
- **The bank is real and playable.** Six reading tests with verified keys, addressable
  as `/bank/<slug>` and linkable from a unit via `"test_ref": "<slug>"`. Week 3–4
  units can use them today; the table above is the authoritative list.
- **`ingest_commit.ts` is the only path into the DB and keeps ids stable**, so a test
  can be re-committed after a content fix without orphaning attempts. Keep that.
- **`scripts/lib/validate.ts` is the single validator — extend it, don't fork it.**
  Any new writer must go through it. The two hard rules now apply to hand-authored
  content too, so architect-authored seed files must keep choice keys verbatim from
  `options`.
- **`src/lib/normalize.ts` is the one normalization rule.** If grading ever changes,
  change it there and the validator follows automatically.
- **`src/lib/ai.ts` is ready for Phase 05** (`textChat` + `parseModelJson`) and is
  already rate-limit- and timeout-hardened. Budget for the shared daily token pool,
  and do not assume the configured `AI_MODEL` supports vision.
- **Attempts now come in two kinds.** `attempts.unit_id IS NULL` means bank practice;
  non-null means roadmap. Anything that reports progress or stats must filter, or bank
  practice will inflate roadmap numbers. Current state: 1 of each.
- `tests.source` now carries the source PDF filename for ingested tests.

---

## Superseded in part — see `memory/phase_03_patch_report.md` (2026-08-17)

`scripts/ingest.ts` no longer routes every source through vision. It now detects a
usable text layer per file (`hasTextLayer`) and extracts born-digital PDFs from that
text directly, using `textChat`; the vision path above is unchanged but is reached
only for genuinely scanned sources.

Consequences for what this report says:

- **"18 of 46 pages are not yet ingested" is resolved.** The whole file re-ran
  end-to-end in a single run with **zero vision calls** and no daily-token wall,
  producing 13 staged tests / 55 questions covering pages 1–46. Still staged only —
  `ingest_commit.ts` was not run, so the six committed bank tests in the table above
  are still exactly what is in the database.
- **"No ingested question has an explanation" is resolved** for the text path: with a
  task and its passage in the same chunk, 44 of 55 questions carry one.
- **The p2 q11/q13 slash-alternative gap is resolved in the new staging** but not in
  the committed tests.
- Three new Moderate discoveries came out of the larger chunks (merge pass ignoring
  `continues_previous`, model-filled keys skipping label dereference, and the model
  inventing keys when it can see the passage). All are in `memory/discoveries.md`.
