# State

**Last updated:** 2026-08-18 — Phase 06 (calibration, dashboard, deployment) executed

## Where things stand

Phase 06 is **code-complete and pushed**. The grader is calibrated: it lists its evidence
before it bands, states the caps that evidence implies, and the code clamps Lexical
Resource itself when three or more real spelling errors survive a verbatim check. The
Phase 05 sample essay re-graded **7.0 → 6.5**. `/dashboard` shows totals, three skill
trajectories and a question-type weakness table computed by re-grading stored answers.
`/bank/[slug]` shows that test's attempt history, with essay rows expanding to their
stored feedback. Long model calls now show elapsed seconds.

**The one thing not finished: the Vercel deployment.** The user is creating the project
through the web UI and entering the env values there. Everything on the code side is done,
committed and pushed.

Current phase: **06**. Status: awaiting the production URL, then production verification.

## Completed

- **Phase 00** — `memory/phase_00_report.md`. Scaffold, schema, auth, routes.
- **Phase 01** — `memory/phase_01_report.md`. Roadmap pointer engine, seed script.
- **Phase 02** — `memory/phase_02_report.md`. Test player, timer, server-side grading.
- **Phase 03** — `memory/phase_03_report.md` + `phase_03_patch_report.md`. Ingestion,
  `ai.ts`, the validator, `/bank`.
- **Phase 04** — `memory/phase_04_report.md`. SRS, vocab, `stats.ts`, `day.ts`, heatmap.
- **Phase 05** — `memory/phase_05_report.md`. `writing.ts`, `words.ts`, `md_tables.ts`,
  `explain.ts`, `bank_upsert.ts`, `WritingPanels.tsx`.
- **Phase 06** — `memory/phase_06_report.md`. Rubric v2 + the LR clamp, `AiWait`,
  `src/lib/dashboard.ts`, `computeLongestStreak`, `dayOfInstant`, `/dashboard`,
  `AttemptHistory`, `QTYPE_LABEL`, `maxDuration`, README §5, `check_dashboard.ts` and
  `check_dashboard_db.ts`.

## Git

**`main` is at `7a56c45` and is pushed.** `origin/main` had been stuck at `068e763`
(Phase 01) — the Phase 02–04 commit was local-only too. One commit carries Phases 05 and
06 together, because six files hold changes from both and a split would not have bisected
honestly. Nothing is uncommitted except this file and the Phase 06 report.

## DB state now

`units=12`, `tests=15` (1 roadmap-embedded + 14 bank: 11 reading + 3 writing),
`questions=62`, `vocab_words=16`, **`unit_completions=6`**, **`study_log` sums to 6 units
/ 360 minutes**, `attempts=5` (4 submitted). **The pointer has moved: 6 units are done.**

Two of those attempt rows are **executor test data**, left in place at the user's choice:
an abandoned empty attempt and a graded essay (band 6.5) on `writing-t2-university-fees`,
both from `scripts/check_writing_db.ts` and neither written by the user. They are what
makes the writing trajectory and the Task 2 attempt history non-empty for verification.
Delete them once a real essay has been sat.

## Most important findings so far

- **`src/lib/dashboard.ts` is the only progress-reporting module.** Its pure halves hold
  the rules; `scripts/check_dashboard.ts` pins them.
- **The question-type breakdown re-grades through `gradeAnswers` and must keep doing so.**
  A second comparison rule in `dashboard.ts` fails three fixtures on purpose.
- **There are now TWO definitions of "how many did I get right"**, and they legitimately
  disagree: **16/22** re-graded against today's answer key versus a stored `score_raw` sum
  of **18**. Phase 04's authorized key split made two old slash-joined answers non-matching.
  Any new figure must say which definition it uses.
- **`src/lib/day.ts` is the one definition of a calendar day**, and `dayOfInstant` is the
  only way to turn a `timestamptz` into one. `today()` is that function applied to now.
- **An essay's overall band is computed in code**, and since Phase 06 the code also clamps
  LR to 6.0 on three or more verbatim spelling/word-form errors, before the mean.
  `WritingCriterion` now carries `errors: string[]` and `capped: boolean`.
- **Only LR's cap is enforced in code.** CC, GRA and TR's caps are prompt-level and the
  model half-applies them — it held CC at 6.5 correctly but invoked GRA's cap by name
  while awarding 6.5 where the stated cap is 6.0. The error inventory is the mitigation.
- **`study_log` is the only progress ledger and only `completeUnit` writes it.**
- **`scripts/lib/bank_upsert.ts` is the only path a bank test takes into the database.**
- **`src/lib/explain.ts` contains no write of any kind.**
- Twenty-five Moderate discoveries across all phases, all self-resolved. **No Major
  discoveries. No `docs/plan.md` change is needed.**

## AI provider

`.env.local` points at **OpenCode Zen** (`AI_BASE_URL=https://opencode.ai/zen/v1`) with
`AI_MODEL=nemotron-3-ultra-free`. Rubric v2 costs ~2,520 tokens to grade one essay
(~1,633 in / ~888 out), up from v1's ~2,100 — the error inventory is the difference.
Latency this session: **18.3 s**, one call. Explain is ~1,510 tokens.
- **None of the free models does vision.** If a *scanned* source arrives, the known-good
  vision setting is Groq `qwen/qwen3.6-27b`.

## Blocking / user actions outstanding

1. **Finish the Vercel deployment.** Import `Ciss48/ielts_learning` at vercel.com/new,
   Root Directory `./`, set the env vars listed in README §5, deploy, then hand over the
   production URL for verification. **Skip `SUPABASE_SERVICE_ROLE_KEY`** — nothing under
   `src/` imports the admin client, so it would only put an RLS-bypassing key in the
   deployed environment for no gain.
2. **Confirm the four renamed bank tests** (`…-p3` … `…-p6`). Titles are in
   `memory/phase_04_report.md`. Same tests, same ids, attempts intact; reversible.
3. **Decide what to do with `…-p13`** — still staged, still uncommitted: five answer keys
   the extraction model invented from the passage.
4. **`…-p7` needs the Phase 4b multi-select decision** before it can be committed.
5. **Weeks 3–4 (`content/seed/week_03_04.json`, units 13–24) have never been seeded.**
   One command if they should be live:
   `npx tsx scripts/seed.ts content/seed/week_03_04.json`. Not an executor decision.
6. **The two `CLAUDE.md` files have drifted.** The project-root copy carries four rules the
   in-repo `ielts-daily/CLAUDE.md` does not: the provider-agnostic AI rule, the
   `content/raw` + `content/staged` git-ignore rule, "AI-extracted content is never
   auto-inserted", and the Phase 04 mechanical-normalization exception. Worth syncing.

## Verification debt — the browser walk-through

**Six phases old, and now scheduled against production instead.** The Chrome extension
returns "Frame with ID 0 is showing error page" on the dev server — this session on port
**3001**, since something unrelated is occupying 3000 and returning 500 — exactly as it
did on 3000 in every previous phase. The user chose to verify on the live Vercel URL
instead. Everything below is verified one layer down (live DB, fixtures, server-rendered
markup, `tsc`, `next build`); what is unverified is that the pages paint and the buttons
wire up.

- **Phase 06 (do this first, on production):** `/dashboard` renders the six totals, three
  skill sections and the weakness table; listening shows its empty state; hovering a bar
  shows date/title/source; `/bank/writing-t2-university-fees` lists one attempt and the
  row expands to the full stored feedback; submitting an essay shows "Grading Ns · usually
  30–90 seconds" with the number moving; the criteria cards show the quoted errors and any
  "Capped at 6.0" note.
- Phases 01–05: the earlier walk-through list is preserved in `memory/phase_05_report.md`
  and the Phase 05 STATE (`/` → Unit 01 → complete → Unit 02; timer auto-submit; `/bank`
  run and explanation; heatmap and streak; `/vocab` deck; the writing panels and the
  under-50-word refusal).

**Note:** the Vocab step is now reachable — 6 units are complete, so the words belonging to
unit 2 are behind a completed unit rather than a locked one.

## Considered and accepted by the user — do NOT re-raise as action items

- **Token `sbp_601a…` was pasted into the Phase 00 chat and will not be rotated.**
- The expired tokens in `~/.claude.json` need nothing — dead config.
- **Public signups are now DISABLED** (confirmed 2026-08-18). This supersedes the earlier
  "signups stay enabled, known and accepted" entry: that was decided while the app was
  localhost-only, and `authenticated_all` RLS makes it unacceptable once the app is on the
  internet. Do not re-enable them.

## Known content gaps to raise with the planning model

- **No multi-select question type.** "Choose TWO letters … IN EITHER ORDER" prints one key
  for a *pair* of questions and cannot be represented. Blocks `…-p7` and any full paper.
- **Diagram Label Completion cannot be represented either**, and the extraction model
  invents keys rather than refusing.
- **Writing tasks cannot be ingested from a PDF** — the staged shape has no field for
  `task_type` / `min_words` / `prompt_md`, so the validator refuses a staged writing test.
- **No writing unit references a writing test yet.** The three tasks are bank-only.
- **No listening test exists at all**, which is why the dashboard's listening section is
  permanently empty.

## Next action

**Finish the deployment.** Once the production URL exists: confirm it serves `/login`,
sign in as the real user, complete one objective bank run and one graded essay end-to-end,
and confirm the plan accepts `maxDuration = 300` (it is the Fluid-compute maximum on
Hobby; classic Hobby rejects anything above 60 and the value must come down). Then record
the URL in README §5 and commit.

The original plan ends with Phase 06. The taper-readiness view was deliberately deferred
to a pre-mock mini-phase, which needs mock data that does not exist yet.
