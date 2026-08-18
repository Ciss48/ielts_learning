"use client";

import { useState } from "react";

import type { TestAttempt } from "@/lib/dashboard";
import { formatDayLabel } from "@/lib/day";
import { MarkdownWithTables } from "@/components/session/WritingPanels";

/**
 * This test's submitted attempts, newest first.
 *
 * An essay row expands to the feedback it was given, rendered from the stored
 * `attempts.ai_feedback_md` — the whole reason Phase 05 wrote that column
 * instead of a JSON blob. Nothing here re-derives a band, re-parses feedback or
 * calls a model: the review this shows is byte-for-byte the review that was
 * shown when the essay was graded, which is what makes it worth keeping.
 *
 * There is no delete and no edit. A history you can tidy up is not a history.
 *
 * Client-side only because a row expands; the data arrives as a prop from the
 * server page.
 */
export function AttemptHistory({ attempts }: { attempts: TestAttempt[] }) {
  if (attempts.length === 0) {
    return (
      <section className="mx-auto max-w-[68ch] px-6 pb-10">
        <p className="eyebrow mb-3">Your attempts</p>
        <p className="rounded-2xl border border-line bg-surface px-5 py-4 text-[13.5px] leading-[1.6] text-dim">
          You have not submitted this one yet. Every attempt you finish is kept
          here — score, date, and for a writing task the full feedback.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-[68ch] px-6 pb-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="eyebrow">Your attempts</p>
        <p className="text-[12.5px] text-faint">
          {attempts.length} submitted · newest first
        </p>
      </div>

      <ol className="flex flex-col gap-2">
        {attempts.map((attempt) => (
          <AttemptRow key={attempt.attemptId} attempt={attempt} />
        ))}
      </ol>
    </section>
  );
}

function AttemptRow({ attempt }: { attempt: TestAttempt }) {
  const [open, setOpen] = useState(false);
  const expandable = attempt.feedbackMd !== null;

  const header = (
    <>
      <span className="font-mono text-[12.5px] text-faint">
        {formatDayLabel(attempt.date)}
      </span>

      <span className="ml-auto flex items-baseline gap-3">
        {attempt.scoreRaw !== null && attempt.scoreTotal !== null && (
          <span className="font-mono text-[14px] tabular-nums">
            {attempt.scoreRaw} / {attempt.scoreTotal}
          </span>
        )}
        {attempt.accuracyPct !== null && (
          <span className="font-mono text-[12.5px] tabular-nums text-dim">
            {attempt.accuracyPct}%
          </span>
        )}
        {attempt.bandEstimate !== null && (
          <span
            className="font-mono text-[14px] tabular-nums"
            style={{ color: "var(--accent)" }}
          >
            band {attempt.bandEstimate.toFixed(1)}
          </span>
        )}
        {attempt.source === "roadmap" && (
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-faint">
            roadmap
          </span>
        )}
      </span>
    </>
  );

  return (
    <li className="rounded-xl border border-line bg-surface">
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          className="flex w-full items-baseline gap-3 px-4 py-3 text-left hover:brightness-[1.03]"
        >
          {header}
          <span className="ml-1 font-mono text-[11px] text-faint" aria-hidden>
            {open ? "hide" : "feedback"}
          </span>
        </button>
      ) : (
        <div className="flex items-baseline gap-3 px-4 py-3">{header}</div>
      )}

      {open && attempt.feedbackMd !== null && (
        <div className="border-t border-line px-4 py-4">
          <div className="prose-explanation">
            <MarkdownWithTables markdown={attempt.feedbackMd} />
          </div>
          <p className="mt-3 text-[11.5px] text-faint">
            The feedback exactly as it was given at the time. Band estimates are
            AI estimates, ±0.5.
          </p>
        </div>
      )}
    </li>
  );
}
