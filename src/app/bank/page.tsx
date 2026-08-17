import Link from "next/link";

import { getRoadmap } from "@/lib/roadmap";
import { listBankTests } from "@/lib/tests";
import { AppHeader } from "@/components/AppHeader";
import { SkillBadge } from "@/components/SkillBadge";

/**
 * The practice library: every test that carries a slug, i.e. everything
 * committed from `content/staged/` by `scripts/ingest_commit.ts`.
 *
 * Roadmap-embedded tests have a null slug and are deliberately absent — they
 * belong to a unit and are played there. Practising from this page never moves
 * the roadmap.
 */
export default async function BankPage() {
  const [tests, roadmap] = await Promise.all([listBankTests(), getRoadmap()]);
  const currentSeq = roadmap.find((u) => u.status === "current")?.seq ?? null;

  return (
    <div className="min-h-screen">
      <AppHeader active="bank" sessionSeq={currentSeq} />

      <main className="mx-auto max-w-[1180px] px-6 pb-20 pt-11">
        <p className="eyebrow mb-2.5">Practice library</p>
        <h1 className="mb-3 font-serif text-[32px] font-medium leading-[1.2] tracking-[-0.015em]">
          Test bank
        </h1>
        <p className="mb-9 max-w-[62ch] text-[14.5px] leading-[1.6] text-dim">
          Extra practice outside the roadmap. Attempts here are scored and kept,
          but they do not complete a unit or log study time — your daily
          sequence is unaffected.
        </p>

        {tests.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface px-6 py-8 text-[14px] leading-[1.6] text-dim shadow-card">
            <p className="mb-2 font-semibold text-text">The bank is empty.</p>
            <p className="max-w-[64ch]">
              Drop a test PDF into <code className="font-mono">content/raw/</code>,
              run <code className="font-mono">npx tsx scripts/ingest.ts</code>,
              read the generated <code className="font-mono">.review.md</code>,
              then commit it with{" "}
              <code className="font-mono">npx tsx scripts/ingest_commit.ts</code>.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  <Th>Test</Th>
                  <Th>Skill</Th>
                  <Th align="right">Questions</Th>
                  <Th align="right">Time</Th>
                  <Th align="right">Best score</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {tests.map((test) => (
                  <tr key={test.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/bank/${test.slug}`}
                        className="text-[14px] font-medium hover:underline"
                      >
                        {test.title}
                      </Link>
                      <p className="mt-0.5 font-mono text-[11.5px] text-faint">
                        {test.slug}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <SkillBadge skill={test.skill} size="sm" />
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-[13px] tabular-nums">
                      {test.questionCount}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-[13px] tabular-nums">
                      {test.durationMinutes} min
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-[13px] tabular-nums">
                      {test.bestScoreRaw === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span style={{ color: "var(--accent)" }}>
                          {test.bestScoreRaw}
                          {test.scoreTotal !== null ? ` / ${test.scoreTotal}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Link
                        href={`/bank/${test.slug}`}
                        className="rounded-[10px] border border-line px-3 py-1.5 text-[12.5px] text-dim hover:text-text"
                      >
                        {test.attemptCount > 0 ? "Retry" : "Practise"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-faint ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}
