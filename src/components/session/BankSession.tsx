"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { TestAttempt } from "@/lib/dashboard";
import type { GradedAttempt, PlayerTest } from "@/lib/tests";
import type { WritingFeedback } from "@/lib/writing";
import { MIN_ESSAY_WORDS, countWords } from "@/lib/words";
import { SKILL_LABEL } from "@/lib/labels";
import { AttemptHistory } from "@/components/AttemptHistory";
import { StepRail, type RailStep } from "@/components/session/StepRail";
import {
  AiWait,
  CountdownPill,
  ErrorBanner,
  GRADING_WAIT,
  PracticeIntro,
  PracticeSplit,
  PrimaryButton,
  ReviewPanel,
  SessionFooter,
} from "@/components/session/PracticePanels";
import {
  EssayFeedbackPanel,
  EssayIntro,
  EssayPanel,
  EssayRefusal,
} from "@/components/session/WritingPanels";
import { startBankAttemptAction } from "@/app/bank/actions";
// Shared with the roadmap player: submission takes an attempt id and answers (or
// an essay), and knows nothing about units.
import {
  submitAttemptAction,
  submitEssayAttemptAction,
} from "@/app/unit/[seq]/test-actions";

/**
 * The practice-library player: Practice → Review. Two steps, not four.
 *
 * It is the Phase 02 experience with the roadmap removed. There is no Strategy
 * step (a bank test has no unit and therefore no strategy article) and no
 * Complete step, because finishing here must NOT move the roadmap pointer or
 * write `study_log` — `completeUnit` is never called from this component.
 */

type Phase = "intro" | "practice" | "review";

interface RunningAttempt {
  attemptId: string;
  startedAt: string;
  deadline: number;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BankSession({
  test,
  slug,
  unsupportedQTypes,
  attempts,
}: {
  test: PlayerTest;
  slug: string;
  unsupportedQTypes: string[];
  /**
   * This test's submitted attempts, read on the server. Shown under the intro
   * card and nowhere else: during a timed run the last thing that helps is a
   * table of what you scored last time, and after submitting, the review IS the
   * result. Refreshing the page is what refreshes the list.
   */
  attempts: TestAttempt[];
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [attempt, setAttempt] = useState<RunningAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [graded, setGraded] = useState<GradedAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [essayText, setEssayText] = useState("");
  const [feedback, setFeedback] = useState<WritingFeedback | null>(null);
  const [refusedWords, setRefusedWords] = useState<number | null>(null);

  /** Non-null exactly when this bank test is a writing task. */
  const essayTask = test.essay;

  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const essayRef = useRef(essayText);
  useEffect(() => {
    essayRef.current = essayText;
  }, [essayText]);

  const submittedRef = useRef(false);

  const submit = useCallback(async () => {
    if (!attempt || submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true);
    setError(null);

    try {
      if (essayTask) {
        const text = essayRef.current;
        const words = countWords(text);
        // Under 50 words nothing is sent — no grade, no write, no tokens. The
        // server refuses again; this is the half that never leaves the browser.
        if (words < MIN_ESSAY_WORDS) {
          setRefusedWords(words);
          submittedRef.current = false;
          return;
        }
        setRefusedWords(null);
        const result = await submitEssayAttemptAction(attempt.attemptId, text);
        setFeedback(result.feedback);
      } else {
        const result = await submitAttemptAction(
          attempt.attemptId,
          answersRef.current,
        );
        setGraded(result);
      }
      setPhase("review");
    } catch (err) {
      submittedRef.current = false;
      setError(`Could not submit: ${messageFrom(err)}`);
    } finally {
      setBusy(false);
    }
  }, [attempt, essayTask]);

  // Countdown. At 00:00 it auto-submits whatever has been answered.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  useEffect(() => {
    if (!attempt) {
      setRemainingMs(null);
      return;
    }

    let expired = false;
    const tick = () => {
      const left = attempt.deadline - Date.now();
      setRemainingMs(Math.max(0, left));
      if (left <= 0 && !expired) {
        expired = true;
        void submitRef.current();
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [attempt]);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const started = await startBankAttemptAction(test.id);
      submittedRef.current = false;
      setAttempt({
        ...started,
        deadline: Date.now() + test.durationMinutes * 60_000,
      });
      setPhase("practice");
    } catch (err) {
      setError(`Could not start the test: ${messageFrom(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const answeredCount = test.questions.filter(
    (q) => (answers[q.qnum] ?? "").trim() !== "",
  ).length;

  const running = phase === "practice" && attempt !== null;

  const rail: RailStep[] = [
    { name: "Practice", state: phase === "review" ? "done" : "current" },
    { name: "Review", state: phase === "review" ? "current" : "locked" },
  ];

  return (
    <main className="pb-24">
      <StepRail
        steps={rail}
        meta={`Practice library · ${SKILL_LABEL[test.skill]} · ${slug}`}
      />

      {error && <ErrorBanner message={error} />}

      {phase === "intro" && (
        <>
          {essayTask ? (
            <EssayIntro test={test} essay={essayTask} busy={busy} />
          ) : (
            <PracticeIntro
              test={test}
              unsupportedQTypes={unsupportedQTypes}
              busy={busy}
            />
          )}
          <AttemptHistory attempts={attempts} />
        </>
      )}

      {running && attempt && essayTask && (
        <>
          <EssayPanel
            essay={essayTask}
            text={essayText}
            disabled={busy}
            onChange={setEssayText}
          />
          {refusedWords !== null && (
            <div className="mx-auto max-w-[1180px] px-6">
              <EssayRefusal words={refusedWords} />
            </div>
          )}
        </>
      )}

      {running && attempt && !essayTask && (
        <PracticeSplit
          test={test}
          answers={answers}
          answeredCount={answeredCount}
          disabled={busy}
          onAnswer={(qnum, value) =>
            setAnswers((prev) => ({ ...prev, [qnum]: value }))
          }
        />
      )}

      {phase === "review" && essayTask && feedback && (
        <>
          <EssayFeedbackPanel
            test={test}
            essay={essayTask}
            feedback={feedback}
            text={essayText}
          />
          <p className="mx-auto max-w-[820px] px-6 pb-4 text-[13px] text-faint">
            This was practice outside the roadmap — the band estimate is
            recorded, but no unit was completed and no study time was logged.
          </p>
        </>
      )}

      {phase === "review" && !essayTask && graded && (
        <>
          <ReviewPanel test={test} graded={graded} />
          <p className="mx-auto max-w-[820px] px-6 pb-4 text-[13px] text-faint">
            This was practice outside the roadmap — your score is recorded, but
            no unit was completed and no study time was logged.
          </p>
        </>
      )}

      <SessionFooter>
        {running ? (
          <>
            <CountdownPill remainingMs={remainingMs} />
            <span className="text-[12.5px] text-faint">
              {essayTask
                ? `${countWords(essayText)}/${essayTask.minWords} words`
                : `${answeredCount}/${test.questions.length} answered`}
            </span>
            <span className="ml-auto text-[12.5px] text-faint">
              {busy && essayTask ? null : "Step 1 of 2 · Practice"}
            </span>
            {busy && essayTask && <AiWait {...GRADING_WAIT} />}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="rounded-[11px] px-[22px] py-2.5 text-[14px] font-semibold hover:brightness-110 disabled:opacity-60"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              {busy
                ? essayTask
                  ? "Grading…"
                  : "Submitting…"
                : essayTask
                  ? "Submit for feedback"
                  : "Submit answers"}
            </button>
          </>
        ) : (
          <>
            <Link
              href="/bank"
              className="rounded-[10px] border border-line px-3.5 py-2.5 text-[13.5px] text-dim hover:text-text"
            >
              {phase === "review" ? "Back to library" : "Back"}
            </Link>

            <span className="ml-auto text-[12.5px] text-faint">
              {phase === "intro" && "Step 1 of 2 · Practice"}
              {phase === "review" && "Step 2 of 2 · Review"}
            </span>

            {phase === "intro" && (
              <PrimaryButton onClick={() => void begin()} disabled={busy}>
                {busy ? "Starting…" : "Begin test"}
              </PrimaryButton>
            )}
          </>
        )}
      </SessionFooter>
    </main>
  );
}
