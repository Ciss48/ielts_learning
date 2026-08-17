/**
 * Live-database check for the vocabulary deck operations.
 *
 *   npx tsx scripts/check_vocab_db.ts
 *
 * `src/lib/vocab.ts` runs on the request-scoped Supabase client, which needs a
 * Next.js request (and a signed-in session) to exist — so it cannot be called
 * from a plain script. This script instead issues the **same PostgREST calls in
 * the same order** through the admin client, driving the same
 * `scheduleNext` from `src/lib/srs.ts`, and asserts the Definition-of-Done
 * properties against the real database. What it proves is that the queries and
 * the schedule behave as specified; what it does not prove is that the page
 * wiring around them renders (that is the standing browser-verification debt).
 *
 * It is non-destructive: every row it creates is deleted again, and it refuses
 * to touch any card that existed before it ran.
 */

import { resolve } from "node:path";

process.loadEnvFile(resolve(process.cwd(), ".env.local"));

import { scheduleNext, type CardState } from "../src/lib/srs";
import { addDays, today } from "../src/lib/day";

const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

function ok(name: string, condition: boolean, detail: string): void {
  if (!condition) failures.push(`${name}\n    ${detail}`);
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

async function main(): Promise<void> {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const supabase = createAdminClient();

  const now = today();
  const tomorrow = addDays(now, 1);

  // --- Guard: never disturb a deck the user actually built -------------------
  const { data: preexisting, error: preexistingError } = await supabase
    .from("vocab_cards")
    .select("id, word_id");
  if (preexistingError) throw new Error(preexistingError.message);
  const untouchable = new Set((preexisting ?? []).map((row) => row.id as string));
  console.log(`Deck before: ${untouchable.size} card(s). None of them will be modified.`);

  // --- A unit's word list, exactly as getUnitVocab reads it ------------------
  const { data: unitRow, error: unitError } = await supabase
    .from("units")
    .select("id, seq, title")
    .eq("seq", 2)
    .maybeSingle();
  if (unitError) throw new Error(unitError.message);
  if (!unitRow) throw new Error("No unit with seq 2 — seed content/seed/week_01.json first.");

  const { data: wordRows, error: wordsError } = await supabase
    .from("vocab_words")
    .select("id, word, ipa, meaning_en, meaning_vi, example")
    .eq("unit_id", unitRow.id as string)
    .order("word", { ascending: true });
  if (wordsError) throw new Error(wordsError.message);

  const words = wordRows ?? [];
  console.log(`Unit ${unitRow.seq} ("${unitRow.title}") teaches ${words.length} word(s).`);
  ok(
    "the unit has enough words to triage",
    words.length >= 3,
    `unit 2 has ${words.length} words; the check needs at least 3`,
  );
  if (words.length < 3) throw new Error("Not enough seeded vocabulary to check triage.");

  const alreadyInDeck = new Set(
    (preexisting ?? []).map((row) => row.word_id as string),
  );
  const candidates = words
    .map((word) => word.id as string)
    .filter((id) => !alreadyInDeck.has(id));
  ok(
    "three of the unit's words are not already in the deck",
    candidates.length >= 3,
    `only ${candidates.length} of unit 2's words are outside the deck`,
  );
  const picked = candidates.slice(0, 3);

  const created = new Set<string>();

  try {
    // --- Triage: addCards(picked) ------------------------------------------
    // Byte-for-byte the call `addCards` makes.
    const first = await supabase
      .from("vocab_cards")
      .upsert(
        picked.map((wordId) => ({ word_id: wordId })),
        { onConflict: "word_id", ignoreDuplicates: true },
      )
      .select("id");
    if (first.error) throw new Error(first.error.message);
    for (const row of first.data ?? []) created.add(row.id as string);

    check("ticking 3 words creates exactly 3 cards", (first.data ?? []).length, 3);

    // --- Re-confirming the same words creates nothing ----------------------
    const second = await supabase
      .from("vocab_cards")
      .upsert(
        picked.map((wordId) => ({ word_id: wordId })),
        { onConflict: "word_id", ignoreDuplicates: true },
      )
      .select("id");
    if (second.error) throw new Error(second.error.message);
    for (const row of second.data ?? []) created.add(row.id as string);

    check("re-confirming the same words creates none", (second.data ?? []).length, 0);

    const { count: afterCount, error: countError } = await supabase
      .from("vocab_cards")
      .select("id", { count: "exact", head: true });
    if (countError) throw new Error(countError.message);
    check(
      "the deck grew by exactly 3",
      afterCount ?? -1,
      untouchable.size + 3,
    );

    // --- A new card is due today, so the deck view and warm-up both see it --
    const due = await supabase
      .from("vocab_cards")
      .select("id, word_id, ease, interval_days, due_date, reps, lapses, added_at, vocab_words ( id, word )")
      .lte("due_date", now)
      .order("due_date", { ascending: true })
      .order("added_at", { ascending: true })
      .limit(20);
    if (due.error) throw new Error(due.error.message);

    const dueIds = new Set((due.data ?? []).map((row) => row.id as string));
    ok(
      "all three new cards are due today",
      picked.every((_, i) => dueIds.has([...created][i])),
      `due set is ${[...dueIds].join(", ")}`,
    );
    ok(
      "every due card carries its word",
      (due.data ?? []).every((row) => row.vocab_words !== null),
      "a due card came back with no joined vocab_words row",
    );

    const target = [...created][0];

    // --- Grade 2 (Good) on a brand-new card --------------------------------
    const before = await supabase
      .from("vocab_cards")
      .select("id, ease, interval_days, reps, lapses, due_date")
      .eq("id", target)
      .single();
    if (before.error) throw new Error(before.error.message);

    check("a new card starts at interval 0", before.data.interval_days, 0);
    check("a new card starts at ease 2.5", toNumber(before.data.ease), 2.5);
    check("a new card is due today", before.data.due_date, now);

    const state: CardState = {
      ease: toNumber(before.data.ease),
      intervalDays: before.data.interval_days as number,
      reps: before.data.reps as number,
      lapses: before.data.lapses as number,
    };
    const good = scheduleNext(state, 2);
    const goodDue = addDays(now, good.intervalDays);

    const goodUpdate = await supabase
      .from("vocab_cards")
      .update({
        ease: good.ease,
        interval_days: good.intervalDays,
        due_date: goodDue,
        reps: good.reps,
        lapses: good.lapses,
      })
      .eq("id", target);
    if (goodUpdate.error) throw new Error(goodUpdate.error.message);

    const goodReview = await supabase
      .from("vocab_reviews")
      .insert({ card_id: target, grade: 2 })
      .select("id, grade");
    if (goodReview.error) throw new Error(goodReview.error.message);

    const afterGood = await supabase
      .from("vocab_cards")
      .select("ease, interval_days, due_date, reps, lapses")
      .eq("id", target)
      .single();
    if (afterGood.error) throw new Error(afterGood.error.message);

    check("Good at interval 0 → due tomorrow", afterGood.data.due_date, tomorrow);
    check("Good at interval 0 → interval 1", afterGood.data.interval_days, 1);
    check("Good leaves ease alone", toNumber(afterGood.data.ease), 2.5);
    check("Good increments reps", afterGood.data.reps, 1);
    check("Good does not count a lapse", afterGood.data.lapses, 0);
    check("Good wrote one vocab_reviews row", (goodReview.data ?? []).length, 1);
    check("the review recorded grade 2", (goodReview.data ?? [])[0]?.grade, 2);

    // --- Then grade 0 (Again) on the same card -----------------------------
    const lapseState: CardState = {
      ease: toNumber(afterGood.data.ease),
      intervalDays: afterGood.data.interval_days as number,
      reps: afterGood.data.reps as number,
      lapses: afterGood.data.lapses as number,
    };
    const again = scheduleNext(lapseState, 0);
    const againDue = addDays(now, again.intervalDays);

    const againUpdate = await supabase
      .from("vocab_cards")
      .update({
        ease: again.ease,
        interval_days: again.intervalDays,
        due_date: againDue,
        reps: again.reps,
        lapses: again.lapses,
      })
      .eq("id", target);
    if (againUpdate.error) throw new Error(againUpdate.error.message);

    const againReview = await supabase
      .from("vocab_reviews")
      .insert({ card_id: target, grade: 0 })
      .select("id");
    if (againReview.error) throw new Error(againReview.error.message);

    const afterAgain = await supabase
      .from("vocab_cards")
      .select("ease, interval_days, due_date, reps, lapses")
      .eq("id", target)
      .single();
    if (afterAgain.error) throw new Error(afterAgain.error.message);

    check("Again increments lapses", afterAgain.data.lapses, 1);
    check("Again sends the card back to tomorrow", afterAgain.data.due_date, tomorrow);
    check("Again resets the interval to 1", afterAgain.data.interval_days, 1);
    check("Again drops ease by 0.2", toNumber(afterAgain.data.ease), 2.3);
    ok(
      "ease stays at or above the 1.3 floor",
      toNumber(afterAgain.data.ease) >= 1.3,
      `ease is ${afterAgain.data.ease}`,
    );
    check("Again increments reps too", afterAgain.data.reps, 2);

    const { count: reviewCount, error: reviewCountError } = await supabase
      .from("vocab_reviews")
      .select("id", { count: "exact", head: true })
      .eq("card_id", target);
    if (reviewCountError) throw new Error(reviewCountError.message);
    check("both gradings are in the history", reviewCount ?? -1, 2);

    // --- A card due tomorrow is no longer in today's warm-up ---------------
    const dueAfter = await supabase
      .from("vocab_cards")
      .select("id")
      .lte("due_date", now);
    if (dueAfter.error) throw new Error(dueAfter.error.message);
    ok(
      "the graded card has left today's due set",
      !(dueAfter.data ?? []).some((row) => (row.id as string) === target),
      "a card due tomorrow is still being offered today",
    );
  } finally {
    // --- Clean up: only rows this script created ---------------------------
    const mine = [...created].filter((id) => !untouchable.has(id));
    if (mine.length > 0) {
      const { error: deleteError } = await supabase
        .from("vocab_cards")
        .delete()
        .in("id", mine);
      if (deleteError) {
        console.error(
          `\n! Could not clean up ${mine.length} test card(s): ${deleteError.message}\n` +
            `  Remove them by hand: delete from vocab_cards where id in (${mine
              .map((id) => `'${id}'`)
              .join(", ")});\n`,
        );
      } else {
        console.log(`Cleaned up ${mine.length} test card(s) (reviews cascade).`);
      }
    }

    const { count: finalCount } = await supabase
      .from("vocab_cards")
      .select("id", { count: "exact", head: true });
    check("the deck is back to how it was found", finalCount ?? -1, untouchable.size);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} vocabulary database check(s) FAILED:\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}\n`);
    process.exit(1);
  }

  console.log("All vocabulary database checks passed.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `\n${err.message}\n` : err);
  process.exitCode = 1;
});
