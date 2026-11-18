import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandDocument } from '../src/shared/composition/components';
import {
  analyseRepeat, defaultUnchecked, findRepeats, planRepeat, repeatSteps, REPEAT_LIMITS, REPEAT_MIN_TILE_PLACES, type RepeatAnalysis, type RepeatClass,
} from '../src/shared/composition/repeats';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { runChecks } from '../src/workspace2/checks';
import { groupLabels } from '../src/workspace2/repeats/repeatWords';
import { saveRepeat } from '../src/workspace2/repeats/saveRepeat';

type J = Record<string, any>;
const fixture = (): CompositionDocument => JSON.parse(readFileSync('tests/fixtures/templates-repeats.json', 'utf8')).document;

const tile = (id: string, title: string, entity: string): J => ({ id, title, type: 'state-tile', layout: {}, icon: { type: 'sf-symbol', name: 'house', rendering: 'canonical', unavailable: 'fallback' }, props: {}, binding: { entityId: entity, builtIn: 'switch' } });
const actionTile = (id: string, title: string, source: string): J => ({
  id, title, type: 'action-tile', layout: { span: 1 }, icon: { type: 'sf-symbol', name: 'power', rendering: 'canonical', unavailable: 'fallback' },
  binding: { sourceId: source, projection: 'power-tile@1' }, props: { family: 'occupancy', bodyActionId: 'power', actionOrder: ['power'] },
  action: { type: 'domain', sourceId: source, intent: 'power.toggle' },
});
const grid = (id: string, title: string, children: J[], columns = 4): J => ({ id, title, type: 'tile-grid', layout: { span: 1 }, props: { maxColumns: columns, spacing: { type: 'token', name: 'm' } }, children });

/** A document shell with one page holding `components`, which is all the walk reads. */
const withPage = (components: J[], more: J[] = []): CompositionDocument => ({ ...fixture(), pages: [{ ...fixture().pages[0], components }, ...more], modals: [] } as unknown as CompositionDocument);

describe('the walk', () => {
  it('finds the tile grid three times and the section twice on the fixture, largest first', () => {
    const result = findRepeats(fixture());
    expect(result.classes.map(item => [item.type, item.size, item.places.length])).toEqual([['tile-grid', 4, 3], ['section', 4, 2]]);
    expect(result.placeCount).toBe(5);
    expect(result.classes[0].places.map(place => place.nodeId)).toEqual(['rep-grid-kitchen', 'rep-grid-hall', 'rep-grid-study']);
    expect(result.classes[0].places[0].surface).toMatchObject({ kind: 'page', title: 'Home' });
  });

  it('counts only pieces of 3 or more nodes', () => {
    const pairs = withPage([grid('a', 'A', [tile('a1', 'x', 'switch.demo_a1')]), grid('b', 'B', [tile('b1', 'y', 'switch.demo_b1')])]);
    expect(findRepeats(pairs).classes).toEqual([]);
    const triples = withPage([grid('a', 'A', [tile('a1', 'x', 'switch.demo_a1'), tile('a2', 'x', 'switch.demo_a2')]), grid('b', 'B', [tile('b1', 'y', 'switch.demo_b1'), tile('b2', 'y', 'switch.demo_b2')])]);
    expect(findRepeats(triples).classes.map(item => item.size)).toEqual([3]);
  });

  it('lists the outermost piece only', () => {
    const inner = (id: string) => grid(`g${id}`, 'Inner', [tile(`t${id}1`, 'a', `switch.demo_${id}1`), tile(`t${id}2`, 'b', `switch.demo_${id}2`)]);
    const outer = (id: string) => ({ id: `s${id}`, title: 'Outer', type: 'section', layout: { span: 1 }, props: { header: 'H', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children: [inner(id)] });
    const result = findRepeats(withPage([outer('1'), outer('2')]));
    expect(result.classes.map(item => [item.type, item.size])).toEqual([['section', 4]]);
  });

  it('does not take a piece that holds a template place', () => {
    const ref = (id: string) => ({ id, type: 'component-ref', componentId: 'x', layout: { span: 1 } });
    const result = findRepeats(withPage([grid('a', 'A', [ref('r1'), ref('r2')]), grid('b', 'B', [ref('r3'), ref('r4')])]));
    expect(result.classes).toEqual([]);
  });

  it('tells two shapes apart by the kind, control and family in the skeleton', () => {
    const family = (id: string, kind: string) => ({ ...actionTile(id, id, `src-${id}`), props: { family: kind, bodyActionId: 'power', actionOrder: ['power'] } });
    const a = grid('a', 'A', [family('a1', 'occupancy'), family('a2', 'occupancy')]), b = grid('b', 'B', [family('b1', 'lights'), family('b2', 'lights')]);
    expect(findRepeats(withPage([a, b])).classes).toEqual([]);
  });

  it('reads the tab a place sits in', () => {
    const tabs = (id: string) => ({ id, title: 'T', type: 'local-tabs', layout: { span: 1 }, props: {}, tabs: [{ id: `${id}-one`, label: 'Lights', icon: { type: 'sf-symbol', name: 'house', rendering: 'canonical', unavailable: 'fallback' }, children: [grid(`${id}-g`, 'G', [tile(`${id}-1`, 'a', `switch.demo_${id}1`), tile(`${id}-2`, 'b', `switch.demo_${id}2`)]), ...(id === 'x' ? [tile('x-extra', 'e', 'switch.demo_extra')] : [])] }] });
    // The two containers are not the same shape, so the grid inside each is the piece that repeats.
    const result = findRepeats(withPage([tabs('x'), tabs('y')]));
    const places = result.classes.flatMap(item => item.places);
    expect(places.length).toBeGreaterThan(0);
    expect(places[0].tab).toEqual({ id: 'x-one', label: 'Lights' });
  });

  it('runs a surface at a time, so a caller can yield between tasks', () => {
    const doc = withPage([], [{ ...fixture().pages[0], id: 'p2', components: [] }, { ...fixture().pages[0], id: 'p3', components: [] }]);
    const run = repeatSteps(doc);
    let steps = 0;
    for (;;) { const step = run.next(); if (step.done) break; steps += 1; }
    expect(steps).toBe(doc.pages.length + doc.modals.length);
  });
});

describe('what differs', () => {
  const analysed = (): { doc: CompositionDocument; analysis: RepeatAnalysis } => {
    const doc = fixture();
    return { doc, analysis: analyseRepeat(doc, findRepeats(doc).classes[0]) };
  };

  it('lists the title and entity of each tile, never an id, and names the field a template cannot set', () => {
    const { analysis } = analysed();
    expect(analysis.groups.map(group => [group.kind, group.fields.map(field => `${field.index}:${field.field}`)])).toEqual([
      ['text', ['0:title']], ['text', ['1:title']], ['entity-id', ['1:binding/entityId']], ['text', ['2:title']], ['entity-id', ['2:binding/entityId']], ['text', ['3:title']], ['entity-id', ['3:binding/entityId']],
    ]);
    expect(analysis.groups.every(group => group.distinct === 3)).toBe(true);
    expect(analysis.unsettable.map(field => [field.field, field.values])).toEqual([['props/maxColumns', ['4', '4', '3']]]);
    expect(analysis.groups.flatMap(group => group.fields).some(field => field.field === 'id')).toBe(false);
  });

  it('puts fields that always change together in one row', () => {
    const doc = withPage([0, 1, 2].map(n => grid(`g${n}`, 'Same', [actionTile(`a${n}1`, 'Lamp', `src-${n}-1`), actionTile(`a${n}2`, 'Lamp', `src-${n}-2`)])));
    const analysis = analyseRepeat(doc, findRepeats(doc).classes[0]);
    const both = analysis.groups.filter(group => group.fields.length === 2);
    expect(both.map(group => group.fields.map(field => field.field))).toEqual([['binding/sourceId', 'action/sourceId'], ['binding/sourceId', 'action/sourceId']]);
    expect(analysis.groups.every(group => group.kind === 'source-id')).toBe(true);
  });

  it('numbers rows that share a label', () => {
    const { analysis } = analysed();
    expect([...groupLabels(analysis).values()]).toEqual(['Title 1', 'Title 2', 'Entity 1', 'Title 3', 'Entity 2', 'Title 4', 'Entity 3']);
  });

  it('calls a field with another length or a missing key a field a template cannot set', () => {
    const doc = withPage([0, 1].map(n => grid(`g${n}`, 'Same', [{ ...actionTile(`a${n}1`, 'Lamp', 'src'), props: { family: 'occupancy', bodyActionId: 'power', actionOrder: n ? ['power', 'more'] : ['power'] } }, actionTile(`a${n}2`, 'Lamp', 'src'), actionTile(`a${n}3`, 'Lamp', 'src')])));
    const analysis = analyseRepeat(doc, findRepeats(doc).classes[0]);
    expect(analysis.unsettable.map(field => field.field)).toContain('props/actionOrder#length');
  });
});

describe('the plan', () => {
  it('starts with every place and every group checked', () => {
    const doc = fixture(), analysis = analyseRepeat(doc, findRepeats(doc).classes[0]);
    const plan = planRepeat(analysis, defaultUnchecked(analysis));
    expect(plan.checked).toHaveLength(7);
    // The study grid differs in a number, which a template cannot set: it stays as it is.
    expect(plan.kept).toEqual([0, 1]);
    expect(plan.reasons).toEqual([{ places: 1, field: analysis.unsettable[0] }]);
  });

  it('leaves out the places that differ in an unchecked field', () => {
    // Four places; the first group's value is shared by three of them.
    const place = (n: number, icon: string) => grid(`g${n}`, 'Same', [actionTile(`a${n}1`, 'Lamp', `src-${n}`), { ...actionTile(`a${n}2`, 'Lamp', `src-b-${n}`), icon: { type: 'sf-symbol', name: icon, rendering: 'canonical', unavailable: 'fallback' } }]);
    const doc = withPage([place(0, 'power'), place(1, 'power'), place(2, 'power'), place(3, 'bolt')]);
    const analysis = analyseRepeat(doc, findRepeats(doc).classes[0]);
    const symbol = analysis.groups.find(group => group.kind === 'symbol')!;
    const all = planRepeat(analysis, new Set());
    expect(all.kept).toEqual([0, 1, 2, 3]);
    const some = planRepeat(analysis, new Set([symbol.id]));
    expect(some.kept).toEqual([0, 1, 2]);
    expect(some.reasons).toEqual([{ places: 1, group: symbol }]);
    expect(some.checked).not.toContain(symbol);
  });

  it('checks the 16 groups with the most different values, and leaves the rest unchecked', () => {
    const wide = withPage([0, 1, 2].map(n => grid(`g${n}`, 'Same', Array.from({ length: 20 }, (_, at) => actionTile(`t${n}-${at}`, `Tile ${at}`, `src-${n}-${at}`)))));
    const wideAnalysis = analyseRepeat(wide, findRepeats(wide).classes[0]);
    expect(wideAnalysis.groups.length).toBe(20);
    const unchecked = defaultUnchecked(wideAnalysis);
    expect(unchecked.size).toBe(4);
    expect(planRepeat(wideAnalysis, unchecked).checked).toHaveLength(REPEAT_LIMITS.params);
  });
});

describe('Save as Template', () => {
  /** Every node without its id: what a place draws, since the ids inside a place change when it becomes a reference. */
  const drawn = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(drawn);
    if (value === null || typeof value !== 'object') return value;
    const { id, ...rest } = value as J;
    void id;
    return Object.fromEntries(Object.entries(rest).map(([key, inner]) => [key, drawn(inner)]));
  };
  const labelsOf = (analysis: RepeatAnalysis) => groupLabels(analysis);

  it('draws every place as it did: the expanded document is the same before and after', () => {
    const doc = fixture(), cls = findRepeats(doc).classes[0], analysis = analyseRepeat(doc, cls);
    const plan = planRepeat(analysis, defaultUnchecked(analysis));
    const saved = saveRepeat(doc, analysis, plan, 'Lamp Grid', labelsOf(analysis));
    const before = expandDocument(doc), after = expandDocument(saved.document);
    expect(drawn(after.pages)).toEqual(drawn(before.pages));
    expect(after.dataSources).toEqual(before.dataSources);
    // The place left out is still the plain tile grid it was.
    const kept = new Set(plan.kept.map(at => cls.places[at].nodeId));
    const places = saved.document.pages[0].components.filter(node => node.type === 'component-ref');
    expect(places.map(node => node.id)).toEqual([...kept]);
    expect(saved.document.pages[0].components.find(node => node.id === 'rep-grid-study')?.type).toBe('tile-grid');
  });

  it('adds the entry with a parameter for each checked group, and gives each place its own values', () => {
    const doc = fixture(), analysis = analyseRepeat(doc, findRepeats(doc).classes[0]);
    const plan = planRepeat(analysis, defaultUnchecked(analysis));
    const saved = saveRepeat(doc, analysis, plan, 'Lamp Grid', labelsOf(analysis));
    const entry = saved.document.componentLibrary!.at(-1)!;
    expect(entry.name).toBe('Lamp Grid');
    expect(entry.params).toHaveLength(7);
    expect(entry.params![0]).toMatchObject({ name: 'title_1', kind: 'text', label: 'Title 1' });
    expect(entry.bindings).toHaveLength(7);
    expect(entry.node.layout.span).toBe(1);
    const first = saved.document.pages[0].components[0] as J;
    expect(first.type).toBe('component-ref');
    expect(first.args.title_1).toBe('Kitchen');
    expect(first.args.entity_1).toBe('switch.demo_kitchen_0');
    expect(saved.message).toBe('Saved Lamp Grid. 2 places use it.');
    expect(runChecks(saved.document).problems).toEqual(runChecks(doc).problems);
  });

  it('is one document, and leaves the one it was given as it was', () => {
    const doc = fixture(), analysis = analyseRepeat(doc, findRepeats(doc).classes[0]);
    const saved = saveRepeat(doc, analysis, planRepeat(analysis, new Set()), 'Everything', labelsOf(analysis));
    // The input document is not changed: the place it held are still there.
    expect(doc.pages[0].components.filter(node => node.type === 'tile-grid')).toHaveLength(3);
    // The study grid draws 3 columns, which a template cannot set, so it stays a plain grid.
    expect(saved.document.pages[0].components.filter(node => node.type === 'component-ref')).toHaveLength(2);
    expect(saved.document.pages[0].components.filter(node => node.type === 'tile-grid')).toHaveLength(1);
    expect(doc.componentLibrary).toBeUndefined();
  });

  it('refuses a taken name, a bad name, fewer than two places and a bad label', () => {
    const doc = fixture(), analysis = analyseRepeat(doc, findRepeats(doc).classes[0]);
    const plan = planRepeat(analysis, defaultUnchecked(analysis));
    const first = saveRepeat(doc, analysis, plan, 'Lamp Grid', labelsOf(analysis));
    expect(() => saveRepeat(first.document, analysis, plan, 'lamp grid', labelsOf(analysis))).toThrow('A template named lamp grid already exists.');
    expect(() => saveRepeat(doc, analysis, plan, '  ', labelsOf(analysis))).toThrow('Name the template in 1 to 80 characters');
    expect(() => saveRepeat(doc, analysis, { ...plan, kept: [0] }, 'One', labelsOf(analysis))).toThrow('A template needs at least 2 places');
    expect(() => saveRepeat(doc, analysis, plan, 'Unlabelled', new Map())).toThrow('Name each setting in 1 to 80 characters');
  });

  it('refuses a class whose place has changed since the walk', () => {
    const doc = fixture(), cls: RepeatClass = findRepeats(doc).classes[0], analysis = analyseRepeat(doc, cls);
    const gone = { ...doc, pages: doc.pages.map((page, at) => at === 0 ? { ...page, components: [] } : page) } as CompositionDocument;
    expect(() => saveRepeat(gone, analysis, planRepeat(analysis, new Set()), 'Gone', labelsOf(analysis))).toThrow(/changed/);
  });
});

describe('a big document', () => {
  /** About 4,000 nodes in the shapes of the owner's layout: many pages, tile grids of 5 to 8 tiles, forms of rows. */
  function big(): CompositionDocument {
    const pages: J[] = [];
    for (let at = 0; at < 100; at++) {
      const components: J[] = [];
      for (const [shape, tiles] of [[0, 8], [1, 6], [2, 5], [3, 8], [4, 6]] as const) {
        components.push(grid(`p${at}-g${shape}`, `Grid ${at}`, Array.from({ length: tiles }, (_, tileAt) => actionTile(`p${at}-g${shape}-${tileAt}`, `Tile ${at}.${shape}.${tileAt}`, `src-${at}-${shape}-${tileAt}`)), 2 + (shape % 3)));
      }
      pages.push({ id: `page-${at}`, title: `Page ${at}`, components });
    }
    return { pages, modals: [] } as unknown as CompositionDocument;
  }

  it('walks about 4,000 nodes in well under a second, a surface at a time', () => {
    const doc = big();
    const started = performance.now();
    const result = findRepeats(doc);
    const walked = performance.now() - started;
    expect(result.nodeCount).toBeGreaterThan(3500);
    // 3 distinct shapes by column count and tile count: every grid repeats.
    expect(result.classes.length).toBeGreaterThan(2);
    expect(result.placeCount).toBe(500);
    expect(walked).toBeLessThan(1000);
    // The longest step is one surface, which is what a caller yields between.
    const run = repeatSteps(doc);
    let longest = 0, last = performance.now();
    for (;;) { const step = run.next(); const now = performance.now(); longest = Math.max(longest, now - last); last = now; if (step.done) break; }
    expect(longest).toBeLessThan(500);
  });

  it('compares every class of that document in well under a second', () => {
    const doc = big(), result = findRepeats(doc);
    const started = performance.now();
    for (const cls of result.classes) planRepeat(analyseRepeat(doc, cls), new Set());
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('Single Tiles', () => {
  const door = (id: string, title: string, source: string) => actionTile(id, title, source);
  const second = (components: J[]) => ({ ...fixture().pages[0], id: 'page-b', components });

  it('makes one class of two from garage door tiles that differ in Name and Source, kept apart from Groups', () => {
    const doc = withPage([door('one', 'Left Garage Door', 'demo-source-left')], [second([door('two', 'Right Garage Door', 'demo-source-right')])]);
    const result = findRepeats(doc);
    expect(REPEAT_MIN_TILE_PLACES).toBe(2);
    expect(result.classes).toEqual([]);
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0]).toMatchObject({ type: 'action-tile', size: 1 });
    expect(result.tiles[0].places.map(place => place.nodeId)).toEqual(['one', 'two']);
    expect(result.tilePlaceCount).toBe(2);
  });

  it('does not list a tile that appears once, or a node that is not a tile', () => {
    expect(findRepeats(withPage([door('one', 'Garage Door', 'demo-source-door')])).tiles).toEqual([]);
    expect(findRepeats(withPage([grid('g1', 'A', []), grid('g2', 'A', [])])).tiles).toEqual([]);
  });

  it('does not list a tile that sits inside a listed group', () => {
    const group = (id: string) => grid(id, 'Row', [door(`${id}-a`, 'Door', 'demo-source-door'), door(`${id}-b`, 'Door', 'demo-source-door'), door(`${id}-c`, 'Door', 'demo-source-door')]);
    const result = findRepeats(withPage([group('g1'), group('g2')]));
    expect(result.classes.length).toBeGreaterThan(0);
    expect(result.tiles).toEqual([]);
  });

  it('does not list a template place, even beside a plain tile of the same shape', () => {
    const plain = door('plain', 'Garage Door', 'demo-source-door');
    const place = { id: 'place', type: 'component-ref', componentId: 'demo-door', layout: { span: 1 } };
    const doc = { ...withPage([plain, place], [second([place as J])]), componentLibrary: [{ id: 'demo-door', name: 'Door', node: door('demo-door-body', 'Garage Door', 'demo-source-door') }] } as CompositionDocument;
    const result = findRepeats(doc);
    expect(result.tiles).toEqual([]);
    expect(result.classes).toEqual([]);
  });

  it('leaves the groups as they were: the fixture still has its tile grid three times and its section twice', () => {
    const result = findRepeats(fixture());
    expect(result.classes.map(item => [item.type, item.size, item.places.length])).toEqual([['tile-grid', 4, 3], ['section', 4, 2]]);
    expect(result.placeCount).toBe(5);
  });
});
