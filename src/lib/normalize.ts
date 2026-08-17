/**
 * The single definition of answer normalization.
 *
 * Phase 02 defined this rule inside the grader. Phase 03 added a validator that
 * has to decide whether an `answer_key` entry matches one of `options` — and it
 * must decide it *exactly* the way the grader will at run time, or content could
 * pass validation and still be ungradeable. So the rule lives here, imported by
 * both `src/lib/tests.ts` (grading) and `scripts/lib/validate.ts` (content).
 *
 * Rule: trim → lowercase → collapse internal whitespace to single spaces.
 */
export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
