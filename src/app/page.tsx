import Link from "next/link";

import { getCurrentUnit, getRoadmap } from "@/lib/roadmap";
import { DEFAULT_HEATMAP_WEEKS, getHeatmap, getStreak } from "@/lib/stats";
import { BLOCK_LABEL, unitNumber, weekOfSeq } from "@/lib/labels";
import { AppHeader } from "@/components/AppHeader";
import { SkillBadge } from "@/components/SkillBadge";
import { StudyHeatmap } from "@/components/StudyHeatmap";

export default async function TodayPage() {
  const [unit, heatmap, streak] = await Promise.all([
    getCurrentUnit(),
    getHeatmap(),
    getStreak(),
  ]);
  // A null pointer means either "finished everything" or "nothing seeded yet";
  // only the roadmap length tells them apart, and the two need different copy.
  const nothingSeeded = unit ? false : (await getRoadmap()).length === 0;

  return (
    <div className="min-h-screen">
      <AppHeader active="today" sessionSeq={unit?.seq ?? null} />

      <main className="mx-auto max-w-[660px] px-6 pb-20 pt-14">
        {unit ? (
          <>
            <p className="eyebrow mb-[22px]">Today&rsquo;s unit</p>

            <article
              className="rounded-[18px] border border-line bg-surface p-8"
              style={{ boxShadow: "var(--shadow)" }}
            >
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <SkillBadge skill={unit.skill} />
                <span className="text-[13px] text-dim">
                  {BLOCK_LABEL[unit.block]} · Week {weekOfSeq(unit.seq)}
                </span>
              </div>

              <h1 className="mb-3.5 font-serif text-[34px] font-medium leading-[1.18] tracking-[-0.015em] text-pretty">
                {unit.title}
              </h1>

              <div className="flex items-center gap-2.5 font-mono text-[12.5px] text-dim">
                <span>Unit {unitNumber(unit.seq)}</span>
                <span className="text-faint">·</span>
                <span>{unit.estMinutes} min</span>
              </div>

              <div className="my-6 h-px bg-line" />

              {unit.elsaTask && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
                  <span
                    aria-hidden
                    className="mt-0.5 grid h-[19px] w-[19px] flex-none place-items-center rounded-md border-[1.5px] border-line text-[11px] leading-none text-faint"
                  >
                    ◦
                  </span>
                  <span className="min-w-0 flex-1 text-[14px]">
                    {unit.elsaTask}
                  </span>
                </div>
              )}

              <Link
                href={`/unit/${unit.seq}`}
                className="block w-full rounded-xl px-5 py-[15px] text-center text-[15px] font-semibold tracking-[-0.005em] hover:brightness-110"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
              >
                Start session
              </Link>
            </article>
          </>
        ) : (
          <EmptyState nothingSeeded={nothingSeeded} />
        )}

        <StudyHeatmap
          days={heatmap}
          streak={streak}
          weeks={DEFAULT_HEATMAP_WEEKS}
        />
      </main>
    </div>
  );
}

function EmptyState({ nothingSeeded }: { nothingSeeded: boolean }) {
  return (
    <>
      <p className="eyebrow mb-[22px]">
        {nothingSeeded ? "No content yet" : "Roadmap complete"}
      </p>
      <article
        className="rounded-[18px] border border-line bg-surface p-8"
        style={{ boxShadow: "var(--shadow)" }}
      >
        <h1 className="mb-3.5 font-serif text-[34px] font-medium leading-[1.18] tracking-[-0.015em]">
          {nothingSeeded
            ? "Nothing scheduled yet"
            : "You have finished every unit."}
        </h1>
        <p className="text-[14.5px] text-dim">
          {nothingSeeded ? (
            <>
              Seed a content file to start the roadmap:{" "}
              <code className="font-mono text-[13px]">
                npx tsx scripts/seed.ts content/seed/week_01.json
              </code>
            </>
          ) : (
            "Every seeded unit is complete. New content appears here as soon as it is seeded."
          )}
        </p>
        <div className="mt-6">
          <Link
            href="/roadmap"
            className="inline-block rounded-xl px-5 py-3 text-[14px] font-semibold"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            View roadmap
          </Link>
        </div>
      </article>
    </>
  );
}
