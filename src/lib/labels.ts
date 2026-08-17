/**
 * Presentation labels for roadmap enums. Pure functions — no data access.
 * Colour variables come from `globals.css` (ported from the design export).
 */

import type { Block, Skill } from "@/lib/roadmap";
import { USER_TIME_ZONE } from "@/lib/day";

/** Plan: 6 units per week, one flex/rest day. See docs/plan.md. */
export const UNITS_PER_WEEK = 6;

export const SKILL_LABEL: Record<Skill, string> = {
  reading: "Reading",
  listening: "Listening",
  writing: "Writing",
  speaking: "Speaking",
  vocab: "Vocab",
  mixed: "Mixed",
};

export const SKILL_COLOR: Record<Skill, string> = {
  reading: "var(--sk-reading)",
  listening: "var(--sk-listening)",
  writing: "var(--sk-writing)",
  speaking: "var(--sk-speaking)",
  vocab: "var(--sk-vocab)",
  mixed: "var(--sk-mixed)",
};

export const BLOCK_LABEL: Record<Block, string> = {
  foundation: "Foundation",
  diagnostic: "Diagnostic",
  skill_cycle: "Skill cycles",
  mock: "Mock block",
  taper: "Taper",
};

/** Canonical display order of the roadmap blocks. */
export const BLOCK_ORDER: Block[] = [
  "foundation",
  "diagnostic",
  "skill_cycle",
  "mock",
  "taper",
];

export function weekOfSeq(seq: number): number {
  return Math.ceil(seq / UNITS_PER_WEEK);
}

/** Zero-padded unit number, matching the design's `Unit 07` treatment. */
export function unitNumber(seq: number): string {
  return String(seq).padStart(2, "0");
}

/** Today's date in the user's timezone, e.g. `Mon 17 Aug`. */
export function formatToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: USER_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(now);
}
