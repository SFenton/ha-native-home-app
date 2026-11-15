import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { symbolUnavailable } from '../src/shared/composition/symbol-unavailable';

const base = () => JSON.parse(readFileSync(new URL('./fixtures/composition-first-slice.json', import.meta.url), 'utf8')).document;

/** Sets `unavailable` on every wire symbol of a document, in place. */
function setUnavailable(node: unknown, value: string): number {
  let count = 0;
  if (Array.isArray(node)) for (const item of node) count += setUnavailable(item, value);
  else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record.type === 'sf-symbol') { record.unavailable = value; count += 1; }
    for (const child of Object.values(record)) count += setUnavailable(child, value);
  }
  return count;
}
const unavailableValues = (document: unknown): Set<unknown> => {
  const found = new Set<unknown>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (record.type === 'sf-symbol') found.add(record.unavailable);
      Object.values(record).forEach(walk);
    }
  };
  walk(document);
  return found;
};

describe('symbol unavailable policy', () => {
  it('accepts "fallback" and leaves it as it is', () => {
    const document = base();
    expect(setUnavailable(document, 'fallback')).toBeGreaterThan(0);
    expect(unavailableValues(compileCompositionDocument(document).document)).toEqual(new Set(['fallback']));
  });
  it('accepts the legacy "reject" and compiles it to "fallback", with the same capabilities', () => {
    const legacy = base(), current = base();
    setUnavailable(legacy, 'reject'); setUnavailable(current, 'fallback');
    const compiled = compileCompositionDocument(legacy);
    expect(unavailableValues(compiled.document)).toEqual(new Set(['fallback']));
    expect(compiled).toEqual(compileCompositionDocument(current));
  });
  it('refuses any other value', () => {
    for (const value of ['', 'draw', 'Fallback', 'reject '] as const) {
      expect(symbolUnavailable.safeParse(value).success, value).toBe(false);
    }
    const document = base();
    setUnavailable(document, 'ignore');
    expect(() => compileCompositionDocument(document)).toThrow();
  });
  it('parses both values to "fallback"', () => {
    expect(symbolUnavailable.parse('fallback')).toBe('fallback');
    expect(symbolUnavailable.parse('reject')).toBe('fallback');
  });
});
