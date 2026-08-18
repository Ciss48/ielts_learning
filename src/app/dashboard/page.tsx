import {
  getQTypeBreakdown,
  getSkillTrajectory,
  getTotals,
} from "@/lib/dashboard";
import { getRoadmap } from "@/lib/roadmap";
import { AppHeader } from "@/components/AppHeader";
import { QTypeTable } from "@/components/dashboard/QTypeTable";
import { TrajectoryChart } from "@/components/dashboard/TrajectoryChart";

/**
 * Progress, in three answers: how much has been done, where each skill is
 * going, and which question types are losing the marks.
 *
 * A server component with no state of its own — every number comes from
 * `src/lib/dashboard.ts`, and the question-type table is computed by re-grading
 * stored answers on read rather than from anything persisted. Nothing on this
 * page writes, so opening it can never move the roadmap pointer or log study
 * time.
 */
export default async function DashboardPage() {
  const [totals, reading, listening, writing, breakdown, roadmap] =
    await Promise.all([
      getTotals(),
      getSkillTrajectory("reading"),
      getSkillTrajectory("listening"),
      getSkillTrajectory("writing"),
      getQTypeBreakdown(),
      getRoadmap(),
    ]);

  const currentSeq = roadmap.find((u) => u.status === "current")?.seq ?? null;

  return (
    <div className="min-h-screen">
      <AppHeader active="dashboard" sessionSeq={currentSeq} />

      <main className="mx-auto max-w-[1180px] px-6 pb-20 pt-11">
        <p className="eyebrow mb-2.5">Progress</p>
        <h1 className="mb-3 font-serif text-[32px] font-medium leading-[1.2] tracking-[-0.015em]">
          Dashboard
        </h1>
        <p className="mb-9 max-w-[62ch] text-[14.5px] leading-[1.6] text-dim">
          Everything here is computed from what you have actually submitted.
          Roadmap sessions and practice-library runs both count — the bars tell
          them apart — and band estimates are estimates, not results.
        </p>

        <div className="mb-9 flex flex-wrap items-end gap-8 rounded-2xl border border-line bg-surface px-6 py-5 shadow-card">
          <Stat label="Units completed" value={String(totals.unitsCompleted)} accent />
          <Stat label="Time studied" value={formatMinutes(totals.totalMinutes)} />
          <Stat label="Current streak" value={formatDays(totals.currentStreak)} />
          <Stat label="Longest streak" value={formatDays(totals.longestStreak)} />
          <Stat label="Essays graded" value={String(totals.essaysGraded)} />
          <Stat
            label="Avg writing band"
            value={
              totals.avgWritingBand === null
                ? "—"
                : totals.avgWritingBand.toFixed(1)
            }
            accent={totals.avgWritingBand !== null}
            note={totals.avgWritingBand === null ? undefined : "AI estimate ±0.5"}
          />
        </div>

        <h2 className="eyebrow mb-3">Skill trajectories</h2>
        <TrajectoryChart skill="reading" points={reading} />
        <TrajectoryChart skill="listening" points={listening} />
        <TrajectoryChart skill="writing" points={writing} />

        <h2 className="eyebrow mb-3">Where the marks go</h2>
        <p className="mb-4 max-w-[62ch] text-[13.5px] leading-[1.6] text-dim">
          Every submitted answer, re-graded against the current answer key and
          grouped by question type — weakest first. A type with fewer than five
          answers behind it is marked <em>low data</em>: that is a small sample,
          not a weakness.
        </p>
        <QTypeTable rows={breakdown} />
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
  note,
}: {
  label: string;
  value: string;
  accent?: boolean;
  note?: string;
}) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{label}</p>
      <p
        className="font-mono text-[30px] leading-none tabular-nums"
        style={accent ? { color: "var(--accent)" } : undefined}
      >
        {value}
      </p>
      {note && <p className="mt-1.5 font-mono text-[11.5px] text-faint">{note}</p>}
    </div>
  );
}

/** Minutes are logged as minutes; past an hour a person reads hours. */
function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}
