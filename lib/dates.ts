import "server-only";

/**
 * Date formatting and day boundaries.
 *
 * WHY TIMEZONE IS EXPLICIT EVERYWHERE
 * -----------------------------------
 * "Today's sales" is the single most important number in this product, and it
 * is a *local* concept: a shop in Lagos closing at 9pm wants everything rung up
 * since that morning, not since midnight UTC (which is 1am Lagos). Getting this
 * wrong shifts an hour of every evening's takings into the next day's report —
 * a bug that is invisible in development and obvious to the owner on day one.
 *
 * So: every day boundary is computed against the organization's timezone, and
 * every formatter is passed one explicitly. There is no implicit "server local
 * time" anywhere in this codebase.
 */

export const DEFAULT_TIMEZONE = "Africa/Lagos";
export const DEFAULT_LOCALE = "en-NG";

/**
 * Midnight-to-midnight in `timeZone`, expressed as UTC instants for a Prisma
 * `gte`/`lt` range.
 *
 * Works by asking Intl what the wall-clock date is in that zone, then measuring
 * the zone's offset at that moment and subtracting it. That handles DST without
 * a timezone library — and Nigeria has no DST today, but this product should
 * not quietly break if it is ever sold into a zone that does.
 */
export function dayRange(
  date: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): { start: Date; end: Date } {
  const { year, month, day } = zonedParts(date, timeZone);
  const start = zonedMidnightUtc(year, month, day, timeZone);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** The same, for a span of whole days ending today (inclusive). */
export function lastNDaysRange(
  days: number,
  timeZone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const { end } = dayRange(now, timeZone);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

/** First instant of the current month, in `timeZone`. */
export function monthRange(
  date: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): { start: Date; end: Date } {
  const { year, month } = zonedParts(date, timeZone);
  const start = zonedMidnightUtc(year, month, 1, timeZone);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = zonedMidnightUtc(nextYear, nextMonth, 1, timeZone);
  return { start, end };
}

/**
 * "2026-03-14" — the calendar date at `date`, as seen in `timeZone`.
 *
 * This is the key used to line a grouped SQL result up with a run of days. The
 * database groups by `(soldAt AT TIME ZONE 'UTC' AT TIME ZONE tz)` rendered as
 * text, and this produces the same string for the same day, so the join is a
 * plain string lookup with no date arithmetic and no chance of an off-by-one
 * from a server whose own clock is in another zone.
 */
export function isoDateInZone(
  date: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

function zonedMidnightUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  // Start from the naive UTC instant, then correct by the zone's offset there.
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offsetMs = zoneOffsetMs(new Date(naive), timeZone);
  return new Date(naive - offsetMs);
}

/** How far ahead of UTC `timeZone` is at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    // Intl renders midnight as "24" in some engines under hour12:false.
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

// ─────────────────────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────────────────────

/** "14 Mar 2026" */
export function formatDate(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** "14 Mar" — chart axes and anywhere the year is obvious from context. */
export function formatDayShort(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
  }).format(date);
}

/** "14 Mar 2026, 3:42 pm" */
export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** "3:42 pm" — for today's sale lists, where the date is redundant. */
export function formatTime(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * "in 12 days", "3 days ago", "today".
 *
 * Used for expiry dates and subscription renewals, where the exact date matters
 * less than how much time is left.
 */
export function relativeDays(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const days = daysBetween(now, date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) {
    if (days < 30) return `in ${days} days`;
    const months = Math.round(days / 30);
    return months === 1 ? "in about a month" : `in ${months} months`;
  }
  const ago = Math.abs(days);
  if (ago < 30) return `${ago} days ago`;
  const months = Math.round(ago / 30);
  return months === 1 ? "about a month ago" : `${months} months ago`;
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** `n` days from now, as a UTC instant. */
export function daysFromNow(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
