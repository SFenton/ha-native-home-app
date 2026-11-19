import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { checkChartOperandKind, checkChartSource, isRecordsOutput, sourcePoints } from '../src/shared/composition/chart-source';
import { CompositionValidationError } from '../src/shared/composition/json';
import { newFacts, requestShape, typeSteps, withoutNull } from '../src/shared/composition/pipeline';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';

/**
 * The WG-S3 ids: what declares each, that a document without the new nodes compiles as it did, the limits the new nodes count in, and the seam where a
 * chart reads records (`chart-source.ts`), now wired to the records output of WG-S2.
 */
type J = Record<string, any>;
const corpus = path.resolve(__dirname, '../contract/corpus');
const first = JSON.parse(readFileSync(path.join(corpus, 'accept/fixture-composition-first-slice.json'), 'utf8')) as { document: J };
const lit = (value: unknown): J => ({ type: 'literal', value });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const chart = (id = 'c', props: J = {}): J => node(id, 'chart', {
  props: { mark: 'bar', series: { type: 'literal', points: [{ label: 'a', value: 1 }] }, domain: { type: 'fixed', min: 0, max: 10 }, tint: solid(1, 2, 3), emptyText: 'None', ...props }, a11y: { label: lit('Chart') },
});
const gauge = (id = 'g', props: J = {}): J => node(id, 'linear-gauge', {
  props: { value: lit(0.5), fill: 'scale', stops: [{ at: 0, ink: solid(1, 2, 3) }, { at: 1, ink: solid(4, 5, 6) }], track: solid(9, 9, 9), marker: { size: 12, ink: solid(255, 255, 255) }, ...props }, a11y: { element: 'hidden' },
});
const stack = (id: string, children: J[]): J => node(id, 'stack', { props: { axis: 'vertical', spacing: { type: 'token', name: 'm' } }, children });
const compile = (components: J[], tweak?: (document: J) => void) => {
  const document = structuredClone(first.document);
  document.pages[2].components = components;
  tweak?.(document);
  return compileCompositionDocument(document).capabilities;
};
const issue = (components: J[], tweak?: (document: J) => void) => {
  try { compile(components, tweak); } catch (error) { if (error instanceof CompositionValidationError) return error.issues[0]; throw error; }
  return undefined;
};
const ids = ['sh.chart@1', 'sh.linear-gauge@1'];

describe('the two WG-S3 ids', () => {
  it('are shipped and sorted, and the Studio supports them', () => {
    for (const id of ids) expect(pendingCompositionCapabilities).not.toContain(id);
    expect(JSON.parse(readFileSync(path.join(corpus, 'capabilities.pending.json'), 'utf8'))).toEqual([...pendingCompositionCapabilities]);
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
  });
  it('are declared by the node that uses them and only then', () => {
    const wanted = (list: string[]) => list.filter(id => ids.includes(id));
    expect(wanted(compile([]))).toEqual([]);
    expect(wanted(compile([chart()]))).toEqual(['sh.chart@1']);
    expect(wanted(compile([gauge()]))).toEqual(['sh.linear-gauge@1']);
    expect(wanted(compile([chart('c'), gauge('g')])).sort()).toEqual(ids);
  });
  it('declare the ink ids their colours need, and no more', () => {
    expect(compile([chart('c', { tint: { type: 'rgba', red: 1, green: 2, blue: 3, alpha: 0.5 } })])).toContain('sh.text-style@1');
    expect(compile([chart('c', { tint: { type: 'solid-appearance', light: solid(1, 2, 3), dark: solid(4, 5, 6) } })])).toContain('sh.solid-appearance@1');
    expect(compile([chart()])).not.toContain('sh.text-style@1');
    expect(compile([gauge()])).not.toContain('sh.solid-appearance@1');
  });
  it('count a chart and a gauge in the node and depth limits', () => {
    let deep: J = chart('leaf');
    for (let depth = 0; depth < 11; depth += 1) deep = stack(`s${depth}`, [deep]);
    expect(issue([deep])).toBeUndefined();
    expect(issue([stack('top', [deep])])).toMatchObject({ code: 'limit_exceeded' });
  });
  it('take a width in a grid and nowhere else', () => {
    expect(issue([chart('c')].map(item => ({ ...item, layout: { span: 2 } })))).toMatchObject({ code: 'invalid_combination' });
  });
  it('put a node that has an id of its own in the uniqueness check', () => {
    expect(issue([chart('same'), gauge('same')])).toMatchObject({ code: 'duplicate_id' });
  });
});

describe('documents that do not use the new nodes', () => {
  const names = (folder: string) => readdirSync(path.join(corpus, folder)).filter(name => name.endsWith('.json') && !/^(pending-)?(chart|linear-gauge)-/.test(name));
  it('declare exactly the capabilities the corpus recorded for them, none of the new ids', () => {
    let count = 0;
    for (const name of names('accept')) {
      const envelope = JSON.parse(readFileSync(path.join(corpus, 'accept', name), 'utf8')) as { capabilities: string[]; document: J };
      if (!envelope.document?.pages) continue;
      const compiled = compileCompositionDocument(envelope.document);
      expect(compiled.capabilities, name).toEqual(envelope.capabilities);
      for (const id of ids) expect(compiled.capabilities, name).not.toContain(id);
      count += 1;
    }
    expect(count).toBeGreaterThan(100);
  });
  it('compile the pending corpus of the other lanes as before', () => {
    let count = 0;
    for (const name of names('reject').filter(entry => entry.startsWith('pending-'))) {
      const envelope = JSON.parse(readFileSync(path.join(corpus, 'reject', name), 'utf8')) as { capabilities: string[]; document: J };
      if (!envelope.document?.pages) continue;
      // The global-chrome cases carry a header badge that the Studio's badge lane lists `sh.badge-nodes@1` for and their declared list does not: `tests/global-chrome.test.ts` compiles them.
      if (name.includes('global-chrome')) continue;
      try { expect(compileCompositionDocument(envelope.document, { tileInkDefault: envelope.capabilities.includes('sh.tile-ink-default@1') }).capabilities, name).toEqual(envelope.capabilities); } catch (error) { if (!(error instanceof CompositionValidationError)) throw error; continue; }
      for (const id of ids) expect(envelope.capabilities, name).not.toContain(id);
      count += 1;
    }
    expect(count).toBeGreaterThan(50);
  });
});

describe('the rules the compiler adds', () => {
  it('let a two-step scale take its smallest step from an entity read as a number', () => {
    const step = { type: 'read', from: { type: 'source', sourceId: 'source-entity', path: ['attributes', 'step'] }, as: 'number', missing: 'unavailable' };
    expect(issue([chart('c', { domain: { type: 'two-step', minimumStep: step } })])).toBeUndefined();
    expect(issue([chart('c', { domain: { type: 'two-step', minimumStep: { ...step, as: 'string' } } })])).toMatchObject({ code: 'binding_type' });
  });
  it('take a gauge with no marker, no value and no span', () => {
    expect(issue([gauge('g', { value: undefined, marker: undefined })].map(item => JSON.parse(JSON.stringify(item))))).toBeUndefined();
  });
  it('read the value of a gauge and its span from a number only', () => {
    expect(issue([gauge('g', { value: lit('half') })])).toMatchObject({ code: 'binding_type', pointer: '/document/pages/2/components/0/props/value' });
    expect(issue([gauge('g', { fill: 'span', span: { start: lit(0), size: lit(true) } })])).toMatchObject({ code: 'binding_type', pointer: '/document/pages/2/components/0/props/span/size' });
  });
});

describe('the seam where a chart reads records (WG-S2)', () => {
  const sourceSeries = (rest: J = {}) => ({ type: 'source', providerId: 'flow', limit: 6, x: { label: { type: 'item', path: ['label'] } }, y: { type: 'item', path: ['level'] }, ...rest });
  const record = { kind: 'object', fields: { label: { shape: { kind: 'string' } }, level: { shape: { kind: 'number' } } } };
  const flow = (kind: string): J => ({
    id: 'flow', kind: 'model', model: 'pipeline@1', inputs: { output: { kind }, schema: { kind: 'array', of: record }, steps: [], parameters: [], request: { type: 'ha-entity-attribute' } },
  });
  const lookup = (found?: J) => ({ get: (id: string) => (id === 'flow' ? found : id === 'entity' ? { kind: 'ha-entity' } : undefined) as never });
  const check = (series: J, found?: J, scope?: Parameters<typeof checkChartSource>[2]) => checkChartSource({ series: series as never, path: '/p/props/series' }, lookup(found), scope);
  it('knows a flow gives records when its output is records, and no other output', () => {
    for (const kind of ['rows', 'record', 'scalar']) expect(isRecordsOutput({ kind } as never)).toBe(false);
    expect(isRecordsOutput({ kind: 'records' } as never)).toBe(true);
  });
  it('refuses a source series with the code each case gets, first at the provider', () => {
    expect(check(sourceSeries({ providerId: undefined })).issues).toEqual([{ code: 'invalid_combination', pointer: '/p/props/series' }]);
    expect(check(sourceSeries({ providerId: 'nothing' })).issues).toEqual([{ code: 'invalid_reference', pointer: '/p/props/series/providerId' }]);
    expect(check(sourceSeries({ providerId: 'entity' })).issues).toEqual([{ code: 'binding_type', pointer: '/p/props/series/providerId' }]);
    expect(check(sourceSeries(), flow('rows')).issues).toEqual([{ code: 'binding_type', pointer: '/p/props/series/providerId' }]);
  });
  it('lets a records flow through and hands back the shape of one record', () => {
    const found = check(sourceSeries(), flow('records'));
    expect(found.issues).toEqual([]);
    expect(found.shape).toEqual(record);
  });
  it('reads the list of the repeat it sits in when it names no flow, but not in the placeholder or outside a repeat', () => {
    expect(check(sourceSeries({ providerId: undefined }), undefined, { shape: record as never })).toEqual({ issues: [], shape: record });
    expect(check(sourceSeries({ providerId: undefined }), undefined, 'lenient').issues).toEqual([]);
    expect(check(sourceSeries({ providerId: undefined }), undefined, { shape: record as never, placeholder: true }).issues).toEqual([{ code: 'invalid_combination', pointer: '/p/props/series' }]);
  });
  it('judges the kind of an item operand by the records\' shape and leaves other operands to the compiler', () => {
    const shape = record as never;
    expect(checkChartOperandKind({ type: 'item', path: ['level'] }, shape, 'number', '/y')).toEqual([]);
    expect(checkChartOperandKind({ type: 'item', path: ['label'] }, shape, 'number', '/y')).toEqual([{ code: 'binding_type', pointer: '/y' }]);
    expect(checkChartOperandKind({ type: 'item', path: ['level'] }, shape, 'string', '/x')).toEqual([{ code: 'binding_type', pointer: '/x' }]);
    expect(checkChartOperandKind({ type: 'item', path: ['nothing'] }, shape, 'number', '/y')).toEqual([]);
    expect(checkChartOperandKind(lit('x') as never, shape, 'number', '/y')).toEqual([]);
  });
  it('declares the id of a source series and refuses a non-records provider through the compiler', () => {
    const series = sourceSeries({ providerId: 'source-entity' });
    expect(issue([chart('c', { series })])).toMatchObject({ code: 'binding_type', pointer: '/document/pages/2/components/0/props/series/providerId' });
  });
});

describe('a chart over a records flow, through the compiler', () => {
  const steps = [{ id: 'all', op: 'get', path: ['forecast'] }, { id: 'few', op: 'limit', count: 6 }, { id: 'shape', op: 'map', fields: { label: { type: 'item', path: ['condition'] }, level: { type: 'item', path: ['temperature'] } } }];
  const request = { type: 'ha-subscription', kind: 'weather-forecast', entityId: lit('weather.demo_home'), forecastType: 'hourly' };
  const withFlow = (document: J) => {
    const typed = typeSteps(steps as never, requestShape(request as never), new Map(), '', newFacts());
    document.dataSources.push({ id: 'records-flow', kind: 'model', model: 'pipeline@1', inputs: { title: 'R', parameters: [], request, steps, output: { kind: 'records', max: 6 }, schema: withoutNull(typed[typed.length - 1]) } });
  };
  const series = (rest: J = {}) => ({ type: 'source', providerId: 'records-flow', limit: 6, x: { label: { type: 'item', path: ['label'] } }, y: { type: 'item', path: ['level'] }, ...rest });
  const ownList = () => { const { providerId: _flow, ...rest } = series(); return rest; };
  it('accepts the series and declares the chart and the repeat', () => {
    const declared = compile([chart('c', { series: series() })], withFlow);
    expect(declared).toEqual(expect.arrayContaining(['sh.chart@1', 'sh.repeat@1']));
  });
  it('points a path the flow does not give at the path, and a field of the wrong kind at the operand', () => {
    expect(issue([chart('c', { series: series({ y: { type: 'item', path: ['missing'] } }) })], withFlow)).toMatchObject({ code: 'invalid_reference', pointer: '/document/pages/2/components/0/props/series/y/path' });
    expect(issue([chart('c', { series: series({ y: { type: 'item', path: ['label'] } }) })], withFlow)).toMatchObject({ code: 'binding_type', pointer: '/document/pages/2/components/0/props/series/y' });
  });
  it('reads the list of the repeat a chart sits in, and refuses it in the repeat\'s placeholder', () => {
    const words = { loadingText: 'a', emptyText: 'b', unavailableText: 'c', errorText: 'd', staleText: 'e' };
    const inRepeat = (children: J[], props: J = {}) => node('r', 'repeat', { props: { providerId: 'records-flow', axis: 'vertical', spacing: { type: 'token', name: 's' }, ...words, ...props }, children });
    expect(compile([inRepeat([chart('c', { series: ownList() })])], withFlow)).toContain('sh.repeat@1');
    expect(issue([inRepeat([gauge('g'), chart('c2', { series: ownList() })], { placeholder: { count: 2 } })], withFlow))
      .toMatchObject({ code: 'invalid_combination', pointer: '/document/pages/2/components/0/children/1/props/series' });
  });
  it('lets a gauge in a repeated cell read the record, and refuses the record outside a repeat', () => {
    const words = { loadingText: 'a', emptyText: 'b', unavailableText: 'c', errorText: 'd', staleText: 'e' };
    const value = { type: 'item', path: ['level'] };
    const repeated = node('r', 'repeat', { props: { providerId: 'records-flow', axis: 'vertical', spacing: { type: 'token', name: 's' }, ...words }, children: [gauge('g', { value })] });
    expect(compile([repeated], withFlow)).toEqual(expect.arrayContaining(['sh.linear-gauge@1', 'sh.repeat@1']));
    expect(issue([gauge('g', { value })], withFlow)).toMatchObject({ code: 'invalid_combination', pointer: '/document/pages/2/components/0/props/value' });
  });
});

describe('the points a source series draws', () => {
  const series = { type: 'source', providerId: 'f', limit: 2, x: { label: { type: 'item', path: ['label'] } }, y: { type: 'item', path: ['level'] } } as never;
  const env = { read: () => ({ status: 'unavailable' }) } as never;
  it('reads the label and the value of each record, up to the limit', () => {
    expect(sourcePoints(series, [{ label: 'a', level: 1 }, { label: 'b', level: '2.5' }, { label: 'c', level: 3 }], env)).toEqual([{ label: 'a', value: 1 }, { label: 'b', value: 2.5 }]);
  });
  it('gives an unknown value as null and an unknown label as empty', () => {
    expect(sourcePoints(series, [{ level: null }, { label: 7, level: 'high' }], env)).toEqual([{ label: '', value: null }, { label: '7', value: null }]);
  });
  it('gives no points for no records', () => {
    expect(sourcePoints(series, [], env)).toEqual([]);
  });
});
