import type { QTypeBreakdown } from "@/lib/dashboard";
import { qtypeLabel } from "@/lib/labels";

/**
 * Where the marks are actually being lost, weakest first.
 *
 * The row that matters most is the one at the top, so the table is not sorted
 * alphabetically and does not need to be read in full. Every number in it comes
 * from re-grading stored answers through the player's own `gradeAnswers`, so a
 * row here and the review screen can never disagree about whether an answer was
 * right.
 *
 * **Thin evidence is marked, not coloured red.** Two attempts at a question type
 * is not a weakness, it is a small sample, and a dashboard that screams at a 0/1
 * teaches its owner to ignore it. Under `LOW_DATA_THRESHOLD` answers, the row
 * says "low data" instead of taking a position.
 */

export const LOW_DATA_THRESHOLD = 5;

export function QTypeTable({ rows }: { rows: QTypeBreakdown[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface px-6 py-8 text-[14px] leading-[1.6] text-dim shadow-card">
        <p className="mb-2 font-semibold text-text">Nothing graded yet.</p>
        <p className="max-w-[64ch]">
          This table fills in as you answer questions — every submitted attempt,
          from a unit or from the practice library, is re-graded here and grouped
          by question type.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="w-full min-w-[680px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <Th>Question type</Th>
            <Th>Accuracy</Th>
            <Th align="right">Correct</Th>
            <Th align="right">Answered</Th>
            <Th align="right">%</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const lowData = row.attempted < LOW_DATA_THRESHOLD;
            return (
              <tr key={row.qtype} className="border-b border-line last:border-b-0">
                <td className="px-4 py-3.5">
                  <span className="text-[14px] font-medium">
                    {qtypeLabel(row.qtype)}
                  </span>
                  {lowData && (
                    <span className="ml-2 rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-faint">
                      low data
                    </span>
                  )}
                  <span className="mt-0.5 block font-mono text-[11.5px] text-faint">
                    {row.qtype}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  <AccuracyBar accuracyPct={row.accuracyPct} muted={lowData} />
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-[13px] tabular-nums">
                  {row.correct}
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-[13px] tabular-nums text-dim">
                  {row.attempted}
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-[13px] tabular-nums">
                  <span style={{ color: barColor(row.accuracyPct, lowData) }}>
                    {row.accuracyPct}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Accent above 70%, warn below 50%, neither in between — and never either while
 * the row is marked low data, because a colour is a verdict.
 */
function barColor(accuracyPct: number, muted: boolean): string {
  if (muted) return "var(--dim)";
  if (accuracyPct >= 70) return "var(--accent)";
  if (accuracyPct < 50) return "var(--warn)";
  return "var(--text)";
}

function AccuracyBar({
  accuracyPct,
  muted,
}: {
  accuracyPct: number;
  muted: boolean;
}) {
  return (
    <div className="h-[6px] w-full max-w-[220px] overflow-hidden rounded-full border border-line bg-surface-2">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.max(1, Math.min(100, accuracyPct))}%`,
          background: barColor(accuracyPct, muted),
        }}
      />
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-faint ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}
