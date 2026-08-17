"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import type { Unit } from "@/lib/roadmap";
import type { GradedAttempt, PlayerTest } from "@/lib/tests";
import type { DueCard, UnitVocabWord } from "@/lib/vocab";
import { SKILL_LABEL, unitNumber } from "@/lib/labels";
import { StepRail, type RailStep } from "@/components/session/StepRail";
import { StrategyArticle } from "@/components/session/StrategyArticle";
import {
  CountdownPill,
  ErrorBanner,
  PracticeIntro,
  PracticeSplit,
  PrimaryButton,
  ReviewPanel,
  SessionFooter,
} from "@/components/session/PracticePanels";
import { VocabTriagePanel, WarmUpPanel } from "@/components/session/VocabPanels";
import { completeUnitAction } from "@/app/unit/[seq]/actions";
import { addCardsAction } from "@/app/vocab/actions";
import {
  startAttemptAction,
  submitAttemptAction,
} from "@/app/unit/[seq]/test-actions";

/**
 * The unit player. One component for every shape a unit can take:
 *
 *   Warm-up → Strategy → [Practice → Review] → [Vocab] → Complete
 *
 * The bracketed steps are conditional and the rail is built from whichever
 * actually apply, so a unit with no test, or one already completed, is the same
 * player with fewer steps rather than a second implementation. Phase 02 had two
 * players (four-step and two-step) and Phase 04 would have made that four; the
 * step list is the thing that varies, so that is what is data now.
 *
 * Which steps appear:
 *  - **Warm-up** only when cards are actually due. Zero due cards means the step
 *    does not exist — it never blocks a session, and it is always skippable.
 *  - **Practice/Review** only for a unit that carries a test and is not yet
 *    complete. A completed unit is read-only: the attempt is over and
 *    `completeUnit` has already run.
 *  - **Vocab** only when the unit teaches words. On a completed unit the list
 *    still shows, read-only, so the words stay readable.
 *
 * Deliberately client-side and in-memory for the practice run: there is still no
 * mid-test resume, so a refresh restarts the attempt. Warm-up is the opposite —
 * each grade is persisted as it is given.
 *
 * The answer key never lives here: it only arrives inside the
 * `submitAttemptAction` response, after submission.
 */

type Phase = "warmup" | "strategy" | "practice" | "review" | "vocab" | "complete";

interface Step {
  phase: Phase;
  name: string;
}

interface RunningAttempt {
  attemptId: string;
  startedAt: string;
  /** Client-clock deadline. Anchored locally so server/browser clock skew
   *  cannot hand the user a 0-second or double-length test. */
  deadline: number;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function UnitSession({
  unit,
  isCompleted,
  test,
  unsupportedQTypes,
  warmUpCards,
  vocab,
}: {
  unit: Unit;
  isCompleted: boolean;
  test: PlayerTest | null;
  unsupportedQTypes: string[];
  warmUpCards: DueCard[];
  vocab: UnitVocabWord[];
}) {
  const hasPractice = test !== null && !isCompleted;

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [];
    if (warmUpCards.length > 0) list.push({ phase: "warmup", name: "Warm-up" });
    list.push({ phase: "strategy", name: "Strategy" });
    if (hasPractice) {
      list.push({ phase: "practice", name: "Practice" });
      list.push({ phase: "review", name: "Review" });
    }
    if (vocab.length > 0) list.push({ phase: "vocab", name: "Vocab" });
    list.push({ phase: "complete", name: "Complete" });
    return list;
  }, [warmUpCards.length, hasPractice, vocab.length]);

  const [phase, setPhase] = useState<Phase>(steps[0].phase);
  const [attempt, setAttempt] = useState<RunningAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [graded, setGraded] = useState<GradedAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [checkedWords, setCheckedWords] = useState<Set<string>>(new Set());
  const [addedCount, setAddedCount] = useState<number | null>(null);

  const stepIndex = Math.max(
    0,
    steps.findIndex((step) => step.phase === phase),
  );

  const goTo = useCallback(
    (index: number) => {
      const next = steps[Math.min(steps.length - 1, Math.max(0, index))];
      setError(null);
      setPhase(next.phase);
    },
    [steps],
  );

  const goNext = useCallback(() => goTo(stepIndex + 1), [goTo, stepIndex]);
  const goBack = useCallback(() => goTo(stepIndex - 1), [goTo, stepIndex]);

  // The countdown fires from an interval, so it reads answers through a ref
  // rather than closing over a stale render.
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const submittedRef = useRef(false);

  const submit = useCallback(async () => {
    if (!attempt || submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true);
    setError(null);

    try {
      const result = await submitAttemptAction(
        attempt.attemptId,
        answersRef.current,
      );
      setGraded(result);
      setPhase("review");
    } catch (err) {
      // Let the user try again rather than losing the attempt to a blip.
      submittedRef.current = false;
      setError(`Could not submit: ${messageFrom(err)}`);
    } finally {
      setBusy(false);
    }
  }, [attempt]);

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
    if (!test) return;
    setBusy(true);
    setError(null);
    try {
      const started = await startAttemptAction(unit.id, test.id);
      submittedRef.current = false;
      setAttempt({
        ...started,
        deadline: Date.now() + test.durationMinutes * 60_000,
      });
    } catch (err) {
      setError(`Could not start the test: ${messageFrom(err)}`);
    } finally {
      setBusy(false);
    }
  }

  /** Confirm the triage list, then move on. Only newly ticked words are sent. */
  async function confirmVocab() {
    const wordIds = [...checkedWords];
    if (wordIds.length === 0) {
      goNext();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { added } = await addCardsAction(wordIds);
      setAddedCount(added);
      setCheckedWords(new Set());
      goNext();
    } catch (err) {
      setError(`Could not add those words: ${messageFrom(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const answeredCount = test
    ? test.questions.filter((q) => (answers[q.qnum] ?? "").trim() !== "").length
    : 0;

  const running = phase === "practice" && attempt !== null;

  const rail: RailStep[] = steps.map((step, index) => ({
    name: step.name,
    state:
      index === stepIndex
        ? "current"
        : index < stepIndex || (step.phase === "complete" && isCompleted)
          ? "done"
          : "locked",
  }));

  const stepLabel = `Step ${stepIndex + 1} of ${steps.length} · ${steps[stepIndex].name}`;

  return (
    <main className="pb-24">
      <StepRail
        steps={rail}
        meta={`Unit ${unitNumber(unit.seq)} · ${SKILL_LABEL[unit.skill]}`}
      />

      {error && <ErrorBanner message={error} />}

      {phase === "warmup" && (
        <WarmUpPanel cards={warmUpCards} onFinished={goNext} />
      )}

      {phase === "strategy" && (
        <StrategyArticle unit={unit} completed={isCompleted} />
      )}

      {phase === "practice" && test && !attempt && (
        <PracticeIntro
          test={test}
          unsupportedQTypes={unsupportedQTypes}
          busy={busy}
        />
      )}

      {running && test && (
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

      {phase === "review" && test && graded && (
        <ReviewPanel test={test} graded={graded} />
      )}

      {phase === "vocab" && (
        <VocabTriagePanel
          words={vocab}
          checked={checkedWords}
          readOnly={isCompleted}
          addedCount={addedCount}
          onToggle={(wordId, next) =>
            setCheckedWords((prev) => {
              const updated = new Set(prev);
              if (next) updated.add(wordId);
              else updated.delete(wordId);
              return updated;
            })
          }
        />
      )}

      {phase === "complete" && (
        <CompletePanel unit={unit} graded={graded} isCompleted={isCompleted} />
      )}

      <SessionFooter>
        {running && test ? (
          <>
            <CountdownPill remainingMs={remainingMs} />
            <span className="text-[12.5px] text-faint">
              {answeredCount}/{test.questions.length} answered
            </span>
            <span className="ml-auto text-[12.5px] text-faint">{stepLabel}</span>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="rounded-[11px] px-[22px] py-2.5 text-[14px] font-semibold hover:brightness-110 disabled:opacity-60"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              {busy ? "Submitting…" : "Submit answers"}
            </button>
          </>
        ) : (
          <>
            {stepIndex === 0 ? (
              <Link
                href="/"
                className="rounded-[10px] border border-line px-3.5 py-2.5 text-[13.5px] text-dim hover:text-text"
              >
                Back
              </Link>
            ) : (
              <button
                type="button"
                onClick={goBack}
                // Review is a one-way door: the attempt is submitted and graded,
                // so stepping back into Practice would be meaningless.
                disabled={busy || phase === "review"}
                className="rounded-[10px] border border-line px-3.5 py-2.5 text-[13.5px] text-dim hover:text-text disabled:invisible"
              >
                Back
              </button>
            )}

            <span className="ml-auto text-[12.5px] text-faint">{stepLabel}</span>

            {phase === "warmup" && (
              <button
                type="button"
                onClick={goNext}
                className="rounded-[11px] border border-line px-5 py-2.5 text-[14px] font-semibold text-dim hover:text-text"
              >
                Skip warm-up
              </button>
            )}

            {phase === "strategy" && (
              <PrimaryButton onClick={goNext}>
                {hasPractice ? "Continue to practice" : "Continue"}
              </PrimaryButton>
            )}

            {phase === "practice" && (
              <PrimaryButton onClick={() => void begin()} disabled={busy}>
                {busy ? "Starting…" : "Begin test"}
              </PrimaryButton>
            )}

            {phase === "review" && (
              <PrimaryButton onClick={goNext}>Continue</PrimaryButton>
            )}

            {phase === "vocab" && (
              <PrimaryButton onClick={() => void confirmVocab()} disabled={busy}>
                {checkedWords.size === 0
                  ? "Continue"
                  : busy
                    ? "Adding…"
                    : `Add ${checkedWords.size} word${
                        checkedWords.size === 1 ? "" : "s"
                      } and continue`}
              </PrimaryButton>
            )}

            {phase === "complete" &&
              (isCompleted ? (
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
                    style={{
                      background: "var(--accent)",
                      color: "var(--accent-ink)",
                    }}
                  >
                    Mark complete
                  </button>
                </form>
              ))}
          </>
        )}
      </SessionFooter>
    </main>
  );
}

function CompletePanel({
  unit,
  graded,
  isCompleted,
}: {
  unit: Unit;
  graded: GradedAttempt | null;
  isCompleted: boolean;
}) {
  return (
    <section className="mx-auto max-w-[68ch] px-6 pb-10 pt-13">
      <p className="eyebrow mb-2.5">Complete</p>
      <h1 className="mb-4 font-serif text-[32px] font-medium leading-[1.2] tracking-[-0.015em]">
        {unit.title}
      </h1>
      <p className="mb-7 text-[15px] leading-[1.6] text-dim">
        {isCompleted ? (
          "You have already completed this unit. Nothing here changes your progress."
        ) : (
          <>
            {graded
              ? `You scored ${graded.scoreRaw} out of ${graded.scoreTotal}. `
              : ""}
            Marking this unit complete logs {unit.estMinutes} minutes to today and
            moves the roadmap to the next unit.
          </>
        )}
      </p>
      {!isCompleted && (
        <p className="text-[13.5px] text-faint">
          Use <em>Mark complete</em> below when you are done.
        </p>
      )}
    </section>
  );
}
