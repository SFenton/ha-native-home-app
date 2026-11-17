import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../src/preview2/fixtures/home-domains.json';
import { compositionErrors } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { moveToSlot, validSlots } from '../src/workspace2/dnd/moves';

// Counting the whole-document passes is the budget: a drop must not wait for one.
vi.mock('../src/shared/composition/compiler', async importOriginal => {
  const original = await importOriginal<typeof import('../src/shared/composition/compiler')>();
  return { ...original, compileCompositionDocument: vi.fn(original.compileCompositionDocument) };
});
const compile = vi.mocked(compileCompositionDocument);
beforeEach(() => { compile.mockClear(); });

describe('dropping a tile', () => {
  it('moves without compiling; the compiler is asked once, after the drop is on screen, and its answer is reused', () => {
    const document = structuredClone(fixture.document) as unknown as CompositionDocument;
    const tile = 'node:hc-home-guest-0' as const;
    const slot = validSlots(document, tile)[0];
    compositionErrors(document);
    compile.mockClear();
    const moved = moveToSlot(document, tile, slot, { validate: false });
    expect(moved.document).not.toBe(document);
    expect(compile).toHaveBeenCalledTimes(0);
    compositionErrors(moved.document);
    compositionErrors(moved.document);
    expect(compile).toHaveBeenCalledTimes(1);
  });
});
