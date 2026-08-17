import { Fragment } from "react";

/**
 * The session step rail from the design export. Phase 01 shipped a two-step
 * version inline; it lives here now because the Practice/Review steps need the
 * same rail with four entries, rendered from both a server and a client tree.
 */

export type StepState = "current" | "done" | "locked";

export interface RailStep {
  name: string;
  state: StepState;
}

export function StepRail({ steps, meta }: { steps: RailStep[]; meta: string }) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-2 px-6 py-3.5">
        {steps.map((step, i) => (
          <Fragment key={step.name}>
            {i > 0 && <span className="h-px w-3.5 bg-line" aria-hidden />}
            <Step index={i + 1} name={step.name} state={step.state} />
          </Fragment>
        ))}
        <span className="ml-auto font-mono text-[11.5px] text-faint">{meta}</span>
      </div>
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
  state: StepState;
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
