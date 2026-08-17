/**
 * Raw score → IELTS band estimate (Academic conversion tables).
 *
 * The published tables only define a band for a full 40-question paper. A
 * 13-question practice set has no official equivalent, so `rawToBand` returns
 * null for any total other than 40 rather than inventing a proportional band —
 * a made-up number on a practice set is worse than no number at all.
 *
 * Pure module: no I/O, no data access.
 */

/** `[minimum raw score, band]`, ordered descending so the first match wins. */
type BandRow = readonly [min: number, band: number];

const READING_TABLE: readonly BandRow[] = [
  [39, 9.0],
  [37, 8.5],
  [35, 8.0],
  [33, 7.5],
  [30, 7.0],
  [27, 6.5],
  [23, 6.0],
  [19, 5.5],
  [15, 5.0],
  [13, 4.5],
  [10, 4.0],
  [8, 3.5],
  [6, 3.0],
  [0, 2.5],
];

const LISTENING_TABLE: readonly BandRow[] = [
  [39, 9.0],
  [37, 8.5],
  [35, 8.0],
  [32, 7.5],
  [30, 7.0],
  [26, 6.5],
  [23, 6.0],
  [18, 5.5],
  [16, 5.0],
  [13, 4.5],
  [10, 4.0],
  [8, 3.5],
  [6, 3.0],
  [0, 2.5],
];

/** Official-style raw→band conversion. Returns null unless total === 40. */
export function rawToBand(
  skill: "reading" | "listening",
  raw: number,
  total: number,
): number | null {
  if (total !== 40) return null;

  const table = skill === "reading" ? READING_TABLE : LISTENING_TABLE;
  const clamped = Math.max(0, Math.min(40, Math.trunc(raw)));

  // The final row's min is 0, so a non-negative score always matches.
  return table.find(([min]) => clamped >= min)?.[1] ?? null;
}
