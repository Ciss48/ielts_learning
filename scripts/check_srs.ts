/**
 * Fixture check for the pure SRS scheduler.
 *
 *   npx tsx scripts/check_srs.ts
 *
 * No database, no environment, no clock: `scheduleNext` is pure, and this script
 * exists to keep it that way and to pin every rule the task file locks. Exits 0
 * on pass, 1 naming each failing case.
 */

import {
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  scheduleNext,
  type CardState,
  type Grade,
} from "../src/lib/srs";

const failures: string[] = [];

/** The state a `vocab_cards` row starts in (see migration 0001). */
const NEW_CARD: CardState = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 };

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

function grade(name: string, from: CardState, g: Grade, to: CardState): void {
  check(`${name} (grade ${g})`, scheduleNext(from, g), to);
}

// --- A brand-new card, every grade ------------------------------------------
// interval 0 is the interesting start: Good goes to tomorrow, Easy to the day
// after, and Hard must not stay at 0 or the card would be due again today.
grade("new card · Again", NEW_CARD, 0, {
  ease: 2.3,
  intervalDays: 1,
  reps: 1,
  lapses: 1,
});
grade("new card · Hard", NEW_CARD, 1, {
  ease: 2.35,
  intervalDays: 1,
  reps: 1,
  lapses: 0,
});
grade("new card · Good", NEW_CARD, 2, {
  ease: 2.5,
  intervalDays: 1,
  reps: 1,
  lapses: 0,
});
grade("new card · Easy", NEW_CARD, 3, {
  ease: 2.65,
  intervalDays: 2,
  reps: 1,
  lapses: 0,
});

// --- A card in circulation, every grade -------------------------------------
const inPlay: CardState = { ease: 2.5, intervalDays: 10, reps: 4, lapses: 1 };

grade("10-day card · Again", inPlay, 0, {
  ease: 2.3,
  intervalDays: 1,
  reps: 5,
  lapses: 2,
});
grade("10-day card · Hard", inPlay, 1, {
  ease: 2.35,
  intervalDays: 12, // round(10 × 1.2)
  reps: 5,
  lapses: 1,
});
grade("10-day card · Good", inPlay, 2, {
  ease: 2.5,
  intervalDays: 25, // round(10 × 2.5)
  reps: 5,
  lapses: 1,
});
grade("10-day card · Easy", inPlay, 3, {
  ease: 2.65,
  // The raised ease applies to this interval: round(10 × 2.65 × 1.3).
  intervalDays: 34,
  reps: 5,
  lapses: 1,
});

// --- The ease floor ---------------------------------------------------------
const nearFloor: CardState = { ease: 1.4, intervalDays: 6, reps: 9, lapses: 3 };

grade("ease floor · Again clamps at 1.3", nearFloor, 0, {
  ease: MIN_EASE,
  intervalDays: 1,
  reps: 10,
  lapses: 4,
});
grade("ease floor · Hard clamps at 1.3", nearFloor, 1, {
  ease: MIN_EASE,
  intervalDays: 7, // round(6 × 1.2) = 7
  reps: 10,
  lapses: 3,
});

const atFloor: CardState = { ease: MIN_EASE, intervalDays: 3, reps: 12, lapses: 5 };
check(
  "ease floor · Again on a card already at the floor stays at the floor",
  scheduleNext(atFloor, 0).ease,
  MIN_EASE,
);
check(
  "ease floor · a floored card still advances on Good",
  scheduleNext(atFloor, 2).intervalDays,
  4, // round(3 × 1.3)
);

// --- The 60-day cap ---------------------------------------------------------
grade(
  "cap · Good past 60 days",
  { ease: 2.5, intervalDays: 50, reps: 7, lapses: 0 },
  2,
  { ease: 2.5, intervalDays: MAX_INTERVAL_DAYS, reps: 8, lapses: 0 }, // round(125) → 60
);
grade(
  "cap · Easy past 60 days",
  { ease: 2.5, intervalDays: 30, reps: 7, lapses: 0 },
  3,
  { ease: 2.65, intervalDays: MAX_INTERVAL_DAYS, reps: 8, lapses: 0 }, // round(103.35) → 60
);
grade(
  "cap · Hard past 60 days",
  { ease: 2.5, intervalDays: 55, reps: 7, lapses: 0 },
  1,
  { ease: 2.35, intervalDays: MAX_INTERVAL_DAYS, reps: 8, lapses: 0 }, // round(66) → 60
);
check(
  "cap · a capped card stays capped on Good",
  scheduleNext({ ease: 2.5, intervalDays: 60, reps: 9, lapses: 0 }, 2).intervalDays,
  MAX_INTERVAL_DAYS,
);

// --- A lapse after a long interval ------------------------------------------
// The case the task file calls out: forgetting a card that was nearly learned
// sends it back to tomorrow, counts a lapse, and costs 0.2 of ease — it does
// NOT keep any part of the long interval.
grade(
  "long-interval lapse",
  { ease: 2.5, intervalDays: 45, reps: 9, lapses: 1 },
  0,
  { ease: 2.3, intervalDays: 1, reps: 10, lapses: 2 },
);

// --- Bookkeeping invariants -------------------------------------------------
const grades: Grade[] = [0, 1, 2, 3];
for (const g of grades) {
  const next = scheduleNext(inPlay, g);
  check(`grade ${g} increments reps`, next.reps, inPlay.reps + 1);
  check(
    `grade ${g} touches lapses only on Again`,
    next.lapses,
    g === 0 ? inPlay.lapses + 1 : inPlay.lapses,
  );
  if (next.intervalDays < 1) {
    failures.push(`grade ${g} produced an interval below 1 day: ${next.intervalDays}`);
  }
  if (next.intervalDays > MAX_INTERVAL_DAYS) {
    failures.push(`grade ${g} produced an interval past the cap: ${next.intervalDays}`);
  }
  if (next.ease < MIN_EASE) {
    failures.push(`grade ${g} produced an ease below the floor: ${next.ease}`);
  }
}

check("scheduleNext does not mutate its input", inPlay, {
  ease: 2.5,
  intervalDays: 10,
  reps: 4,
  lapses: 1,
});

// --- A whole card's life ----------------------------------------------------
// Good four times from new, then a lapse, then back up: the sequence the
// warm-up step actually produces.
let card = NEW_CARD;
const path: number[] = [];
for (const g of [2, 2, 2, 2, 0, 2, 3] as Grade[]) {
  card = scheduleNext(card, g);
  path.push(card.intervalDays);
}
// After the lapse the card restarts at 1 day *and* at the reduced ease 2.3, so
// it climbs back more slowly than it did the first time: 1 → 2, not 1 → 3.
check("a card's life · intervals", path, [1, 3, 8, 20, 1, 2, 6]);
check("a card's life · reps and lapses", [card.reps, card.lapses], [7, 1]);
// 2.5 − 0.2 + 0.15 is 2.45 in decimal and 2.4499999999999997 in binary floating
// point. The rules are encoded verbatim rather than rounded, so the comparison
// is the one that tolerates the representation; a 1e-16 drift cannot move a
// rounded day count.
if (Math.abs(card.ease - 2.45) > 1e-9) {
  failures.push(`a card's life · final ease\n    expected ≈2.45\n    actual   ${card.ease}`);
}

// --- Report ------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n${failures.length} SRS check(s) FAILED:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log("All SRS checks passed.");
