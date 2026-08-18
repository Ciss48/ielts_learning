# Phase 06: Grader calibration + dashboard + attempt history + deployment

## Context Recap
IELTS Daily (see `docs/plan.md`). Phase 05 delivered essay grading and
explain-my-answer; the bank stands at 14 tests. Read `memory/phase_05_report.md`
— especially "Input for next phase" — and the [Phase 05] discoveries. Known
facts this phase builds on: `ai_feedback_md` is the display format for essay
history; `score_raw IS NULL AND band_estimate IS NOT NULL` identifies essay
attempts; `unit_id IS NULL` identifies bank practice; per-question results are
NOT persisted but are recomputable from stored `answers` + `questions` via the
pure `gradeAnswers`. This is the last phase of the original plan: it fixes the
grader's calibration, gives the user visibility into their progress, and puts
the app on the internet so daily study stops depending on a dev server.

## Goal
An honest essay grader, a `/dashboard` showing skill trajectories and
question-type weaknesses, per-test attempt history in `/bank`, and the app
live on Vercel behind the existing login.

## Non-goals
- No taper-readiness view (deferred to a pre-mock mini-phase, when mock data
  exists to feed it). No multi-select (Phase 4b). No streaming responses.
- No chart library and no new dependencies — bars and sparklines are divs with
  design tokens, like the heatmap.
- No schema changes: the question-type breakdown is computed by re-grading
  stored answers on read, never by persisting per-question results.
- No changes to `completeUnit`, the pointer, SRS, or objective grading logic.
- Deployment adds NO new features: same app, same single user, production env.

## Step 0 — carry-overs (do these first)

### (a) Grader calibration — ARCHITECT RULING
Phase 05's live run graded a 286-word essay containing spelling errors and
mechanical linking at 7.0. The comments were accurate; the numbers ran a band
high. Fix at two layers:
1. **Rubric prompt v2** (amend the Phase 05 Appendix prompt in place):
   - Each criterion's JSON gains `"errors": string[]` — verbatim quotes of the
     specific errors found for that criterion (spelling/word-form quotes for
     LR, faulty sentences for GRA, mechanical linkers for CC, unaddressed task
     parts for TR). Empty array allowed. Listing comes BEFORE banding in the
     prompt's instructed order: find evidence first, then apply the descriptor.
   - Evidence-tied caps, stated in the prompt: ≥3 spelling/word-form errors →
     LR ≤ 6.0; cohesion carried by a mechanical Firstly/Secondly/
     Moreover-style chain → CC ≤ 6.5; errors in more than roughly a third of
     sentences → GRA ≤ 6.0; any part of the task unaddressed → TR ≤ 5.0
     (under-length already caps TR ≤ 5.0).
2. **Code enforcement where countable** (`writing.ts` validation layer): apply
   the same verbatim-in-essay filter to `errors` entries; then if LR's
   surviving `errors` count ≥ 3 and LR band > 6.0, clamp LR to 6.0 before the
   overall mean (the one cap code can enforce mechanically; the others stay
   prompt-level). Fixture: a mocked response with LR 7.0 + three verbatim
   errors clamps to 6.0 and moves the overall mean accordingly.
3. Re-run the SAME 286-word sample from `check_writing_db.ts` against the live
   model and report old vs new numbers (soft check — report, don't assert).
The "AI estimate ±0.5" label stays regardless.

### (b) Grading-wait UX
The grade takes 26–94 s with a static "Grading…" button. Show elapsed seconds
and a one-line expectation ("usually 30–90 seconds") while waiting, for both
essay grading and explain-my-answer. No streaming, no spinner library.

## Interface Contract

### `src/lib/dashboard.ts` (server-only; pure halves fixture-tested)
```ts
export interface TrajectoryPoint {
  attemptId: string; date: string;          // Asia/Ho_Chi_Minh day via day.ts
  testTitle: string; source: 'roadmap' | 'bank';
  accuracyPct: number | null;               // objective attempts
  band: number | null;                      // 40-q papers via rawToBand, or essay band_estimate
}
export async function getSkillTrajectory(
  skill: 'reading' | 'listening' | 'writing'
): Promise<TrajectoryPoint[]>;              // submitted attempts only, oldest first

export interface QTypeBreakdown {
  qtype: string; attempted: number; correct: number; accuracyPct: number;
}
export async function getQTypeBreakdown(): Promise<QTypeBreakdown[]>;
// Re-grades every submitted objective attempt's stored answers against its
// questions using the existing pure gradeAnswers — one implementation of
// grading, everywhere. Counts every answered occurrence (a question attempted
// twice counts twice). Sorted weakest first.

export interface Totals {
  unitsCompleted: number; totalMinutes: number;
  currentStreak: number; longestStreak: number;
  essaysGraded: number; avgWritingBand: number | null;   // mean of band_estimate, 0.1 precision
}
export async function getTotals(): Promise<Totals>;
```
`longestStreak` extends `stats.ts`'s pure streak logic (add
`computeLongestStreak` beside `computeStreak`; fixture it). Roadmap vs bank:
trajectories INCLUDE both but label the source; the breakdown and totals use
ALL submitted attempts (a weakness is a weakness wherever it shows), except
`unitsCompleted`/`totalMinutes` which come from `study_log` (roadmap-only by
construction).

### `/dashboard` page (+ "Dashboard" tab in AppHeader)
- Totals row (the six numbers above).
- Three skill sections: per-attempt bars (accuracy % height or band) in a
  horizontal timeline built from divs + tokens, each bar tooltipped with
  date/title/source, bank-practice bars visually muted vs roadmap.
- Question-type table, weakest first, accuracy bar per row; rows with
  `attempted < 5` marked "low data" rather than screaming red.
- Empty states for skills with no attempts yet (listening will be empty).

### `/bank/[slug]` attempt history
Below the practice card: this test's submitted attempts, newest first — date,
score fraction + accuracy (objective) or band estimate (essay); an essay row
expands to render its stored `ai_feedback_md` (react-markdown + the existing
hand-rolled table lift). No delete/edit.

### Deployment (Vercel)
1. Pre-flight checklist, verified and stated in the report: `.env*` git-ignored
   (still), Supabase **public signups disabled** (ask the user to confirm in
   the dashboard — do not proceed to DNS/sharing advice while that is open),
   the single user exists, `npm run build` clean.
2. Vercel project from the repo; set env vars (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_BASE_URL`,
   `AI_API_KEY`, `AI_MODEL`, and the `R2_*` set) — values entered by the USER
   in the Vercel UI, never pasted into chat.
3. Confirm: production URL loads → redirects to `/login`; after login, Today
   renders; one bank practice submits and grades in production; essay grading
   works within Vercel's function timeout — if the 26–94 s grade exceeds the
   plan's limit, raise `maxDuration` for that route/action per Vercel config
   and record the value chosen.
4. Document in README: the production URL, how env changes are applied, and
   that `git push` to main deploys.
**Git gate:** deployment requires the repo pushed to a remote. `main` is at
Phase 01 with four phases uncommitted — committing (locally and to the remote
the user chooses) is a prerequisite step of this phase, not optional hygiene.
Commit granularity is the user's/your judgment; do not rewrite history.

## Steps
1. Step 0 (a) calibration + (b) wait UX; fixtures updated; live re-grade
   comparison recorded.
2. `dashboard.ts` pure halves + fixtures (`check_dashboard.ts` into
   `npm run check`): breakdown math from synthetic attempts, longest streak,
   trajectory band/accuracy selection rules.
3. `/dashboard` page + header tab; `/bank/[slug]` history.
4. Git commit + push (with the user), then the Vercel deployment flow.
5. DoD; report.

## Definition of Done
- `npm run check` green including the new dashboard fixtures and the LR-clamp
  writing fixture.
- Live: `getQTypeBreakdown()` totals reconcile against a hand-computed count
  from the current `attempts` table (state both numbers in the report).
- `/dashboard` renders with the live data: totals match `study_log` sums;
  writing section shows the graded essays; listening shows its empty state.
- `/bank/writing-t2-university-fees` shows its attempt history; an essay row
  expands to the full stored feedback.
- Calibration: the mocked LR-clamp fixture passes; the live re-run of the
  Phase 05 sample essay is reported old-vs-new.
- Production: the Vercel URL serves `/login`, authenticates the real user,
  completes one objective bank run and one graded essay end-to-end; the chosen
  `maxDuration` (if any) is recorded; `process.env` still only in `config.ts`.
- Repo pushed; the deployed commit hash is in the report.

## Handoff Obligations
1. Write `memory/phase_06_report.md`.
2. Overwrite `memory/STATE.md` (replace, don't append).
3. Log Moderate/Major findings in `memory/discoveries.md`; STOP on Major.
