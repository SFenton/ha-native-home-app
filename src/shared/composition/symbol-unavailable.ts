import { z } from 'zod/v4';

/**
 * The `unavailable` field of a wire `sf-symbol`: what the app does when the device has no such symbol.
 *
 * The app draws a fallback symbol (`questionmark.circle`) for a device gap and never rejects the document, so the one value
 * the Studio emits is `"fallback"`. `"reject"` is the legacy alias an older or imported document may still carry: it is
 * accepted on input and rewritten to `"fallback"` on output, so a compiled document never holds it.
 */
export const symbolUnavailable = z.preprocess(
  value => (value === 'reject' ? 'fallback' : value),
  z.literal('fallback'),
);
