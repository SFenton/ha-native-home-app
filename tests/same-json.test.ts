import { describe, expect, it } from 'vitest';
import { canonicalCompositionJSON } from '../src/shared/composition/json';
import { sameJson } from '../src/sameJson';

describe('sameJson', () => {
  it('answers as the canonical text does', () => {
    const shared = { deep: [1, 2, { three: 3 }] };
    const cases: [unknown, unknown][] = [
      [{ a: 1, b: shared }, { b: shared, a: 1 }], [{ a: 1 }, { a: 2 }], [{ a: 1 }, { a: 1, b: 2 }], [[1, 2], [2, 1]], [[], {}], [null, {}], ['x', 'x'],
      [{ a: [{ b: 'c' }] }, { a: [{ b: 'c' }] }], [{ a: undefined }, {}],
    ];
    for (const [left, right] of cases) {
      const canonical = (() => { try { return canonicalCompositionJSON(left) === canonicalCompositionJSON(right); } catch { return undefined; } })();
      if (canonical !== undefined) expect(sameJson(left, right), JSON.stringify([left, right])).toBe(canonical);
    }
  });
  it('does not look inside a branch both sides share', () => {
    const shared = new Proxy({}, { ownKeys() { throw new Error('walked a shared branch'); } });
    expect(sameJson({ a: shared, t: 'x' }, { a: shared, t: 'x' })).toBe(true);
    expect(sameJson({ a: shared, t: 'x' }, { a: shared, t: 'y' })).toBe(false);
  });
});
