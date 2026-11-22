import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex } from '../src/preview2/model';
import { initialNav, navigateTo, reduceNavigation, currentSurface } from '../src/preview2/navigation';
import { componentLocations } from '../src/composition-editor';
import { endOf, insertType } from '../src/workspace2/add/insert';
import { moveToSlot, validSlots } from '../src/workspace2/dnd/moves';
import { moveNodeTo, moveTargets } from '../src/workspace2/nodeActions';
import { demoDocument, push } from './preview2-gc-fixture';
import { runChecks } from '../src/workspace2/checks';
import { listedSurface, sheetForLevel, survivingSurface } from '../src/workspace2/selection';

/** The demo document: level A holds the tile `demo_level_a_to_demo_level_b` and `demo_level_a_to_demo_plain`; level B the same pair; `demo_level_alone` one tile. */
const doc: CompositionDocument = demoDocument();
const tileA = 'node:demo_level_a_to_demo_level_b';

describe('editing inside a level (sl-surface)', () => {
  it('endOf answers for a level, so a level has an end to add to', () => {
    const end = endOf(doc, 'level:demo_level_a')!;
    expect(end).toMatchObject({ list: ['levels', 0, 'components'], owner: 'level:demo_level_a' });
    expect(end.index).toBe(doc.levels![0].components.length);
    const empty = { ...doc, levels: doc.levels!.map(level => level.id === 'demo_level_b' ? { ...level, components: [] } : level) } as CompositionDocument;
    expect(endOf(empty, 'level:demo_level_b')).toMatchObject({ list: ['levels', 1, 'components'], index: 0 });
  });

  it('adds a tile at the end of a level and leaves pages[] and modals[] alone', () => {
    const result = insertType(doc, endOf(doc, 'level:demo_level_a')!, 'action-tile');
    expect(result.document.levels![0].components).toHaveLength(doc.levels![0].components.length + 1);
    expect(result.document.pages).toBe(doc.pages);
    expect(result.document.modals).toBe(doc.modals);
  });

  it('lists the level\'s own root list among the slots a tile can be dragged to', () => {
    const slots = validSlots(doc, tileA as never);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every(slot => slot.owner === 'level:demo_level_a' || buildDocumentIndex(doc).get(slot.owner)?.surface === 'level:demo_level_a')).toBe(true);
    expect(slots.some(slot => slot.owner === 'level:demo_level_a' && slot.list.join('/') === 'levels/0/components')).toBe(true);
  });

  it('drags a tile to the end of its level\'s root list, and nothing else changes', () => {
    const end = validSlots(doc, tileA as never).find(slot => slot.owner === 'level:demo_level_a' && slot.index === slot.count)!;
    const moved = moveToSlot(doc, tileA as never, end, { validate: false });
    expect(moved.document.levels![0].components.at(-1)!.id).toBe('demo_level_a_to_demo_level_b');
    expect(moved.document.pages).toBe(doc.pages);
    expect(moved.document.modals).toBe(doc.modals);
  });

  it('finds a level\'s nodes among the component locations', () => {
    expect(componentLocations(doc).find(item => item.node.id === 'demo_level_a_to_demo_level_b')).toMatchObject({ path: ['levels', 0, 'components', 0], parent: 'demo_level_a' });
  });

  it('offers a level as a place to move to, grouped as a level, and titles its containers from levels[]', () => {
    const targets = moveTargets(doc, 'demo_level_a_to_demo_level_b');
    expect(targets).toContainEqual(expect.objectContaining({ label: 'The level itself', group: 'Demo Level B · Level', parent: { kind: 'surface', id: 'demo_level_b' } }));
    // The node's own level is offered too, as the page it sits on is.
    expect(targets.some(target => target.group === 'Demo Level A · Level')).toBe(true);
  });

  it('Move To moves a node within a level and between levels, into levels[] and never into pages[]', () => {
    const into = moveNodeTo(doc, 'demo_level_a_to_demo_level_b', { kind: 'surface', id: 'demo_level_b' });
    expect(into.levels![1].components.some(node => node.id === 'demo_level_a_to_demo_level_b')).toBe(true);
    expect(into.levels![0].components.some(node => node.id === 'demo_level_a_to_demo_level_b')).toBe(false);
    expect(into.pages).toEqual(doc.pages);
    // Within its own level the node goes to the end.
    const within = moveNodeTo(doc, 'demo_level_a_to_demo_level_b', { kind: 'surface', id: 'demo_level_a' });
    expect(within.levels![0].components.at(-1)!.id).toBe('demo_level_a_to_demo_level_b');
    // Out of a level and onto a page.
    const out = moveNodeTo(doc, 'demo_level_a_to_demo_level_b', { kind: 'surface', id: 'page-home' });
    expect(out.pages.find(page => page.id === 'page-home')!.components.some(node => node.id === 'demo_level_a_to_demo_level_b')).toBe(true);
    expect(out.levels![0].components.some(node => node.id === 'demo_level_a_to_demo_level_b')).toBe(false);
    // And a page's node into a level.
    const home = doc.pages.find(page => page.id === 'page-home')!.components.at(-1)!.id;
    expect(moveNodeTo(doc, home, { kind: 'surface', id: 'demo_level_b' }).levels![1].components.some(node => node.id === home)).toBe(true);
  });

  it('indexes the same nodes the edits address', () => {
    expect(buildDocumentIndex(doc).get(tileA as never)?.path).toEqual(['levels', 0, 'components', 0]);
  });
});

describe('a level drawn alone follows what it pushes', () => {
  const alone = { ...doc, levels: doc.levels!.map(level => level.id === 'demo_level_alone' ? { ...level, components: [{ ...(level.components[0] as object), id: 'demo_alone_to_b', action: push('demo_level_b') }] } : level) } as CompositionDocument;
  it('keeps the alone frame and pushes the level onto it, with Back to the alone level', () => {
    const shown = navigateTo(alone, initialNav(alone), { kind: 'level', id: 'demo_level_alone' });
    const pushed = reduceNavigation(alone, shown, push('demo_level_b') as never);
    expect(pushed.sheets).toEqual([{ modalId: 'demo_level_alone', pages: ['demo_level_b'], alone: true }]);
    expect(currentSurface(alone, pushed)).toEqual({ kind: 'level', id: 'demo_level_b' });
    const back = reduceNavigation(alone, pushed, { type: 'back' });
    expect(currentSurface(alone, back)).toEqual({ kind: 'level', id: 'demo_level_alone' });
  });
});

describe('going to a level (selectAnywhere and Checks)', () => {
  it('names the sheet of a level reached without one, so deleting the level falls back to its sheet', () => {
    const sheet = listedSurface({ kind: 'level', id: 'demo_level_a' }, doc)!;
    const held = { kind: 'level' as const, id: 'demo_level_a', sheetId: sheet.id };
    const without = { ...doc, levels: doc.levels!.filter(level => level.id !== 'demo_level_a') } as CompositionDocument;
    expect(survivingSurface(held, without)).toEqual({ kind: 'modal', id: 'demo_sheet' });
  });

  it('the "has no way in" suggestion of a level no sheet opens goes to the level', () => {
    const row = runChecks(doc).suggestions.find(item => item.id === 'no-way-in-level-demo_level_alone')!;
    expect(row).toMatchObject({ sentence: 'Demo Level Alone has no way in.', select: 'level:demo_level_alone' });
  });
});

describe('the sheet a level is shown in when the Studio goes to it', () => {
  /** Two sheets that both reach `demo_level_a`. */
  const two = (() => {
    const sheet = { ...structuredClone(doc.modals.find(modal => modal.id === 'demo_sheet')!), id: 'demo_sheet_2', title: 'Demo Sheet 2' };
    return { ...doc, modals: [...doc.modals, sheet] } as CompositionDocument;
  })();

  it('takes the first sheet in document order when none is open', () => {
    expect(sheetForLevel(undefined, two, 'demo_level_a')).toBe('demo_sheet');
    expect(sheetForLevel({ kind: 'page', id: 'page-home' }, two, 'demo_level_a')).toBe('demo_sheet');
  });

  it('keeps the sheet already open when it reaches the level, on its root or on a level inside it', () => {
    expect(sheetForLevel({ kind: 'modal', id: 'demo_sheet_2' }, two, 'demo_level_a')).toBe('demo_sheet_2');
    expect(sheetForLevel({ kind: 'level', id: 'demo_level_b', sheetId: 'demo_sheet_2' }, two, 'demo_level_a')).toBe('demo_sheet_2');
  });

  it('falls back to document order when the open sheet does not reach the level, and to nothing for a level no sheet reaches', () => {
    expect(sheetForLevel({ kind: 'modal', id: 'hc-overview-lights' }, two, 'demo_level_a')).toBe('demo_sheet');
    expect(sheetForLevel({ kind: 'modal', id: 'demo_sheet_2' }, two, 'demo_level_alone')).toBeUndefined();
  });
});
