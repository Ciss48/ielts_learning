/**
 * Fixture check for the printed-answer-key slash split (Phase 04 carry-over a).
 *
 *   npx tsx scripts/check_split.ts
 *
 * No database, no environment, no API: `splitPrintedKey` is pure. Every case
 * below is a real printed key from `ielts-academic-reading-sample-tasks-2023.pdf`
 * or the two shapes CLAUDE.md's rule names explicitly (a fraction, a date).
 * Exits 0 on pass, 1 naming the first failing case.
 */

import {
  DEFAULT_SPLIT_WORD_LIMIT,
  detectWordLimit,
  splitPrintedKey,
} from "./lib/answer_variants";

const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

function splits(name: string, key: string, limit: number, parts: string[]): void {
  const outcome = splitPrintedKey(key, limit);
  check(`${name}: parts`, outcome.parts, parts);
  check(`${name}: not refused`, outcome.refused, null);
}

function refuses(name: string, key: string, limit: number): void {
  const outcome = splitPrintedKey(key, limit);
  check(`${name}: key kept whole`, outcome.parts, [key]);
  if (splitPrintedKey(key, limit).refused === null) {
    failures.push(`${name}: expected a refusal reason, got none`);
  }
}

// --- Splits ---------------------------------------------------------------
// The case Phase 03 could not fix: p2 q11's printed key, where the grader
// otherwise accepts only the literal combined string.
splits("spaced slash, whole alternatives", "two to five / 2-5", 3, [
  "two to five",
  "2-5",
]);
splits("unspaced slash, equal length", "glucose/sugar", 3, ["glucose", "sugar"]);
splits("three variants", "car / automobile / motorcar", 3, [
  "car",
  "automobile",
  "motorcar",
]);
splits("equal length, two words each", "free radicals/loose radicals", 3, [
  "free radicals",
  "loose radicals",
]);

// --- Refusals -------------------------------------------------------------
// CLAUDE.md's rule 3: the slash is part of the printed answer itself.
refuses("a fraction", "1/2", 3);
refuses("a date", "12/05/2023", 3);
// Real printed keys from page 46 of the source (the Diagram Label task).
refuses("optional article inside brackets", "(a/the) condenser", 3);
refuses("elision, shorter variant borrows words", "pure/distilled water", 3);
refuses("elision, longer variant first", "infrared radiation/light", 3);
// The Phase 03 transcription deviation: splitting this naively would produce
// "tunnelling", an answer the source never prints on its own.
refuses("elision across three words", "South African tunneling/tunnelling", 3);
refuses("variant over the word limit", "the first stage / the second stage of it", 2);
refuses("empty variant", "glucose/", 3);

// A key with no slash is returned untouched and unreported.
check("no slash: untouched", splitPrintedKey("temperate", 3), {
  parts: ["temperate"],
  refused: null,
});

// --- Word limit detection -------------------------------------------------
check(
  "limit read from the printed instruction line",
  detectWordLimit([
    "Complete the table below.\n\nChoose NO MORE THAN THREE WORDS from the passage for each answer.",
  ]),
  3,
);
check("ONE WORD ONLY", detectWordLimit(["Write ONE WORD ONLY for each answer."]), 1);
check(
  "limit found on a later prompt",
  detectWordLimit(["Label the diagram below.", "NO MORE THAN TWO WORDS"]),
  2,
);
check("no printed limit", detectWordLimit(["Label the diagram below."]), null);
// Without a limit the fallback is generous, so length alone rarely blocks a split.
splits("fallback limit still splits", "car / automobile", DEFAULT_SPLIT_WORD_LIMIT, [
  "car",
  "automobile",
]);

// --- Report ---------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n${failures.length} answer-key split check(s) FAILED:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log("All answer-key split checks passed.");
