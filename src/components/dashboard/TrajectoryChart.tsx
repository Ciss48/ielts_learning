import type { Skill, TrajectoryPoint } from "@/lib/dashboard";
import { formatDayLabel } from "@/lib/day";
import { SKILL_COLOR, SKILL_LABEL } from "@/lib/labels";

/**
 * One skill's attempts as a row of bars — divs and design tokens, like
 * `StudyHeatmap`. No chart library, and no runtime dependency to draw a dozen
 * rectangles.
 *
 * Two decisions the shape of this component encodes:
 *
 *  1. **One scale per section, chosen by the skill.** Writing is plotted as a
 *     band out of 9, because an essay has no fraction to be a percentage of;
 *     reading and listening are plotted as accuracy, because most of their
 *     practice sets are not 40-question papers and therefore have no band at
 *     all. Mixing the two scales inside one row of bars would make a band 6.5
 *     look shorter than a 70% and mean nothing.
 *  2. **Bank practice is drawn muted.** It counts — a weakness is a weakness
 *     wherever it shows — but a bank retry of a paper already seen is weaker
 *     evidence than a first sitting, and the eye should be able to tell them
 *     apart without reading a legend.
 */

const CHART_HEIGHT_PX = 104;

/** The reading of a point that this section plots, or null if it has none. */
function valueOf(point: TrajectoryPoint, usesBand: boolean): number | null {
  return usesBand ? point.band : point.accuracyPct;
}

function formatValue(value: number, usesBand: boolean): string {
  return usesBand ? `band ${value.toFixed(1)}` : `${value}%`;
}

export function TrajectoryChart({
  skill,
  points,
}: {
  skill: Skill;
  points: TrajectoryPoint[];
}) {
  const usesBand = skill === "writing";
  const max = usesBand ? 9 : 100;
  const color = SKILL_COLOR[skill];

  const plotted = points.filter((point) => valueOf(point, usesBand) !== null);
  const dropped = points.length - plotted.length;

  return (
    <section className="mb-9 rounded-2xl border border-line bg-surface px-6 py-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[20px] font-medium">{SKILL_LABEL[skill]}</h2>
        <p className="text-[12.5px] text-faint">
          {plotted.length === 0
            ? "no attempts yet"
            : `${plotted.length} attempt${plotted.length === 1 ? "" : "s"} · ` +
              (usesBand ? "band out of 9" : "accuracy %")}
        </p>
      </div>

      {plotted.length === 0 ? (
        <EmptySkill skill={skill} />
      ) : (
        <>
          <div
            className="flex items-end gap-1.5 overflow-x-auto border-b border-line pb-0"
            style={{ height: `${CHART_HEIGHT_PX}px` }}
          >
            {plotted.map((point) => {
              const value = valueOf(point, usesBand) as number;
              const heightPct = Math.max(2, Math.min(100, (value / max) * 100));

              return (
                <div
                  key={point.attemptId}
                  title={
                    `${formatDayLabel(point.date)} — ${point.testTitle}\n` +
                    `${formatValue(value, usesBand)} · ${point.source} practice`
                  }
                  className="w-[26px] flex-none rounded-t-[4px]"
                  style={{
                    height: `${heightPct}%`,
                    // Roadmap solid, bank muted — the same colour, less of it,
                    // so the two read as one series with two weights.
                    background:
                      point.source === "roadmap"
                        ? color
                        : `color-mix(in oklab, ${color} 38%, transparent)`,
                  }}
                />
              );
            })}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-dim">
              {plotted[0].date === plotted[plotted.length - 1].date
                ? formatDayLabel(plotted[0].date)
                : `${formatDayLabel(plotted[0].date)} → ${formatDayLabel(
                    plotted[plotted.length - 1].date,
                  )}`}
              {dropped > 0 &&
                ` · ${dropped} attempt${dropped === 1 ? "" : "s"} not plotted (no ${
                  usesBand ? "band" : "accuracy"
                })`}
            </p>
            <Legend color={color} />
          </div>
        </>
      )}
    </section>
  );
}

function Legend({ color }: { color: string }) {
  return (
    <p className="flex items-center gap-3 text-[11.5px] text-faint">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-[9px] w-[9px] rounded-[2px]"
          style={{ background: color }}
        />
        roadmap
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-[9px] w-[9px] rounded-[2px]"
          style={{ background: `color-mix(in oklab, ${color} 38%, transparent)` }}
        />
        bank practice
      </span>
    </p>
  );
}

/**
 * Not a chart with no bars in it. An empty skill says what would fill it,
 * because "nothing yet" and "nothing available" are different problems and only
 * one of them is the user's to fix.
 */
function EmptySkill({ skill }: { skill: Skill }) {
  return (
    <p className="max-w-[64ch] text-[13.5px] leading-[1.6] text-dim">
      {skill === "listening"
        ? "No listening attempts yet — there are no listening tests in the bank, so nothing here is waiting on you."
        : skill === "writing"
          ? "No essays graded yet. Sit one of the writing tasks in the practice library and its band will appear here."
          : "No reading attempts yet. Anything you sit — in a unit or in the practice library — shows up here."}
    </p>
  );
}
