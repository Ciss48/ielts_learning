/**
 * Live check for the dashboard reads.
 *
 *   npx tsx scripts/check_dashboard_db.ts
 *
 * `src/lib/dashboard.ts` runs on the request-scoped Supabase client, which needs
 * a Next.js request and a signed-in session, so it cannot be called from a
 * script. This issues the **same PostgREST calls in the same order** through the
 * admin client and feeds the results to the **real** `buildTrajectory`,
 * `buildQTypeBreakdown` and `buildTotals` — so every function that decides a
 * number is the shipping one, and only the client is mirrored. Same arrangement
 * as `scripts/check_writing_db.ts`.
 *
 * It is READ-ONLY: no insert, no update, no delete, anywhere in this file.
 * It spends no tokens.
 *
 * What it is for, beyond smoke-testing: it prints the question-type breakdown
 * beside a hand count computed a completely different way — straight from the
 * attempts, in this file, without `gradeAnswers` — so the two can be compared.
 * They are expected to agree. Where they disagree with `score_raw`, that is the
 * re-grading property doing its job and is explained below.
 */

import { resolve } from "node:path";

process.loadEnvFile(resolve(process.cwd(), ".env.local"));

// Dynamic imports inside `main` for the same reason as `check_writing_db.ts`:
// static imports evaluate before `loadEnvFile` runs, so `config.ts` would
// capture an empty environment.
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { normalizeAnswer } from "../src/lib/normalize";

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

const OBJECTIVE = new Set([
  "mcq",
  "tfng",
  "ynng",
  "matching",
  "gap_fill",
  "short_answer",
]);

async function main(): Promise<void> {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const supabase = createAdminClient();

  const { buildQTypeBreakdown, buildTotals, buildTrajectory } = await import(
    "../src/lib/dashboard"
  );
  const { computeLongestStreak, computeStreak } = await import("../src/lib/stats");
  const { dayOfInstant, today } = await import("../src/lib/day");

  // --- the rows, read once and shared -----------------------------------------
  const [attemptsResult, testsResult, questionsResult, logResult] = await Promise.all([
    supabase
      .from("attempts")
      .select(
        "id, unit_id, test_id, submitted_at, answers, score_raw, score_total, band_estimate",
      )
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: true }),
    supabase.from("tests").select("id, skill, title"),
    supabase.from("questions").select("test_id, qnum, qtype, answer_key"),
    supabase.from("study_log").select("day, minutes, units_completed"),
  ]);

  for (const [name, result] of [
    ["attempts", attemptsResult],
    ["tests", testsResult],
    ["questions", questionsResult],
    ["study_log", logResult],
  ] as const) {
    if (result.error) throw new Error(`Failed to read ${name}: ${result.error.message}`);
  }

  interface AttemptRow {
    id: string;
    unit_id: string | null;
    test_id: string;
    submitted_at: string;
    answers: Record<string, unknown>;
    score_raw: number | null;
    score_total: number | null;
    band_estimate: number | string | null;
  }
  const attempts = (attemptsResult.data ?? []) as unknown as AttemptRow[];
  const tests = new Map(
    (testsResult.data ?? []).map((row) => [
      row.id as string,
      { skill: row.skill as "reading" | "listening" | "writing", title: row.title as string },
    ]),
  );

  const questionsByTest = new Map<
    string,
    Array<{ qnum: number; qtype: string; answerKey: string[] }>
  >();
  for (const row of questionsResult.data ?? []) {
    const testId = row.test_id as string;
    const list = questionsByTest.get(testId) ?? [];
    list.push({
      qnum: row.qnum as number,
      qtype: row.qtype as string,
      answerKey: Array.isArray(row.answer_key)
        ? (row.answer_key as unknown[]).filter((k): k is string => typeof k === "string")
        : [],
    });
    questionsByTest.set(testId, list);
  }

  console.log(`\n  ${attempts.length} submitted attempt(s) in the database.`);

  // =========================================================================
  // 1. Trajectories
  // =========================================================================
  const forTrajectory = attempts.flatMap((row) => {
    const test = tests.get(row.test_id);
    if (test === undefined) return [];
    const band =
      row.band_estimate === null ? null : Number(row.band_estimate);
    return [
      {
        attemptId: row.id,
        submittedAt: row.submitted_at,
        unitId: row.unit_id,
        skill: test.skill,
        testTitle: test.title,
        scoreRaw: row.score_raw,
        scoreTotal: row.score_total,
        bandEstimate: band !== null && Number.isFinite(band) ? band : null,
      },
    ];
  });

  for (const skill of ["reading", "listening", "writing"] as const) {
    const points = buildTrajectory(forTrajectory, skill);
    console.log(`\n  ${skill}: ${points.length} point(s)`);
    for (const point of points) {
      console.log(
        `   ${point.date}  ${point.source.padEnd(7)}  ` +
          `acc ${point.accuracyPct === null ? "  —  " : `${point.accuracyPct}%`.padStart(5)}  ` +
          `band ${point.band === null ? " — " : point.band.toFixed(1)}  ${point.testTitle}`,
      );
    }

    ok(
      `${skill}: every point is that skill's`,
      points.every((point) =>
        forTrajectory.some((a) => a.attemptId === point.attemptId && a.skill === skill),
      ),
      "a point leaked in from another skill",
    );
    ok(
      `${skill}: points are oldest first`,
      points.every((point, i) => i === 0 || points[i - 1].date <= point.date),
      "the trajectory is not in date order",
    );
    ok(
      `${skill}: an essay point has a band and no accuracy`,
      points.every((point) => point.accuracyPct !== null || point.band !== null),
      "a point carries neither an accuracy nor a band",
    );
  }

  // The timezone rule, live: every date is the Ho Chi Minh City calendar day of
  // its own instant, not the UTC one.
  ok(
    "every trajectory date is the local calendar day of its attempt",
    (["reading", "listening", "writing"] as const).every((skill) =>
      buildTrajectory(forTrajectory, skill).every((point) => {
        const source = forTrajectory.find((a) => a.attemptId === point.attemptId);
        return source !== undefined && point.date === dayOfInstant(source.submittedAt);
      }),
    ),
    "a trajectory date does not match dayOfInstant of its submitted_at",
  );

  // =========================================================================
  // 2. The question-type breakdown, against a hand count
  // =========================================================================
  const objectiveAttempts = attempts.filter((row) => row.score_raw !== null);

  const breakdown = buildQTypeBreakdown(
    objectiveAttempts.map((row) => ({
      answers: Object.fromEntries(
        Object.entries(row.answers ?? {})
          .filter(([key, value]) => Number.isInteger(Number(key)) && typeof value === "string")
          .map(([key, value]) => [Number(key), value as string]),
      ),
      questions: (questionsByTest.get(row.test_id) ?? [])
        .filter((q) => OBJECTIVE.has(q.qtype))
        .map((q) => ({
          qnum: q.qnum,
          qtype: q.qtype as "mcq" | "tfng" | "ynng" | "matching" | "gap_fill" | "short_answer",
          answerKey: q.answerKey,
        })),
    })),
  );

  // The hand count. Deliberately written here, from the raw rows, WITHOUT
  // `gradeAnswers` — if it agreed with the library because it called the same
  // function, it would prove nothing.
  const hand = new Map<string, { attempted: number; correct: number }>();
  for (const row of objectiveAttempts) {
    const questions = questionsByTest.get(row.test_id) ?? [];
    for (const question of questions) {
      if (!OBJECTIVE.has(question.qtype)) continue;

      const raw = (row.answers ?? {})[String(question.qnum)];
      if (typeof raw !== "string" || raw.trim() === "") continue;

      const tally = hand.get(question.qtype) ?? { attempted: 0, correct: 0 };
      tally.attempted += 1;
      if (
        question.answerKey.some(
          (key) => normalizeAnswer(key) === normalizeAnswer(raw.trim()),
        )
      ) {
        tally.correct += 1;
      }
      hand.set(question.qtype, tally);
    }
  }

  console.log("\n  Question-type breakdown (library) vs hand count:");
  for (const row of breakdown) {
    const handRow = hand.get(row.qtype);
    console.log(
      `   ${row.qtype.padEnd(13)} library ${row.correct}/${row.attempted} ` +
        `(${row.accuracyPct}%)   hand ${handRow?.correct ?? "?"}/${handRow?.attempted ?? "?"}`,
    );
  }

  check(
    "the breakdown matches the hand count, type for type",
    breakdown.map((row) => [row.qtype, row.attempted, row.correct]),
    breakdown.map((row) => [
      row.qtype,
      hand.get(row.qtype)?.attempted ?? -1,
      hand.get(row.qtype)?.correct ?? -1,
    ]),
  );
  check(
    "and covers exactly the same set of question types",
    [...hand.keys()].sort(),
    breakdown.map((row) => row.qtype).sort(),
  );
  ok(
    "the breakdown is sorted weakest first",
    breakdown.every((row, i) => i === 0 || breakdown[i - 1].accuracyPct <= row.accuracyPct),
    "a stronger type came before a weaker one",
  );

  const totalAttempted = breakdown.reduce((sum, row) => sum + row.attempted, 0);
  const totalCorrect = breakdown.reduce((sum, row) => sum + row.correct, 0);
  const storedRaw = objectiveAttempts.reduce((sum, row) => sum + (row.score_raw ?? 0), 0);

  console.log(
    `\n  Totals: ${totalCorrect} correct out of ${totalAttempted} answered ` +
      `across ${objectiveAttempts.length} objective attempt(s).`,
  );
  console.log(`  Sum of stored score_raw on those attempts: ${storedRaw}.`);

  if (totalCorrect !== storedRaw) {
    // Not a failure. `score_raw` is what the answer scored on the day it was
    // submitted; the breakdown is what that same answer scores against the key
    // as it stands TODAY. Phase 04 split slash-joined answer keys into separate
    // entries, so an answer typed in the old joined form ("two to five / 2-5")
    // was correct when it was graded and is not correct against the split key.
    // Today's key is the authoritative one, so the breakdown is right to
    // disagree — but the two numbers are not interchangeable and the report
    // says so.
    console.log(
      `\n  NOTE: the two differ by ${storedRaw - totalCorrect}. That is the` +
        " re-grading property: score_raw is the score at submission time,\n" +
        "  the breakdown is the score against the CURRENT answer key. Answers" +
        " affected:",
    );
    for (const row of objectiveAttempts) {
      for (const question of questionsByTest.get(row.test_id) ?? []) {
        if (!OBJECTIVE.has(question.qtype)) continue;
        const given = (row.answers ?? {})[String(question.qnum)];
        if (typeof given !== "string" || given.trim() === "") continue;
        const correctNow = question.answerKey.some(
          (key) => normalizeAnswer(key) === normalizeAnswer(given.trim()),
        );
        if (!correctNow) {
          console.log(
            `   q${question.qnum} (${question.qtype}) in ${tests.get(row.test_id)?.title}: ` +
              `gave ${JSON.stringify(given)}, key is ${JSON.stringify(question.answerKey)}`,
          );
        }
      }
    }
  }

  // =========================================================================
  // 3. Totals
  // =========================================================================
  interface LogRow {
    day: string;
    minutes: number;
    units_completed: number;
  }
  const log = (logResult.data ?? []) as unknown as LogRow[];
  const essayBands = attempts
    .filter((row) => row.score_raw === null && row.band_estimate !== null)
    .map((row) => Number(row.band_estimate))
    .filter((band) => Number.isFinite(band));

  const totals = buildTotals(log, essayBands, today());
  console.log("\n  Totals:", JSON.stringify(totals));

  check(
    "unitsCompleted is the study_log sum",
    totals.unitsCompleted,
    log.reduce((sum, row) => sum + row.units_completed, 0),
  );
  check(
    "totalMinutes is the study_log sum",
    totals.totalMinutes,
    log.reduce((sum, row) => sum + row.minutes, 0),
  );
  check("essaysGraded counts the graded essays", totals.essaysGraded, essayBands.length);
  check(
    "currentStreak matches stats.ts",
    totals.currentStreak,
    computeStreak(new Set(log.map((row) => row.day)), today()),
  );
  check(
    "longestStreak matches stats.ts",
    totals.longestStreak,
    computeLongestStreak(new Set(log.map((row) => row.day))),
  );
  ok(
    "longestStreak is never below currentStreak",
    totals.longestStreak >= totals.currentStreak,
    `longest ${totals.longestStreak} < current ${totals.currentStreak}`,
  );

  // =========================================================================
  // 4. The views, rendered against the LIVE numbers
  // =========================================================================
  //
  // The browser walk-through is still blocked (the Chrome extension has no site
  // permission for the dev server), so this is the closest available proof that
  // /dashboard shows what the database actually contains: the real components,
  // rendered with the real rows, asserted against values computed here.
  {
    const { TrajectoryChart } = await import(
      "../src/components/dashboard/TrajectoryChart"
    );
    const { QTypeTable } = await import("../src/components/dashboard/QTypeTable");
    const { AttemptHistory } = await import("../src/components/AttemptHistory");
    for (const skill of ["reading", "listening", "writing"] as const) {
      const points = buildTrajectory(forTrajectory, skill);
      const markup = renderToStaticMarkup(
        createElement(TrajectoryChart, { skill, points }),
      );
      const usesBand = skill === "writing";
      const plotted = points.filter(
        (point) => (usesBand ? point.band : point.accuracyPct) !== null,
      );

      check(
        `render: the ${skill} chart draws one bar per plottable attempt`,
        (markup.match(/rounded-t-\[4px\]/g) ?? []).length,
        plotted.length,
      );
      ok(
        `render: every ${skill} bar is labelled with its own test`,
        plotted.every((point) => markup.includes(point.testTitle)),
        "a bar is missing its title",
      );
      if (plotted.length === 0) {
        ok(
          `render: ${skill} shows its empty state`,
          markup.includes("no attempts yet"),
          markup,
        );
      }
    }

    const breakdownMarkup = renderToStaticMarkup(
      createElement(QTypeTable, { rows: breakdown }),
    );
    ok(
      "render: every question type in the breakdown reaches the table",
      breakdown.every((row) => breakdownMarkup.includes(`>${row.qtype}<`)),
      "a question type is missing from the rendered table",
    );
    ok(
      "render: the weakest type is the first row in the markup",
      breakdown.length === 0 ||
        breakdownMarkup.indexOf(`>${breakdown[0].qtype}<`) ===
          Math.min(
            ...breakdown.map((row) => breakdownMarkup.indexOf(`>${row.qtype}<`)),
          ),
      "the table is not in weakest-first order",
    );

    // The attempt history for the one test that has a graded essay behind it.
    const feesTest = [...tests.entries()].find(
      ([, test]) => test.title === "Task 2: University fees",
    );
    if (feesTest !== undefined) {
      const { data: historyRows, error: historyError } = await supabase
        .from("attempts")
        .select(
          "id, unit_id, submitted_at, score_raw, score_total, band_estimate, ai_feedback_md",
        )
        .eq("test_id", feesTest[0])
        .not("submitted_at", "is", null)
        .order("submitted_at", { ascending: false });
      if (historyError) throw new Error(historyError.message);

      const history = (historyRows ?? []).map((row) => ({
        attemptId: row.id as string,
        date: dayOfInstant(row.submitted_at as string),
        source: (row.unit_id === null ? "bank" : "roadmap") as "bank" | "roadmap",
        scoreRaw: row.score_raw as number | null,
        scoreTotal: row.score_total as number | null,
        accuracyPct: null,
        bandEstimate:
          row.band_estimate === null ? null : Number(row.band_estimate),
        feedbackMd: (row.ai_feedback_md as string | null) ?? null,
      }));

      const markup = renderToStaticMarkup(
        createElement(AttemptHistory, { attempts: history }),
      );
      console.log(
        `\n  Attempt history for "${feesTest[1].title}": ${history.length} row(s).`,
      );
      ok(
        "render: the essay attempt's band is on screen",
        history.every(
          (row) =>
            row.bandEstimate === null ||
            markup.includes(`band ${row.bandEstimate.toFixed(1)}`),
        ),
        markup,
      );
      ok(
        "render: an attempt with stored feedback is expandable",
        history.filter((row) => row.feedbackMd !== null).length ===
          (markup.match(/aria-expanded/g) ?? []).length,
        "the expandable rows do not match the rows that have feedback",
      );
      ok(
        "render: the stored feedback is collapsed until asked for",
        !markup.includes("Overall band"),
        "feedback rendered while collapsed",
      );
    }
  }

  // A cross-check against the other ledger: `unit_completions` has one row per
  // completed unit, and `study_log.units_completed` should sum to the same
  // thing. If these ever diverge, `completeUnit` has a bug.
  const { count: completions, error: completionsError } = await supabase
    .from("unit_completions")
    .select("*", { count: "exact", head: true });
  if (completionsError) throw new Error(completionsError.message);
  check(
    "study_log's unit count agrees with unit_completions",
    totals.unitsCompleted,
    completions ?? 0,
  );
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\n${failures.length} dashboard live check(s) FAILED:\n`);
      for (const failure of failures) console.error(`  ✗ ${failure}\n`);
      process.exit(1);
    }
    console.log("\nAll live dashboard checks passed.");
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
