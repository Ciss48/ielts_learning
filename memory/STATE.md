# State

**Last updated:** 2026-08-17 — Phase 05 (AI writing grading + explain-my-answer) executed

## Where things stand

Phase 05 is **done**. Writing is a first-class skill: three writing tasks sit in the
bank, a timed panel with a live word count takes the essay, one model call grades it
against the official band descriptors, and the review screen shows four criteria, an
overall band labelled **"AI estimate ±0.5"**, top fixes and verbatim sentence rewrites.
On any objective question answered wrong, one button produces an explanation of *that*
answer — and stores nothing.

Current phase: **06**. Status: not started. Nothing blocks it.

## Completed
- **Phase 00** — `memory/phase_00_report.md`. Scaffold, schema, auth, routes.
- **Phase 01** — `memory/phase_01_report.md`. Roadmap pointer engine, seed script,
  `/`, `/unit/[seq]`, `/roadmap`, design tokens.
- **Phase 02** — `memory/phase_02_report.md`. Test player, timer, server-side grading,
  migration `0002`, id-stable test upserts, `scripts/check_grading.ts`.
- **Phase 03** — `memory/phase_03_report.md`. Migration `0003_test_slug.sql`;
  `src/lib/ai.ts`, `normalize.ts`, `r2.ts`, `scripts/lib/validate.ts` (the single
  validator), `ingest.ts`, `ingest_commit.ts`, `test_ref`, `/bank`.
- **Phase 03 patch** — `memory/phase_03_patch_report.md`. `hasTextLayer` routing, the
  TEXT extraction path, `joinContinuations`, printed-label dereference, printed-key
  cross-check.
- **Phase 04** — `memory/phase_04_report.md`. `src/lib/srs.ts`, `vocab.ts`, `stats.ts`,
  `day.ts`; `UnitSession`; Warm-up + Vocab steps; `StudyHeatmap`; `/vocab`;
  `enrich_explanations.ts`; the answer-key slash split; `npm run check`.
- **Phase 05** — `memory/phase_05_report.md`. `src/lib/writing.ts` (rubric call +
  response validation + code-computed overall band), `words.ts`, `md_tables.ts`,
  `explain.ts`; `scripts/lib/bank_upsert.ts` (the shared id-stable slug upsert);
  validator essay + writing-test rules; top-level `tests[]` in seed files;
  `WritingPanels.tsx` wired into both players; `check_writing.ts` (fixtures) and
  `check_writing_db.ts` (live).
- **DB state now:** `units=12`, `tests=15` (1 roadmap-embedded + **14** bank: 11 reading
  + **3 writing**), `questions=62` (46 bank reading + 3 essays + 13 embedded),
  `questions with no explanation=0` (essays excepted — they have none by rule),
  `vocab_words=16`, `vocab_cards=0`, `vocab_reviews=0`, `attempts=2`,
  `unit_completions=0`, `study_log=0`. **Pointer is at unit 1.**

## Most important findings so far
- Locked stack: Next.js 15 + TS strict + Tailwind 4, Supabase (single user),
  Cloudflare R2. The AI provider is OpenAI-compatible and swappable — exercised for real
  six times now, with zero code changes.
- **`src/lib/day.ts` is the one definition of a calendar day** in Asia/Ho_Chi_Minh.
  Anything date-shaped must go through it.
- **`src/lib/srs.ts` is pure and its rules are locked.** `scripts/check_srs.ts` pins
  every branch.
- **`study_log` is the only progress ledger and only `completeUnit` writes it.**
- **`src/lib/words.ts` is the one word-counting rule** (and holds `MIN_ESSAY_WORDS`),
  because the live counter runs in the browser and `writing.ts` is server-only.
- **An essay's overall band is computed in code**, never taken from the model — the mean
  of TR/CC/LR/GRA snapped to the nearest half band. The model is not even asked for one.
- **`scripts/lib/bank_upsert.ts` is the only path a bank test takes into the database**,
  shared by `seed.ts` and `ingest_commit.ts`. A slug that exists is updated in place, so
  `tests.id` — and the attempts hanging off it — survive a re-seed or a re-commit.
- **`src/lib/explain.ts` contains no write of any kind**, and the live check proves the
  `attempts` row is byte-identical across an explain call.
- **`attempts` come in three kinds now:** objective roadmap (`unit_id` non-null,
  `score_raw` non-null), objective bank (`unit_id` null), and essay (`score_raw` NULL,
  `band_estimate` non-null, `ai_feedback_md` non-null). Progress reporting must filter.
- Twenty-one Moderate discoveries across all phases, all self-resolved. **No Major
  discoveries. No `docs/plan.md` change is needed.**

## AI provider
`.env.local` points at **OpenCode Zen** (`AI_BASE_URL=https://opencode.ai/zen/v1`) with
`AI_MODEL=nemotron-3-ultra-free`, exercised again this session (two graded essays and one
explanation, no failures, no rate-limit stalls).
- **Rough token cost, measured:** ~2,100 tokens to grade one essay (~1,180 in / ~920 out)
  and ~1,510 to explain one wrong answer (~1,380 in / ~130 out — the passage dominates).
  Essay length barely moves the total; the rubric is ~1,000 fixed tokens. A day of three
  essays and five explanations is ~14k tokens, i.e. negligible beside ingestion.
- **Latency:** 26–94 seconds per graded essay, with no streaming. The button says
  "Grading…" for the whole time.
- **The grader runs about a band generous.** A deliberately intermediate 286-word sample
  (misspellings, `more fair`, mechanical connectors) scored 7.0. The comments catch every
  error and are worth reading; the number is worth ±0.5 of scepticism, which is what the
  label says.
- **None of the free models does vision.** Blocks nothing today; if a *scanned* source
  arrives, the known-good vision setting is Groq `qwen/qwen3.6-27b`.

## Blocking / user actions outstanding
1. **Confirm the four renamed bank tests** (`…-p3` … `…-p6` now show their printed task
   types, not their passage titles). Same tests, same ids, attempts intact; reversible.
   The six titles are listed in `memory/phase_04_report.md`.
2. **Decide what to do with `…-p13`** — still staged, still uncommitted: five answer keys
   the extraction model invented from the passage.
3. **`…-p7` needs the Phase 4b multi-select decision** before it can be committed.
4. **Weeks 3–4 (`content/seed/week_03_04.json`, units 13–24) have never been seeded.**
   Phase 05 found this by accident while regression-testing the refactored seeder, seeded
   them, and then **reverted it** — the database is back at `units=12` with nothing lost
   (no attempt, completion or SRS card hung off them). If they are meant to be live:
   `npx tsx scripts/seed.ts content/seed/week_03_04.json`. Not an executor decision.
5. **The two `CLAUDE.md` files have drifted, and this one matters.** The project-root copy
   carries four rules the in-repo `ielts-daily/CLAUDE.md` does not: the provider-agnostic
   AI rule, the `content/raw` + `content/staged` git-ignore rule, "AI-extracted content is
   never auto-inserted", and the Phase 04 mechanical-normalization exception. Worth
   syncing.
6. **Grant the Chrome extension site permission for `http://localhost:3000`.** Still the
   only thing standing between the project and five phases of cleared verification debt.

## Verification debt — the browser walk-through
Five phases old. The extension cannot reach the dev server on `localhost:3000` or the LAN
IP: navigation fails with "Frame with ID 0 is showing error page" and the dev server logs
no request, while `curl` from the same machine works. Everything below is verified one
layer down (live DB, fixtures, server-rendered markup, grep, `tsc`, `next build`); what is
unverified is that the pages paint and the buttons wire up.

- Phase 01/02: `/` → Unit 01 → complete → Unit 02; `/unit/5` bounces; `/unit/9` player;
  timer auto-submit at 00:00; view-source grep for `Despommier popularized` — absent
  before submit, present after.
- Phase 03: `/bank` lists the bank with question counts; a full run at
  `/bank/ielts-academic-reading-sample-tasks-2023-p1` grades and shows the accepted
  answers and an explanation; the roadmap pointer on `/` does not move.
- Phase 04: the Today heatmap and streak render; `/vocab` shows the deck and "Review now";
  a unit that teaches words shows the Vocab step with every box **unchecked**; ticking and
  pressing "Add N words and continue" creates that many cards; with a card due,
  `/unit/[seq]` opens on Warm-up and "Skip warm-up" jumps to Strategy; the bank player
  shows neither step.
- Phase 05: `/bank` shows the three writing tests under a **Writing** badge with a band in
  the Best result column; `/bank/writing-t2-university-fees` opens on the essay intro, not
  the question list; the textarea takes keystrokes and the counter turns accent-coloured
  at 250; submitting under 50 words shows the refusal banner and no network call; the
  feedback screen shows the band with "AI estimate ±0.5"; on a wrong objective answer the
  "Why is my answer wrong?" button loads and renders inline, and a correct question has no
  button.

**Note for whoever does this:** the Vocab step still cannot be reached — all 16 vocab
words belong to units 2 and 12, both locked behind unit 1. It becomes reachable as soon as
unit 1 is completed in normal use.

## Considered and accepted by the user — do NOT re-raise as action items
Decided 2026-08-17. This project is personal and small; the user has weighed these and
chosen to live with them.
- **Token `sbp_601a…` was pasted into the Phase 00 chat and will not be rotated.**
- **Public signups stay enabled**, so `authenticated_all` RLS grants any account that can
  be created full read/write. Known and accepted.
- The expired tokens in `~/.claude.json` need nothing — dead config.

## For the assistant to do — not user homework
- **Commit Phases 02, 03, the patch, 04 and 05.** `main` is still at `068e763` (Phase 01);
  everything since is uncommitted. `.env.local`, `content/raw/` and `content/staged/` are
  correctly ignored and untracked; `content/seed/week_03_04.json` and
  `content/seed/writing_bank_01.json` are architect-authored seed data and belong in
  version control. Offer to commit; do not hand it over as a task.

## Known content gaps to raise with the planning model
- **No multi-select question type.** "Choose TWO letters … IN EITHER ORDER" prints one key
  for a *pair* of questions and cannot be represented. Blocks `…-p7` and any full paper.
  Needs a plan-level decision.
- **Diagram Label Completion cannot be represented either**, and the extraction model
  invents keys rather than refusing.
- **Writing tasks cannot be ingested from a PDF.** The staged shape has no field for
  `task_type` / `min_words` / `prompt_md`, so the validator now refuses a staged writing
  test outright. Writing tasks are authored in a seed file — which is fine, but it means
  a Cambridge writing paper cannot be dropped into `content/raw/` the way a reading one
  can.
- **The roadmap teaches no vocabulary until unit 2**, so a new user's first session has
  neither a Warm-up nor a Vocab step.
- **No writing unit references a writing test yet.** The three tasks are bank-only; a
  roadmap unit picks one up with `"test_ref": "writing-t2-university-fees"` whenever weeks
  3+ are authored to include one.

## Next action
Read `tasks/phase_06_*.md` when it exists. Phase 6 is progress/history: it should render
`attempts.ai_feedback_md` rather than re-parse feedback JSON, and must distinguish essay
attempts (`score_raw IS NULL`) from objective ones. The six user actions above are
independent of it, plus committing to git.
