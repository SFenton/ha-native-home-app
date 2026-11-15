import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compositionErrors } from '../src/composition-editor';
import { buildDocumentIndex } from '../src/preview2/model';
import { moveToSlot, placementOf, spoken, validSlots } from '../src/workspace2/dnd/moves';
import { endOf } from '../src/workspace2/add/insert';
import { filterMoveTargets, groupMoveTargets, moveTargets } from '../src/workspace2/nodeActions';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
const doc = fixture.document;
const index = buildDocumentIndex(doc);
const tile = [...index.entries.values()].find(entry => entry.node?.type === 'action-tile')!;

describe('moves', () => {
  it('lists slots in document order, never inside the node or where it already is', () => {
    const slots = validSlots(doc, tile.key);
    expect(slots.length).toBeGreaterThan(2);
    expect(slots.some(slot => slot.owner === tile.key)).toBe(false);
    const own = slots.filter(slot => slot.list.join('/') === tile.path.slice(0, -1).join('/'));
    const at = Number(tile.path.at(-1));
    expect(own.some(slot => slot.index === at || slot.index === at + 1)).toBe(false);
    const orders = slots.map(slot => index.keys.indexOf(slot.owner));
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('moves a tile to the end of another container, keeps its identity and compiles', () => {
    const target = validSlots(doc, tile.key).find(slot => slot.owner !== tile.parent)!;
    const result = moveToSlot(doc, tile.key, target);
    expect(compositionErrors(result.document)).toEqual([]);
    const moved = buildDocumentIndex(result.document).get(tile.key)!;
    expect(moved.parent).toBe(target.owner);
    expect(result.placement.of).toBeGreaterThan(0);
    expect(spoken.moved('Evening lights', result.placement)).toMatch(/^Moved Evening lights to position \d+ of \d+ in /);
  });

  it('refuses a move into itself', () => {
    const grid = [...index.entries.values()].find(entry => entry.node?.type === 'tile-grid')!;
    const inside = endOf(doc, grid.key)!;
    expect(() => moveToSlot(doc, grid.key, { ...inside, owner: grid.key })).toThrow(/inside itself/);
  });

  it('reorders within one list the way Move Down does', () => {
    const grid = [...index.entries.values()].find(entry => entry.node?.type === 'tile-grid' && (entry.node as { children: unknown[] }).children.length > 2)!;
    const first = index.children(grid.key)[0];
    const slot = validSlots(doc, first).find(candidate => candidate.owner === grid.key && candidate.index === 2)!;
    const result = moveToSlot(doc, first, slot);
    const order = (result.document as unknown as never, buildDocumentIndex(result.document).children(grid.key));
    expect(order[1]).toBe(first);
    expect(placementOf(doc, first, slot).position).toBe(2);
  });
});

describe('Move To… targets', () => {
  const targets = moveTargets(doc, tile.node!.id);
  it('belong to a page or sheet group and keep document order within it', () => {
    expect(targets.length).toBeGreaterThan(10);
    expect(targets.every(target => /· (Page|Sheet)$/.test(target.group))).toBe(true);
    const groups = groupMoveTargets(targets);
    expect(groups.flatMap(group => group.targets)).toHaveLength(targets.length);
    expect(new Set(groups.map(group => group.group)).size).toBe(groups.length);
    expect(groups.every(group => group.targets[0].parent.kind === 'surface')).toBe(true);
  });
  it('tell two containers of the same name apart by page or by the containers around them', () => {
    const byName = new Map<string, typeof targets>();
    for (const target of targets) byName.set(target.label, [...byName.get(target.label) ?? [], target]);
    const clashes = [...byName.values()].filter(list => list.length > 1);
    expect(clashes.length).toBeGreaterThan(0);
    for (const list of clashes) {
      const keys = list.map(target => `${target.group}|${target.trail.join('>')}`);
      expect(new Set(keys).size, list[0].label).toBe(list.length);
    }
  });
  it('are found by name, page or the containers around them, and an empty search keeps them all', () => {
    expect(filterMoveTargets(targets, '')).toHaveLength(targets.length);
    const camera = filterMoveTargets(targets, 'cameras');
    expect(camera.length).toBeGreaterThan(0);
    expect(camera.length).toBeLessThan(targets.length);
    expect(camera.every(target => /cameras/i.test([target.label, target.group, ...target.trail].join(' ')))).toBe(true);
    const page = targets.find(target => target.trail.length > 0)!;
    expect(filterMoveTargets(targets, `${page.trail[0]} ${page.label}`.toUpperCase())).toContain(page);
    expect(filterMoveTargets(targets, 'zzzz-nothing')).toEqual([]);
  });
});
