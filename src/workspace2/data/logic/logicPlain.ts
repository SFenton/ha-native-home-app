import type { CompositionDocument } from '../../../shared/composition/schema';
import { expandLogic, usesLogic } from '../../../shared/composition/logic-library';

const cache = new WeakMap<object, unknown>();
/**
 * The document as the app would draw it: every logic use worked out, no library. The simulator and the preview read this; the editors keep the draft. A
 * draft whose logic cannot be worked out (a half-made template) is handed back as it is, so the preview never blanks (the guard falls back to the last good one).
 */
export function plainDocument<T extends CompositionDocument | undefined>(document: T): T {
  if (!document || !usesLogic(document)) return document;
  const held = cache.get(document);
  if (held) return held as T;
  let plain: unknown = document;
  try { plain = expandLogic(document).document; } catch { plain = document; }
  cache.set(document, plain);
  return plain as T;
}
