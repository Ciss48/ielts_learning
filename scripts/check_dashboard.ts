/**
 * Fixture check for the dashboard's arithmetic.
 *
 *   npx tsx scripts/check_dashboard.ts
 *
 * No database and no clock. `buildTrajectory`, `buildQTypeBreakdown` and
 * `buildTotals` take their rows as arguments precisely so the cases that decide
 * what a number means — an essay that has no fraction, a 13-question set that
 * has no band, a blank answer, the same question sat twice, a timestamp that
 * falls on a different calendar day in Ho Chi Minh City than in UTC — can be
 * pinned here rather than waited for.
 *
 * The property this file exists to protect: **the breakdown re-grades through
 * `gradeAnswers`**, the player's own grader. Several cases below are really
 * assertions about that — an accepted variant, a case difference, a
 * whitespace-only answer — and they pass only because no second comparison rule
 * was written in `dashboard.ts`.
 *
 * Exits 0 on pass, 1 naming every failing case.
 */

import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildQTypeBreakdown,
  buildTotals,
  buildTrajectory,
  type AttemptForBreakdown,
  type AttemptForTrajectory,
} from "../src/lib/dashboard";
import { computeLongestStreak, type StudyLogRow } from "../src/lib/stats";
import { AttemptHistory } from "../src/components/AttemptHistory";
import { QTypeTable } from "../src/components/dashboard/QTypeTable";
import { TrajectoryChart } from "../src/components/dashboard/TrajectoryChart";

// tsx compiles .tsx with the classic JSX runtime, which emits bare
// `React.createElement`. Next injects that import itself; a plain script has to.
(globalThis as unknown as { React: typeof React }).React = React;

const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

function ok(name: string, condition: boolean, detail: string): void {
  if (!condition) failures.push(`${name}\n    ${detail}`);
}

// --- longest streak -----------------------------------------------------------
// `computeStreak` answers "am I on a run now" and is allowed to end yesterday.
// This one is a personal best: it never expires and does not know what day it is.

const days = (...list: string[]) => new Set(list);

check("longest: an empty log", computeLongestStreak(days()), 0);
check("longest: a single day is one", computeLongestStreak(days("2026-08-17")), 1);
check(
  "longest: a run of three",
  computeLongestStreak(days("2026-08-15", "2026-08-16", "2026-08-17")),
  3,
);
check(
  "longest: the best run, not the current one",
  computeLongestStreak(
    days("2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-08-17"),
  ),
  4,
);
check(
  "longest: a gap splits a run",
  computeLongestStreak(days("2026-08-10", "2026-08-11", "2026-08-13", "2026-08-14")),
  2,
);
check(
  "longest: a run counts across a month boundary",
  computeLongestStreak(days("2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02")),
  4,
);
check(
  "longest: insertion order does not matter",
  computeLongestStreak(days("2026-08-17", "2026-08-15", "2026-08-16")),
  3,
);
check(
  "longest: a leap day is a normal day",
  computeLongestStreak(days("2028-02-28", "2028-02-29", "2028-03-01")),
  3,
);

// --- trajectories -------------------------------------------------------------

function attempt(
  overrides: Partial<AttemptForTrajectory> = {},
): AttemptForTrajectory {
  return {
    attemptId: "a1",
    submittedAt: "2026-08-17T04:00:00.000Z",
    unitId: "u1",
    skill: "reading",
    testTitle: "A reading test",
    scoreRaw: 9,
    scoreTotal: 13,
    bandEstimate: null,
    ...overrides,
  };
}

const objective13 = buildTrajectory([attempt()], "reading")[0];
check("trajectory: accuracy on a 13-question set", objective13.accuracyPct, 69.2);
// The published tables only define a band for a 40-question paper, and a
// proportional band on a practice set would be invented.
check("trajectory: no band on a 13-question set", objective13.band, null);
check("trajectory: a unit_id makes it roadmap practice", objective13.source, "roadmap");

const objective40 = buildTrajectory(
  [attempt({ scoreRaw: 30, scoreTotal: 40, unitId: null })],
  "reading",
)[0];
check("trajectory: accuracy on a full paper", objective40.accuracyPct, 75);
check("trajectory: 30/40 reading is band 7.0", objective40.band, 7);
check("trajectory: a null unit_id is bank practice", objective40.source, "bank");

const essay = buildTrajectory(
  [
    attempt({
      skill: "writing",
      scoreRaw: null,
      scoreTotal: null,
      bandEstimate: 6.5,
      testTitle: "Task 2: university fees",
    }),
  ],
  "writing",
)[0];
// A band-7 essay drawn as a bar at 0% would be a lie, so accuracy is null and
// the writing section plots bands instead.
check("trajectory: an essay has no accuracy", essay.accuracyPct, null);
check("trajectory: an essay's band is the stored estimate", essay.band, 6.5);

check(
  "trajectory: an objective writing test gets no band either",
  buildTrajectory([attempt({ skill: "writing", scoreRaw: 4, scoreTotal: 5 })], "writing")[0]
    .band,
  null,
);
check(
  "trajectory: a zero total does not divide by zero",
  buildTrajectory([attempt({ scoreRaw: 0, scoreTotal: 0 })], "reading")[0].accuracyPct,
  null,
);

check(
  "trajectory: only the requested skill",
  buildTrajectory(
    [
      attempt({ attemptId: "r", skill: "reading" }),
      attempt({ attemptId: "l", skill: "listening" }),
      attempt({ attemptId: "w", skill: "writing", scoreRaw: null, bandEstimate: 6 }),
    ],
    "listening",
  ).map((point) => point.attemptId),
  ["l"],
);
check(
  "trajectory: listening with nothing sat is empty, not absent",
  buildTrajectory([attempt({ skill: "reading" })], "listening"),
  [],
);
check(
  "trajectory: oldest first, whatever order the rows arrive in",
  buildTrajectory(
    [
      attempt({ attemptId: "c", submittedAt: "2026-08-17T04:00:00.000Z" }),
      attempt({ attemptId: "a", submittedAt: "2026-06-01T04:00:00.000Z" }),
      attempt({ attemptId: "b", submittedAt: "2026-07-04T04:00:00.000Z" }),
    ],
    "reading",
  ).map((point) => point.attemptId),
  ["a", "b", "c"],
);

// The timezone rule, which is the whole reason `dayOfInstant` exists: an attempt
// submitted at 23:30 UTC on the 17th happened on the 18th in Ho Chi Minh City
// (UTC+7), and slicing the ISO string would file it under the wrong day.
check(
  "trajectory: a late-evening UTC instant is the NEXT day in Ho Chi Minh City",
  buildTrajectory([attempt({ submittedAt: "2026-08-17T23:30:00.000Z" })], "reading")[0]
    .date,
  "2026-08-18",
);
check(
  "trajectory: an afternoon UTC instant is the SAME day",
  buildTrajectory([attempt({ submittedAt: "2026-08-17T16:30:00.000Z" })], "reading")[0]
    .date,
  "2026-08-17",
);
check(
  "trajectory: an early-morning local session is not backdated",
  // 00:30 on the 18th in HCM is 17:30 UTC on the 17th.
  buildTrajectory([attempt({ submittedAt: "2026-08-17T17:30:00.000Z" })], "reading")[0]
    .date,
  "2026-08-18",
);

// --- question-type breakdown ---------------------------------------------------

const TFNG_KEYS = [
  { qnum: 1, qtype: "tfng" as const, answerKey: ["TRUE"] },
  { qnum: 2, qtype: "tfng" as const, answerKey: ["FALSE"] },
  { qnum: 3, qtype: "tfng" as const, answerKey: ["NOT GIVEN"] },
];
const MATCHING_KEYS = [
  { qnum: 4, qtype: "matching" as const, answerKey: ["A"] },
  { qnum: 5, qtype: "matching" as const, answerKey: ["B"] },
];

const oneAttempt: AttemptForBreakdown = {
  answers: { 1: "TRUE", 2: "TRUE", 3: "NOT GIVEN", 4: "A", 5: "A" },
  questions: [...TFNG_KEYS, ...MATCHING_KEYS],
};

check("breakdown: two types, counted separately", buildQTypeBreakdown([oneAttempt]), [
  { qtype: "matching", attempted: 2, correct: 1, accuracyPct: 50 },
  { qtype: "tfng", attempted: 3, correct: 2, accuracyPct: 66.7 },
]);
ok(
  "breakdown: weakest first",
  buildQTypeBreakdown([oneAttempt])[0].qtype === "matching",
  "the strongest type came first",
);

// A blank is usually the clock running out, not a comprehension failure, so it
// is not counted at all — `attempted` is answered-occurrences.
check(
  "breakdown: an unanswered question is not counted",
  buildQTypeBreakdown([
    { answers: { 1: "TRUE" }, questions: TFNG_KEYS },
  ]),
  [{ qtype: "tfng", attempted: 1, correct: 1, accuracyPct: 100 }],
);
check(
  "breakdown: a whitespace-only answer is unanswered",
  buildQTypeBreakdown([
    { answers: { 1: "TRUE", 2: "   ", 3: "\t\n" }, questions: TFNG_KEYS },
  ]),
  [{ qtype: "tfng", attempted: 1, correct: 1, accuracyPct: 100 }],
);
check(
  "breakdown: no answers at all yields no rows, not a zero row",
  buildQTypeBreakdown([{ answers: {}, questions: TFNG_KEYS }]),
  [],
);
check("breakdown: no attempts at all", buildQTypeBreakdown([]), []);

// Sitting the same paper twice counts twice: a weakness that survives a retry
// is a real one, and averaging the two attempts would hide it.
check(
  "breakdown: the same question sat twice counts twice",
  buildQTypeBreakdown([
    { answers: { 1: "TRUE", 2: "FALSE", 3: "NOT GIVEN" }, questions: TFNG_KEYS },
    { answers: { 1: "FALSE", 2: "FALSE", 3: "TRUE" }, questions: TFNG_KEYS },
  ]),
  [{ qtype: "tfng", attempted: 6, correct: 4, accuracyPct: 66.7 }],
);

// These three pass only because the comparison is `gradeAnswers`'s. If a second
// implementation ever appears in dashboard.ts, this is where it shows up.
check(
  "breakdown: grading is the player's — case and padding are normalized",
  buildQTypeBreakdown([
    { answers: { 1: "  true  ", 2: "False", 3: "not   given" }, questions: TFNG_KEYS },
  ]),
  [{ qtype: "tfng", attempted: 3, correct: 3, accuracyPct: 100 }],
);
check(
  "breakdown: an accepted variant is accepted here too",
  buildQTypeBreakdown([
    {
      answers: { 9: "20 minutes" },
      questions: [{ qnum: 9, qtype: "gap_fill", answerKey: ["twenty minutes", "20 minutes"] }],
    },
  ]),
  [{ qtype: "gap_fill", attempted: 1, correct: 1, accuracyPct: 100 }],
);
check(
  "breakdown: an answer to a question that is not on the test is ignored",
  buildQTypeBreakdown([{ answers: { 1: "TRUE", 99: "TRUE" }, questions: TFNG_KEYS }]),
  [{ qtype: "tfng", attempted: 1, correct: 1, accuracyPct: 100 }],
);

// Ties go to the type with more evidence behind it, so a single miss does not
// outrank a pattern.
check(
  "breakdown: a tie is broken by how much data is behind it",
  buildQTypeBreakdown([
    {
      answers: { 1: "FALSE", 4: "B", 5: "A", 6: "C", 7: "D" },
      questions: [
        { qnum: 1, qtype: "tfng", answerKey: ["TRUE"] },
        { qnum: 4, qtype: "matching", answerKey: ["A"] },
        { qnum: 5, qtype: "matching", answerKey: ["B"] },
        { qnum: 6, qtype: "matching", answerKey: ["A"] },
        { qnum: 7, qtype: "matching", answerKey: ["A"] },
      ],
    },
  ]),
  [
    { qtype: "matching", attempted: 4, correct: 0, accuracyPct: 0 },
    { qtype: "tfng", attempted: 1, correct: 0, accuracyPct: 0 },
  ],
);
check(
  "breakdown: accuracy is kept to one decimal",
  buildQTypeBreakdown([
    {
      answers: { 1: "TRUE", 2: "FALSE", 3: "TRUE", 4: "A", 5: "A", 6: "A" },
      questions: [
        ...TFNG_KEYS,
        { qnum: 4, qtype: "matching", answerKey: ["A"] },
        { qnum: 5, qtype: "matching", answerKey: ["A"] },
        { qnum: 6, qtype: "matching", answerKey: ["B"] },
      ],
    },
  ]).map((row) => row.accuracyPct),
  [66.7, 66.7],
);

// --- totals ---------------------------------------------------------------------

const LOG: StudyLogRow[] = [
  { day: "2026-08-10", minutes: 60, units_completed: 1 },
  { day: "2026-08-11", minutes: 45, units_completed: 1 },
  { day: "2026-08-12", minutes: 90, units_completed: 2 },
  { day: "2026-08-16", minutes: 30, units_completed: 1 },
  { day: "2026-08-17", minutes: 55, units_completed: 1 },
];

check("totals: from the study log", buildTotals(LOG, [6.5, 7.0], "2026-08-17"), {
  unitsCompleted: 6,
  totalMinutes: 280,
  currentStreak: 2,
  longestStreak: 3,
  essaysGraded: 2,
  avgWritingBand: 6.8,
});
check(
  "totals: an empty log is zeros and a null band, not a crash",
  buildTotals([], [], "2026-08-17"),
  {
    unitsCompleted: 0,
    totalMinutes: 0,
    currentStreak: 0,
    longestStreak: 0,
    essaysGraded: 0,
    avgWritingBand: null,
  },
);
check(
  "totals: the average band keeps 0.1 precision, unsnapped",
  // 6.5 + 7.0 + 7.0 = 20.5 / 3 = 6.8333… An average is not a band and must not
  // be snapped to a half step: 6.8 is the honest number.
  buildTotals([], [6.5, 7.0, 7.0], "2026-08-17").avgWritingBand,
  6.8,
);
check(
  "totals: one essay averages to itself",
  buildTotals([], [5.5], "2026-08-17").avgWritingBand,
  5.5,
);
check(
  "totals: a streak that ended yesterday is still standing",
  buildTotals(LOG, [], "2026-08-18").currentStreak,
  2,
);
check(
  "totals: a whole day missed breaks it, but the best run survives",
  (() => {
    const totals = buildTotals(LOG, [], "2026-08-19");
    return [totals.currentStreak, totals.longestStreak];
  })(),
  [0, 3],
);
check(
  "totals: units come from the log, not from counting its days",
  buildTotals(
    [{ day: "2026-08-17", minutes: 120, units_completed: 3 }],
    [],
    "2026-08-17",
  ).unitsCompleted,
  3,
);

// --- the rendered views ---------------------------------------------------------
// The browser walk-through is still blocked, so the markup is asserted one layer
// down: the real components, the real props, and what is checked is what the
// user would see.

{
  const points = buildTrajectory(
    [
      attempt({
        attemptId: "one",
        submittedAt: "2026-08-10T04:00:00.000Z",
        scoreRaw: 10,
        scoreTotal: 13,
        testTitle: "Vertical Farming",
      }),
      attempt({
        attemptId: "two",
        submittedAt: "2026-08-17T04:00:00.000Z",
        unitId: null,
        scoreRaw: 3,
        scoreTotal: 13,
        testTitle: "Matching Features",
      }),
    ],
    "reading",
  );
  const markup = renderToStaticMarkup(
    createElement(TrajectoryChart, { skill: "reading", points }),
  );

  ok("render: one bar per attempt", (markup.match(/rounded-t-\[4px\]/g) ?? []).length === 2, markup);
  ok(
    "render: each bar's height is its accuracy",
    markup.includes("height:76.9%") && markup.includes("height:23.1%"),
    markup,
  );
  ok(
    "render: bank practice is drawn muted, roadmap solid",
    markup.includes("background:var(--sk-reading)") &&
      markup.includes("color-mix(in oklab, var(--sk-reading) 38%, transparent)"),
    markup,
  );
  ok(
    "render: every bar is labelled with its date, title, value and source",
    markup.includes("Mon, 10 Aug 2026 — Vertical Farming") &&
      markup.includes("76.9% · roadmap practice") &&
      markup.includes("23.1% · bank practice"),
    markup,
  );
  ok("render: the date range is captioned", markup.includes("Mon, 10 Aug 2026 →"), markup);
}

{
  // Writing plots bands out of 9, not percentages — an essay has no fraction.
  const markup = renderToStaticMarkup(
    createElement(TrajectoryChart, {
      skill: "writing",
      points: buildTrajectory(
        [
          attempt({
            skill: "writing",
            scoreRaw: null,
            scoreTotal: null,
            bandEstimate: 6.75,
            testTitle: "Task 2: university fees",
          }),
        ],
        "writing",
      ),
    }),
  );
  ok("render: writing is scaled out of 9", markup.includes("band out of 9"), markup);
  // 6.75 / 9 = 75%.
  ok("render: a band 6.75 bar stands at 75%", markup.includes("height:75%"), markup);
  ok("render: and is labelled as a band", markup.includes("band 6.8 · roadmap practice"), markup);
}

{
  const markup = renderToStaticMarkup(
    createElement(TrajectoryChart, { skill: "listening", points: [] }),
  );
  ok("render: an empty skill says so", markup.includes("no attempts yet"), markup);
  ok(
    "render: and explains that listening is empty because the bank is",
    markup.includes("no listening tests in the bank"),
    markup,
  );
  ok("render: with no bars at all", !markup.includes("rounded-t-[4px]"), markup);
}

{
  const markup = renderToStaticMarkup(
    createElement(QTypeTable, {
      rows: [
        { qtype: "matching", attempted: 12, correct: 3, accuracyPct: 25 },
        { qtype: "gap_fill", attempted: 4, correct: 1, accuracyPct: 25 },
        { qtype: "tfng", attempted: 9, correct: 8, accuracyPct: 88.9 },
      ],
    }),
  );
  ok(
    "render: enum question types are shown in words",
    markup.includes("Matching") && markup.includes("True / False / Not Given"),
    markup,
  );
  ok(
    "render: a thin row is marked low data, a thick one is not",
    (markup.match(/low data/g) ?? []).length === 1,
    markup,
  );
  ok(
    "render: a weak row with real data is coloured warn",
    markup.includes("var(--warn)"),
    markup,
  );
  ok(
    "render: a low-data row is NOT coloured — a colour is a verdict",
    markup.includes("var(--dim)"),
    markup,
  );
  ok("render: a strong row is coloured accent", markup.includes("var(--accent)"), markup);
  ok(
    "render: an empty breakdown explains itself instead of drawing an empty table",
    renderToStaticMarkup(createElement(QTypeTable, { rows: [] })).includes(
      "Nothing graded yet.",
    ),
    "the empty state is missing",
  );
}

{
  const markup = renderToStaticMarkup(
    createElement(AttemptHistory, {
      attempts: [
        {
          attemptId: "essay",
          date: "2026-08-18",
          source: "bank" as const,
          scoreRaw: null,
          scoreTotal: null,
          accuracyPct: null,
          bandEstimate: 6.5,
          feedbackMd: "**Overall band 6.5** — AI estimate ±0.5.\n\n### LR — Lexical Resource: 6.0\n\nSpelling errors.",
        },
        {
          attemptId: "objective",
          date: "2026-08-17",
          source: "roadmap" as const,
          scoreRaw: 10,
          scoreTotal: 13,
          accuracyPct: 76.9,
          bandEstimate: null,
          feedbackMd: null,
        },
      ],
    }),
  );

  ok("history: both attempts are listed", markup.includes("2 submitted"), markup);
  ok(
    "history: an objective row shows its fraction",
    markup.includes(">10 / 13</span>"),
    markup,
  );
  ok("history: an objective row shows its accuracy", markup.includes("76.9%"), markup);
  ok("history: an essay row shows its band", markup.includes("band 6.5"), markup);
  ok("history: a roadmap attempt is labelled as one", markup.includes(">roadmap</span>"), markup);
  ok(
    "history: only the essay row is expandable",
    (markup.match(/aria-expanded/g) ?? []).length === 1,
    markup,
  );
  ok(
    "history: the feedback is collapsed until asked for",
    !markup.includes("Lexical Resource"),
    "stored feedback rendered while collapsed",
  );
  ok(
    "history: there is no delete or edit control",
    !/delete|remove|edit/i.test(markup),
    "a destructive control reached the history view",
  );
  ok(
    "history: an empty history invites a first attempt",
    renderToStaticMarkup(createElement(AttemptHistory, { attempts: [] })).includes(
      "not submitted this one yet",
    ),
    "the empty state is missing",
  );
}

// --- Report ---------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n${failures.length} dashboard check(s) FAILED:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log("All dashboard checks passed.");
