/**
 * The date rules of a Data Flow, all integer arithmetic so TypeScript and Swift agree and no time-zone database is involved.
 *
 * A date is `YYYY-MM-DD`; a date and time is `YYYY-MM-DD[T or space]HH:MM[:SS[.fraction]]` with an optional `Z` or `±HH:MM`.
 * The clock a flow runs with is the viewer's wall clock (`now`, `YYYY-MM-DDTHH:MM:SS`) and its offset from UTC in minutes. A date
 * and time with an offset is moved to that clock; one without is already on it; a date has no time (midnight). A value that does
 * not parse, or is not a real calendar date, has no date: comparing it answers no and measuring it gives `null`.
 */

/** A moment on the flow's wall clock: whole days since 1970-01-01, and seconds into that day. */
export interface WallTime { days: number; seconds: number }
/** The clock a flow runs with. */
export interface Clock { now: string; utcOffsetMinutes: number }

/** Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's `days_from_civil`). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400), yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
const monthLength = (year: number, month: number) => [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
/** Whether the three numbers are a real calendar date (year 1 to 9999). */
export const isCalendarDate = (year: number, month: number, day: number): boolean =>
  year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= monthLength(year, month);

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
/** Whether the text is a date. */
export function isDateText(text: string): boolean {
  const found = datePattern.exec(text);
  return Boolean(found) && isCalendarDate(Number(found![1]), Number(found![2]), Number(found![3]));
}
/** Whether the text is a date and time. */
export function isDateTimeText(text: string): boolean {
  const found = dateTimePattern.exec(text);
  if (!found) return false;
  const [hour, minute, second] = [Number(found[4]), Number(found[5]), Number(found[6] ?? 0)];
  const zone = found[7] && found[7] !== 'Z' ? [Number(found[7].slice(1, 3)), Number(found[7].slice(4, 6))] : [0, 0];
  return isCalendarDate(Number(found[1]), Number(found[2]), Number(found[3])) && hour < 24 && minute < 60 && second < 60 && zone[0] < 24 && zone[1] < 60;
}
/** The moment `text` names on a wall clock `utcOffsetMinutes` from UTC, or undefined when it is not a date or a date and time. */
export function wallTime(text: string, utcOffsetMinutes: number): WallTime | undefined {
  if (isDateText(text)) {
    const [, year, month, day] = datePattern.exec(text)!;
    return { days: daysFromCivil(Number(year), Number(month), Number(day)), seconds: 0 };
  }
  if (!isDateTimeText(text)) return undefined;
  const found = dateTimePattern.exec(text)!;
  const days = daysFromCivil(Number(found[1]), Number(found[2]), Number(found[3]));
  const seconds = Number(found[4]) * 3600 + Number(found[5]) * 60 + Number(found[6] ?? 0);
  const zone = found[7];
  if (!zone) return { days, seconds };
  const own = zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const total = days * 86400 + seconds + (utcOffsetMinutes - own) * 60;
  return { days: Math.floor(total / 86400), seconds: total - Math.floor(total / 86400) * 86400 };
}
/** A wall time as one integer, for comparing. */
export const instant = (time: WallTime): number => time.days * 86400 + time.seconds;
/** The wall time of the clock itself, or undefined when `now` does not parse. */
export const clockTime = (clock: Clock): WallTime | undefined =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(clock.now) ? wallTime(clock.now, clock.utcOffsetMinutes) : undefined;
/** `YYYY-MM-DD` of the clock's day, or undefined when `now` does not parse. */
export const clockToday = (clock: Clock): string | undefined => clockTime(clock) ? clock.now.slice(0, 10) : undefined;
/** Whole calendar days from the date of `from` to the date of `to` (positive when `to` is later), or undefined when either is not a date. */
export function daysBetween(from: string, to: string, utcOffsetMinutes: number): number | undefined {
  const a = wallTime(from, utcOffsetMinutes), b = wallTime(to, utcOffsetMinutes);
  return a && b ? b.days - a.days : undefined;
}

/**
 * Whole seconds from the moment `from` to the moment `to` (`sh.countdown@1`, the `seconds-between` operation of a `date` operand): positive when `to` is later,
 * both moved to the clock's wall like every date. `undefined` when either is not a date or a date and time. A date is midnight; a fraction of a second is dropped.
 */
export function secondsBetween(from: string, to: string, utcOffsetMinutes: number): number | undefined {
  const a = wallTime(from, utcOffsetMinutes), b = wallTime(to, utcOffsetMinutes);
  return a && b ? instant(b) - instant(a) : undefined;
}

/**
 * How far the clock has come from the moment `from` to the moment `to` (`sh.flow-extras@1`, the `progress` operation of a `date` operand): `0` at `from`,
 * `1` at `to`, clamped to that range, from the instants on the clock's wall time in whole seconds. `undefined` when either moment is not a date or a date
 * and time, when the clock does not parse, or when `to` is not after `from` (there is no span to measure).
 * Native counterpart: `WeatherPresentation.sun` (`WeatherPresentation.swift:255-263`), `clampPercent(now - previousRising) / (setting - previousRising)`.
 */
export function progressBetween(from: string, to: string, clock: Clock): number | undefined {
  const start = wallTime(from, clock.utcOffsetMinutes), end = wallTime(to, clock.utcOffsetMinutes), now = clockTime(clock);
  if (!start || !end || !now) return undefined;
  const span = instant(end) - instant(start);
  if (span <= 0) return undefined;
  return Math.min(1, Math.max(0, (instant(now) - instant(start)) / span));
}
