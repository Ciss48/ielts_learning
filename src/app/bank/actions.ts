"use server";

import { startAttempt } from "@/lib/tests";

/**
 * Starting a practice-library attempt.
 *
 * The one thing that makes this different from the roadmap player: `unit_id` is
 * null. A bank attempt is recorded and graded exactly like any other, but it
 * belongs to no unit, so it can never be read as roadmap progress — and nothing
 * here touches `unit_completions` or `study_log`.
 *
 * Submission is not duplicated: `submitAttemptAction` takes only an attempt id
 * and answers, so both players share it.
 */
export async function startBankAttemptAction(
  testId: string,
): Promise<{ attemptId: string; startedAt: string }> {
  if (typeof testId !== "string" || testId.trim() === "") {
    throw new Error("testId must be a non-empty string");
  }
  return startAttempt(null, testId);
}
