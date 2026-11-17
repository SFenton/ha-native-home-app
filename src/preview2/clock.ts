import { useEffect, useMemo, useState } from 'react';
import type { Clock } from '../shared/composition/pipeline/dates';

/** The wall clock of `date` in this browser's zone, as the contract's `Clock`: `now` is `YYYY-MM-DDTHH:MM:SS` and the offset is in minutes. */
export function wallClock(date: Date = new Date()): Clock {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    now: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    utcOffsetMinutes: -date.getTimezoneOffset(),
  };
}

/** Whether a document reads the clock to the second (`clock` part `now-second`, `sh.countdown@1`), so the preview must tick once a second. */
export const readsSecondClock = (document: unknown): boolean => JSON.stringify(document).includes('"now-second"');

/**
 * The clock a preview evaluates with. It moves once a minute, like the app's minute tick, and once a second only while `everySecond` is true (a document
 * that reads `now-second`): a document with no countdown costs no timer faster than a minute, and the interval is cleared the moment it stops reading.
 */
export function usePreviewClock(everySecond: boolean): Clock {
  const [clock, setClock] = useState(() => wallClock());
  useEffect(() => {
    // The same second is the same clock, so a change of rate (or a first mount) re-renders nothing.
    const tick = () => setClock(before => { const next = wallClock(); return before.now === next.now && before.utcOffsetMinutes === next.utcOffsetMinutes ? before : next; });
    tick();
    const timer = setInterval(tick, everySecond ? 1000 : 60_000);
    return () => clearInterval(timer);
  }, [everySecond]);
  return clock;
}

/** `readsSecondClock` of a document, computed again only when the document is a different object. */
export const useReadsSecondClock = (document: unknown): boolean => useMemo(() => readsSecondClock(document), [document]);
