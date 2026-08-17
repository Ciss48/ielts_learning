/**
 * Fixture check for the heatmap and streak logic, and for the day arithmetic
 * underneath them.
 *
 *   npx tsx scripts/check_stats.ts
 *
 * No database and no clock: `buildHeatmap` and `computeStreak` take their rows
 * and their "today" as arguments precisely so the awkward cases — a gap in the
 * middle, a streak that ends yesterday, a month boundary, a leap day — can be
 * pinned here instead of waiting for the calendar to produce them. Exits 0 on
 * pass, 1 naming each failing case.
 */

import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// `tsconfig.json` sets `jsx: "preserve"` for Next, so tsx compiles the
// component's JSX with the classic runtime and emits bare `React.createElement`
// calls. Next injects that import itself; a plain script has to provide it.
// This is the whole cost of rendering a component outside the framework.
Object.assign(globalThis, { React });

import {
  addDays,
  daysBetween,
  formatDayLabel,
  startOfWeek,
  weekdayIndex,
} from "../src/lib/day";
import {
  buildHeatmap,
  computeStreak,
  heatmapStart,
  type StudyLogRow,
} from "../src/lib/stats";
import { StudyHeatmap } from "../src/components/StudyHeatmap";

const failures: string[] = [];

function ok(name: string, condition: boolean, detail: string): void {
  if (!condition) failures.push(`${name}\n    ${detail}`);
}

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

// --- Day arithmetic ---------------------------------------------------------
check("addDays across a month boundary", addDays("2026-08-31", 1), "2026-09-01");
check("addDays backwards across a year", addDays("2026-01-01", -1), "2025-12-31");
check("addDays across a leap day", addDays("2028-02-28", 1), "2028-02-29");
check("addDays zero is identity", addDays("2026-08-17", 0), "2026-08-17");
check("daysBetween", daysBetween("2026-08-01", "2026-08-17"), 16);
check("daysBetween is signed", daysBetween("2026-08-17", "2026-08-01"), -16);
// 2026-08-17 is a Monday.
check("weekdayIndex: Monday is 0", weekdayIndex("2026-08-17"), 0);
check("weekdayIndex: Sunday is 6", weekdayIndex("2026-08-23"), 6);
check("startOfWeek of a Monday is itself", startOfWeek("2026-08-17"), "2026-08-17");
check("startOfWeek of a Sunday", startOfWeek("2026-08-23"), "2026-08-17");
check("startOfWeek of a Wednesday", startOfWeek("2026-08-19"), "2026-08-17");
check("formatDayLabel", formatDayLabel("2026-08-17"), "Mon, 17 Aug 2026");

// --- Heatmap range ----------------------------------------------------------
// 12 weeks ending Wednesday 2026-08-19: starts on the Monday 11 weeks before
// this week's Monday (2026-08-17), i.e. 2026-06-01.
check("heatmapStart is a Monday", heatmapStart("2026-08-19", 12), "2026-06-01");
check("heatmapStart starts on a Monday", weekdayIndex(heatmapStart("2026-08-19", 12)), 0);
check("heatmapStart with 1 week", heatmapStart("2026-08-19", 1), "2026-08-17");

const span = buildHeatmap([], heatmapStart("2026-08-19", 12), "2026-08-19");
// 11 whole weeks (77) plus Mon–Wed of the current week (3).
check("12 weeks ending mid-week is 80 days", span.length, 80);
check("the range ends today", span[span.length - 1].day, "2026-08-19");
check("no day is in the future", span.filter((d) => d.day > "2026-08-19").length, 0);

const fullWeeks = buildHeatmap([], heatmapStart("2026-08-23", 12), "2026-08-23");
check("12 weeks ending on a Sunday is exactly 84 days", fullWeeks.length, 84);

// --- Gap filling ------------------------------------------------------------
const rows: StudyLogRow[] = [
  { day: "2026-08-10", minutes: 60, units_completed: 1 },
  { day: "2026-08-12", minutes: 135, units_completed: 2 },
  { day: "2026-08-17", minutes: 45, units_completed: 1 },
];

const week = buildHeatmap(rows, "2026-08-10", "2026-08-17");
check("every day in the range appears", week.length, 8);
check(
  "days line up with their own date, unshifted",
  week.map((day) => day.day),
  [
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
    "2026-08-16",
    "2026-08-17",
  ],
);
check(
  "minutes land on the right days, gaps are zeros",
  week.map((day) => day.minutes),
  [60, 0, 135, 0, 0, 0, 0, 45],
);
check(
  "units completed likewise",
  week.map((day) => day.unitsCompleted),
  [1, 0, 2, 0, 0, 0, 0, 1],
);

// A row outside the range must not leak in.
check(
  "rows before the range are ignored",
  buildHeatmap(rows, "2026-08-13", "2026-08-17").map((day) => day.minutes),
  [0, 0, 0, 0, 45],
);
check(
  "an empty log is all zeros, not an empty array",
  buildHeatmap([], "2026-08-15", "2026-08-17"),
  [
    { day: "2026-08-15", minutes: 0, unitsCompleted: 0 },
    { day: "2026-08-16", minutes: 0, unitsCompleted: 0 },
    { day: "2026-08-17", minutes: 0, unitsCompleted: 0 },
  ],
);

// --- Streaks ----------------------------------------------------------------
const days = (...list: string[]) => new Set(list);

check("no rows at all", computeStreak(days(), "2026-08-17"), 0);
check(
  "three days ending today",
  computeStreak(days("2026-08-15", "2026-08-16", "2026-08-17"), "2026-08-17"),
  3,
);
check(
  "a streak ending yesterday still counts",
  computeStreak(days("2026-08-15", "2026-08-16"), "2026-08-17"),
  2,
);
check(
  "a gap of one whole day breaks it",
  computeStreak(days("2026-08-14", "2026-08-15"), "2026-08-17"),
  0,
);
check(
  "only the run ending now counts, not the longest ever",
  computeStreak(
    days("2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-17"),
    "2026-08-17",
  ),
  1,
);
check(
  "a streak counts back across a month boundary",
  computeStreak(days("2026-07-31", "2026-08-01", "2026-08-02"), "2026-08-02"),
  3,
);
check(
  "today alone is a streak of one",
  computeStreak(days("2026-08-17"), "2026-08-17"),
  1,
);
check(
  "a future row does not extend the streak",
  computeStreak(days("2026-08-17", "2026-08-18"), "2026-08-17"),
  1,
);

// --- The rendered grid -------------------------------------------------------
// `StudyHeatmap` is a plain synchronous component with no data access, so it can
// be rendered to a string here. This is the one part of the Phase 04 UI that can
// be checked without a browser, and it is the part with real logic in it: the
// day → intensity ramp and the Monday-first chunking.
const rendered = renderToStaticMarkup(
  createElement(StudyHeatmap, {
    days: buildHeatmap(rows, "2026-06-01", "2026-08-19"),
    streak: 1,
    weeks: 12,
  }),
);

const cells = rendered.match(/rounded-\[3px\]/g) ?? [];
check("the grid draws one cell per day", cells.length, 80);
check(
  "and groups them into 12 Monday-first columns",
  (rendered.match(/flex flex-none flex-col/g) ?? []).length,
  12,
);
check(
  "an empty day uses the flat --heat-0 token",
  (rendered.match(/background:var\(--heat-0\)/g) ?? []).length,
  77,
);
check(
  "a studied day mixes the accent over it",
  (rendered.match(/color-mix\(in oklab, var\(--accent\)/g) ?? []).length,
  3,
);
// 60 min → level 3 (98%), 135 min → level 3, 45 min → level 2 (70%).
ok(
  "a 45-minute day is a lighter step than a 60-minute day",
  rendered.includes("var(--accent) 70%, var(--heat-0)") &&
    rendered.includes("var(--accent) 98%, var(--heat-0)"),
  "expected both a 70% and a 98% intensity step in the markup",
);
ok(
  "each cell is labelled with its own date",
  rendered.includes('title="Mon, 10 Aug 2026 — 60 min, 1 unit"') &&
    rendered.includes('title="Wed, 12 Aug 2026 — 135 min, 2 units"') &&
    rendered.includes('title="Tue, 11 Aug 2026 — no session"'),
  "a cell tooltip did not match its day",
);
ok("the streak is rendered", rendered.includes(">1</div>"), "streak value missing");
ok(
  "the caption counts the studied days",
  rendered.includes("3 days studied"),
  "expected the studied-day count in the caption",
);

// --- Report ------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n${failures.length} stats check(s) FAILED:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log("All heatmap/streak checks passed.");
