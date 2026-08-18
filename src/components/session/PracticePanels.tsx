"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

import type { GradedAttempt, PlayerTest } from "@/lib/tests";
import { SKILL_LABEL } from "@/lib/labels";
import { QuestionField } from "@/components/session/QuestionField";
import { explainAnswerAction } from "@/app/unit/[seq]/test-actions";

/**
 * The three presentational panels of a practice run: the intro, the split
 * passage/questions view, and the graded review.
 *
 * They were defined inside Phase 02's `TestSession` (now
 * `UnitSession.tsx`). Phase 03 added a second player — the bank player at
 * `/bank/[slug]` — with a different surrounding flow (no Strategy step, no
 * roadmap completion, and since Phase 04 no Warm-up or Vocab either) but exactly
 * the same practice experience, so the panels moved here unchanged. Nothing in
 * them knows about units: they take a `PlayerTest` and answers, and that is all.
 */

export function PracticeIntro({
  test,
  unsupportedQTypes,
  busy,
}: {
  test: PlayerTest;
  unsupportedQTypes: string[];
  busy: boolean;
}) {
  return (
    <section className="mx-auto max-w-[68ch] px-6 pb-10 pt-13">
      <p className="eyebrow mb-2.5">Practice</p>
      <h1 className="mb-4 font-serif text-[32px] font-medium leading-[1.2] tracking-[-0.015em]">
        {test.title}
      </h1>

      <dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact label="Questions" value={String(test.questions.length)} />
        <Fact label="Time limit" value={`${test.durationMinutes} min`} />
        <Fact label="Skill" value={SKILL_LABEL[test.skill]} />
      </dl>

      {unsupportedQTypes.length > 0 && (
        <p
          className="mb-6 rounded-xl border px-4 py-3 text-[13.5px]"
          style={{
            borderColor: "color-mix(in oklab, var(--warn) 40%, transparent)",
            background: "color-mix(in oklab, var(--warn) 10%, transparent)",
            color: "var(--warn)",
          }}
        >
          This test contains {unsupportedQTypes.join(", ")} question(s), which are
          not yet supported and have been left out. Only the objective questions
          below are shown and graded.
        </p>
      )}

      <ul className="mb-2 flex flex-col gap-2 text-[14px] text-dim">
        <li>The clock starts as soon as you press Begin.</li>
        <li>At 00:00 the test submits automatically, answered or not.</li>
        <li>
          No feedback until you submit — answers and explanations are checked in
          the Review step.
        </li>
        <li>Refreshing the page restarts the attempt.</li>
      </ul>

      {busy && <p className="mt-6 text-[13px] text-faint">Starting…</p>}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
      <dt className="eyebrow mb-1">{label}</dt>
      <dd className="font-mono text-[15px]">{value}</dd>
    </div>
  );
}

export function PracticeSplit({
  test,
  answers,
  answeredCount,
  disabled,
  onAnswer,
}: {
  test: PlayerTest;
  answers: Record<number, string>;
  answeredCount: number;
  disabled: boolean;
  onAnswer: (qnum: number, value: string) => void;
}) {
  const passage = test.content.passage_md;

  return (
    <div
      className={`mx-auto grid max-w-[1180px] items-start gap-8 px-6 pb-10 pt-8 ${
        passage
          ? "lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]"
          : "max-w-[760px]"
      }`}
    >
      {passage && (
        <section className="min-w-0 rounded-2xl border border-line bg-surface px-6 py-7 shadow-card sm:px-8">
          <p className="eyebrow mb-2">Passage</p>
          <div className="prose-passage">
            <ReactMarkdown>{passage}</ReactMarkdown>
          </div>
        </section>
      )}

      <aside
        className={`min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card ${
          passage
            ? "lg:sticky lg:top-[82px] lg:max-h-[calc(100vh-118px)] lg:overflow-y-auto"
            : ""
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold">
            Questions 1–{test.questions.length}
          </p>
          <p className="font-mono text-[11.5px] text-faint">
            {answeredCount}/{test.questions.length}
          </p>
        </div>

        {test.audioUrl && (
          <audio
            controls
            preload="none"
            src={test.audioUrl}
            className="mb-5 w-full"
          />
        )}

        <div className="flex flex-col gap-5">
          {test.questions.map((question) => (
            <QuestionField
              key={question.id}
              question={question}
              value={answers[question.qnum] ?? ""}
              onChange={(value) => onAnswer(question.qnum, value)}
              disabled={disabled}
            />
          ))}
        </div>

        <div className="my-4 h-px bg-line" />
        <p className="text-[12.5px] leading-[1.5] text-faint">
          Answers are checked in the Review step — no feedback until the clock
          stops.
        </p>
      </aside>
    </div>
  );
}

export function ReviewPanel({
  test,
  graded,
}: {
  test: PlayerTest;
  graded: GradedAttempt;
}) {
  const promptByQnum = new Map(test.questions.map((q) => [q.qnum, q.prompt]));

  return (
    <section className="mx-auto max-w-[820px] px-6 pb-10 pt-13">
      <p className="eyebrow mb-2.5">Review</p>
      <h1 className="mb-6 font-serif text-[32px] font-medium leading-[1.2] tracking-[-0.015em]">
        {test.title}
      </h1>

      <div className="mb-9 flex flex-wrap items-end gap-8 rounded-2xl border border-line bg-surface px-6 py-5 shadow-card">
        <div>
          <p className="eyebrow mb-1.5">Score</p>
          <p className="font-mono text-[30px] leading-none tabular-nums">
            {graded.scoreRaw} / {graded.scoreTotal}
          </p>
        </div>
        {graded.bandEstimate !== null && (
          <div>
            <p className="eyebrow mb-1.5">Band estimate</p>
            <p
              className="font-mono text-[30px] leading-none tabular-nums"
              style={{ color: "var(--accent)" }}
            >
              {graded.bandEstimate.toFixed(1)}
            </p>
          </div>
        )}
        <p className="max-w-[34ch] text-[12.5px] leading-[1.5] text-faint">
          {graded.bandEstimate === null
            ? "A band score is only meaningful on a full 40-question paper, so none is shown for this practice set."
            : "An estimate from the official conversion table — not an official result."}
        </p>
      </div>

      <ol className="flex flex-col gap-4">
        {graded.perQuestion.map((result) => (
          <li
            key={result.qnum}
            className="rounded-2xl border bg-surface px-5 py-4"
            style={{
              borderColor: result.correct
                ? "color-mix(in oklab, var(--accent) 30%, transparent)"
                : "color-mix(in oklab, var(--warn) 32%, transparent)",
            }}
          >
            <div className="mb-2 flex items-center gap-2.5">
              <span
                className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full font-mono text-[11px]"
                style={{
                  background: result.correct
                    ? "color-mix(in oklab, var(--accent) 16%, transparent)"
                    : "color-mix(in oklab, var(--warn) 16%, transparent)",
                  color: result.correct ? "var(--accent)" : "var(--warn)",
                }}
              >
                {result.qnum}
              </span>
              <span
                className="text-[12px] font-semibold"
                style={{ color: result.correct ? "var(--accent)" : "var(--warn)" }}
              >
                {result.correct ? "Correct" : "Incorrect"}
              </span>
            </div>

            <p className="mb-3 text-[14px] leading-[1.5]">
              {promptByQnum.get(result.qnum) ?? ""}
            </p>

            <dl className="mb-3 flex flex-col gap-1.5 text-[13px]">
              <div className="flex gap-2">
                <dt className="w-[86px] flex-none text-faint">Your answer</dt>
                <dd className="min-w-0 flex-1 font-mono">
                  {result.given === "" ? (
                    <span className="text-faint">not answered</span>
                  ) : (
                    result.given
                  )}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[86px] flex-none text-faint">Accepted</dt>
                <dd className="min-w-0 flex-1 font-mono">
                  {result.expected.join("  ·  ")}
                </dd>
              </div>
            </dl>

            {result.explanationMd && (
              <div className="prose-explanation border-t border-line pt-3">
                <ReactMarkdown>{result.explanationMd}</ReactMarkdown>
              </div>
            )}

            {/* Only ever on a question that was answered wrong. */}
            {!result.correct && (
              <ExplainMyAnswer attemptId={graded.attemptId} qnum={result.qnum} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * "Why is my answer wrong?" — one click, one model call, and nothing kept.
 *
 * The explanation lives in this component's state and nowhere else: the server
 * action reads the question, the verified key and the user's own answer back
 * out of the database and returns a string. It does not write, so leaving the
 * page loses the explanation, which is the intended behaviour — the stored
 * `explanation_md` above is the permanent one.
 */
function ExplainMyAnswer({ attemptId, qnum }: { attemptId: string; qnum: number }) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; explanation: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  async function ask() {
    setState({ status: "loading" });
    try {
      const { explanation } = await explainAnswerAction(attemptId, qnum);
      setState({ status: "done", explanation });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (state.status === "done") {
    return (
      <div className="mt-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
        <p className="eyebrow mb-1.5">Why your answer is wrong</p>
        <div className="prose-explanation">
          <ReactMarkdown>{state.explanation}</ReactMarkdown>
        </div>
        <p className="mt-2 text-[11.5px] text-faint">
          Generated just now for this answer. It is not saved.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void ask()}
          disabled={state.status === "loading"}
          className="rounded-[10px] border border-line px-3 py-1.5 text-[12.5px] text-dim hover:text-text disabled:opacity-60"
        >
          {state.status === "loading" ? "Thinking…" : "Why is my answer wrong?"}
        </button>
        {state.status === "loading" && <AiWait {...EXPLAIN_WAIT} />}
      </div>
      {state.status === "error" && (
        <p className="mt-2 text-[12.5px]" style={{ color: "var(--warn)" }}>
          {state.message}
        </p>
      )}
    </div>
  );
}

/**
 * Elapsed seconds while a model call is in flight, with what to expect.
 *
 * The measured cost of one graded essay is 26–94 seconds and there is no
 * streaming, so a button that says "Grading…" and nothing else is
 * indistinguishable from a button that has hung. A number that visibly moves and
 * a stated expectation are the whole fix: no spinner library, no streaming, no
 * new dependency.
 *
 * It counts from `Date.now()` rather than from tick count, because a background
 * tab throttles `setInterval` and an under-reported wait would be worse than no
 * timer at all. Mount it only while the call is running — remounting is what
 * resets it.
 */
export function AiWait({
  what,
  expectation,
}: {
  what: string;
  expectation: string;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-[12.5px] text-faint" aria-live="polite">
      <span className="font-mono tabular-nums" style={{ color: "var(--accent)" }}>
        {what} {seconds}s
      </span>
      {" · "}
      {expectation}
    </span>
  );
}

/** The one place the expectation is worded, so both players say the same thing. */
export const GRADING_WAIT = {
  what: "Grading",
  expectation: "usually 30–90 seconds",
} as const;

export const EXPLAIN_WAIT = {
  what: "Thinking",
  expectation: "usually under 30 seconds",
} as const;

/** Shared by both players' footers. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function CountdownPill({ remainingMs }: { remainingMs: number | null }) {
  const urgent = remainingMs !== null && remainingMs <= 60_000;
  return (
    <div
      className="inline-flex items-center gap-[9px] rounded-full px-3.5 py-2 font-mono text-[14px] font-medium tabular-nums"
      style={{
        background: urgent
          ? "color-mix(in oklab, var(--warn) 14%, transparent)"
          : "color-mix(in oklab, var(--accent) 12%, transparent)",
        color: urgent ? "var(--warn)" : "var(--accent)",
      }}
      role="timer"
      aria-live="off"
    >
      <span
        aria-hidden
        className="h-[7px] w-[7px] rounded-full"
        style={{ background: "currentColor" }}
      />
      {formatClock(remainingMs ?? 0)}
    </div>
  );
}

export function PrimaryButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[11px] px-[22px] py-2.5 text-[14px] font-semibold hover:brightness-110 disabled:opacity-60"
      style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
    >
      {children}
    </button>
  );
}

export function SessionFooter({ children }: { children: React.ReactNode }) {
  return (
    <footer
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line backdrop-blur-[10px]"
      style={{
        background: "color-mix(in oklab, var(--surface) 92%, transparent)",
      }}
    >
      <div className="mx-auto flex max-w-[1180px] items-center gap-4 px-6 py-3">
        {children}
      </div>
    </footer>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-[1180px] px-6 pt-6">
      <p
        className="rounded-xl border px-4 py-3 text-[13.5px]"
        style={{
          borderColor: "color-mix(in oklab, var(--warn) 40%, transparent)",
          background: "color-mix(in oklab, var(--warn) 10%, transparent)",
          color: "var(--warn)",
        }}
      >
        {message}
      </p>
    </div>
  );
}
