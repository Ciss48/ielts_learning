/**
 * Spaced-repetition scheduler — SM-2 lite, day granularity.
 *
 * Pure by design and by contract: no database, no clock, no timezone. Given a
 * card's state and a grade it returns the next state, and that is all. The two
 * things it deliberately does NOT do live in `src/lib/vocab.ts`: turning an
 * interval into a `due_date` (which needs today's date in Asia/Ho_Chi_Minh) and
 * writing anything down.
 *
 * Being pure is what makes `scripts/check_srs.ts` able to pin every rule below
 * to a fixture. The schedule is locked by `tasks/phase_04_vocab_srs.md` — if a
 * rule here ever needs to change, change it there first.
 */

/** 0 Again · 1 Hard · 2 Good · 3 Easy — the four buttons on a flashcard. */
export type Grade = 0 | 1 | 2 | 3;

export interface CardState {
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
}

/**
 * Floor on ease. A card the user keeps failing would otherwise drive its own
 * multiplier towards zero and be shown forever at one-day intervals; 1.3 is
 * SM-2's own floor and keeps a hard card growing, slowly.
 */
export const MIN_EASE = 1.3;

/**
 * Ceiling on any interval. Beyond about two months a card is effectively
 * learned, and this is a 12-week IELTS roadmap — an interval longer than the
 * course is indistinguishable from dropping the card.
 */
export const MAX_INTERVAL_DAYS = 60;

function cap(intervalDays: number): number {
  return Math.min(MAX_INTERVAL_DAYS, intervalDays);
}

/**
 * The next state of a card after grading it.
 *
 * The schedule, verbatim from the task file:
 *  - **0 Again** — a lapse: `lapses+1`, ease drops 0.2 (floored), back to 1 day.
 *  - **1 Hard** — ease drops 0.15 (floored), interval stretches by 1.2 but
 *    always advances at least a day.
 *  - **2 Good** — ease unchanged, interval multiplies by ease; a brand-new card
 *    (interval 0) goes to tomorrow.
 *  - **3 Easy** — ease rises 0.15, interval multiplies by ease × 1.3; a
 *    brand-new card skips a day and goes to the day after tomorrow.
 *
 * Every branch increments `reps`, and every resulting interval is capped at
 * `MAX_INTERVAL_DAYS`.
 */
export function scheduleNext(s: CardState, grade: Grade): CardState {
  const reps = s.reps + 1;

  switch (grade) {
    case 0:
      return {
        ease: Math.max(MIN_EASE, s.ease - 0.2),
        intervalDays: 1,
        reps,
        lapses: s.lapses + 1,
      };

    case 1: {
      const ease = Math.max(MIN_EASE, s.ease - 0.15);
      return {
        ease,
        intervalDays: cap(Math.max(1, Math.round(s.intervalDays * 1.2))),
        reps,
        lapses: s.lapses,
      };
    }

    case 2:
      return {
        ease: s.ease,
        intervalDays: cap(
          s.intervalDays === 0 ? 1 : Math.round(s.intervalDays * s.ease),
        ),
        reps,
        lapses: s.lapses,
      };

    case 3: {
      const ease = s.ease + 0.15;
      return {
        ease,
        // The new ease applies immediately, so an Easy card jumps further than
        // a Good one on the same card twice over: a bigger multiplier and the
        // extra 1.3.
        intervalDays: cap(
          s.intervalDays === 0 ? 2 : Math.round(s.intervalDays * ease * 1.3),
        ),
        reps,
        lapses: s.lapses,
      };
    }
  }
}
