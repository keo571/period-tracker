import { PeriodTrackerError, type IsoDate } from "./types.js";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Days since the Unix epoch for a calendar date. Uses UTC so DST never shifts a day. */
function toDayNumber(date: IsoDate): number {
  const match = ISO_DATE.exec(date);
  if (!match) {
    throw new PeriodTrackerError("INVALID_DATE", `"${date}" is not a date in YYYY-MM-DD format.`);
  }
  const [, y, m, d] = match.map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new PeriodTrackerError("INVALID_DATE", `"${date}" is not a real calendar date.`);
  }
  return ms / MS_PER_DAY;
}

function fromDayNumber(day: number): IsoDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Throws `INVALID_DATE` unless `date` is a real `YYYY-MM-DD` calendar date. */
export function assertIsoDate(date: IsoDate): void {
  toDayNumber(date);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Today's calendar date in the given IANA time zone (or the host's local zone). */
export function todayIn(timeZone?: string, now: Date = new Date()): IsoDate {
  let format: Intl.DateTimeFormat;
  try {
    // en-CA formats as YYYY-MM-DD.
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    throw new PeriodTrackerError("INVALID_INPUT", `"${timeZone}" is not a valid IANA time zone.`);
  }
  return format.format(now);
}
