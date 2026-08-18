"use server";

import {
  startAttempt,
  submitAttempt,
  submitEssayAttempt,
  type GradedAttempt,
} from "@/lib/tests";
import { explainMyAnswer } from "@/lib/explain";
import type { WritingFeedback } from "@/lib/writing";

/**
 * Practice-step server actions, shared by the roadmap player and the bank
 * player — every one of them takes an attempt id and knows nothing about units.
 *
 * All are reachable as POST endpoints, so none trusts its arguments. Auth is
 * enforced twice over: middleware redirects unauthenticated requests, and
 * `src/lib/tests.ts` / `src/lib/explain.ts` use the session-scoped Supabase
 * client, so RLS rejects anything that gets past it.
 */

function requireId(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

export async function startAttemptAction(
  unitId: string,
  testId: string,
): Promise<{ attemptId: string; startedAt: string }> {
  return startAttempt(requireId(unitId, "unitId"), requireId(testId, "testId"));
}

export async function submitAttemptAction(
  attemptId: string,
  answers: Record<number, string>,
): Promise<GradedAttempt> {
  // JSON object keys arrive as strings; keep only well-formed qnum→string pairs
  // so a malformed payload can never reach the grader.
  const clean: Record<number, string> = {};
  for (const [key, value] of Object.entries(answers ?? {})) {
    const qnum = Number(key);
    if (Number.isInteger(qnum) && typeof value === "string") {
      clean[qnum] = value;
    }
  }

  return submitAttempt(requireId(attemptId, "attemptId"), clean);
}

/**
 * Grade and store one essay. The `< 50 words` refusal and the "already
 * submitted" guard both live in `submitEssayAttempt`, so they hold however this
 * endpoint is called.
 */
export async function submitEssayAttemptAction(
  attemptId: string,
  essay: string,
): Promise<{ feedback: WritingFeedback }> {
  if (typeof essay !== "string") {
    throw new Error("essay must be a string");
  }
  return submitEssayAttempt(requireId(attemptId, "attemptId"), essay);
}

/**
 * Explain one wrong answer, for display only. Nothing is persisted — see
 * `src/lib/explain.ts`, which has no write in it — and the server re-reads the
 * question, the key and the user's own answer from the database rather than
 * taking any of them from this call.
 */
export async function explainAnswerAction(
  attemptId: string,
  qnum: number,
): Promise<{ explanation: string }> {
  if (!Number.isInteger(qnum) || qnum <= 0) {
    throw new Error("qnum must be a positive integer");
  }
  const explanation = await explainMyAnswer(requireId(attemptId, "attemptId"), qnum);
  return { explanation };
}
