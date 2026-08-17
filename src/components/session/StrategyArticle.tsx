import ReactMarkdown from "react-markdown";

import type { Unit } from "@/lib/roadmap";
import { BLOCK_LABEL, weekOfSeq } from "@/lib/labels";
import { SkillBadge } from "@/components/SkillBadge";

/**
 * The Strategy step's lesson body. Shared verbatim between the plain
 * (no-test) unit page and the test player, so the lesson looks identical
 * whether or not a Practice step follows it.
 *
 * No "use client": it renders in the server tree for plain units and inside the
 * client tree for test units.
 */
export function StrategyArticle({
  unit,
  completed = false,
}: {
  unit: Unit;
  completed?: boolean;
}) {
  return (
    <article className="mx-auto max-w-[68ch] px-6 pb-10 pt-13">
      <div className="mb-2.5 flex flex-wrap items-center gap-3">
        <p className="eyebrow">Strategy</p>
        {completed && (
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
          {BLOCK_LABEL[unit.block]} · Week {weekOfSeq(unit.seq)} · {unit.estMinutes} min
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
  );
}
