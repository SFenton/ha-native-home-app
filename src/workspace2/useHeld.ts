import { useRef } from 'react';

/**
 * The value while it is there, and the last one while it is gone. A dialog's popup keeps drawing the words it had while it fades out: unmounting the
 * popup at the moment `open` turns false leaves the backdrop in its ending state, blocking the page, because nothing is left to finish the transition.
 */
export function useHeld<T>(value: T | undefined): T | undefined {
  const last = useRef<T | undefined>(undefined);
  if (value !== undefined) last.current = value;
  return value ?? last.current;
}
