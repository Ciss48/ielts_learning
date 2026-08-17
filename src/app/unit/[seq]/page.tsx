import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";

import { getRoadmap } from "@/lib/roadmap";
import { BLOCK_LABEL, SKILL_LABEL, unitNumber, weekOfSeq } from "@/lib/labels";
import { AppHeader } from "@/components/AppHeader";
import { SkillBadge } from "@/components/SkillBadge";
import { completeUnitAction } from "./actions";

export default async function UnitPage({
  params,
}: {
  params: Promise<{ seq: string }>;
}) {
  const { seq: seqParam } = await params;
  const seq = Number(seqParam);
  if (!Number.isInteger(seq) || seq < 1) notFound();

  // One query pair gives the unit, its status and the pointer, so the guard
  // reads the same truth the roadmap does.
  const roadmap = await getRoadmap();
  const unit = roadmap.find((u) => u.seq === seq);
  if (!unit) notFound();

  // Guard: anything past the pointer is locked and must not be reachable.
  if (unit.status === "locked") redirect("/");

  const isCompleted = unit.status === "done";
  const currentSeq = roadmap.find((u) => u.status === "current")?.seq ?? null;

  return (
    <div className="min-h-screen">
      <AppHeader active="session" sessionSeq={currentSeq} />

      <main className="pb-24">
        {/* Step rail — Phase 1 ships Strategy → Complete; more steps land later. */}
        <div className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-2 px-6 py-3.5">
            <Step index={1} name="Strategy" state="current" />
            <span className="h-px w-3.5 bg-line" aria-hidden />
            <Step
              index={2}
              name="Complete"
              state={isCompleted ? "done" : "locked"}
            />
            <span className="ml-auto font-mono text-[11.5px] text-faint">
              Unit {unitNumber(unit.seq)} · {SKILL_LABEL[unit.skill]}
            </span>
          </div>
        </div>

        <article className="mx-auto max-w-[68ch] px-6 pb-10 pt-13">
          <div className="mb-2.5 flex flex-wrap items-center gap-3">
            <p className="eyebrow">Strategy</p>
            {isCompleted && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium"
                style={{
                  color: "var(--accent)",
                  background: "color-mix(in oklab, var(--accent) 13%, transparent)",
                }}
              >
                ✓ Completed
              </span>
            )}
          </div>

          <h1 className="mb-4 font-serif text-[32px] font-medium leading-[1.2] tracking-[-0.015em]">
            {unit.title}
          </h1>

          <div className="mb-7 flex flex-wrap items-center gap-2.5">
            <SkillBadge skill={unit.skill} size="sm" />
            <span className="font-mono text-[12px] text-dim">
              {BLOCK_LABEL[unit.block]} · Week {weekOfSeq(unit.seq)} ·{" "}
              {unit.estMinutes} min
            </span>
          </div>

          {unit.elsaTask && (
            <div className="mb-8 flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
              <span className="eyebrow flex-none pt-0.5">ELSA</span>
              <span className="min-w-0 flex-1 text-[14px]">{unit.elsaTask}</span>
            </div>
          )}

          <div className="prose-lesson">
            <ReactMarkdown>{unit.strategyMd}</ReactMarkdown>
          </div>
        </article>

        <footer
          className="fixed inset-x-0 bottom-0 z-20 border-t border-line backdrop-blur-[10px]"
          style={{ background: "color-mix(in oklab, var(--surface) 92%, transparent)" }}
        >
          <div className="mx-auto flex max-w-[1180px] items-center gap-4 px-6 py-3">
            <Link
              href="/"
              className="rounded-[10px] border border-line px-3.5 py-2.5 text-[13.5px] text-dim hover:text-text"
            >
              Back
            </Link>
            <span className="ml-auto text-[12.5px] text-faint">
              {isCompleted ? "Already completed" : "Step 1 of 2 · Strategy"}
            </span>
            {isCompleted ? (
              <Link
                href="/"
                className="rounded-[11px] border border-line px-5 py-2.5 text-[14px] font-semibold text-dim hover:text-text"
              >
                Back to today
              </Link>
            ) : (
              <form action={completeUnitAction}>
                <input type="hidden" name="seq" value={unit.seq} />
                <button
                  type="submit"
                  className="rounded-[11px] px-[22px] py-2.5 text-[14px] font-semibold hover:brightness-110"
                  style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
                >
                  Mark complete
                </button>
              </form>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}

function Step({
  index,
  name,
  state,
}: {
  index: number;
  name: string;
  state: "current" | "done" | "locked";
}) {
  const current = state === "current";
  const done = state === "done";

  return (
    <span
      className="flex items-center gap-[7px] rounded-full border py-[5px] pl-2 pr-3 text-[12.5px] font-medium"
      style={{
        borderColor: current
          ? "color-mix(in oklab, var(--accent) 35%, transparent)"
          : "transparent",
        background: current
          ? "color-mix(in oklab, var(--accent) 12%, transparent)"
          : "transparent",
        color: current ? "var(--accent)" : done ? "var(--dim)" : "var(--faint)",
        opacity: state === "locked" ? 0.45 : 1,
      }}
    >
      <span
        className="grid h-[18px] w-[18px] place-items-center rounded-full font-mono text-[10px]"
        style={{
          background: current
            ? "var(--accent)"
            : done
              ? "color-mix(in oklab, var(--accent) 20%, transparent)"
              : "var(--surface-2)",
          color: current
            ? "var(--accent-ink)"
            : done
              ? "var(--accent)"
              : "var(--faint)",
        }}
      >
        {done ? "✓" : index}
      </span>
      {name}
    </span>
  );
}
