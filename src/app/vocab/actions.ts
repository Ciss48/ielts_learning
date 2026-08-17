"use server";

import { revalidatePath } from "next/cache";

import { addCards, reviewCard } from "@/lib/vocab";
import type { Grade } from "@/lib/srs";

/**
 * Vocabulary server actions, shared by the unit player's Warm-up and Vocab
 * steps and by the standalone review at `/vocab`.
 *
 * Both are reachable as POST endpoints, so neither trusts its arguments. Auth is
 * enforced twice over, exactly as in `test-actions.ts`: middleware redirects an
 * unauthenticated request, and `src/lib/vocab.ts` uses the session-scoped
 * Supabase client, so RLS rejects anything that slips past it.
 *
 * Neither action touches `unit_completions` or `study_log`. Grading a flashcard
 * is not progress through the roadmap and must never move the pointer or the
 * heatmap — the heatmap counts sessions finished, not cards flipped.
 */

function requireId(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function requireGrade(value: unknown): Grade {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  throw new Error(`grade must be 0, 1, 2 or 3 — got ${JSON.stringify(value)}`);
}

/** Grade one card. Persists immediately, so a refresh mid-warm-up loses nothing. */
export async function reviewCardAction(
  cardId: string,
  grade: number,
): Promise<{ nextDueDate: string }> {
  const result = await reviewCard(requireId(cardId, "cardId"), requireGrade(grade));
  // The due count on Today and /vocab changes as soon as a card is graded.
  revalidatePath("/vocab");
  return result;
}

/** Add the ticked words to the deck. Re-adding a word is a no-op (unique word_id). */
export async function addCardsAction(
  wordIds: string[],
): Promise<{ added: number }> {
  if (!Array.isArray(wordIds)) {
    throw new Error("wordIds must be an array of word ids");
  }
  const result = await addCards(wordIds.map((id, i) => requireId(id, `wordIds[${i}]`)));
  revalidatePath("/vocab");
  return result;
}
