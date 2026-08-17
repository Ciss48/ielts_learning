"use server";

import { startAttempt, submitAttempt, type GradedAttempt } from "@/lib/tests";

/**
 * Practice-step server actions.
 *
 * Both are reachable as POST endpoints, so neither trusts its arguments. Auth
 * is enforced twice over: middleware redirects unauthenticated requests, and
 * `src/lib/tests.ts` uses the session-scoped Supabase client, so RLS rejects
 * anything that gets past it.
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
