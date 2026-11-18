import { describe, expect, it } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { moveCompositionNode } from '../src/composition-editor';
import { buildDocumentIndex } from '../src/preview2/model';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { endOf } from '../src/workspace2/add/insert';
import { moveToSlot, validSlots } from '../src/workspace2/dnd/moves';
import { setFoldSide } from '../src/workspace2/layout/fold-sides-edit';

const home = homeDomains.document as unknown as CompositionDocument;
const homeIndex = home.pages.findIndex(page => page.id === 'page-home');
const pinned = setFoldSide(home, ['pages', homeIndex, 'components', 1], 'trailing');
const MOVED = 'hc-weather-summary';
const sideOf = (document: CompositionDocument) => {
  const entry = [...buildDocumentIndex(document).entries.values()].find(item => item.node?.id === MOVED)!;
  return { entry, side: (entry.node!.layout as { foldSide?: string }).foldSide };
};

describe('moving a node with a fold side off a page top level drops the side (sh.fold-sides@1)', () => {
  it('starts with a side the document accepts', () => {
    expect(sideOf(pinned).side).toBe('trailing');
    expect(() => compileCompositionDocument(pinned)).not.toThrow();
  });
  it('drops it when a drag lands the node in a sheet', () => {
    const { entry } = sideOf(pinned);
    // A sheet is another surface: a drop there names its owner and list directly.
    const end = endOf(pinned, 'modal:hc-weather-sheet')!;
    const slot = { ...end, index: 0, count: end.index, title: 'Weather' };
    const moved = moveToSlot(pinned, entry.key, slot).document;
    expect(sideOf(moved).entry.path[0]).toBe('modals');
    expect(sideOf(moved).side).toBeUndefined();
    expect(() => compileCompositionDocument(moved)).not.toThrow();
  });
  it('drops it when a drag lands the node in a section', () => {
    const { entry } = sideOf(pinned);
    const slot = validSlots(pinned, entry.key).find(item => item.owner === 'node:hc-home-cameras')!;
    const moved = moveToSlot(pinned, entry.key, slot).document;
    expect(sideOf(moved).entry.path.length).toBeGreaterThan(4);
    expect(sideOf(moved).side).toBeUndefined();
    expect(() => compileCompositionDocument(moved)).not.toThrow();
  });
  it('keeps it when a drag reorders the node at the top level of its page', () => {
    const { entry } = sideOf(pinned);
    const slot = validSlots(pinned, entry.key).find(item => item.list.join('/') === `pages/${homeIndex}/components` && item.index === 4)!;
    expect(slot).toBeTruthy();
    expect(sideOf(moveToSlot(pinned, entry.key, slot).document).side).toBe('trailing');
  });
  it('drops it for the move menu into a sheet and into a section', () => {
    const toSheet = moveCompositionNode(pinned, MOVED, { kind: 'surface', id: 'hc-weather-sheet' });
    expect(sideOf(toSheet).side).toBeUndefined();
    expect(() => compileCompositionDocument(toSheet)).not.toThrow();
    const toSection = moveCompositionNode(pinned, MOVED, { kind: 'section', id: 'hc-home-cameras' });
    expect(sideOf(toSection).side).toBeUndefined();
    expect(() => compileCompositionDocument(toSection)).not.toThrow();
  });
  it('keeps it when the move menu puts the node on another page', () => {
    const other = home.pages.find(page => page.id !== 'page-home')!;
    const moved = moveCompositionNode(pinned, MOVED, { kind: 'surface', id: other.id });
    expect(sideOf(moved).side).toBe('trailing');
  });
});
