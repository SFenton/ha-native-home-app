import { describe, expect, it } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { DRAFT_HISTORY, createDraft } from '../src/workspace2/editors/draft';

const home = homeDomains.document as unknown as CompositionDocument;
const titled = (title: string): CompositionDocument => ({ ...home, name: title });

describe('the draft history (D9)', () => {
  it('undo steps the draft, redo steps forward, and neither touches what the draft opened with', () => {
    const draft = createDraft(home);
    expect(draft.canUndo()).toBe(false);
    const one = titled('one'), two = titled('two');
    draft.set(one); draft.set(two);
    expect(draft.get()).toBe(two);
    draft.undo();
    expect(draft.get()).toBe(one);
    draft.undo();
    expect(draft.get()).toBe(home);
    expect(draft.canUndo()).toBe(false);
    expect(draft.dirty()).toBe(false);
    draft.redo();
    expect(draft.get()).toBe(one);
    expect(draft.canRedo()).toBe(true);
  });
  it('a new edit clears redo', () => {
    const draft = createDraft(home);
    draft.set(titled('a')); draft.undo();
    draft.set(titled('b'));
    expect(draft.canRedo()).toBe(false);
  });
  it('typing in one field coalesces into one step, a pause or another field starts a new one', () => {
    let now = 0;
    const draft = createDraft(home, () => now);
    const first = { ...home, name: 'a' } as CompositionDocument;
    draft.set(first, 'field');
    now += 100; draft.set({ ...home, name: 'ab' } as CompositionDocument, 'field');
    now += 100; draft.set({ ...home, name: 'abc' } as CompositionDocument, 'field');
    draft.undo();
    expect(draft.get()).toBe(home);
    expect(draft.canUndo()).toBe(false);
  });
  it('remembers 100 steps and no more', () => {
    const draft = createDraft(home);
    for (let step = 0; step < DRAFT_HISTORY + 20; step += 1) draft.set(titled(String(step)));
    let undone = 0;
    while (draft.canUndo()) { draft.undo(); undone += 1; }
    expect(undone).toBe(DRAFT_HISTORY);
  });
  it('leaving with changes asks, leaving clean does not', () => {
    const draft = createDraft(home);
    expect(draft.tryLeave()).toBe(true);
    draft.set(titled('x'));
    expect(draft.tryLeave()).toBe(false);
    expect(draft.prompt.get()).toBe(true);
  });
});
