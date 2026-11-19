import { canonicalOfBounded, MAX_COMPOSITION_BYTES, reject } from '../json';
import { record } from './anchors';
import { resolveLogicUseBindings } from './bindings';

/** Bounds have already been checked by the expander. Only root draft fields are removed. */
export function prepareStudioDocument(input: unknown): ReturnType<typeof resolveLogicUseBindings> {
  if (!record(input) || (!Object.hasOwn(input, 'studioCanvas') && !Object.hasOwn(input, 'logicUseBindings'))) return { document: input, bindings: [] };
  if (new TextEncoder().encode(canonicalOfBounded(input)).byteLength > MAX_COMPOSITION_BYTES) reject('limit_exceeded', '');
  const resolved = resolveLogicUseBindings(input);
  if (!record(resolved.document)) throw new Error('Missing checked draft document');
  const { studioCanvas: _layout, logicUseBindings: _bindings, ...document } = resolved.document;
  return { document, bindings: resolved.bindings };
}
