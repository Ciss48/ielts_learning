/**
 * The vocabulary deck — server-only.
 *
 * Three tables, three jobs:
 *  - `vocab_words` is content. It arrives with a unit from a seed file and is
 *    never created, edited or deleted here.
 *  - `vocab_cards` is the user's deck: one row per word they chose to study.
 *    `word_id` is UNIQUE, so adding a word twice is a no-op at the database
 *    level rather than a race this code has to win.
 *  - `vocab_reviews` is history: one immutable row per grading, written as the
 *    card is graded so a mid-warm-up refresh loses nothing already answered.
 *
 * The schedule itself lives in `src/lib/srs.ts` and is pure; this module is the
 * I/O around it, and the only place an interval becomes a calendar `due_date`.
 */

import { createClient } from "@/lib/supabase/server";
import { addDays, today } from "@/lib/day";
import { scheduleNext, type CardState, type Grade } from "@/lib/srs";

/** Default warm-up size. A session opens with recall, not with an hour of it. */
export const DEFAULT_DUE_LIMIT = 20;

export interface DueCard {
  cardId: string;
  wordId: string;
  word: string;
  ipa: string | null;
  meaningEn: string | null;
  meaningVi: string | null;
  example: string | null;
}

/** The word columns every view of the deck needs. */
const WORD_COLUMNS = "id, word, ipa, meaning_en, meaning_vi, example";

interface WordRow {
  id: string;
  word: string;
  ipa: string | null;
  meaning_en: string | null;
  meaning_vi: string | null;
  example: string | null;
}

/** A `vocab_cards` row with its word embedded through the foreign key. */
interface CardRow {
  id: string;
  word_id: string;
  ease: number | string;
  interval_days: number;
  due_date: string;
  reps: number;
  lapses: number;
  added_at: string;
  vocab_words: WordRow | null;
}

/** `numeric` comes back from PostgREST as a string, and 2.5 must stay 2.5. */
function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function toDueCard(row: CardRow): DueCard | null {
  // A card whose word vanished cannot be shown. `vocab_words.id` is the target
  // of an ON DELETE CASCADE, so this should be unreachable — it is here so a
  // broken row is skipped rather than rendering as an empty flashcard.
  if (!row.vocab_words) return null;
  return {
    cardId: row.id,
    wordId: row.word_id,
    word: row.vocab_words.word,
    ipa: row.vocab_words.ipa,
    meaningEn: row.vocab_words.meaning_en,
    meaningVi: row.vocab_words.meaning_vi,
    example: row.vocab_words.example,
  };
}

/**
 * Cards due today or overdue, oldest due first, capped at `limit`.
 *
 * "Due today" is today in Asia/Ho_Chi_Minh, not UTC: a card due 2026-08-17 is
 * due from midnight in Vietnam, which is still the 16th in London.
 */
export async function getDueCards(
  limit: number = DEFAULT_DUE_LIMIT,
): Promise<DueCard[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vocab_cards")
    .select(`id, word_id, ease, interval_days, due_date, reps, lapses, added_at,
             vocab_words ( ${WORD_COLUMNS} )`)
    .lte("due_date", today())
    // Oldest due first, so a backlog drains in the order it built up. `added_at`
    // only breaks ties, so the order is stable across renders.
    .order("due_date", { ascending: true })
    .order("added_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load due vocabulary cards: ${error.message}`);
  }

  return ((data ?? []) as unknown as CardRow[])
    .map(toDueCard)
    .filter((card): card is DueCard => card !== null);
}

/** How many cards are due, ignoring the warm-up cap. Used by `/vocab`. */
export async function countDueCards(): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("vocab_cards")
    .select("id", { count: "exact", head: true })
    .lte("due_date", today());

  if (error) {
    throw new Error(`Failed to count due vocabulary cards: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Grade one card: apply the schedule, move its due date, and record the review.
 *
 * The card row is updated before the history row is written, because the
 * schedule is what the next session reads; a failure between the two leaves a
 * correctly scheduled card and one missing history row, which is the harmless
 * direction.
 */
export async function reviewCard(
  cardId: string,
  grade: Grade,
): Promise<{ nextDueDate: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vocab_cards")
    .select("id, ease, interval_days, reps, lapses")
    .eq("id", cardId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load vocabulary card ${cardId}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`No vocabulary card with id ${cardId}`);
  }

  const current: CardState = {
    ease: toNumber(data.ease as number | string),
    intervalDays: data.interval_days as number,
    reps: data.reps as number,
    lapses: data.lapses as number,
  };

  const next = scheduleNext(current, grade);
  const nextDueDate = addDays(today(), next.intervalDays);

  const { error: updateError } = await supabase
    .from("vocab_cards")
    .update({
      ease: next.ease,
      interval_days: next.intervalDays,
      due_date: nextDueDate,
      reps: next.reps,
      lapses: next.lapses,
    })
    .eq("id", cardId);

  if (updateError) {
    throw new Error(`Failed to reschedule card ${cardId}: ${updateError.message}`);
  }

  const { error: reviewError } = await supabase
    .from("vocab_reviews")
    .insert({ card_id: cardId, grade });

  if (reviewError) {
    throw new Error(`Failed to record review of card ${cardId}: ${reviewError.message}`);
  }

  return { nextDueDate };
}

/**
 * Add words to the deck. Idempotent: `vocab_cards.word_id` is UNIQUE, so a word
 * already in the deck is ignored rather than duplicated or updated — re-ticking
 * a word must never reset the schedule of a card being studied.
 *
 * Returns how many rows were actually created, which is what the triage step
 * reports back to the user.
 */
export async function addCards(wordIds: string[]): Promise<{ added: number }> {
  const unique = [...new Set(wordIds.filter((id) => id.trim() !== ""))];
  if (unique.length === 0) return { added: 0 };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vocab_cards")
    .upsert(
      unique.map((wordId) => ({ word_id: wordId })),
      { onConflict: "word_id", ignoreDuplicates: true },
    )
    // ignoreDuplicates makes this return only the rows that were inserted, which
    // is exactly the count we want to report.
    .select("id");

  if (error) {
    throw new Error(`Failed to add vocabulary cards: ${error.message}`);
  }

  return { added: (data ?? []).length };
}

export interface UnitVocabWord {
  wordId: string;
  word: string;
  ipa: string | null;
  meaningEn: string | null;
  meaningVi: string | null;
  example: string | null;
  inDeck: boolean;
}

/**
 * Every word a unit teaches, flagged with whether it is already in the deck.
 *
 * Alphabetical: `vocab_words` carries no ordering column, so an ordering has to
 * be chosen, and alphabetical is stable across renders and easy to scan.
 */
export async function getUnitVocab(unitId: string): Promise<UnitVocabWord[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vocab_words")
    .select(WORD_COLUMNS)
    .eq("unit_id", unitId)
    .order("word", { ascending: true });

  if (error) {
    throw new Error(`Failed to load vocabulary for unit ${unitId}: ${error.message}`);
  }

  const words = (data ?? []) as WordRow[];
  if (words.length === 0) return [];

  const { data: cards, error: cardsError } = await supabase
    .from("vocab_cards")
    .select("word_id")
    .in(
      "word_id",
      words.map((word) => word.id),
    );

  if (cardsError) {
    throw new Error(`Failed to load deck membership: ${cardsError.message}`);
  }

  const inDeck = new Set((cards ?? []).map((card) => card.word_id as string));

  return words.map((word) => ({
    wordId: word.id,
    word: word.word,
    ipa: word.ipa,
    meaningEn: word.meaning_en,
    meaningVi: word.meaning_vi,
    example: word.example,
    inDeck: inDeck.has(word.id),
  }));
}

export interface DeckEntry extends DueCard {
  dueDate: string;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  isDue: boolean;
}

/** The whole deck for `/vocab`, due first then by due date. */
export async function getDeck(): Promise<DeckEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vocab_cards")
    .select(`id, word_id, ease, interval_days, due_date, reps, lapses, added_at,
             vocab_words ( ${WORD_COLUMNS} )`)
    .order("due_date", { ascending: true })
    .order("added_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load the vocabulary deck: ${error.message}`);
  }

  const now = today();

  return ((data ?? []) as unknown as CardRow[]).flatMap((row) => {
    const card = toDueCard(row);
    if (!card) return [];
    return [
      {
        ...card,
        dueDate: row.due_date,
        intervalDays: row.interval_days,
        ease: toNumber(row.ease),
        reps: row.reps,
        lapses: row.lapses,
        isDue: row.due_date <= now,
      },
    ];
  });
}
