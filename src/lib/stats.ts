/**
 * Study statistics — server-only.
 *
 * Reads `study_log` and nothing else. `study_log` gains a row only when
 * `completeUnit` records a first completion, so "a day with a row" means "a day
 * a unit was finished" — the same definition the roadmap already uses. Warm-up
 * reviews deliberately do NOT write here (see `tasks/phase_04_vocab_srs.md`):
 * the heatmap tracks sessions done, not cards flipped.
 */

import { createClient } from "@/lib/supabase/server";
import { addDays, startOfWeek, today } from "@/lib/day";

export interface HeatmapDay {
  day: string;
  minutes: number;
  unitsCompleted: number;
}

/** Weeks shown on the Today page, per the design export. */
export const DEFAULT_HEATMAP_WEEKS = 12;

/** A `study_log` row as PostgREST returns it. */
export interface StudyLogRow {
  day: string;
  minutes: number;
  units_completed: number;
}

/** The first day the heatmap shows: the Monday `weeks - 1` weeks back. */
export function heatmapStart(end: string, weeks: number): string {
  return addDays(startOfWeek(end), -(Math.max(1, Math.round(weeks)) - 1) * 7);
}

/**
 * Rows → one entry per day from `start` to `end`, gaps filled with zeros.
 *
 * Pure, and exported so `scripts/check_stats.ts` can pin the day alignment
 * without a database. The two properties that matter and are easy to get wrong:
 * a day with no row must appear as an explicit zero rather than be missing, and
 * a row must land on its own `day` string, never shifted by a timezone.
 */
export function buildHeatmap(
  rows: StudyLogRow[],
  start: string,
  end: string,
): HeatmapDay[] {
  const byDay = new Map(
    rows.map((row) => [
      row.day,
      { day: row.day, minutes: row.minutes, unitsCompleted: row.units_completed },
    ]),
  );

  const days: HeatmapDay[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    days.push(byDay.get(day) ?? { day, minutes: 0, unitsCompleted: 0 });
  }
  return days;
}

/**
 * Consecutive days present in `days`, ending at `end` or the day before it.
 *
 * Pure, for the same reason as `buildHeatmap`. A streak may end *yesterday*
 * because today is not over: opening the app at 9am having studied yesterday
 * should show the streak standing, not broken. Once a whole day passes with no
 * row it is broken — no grace period beyond that, and no partial credit.
 */
export function computeStreak(days: ReadonlySet<string>, end: string): number {
  let cursor = days.has(end)
    ? end
    : days.has(addDays(end, -1))
      ? addDays(end, -1)
      : null;
  if (cursor === null) return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

async function loadStudyLog(from?: string): Promise<StudyLogRow[]> {
  const supabase = await createClient();

  const query = supabase
    .from("study_log")
    .select("day, minutes, units_completed")
    .order("day", { ascending: true });

  const { data, error } = from ? await query.gte("day", from) : await query;

  if (error) {
    throw new Error(`Failed to load the study log: ${error.message}`);
  }
  return (data ?? []) as StudyLogRow[];
}

/**
 * One entry per calendar day for the last `weeks` weeks, ending today, with
 * days that have no `study_log` row filled in as zeros.
 *
 * The range starts on the Monday of the week `weeks - 1` weeks back, so
 * chunking the result into runs of seven gives exactly `weeks` Monday-to-Sunday
 * columns — the GitHub-style grid the design export draws. The final column is
 * short by however many days of this week are still in the future; days ahead of
 * today are left out rather than rendered as zeros, because "not yet" and
 * "missed" are not the same thing.
 */
export async function getHeatmap(
  weeks: number = DEFAULT_HEATMAP_WEEKS,
): Promise<HeatmapDay[]> {
  const end = today();
  const start = heatmapStart(end, weeks);
  return buildHeatmap(await loadStudyLog(start), start, end);
}

/** Consecutive days with a `study_log` row, ending today or yesterday. */
export async function getStreak(): Promise<number> {
  const rows = await loadStudyLog();
  return computeStreak(new Set(rows.map((row) => row.day)), today());
}

/**
 * The longest run of consecutive days ever recorded, anywhere in the log.
 *
 * Pure, and beside `computeStreak` on purpose: the two answer different
 * questions and are easy to conflate. `computeStreak` is "am I on a run right
 * now", which is why it is allowed to end yesterday. This one is a personal
 * best — it never expires, it does not care where `today` is, and a run that
 * ended in March still counts. A single day is a streak of one.
 */
export function computeLongestStreak(days: ReadonlySet<string>): number {
  let longest = 0;
  for (const day of days) {
    // Count a run only from its first day, so each run is walked once.
    if (days.has(addDays(day, -1))) continue;

    let length = 0;
    let cursor = day;
    while (days.has(cursor)) {
      length += 1;
      cursor = addDays(cursor, 1);
    }
    if (length > longest) longest = length;
  }
  return longest;
}
