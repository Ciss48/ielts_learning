/**
 * Fixture check for the pure grading core.
 *
 *   npx tsx scripts/check_grading.ts
 *
 * No database, no environment: `gradeAnswers` and `rawToBand` are pure, and
 * this script exists to keep them that way. Exits 0 on pass, 1 naming the
 * first failing case.
 */

import { gradeAnswers, type ObjectiveQType } from "../src/lib/tests";
import { rawToBand } from "../src/lib/band";

interface Question {
  qnum: number;
  qtype: ObjectiveQType;
  answerKey: string[];
}

const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

// --- Every objective qtype, all answered correctly ------------------------
// Choice types submit the option string exactly as it appears in `options`;
// the answer keys are lowercase, so this also exercises normalization.
const allTypes: Question[] = [
  { qnum: 1, qtype: "mcq", answerKey: ["reduce the distance food travels"] },
  { qnum: 2, qtype: "tfng", answerKey: ["not given"] },
  { qnum: 3, qtype: "ynng", answerKey: ["yes"] },
  { qnum: 4, qtype: "matching", answerKey: ["paragraph c"] },
  { qnum: 5, qtype: "gap_fill", answerKey: ["led lamps", "leds"] },
  { qnum: 6, qtype: "short_answer", answerKey: ["hydroponic"] },
];

const allCorrect = gradeAnswers(allTypes, {
  1: "Reduce the distance food travels",
  2: "NOT GIVEN",
  3: "YES",
  4: "Paragraph C",
  5: "LEDs",
  6: "hydroponic",
});
check("every qtype accepts a correct answer", allCorrect.scoreRaw, 6);
check("every qtype: scoreTotal", allCorrect.scoreTotal, 6);
check(
  "every qtype: all marked correct",
  allCorrect.perQuestion.map((r) => r.correct),
  [true, true, true, true, true, true],
);

const allWrong = gradeAnswers(allTypes, {
  1: "lower the price of electricity",
  2: "TRUE",
  3: "NO",
  4: "Paragraph D",
  5: "sunlight",
  6: "soil",
});
check("every qtype rejects a wrong answer", allWrong.scoreRaw, 0);

// --- Normalization: trim → lowercase → collapse whitespace ----------------
const normalization: Question[] = [
  { qnum: 1, qtype: "gap_fill", answerKey: ["the sun"] },
  { qnum: 2, qtype: "gap_fill", answerKey: ["leafy greens"] },
  { qnum: 3, qtype: "short_answer", answerKey: ["  Vertical   Farming "] },
];
const normalized = gradeAnswers(normalization, {
  1: "  The Sun ",
  2: "leafy\t\ngreens",
  3: "vertical farming",
});
check(
  "normalization: '  The Sun ' ≡ 'the sun'",
  normalized.perQuestion[0].correct,
  true,
);
check(
  "normalization: internal whitespace collapses",
  normalized.perQuestion[1].correct,
  true,
);
check(
  "normalization: applies to the answer key too",
  normalized.perQuestion[2].correct,
  true,
);
check("normalization: given is trimmed for display", normalized.perQuestion[0].given, "The Sun");

// --- Multi-key acceptance -------------------------------------------------
const multiKey: Question[] = [
  { qnum: 1, qtype: "gap_fill", answerKey: ["led lamps", "leds"] },
];
check(
  "multi-key: first entry accepted",
  gradeAnswers(multiKey, { 1: "LED lamps" }).scoreRaw,
  1,
);
check(
  "multi-key: second entry accepted",
  gradeAnswers(multiKey, { 1: "leds" }).scoreRaw,
  1,
);
check(
  "multi-key: a non-listed answer is rejected",
  gradeAnswers(multiKey, { 1: "led" }).scoreRaw,
  0,
);

// --- Missing / empty answers ---------------------------------------------
const missing: Question[] = [
  { qnum: 1, qtype: "tfng", answerKey: ["true"] },
  { qnum: 2, qtype: "gap_fill", answerKey: ["electricity"] },
  { qnum: 3, qtype: "mcq", answerKey: ["it will play a useful but limited role"] },
];
const blank = gradeAnswers(missing, {});
check("all-blank: scoreRaw is 0", blank.scoreRaw, 0);
check("all-blank: scoreTotal still counts every question", blank.scoreTotal, 3);
check("all-blank: one result per question", blank.perQuestion.length, 3);
check(
  "all-blank: given is the empty string",
  blank.perQuestion.map((r) => r.given),
  ["", "", ""],
);
check(
  "whitespace-only answer is unanswered, not correct",
  gradeAnswers(missing, { 2: "   " }).perQuestion[1],
  { qnum: 2, correct: false, given: "" },
);
check(
  "an empty answer key never matches an empty answer",
  gradeAnswers([{ qnum: 1, qtype: "gap_fill", answerKey: [] }], { 1: "" }).scoreRaw,
  0,
);
check(
  "partial answers score only what was answered",
  gradeAnswers(missing, { 1: "TRUE", 2: "" }).scoreRaw,
  1,
);
check(
  "answers for unknown qnums are ignored",
  gradeAnswers(missing, { 1: "true", 99: "true" }).scoreRaw,
  1,
);
check("no questions: scoreTotal is 0", gradeAnswers([], {}).scoreTotal, 0);

// --- Band table edges -----------------------------------------------------
check("reading 30/40 → 7.0", rawToBand("reading", 30, 40), 7.0);
check("reading 29/40 → 6.5", rawToBand("reading", 29, 40), 6.5);
check("reading 40/40 → 9.0", rawToBand("reading", 40, 40), 9.0);
check("reading 39/40 → 9.0", rawToBand("reading", 39, 40), 9.0);
check("reading 38/40 → 8.5", rawToBand("reading", 38, 40), 8.5);
check("reading 13/40 → 4.5", rawToBand("reading", 13, 40), 4.5);
check("reading 12/40 → 4.0", rawToBand("reading", 12, 40), 4.0);
check("reading 5/40 → 2.5", rawToBand("reading", 5, 40), 2.5);
check("reading 0/40 → 2.5", rawToBand("reading", 0, 40), 2.5);

check("listening 32/40 → 7.5", rawToBand("listening", 32, 40), 7.5);
check("listening 31/40 → 7.0", rawToBand("listening", 31, 40), 7.0);
check("listening 30/40 → 7.0", rawToBand("listening", 30, 40), 7.0);
check("listening 29/40 → 6.5", rawToBand("listening", 29, 40), 6.5);
check("listening 26/40 → 6.5", rawToBand("listening", 26, 40), 6.5);
check("listening 18/40 → 5.5", rawToBand("listening", 18, 40), 5.5);
check("listening 17/40 → 5.0", rawToBand("listening", 17, 40), 5.0);
check("listening 15/40 → 4.5", rawToBand("listening", 15, 40), 4.5);

// The two tables genuinely diverge at 32 and at 18; guard against a copy-paste
// that collapses them into one.
check("reading 32/40 → 7.0", rawToBand("reading", 32, 40), 7.0);
check("listening 32/40 → 7.5 at the same raw score", rawToBand("listening", 32, 40), 7.5);
check("reading 18/40 → 5.0", rawToBand("reading", 18, 40), 5.0);
check("listening 18/40 → 5.5 at the same raw score", rawToBand("listening", 18, 40), 5.5);

// --- Band is null for anything that is not a full 40-question paper -------
check("13/13 → null (not a 40-question paper)", rawToBand("reading", 13, 13), null);
check("0/13 → null", rawToBand("reading", 0, 13), null);
check("39/39 → null", rawToBand("listening", 39, 39), null);
check("41-question paper → null", rawToBand("reading", 40, 41), null);
check("0/0 → null", rawToBand("reading", 0, 0), null);

// --- The week_02 unit-9 shape: 13 correct, no band ------------------------
const unit9: Question[] = [
  { qnum: 1, qtype: "tfng", answerKey: ["true"] },
  { qnum: 2, qtype: "tfng", answerKey: ["false"] },
  { qnum: 3, qtype: "tfng", answerKey: ["not given"] },
  { qnum: 4, qtype: "tfng", answerKey: ["true"] },
  { qnum: 5, qtype: "tfng", answerKey: ["not given"] },
  { qnum: 6, qtype: "gap_fill", answerKey: ["led lamps", "leds"] },
  { qnum: 7, qtype: "gap_fill", answerKey: ["hydroponic"] },
  { qnum: 8, qtype: "gap_fill", answerKey: ["electricity"] },
  { qnum: 9, qtype: "gap_fill", answerKey: ["leafy greens"] },
  { qnum: 10, qtype: "mcq", answerKey: ["reduce the distance food travels"] },
  { qnum: 11, qtype: "mcq", answerKey: ["to illustrate that staple crops are uneconomical to grow vertically"] },
  { qnum: 12, qtype: "mcq", answerKey: ["it will play a useful but limited role"] },
  { qnum: 13, qtype: "mcq", answerKey: ["describe the industry's financial difficulties"] },
];
// Submitted exactly as the options render them (uppercase TRUE/FALSE/NOT GIVEN,
// sentence-case MCQ text) — the seed's keys assume this.
const perfect = gradeAnswers(unit9, {
  1: "TRUE",
  2: "FALSE",
  3: "NOT GIVEN",
  4: "TRUE",
  5: "NOT GIVEN",
  6: "LED lamps",
  7: "hydroponic",
  8: "electricity",
  9: "leafy greens",
  10: "reduce the distance food travels",
  11: "to illustrate that staple crops are uneconomical to grow vertically",
  12: "It will play a useful but limited role",
  13: "describe the industry's financial difficulties",
});
check("unit 9 all-correct: scoreRaw", perfect.scoreRaw, 13);
check("unit 9 all-correct: scoreTotal", perfect.scoreTotal, 13);
check(
  "unit 9 all-correct: band is null",
  rawToBand("reading", perfect.scoreRaw, perfect.scoreTotal),
  null,
);
const unit9Blank = gradeAnswers(unit9, {});
check("unit 9 all-blank: scoreRaw", unit9Blank.scoreRaw, 0);
check("unit 9 all-blank: 13 results", unit9Blank.perQuestion.length, 13);

// --- Report ---------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n${failures.length} grading check(s) FAILED:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log("All grading checks passed.");
