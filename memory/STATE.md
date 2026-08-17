# State

**Last updated:** 2026-08-17 — Phase 04 (vocabulary system + Phase 03 carry-overs) executed

## Where things stand

Phase 04 is **done**. Vocabulary is a working system end to end: a unit's words can be
triaged into a deck, the deck schedules itself with SM-2 lite, due cards open the next
session as flashcards, and the Today page carries the 12-week heatmap and streak.

Both Phase 03 carry-overs are closed, and **the source was re-committed**. The bank is
now **11 tests / 46 questions**, and **every question in the database has an
explanation** (59 of 59, including the roadmap-embedded test).

Current phase: **05**. Status: not started. Nothing blocks it.

## Completed
- **Phase 00** — `memory/phase_00_report.md`. Scaffold, schema, auth, routes.
- **Phase 01** — `memory/phase_01_report.md`. Roadmap pointer engine, seed script,
  `/`, `/unit/[seq]`, `/roadmap`, design tokens.
- **Phase 02** — `memory/phase_02_report.md`. Test player, timer, server-side grading,
  migration `0002`, id-stable test upserts, `scripts/check_grading.ts`.
- **Phase 03** — `memory/phase_03_report.md`. Migration `0003_test_slug.sql`;
  `src/lib/ai.ts`, `normalize.ts`, `r2.ts`, `scripts/lib/validate.ts` (the single
  validator), `ingest.ts`, `ingest_commit.ts` (the only path into the DB), `test_ref`,
  `/bank`.
- **Phase 03 patch** — `memory/phase_03_patch_report.md`. `hasTextLayer` routing, the
  TEXT extraction path, `joinContinuations`, printed-label dereference, printed-key
  cross-check.
- **Phase 04** — `memory/phase_04_report.md`. `src/lib/srs.ts` (pure scheduler),
  `vocab.ts`, `stats.ts`, `day.ts` (the one definition of "today"); `UnitSession`
  replacing both Phase 02 players; Warm-up + Vocab steps; `StudyHeatmap`; `/vocab`;
  `scripts/enrich_explanations.ts`; `scripts/lib/answer_variants.ts` + the slash split
  in `ingest.ts`; `--skip` on `ingest_commit.ts`; `npm run check`.
- **DB state now:** `units=12`, `tests=12` (1 roadmap-embedded + **11** bank),
  `questions=59` (46 bank), `questions with no explanation=0`, `vocab_words=16`,
  `vocab_cards=0`, `vocab_reviews=0`, `attempts=2`, `unit_completions=0`,
  `study_log=0`. **Pointer is at unit 1.**

## Most important findings so far
- Locked stack: Next.js 15 + TS strict + Tailwind 4, Supabase (single user),
  Cloudflare R2. The AI provider is OpenAI-compatible and swappable — exercised for
  real four times now, with zero code changes.
- **`src/lib/day.ts` is the one definition of a calendar day** in Asia/Ho_Chi_Minh.
  `study_log.day` and `vocab_cards.due_date` are calendar days *there*, not UTC
  instants. Anything date-shaped must go through it.
- **`src/lib/srs.ts` is pure and its rules are locked** by
  `tasks/phase_04_vocab_srs.md`. `scripts/check_srs.ts` pins every branch.
- **`study_log` is the only progress ledger and only `completeUnit` writes it.**
  Grading a flashcard deliberately does not — the heatmap counts sessions finished,
  not cards flipped.
- **Ingestion needs neither a vision model nor a token budget** for born-digital
  PDFs; `hasTextLayer` routes per file. Scanned sources still go to vision.
- **A chunk big enough to hold a task and its answers is a double-edged thing** — real
  keys and explanations, but the model can also invent a key from the passage. The
  pipeline cross-checks every filled key against the printed answers page.
- **`attempts` come in two kinds:** `unit_id IS NULL` = bank practice, non-null =
  roadmap. Progress reporting must filter.
- Sixteen Moderate discoveries across all phases, all self-resolved. **No Major
  discoveries. No `docs/plan.md` change is needed.**

## AI provider
`.env.local` points at **OpenCode Zen** (`AI_BASE_URL=https://opencode.ai/zen/v1`)
with `AI_MODEL=nemotron-3-ultra-free`, which was exercised again this session (the
merge pass plus 11 explanation calls, no failures, no rate-limit stalls).
- Also working: `nemotron-3.5-lightning-free`, `hy3-free`.
  `deepseek-v4-flash-free` and `mimo-v2.5-free` return `FreeUsageLimitError`.
  Paid models return `CreditsError: Insufficient balance`.
- **None of the free models does vision.** That blocks nothing today. If a *scanned*
  source ever arrives, the known-good vision setting is Groq `qwen/qwen3.6-27b` at
  `https://api.groq.com/openai/v1`, subject to 200k tokens/day.
- Phase 05 is text-only and unaffected either way.

## Blocking / user actions outstanding
1. **Confirm the four renamed bank tests.** The re-commit changed the display titles
   of `…-p3` … `…-p6` from their passage titles to their printed task types (e.g.
   "The Physics of Traffic Behavior" → "Academic Reading Sample Task – Matching
   Headings"). Same tests, same ids, attempts intact — this is a display change only,
   and it is reversible. The six titles are listed in `memory/phase_04_report.md`.
2. **Decide what to do with `…-p13`.** Still staged, still uncommitted: five answer
   keys the extraction model invented from the passage. Fidelity rule 5 says diagram
   tasks are skipped. It stays out of the bank until you say otherwise.
3. **`…-p7` needs the Phase 4b multi-select decision** before it can be committed.
4. **The two `CLAUDE.md` files have drifted, and this one matters.** The project-root
   copy carries four rules the in-repo `ielts-daily/CLAUDE.md` does not: the
   provider-agnostic AI rule, the `content/raw` + `content/staged` git-ignore rule,
   "AI-extracted content is never auto-inserted", and the Phase 04 exception allowing
   architect-authorized mechanical normalizations. A future session reading only the
   in-repo copy would not know what binds it. Worth syncing before Phase 05.
5. **Grant the Chrome extension site permission for `http://localhost:3000`.** This is
   the only thing standing between the project and four phases of cleared
   verification debt (details below). Does not block Phase 05.

## Verification debt — the browser walk-through
Four phases old. The extension cannot reach the dev server on `localhost:3000` or the
LAN IP (now `192.168.1.144`): navigation fails with "Frame with ID 0 is showing error
page" and the dev server logs no request, while `curl` from the same machine works.
Everything below is verified one layer down (live DB, fixtures, server-rendered
markup, grep, `tsc`, `next build`); what is unverified is that the pages paint and the
buttons wire up.

- Phase 01/02: `/` → Unit 01 → complete → Unit 02; `/unit/5` bounces; `/unit/9`
  player; timer auto-submit at 00:00 (`update tests set duration_minutes = 1`, then
  back to 20); view-source grep for `Despommier popularized` — absent before submit,
  present after.
- Phase 03: `/bank` lists 11 tests with question counts; a full run at
  `/bank/ielts-academic-reading-sample-tasks-2023-p1` grades and shows the accepted
  answers and now an explanation; the roadmap pointer on `/` does not move.
- Phase 04: the Today heatmap and streak render; `/vocab` shows the deck table and
  "Review now"; a unit that teaches words shows the Vocab step with every box
  **unchecked**; ticking words and pressing "Add N words and continue" creates that
  many cards; with a card due, `/unit/[seq]` opens on Warm-up, "Skip warm-up" jumps to
  Strategy, and grading persists per card (refresh mid-warm-up and the graded ones are
  gone from the run); the bank player shows neither step.

**Note for whoever does this:** the Vocab step cannot currently be reached at all —
all 16 vocab words belong to units 2 and 12, both locked behind unit 1. It becomes
reachable as soon as unit 1 is completed in normal use.

## Considered and accepted by the user — do NOT re-raise as action items
Decided 2026-08-17. This project is personal and small; the user has weighed these
and chosen to live with them.
- **Token `sbp_601a…` was pasted into the Phase 00 chat and will not be rotated.**
- **Public signups stay enabled**, so `authenticated_all` RLS grants any account that
  can be created full read/write. Known and accepted.
- The expired tokens in `~/.claude.json` need nothing — dead config.

## For the assistant to do — not user homework
- **Commit Phases 02, 03, the patch and 04.** `main` is still at `068e763` (Phase 01);
  everything since is uncommitted. `.env.local`, `content/raw/` and `content/staged/`
  are correctly ignored and untracked (`git check-ignore` confirms all three); the only
  `content/` entry `git status` shows is `content/seed/week_03_04.json`, which is
  architect-authored seed data and belongs in version control. Offer to commit; do not
  hand it over as a task.

## Known content gaps to raise with the planning model
- **No multi-select question type.** "Choose TWO letters … IN EITHER ORDER" prints one
  key for a *pair* of questions and cannot be represented; the grader would accept the
  same letter twice for full marks. Blocks `…-p7` and any full paper. Needs a
  plan-level decision (a `multi_select` qtype, or a pairing convention). `ingest.ts`
  detects and warns about the pattern — for choice qtypes only, since Phase 04.
- **Diagram Label Completion cannot be represented either**, and the extraction model
  invents keys rather than refusing. Enforcement is a review warning plus a
  cross-check against the printed page, not a hard rule.
- **The roadmap teaches no vocabulary until unit 2**, so a new user's first session has
  neither a Warm-up nor a Vocab step. By design, but worth knowing when authoring
  weeks 3–4 — the vocabulary system only becomes visible in week 1, day 2.

## Next action
Read `tasks/phase_05_*.md` when it exists. Nothing blocks Phase 05 (writing feedback,
text-only AI — `src/lib/ai.ts` is ready and hardened). The five user actions above are
independent of it, plus committing to git.
