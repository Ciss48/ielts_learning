import Link from "next/link";

import { getRoadmap, type Unit, type UnitStatus } from "@/lib/roadmap";
import {
  BLOCK_LABEL,
  BLOCK_ORDER,
  unitNumber,
  weekOfSeq,
} from "@/lib/labels";
import { AppHeader } from "@/components/AppHeader";
import { SkillBadge } from "@/components/SkillBadge";

type Entry = Unit & { status: UnitStatus };

export default async function RoadmapPage() {
  const units = await getRoadmap();
  const current = units.find((u) => u.status === "current") ?? null;
  const doneCount = units.filter((u) => u.status === "done").length;
  const percent = units.length
    ? Math.round((doneCount / units.length) * 100)
    : 0;

  const groups = BLOCK_ORDER.map((block) => ({
    block,
    units: units.filter((u) => u.block === block),
  })).filter((g) => g.units.length > 0);

  return (
    <div className="min-h-screen">
      <AppHeader active="roadmap" sessionSeq={current?.seq ?? null} />

      <main className="mx-auto max-w-[760px] px-6 pb-[90px] pt-12">
        <div className="mb-3.5 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="mb-1.5 font-serif text-[26px] font-medium tracking-[-0.01em]">
              Roadmap
            </h1>
            <p className="font-mono text-[12.5px] text-dim">
              {current
                ? `Unit ${current.seq} of ${units.length} · Week ${weekOfSeq(current.seq)}`
                : `${units.length} unit${units.length === 1 ? "" : "s"} seeded`}
            </p>
          </div>
          <p className="font-mono text-[12.5px] text-faint">
            {percent}% complete
          </p>
        </div>

        <div className="mb-10 h-[5px] overflow-hidden rounded-full border border-line bg-surface-2">
          <div
            className="h-full rounded-full"
            style={{ width: `${percent}%`, background: "var(--accent)" }}
          />
        </div>

        {groups.length === 0 ? (
          <p className="text-[14.5px] text-dim">
            No units seeded yet. Run{" "}
            <code className="font-mono text-[13px]">
              npx tsx scripts/seed.ts content/seed/week_01.json
            </code>
            .
          </p>
        ) : (
          groups.map(({ block, units: blockUnits }) => (
            <section key={block} className="mb-9">
              <div className="mb-3.5 flex items-baseline gap-3">
                <h2 className="text-[13px] font-semibold tracking-[0.02em]">
                  {BLOCK_LABEL[block]}
                </h2>
                <span className="h-px flex-1 bg-line" aria-hidden />
                <span className="font-mono text-[11.5px] text-faint">
                  {blockRange(blockUnits)}
                </span>
              </div>
              <div className="flex flex-col">
                {blockUnits.map((unit) => (
                  <UnitRow key={unit.id} unit={unit} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

function blockRange(units: Entry[]): string {
  const first = units[0].seq;
  const last = units[units.length - 1].seq;
  const weeks =
    weekOfSeq(first) === weekOfSeq(last)
      ? `Week ${weekOfSeq(first)}`
      : `Weeks ${weekOfSeq(first)}–${weekOfSeq(last)}`;
  const range = first === last ? `Unit ${first}` : `Units ${first}–${last}`;
  return `${range} · ${weeks}`;
}

function UnitRow({ unit }: { unit: Entry }) {
  const { status } = unit;
  const isCurrent = status === "current";
  const isLocked = status === "locked";

  const rowStyle = {
    borderColor: isCurrent
      ? "color-mix(in oklab, var(--accent) 38%, transparent)"
      : "var(--line)",
    background: isCurrent
      ? "color-mix(in oklab, var(--accent) 8%, var(--surface))"
      : "transparent",
    opacity: isLocked ? 0.5 : 1,
  };

  const body = (
    <>
      <span
        className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full border font-mono text-[11px]"
        style={{
          background: isCurrent ? "var(--accent)" : "transparent",
          color: isCurrent
            ? "var(--accent-ink)"
            : status === "done"
              ? "var(--accent)"
              : "var(--faint)",
          borderColor: isCurrent ? "transparent" : "var(--line)",
        }}
      >
        {status === "done" ? "✓" : unitNumber(unit.seq)}
      </span>
      <SkillBadge skill={unit.skill} size="sm" />
      <span
        className="min-w-0 flex-1 truncate text-[14.5px]"
        style={{ color: isLocked ? "var(--faint)" : "var(--text)" }}
      >
        {unit.title}
      </span>
      <span className="flex-none font-mono text-[11.5px] text-faint">
        {isCurrent ? "today" : status === "done" ? "done" : "🔒"}
      </span>
    </>
  );

  const className =
    "mb-1.5 flex items-center gap-3.5 rounded-xl border px-3.5 py-3 text-left";

  // Locked rows are not links — the roadmap is strictly sequential.
  if (isLocked) {
    return (
      <div className={className} style={rowStyle} aria-disabled>
        {body}
      </div>
    );
  }

  return (
    <Link
      href={`/unit/${unit.seq}`}
      className={`${className} hover:border-faint`}
      style={rowStyle}
    >
      {body}
    </Link>
  );
}
