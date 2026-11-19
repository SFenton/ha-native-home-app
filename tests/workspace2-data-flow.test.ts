import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { evaluatePipeline, entityRows } from '../src/shared/composition/pipeline';
import {
  canAddFlow, countFlow, flowById, flowIssues, flowLimits, flowShapes, flowSources, itemFields, kindWords, moveStep, newFlow, newStep, outputProblem, predicateWords, requestKind, requestKinds,
  stepId, stepNames, stepSummary, stepsThatFit, updateFlow, usedBy, usedCount, freshNames, type RequestKind,
} from '../src/workspace2/data/flow';

const base = (JSON.parse(readFileSync(new URL('../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument }).document;
const clock = { now: '2026-11-12T09:41:00', utcOffsetMinutes: 0 };

describe('newFlow', () => {
  for (const kind of requestKinds) {
    it(`makes a flow for "${kind}" that compiles and is read back as that kind`, () => {
      const made = newFlow(base, kind);
      const flow = flowById(made.document, made.id)!;
      expect(requestKind(flow.inputs.request)).toBe(kind);
      expect(flowIssues(flow)).toEqual([]);
      expect(() => compileCompositionDocument(made.document)).not.toThrow();
    });
  }
  it('makes a weather forecast for the second live list', () => {
    const made = newFlow(base, 'live-list', { feed: 'weather-forecast', entityId: 'weather.demo_home' });
    expect(flowById(made.document, made.id)!.inputs.request).toMatchObject({ kind: 'weather-forecast', forecastType: 'daily' });
    expect(flowIssues(flowById(made.document, made.id)!)).toEqual([]);
  });
  it('names each new flow apart from the others', () => {
    const one = newFlow(base, 'none'), two = newFlow(one.document, 'none');
    expect(flowSources(two.document).map(flow => flow.inputs.title)).toEqual(['Data Flow', 'Data Flow 2']);
    expect(new Set(flowSources(two.document).map(flow => flow.id)).size).toBe(2);
    expect(freshNames(two.document).id).toBe('flow-3');
  });
  it('refuses a 129th flow with the limit in words', () => {
    let document = base;
    for (let at = 0; at < flowLimits.flows.max; at += 1) document = newFlow(document, 'none').document;
    expect(canAddFlow(document)).toBe(false);
    expect(() => newFlow(document, 'none')).toThrow('128 data flows at most.');
  });
  it('runs the data a group of entities holds', () => {
    const made = newFlow(base, 'group', { entityIds: ['light.example_a', 'light.example_b'] });
    const inputs = flowById(made.document, made.id)!.inputs;
    const rows = entityRows(inputs.request as Extract<typeof inputs.request, { type: 'entities' }>, id => ({ state: id.endsWith('a') ? 'on' : 'off', attributes: {} }));
    const result = evaluatePipeline(inputs, rows, { clock });
    expect(result.status === 'ok' && result.output).toEqual([{ id: 'light.example_a', title: 'light.example_a', value: 'on' }, { id: 'light.example_b', title: 'light.example_b', value: 'off' }]);
  });
});

describe('countFlow', () => {
  const entities = Array.from({ length: 42 }, (_, at) => `light.example_${at}`);
  const made = countFlow(base, entities, ['on'], 'Lights On');
  const inputs = flowById(made.document, made.id)!.inputs;
  it('makes a Filter and a Count that give one value', () => {
    expect(inputs.title).toBe('Lights On');
    expect(inputs.steps.map(step => step.op)).toEqual(['filter', 'count']);
    expect(inputs.output.kind).toBe('scalar');
    expect(flowIssues(flowById(made.document, made.id)!)).toEqual([]);
  });
  it('reads 18 when 18 of 42 are on', () => {
    const rows = entityRows(inputs.request as Extract<typeof inputs.request, { type: 'entities' }>, id => ({ state: Number(id.split('_')[1]) < 18 ? 'on' : 'off', attributes: {} }));
    const result = evaluatePipeline(inputs, rows, { clock });
    expect(result.status === 'ok' && result.output).toBe(18);
  });
  it('uses "is one of" for more than one word', () => {
    const several = flowById(countFlow(base, ['light.example_a'], ['on', 'unavailable']).document, 'flow-1')!.inputs.steps[0];
    expect(several).toMatchObject({ op: 'filter', where: { type: 'in' } });
  });
});

describe('stepsThatFit', () => {
  const shape = (id: string, kind: RequestKind) => flowShapes(flowById(newFlow(base, kind).document, 'flow-1')!.inputs).request;
  it('offers a list of items the item steps', () => {
    const list = flowShapes(flowById(newFlow(base, 'live-list').document, 'flow-1')!.inputs).after[0];
    expect(stepsThatFit(list)).toEqual(['filter', 'sort', 'limit', 'map', 'group', 'count', 'sum', 'first', 'unique', 'default', 'min', 'max', 'average', 'running-sum', 'annotate']);
  });
  it('offers a group of entries Choose Entry and Go Into, and a value nothing', () => {
    expect(stepsThatFit(shape('a', 'service'))).toEqual(['select-key', 'get', 'map']);
    expect(stepsThatFit({ kind: 'number', integer: true })).toEqual([]);
  });
  it('offers a list of plain values only Limit, Count and First Item', () => {
    expect(stepsThatFit({ kind: 'array', of: { kind: 'string' } })).toEqual(['limit', 'count', 'first']);
  });
});

describe('words', () => {
  it('names a step and its summary', () => {
    const live = flowById(newFlow(base, 'live-list').document, 'flow-1')!.inputs;
    expect(live.steps.map(step => stepNames[step.op])).toEqual(['Go Into']);
    expect(stepSummary(live.steps[0])).toBe('Go into items');
    expect(stepSummary(newStep('count', 'c'))).toBe('Counts the items');
    expect(stepSummary({ id: 'l', op: 'limit', count: 5 })).toBe('Keeps the first 5');
    expect(stepSummary({ id: 's', op: 'sort', by: [{ value: { type: 'item', path: ['days'] }, direction: 'descending', kind: 'number' }, { value: { type: 'item', path: ['summary'] }, direction: 'ascending', kind: 'text' }] })).toBe('days largest first, summary A to Z');
  });
  it('words a condition', () => {
    expect(predicateWords({ type: 'compare', op: 'eq', left: { type: 'item', path: ['state'] }, right: { type: 'literal', value: 'on' } })).toBe('state is on');
    expect(predicateWords({ type: 'not', of: { type: 'exists', value: { type: 'item', path: ['due'] } } })).toBe('due has no value');
    expect(predicateWords({ type: 'all', of: [{ type: 'exists', value: { type: 'item', path: ['a'] } }, { type: 'exists', value: { type: 'item', path: ['b'] } }] })).toBe('All of 2 conditions');
  });
  it('words the kinds of a field', () => {
    expect(kindWords({ kind: 'string', enum: ['on', 'off'] })).toEqual({ kind: 'Text', values: ['on', 'off'], optional: false });
    expect(kindWords({ kind: 'union', of: [{ kind: 'null' }, { kind: 'string', format: 'date' }] })).toEqual({ kind: 'Date', optional: true });
    expect(kindWords({ kind: 'number', integer: true }).kind).toBe('Number');
    expect(kindWords({ kind: 'array', of: { kind: 'string' } }).kind).toBe('List');
  });
  it('gives the limits their words', () => {
    expect(flowLimits.entities.words).toBe('64 entities at most.');
    expect(flowLimits.attributes.words).toBe('8 attributes at most.');
    expect(flowLimits.steps.words).toBe('32 steps at most.');
  });
});

describe('editing a flow', () => {
  const made = newFlow(base, 'live-list'), id = made.id;
  it('keeps the schema following the steps', () => {
    const edited = updateFlow(made.document, id, inputs => ({ ...inputs, steps: [...inputs.steps, { id: 'limit-1', op: 'limit', count: 3 }] }));
    expect(flowIssues(flowById(edited, id)!)).toEqual([]);
    const counted = updateFlow(made.document, id, inputs => ({ ...inputs, steps: [...inputs.steps, { id: 'count-1', op: 'count' }], output: { kind: 'scalar' } }));
    expect(flowById(counted, id)!.inputs.schema).toEqual({ kind: 'number', integer: true });
    expect(flowIssues(flowById(counted, id)!)).toEqual([]);
  });
  it('moves a step and stops at the ends', () => {
    const steps = [newStep('count', 'a'), newStep('first', 'b'), newStep('count', 'c')];
    expect(moveStep(steps, 0, 1).map(step => step.id)).toEqual(['b', 'a', 'c']);
    expect(moveStep(steps, 0, -1).map(step => step.id)).toEqual(['a', 'b', 'c']);
    expect(moveStep(steps, 2, 1).map(step => step.id)).toEqual(['a', 'b', 'c']);
  });
  it('numbers step ids apart', () => {
    expect(stepId([newStep('count', 'count-1')], 'count')).toBe('count-2');
  });
  it('lists the fields of the item a step looks at', () => {
    const shapes = flowShapes(flowById(made.document, id)!.inputs);
    expect(itemFields(shapes.final).map(field => field.name)).toEqual(['uid', 'summary', 'status', 'due', 'description']);
    expect(itemFields(shapes.final).find(field => field.name === 'due')?.optional).toBe(true);
  });
  it('names the field a row still reads when the data lost it', () => {
    const broken = updateFlow(made.document, id, inputs => ({ ...inputs, steps: [...inputs.steps, { id: 'map-1', op: 'map', fields: { title: { type: 'item', path: ['summary'] } } }] }));
    expect(outputProblem(flowById(broken, id)!.inputs)).toBe('Data Flow no longer has the field “uid”.');
    expect(outputProblem(flowById(made.document, id)!.inputs)).toBeUndefined();
  });
  it('reports the step that does not fit', () => {
    const bad = updateFlow(made.document, id, inputs => ({ ...inputs, steps: [...inputs.steps, newStep('get', 'get-9', 'nothing')] }));
    expect(flowShapes(flowById(bad, id)!.inputs).badStep).toBe(1);
    expect(outputProblem(flowById(bad, id)!.inputs)).toBe('Step 2 does not fit the data before it.');
  });
});

describe('usedBy', () => {
  it('finds the nodes that read a flow, by field', () => {
    const made = newFlow(base, 'live-list');
    const list = { id: 'list-1', type: 'row-collection', title: 'Chores', layout: { span: 1 }, props: { providerId: made.id, loadingText: 'a', emptyText: 'b', unavailableText: 'c', errorText: 'd', staleText: 'e' } };
    const document = { ...made.document, pages: made.document.pages.map((page, at) => at === 0 ? { ...page, sections: [{ id: 'sec-x', type: 'section', title: 'S', children: [list] }] } : page) } as unknown as CompositionDocument;
    expect(usedBy(document, made.id)).toEqual([{ nodeId: 'list-1', nodeTitle: 'Chores', fields: ['providerId'] }]);
    expect(usedCount(document, made.id)).toBe(1);
    expect(usedCount(base, made.id)).toBe(0);
  });
});
