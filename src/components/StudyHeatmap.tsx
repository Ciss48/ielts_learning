import { formatDayLabel, weekdayIndex } from "@/lib/day";
import type { HeatmapDay } from "@/lib/stats";

/**
 * The 12-week study heatmap and streak counter from the design export.
 *
 * Built by hand out of divs on purpose — no chart library, no new dependency.
 * A GitHub-style grid is a `<div>` per day in a flex column per week, and the
 * intensity ramp is one `color-mix` over the existing accent and `--heat-0`
 * tokens, exactly as the design export computes it. Anything else would add a
 * runtime dependency to draw 84 squares.
 *
 * The data starts on a Monday (see `getHeatmap`), so slicing it into runs of
 * seven gives whole Monday-to-Sunday columns. The final column stops at today:
 * a day that has not happened yet is left out rather than drawn as a zero,
 * because "not yet" and "missed" must not look the same.
 */

/** Minutes → one of four intensities. Zero has its own flat colour. */
function level(minutes: number): 0 | 1 | 2 | 3 {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  return 3;
}

/** The design export's ramp: 42% / 70% / 98% accent over the empty-cell colour. */
function cellBackground(minutes: number): string {
  const lvl = level(minutes);
  if (lvl === 0) return "var(--heat-0)";
  return `color-mix(in oklab, var(--accent) ${lvl * 28 + 14}%, var(--heat-0))`;
}

function cellLabel(day: HeatmapDay): string {
  if (day.minutes <= 0) return `${formatDayLabel(day.day)} — no session`;
  const units = `${day.unitsCompleted} unit${day.unitsCompleted === 1 ? "" : "s"}`;
  return `${formatDayLabel(day.day)} — ${day.minutes} min, ${units}`;
}

export function StudyHeatmap({
  days,
  streak,
  weeks,
}: {
  days: HeatmapDay[];
  streak: number;
  weeks: number;
}) {
  // Whole weeks, Monday first. The range starts on a Monday by construction, so
  // `lead` is normally 0; padding from the first day's weekday keeps the grid
  // honest anyway, and a null cell renders as empty space rather than as a zero.
  const lead = days.length > 0 ? weekdayIndex(days[0].day) : 0;
  const cells: Array<HeatmapDay | null> = [
    ...new Array<null>(lead).fill(null),
    ...days,
  ];

  const columns: Array<Array<HeatmapDay | null>> = [];
  for (let i = 0; i < cells.length; i += 7) columns.push(cells.slice(i, i + 7));

  const daysStudied = days.filter((day) => day.minutes > 0).length;

  return (
    <section className="mt-11 flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0">
        <p className="eyebrow mb-3">Last {weeks} weeks</p>

        <div className="flex gap-[3px] overflow-x-auto pb-1">
          {columns.map((column, columnIndex) => (
            <div key={columnIndex} className="flex flex-none flex-col gap-[3px]">
              {column.map((day, dayIndex) =>
                day ? (
                  <div
                    key={day.day}
                    title={cellLabel(day)}
                    className="h-[11px] w-[11px] rounded-[3px]"
                    style={{ background: cellBackground(day.minutes) }}
                  />
                ) : (
                  <div
                    key={`pad-${columnIndex}-${dayIndex}`}
                    aria-hidden
                    className="h-[11px] w-[11px]"
                  />
                ),
              )}
            </div>
          ))}
        </div>

        <p className="mt-3 text-[12.5px] text-dim">
          {daysStudied === 0
            ? "No sessions logged yet — finishing a unit fills in today."
            : `${daysStudied} day${daysStudied === 1 ? "" : "s"} studied`}
        </p>
      </div>

      <div className="text-right">
        <div
          className="font-mono text-[26px] font-medium leading-none"
          style={{ color: "var(--accent)" }}
        >
          {streak}
        </div>
        <div className="mt-1.5 text-[12.5px] text-dim">
          day streak
        </div>
      </div>
    </section>
  );
}
