# Phase 06 report — grader calibration, dashboard, attempt history, deployment

**Executed:** 2026-08-18. Task file: `tasks/phase_06_dashboard_deploy.md`.

## Done

### Step 0a — grader calibration (rubric v2 + the code-enforced LR clamp)

**The rubric prompt was amended in place**, not replaced. Three changes, in the order the
ruling specified:

1. **Evidence before banding.** The prompt now opens the criteria block with "Work in this
   order, for every criterion: FIRST list the specific evidence you find in the essay,
   THEN apply the descriptor to what you listed. Never choose a band first and look for
   evidence to justify it afterwards." The response schema puts `"errors"` before
   `"band"` in every criterion object, so the model generates the inventory before the
   number.
2. **Per-criterion `errors: string[]`**, with what belongs in each list spelled out — LR
   takes spelling/word-form/misused words, GRA faulty sentences or clauses, CC mechanical
   connectors, TR a sentence that itself goes off task. Empty arrays are allowed and named
   as the right answer when nothing was found.
3. **The four evidence-tied caps stated verbatim**: ≥3 spelling/word-form errors → LR ≤ 6.0;
   a mechanical Firstly/Secondly/Moreover chain → CC ≤ 6.5; errors in more than roughly a
   third of sentences → GRA ≤ 6.0; any unaddressed task part → TR ≤ 5.0.

**Code enforcement.** `validateFeedback` now runs `filterVerbatimErrors` over each
criterion's `errors` — the same argument as `improvedSentences`, that a quote the
candidate did not write is a fabrication — dropping anything that is not a literal
substring of the essay, collapsing exact duplicates, and capping each list at 10. Then
`applyLexicalResourceCap` clamps LR to 6.0 when **three or more surviving** errors sit
under a band above 6.0, and does it **before** `computeOverallBand` takes the mean, so the
overall follows the clamp down. `WritingCriterion` gained `errors: string[]` and
`capped: boolean`; `capped` is set only by the code, and both the review panel and the
stored `ai_feedback_md` say so in words — a clamped band is never passed off as the
examiner's judgement.

The `"AI estimate ±0.5"` label is untouched.

### Step 0a item 3 — the live re-grade, old vs new

The **same 286-word sample essay** from `scripts/check_writing_db.ts`, same task, same
provider, run against the live model with rubric v2:

| | TR | CC | LR | GRA | **Overall** |
| --- | --- | --- | --- | --- | --- |
| **v1 (Phase 05)** | 7.0 | 7.0 | 6.5 | 6.5 | **7.0** |
| **v2 (Phase 06)** | 7.0 | 6.5 | 6.0 | 6.5 | **6.5** |

**The overall moved down half a band.** Soft check, reported not asserted, as the ruling
required. What is worth reading in it:

- **The model applied the CC cap itself**, and named its evidence: it quoted `"Firstly,"`,
  `"Secondly,"` and `"Moreover,"` and wrote that the mechanical chain "limits the band to
  6.5".
- **The LR drop was the model's own too, not the clamp.** Only two LR errors survived the
  verbatim filter (`"beleive"`, `"more fair"`), which is below the threshold — and the
  model said so explicitly: *"With two errors, the '3 or more' cap is not triggered, but
  the presence of errors in a short essay prevents a 7.0 for precision."* That is the
  rubric being reasoned with rather than skimmed. The code clamp did not fire on this
  essay; the fixture is what proves it works.
- **The error inventory after filtering:** TR 0, CC 3, LR 2, GRA 3 — every quote a literal
  substring of the essay.
- 18.3 s, one model call, ~2,520 tokens (~1,633 in / ~888 out). Slightly more than v1's
  ~2,100 — the inventory is the difference.

### Step 0b — the wait UX

`AiWait` in `PracticePanels.tsx` (beside `CountdownPill`, so both players share it) counts
elapsed seconds from `Date.now()` — not from tick count, because a background tab throttles
`setInterval` and an under-reported wait is worse than none — and prints the expectation
beside it. Two wordings, exported as constants so the two call sites cannot drift:
`GRADING_WAIT` ("Grading 23s · usually 30–90 seconds") and `EXPLAIN_WAIT` ("Thinking 8s ·
usually under 30 seconds"). Wired into the `UnitSession` footer, the `BankSession` footer
and the `ExplainMyAnswer` button. It is mounted only while the call is running, which is
what resets it. No spinner library, no streaming, no new dependency.

### `src/lib/dashboard.ts`

Built to the locked contract. Every function that decides a number is pure and exported;
the `get*` functions are the I/O around them.

- **`getSkillTrajectory(skill)`** — submitted attempts, oldest first, both sources
  labelled. `accuracyPct` is null for essays rather than 0 (a band-7 essay drawn at the
  floor would be a lie); `band` comes from `rawToBand` for objective attempts, which
  returns null off a 40-question paper, and from `band_estimate` for essays.
- **`getQTypeBreakdown()`** — **re-grades through the existing `gradeAnswers`**. There is
  no comparison logic in this module at all: it hands stored answers and stored keys to
  the player's grader and counts what comes back, so normalization, the whitespace rule
  and accepted variants have exactly one definition. Weakest first, ties broken by how
  much data is behind them.
- **`getTotals()`** — `study_log` for the roadmap numbers, `attempts` for the essay ones.
- **`getTestAttempts(testId)`** — added for the `/bank/[slug]` history (see Decisions).
- **`computeLongestStreak`** added beside `computeStreak` in `stats.ts`, and
  **`dayOfInstant`** added to `day.ts` — `submitted_at` is an instant, and slicing its ISO
  string would file anything submitted before 07:00 local under the previous day.

### The views

`/dashboard` (server component, no state): a six-number totals row, three skill sections,
and the question-type table. `TrajectoryChart` draws divs and design tokens like
`StudyHeatmap` — one scale per section (writing as a band out of 9, reading and listening
as accuracy %, because mixing them inside one row of bars would make band 6.5 look shorter
than 70% and mean nothing), roadmap bars solid and bank bars at 38% of the same colour,
every bar carrying a `title=` with its date, test, value and source. `QTypeTable` marks any
row under five answers **"low data"** and greys it rather than colouring it, because a
colour is a verdict and a 0/1 is a sample size. Every skill and the table have real empty
states. A **Dashboard** tab was added to `AppHeader`.

`/bank/[slug]` gained `AttemptHistory` below the practice card, newest first, rendering
`attempts.ai_feedback_md` through the existing `MarkdownWithTables` when an essay row is
expanded. Nothing re-parses feedback JSON or re-derives a band — that is what the column is
for. There is no delete and no edit.

### Deployment

`maxDuration = 300` is exported from `src/app/unit/[seq]/page.tsx` and
`src/app/bank/[slug]/page.tsx`. A server action runs in the function serving its own route
segment, so the limit belongs on those pages, not on the `"use server"` files; without it
Vercel's default would abort a request mid-grade and show a failure for work the provider
actually did. README gained a **§5 Deployment** section covering the production URL, the
env-var table with which values are needed at build time versus runtime, why
`SUPABASE_SERVICE_ROLE_KEY` is deliberately absent from Vercel, the fact that changing an
env value needs a redeploy, and that `git push` to `main` deploys.

## Verification

- **`npm run check` is green**, now six scripts: grading, SRS, split, heatmap/streak,
  writing, **dashboard**.
- **The LR-clamp fixture passes.** LR 7.0 with three verbatim errors → 6.0, `capped: true`,
  and the overall mean follows 6.5 → 6.0; the identical bands *without* the errors keep LR
  at 7.0 and the overall at 6.5. Also pinned: two errors do not trigger it; three where one
  is invented do not (the filter drops it first); the same quote three times counts once;
  LR already at 5.5 is not raised; LR exactly at 6.0 is not marked capped; and three
  verbatim errors on **CC** do not cap it, because that rule is prompt-level.
- **`scripts/check_dashboard.ts`** (in `npm run check`): 60-odd cases over the longest
  streak, the trajectory selection rules including the Ho Chi Minh City timezone boundary,
  the breakdown math, and server-rendered markup for `TrajectoryChart`, `QTypeTable` and
  `AttemptHistory`. Three of the breakdown cases pass *only* because the comparison is
  `gradeAnswers`'s — an accepted variant, a case/padding difference, a whitespace-only
  answer — so a second grading implementation appearing in `dashboard.ts` would fail them.
- **`scripts/check_dashboard_db.ts`** (new, live, read-only, spends no tokens): mirrors the
  library's PostgREST calls through the admin client, drives the real pure functions, and
  renders the real components against the live rows.

### Definition of Done, item by item

- **Live breakdown reconciled against a hand count** — the hand count is computed in
  `check_dashboard_db.ts` from the raw rows **without** `gradeAnswers`, and separately in
  SQL with its own normalization. All three agree exactly:

  | question type | library | hand count | SQL |
  | --- | --- | --- | --- |
  | matching | 0/4 (0%) | 0/4 | 0/4 |
  | gap_fill | 7/9 (77.8%) | 7/9 | 7/9 |
  | tfng | 5/5 (100%) | 5/5 | 5/5 |
  | mcq | 4/4 (100%) | 4/4 | 4/4 |

  **The two numbers the DoD asks for: 16 correct out of 22 answered, against a stored
  `score_raw` sum of 18.** They differ by 2, and that is the re-grading property working
  rather than a defect — see Discovery 1 below.
- **`/dashboard` against live data** — totals `{unitsCompleted: 6, totalMinutes: 360,
  currentStreak: 1, longestStreak: 1, essaysGraded: 1, avgWritingBand: 6.5}`. `unitsCompleted`
  matches the `study_log` sum **and** cross-checks against the `unit_completions` row count
  (6 = 6). The writing section shows the one graded essay; **listening renders its empty
  state** ("no listening tests in the bank, so nothing here is waiting on you") and draws
  zero bars.
- **`/bank/writing-t2-university-fees` history** — one row, band 6.5, expandable, and
  asserted collapsed-until-asked-for (the stored feedback is absent from the initial
  markup).
- **`process.env` still appears only in `src/lib/config.ts`.** No new dependency:
  `package.json`'s dependency list is unchanged. `npx tsc --noEmit`, `npm run lint` and
  `npm run build` are all clean.
- **Repo pushed.** `origin/main` was still at `068e763` (Phase 01) — the local Phase 02–04
  commit had never been pushed either. Now at **`7a56c45`**.

### Pre-flight checklist

1. **`.env*` git-ignored** — confirmed with `git check-ignore -v`: `.gitignore:34 .env*`
   catches `.env.local`, and lines 46–47 catch `content/raw/` and `content/staged/`. The
   staged diff was scanned for key material before committing; the only two hits were a
   already-redacted token reference in `STATE.md` and an env-var *name* in the task file.
2. **Supabase public signups disabled** — **confirmed by the user**, 2026-08-18. This
   reverses the "considered and accepted" entry in the Phase 05 STATE.md, correctly: that
   decision was taken while the app was localhost-only, and `authenticated_all` RLS means
   any account creatable on the public internet gets full read/write on every table.
3. **The single user exists** — `auth.users` has exactly 1 row, confirmed.
4. **`npm run build` clean** — yes.

### What is NOT verified yet

**The production deployment itself.** The user is creating the Vercel project through the
web UI and entering the env values there; the URL was not available at the time of writing.
Outstanding DoD items: production `/login` redirect, sign-in, one objective bank run and
one graded essay end-to-end on the production URL, and confirmation that `maxDuration = 300`
is accepted by the plan (it is the Fluid-compute maximum on Hobby; if the project is on
classic Hobby the build will reject anything above 60 and the value must come down).

**The browser walk-through, for a sixth phase.** The Chrome extension still returns "Frame
with ID 0 is showing error page" on the dev server — this session it was on port **3001**,
because something unrelated is occupying 3000, and it failed identically. The user chose to
verify in production instead. Everything in this phase is therefore verified one layer down:
live database, fixtures, server-rendered markup of every new component, `tsc`, `lint`,
`next build`.

## Decisions made

- **One commit for Phases 05 and 06, not two.** Six files carry changes from both phases
  (`writing.ts`, `check_writing.ts`, `check_writing_db.ts`, `PracticePanels.tsx`,
  `UnitSession.tsx`, `BankSession.tsx`), so a split would have needed patch-level staging
  and produced two commits that neither build nor bisect honestly. Phase 05 was never
  committed separately in the first place. The message says exactly what the commit
  contains. History was not rewritten.
- **`getTestAttempts` lives in `dashboard.ts`, not `tests.ts`.** It is a progress/history
  read, which is what that module is; `tests.ts` stays about playing and grading a test.
- **Attempt history is passed into `BankSession` as a prop and rendered only in the intro
  phase.** During a timed run the last thing that helps is a table of previous scores, and
  after submitting, the review *is* the result. Refreshing the page refreshes the list.
- **`attempted` counts answered occurrences, not presented ones.** A blank is usually the
  clock running out, and folding blanks into "matching is 40% accurate" would report a
  pacing problem as a comprehension one. Stated in the module docstring, on the page, and
  fixtured both ways.
- **`WritingCriterion` gained `capped: boolean`.** Not in the ruling's JSON shape — it is
  set by code, never by the model. Without it a clamped 6.0 is indistinguishable from a
  chosen 6.0, and a cap the user cannot see is a cap they cannot argue with.
- **Errors are deduplicated and capped at 10 per criterion.** Deduplication makes the
  clamp *less* likely to fire, which is the conservative direction for a mechanism whose
  job is to stop over-scoring; quoting `beleive` three times is one error.
- **`QTYPE_LABEL` added to `labels.ts`.** Standard names for question task types, not IELTS
  content — no question, key or strategy text is involved.
- **`SUPABASE_SERVICE_ROLE_KEY` is recommended *out* of the Vercel environment**, contrary
  to the task file's env list. Nothing under `src/` imports `supabase/admin.ts` — the
  service-role client has zero importers outside `scripts/`, which never run on Vercel — so
  including it would put a key that bypasses RLS in the deployed environment for no
  functional gain.
- **Two leftover `attempts` rows from this session's live check were left in place**, at the
  user's choice: one abandoned empty attempt and one graded essay (band 6.5) on the check
  script's sample text. They are what makes the writing trajectory and the Task 2 attempt
  history non-empty for verification. They are executor-created test data, not the user's
  own work, and the report says so.

## New findings

Three Moderate discoveries, all logged in `memory/discoveries.md`, all self-resolved.
**No Major. No `docs/plan.md` change is required.**

1. **Re-grading on read can disagree with the stored `score_raw`** (16 vs 18). Two answers
   were submitted in the slash-joined form the printed key used, and Phase 04's authorized
   key split later made that form non-matching. `score_raw` is the score at submission
   time; the breakdown is the score against today's key. Both are correct; they are not
   interchangeable, and the live check prints both and names every answer responsible.
2. **The verbatim-in-essay filter cannot hold TR's evidence** — an unaddressed task part has
   nothing in the essay to quote. The filter was kept exactly as specified and the prompt
   was written around it: TR carries a missing task part in its comment, not in `errors`.
   Nothing is lost mechanically, since only LR's cap is code-enforced.
3. **Only one of the four caps is reliably self-applied.** The live run showed the model
   applying CC's cap correctly and with evidence, reasoning correctly about LR's threshold,
   and then invoking GRA's cap by name while awarding 6.5 where the stated cap is 6.0. The
   inventory is the mitigation: the user can see the three sentences it based that on.

## Open issues

1. **The production deployment is not finished** — the Vercel project is being created by
   the user; the URL, the production verification and the confirmed `maxDuration` are the
   remaining DoD items.
2. **Browser verification, now six phases old.** The extension cannot reach the dev server
   on either 3000 or 3001. Production may work where localhost does not.
3. **The four carried-over Phase 04 items are still untouched**: the renamed bank tests to
   confirm, `…-p13` (fabricated keys) and `…-p7` (multi-select) still staged and
   uncommitted, and the two drifted `CLAUDE.md` files.
4. **Weeks 3–4 (units 13–24) are still authored but not seeded.**
5. **Something unrelated is listening on port 3000** and returning 500. Not this project —
   `npm run dev` moved itself to 3001.

## Input for next phase

- **`src/lib/dashboard.ts` is the only progress-reporting module**, and its pure halves
  (`buildTrajectory`, `buildQTypeBreakdown`, `buildTotals`) are where the rules live.
  Anything that needs a new figure adds a pure function there and fixtures it in
  `scripts/check_dashboard.ts`.
- **The question-type breakdown re-grades through `gradeAnswers` and must keep doing so.**
  The moment a second comparison rule appears in `dashboard.ts`, three fixtures fail — that
  is deliberate.
- **There are now two definitions of "how many did I get right"** and any new figure must
  say which it uses: as recorded (`score_raw`, the trajectory) or against the current key
  (the breakdown).
- **`day.ts` gained `dayOfInstant`** and it is the only way to turn a `timestamptz` into a
  calendar day. `today()` is now that function applied to now.
- **`WritingCriterion` has two more fields** — `errors` and `capped`. Anything constructing
  one (fixtures included) must supply both, and anything displaying a band should show
  `capped` with it.
- **`AiWait` + `GRADING_WAIT` / `EXPLAIN_WAIT` in `PracticePanels.tsx`** are the pattern for
  any future long model call. Mount it only while the call runs.
- **`maxDuration` lives on the page segment, not the `"use server"` file.** Any new route
  that owns an AI server action needs its own export.
- **The taper-readiness view is still deferred** to a pre-mock mini-phase, as the task file
  specified — it needs mock data to feed it, and there is none.
