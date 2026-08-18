# Kickoff prompts for Claude Code

Each phase runs in a FRESH Claude Code session inside the `ielts-daily/` project
root. Paste the matching prompt verbatim. Run Phase 01 only after Phase 00's output
has been reviewed by the planning session.

---

## Phase 00 kickoff (paste into Claude Code)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — it contains mandatory invariant rules and
   the discovery protocol. Follow it exactly.
2. Read memory/STATE.md for current project state.
3. Read tasks/phase_00_scaffold_schema.md — this is your task. The SQL schema and
   file contracts in it are locked decisions: implement them verbatim, do not
   redesign them.

Context: this is a fresh repo containing only planning docs (CLAUDE.md, docs/,
tasks/, memory/, content/). Build Phase 00 exactly as specified: Next.js 15 +
TypeScript strict + Tailwind scaffold, Supabase schema migration, single-user auth
with middleware route protection. My Supabase project already exists; I will fill
.env.local myself from your .env.example — never ask me to paste keys into chat.

Respect the Non-goals section strictly. When every Definition of Done item passes,
fulfill the Handoff Obligations (phase report + overwrite STATE.md) and stop.
```

---

## Phase 01 kickoff (paste into a NEW Claude Code session after Phase 00 review)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — mandatory rules and discovery protocol.
2. Read memory/STATE.md and memory/phase_00_report.md for what already exists.
3. Read tasks/phase_01_roadmap_engine.md — this is your task. The TypeScript
   interface contract in it is locked: implement those exact signatures.

Build the roadmap engine (sequential pointer over units.seq), the Today screen, the
session player with completion, the /roadmap overview, and the idempotent seed
script. Seed content/seed/week_01.json — that file is architect-owned data: seed it
as-is, never edit or "improve" its content. If it seems malformed, log a discovery
instead of fixing content yourself.

---

## Phase 02 kickoff (paste into a NEW Claude Code session after Phase 01 review)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — mandatory rules and discovery protocol.
2. Read memory/STATE.md, memory/phase_01_report.md (especially its "Input for
   next phase" section), and the [Phase 01] entries in memory/discoveries.md.
3. Read tasks/phase_02_test_player.md — this is your task. The migration SQL,
   the tests.ts / band.ts signatures, and the grading normalization rules in it
   are locked: implement them verbatim.

Build the Practice step of the session player: migration 0002 (vocab natural-key
upsert fix), seed script support for tests/questions with id-stable upserts, the
timed test player with the design export's split view and countdown pill,
server-side grading (answer keys and explanations must never reach the client
before submission), attempt persistence, and the review screen. Then seed
content/seed/week_02.json — architect-owned data: seed as-is, never edit or
"improve" it; log a discovery if it seems malformed.

Reuse Phase 01's patterns: the .env.local self-loading preamble for scripts, the
existing completeUnitAction (called exactly once, at the final step), and the
design tokens already in globals.css. Respect the Non-goals strictly (no essay
rendering, no vocab UI, no AI, no ingestion, no mid-test resume). When every
Definition of Done item passes, fulfill the Handoff Obligations and stop.
```

---

## Phase 03 kickoff (paste into a NEW Claude Code session after Phase 02 review)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — mandatory rules and discovery protocol.
2. Read memory/STATE.md, memory/phase_02_report.md (especially "Input for next
   phase"), and the [Phase 02] entries in memory/discoveries.md.
3. Read tasks/phase_03_ingestion.md — this is your task. The staged-file schema,
   migration 0003, the ai.ts/validator contracts, and the extraction prompt in
   its Appendix are locked: implement them verbatim.

FIRST, check the prerequisite gate in the task file: at least one real reading
PDF in content/raw/, AI_API_KEY in .env.local, and pdftoppm installed. If
anything is missing, stop and ask me — never fabricate test content.

Build the batch ingestion pipeline: provider-agnostic AI client (src/lib/ai.ts),
shared validator extracted to scripts/lib/validate.ts (refit seed.ts onto it and
re-prove the Phase 02 seed counts), scripts/ingest.ts (PDF → staged JSON +
review.md, never touches the DB), scripts/ingest_commit.ts (slug-keyed id-stable
upserts, the ONLY path into the DB), presigned R2 audio serving, test_ref
support in the unit seed schema, and the /bank practice area (attempts with
unit_id null, roadmap pointer untouched).

At the review pause (Step 4), show me the review.md files and wait for my
confirmation before committing anything. When every Definition of Done item
passes, fulfill the Handoff Obligations — including the full list of committed
slugs in the phase report — and stop.
```

---

## Patch kickoff — text/vision hybrid extraction (paste BEFORE Phase 04, new session)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — mandatory rules and discovery protocol.
2. Read memory/phase_03_report.md for the ingestion pipeline as it exists today.
3. Read tasks/phase_03_patch_text_extraction.md — this is your task. The
   hasTextLayer heuristic and the text-extraction path are locked: implement
   them verbatim.

content/raw/ielts-academic-reading-sample-tasks-2023.pdf is a born-digital PDF
that was incorrectly routed through vision in Phase 03, which burned the
vision-only rate budget and stalled at page 28 of 46. Add text-layer detection
to scripts/ingest.ts so extraction runs on plain text (textChat) whenever a
real text layer exists, falling back to the existing vision path only for
genuinely scanned sources. Then re-run this file end-to-end via the text path
to confirm it completes in one run, and stage the remaining pages 29–46.

Do NOT run ingest_commit.ts — staging only, per the existing Phase 03 contract.
When the Definition of Done passes, fulfill the Handoff Obligations and stop.
```

---

## Phase 04 kickoff (paste into a NEW Claude Code session after Phase 03 review)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — mandatory rules and discovery protocol
   (note the amended content rule about architect-authorized normalizations).
2. Read memory/STATE.md, memory/phase_03_report.md (especially "Input for next
   phase"), and the [Phase 03] entries in memory/discoveries.md.
3. Read tasks/phase_04_vocab_srs.md — this is your task. The SRS schedule rules,
   the vocab.ts/stats.ts signatures, and the step-model behavior are locked:
   implement them verbatim.

Start with Step 0, the two Phase 03 carry-overs: (a) slash-split answer keys in
ingest.ts and re-commit the existing source from cached logs — verify p1–p6
still map to the same six titles before committing; (b) the text-only
explanation-enrichment script (works on free text models — do not require
vision). Then build the vocabulary system: pure SRS scheduler with fixtures,
triage step (default unchecked, deck words disabled), warm-up flashcards
(max 20, skippable, absent when nothing is due, never in the bank player),
/vocab library, and the Today-page heatmap + streak built by hand with the
existing design tokens — no chart library, no new dependencies.

Respect the Non-goals strictly (no multi-select — that is Phase 4b; no AI
beyond carry-over (b); no TTS or notifications). When every Definition of Done
item passes, fulfill the Handoff Obligations and stop.
```

---

## Phase 05 kickoff (paste into a NEW Claude Code session after Phase 04 review)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — mandatory rules and discovery protocol.
2. Read memory/STATE.md, memory/phase_04_report.md (especially "Input for next
   phase"), and the [Phase 04] entries in memory/discoveries.md.
3. Read tasks/phase_05_writing_ai.md — this is your task. The writing.ts
   contract, the essay validator rules, and the rubric prompt in its Appendix
   are locked: implement them verbatim.

Build writing as a first-class skill: top-level tests[] bank seeding in
scripts/seed.ts (share the id-stable slug-upsert code with ingest_commit.ts —
do not duplicate it), essay validator rules, then seed
content/seed/writing_bank_01.json (architect-owned — seed as-is). Implement
gradeEssay with response validation and a code-computed overall band, the
timed essay panel with live word count and the <50-word no-AI refusal, the
feedback review panel (band labeled "AI estimate ±0.5"), submitEssayAttempt
persistence, and the ephemeral explain-my-answer button on incorrect
objective questions (writes nothing — prove the attempts row is byte-identical
after use).

Fixtures mock the model — no live AI inside npm run check. Respect the
Non-goals strictly (no Task 1 chart images, no resubmit loop, no persistence
for explain-my-answer, bank stays vocab-free). When every Definition of Done
item passes, fulfill the Handoff Obligations — including rough token usage per
graded essay — and stop.
```

---

## Phase 06 kickoff (paste into a NEW Claude Code session after Phase 05 review)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — mandatory rules and discovery protocol.
2. Read memory/STATE.md, memory/phase_05_report.md (especially "Input for next
   phase"), and the [Phase 05] entries in memory/discoveries.md.
3. Read tasks/phase_06_dashboard_deploy.md — this is your task. The dashboard.ts
   contract, the calibration ruling in Step 0, and the deployment gates are
   locked: implement them verbatim.

Start with Step 0: (a) the grader calibration — rubric v2 with per-criterion
verbatim error inventories and evidence-tied caps, the code-enforced LR clamp,
and a live old-vs-new re-grade of the Phase 05 sample essay; (b) elapsed-time
wait UX for grading and explain calls. Then build src/lib/dashboard.ts with
fixture-tested pure halves (the question-type breakdown must re-grade stored
answers through the existing gradeAnswers — never a second grading
implementation), the /dashboard page and header tab, and the /bank/[slug]
attempt history with expandable essay feedback.

Deployment comes last and has two hard gates: the repo must be committed and
pushed (main is four phases behind — this is a prerequisite step of the phase),
and Supabase public signups must be confirmed disabled by me before the app
goes on the internet. Env values are entered by me in the Vercel UI — never
paste secrets into chat. Verify one objective run and one graded essay on the
production URL, and record any maxDuration you set.

No new dependencies, no chart libraries, no schema changes. When every
Definition of Done item passes, fulfill the Handoff Obligations and stop.
```

