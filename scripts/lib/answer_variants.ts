/**
 * Printed answer keys separate accepted alternatives with a slash — the IELTS
 * sample-task book says so on its own answers pages ("Alternative answers are
 * separated by a slash (/)"). The grader compares a submitted answer against
 * whole `answer_key` entries, so a key left as the combined string `X/Y` marks
 * a correct answer wrong.
 *
 * Turning `X/Y` into two entries is a **mechanical schema normalization, not a
 * content edit** — ruled so by the architect in `tasks/phase_04_vocab_srs.md`,
 * and recorded in CLAUDE.md. The same accepted answers, expressed the way the
 * grader can match them. Nothing here invents, rewords or drops an answer.
 *
 * Pure and dependency-free so `scripts/check_split.ts` can fixture-test it:
 * `scripts/ingest.ts` runs a pipeline on import, which a check script must not.
 */

/** Word counts an IELTS instruction line spells out ("NO MORE THAN TWO WORDS"). */
const SPELLED_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

/** Generous fallback when the task prints no word limit of its own. */
export const DEFAULT_SPLIT_WORD_LIMIT = 4;

/**
 * The word limit a task prints, taken from whichever of its question prompts
 * carries the instruction line. Null when the task prints none (matching,
 * multiple choice), in which case `DEFAULT_SPLIT_WORD_LIMIT` applies.
 */
export function detectWordLimit(prompts: string[]): number | null {
  for (const prompt of prompts) {
    const capped = prompt.match(/NO MORE THAN\s+(ONE|TWO|THREE|FOUR|FIVE)\s+WORDS?/i);
    if (capped) return SPELLED_NUMBERS[capped[1].toLowerCase()];
    if (/\b(ONE WORD ONLY|A SINGLE WORD)\b/i.test(prompt)) return 1;
  }
  return null;
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter((word) => word !== "").length;
}

function bracketsBalanced(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export interface SplitOutcome {
  /** The entries this key becomes: the variants, or `[key]` when not split. */
  parts: string[];
  /** Why the split was refused, or null when it went ahead. */
  refused: string | null;
}

/**
 * Split one printed key into its variants, or refuse and say why.
 *
 * Not every printed slash separates two standalone answers, so a fragment that
 * is not plausible on its own blocks the split:
 *  - the key carries no letters — a fraction or a date (`1/2`, `12/05/2023`);
 *  - a fragment breaks a bracket pair — `(a/the) condenser` is one answer with
 *    an optional article, not two;
 *  - a fragment is empty, or longer than the task's printed word limit;
 *  - the fragments differ in length and the slash is unspaced —
 *    `pure/distilled water` and `South African tunneling/tunnelling` are
 *    elisions where the shorter side borrows words from the longer one, so
 *    splitting naively would produce an answer (`tunnelling`) the source never
 *    prints. A spaced slash (`two to five / 2-5`) is a typesetter separating
 *    whole alternatives, and splits whatever the lengths.
 *
 * The caller reports both outcomes, so review.md shows what happened to every
 * key before anything is committed.
 */
export function splitPrintedKey(key: string, wordLimit: number): SplitOutcome {
  if (!key.includes("/")) return { parts: [key], refused: null };

  const spaced = /\s\/\s/.test(key);
  const parts = key.split("/").map((part) => part.trim());
  const counts = parts.map(wordCount);

  let refused: string | null = null;
  if (!/[A-Za-z]/.test(key)) {
    refused =
      "it contains no letters, so the slash is part of the answer itself (a fraction or a date)";
  } else if (parts.some((part) => part === "")) {
    refused = "splitting it would leave an empty variant";
  } else if (parts.some((part) => !bracketsBalanced(part))) {
    refused = "a variant would break a bracket pair, so the slash is inside one answer";
  } else if (counts.some((count) => count > wordLimit)) {
    refused = `a variant would exceed the task's ${wordLimit}-word limit`;
  } else if (!spaced && new Set(counts).size > 1) {
    refused =
      "the slash is unspaced and the variants differ in length, so the shorter one " +
      "probably borrows words from the longer one rather than standing alone";
  }

  return refused === null ? { parts, refused: null } : { parts: [key], refused };
}
