import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { operandBase } from '../../../src/shared/composition/expression';
import { CompositionValidationError, canonicalCompositionJSON } from '../../../src/shared/composition/json';
import { lift, lower, measureBudget, projectGraph, validateGraph, type GraphDestination, type LogicGraph } from '../../../src/shared/composition/graph';
import { atPointer, copy, record, replaceAt } from '../../../src/shared/composition/graph/json';
import type { Json } from '../../../src/shared/types';
import { nativeContext, shortTextPointer, symbol } from './fixtures/native';
import { predicateBudgetFixtures } from './fixtures';

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
