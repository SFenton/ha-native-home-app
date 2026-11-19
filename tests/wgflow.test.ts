import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { previewSources } from '../src/preview2/component-library';
import { wgflowFeed, wgflowRecords, wgflowStory } from '../src/preview2/fixtures/wgflow-story';
import { pageSizeOf, textStepOf } from '../src/preview2/flow-records';
import { saveAsComponent } from '../src/workspace2/linked';
import { newRepeat, recordsFlows } from '../src/workspace2/add/repeat';
import type { CompositionDocument } from '../src/shared/composition/schema';

/**
 * The WG-S2 ids: what declares each, that a document without the new fields declares none of them, where `item` and `index` are refused, how a saved component owns
 * its flows (D2), the starter a new Repeat makes, and the paging arithmetic of the preview.
 */
type J = Record<string, any>;
const corpus = path.resolve(__dirname, '../contract/corpus');
const read = (file: string) => JSON.parse(readFileSync(path.join(corpus, file), 'utf8')) as { document: J; capabilities: string[] };
const ids = ['sh.repeat@1', 'sh.flow-extras@1'];
const horizontal = read('accept/repeat-horizontal.json');

/** Compiles a copy of the horizontal case with the page's components replaced. */
function compileWith(components: J[]) {
  const document = structuredClone(horizontal.document);
  document.pages[2].components = components;
  return compileCompositionDocument(document as never);
}
const firstIssue = (components: J[]) => { try { compileWith(components); } catch (error) { if (error instanceof CompositionValidationError) return error.issues[0]; throw error; } return undefined; };
const cellOf = () => (horizontal.document.pages[2].components[0] as J).children[0] as J;
const lit = (value: unknown): J => ({ type: 'literal', value });
const item = (...segments: string[]): J => ({ type: 'item', path: segments });

describe('the two WG-S2 ids', () => {
  it('are shipped and sorted, and the Studio supports them', () => {
    for (const id of ids) expect(pendingCompositionCapabilities).not.toContain(id);
    expect(JSON.parse(readFileSync(path.join(corpus, 'capabilities.pending.json'), 'utf8'))).toEqual([...pendingCompositionCapabilities]);
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
  });
  it('are declared by a repeat and by a records flow, and only then', () => {
    expect(compileCompositionDocument(horizontal.document as never).capabilities).toContain('sh.repeat@1');
    expect(compileCompositionDocument(horizontal.document as never).capabilities).not.toContain('sh.flow-extras@1');
    const extras = read('accept/flow-extras-running-sum.json');
    expect(compileCompositionDocument(extras.document as never).capabilities).toEqual(expect.arrayContaining(ids));
  });
  it('are declared by none of the documents that use none of the new fields', () => {
    for (const folder of ['accept', 'reject']) for (const name of readdirSync(path.join(corpus, folder)).filter(file => file.endsWith('.json'))) {
      const body = readFileSync(path.join(corpus, folder, name), 'utf8');
      if (/repeat|flow-extras|owned-flow|records-/.test(name) || /"type":"repeat"|"type":"index"|"kind":"records"|"op":"(min|max|running-sum|annotate)"|"style":"(hour|weekday)"|"op":"progress"|"flows":/.test(body)) continue;
      expect(JSON.parse(body).capabilities ?? [], name).not.toEqual(expect.arrayContaining(ids.slice(0, 1)));
    }
  });
});

describe('item and index are the record and position of a repeat', () => {
  const cell = cellOf();
  it('compile inside the repeat the case has', () => { expect(firstIssue(horizontal.document.pages[2].components)).toBeUndefined(); });
  it.each([
    ['a text', { id: 'a', title: 'a', type: 'text', layout: { span: 1 }, props: { value: { type: 'expr', value: item('label') }, style: 'body', unavailableText: 'None' } }],
    ['a rule on the node', { id: 'a', title: 'a', type: 'text', layout: { span: 1 }, visibleWhen: { type: 'compare', op: 'eq', left: item('label'), right: lit('x') },
      props: { value: lit('x'), style: 'body', unavailableText: 'None' } }],
    ['a spoken label', { ...structuredClone(cell), id: 'a', a11y: { element: 'group', label: { type: 'expr', value: item('label') } } }],
    ['a symbol turned by the record', { id: 'a', title: 'a', type: 'symbol', layout: { span: 1 }, a11y: { element: 'hidden' },
      props: { name: { type: 'sf-symbol', name: 'arrow.up', rendering: 'canonical', unavailable: 'fallback' }, size: { points: 20 }, rendering: 'monochrome', rotate: item('value') } }],
    ['a call with the record in its data', { ...structuredClone(cell), id: 'a', a11y: { element: 'group', label: lit('Set'), role: 'button' },
      action: { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.demo_lamp') }, data: { type: 'object', fields: { brightness_pct: item('value') } } } }],
  ])('are refused outside a repeat: %s', (_name, node) => {
    const found = firstIssue([node as J]);
    expect(found?.code).toBe('invalid_combination');
  });
  it('refuse index outside a repeat and a flow step', () => {
    const found = firstIssue([{ id: 'a', title: 'a', type: 'text', layout: { span: 1 }, props: { value: { type: 'expr', value: { type: 'index' } }, style: 'body', unavailableText: 'None' } }]);
    expect(found?.code).toBe('invalid_combination');
  });
});

describe('a saved component owns the flows its body reads (D2)', () => {
  const story = wgflowStory().document as unknown as CompositionDocument & J;
  it('gives each place its own copy of the flow, named by the place', () => {
    const names = previewSources(story).map(source => source.id);
    expect(names).toEqual(expect.arrayContaining(['hourly', 'slow', 'wf-use-a~own', 'wf-use-b~own']));
  });
  it('compiles with the repeat inside the template reading the owned flow', () => {
    expect(compileCompositionDocument(story as never).capabilities).toEqual(expect.arrayContaining(ids));
  });
  it('is taken along when a repeat is saved as a component, and left behind when a page still reads it', () => {
    const document = structuredClone(horizontal.document) as unknown as CompositionDocument & J;
    const where = ['pages', 2, 'components', 0];
    const saved = saveAsComponent(document, where as never, 'Strip');
    const entry = saved.document.componentLibrary!.find(candidate => candidate.id === saved.entryId)!;
    expect(entry.flows?.map(flow => flow.id)).toEqual(['series']);
    expect(saved.document.dataSources.some(source => source.id === 'series')).toBe(false);
    expect(() => compileCompositionDocument(saved.document as never)).not.toThrow();
    // A second repeat on the page keeps the flow in the document.
    const shared = structuredClone(document);
    shared.pages[2].components.push({ ...structuredClone(shared.pages[2].components[0] as J), id: 'again', children: [{ ...structuredClone(cellOf()), id: 'again-cell', children: [] }] } as never);
    const kept = saveAsComponent(shared, where as never, 'Strip');
    expect(kept.document.componentLibrary![0].flows).toBeUndefined();
    expect(kept.document.dataSources.some(source => source.id === 'series')).toBe(true);
  });
});

describe('a new Repeat', () => {
  it('starts a records flow when the document has none, and reads the first one when it has', () => {
    const empty = { dataSources: [] as CompositionDocument['dataSources'] };
    const made = newRepeat(empty, 'sensor.demo_a');
    expect(made.sources).toHaveLength(1);
    const document = { dataSources: made.sources };
    expect(recordsFlows(document).map(source => source.id)).toEqual([made.sources[0].id]);
    expect(newRepeat(document).sources).toEqual([]);
  });
});

describe('the story and the paging arithmetic', () => {
  it('answers the flow with twelve records whose first reads Now and whose position counts from 0', () => {
    const { document } = wgflowStory();
    const flow = document.dataSources.find(source => source.id === 'hourly')!;
    const answer = wgflowRecords('hourly', (flow as J).inputs);
    expect(answer.state).toBe('ready');
    expect(answer.records).toHaveLength(12);
    expect(answer.records[0]).toMatchObject({ label: 'Now', position: 0 });
    expect(answer.records[1]).toMatchObject({ label: '7 PM', position: 1 });
    expect(wgflowFeed).toBeTruthy();
  });
  it('counts a page by the window and the text size, never below the minimum', () => {
    const paging = { compact: 6, regular: 9, scaleByTextSize: [1, 0.8, 0.5, 0.34], minimum: 2 };
    expect(pageSizeOf(paging, false, 0)).toBe(6);
    expect(pageSizeOf(paging, true, 0)).toBe(9);
    expect(pageSizeOf(paging, false, 2)).toBe(3);
    expect(pageSizeOf(paging, false, 3)).toBe(2);
    expect(pageSizeOf({ compact: 6, regular: 9 }, false, 3)).toBe(6);
  });
  it('reads the text size as a step from 0 to 3', () => {
    expect([1, 1.15, 1.3, 1.42, undefined].map(textStepOf)).toEqual([0, 1, 2, 3, 0]);
  });
});
