import type { DateStyle } from './expression';
import { clockToday, clockTime, daysFromCivil, wallTime, type Clock, type WallTime } from './pipeline/dates';

/**
 * The date styles of a `format` operand (`formats[name] = { date: { style } }`, `sh.pipeline-operands@1`), drawn in United States English.
 * The app draws them with its own formatters in the phone's language and region; this file is the Studio's rendering and the one the evaluation
 * corpus pins (`en_US`, the clock's fixed offset), all integer arithmetic so no time-zone database or `Intl` is involved. A style is a name, never a
 * pattern string: a pattern would freeze one region's order into every published layout.
 *
 * | Style | Example |
 * |---|---|
 * | `short-date` | `Nov 12`; with the year when it is not the clock's year: `Nov 12, 2025` |
 * | `long-date` | `November 12, 2026` |
 * | `weekday-date` | `Thu, Nov 12` |
 * | `time` | `9:41 AM` (a date without a time is midnight: `12:00 AM`) |
 * | `date-time` | `Nov 12 at 9:41 AM` (the short date's year rule) |
 * | `relative` | `Today`, `Yesterday`, `Tomorrow`, `3 days ago`, `In 3 days`: whole days on the clock |
 * | `hour` | `7 PM`, `12 AM`: the hour only (`sh.flow-extras@1`; native `WeatherDates.hour`, `WeatherDates.swift:55-59`) |
 * | `weekday` | `Mon`: the short weekday name (`sh.flow-extras@1`; native `WeatherDates.weekday`, `WeatherDates.swift:61-66`) |
 *
 * `short-date`, `date-time` and `relative` need the clock (they ask what today is); without one they have no text. The value is a date or a date
 * and time, moved to the clock's offset; anything else has no text.
 */
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Year, month (1 to 12) and day of the month of a count of days since 1970-01-01 (Howard Hinnant's `civil_from_days`). */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1, month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function clockText(seconds: number): string {
  const hour = Math.floor(seconds / 3600), minute = Math.floor(seconds / 60) % 60;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The text of `text` (a date or a date and time) in `style` on `clock`, or undefined when there is none. */
export function formatDate(style: DateStyle, text: string, clock: Clock | undefined): string | undefined {
  const time: WallTime | undefined = wallTime(text, clock?.utcOffsetMinutes ?? 0);
  if (!time) return undefined;
  const { year, month, day } = civilFromDays(time.days);
  const monthShort = months[month - 1].slice(0, 3);
  const today = () => {
    if (!clock || !clockTime(clock)) return undefined;
    const [y, m, d] = clockToday(clock)!.split('-').map(Number);
    return { year: y, days: daysFromCivil(y, m, d) };
  };
  switch (style) {
    case 'long-date': return `${months[month - 1]} ${day}, ${year}`;
    case 'weekday-date': return `${weekdays[(((time.days + 4) % 7) + 7) % 7]}, ${monthShort} ${day}`;
    case 'time': return clockText(time.seconds);
    case 'hour': { const hour = Math.floor(time.seconds / 3600); return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`; }
    case 'weekday': return weekdays[(((time.days + 4) % 7) + 7) % 7];
    case 'short-date': case 'date-time': {
      const now = today();
      if (!now) return undefined;
      const date = `${monthShort} ${day}${year === now.year ? '' : `, ${year}`}`;
      return style === 'short-date' ? date : `${date} at ${clockText(time.seconds)}`;
    }
    case 'relative': {
      const now = today();
      if (!now) return undefined;
      const apart = time.days - now.days;
      return apart === 0 ? 'Today' : apart === -1 ? 'Yesterday' : apart === 1 ? 'Tomorrow' : apart < 0 ? `${-apart} days ago` : `In ${apart} days`;
    }
  }
}
