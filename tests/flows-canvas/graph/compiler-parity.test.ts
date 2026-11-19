import { describe, expect, it, vi } from 'vitest';
import * as compiler from '../../../src/shared/composition/compiler';
import * as expression from '../../../src/shared/composition/expression';
import * as typing from '../../../src/shared/composition/pipeline/typing';
import * as graphJSON from '../../../src/shared/composition/graph/json';
import { compileCompositionDocument, supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import { operandBase } from '../../../src/shared/composition/expression';
import { CompositionValidationError, canonicalCompositionJSON } from '../../../src/shared/composition/json';
import { graphSourceSchema, lift, lower, lowerFlowBranches, lowerForEach, lowerListAverage, measureBudget, projectGraph, validateGraph, type GraphDestination, type GraphJSON, type GraphPipelineInputs, type LogicGraph } from '../../../src/shared/composition/graph';
import { atPointer, copy, record, replaceAt } from '../../../src/shared/composition/graph/json';
import type { Json } from '../../../src/shared/types';
import { emptyDocument, largeGraphFlow, nativeContext, shortTextPointer, symbol } from './fixtures/native';
import { predicateBudgetFixtures } from './fixtures';
import { compileGraphValue } from '../../../src/shared/composition/graph/compile';
import { budgetFromCompilation } from '../../../src/shared/composition/graph/budgets';

type Context = NonNullable<GraphDestination['context']>;
interface Case {
  readonly name: string;
  readonly value: Json;
  readonly context: Context;
  readonly kind?: 'slot' | 'flow' | 'condition';
  readonly editedFrom?: Json;
  readonly accepted?: boolean;
}
const literal = (value: Json): Json => ({ type: 'literal', value });
const viewer: Json = { type: 'viewer', isAdmin: true };
const read = (fallback?: string): Json => ({
  type: 'read', from: { type: 'source', sourceId: 'light', path: ['state'] }, as: 'string', missing: 'unavailable',
  ...(fallback === undefined ? {} : { fallback }),
});
const truncatedCall: Json = {
  type: 'call-service', domain: 'light', service: 'turn_on',
  data: { type: 'object', fields: { brightness: { type: 'math', op: 'truncate', args: [literal(1.9)] } } },
};

function assertParity(test: Case): void {
  const document = replaceAt(copy(test.context.document), test.context.pointer, test.value);
  let native: ReturnType<typeof compileCompositionDocument> | undefined, refusal: CompositionValidationError | undefined;
  try { native = compileCompositionDocument(document); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    refusal = error;
  }
  if (test.accepted !== undefined) expect(native !== undefined).toBe(test.accepted);
  for (const whole of [true, false]) {
    const options = whole ? { kind: 'document' as const } : { kind: test.kind ?? 'slot', context: test.context };
    const expected = whole ? document : test.value, initial = test.editedFrom ?? test.value;
    const lifted = lift(whole ? replaceAt(copy(test.context.document), test.context.pointer, initial) : initial, options);
    let graph: LogicGraph = lifted.graph;
    if (test.editedFrom) {
      if (!record(test.value)) throw new Error('Expected edited expression slot.');
      const value = operandBase.parse(test.value.value), pointer = `${whole ? test.context.pointer : ''}/value`;
      const node = graph.nodes.find(node => node.origins[0] === pointer);
      if (!node) throw new Error('Expected editable expression block.');
      graph = { ...graph, nodes: graph.nodes.map(candidate => candidate.id === node.id ? { ...candidate, payload: { kind: 'operand', value } } : candidate) };
    }
    expect(projectGraph(graph).ast).toEqual(expected);
    const result = lower(graph, native ? { targetCapabilities: native.capabilities } : {});
    expect(validateGraph(graph).filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(native !== undefined);
    expect(result.budgets[0].accepted).toBe(native !== undefined);
    if (result.ok && native) {
      expect(result.ast).toEqual(expected);
      expect(result.capabilities).toEqual(native.capabilities);
      expect(result.budgets[0].capabilities).toEqual(native.capabilities);
      const again = lower(lift(result.ast, options).graph, { targetCapabilities: native.capabilities });
      expect(again).toMatchObject({ ok: true, ast: expected, capabilities: native.capabilities });
      expect(canonicalCompositionJSON(graph.original)).toBe(canonicalCompositionJSON(whole ? replaceAt(copy(test.context.document), test.context.pointer, initial) : initial));
    } else {
      if (result.ok || !refusal) throw new Error('Expected native refusal.');
      const prefix = whole ? '/document' : `/document${test.context.pointer}`, issue = refusal.issues[0];
      const pointer = issue.pointer === prefix || issue.pointer.startsWith(`${prefix}/`) ? issue.pointer.slice(prefix.length) : issue.pointer.replace(/^\/document(?=\/|$)/, '');
      expect(result.errors[0]).toMatchObject({ ...issue, pointer });
      expect(result.budgets[0].compilerIssues[0]).toEqual({ ...issue, pointer });
    }
  }
}

describe('compiler-authoritative destination regressions', () => {
  it('rejects a null symbol rule branch at the native pointer and maps its block', () => {
    const value: Json = { type: 'conditional', cases: [{ when: viewer, then: null }], otherwise: symbol() };
    assertParity({ name: 'null symbol branch', value, context: nativeContext('symbol'), accepted: false });
    const graph = lift(value, { kind: 'slot', context: nativeContext('symbol') }).graph;
    expect(lower(graph)).toMatchObject({
      ok: false, errors: [expect.objectContaining({
        code: 'invalid_value', pointer: '/cases/0/then', nodeId: graph.nodes.find(node => node.origins[0] === '/cases/0/then')!.id,
      })],
    });
  });
  it.each(['literal', 'read', 'expr'] as const)('accepts 16,384-character %s text in its real field, not a 2,000-character envelope', type => {
    const text = 'x'.repeat(16_384), value = type === 'literal' ? literal(text) : type === 'read' ? read(text) : { type, value: literal('Ready'), fallback: text };
    assertParity({ name: 'native long text', value, context: nativeContext(), accepted: true });
    const lifted = lift(value, { kind: 'slot', context: nativeContext() });
    expect(lifted.opaqueRegions).toEqual([]);
    assertParity({ name: 'short destination refuses the same text', value, context: nativeContext('short-text'), accepted: false });
  });
  it('uses the action compiler for conditional branches and the exact native target manifest', () => {
    const value: Json = { type: 'conditional', cases: [{ when: viewer, then: truncatedCall }], otherwise: { type: 'none' } }, context = nativeContext('action');
    assertParity({ name: 'conditional truncate service call', value, context, accepted: true });
    const native = compileCompositionDocument(replaceAt(copy(context.document), context.pointer, value));
    expect(native.capabilities).toEqual(expect.arrayContaining(['sh.action-rules@1', 'sh.call-service@1', 'sh.operands@1', 'sh.math-truncate@1']));
    expect(native.capabilities).not.toContain('sh.rules@1');
  });
  it.each([undefined, 'No answer'])('does not turn a text read with fallback %s into an operand', fallback => {
    const value = read(fallback), context = nativeContext();
    assertParity({ name: 'native binding manifest', value, context, accepted: true });
    const native = compileCompositionDocument(replaceAt(copy(context.document), context.pointer, value));
    expect(native.capabilities).not.toContain('sh.operands@1');
    expect(native.capabilities.includes('sh.rules@1')).toBe(fallback !== undefined);
  });
  it('lets the native schema decide a newly added optional destination field', () => {
    const context = nativeContext(), pointer = '/pages/1/components/0/visibleWhen', value: Json = { type: 'state', sourceId: 'light', path: ['state'], in: ['on'] };
    const expected = copy(context.document), node = atPointer(expected, '/pages/1/components/0');
    if (!record(node)) throw new Error('Expected text node.');
    node.visibleWhen = value;
    const native = compileCompositionDocument(expected);
    expect(lower(lift(value, { kind: 'condition', context: { ...context, pointer } }).graph)).toMatchObject({ ok: true, ast: value, capabilities: native.capabilities });
  });
  it('does not let a caller seed a guessed capability into a native fragment budget', () => {
    const value = literal(1), graph = lift(value, { kind: 'operand' }).graph;
    expect(measureBudget(value, graph.roots[0].anchor, { capabilities: ['sh.guessed@1'] }).capabilities).toEqual(['sh.operands@1']);
  });
  it('lets the compiler accept immutable JSON that the local catalog represents as opaque', () => {
    const context = nativeContext(), document = copy(context.document), graph = lift(document, { kind: 'document' }).graph;
    const node = graph.nodes.find(node => node.origins[0] === context.pointer);
    if (!node) throw new Error('Expected text slot.');
    const opaque: LogicGraph = {
      ...graph, nodes: graph.nodes.map(candidate => candidate.id === node.id ? {
        ...candidate, catalogKey: 'opaque', provenance: 'opaque',
        payload: { kind: 'opaque', value: candidate.payload.value, pointer: context.pointer, reason: 'Unsupported by this local catalog.' },
      } : candidate),
    };
    expect(lower(opaque)).toMatchObject({ ok: true, ast: document, capabilities: compileCompositionDocument(document).capabilities });
  });
  it.each([2000, 2001])('compiles all field replacements together and maps a native refusal to its owning root at length %i', length => {
    const context = nativeContext(), document = copy(context.document), graph = lift(document, { kind: 'document' }).graph;
    const pointers = [context.pointer, shortTextPointer], values = [literal('x'.repeat(2001)), literal('x'.repeat(length))];
    const nodes = pointers.map(pointer => {
      const node = graph.nodes.find(node => node.origins[0] === pointer);
      if (!node) throw new Error('Expected text slot.');
      return node;
    });
    const edited: LogicGraph = {
      ...graph,
      roots: nodes.map((node, i) => ({
        ...graph.roots[0], nodeId: node.id, anchor: { ...graph.roots[0].anchor, field: pointers[i] },
        destination: { kind: 'slot', context: { document, pointer: pointers[i] } },
      })),
      nodes: graph.nodes.map(node => {
        const index = nodes.findIndex(candidate => candidate.id === node.id);
        return index < 0 ? node : { ...node, payload: { kind: 'operand', value: operandBase.parse(values[index]) } };
      }),
    };
    const result = lower(edited);
    expect(result.ok).toBe(length === 2000);
    expect(result.budgets.map(budget => budget.accepted)).toEqual([length === 2000, length === 2000]);
    if (!result.ok) expect(result.errors).toMatchObject([{
      code: 'limit_exceeded', pointer: '/value', documentPointer: `${shortTextPointer}/value`, nodeId: nodes[1].id,
    }]);
  });
});

function comparisonCases(): Case[] {
  const cases: Case[] = [];
  for (const destination of ['text', 'short-text'] as const) {
    const context = nativeContext(destination);
    for (const length of [0, 2000, 2001, 16_384, 16_385]) {
      const text = 'x'.repeat(length);
      for (const type of ['literal', 'read', 'expr'] as const) {
        for (const policy of [undefined, 'keep', 'later']) {
          const value = type === 'literal' ? literal(text) : type === 'read' ? read(text) : { type, value: literal('Ready'), fallback: text };
          if (!record(value)) throw new Error('Expected slot.');
          cases.push({ name: `${destination}/${type}/${length}/${policy ?? 'default'}`, context, value: { ...value, ...(policy === undefined ? {} : { whenUnavailable: policy }) } });
        }
      }
    }
  }
  const symbolContext = nativeContext('symbol');
  const conditions: Json[] = [viewer, { type: 'compare', op: 'eq', left: literal(1), right: literal(1) }, { type: 'future-condition' }, copy(predicateBudgetFixtures.early)];
  const symbols: Json[] = [symbol(), symbol(''), null, { type: 'none' }, literal('not a symbol')];
  for (const [i, when] of conditions.entries()) for (const [j, then] of symbols.entries()) {
    cases.push({ name: `symbol-rule/${i}/${j}`, context: symbolContext, value: { type: 'conditional', cases: [{ when, then }], otherwise: symbol() } });
  }
  for (const value of [
    { type: 'bound-symbol', value: literal('lightbulb'), fallback: symbol() },
    { type: 'bound-symbol', value: literal(1), fallback: symbol() },
    { type: 'bound-symbol', value: literal('lightbulb'), fallback: null },
    null,
  ]) cases.push({ name: `symbol/${cases.length}`, context: symbolContext, value });
  const actions: Json[] = [
    truncatedCall, { type: 'call-service', domain: 'light', service: 'turn_on' }, { type: 'none' },
    { type: 'push', pageId: 'page-echo', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
    { type: 'call-service', domain: 'light', service: 'turn_on', data: { type: 'object', fields: { n: { type: 'math', op: 'future-operation', args: [literal(1)] } } } },
    { type: 'conditional', cases: [{ when: viewer, then: truncatedCall }], otherwise: { type: 'none' } },
  ];
  for (const destination of ['action', 'navigation-action'] as const) {
    const context = nativeContext(destination);
    for (const [i, when] of conditions.entries()) for (const [j, then] of actions.entries()) {
      cases.push({ name: `${destination}-rule/${i}/${j}`, context, value: { type: 'conditional', cases: [{ when, then }], otherwise: { type: 'none' } } });
    }
  }
  let seed = 0x24c0ffee;
  const next = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let i = 0; i < 24; i++) {
    const context = nativeContext(), document = copy(context.document);
    if (!record(document) || !Array.isArray(document.dataSources)) throw new Error('Expected native sources.');
    const index = document.dataSources.length;
    document.dataSources.push({ id: 'generated', kind: 'ha-entity', entityId: literal('sensor.demo_graph') });
    const op = ['sum', 'min', 'average', 'count'][next(4)];
    cases.push({
      name: `flow/seed-24c0ffee/${i}`, kind: 'flow', context: { document, pointer: `/dataSources/${index}` },
      value: {
        id: 'generated', kind: 'model', model: 'pipeline@1',
        inputs: {
          title: 'Seeded flow', parameters: [],
          request: { type: 'none', value: literal(Array.from({ length: next(6) }, () => next(3) ? next(100) : null)) },
          steps: [{ id: 'reduce', op, ...(op === 'count' ? {} : { value: { type: 'item', path: [] } }) }],
          output: { kind: 'scalar' }, schema: { kind: 'number' },
        },
      },
    });
  }
  const context = nativeContext();
  for (const value of [2, '2', false, null, { n: 1 }, [1]]) {
    cases.push({
      name: `edited-expression/${JSON.stringify(value)}`, context,
      editedFrom: { type: 'expr', value: literal(1) }, value: { type: 'expr', value: literal(value) },
    });
  }
  return cases;
}

describe('permanent deterministic compiler comparison', () => {
  it.each(comparisonCases())('$name agrees on acceptance, first issue and exact capabilities, then relifts losslessly', assertParity);
});

function nativeRun(document: Json) {
  try { return { ok: true as const, capabilities: compileCompositionDocument(document).capabilities }; }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { ok: false as const, issues: error.issues };
  }
}
const flow = (id: string, inputs: Partial<GraphPipelineInputs> = {}) => graphSourceSchema.parse({
  id, kind: 'model', model: 'pipeline@1',
  inputs: { title: 'Comparison', parameters: [], request: { type: 'none', value: literal(1) }, steps: [], output: { kind: 'scalar' }, schema: { kind: 'number' }, ...inputs },
});
const sourceRead = (sourceId: string) => operandBase.parse({ type: 'read', from: { type: 'source', sourceId, path: ['value'] }, as: 'number', missing: 'unavailable' });
function withSources(input: GraphJSON, sources: Json[]): Json {
  const document = copy(input);
  if (!record(document) || !Array.isArray(document.dataSources)) throw new Error('Expected native sources.');
  return { ...document, dataSources: [...document.dataSources, ...sources] };
}
function random(seed: number) {
  return (max: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max; };
}
const seeds = [0x24c0ffee, 0xa43d91e7];
const sourceCases = seeds.flatMap(seed => {
  const next = random(seed);
  return Array.from({ length: 24 }, (_, i) => {
    const op = ['sum', 'min', 'average', 'count'][next(4)];
    const source: Json = {
      ...flow(`seed-${i}`), inputs: {
        ...flow('prefix').inputs,
        request: { type: 'none', value: literal(Array.from({ length: next(6) }, () => next(3) ? next(100) : null)) },
        steps: [{ id: 'reduce', op: i % 11 === 0 ? 'future-operation' : op, ...(op === 'count' ? {} : { value: { type: 'item', path: [] } }) }],
      },
    };
    return { name: `seed-${seed.toString(16)}/${i}`, source };
  });
});

describe('standalone source and flow-input document comparison', () => {
  it('includes the source binding envelope even for a scalar flow with no operand requirements', () => {
    const source = flow('scalar'), baseline = compileCompositionDocument(emptyDocument());
    const native = compileCompositionDocument(withSources(emptyDocument(), [source]));
    const required = native.capabilities.filter(capability => !baseline.capabilities.includes(capability));
    expect(required).toEqual(['sh.bindings@1', 'sh.pipeline@1']);
    const graph = lift(source, { kind: 'flow' }).graph;
    expect(lower(graph, { targetCapabilities: required })).toMatchObject({ ok: true, capabilities: required, budgets: [{ capabilities: required }] });
    expect(lower(graph, { targetCapabilities: ['sh.pipeline@1'] }).ok).toBe(false);
  });
  it.each(sourceCases)('$name agrees with a source in an otherwise empty native document, including relift', ({ source }) => {
    const baseline = compileCompositionDocument(emptyDocument()), native = nativeRun(withSources(emptyDocument(), [source]));
    if (!record(source)) throw new Error('Expected source.');
    for (const kind of ['flow', 'flow-inputs'] as const) {
      const ast = kind === 'flow' ? source : source.inputs, graph = lift(ast, { kind }).graph, result = lower(graph);
      expect(validateGraph(graph).filter(issue => issue.severity === 'error')).toEqual([]);
      expect(result.ok).toBe(native.ok);
      expect(result.budgets[0].accepted).toBe(native.ok);
      if (result.ok && native.ok) {
        const capabilities = native.capabilities.filter(capability => !baseline.capabilities.includes(capability));
        expect(result.capabilities).toEqual(capabilities);
        expect(result.budgets[0].capabilities).toEqual(capabilities);
        expect(lower(lift(result.ast, { kind }).graph)).toMatchObject({ ok: true, ast, capabilities });
      } else {
        if (result.ok || native.ok) throw new Error('Expected native refusal.');
        const issue = native.issues[0], pointer = issue.pointer.replace(`/document/dataSources/0${kind === 'flow-inputs' ? '/inputs' : ''}`, '');
        expect(result.errors[0]).toMatchObject({ ...issue, pointer });
        expect(result.budgets[0].compilerIssues[0]).toEqual({ ...issue, pointer });
      }
    }
  });
});

const adversarialFlowInputs = [0xa43d91e7, 0x5e19b6c3].flatMap(seed => {
  const next = random(seed);
  return Array.from({ length: 128 }, (_, i) => {
    const producer = flow(i % 7 === 0 ? 'graph-flow' : `upstream-${i}`);
    const consumer = flow(`consumer-${i}`, {
      parameters: [{ name: 'upstream', type: 'number', value: sourceRead(producer.id) }],
      request: { type: 'none', value: { type: 'literal', value: next(100) } },
      ...(i % 3 === 0 ? { refresh: { on: ['manual'], staleAfterSeconds: 30 } } : {}),
      ...(i % 5 === 0 ? { schema: { kind: 'boolean' } } : {}),
    });
    return { seed: seed.toString(16), i, producer, consumer };
  });
});

describe('adversarial flow-input compiler comparison', () => {
  it.each(adversarialFlowInputs)('seed $seed case $i agrees on acceptance, capabilities and diagnostic coordinates', ({ producer, consumer }) => {
    const document = withSources(emptyDocument(), [producer, consumer]), native = nativeRun(document);
    const baseline = compileCompositionDocument(emptyDocument()).capabilities;
    for (const options of [{}, { sourceId: consumer.id }, { context: { document, pointer: '/dataSources/1/inputs' } }]) {
      const graph = lift(consumer.inputs, { kind: 'flow-inputs', ...options }).graph;
      expect(validateGraph(graph).filter(issue => issue.severity === 'error')).toEqual([]);
      for (const current of [graph, lift(projectGraph(graph).ast, { kind: 'flow-inputs', ...options }).graph]) {
        const result = lower(current);
        expect(result.ok).toBe(native.ok);
        expect(result.budgets[0].accepted).toBe(native.ok);
        if (result.ok && native.ok) {
          const capabilities = 'context' in options ? native.capabilities : native.capabilities.filter(capability => !baseline.includes(capability));
          expect(result.capabilities).toEqual(capabilities);
          expect(result.ast).toEqual(consumer.inputs);
          expect(result.budgets[0].capabilities).toEqual(result.capabilities);
        } else {
          if (result.ok || native.ok) throw new Error('Expected semantic flow-input refusal.');
          const issues = native.issues.map(issue => ({ ...issue, pointer: issue.pointer.replace('/document/dataSources/1/inputs', '') }));
          expect(result.errors[0]).toMatchObject(issues[0]);
          expect(result.errors).toEqual(issues.map(issue => expect.objectContaining(issue)));
          expect(result.budgets[0].compilerIssues).toEqual(issues);
        }
      }
    }
  });

  it.each([
    ['output', { output: { kind: 'records', max: 10 } }, '/output/kind', '/output'],
    ['refresh', { refresh: { on: ['manual'], staleAfterSeconds: 60 } }, '/refresh', ''],
    ['budget', { request: { type: 'none', value: { type: 'list', items: Array.from({ length: 64 }, () => literal(1)) } }, steps: [{ id: 'reduce', op: 'count' }] }, '/request/value/items/63', '/request/value/items/63'],
  ] as const)('maps a semantic %s refusal to the responsible input block', (name, patch, pointer, owner) => {
    const source = graphSourceSchema.parse({ ...flow('consumer'), inputs: { ...flow('consumer').inputs, ...patch } });
    const native = nativeRun(withSources(emptyDocument(), [source]));
    if (native.ok) throw new Error('Expected native semantic refusal.');
    expect(native.issues[0].pointer).toBe(`/document/dataSources/0/inputs${pointer}`);
    const graph = lift(source.inputs, { kind: 'flow-inputs', sourceId: source.id }).graph;
    const nodeId = graph.nodes.find(node => node.origins[0] === owner)!.id;
    expect(lower(graph)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ pointer, nodeId })]) });
    const budget = measureBudget(source.inputs, graph.roots[0].anchor, { kind: 'flow-inputs', sourceId: source.id });
    expect(budget.compilerIssues).toEqual(native.issues.map(issue => ({ ...issue, pointer: issue.pointer.replace('/document/dataSources/0/inputs', '') })));
    if (name === 'budget') expect(budget.firstExceedingPointer).toBe(pointer);
  });

  it('closes source dependencies only under a real source identity, with input-relative paths', () => {
    const source = flow('consumer', { parameters: [{ name: 'self', type: 'number', value: sourceRead('consumer') }] });
    const options = { kind: 'flow-inputs' as const };
    expect(lower(lift(source.inputs, options).graph).ok).toBe(true);
    expect(compileGraphValue(source.inputs, options).dependencies).toEqual([]);
    const identified = compileGraphValue(source.inputs, { ...options, sourceId: source.id });
    expect(identified.dependencies).toEqual([{ from: 'consumer', to: 'consumer', path: '/parameters/0/value/from/sourceId' }]);
    const native = nativeRun(withSources(emptyDocument(), [source]));
    if (native.ok) throw new Error('Expected native self-cycle.');
    for (const identity of [{ sourceId: source.id }, { anchor: { kind: 'flow' as const, id: source.id, field: '/inputs' } }]) {
      const result = lower(lift(source.inputs, { ...options, ...identity }).graph);
      expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: native.issues[0].code, pointer: '/parameters/0/value/from/sourceId' })] });
      expect(result.budgets[0].accepted).toBe(false);
    }
  });

  it('retains real ownership and rebased dependency landings across input roots', () => {
    const sources = ['a', 'b'].map((id, i) => flow(id, { parameters: [{ name: 'other', type: 'number', value: sourceRead(i === 0 ? 'b' : 'a') }] }));
    const graph = lift({ dataSources: sources }, { kind: 'fragment' }).graph;
    const roots = sources.map((source, i) => ({
      nodeId: graph.nodes.find(node => node.origins[0] === `/dataSources/${i}/inputs`)!.id, portId: 'value',
      anchor: { kind: 'flow' as const, id: source.id, field: '/inputs' },
      destination: { kind: 'flow' as const, sourceId: source.id },
    }));
    const result = lower({ ...graph, roots });
    expect(result).toMatchObject({
      ok: false,
      errors: roots.map(root => expect.objectContaining({ anchor: root.anchor, code: 'invalid_combination', pointer: '/parameters/0/value/from/sourceId' })),
      budgets: roots.map(() => expect.objectContaining({ accepted: false, compilerIssues: [{ code: 'invalid_combination', pointer: '/parameters/0/value/from/sourceId' }] })),
    });
  });
});

describe('synthetic fragment native pipeline limits', () => {
  it('retains compiler-recorded entity endpoints across a checked source bundle', () => {
    const source = flow('entity-count', {
      request: { type: 'entities', entityIds: [{ type: 'literal', value: 'light.demo_one' }], attributes: [] },
      steps: [{ id: 'reduce', op: 'count' }],
    });
    const facts = compiler.checkCompositionPipelineBundle([source]);
    expect(facts.issues).toEqual([]);
    expect(facts.entities).toEqual([{ id: 'light.demo_one', path: '/dataSources/0/inputs/request/entityIds/0' }]);
    expect(facts.entities).toEqual(facts.sources[0].entities);
  });

  it.each([128, 129])('accounts for %i pipelines across recursion without checking any source twice', count => {
    const sources = Array.from({ length: count }, (_, i) => flow(`fragment-${i}`));
    const baseline = compileCompositionDocument(emptyDocument()), native = nativeRun(withSources(emptyDocument(), sources));
    const check = vi.spyOn(compiler, 'checkCompositionPipelineSource');
    let result: ReturnType<typeof lower>;
    try {
      result = lower(lift({ dataSources: sources }, { kind: 'fragment' }).graph);
      expect(check).toHaveBeenCalledTimes(count);
      expect(check.mock.calls.map(call => call[2])).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    } finally { check.mockRestore(); }
    expect(result.ok).toBe(native.ok);
    expect(result.budgets[0].accepted).toBe(native.ok);
    if (result.ok && native.ok) expect(result.capabilities).toEqual(native.capabilities.filter(capability => !baseline.capabilities.includes(capability)));
    else {
      if (result.ok || native.ok) throw new Error('Expected native pipeline-limit refusal.');
      const issue = { ...native.issues[0], pointer: native.issues[0].pointer.replace(/^\/document/, '') };
      expect(result.errors[0]).toMatchObject(issue);
      expect(result.budgets[0]).toMatchObject({ compilerIssues: [issue], firstExceedingPointer: '/dataSources/128' });
    }
    const nested = compileGraphValue({ dataSources: sources.slice(0, 64), group: { dataSources: sources.slice(64) } }, { kind: 'fragment' });
    expect(nested.issues).toEqual(count === 129 ? [{ code: 'limit_exceeded', pointer: '/group/dataSources/64' }] : []);
  });
});

describe('single-pass graph checker reuse', () => {
  it('reuses original path prefixes only within a validation, not across same-object edits', () => {
    const source: Json = { ...flow('cached'), inputs: { ...flow('cached').inputs, steps: [{ id: 'later', op: 'future-operation' }] } };
    const graph = lift(source, { kind: 'flow' }).graph, original = copy(graph.original);
    const step = atPointer(original, '/inputs/steps/0');
    if (!record(step)) throw new Error('Expected opaque future step.');
    const live = { ...graph, original };
    expect(validateGraph(live).filter(issue => issue.severity === 'error')).toEqual([]);
    step.op = 'another-future-operation';
    expect(validateGraph(live)).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'opaque_region', severity: 'error' })]));
    step.op = 'future-operation';
    expect(validateGraph(live).filter(issue => issue.severity === 'error')).toEqual([]);
  });

  it('does not assemble a structural root to return its existing output type', () => {
    const graph = lift(largeGraphFlow(), { kind: 'flow' }).graph;
    const copied = vi.spyOn(graphJSON, 'copy');
    try {
      expect(validateGraph(graph).filter(issue => issue.severity === 'error')).toEqual([]);
      expect(copied).not.toHaveBeenCalled();
    } finally { copied.mockRestore(); }
  });

  it('does not retype flow operands or predicates to build a budget from native output', () => {
    const source = flow('filtered', {
      request: { type: 'none', value: { type: 'literal', value: [1, 2] } },
      steps: [{ id: 'keep', op: 'filter', where: { type: 'exists', value: { type: 'item', path: [] } } }, { id: 'reduce', op: 'count' }],
    });
    const compiled = compileGraphValue(source, { kind: 'flow' });
    expect(compiled.issues).toEqual([]);
    const operands = vi.spyOn(typing, 'typeOperand'), predicates = vi.spyOn(typing, 'typeWhere');
    try {
      const budget = budgetFromCompilation(source, { kind: 'flow', id: source.id, field: '' }, compiled, { kind: 'flow' });
      expect(budget).toMatchObject({ accepted: true, accounting: 'unavailable', meters: [], conditions: [{ nodes: null }] });
      expect(operands).not.toHaveBeenCalled();
      expect(predicates).not.toHaveBeenCalled();
    } finally { operands.mockRestore(); predicates.mockRestore(); }
  });

  it('checks a standalone call once with actual permissions, not through the lenient schema too', () => {
    const graph = lift(truncatedCall, { kind: 'call' }).graph;
    const lenient = vi.spyOn(expression.callServiceSchema, 'safeParse'), scoped = vi.spyOn(expression, 'checkCallService');
    try {
      expect(lower(graph).ok).toBe(true);
      expect(scoped).toHaveBeenCalledTimes(1);
      expect(lenient).not.toHaveBeenCalled();
      expect(measureBudget(truncatedCall, graph.roots[0].anchor, { kind: 'call' }).accepted).toBe(true);
      expect(scoped).toHaveBeenCalledTimes(2);
      expect(lenient).not.toHaveBeenCalled();
    } finally { lenient.mockRestore(); scoped.mockRestore(); }
  });

  it.each<Json>([
    { ...truncatedCall, domain: 'bad-domain' },
    { ...truncatedCall, unknown: true },
    { ...truncatedCall, target: {} },
    { ...truncatedCall, target: { entity_id: literal(null) } },
  ])('retains the native call shape and first semantic refusal for $domain', call => {
    const context = nativeContext('action'), native = nativeRun(replaceAt(copy(context.document), context.pointer, call));
    if (native.ok) throw new Error('Expected native call refusal.');
    const result = lower(lift(call, { kind: 'call' }).graph);
    if (result.ok) throw new Error('Expected standalone call refusal.');
    expect(result.errors[0]).toMatchObject({ ...native.issues[0], pointer: native.issues[0].pointer.replace(`/document${context.pointer}`, '') });
  });
});

function recipeContext(condition: boolean): Context {
  const context = nativeContext(), pointer = context.pointer.replace(/\/props\/value$/, '/visibleWhen');
  if (condition) {
    const owner = atPointer(context.document, '/pages/1/components/0');
    if (!record(owner)) throw new Error('Expected native condition consumer.');
    return { document: replaceAt(copy(context.document), '/pages/1/components/0', { ...owner, visibleWhen: viewer }), pointer };
  }
  return { document: replaceAt(copy(context.document), context.pointer, { type: 'expr', value: literal(0) }), pointer: `${context.pointer}/value` };
}

describe('recipe bundle differential comparison', () => {
  it('uses the native JSON safety guard before copying a consuming document', () => {
    const document: Record<string, Json> = {};
    document.self = document;
    const expected = { ok: false, errors: [expect.objectContaining({ code: 'invalid_value', pointer: '/self' })] };
    expect(lowerFlowBranches([flow('generated')], [], document)).toMatchObject(expected);
    expect(lowerForEach({ mode: 'flow', id: 'generated', reducer: 'count', entityIds: ['light.demo_one'], attributes: [], context: { document, pointer: '' } })).toMatchObject(expected);
  });
  it.each(seeds.flatMap(seed => {
    const next = random(seed);
    return Array.from({ length: 24 }, (_, i) => ({ seed, i, average: next(2) === 0, reducer: (['count', 'any', 'all'] as const)[next(3)], cycle: i % 5 === 0 }));
  }))('seed $seed case $i checks generated dependencies and the consuming destination atomically', ({ i, seed, average, reducer, cycle }) => {
    const id = `recipe-${seed}-${i}`, prefix = flow('prefix', {
      request: { type: 'none', value: { type: 'literal', value: [{ n: 1 }, { n: 2 }] } },
      output: { kind: 'records', max: 100 }, schema: { kind: 'array', of: { kind: 'object', fields: { n: { shape: { kind: 'number' } } } } },
    }).inputs;
    const build = (prefix: GraphPipelineInputs, context?: Context) => average
      ? lowerListAverage({ id, prefix, value: { type: 'item', path: ['n'] }, strategy: 'two-flow', targetCapabilities: supportedCompositionCapabilities, context })
      : lowerForEach({ mode: 'flow', id, prefix, reducer, test: { type: 'exists', value: { type: 'item', path: ['n'] } }, context });
    const initial = build(prefix);
    if (!initial.ok) throw new Error(JSON.stringify(initial.errors));
    const context = recipeContext(!average && reducer !== 'count');
    const parameters = cycle ? [{ name: 'other', type: 'number' as const, value: sourceRead(initial.value.sources[0].id) }] : [];
    const edited = { ...prefix, parameters };
    const sources = initial.value.sources.map(source => ({ ...source, inputs: { ...source.inputs, parameters } }));
    const complete = replaceAt(withSources(context.document, sources), context.pointer, initial.value.ast), native = nativeRun(complete);
    expect(native.ok).toBe(!cycle);
    for (const contextual of [false, true]) {
      const result = build(edited, contextual ? context : undefined);
      expect(result.ok).toBe(native.ok);
      if (result.ok && native.ok) {
        const baseline = compileCompositionDocument(context.document).capabilities;
        const capabilities = contextual ? result.value.capabilities : [...new Set([...baseline, ...result.value.capabilities])].sort();
        expect(capabilities).toEqual(native.capabilities);
        expect(result.value.budgets.every(budget => budget.accepted)).toBe(true);
        const graph = lift(complete, { kind: 'document' }).graph;
        expect(lower(graph)).toMatchObject({ ok: true, ast: complete, capabilities: native.capabilities });
      } else {
        if (result.ok || native.ok) throw new Error('Expected cyclic bundle refusal.');
        expect(result.errors[0].code).toBe(native.issues[0].code);
        if (contextual) expect(result.errors[0].pointer).toBe(native.issues[0].pointer.replace(/^\/document(?=\/|$)/, ''));
      }
    }
  });
  it.each(['self', 'mutual', 'acyclic'] as const)('compares a %s branch bundle against whole-document compilation', kind => {
    const sources = [
      flow('a', { parameters: [{ name: 'other', type: 'number', value: sourceRead(kind === 'self' ? 'a' : 'b') }] }),
      flow('b', kind === 'acyclic' || kind === 'self' ? {} : { parameters: [{ name: 'other', type: 'number', value: sourceRead('a') }] }),
    ];
    const document = emptyDocument(), native = nativeRun(withSources(document, sources));
    expect(native.ok).toBe(kind === 'acyclic');
    for (const context of [undefined, document]) {
      const result = lowerFlowBranches(sources, [], context);
      expect(result.ok).toBe(native.ok);
      if (!result.ok && !native.ok) expect(result.errors[0]).toMatchObject({ ...native.issues[0], pointer: native.issues[0].pointer.replace(/^\/document(?=\/|$)/, '') });
    }
    const graph = lift(withSources(document, sources), { kind: 'document' }).graph;
    expect(lower(graph).ok).toBe(native.ok);
  });
  it('includes dependencies through sources that already belong to the consuming document', () => {
    const existing = flow('existing', { parameters: [{ name: 'next', type: 'number', value: sourceRead('generated') }] });
    const generated = flow('generated', { parameters: [{ name: 'previous', type: 'number', value: sourceRead('existing') }] });
    const document = withSources(emptyDocument(), [existing]), native = nativeRun(withSources(document, [generated]));
    expect(native.ok).toBe(false);
    const result = lowerFlowBranches([generated], ['existing'], document);
    expect(result.ok).toBe(false);
    if (!result.ok && !native.ok) expect(result.errors[0]).toMatchObject({ ...native.issues[0], pointer: native.issues[0].pointer.replace(/^\/document(?=\/|$)/, '') });
  });
  it.each([[128, 0], [128, 127], [128, 128], [999, 0], [1000, 0]])('uses the consuming document with %i HA sources and %i existing pipelines for native limits', (ha, pipelines) => {
    const sources = [
      ...Array.from({ length: ha }, (_, i) => ({ id: `ha-${i}`, kind: 'ha-entity', entityId: literal(`sensor.demo_${i}`) })),
      ...Array.from({ length: pipelines }, (_, i) => flow(`pipeline-${i}`)),
    ], document = withSources(emptyDocument(), sources), branch = flow('generated');
    const native = nativeRun(withSources(document, [branch]));
    const result = lowerFlowBranches([branch], sources.map(source => source.id), document);
    expect(result.ok).toBe(native.ok);
    if (!result.ok && !native.ok) expect(result.errors[0]).toMatchObject({ ...native.issues[0], pointer: native.issues[0].pointer.replace(/^\/document(?=\/|$)/, '') });
    if (ha === 128 && pipelines === 0) expect(lowerFlowBranches([branch], sources.map(source => source.id))).toMatchObject({ ok: true });
  });
});

describe('native expansion provenance and single-compilation regressions', () => {
  it.each([false, true].flatMap(contextual => [false, true].map(overBudget => ({ contextual, overBudget }))))('keeps expansion landings for contextual=$contextual, overBudget=$overBudget', ({ contextual, overBudget }) => {
    const context = nativeContext(), library = [{
      id: 'duplicate', name: 'Duplicate', kind: 'operand', params: [{ name: 'value', kind: 'operand' }],
      body: { type: 'math', op: 'add', args: Array.from({ length: 8 }, () => ({ type: 'hole', name: 'value' })) },
    }];
    const document = copy(context.document);
    if (!record(document)) throw new Error('Expected native document.');
    document.logicLibrary = library;
    const value: Json = { type: 'expr', value: { type: 'logic-ref', logicId: 'duplicate', args: { value: overBudget ? { type: 'math', op: 'add', args: Array.from({ length: 8 }, () => literal(1)) } : literal(1) } } };
    const complete = replaceAt(document, context.pointer, value), pointer = `${contextual ? '' : context.pointer}/value/args/value`, usePointer = `${contextual ? '' : context.pointer}/value`;
    const graph = lift(contextual ? value : complete, contextual ? { kind: 'slot', context: { document, pointer: context.pointer } } : { kind: 'document' }).graph;
    const argument = graph.nodes.find(node => node.origins[0] === pointer)!;
    const result = lower(graph), native = nativeRun(complete);
    expect(result.ok).toBe(native.ok);
    expect(result.ok).toBe(!overBudget);
    if (result.ok && native.ok) {
      expect(result.capabilities).toEqual(native.capabilities);
      for (let i = 0; i < 8; i++) expect(result.sourceMap).toContainEqual(expect.objectContaining({
        stage: 'expanded', pointer: `${usePointer}/args/${i}`, nodeId: argument.id, authoredPointer: pointer, usePointer,
      }));
    } else {
      if (result.ok || native.ok) throw new Error('Expected expanded-budget refusal.');
      expect(result.errors[0]).toMatchObject({
        code: native.issues[0].code, nodeId: argument.id, portId: 'value', authoredPointer: pointer, usePointer,
      });
      expect(result.budgets[0].accepted).toBe(false);
    }
  });
  it('checks the 32-step, 2341-node edited flow once and reuses that result for its budget', () => {
    const source = largeGraphFlow(), graph = lift(source, { kind: 'flow' }).graph;
    expect(graph.nodes).toHaveLength(2341);
    const first = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal' && node.payload.value.value === 1)!;
    const edited: LogicGraph = { ...graph, nodes: graph.nodes.map(node => node.id === first.id ? { ...node, payload: { kind: 'operand', value: { type: 'literal', value: 2 } } } : node) };
    const check = vi.spyOn(compiler, 'checkCompositionPipelineSource');
    try {
      expect(validateGraph(edited).filter(issue => issue.severity === 'error')).toEqual([]);
      const result = lower(edited);
      expect(result).toMatchObject({ ok: true, budgets: [{ accepted: true }] });
      expect(check).toHaveBeenCalledTimes(1);
    } finally { check.mockRestore(); }
  });
  it('compiles a shared contextual document once, not once per field or budget', () => {
    const context = nativeContext(), graph = lift(copy(context.document), { kind: 'document' }).graph;
    const roots = [context.pointer, shortTextPointer].map(pointer => {
      const node = graph.nodes.find(node => node.origins[0] === pointer)!;
      return { ...graph.roots[0], nodeId: node.id, anchor: { ...graph.roots[0].anchor, field: pointer }, destination: { kind: 'slot' as const, context: { document: context.document, pointer } } };
    });
    const check = vi.spyOn(compiler, 'compileCompositionDocumentWithOrigins');
    try {
      expect(lower({ ...graph, roots })).toMatchObject({ ok: true, budgets: [{ accepted: true }, { accepted: true }] });
      expect(check).toHaveBeenCalledTimes(1);
    } finally { check.mockRestore(); }
  });
  it.each([false, true])('compiles a recipe bundle once with consuming context=%s', contextual => {
    const entry = vi.spyOn(compiler, contextual ? 'compileCompositionDocumentWithOrigins' : 'checkCompositionPipelineBundle');
    const individual = vi.spyOn(compiler, 'checkCompositionPipelineSource');
    try {
      expect(lowerForEach({
        mode: 'flow', id: 'once', entityIds: ['light.demo_one'], attributes: [], reducer: 'all',
        ...(contextual ? { context: recipeContext(true) } : {}),
      })).toMatchObject({ ok: true });
      expect(entry).toHaveBeenCalledTimes(1);
      expect(individual).not.toHaveBeenCalled();
    } finally { entry.mockRestore(); individual.mockRestore(); }
  });
  it('handles an authored replacement without imported origins and recomputes its wiring hints on the next edit', () => {
    const graph = lift({ type: 'math', op: 'add', args: [literal(1), literal(2)] }, { kind: 'operand' }).graph;
    const first = graph.nodes.find(node => node.origins[0] === '/args/0')!;
    const edit = (value: number | string): LogicGraph => ({
      ...graph, nodes: graph.nodes.map(node => node.id === first.id ? {
        ...node, provenance: 'authored', origins: [], payload: { kind: 'operand', value: { type: 'literal', value } },
      } : node),
    });
    expect(lower(edit(3))).toMatchObject({ ok: true, ast: { type: 'math', op: 'add', args: [literal(3), literal(2)] }, diagnostics: [] });
    expect(lower(edit('3'))).toMatchObject({ ok: true, diagnostics: expect.arrayContaining([expect.objectContaining({ hint: true, code: 'binding_type' })]) });
  });
});
