import type { DurationStyle, DurationUnit } from './expression';
import { roundHalfAwayFromZero } from './pipeline/text';

/**
 * The duration styles of a `format` operand (`formats[name] = { duration: { style, unit? } }`, `sh.duration-format@1`), drawn in United States English
 * with integer arithmetic so TypeScript and Swift agree (`ServerUIDurationFormat`). The argument is a number of seconds; `unit: 'minutes'` says a
 * `compact` duration's number is minutes. A number of `1e13` or more, in either sign, has no text.
 *
 * | Style | Example | Rule (native counterpart) |
 * |---|---|---|
 * | `compact` | `30m`, `1h`, `1h 30m` | `HumidifierController.formatMinutes`. Minutes round to the nearest whole minute (a tie away from zero); seconds round **up** to whole minutes, at least 1 (`formatSeconds`). No text for 0 or less, so the slot's fallback ("Off") draws |
 * | `clock` | `05:00`, `01:00:00` | `BathroomFanController.formatRemaining`: whole seconds rounded down, never below `00:00`; hours only from one hour; two digits each, more when there are more |
 * | `minutes-seconds` | `4:30`, `75:00` | `BedFormat.countdown`: seconds rounded **up**, never below `0:00`; unbounded minutes |
 * | `span` | `1 hour`, `3 days`, `3 weeks`, `2 months` | `TodoItem.dueLabel`: the size of the number, sign ignored: under a day in hours, under 21 days in days, under 60 days in weeks, else months of 30 days; the amount is rounded (a tie away from zero), at least 1; plural unless 1 |
 */
export function formatDuration(style: DurationStyle, unit: DurationUnit | undefined, number: number): string | undefined {
  if (!Number.isFinite(number) || Math.abs(number) >= 1e13) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (style) {
    case 'compact': {
      const minutes = unit === 'minutes' ? roundHalfAwayFromZero(number) : number > 0 ? Math.max(1, Math.ceil(number / 60)) : 0;
      if (minutes <= 0) return undefined;
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60), rest = minutes % 60;
      return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
    }
    case 'clock': {
      const total = Math.max(0, Math.floor(number));
      const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
      return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
    }
    case 'minutes-seconds': {
      const total = Math.max(0, Math.ceil(number));
      return `${Math.floor(total / 60)}:${pad(total % 60)}`;
    }
    case 'span': {
      const magnitude = Math.abs(number), hour = 3600, day = 24 * hour;
      const [name, divisor] = magnitude < day ? ['hour', hour] as const : magnitude < 21 * day ? ['day', day] as const
        : magnitude < 60 * day ? ['week', 7 * day] as const : ['month', 30 * day] as const;
      const amount = Math.max(1, roundHalfAwayFromZero(magnitude / divisor));
      return `${amount} ${name}${amount === 1 ? '' : 's'}`;
    }
  }
}
