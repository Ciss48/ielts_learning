/**
 * Word counting — pure, and the ONE definition of it in the app.
 *
 * It lives in its own module rather than in `writing.ts` because the writing
 * panel counts words on every keystroke in the browser, and `writing.ts` is
 * server-only: it reaches `ai.ts` and therefore `config.ts`. `writing.ts`
 * re-exports `countWords` so the Phase 05 contract is satisfied from one
 * implementation, and the client imports it from here.
 *
 * IELTS counts what the candidate wrote, so the rule is deliberately the
 * simplest one that matches how a human counts a page: split on whitespace, and
 * a token counts if it contains a letter or a digit. A hyphenated compound is
 * one word ("well-being"), a number is one word ("1990", "12%"), and a stray
 * dash or bullet left on its own line is not a word at all.
 */

/**
 * Below this, there is nothing to grade. Fifty words is not a short essay, it
 * is an abandoned one — a model asked to apply the band descriptors to it will
 * invent a reading of an essay that does not exist. It lives here, beside the
 * counting rule it is measured with, so the browser can state the threshold
 * without importing the server-only grading module.
 */
export const MIN_ESSAY_WORDS = 50;

/** A token is a word if it contains at least one letter or digit. */
const WORD_TOKEN = /[\p{L}\p{N}]/u;

export function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((token) => WORD_TOKEN.test(token)).length;
}
