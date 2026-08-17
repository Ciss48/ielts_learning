/**
 * Calendar days in the user's timezone — the one definition of "today".
 *
 * The app is single-user and that user is in Asia/Ho_Chi_Minh, so every date the
 * database stores (`study_log.day`, `vocab_cards.due_date`) is a *calendar day
 * there*, not a UTC instant. Getting this wrong is the classic bug: a session
 * finished at 11pm local is 4pm UTC the same day, but a card reviewed at 7am
 * local is 12am UTC — the day before. So days are handled as `YYYY-MM-DD`
 * strings throughout, exactly as Postgres `date` stores them.
 *
 * Arithmetic runs in UTC on purpose: a `YYYY-MM-DD` string is anchored to
 * midnight UTC, stepped by whole days, and formatted back. That is
 * daylight-saving-proof, and Vietnam has no DST anyway.
 *
 * Extracted from `roadmap.ts` in Phase 04, which had the only copy, because the
 * vocabulary scheduler and the study heatmap need the same notion of today.
 */

export const USER_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Today in the user's timezone as `YYYY-MM-DD`. */
export function today(): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the `date` literal we need.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: USER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `day` shifted by whole days; negative goes back. */
export function addDays(day: string, days: number): string {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. The heatmap's rows run Monday-first. */
export function weekdayIndex(day: string): number {
  return (toUtc(day).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `day`. */
export function startOfWeek(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** A long label for a tooltip, e.g. "Mon 17 Aug 2026". */
export function formatDayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(toUtc(day));
}
