import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkCompositionPipelineBundle, checkCompositionPipelineSource, compileCompositionDocument, compileCompositionDocumentWithOrigins, parseCompositionShape,
} from '../../../src/shared/composition/compiler';
import * as expression from '../../../src/shared/composition/expression';
import type { BudgetAccountingEvent, BudgetAccountingObserver, CallService, Operand, Predicate } from '../../../src/shared/composition/expression';
import { checkPipelineSource } from '../../../src/shared/composition/pipeline/compile';
import type { PipelineSource } from '../../../src/shared/composition/pipeline/schema';
import type { Shape } from '../../../src/shared/composition/pipeline/shape';
import { newFacts, typeSteps } from '../../../src/shared/composition/pipeline/typing';
import { createCompositionDocument } from '../../../src/shared/composition/workspace';
import { compositionDocumentSchema, type CompositionDocument, type CompositionNode } from '../../../src/shared/composition/schema';
import { CompositionValidationError, parseCompositionJSON } from '../../../src/shared/composition/json';

afterEach(() => vi.restoreAllMocks());
const literal = (value: string | number | boolean = 1): Operand => ({ type: 'literal', value });
const compare = (): Predicate => ({ type: 'compare', op: 'eq', left: literal(), right: literal() });
const allOf = (): Predicate => ({ type: 'all', of: Array.from({ length: 16 }, compare) });
const choose = (): Operand => ({ type: 'choose', cases: [{ when: allOf(), then: literal() }], otherwise: literal(0) });
function call(targets = 59): CallService {
  return {
    type: 'call-service', domain: 'light', service: 'turn_on',
    data: { type: 'object', fields: { payload: { type: 'list', items: Array.from({ length: 63 }, () => literal()) } } },
    target: { entity_id: { type: 'list', items: Array.from({ length: targets }, () => literal('light.demo')) } },
    confirmation: { type: 'additional', style: 'alert', title: 'Confirm', confirmLabel: 'Run', cancelLabel: 'Cancel', destructive: false, when: compare() },
  };
}
function earlyReset(): Predicate {
  return { type: 'all', of: Array.from({ length: 2 }, (_, group) => ({
    type: 'all', of: Array.from({ length: 16 }, (_, index): Predicate => group === 0 && index === 0
      ? {
        type: 'compare', op: 'eq', right: literal(),
        left: { type: 'choose', cases: [{ when: { type: 'viewer', isAdmin: true }, then: literal() }], otherwise: literal(0) },
      }
      : { type: 'viewer', isAdmin: true }),
  })) };
}
function thrown(operation: () => unknown): unknown {
  try { operation(); }
  catch (error) { return error; }
  throw new Error('Expected an exception');
}
function refusal(operation: () => unknown) {
  const error = thrown(operation);
  if (!(error instanceof CompositionValidationError)) throw error;
  return error.issues;
}
function recording() {
  const events: BudgetAccountingEvent[] = [];
  const observer: BudgetAccountingObserver = event => { events.push(event); };
  return { events, observer };
}
function document(node?: CompositionNode): CompositionDocument {
  const base = createCompositionDocument('observer-forwarding');
  if (node) base.pages[0].components = [node];
  return base;
}
function text(value?: Operand, visibleWhen?: Predicate): CompositionNode {
  return {
    id: 'value', title: 'Value', type: 'text', layout: { span: 1 },
    props: { value: value ? { type: 'expr', value } : { type: 'literal', value: 'Text' }, style: 'body', unavailableText: 'None' },
    ...(visibleWhen ? { visibleWhen } : {}),
  };
}
function flow(): PipelineSource {
  return {
    id: 'flow', kind: 'model', model: 'pipeline@1',
    inputs: {
      title: 'Observed flow',
      parameters: [{ name: 'factor', type: 'number', value: literal(2) }],
      request: { type: 'entity-attribute', entityId: { type: 'literal', value: 'sensor.demo_values' }, path: ['values'], responseShape: { kind: 'array', of: { kind: 'number' } } },
      refresh: { on: ['open'], staleAfterSeconds: 30 },
      steps: [
        { id: 'keep', op: 'filter', where: allOf() },
        { id: 'scale', op: 'map', fields: { value: { type: 'math', op: 'multiply', args: [{ type: 'item', path: [] }, { type: 'param', name: 'factor' }] } } },
        { id: 'mean', op: 'average', value: { type: 'item', path: ['value'] } },
      ],
      output: { kind: 'scalar' }, schema: { kind: 'number' },
    },
  };
}

describe('compiler accounting observer forwarding', () => {
  it('emits the exact direct Checker events for the 49-AST / 17-predicate Choose without changing results', () => {
    const operand = choose(), direct = recording(), compiled = recording();
    expression.checkOperand(operand, '/document/pages/0/components/0/props/value/value', false, false, undefined, direct.observer);
    const input = document(text(operand)), plain = compileCompositionDocument(input);
    expect(compileCompositionDocument(input, { accountingObserver: compiled.observer })).toStrictEqual(plain);
    expect(compiled.events).toStrictEqual(direct.events);
    expect(compiled.events.some(event => event.type === 'condition-budget')).toBe(true);
    expect(compiled.events.filter(event => event.type === 'scope' && event.kind === 'expression')).toHaveLength(1);
    const origins = recording();
    expect(compileCompositionDocumentWithOrigins(input, { accountingObserver: origins.observer })).toStrictEqual(compileCompositionDocumentWithOrigins(input));
    expect(origins.events).toStrictEqual(direct.events);
  });

  it('preserves direct uncapped null predicate scope limits and actual counters', () => {
    const predicate: Predicate = { type: 'all', of: Array.from({ length: 2 }, () => ({ type: 'all', of: Array.from({ length: 16 }, () => ({ type: 'viewer', isAdmin: true })) })) };
    const direct = recording(), compiled = recording(), input = document(text(undefined, predicate));
    expression.checkPredicate(predicate, '/document/pages/0/components/0/visibleWhen', false, undefined, direct.observer);
    expect(compileCompositionDocument(input, { accountingObserver: compiled.observer })).toStrictEqual(compileCompositionDocument(input));
    expect(compiled.events).toStrictEqual(direct.events);
    expect(compiled.events).toContainEqual(expect.objectContaining({ type: 'scope', kind: 'predicate', nodeLimit: null, depthLimit: null }));
    expect(compiled.events).toContainEqual(expect.objectContaining({ type: 'node', nodes: 35, remaining: null }));
  });

  it('forwards the unchanged observer through shared 128-node service-call accounting', () => {
    const action = call();
    const direct = recording(), compiled = recording();
    expression.checkCallService(action, '/document/pages/0/components/0/action', false, undefined, undefined, direct.observer);
    const input = document({ id: 'run', title: 'Run', type: 'primary-button', layout: { span: 1 }, props: {}, action });
    expect(compileCompositionDocument(input, { accountingObserver: compiled.observer })).toStrictEqual(compileCompositionDocument(input));
    expect(compiled.events).toStrictEqual(direct.events);
    expect(compiled.events).toContainEqual(expect.objectContaining({ type: 'node', nodes: 128, remaining: 0 }));
  });

  it('does not replay the checker or attach accounting properties to unobserved/observed results', () => {
    const spies = [vi.spyOn(expression, 'checkOperand'), vi.spyOn(expression, 'checkPredicate'), vi.spyOn(expression, 'checkCallService')];
    const input = document(text(choose(), compare()));
    const plain = compileCompositionDocument(input), counts = spies.map(spy => spy.mock.calls.length);
    spies.forEach(spy => spy.mockClear());
    const { observer } = recording(), observed = compileCompositionDocument(input, { accountingObserver: observer });
    expect(spies.map(spy => spy.mock.calls.length)).toEqual(counts);
    expect(observed).toStrictEqual(plain);
    expect(Object.keys(observed)).toEqual(Object.keys(plain));
    expect(spies[0].mock.calls.some(args => args[5] === observer)).toBe(true);
  });
});

describe('accounting from the schema pass that actually refuses a document', () => {
  it('observes shared-call 129 exactly once, with the direct Checker trace and unchanged diagnostics', () => {
    const action = call(60), input = document({ id: 'run', title: 'Run', type: 'primary-button', layout: { span: 1 }, props: {}, action });
    const direct = recording(), compiled = recording();
    expression.checkCallService(action, '/document/pages/0/components/0/action', true, 'lenient', 'any', direct.observer);
    const spy = vi.spyOn(expression, 'checkCallService');
    const plain = refusal(() => compileCompositionDocument(input)), calls = spy.mock.calls.length;
    spy.mockClear();
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: compiled.observer }))).toStrictEqual(plain);
    expect(spy.mock.calls).toHaveLength(calls);
    expect(compiled.events).toStrictEqual(direct.events);
    expect(compiled.events).toHaveLength(134);
    expect(plain).toEqual([{ code: 'limit_exceeded', pointer: '/document/pages/0/components/0/action/confirmation/when/right' }]);
  });

  it.each(['visibleWhen', 'activeWhen', 'filledWhen', 'errorWhen'] as const)('observes the early CHK-nested-choose-budget refusal in %s without changing it', field => {
    const envelope = parseCompositionJSON(readFileSync('contract/corpus/accept/tile-look-all.json'));
    if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope) || !('document' in envelope)) throw new Error('Expected publication fixture');
    const input = parseCompositionShape(compositionDocumentSchema, envelope.document), tile = input.pages[2].components[0];
    if (tile.type !== 'state-tile') throw new Error('Expected state tile fixture');
    const predicate = earlyReset(), direct = recording(), compiled = recording();
    tile[field] = predicate;
    expression.checkPredicate(predicate, `/document/pages/2/components/0/${field}`, false, 'lenient', direct.observer);
    const spy = vi.spyOn(expression, 'checkPredicate');
    const plain = refusal(() => compileCompositionDocument(input)), calls = spy.mock.calls.length;
    spy.mockClear();
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: compiled.observer }))).toStrictEqual(plain);
    expect(spy.mock.calls).toHaveLength(calls);
    expect(compiled.events).toStrictEqual(direct.events);
    expect(compiled.events).toHaveLength(81);
    expect(plain).toEqual([{ code: 'limit_exceeded', pointer: `/document/pages/2/components/0/${field}/of/1/of/15` }]);
  });

  it('reports the actual 33-step schema limit, equal to direct typeSteps observation, without starting flow typing', () => {
    const source = flow(), input = document(), direct = recording(), compiled = recording();
    source.inputs.parameters = [];
    source.inputs.steps = Array.from({ length: 33 }, (_, index) => ({ id: `step-${index}`, op: 'limit', count: 1 }));
    input.dataSources = [source];
    typeSteps(source.inputs.steps, { kind: 'array', of: { kind: 'number' } }, new Map(), '/document/dataSources/0/inputs', newFacts(), direct.observer);
    const spy = vi.spyOn(expression, 'checkOperand');
    const plain = refusal(() => compileCompositionDocument(input)), calls = spy.mock.calls.length;
    spy.mockClear();
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: compiled.observer }))).toStrictEqual(plain);
    expect(spy.mock.calls).toHaveLength(calls);
    expect(compiled.events).toStrictEqual(direct.events);
    expect(compiled.events).toEqual([{ type: 'steps', scopeId: 'steps:/document/dataSources/0/inputs', pointer: '/document/dataSources/0/inputs/steps', count: 33, limit: 32 }]);
    const bundle = recording(), bundleDirect = recording();
    typeSteps(source.inputs.steps, { kind: 'array', of: { kind: 'number' } }, new Map(), '/dataSources/0/inputs', newFacts(), bundleDirect.observer);
    expect(checkCompositionPipelineBundle([source], undefined, bundle.observer)).toStrictEqual(checkCompositionPipelineBundle([source]));
    expect(bundle.events).toStrictEqual(bundleDirect.events);
  });
});

describe('structurally refused rules use one observation-only Checker', () => {
  const rule = (otherwise: Operand): Operand => ({
    type: 'choose', cases: Array.from({ length: 17 }, (): { when: Predicate; then: Operand } => ({
      when: { type: 'viewer', isAdmin: true }, then: literal(),
    })), otherwise,
  });
  const format = (value: Operand): Operand => ({ type: 'format', pattern: '{value}', args: { value } });
  it.each([
    ['wrapped rule', format(rule(literal())), 91],
    ['refused rule nested inside another refused rule', rule(rule(literal())), 174],
    ['two sibling refusals under one root', { type: 'list', items: [rule(literal()), rule(format(literal()))] }, 175],
  ] satisfies [string, Operand, number][])('retains the owning budget for %s at every document/flow boundary', (_name, value, count) => {
    const source = flow();
    source.inputs.steps = [{ id: 'map', op: 'map', fields: { value } }];
    const input = document(text(value)), pipeline = { ...document(), dataSources: [source] };
    const entries: [string, (observer?: BudgetAccountingObserver) => unknown][] = [
      ['/document/pages/0/components/0/props/value/value', observer => refusal(() => compileCompositionDocument(input, { accountingObserver: observer }))],
      ['/document/pages/0/components/0/props/value/value', observer => refusal(() => compileCompositionDocumentWithOrigins(input, { accountingObserver: observer }))],
      ['/document/dataSources/0/inputs/steps/0/fields/value', observer => refusal(() => compileCompositionDocument(pipeline, { accountingObserver: observer }))],
      ['/document/dataSources/0/inputs/steps/0/fields/value', observer => refusal(() => compileCompositionDocumentWithOrigins(pipeline, { accountingObserver: observer }))],
      ['/sources/0/inputs/steps/0/fields/value', observer => checkCompositionPipelineBundle([source], '/sources', observer)],
    ];
    for (const [pointer, invoke] of entries) {
      const direct = recording(), observed = recording();
      expression.checkOperand(value, pointer, true, false, 'lenient', direct.observer);
      expect(direct.events).toHaveLength(count);
      const spy = vi.spyOn(expression, 'checkOperand'), plain = invoke();
      expect(spy).not.toHaveBeenCalled();
      expect(invoke(observed.observer)).toStrictEqual(plain);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(observed.events).toStrictEqual(direct.events);
      spy.mockRestore();
    }
  });

  it.each([false, true])('retains shared-call ownership and already-charged nodes (spent=%s)', spent => {
    const action: CallService = {
      type: 'call-service', domain: 'light', service: 'turn_on',
      data: { type: 'object', fields: { payload: spent ? { type: 'list', items: Array.from({ length: 60 }, () => literal()) } : rule(literal()) } },
      target: { entity_id: spent ? rule(literal('light.demo')) : literal('light.demo') },
      confirmation: { type: 'additional', style: 'alert', title: 'Confirm', confirmLabel: 'Run', cancelLabel: 'Cancel', destructive: false, when: { type: 'viewer', isAdmin: true } },
    };
    const input = document({ id: 'run', title: 'Run', type: 'primary-button', layout: { span: 1 }, props: {}, action });
    const direct = recording();
    expression.checkCallService(action, '/document/pages/0/components/0/action', true, 'lenient', 'any', direct.observer);
    expect(direct.events).toHaveLength(spent ? 156 : 96);
    for (const compile of [compileCompositionDocument, compileCompositionDocumentWithOrigins]) {
      const spy = vi.spyOn(expression, 'checkCallService'), observed = recording(), plain = refusal(() => compile(input));
      expect(spy).not.toHaveBeenCalled();
      expect(refusal(() => compile(input, { accountingObserver: observed.observer }))).toStrictEqual(plain);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(observed.events).toStrictEqual(direct.events);
      expect(observed.events).toContainEqual(expect.objectContaining({ type: 'scope', nodeLimit: 128, pointer: '/document/pages/0/components/0/action' }));
      spy.mockRestore();
    }
  });

  it('keeps the predicate root and its uncapped initial condition scope for a nested refusal', () => {
    const value: Predicate = { type: 'exists', value: format(rule(literal())) }, direct = recording(), observed = recording();
    expression.checkPredicate(value, '/document/pages/0/components/0/visibleWhen', false, 'lenient', direct.observer);
    const input = document(text(undefined, value)), plain = refusal(() => compileCompositionDocument(input));
    const spy = vi.spyOn(expression, 'checkPredicate');
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: observed.observer }))).toStrictEqual(plain);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(observed.events).toStrictEqual(direct.events);
  });

  it.each([
    ['literal', literal(0), 90],
    ['format', { type: 'format', pattern: '{value}', args: { value: literal(0) } }, 91],
  ] satisfies [string, Operand, number][])('matches direct events with a %s fallback at expression/document/bundle boundaries', (_name, otherwise, count) => {
    const value = rule(otherwise), source = flow();
    source.inputs.parameters = [{ name: 'value', type: 'number', value }];
    const inputs = [
      { input: document(text(value)), pointer: '/document/pages/0/components/0/props/value/value' },
      { input: { ...document(), dataSources: [source] }, pointer: '/document/dataSources/0/inputs/parameters/0/value' },
    ];
    for (const { input, pointer } of inputs) {
      const direct = recording(), observed = recording();
      expression.checkOperand(value, pointer, true, false, 'lenient', direct.observer);
      const spy = vi.spyOn(expression, 'checkOperand');
      const plain = refusal(() => compileCompositionDocument(input));
      expect(spy).not.toHaveBeenCalled();
      expect(refusal(() => compileCompositionDocument(input, { accountingObserver: observed.observer }))).toStrictEqual(plain);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(observed.events).toStrictEqual(direct.events);
      expect(observed.events).toHaveLength(count);
      spy.mockRestore();
    }
    const pointer = '/sources/0/inputs/parameters/0/value', direct = recording(), observed = recording();
    expression.checkOperand(value, pointer, true, false, 'lenient', direct.observer);
    const spy = vi.spyOn(expression, 'checkOperand'), plain = checkCompositionPipelineBundle([source], '/sources');
    expect(spy).not.toHaveBeenCalled();
    expect(checkCompositionPipelineBundle([source], '/sources', observed.observer)).toStrictEqual(plain);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(observed.events).toStrictEqual(direct.events);
    expect(observed.events).toHaveLength(count);
  });

  it('discards an untraversable malformed rule trace and emits only the partial enforcing guard', () => {
    const value = rule(literal()), malformed = {
      ...value, cases: Array.from({ length: 17 }, () => ({ when: { type: 'viewer', isAdmin: true } })),
    };
    const input = document(text());
    const node = input.pages[0].components[0];
    if (node.type !== 'text') throw new Error('Expected text fixture');
    Reflect.set(node.props, 'value', { type: 'expr', value: malformed });
    const observed = recording(), plain = refusal(() => compileCompositionDocument(input)), spy = vi.spyOn(expression, 'checkOperand');
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: observed.observer }))).toStrictEqual(plain);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(observed.events).toEqual([{
      type: 'schema-limit', pointer: '/document/pages/0/components/0/props/value/value/cases',
      count: 17, limit: 16, direction: 'maximum', partial: true,
    }]);
    for (const error of [new Error('observer'), new TypeError('observer'), new CompositionValidationError([])]) {
      expect(thrown(() => compileCompositionDocument(input, { accountingObserver: () => { throw error; } }))).toBe(error);
    }
  });

  it('deduplicates multiple structural limits on the same refused call', () => {
    const action = call();
    action.optimistic = Array.from({ length: 17 }, () => ({ sourceId: 'source', value: 'on', revertAfterSeconds: 1, failsOnTimeout: false }));
    action.confirmation = { type: 'additional', style: 'alert', title: 'x'.repeat(241), confirmLabel: 'Run', cancelLabel: 'Cancel', destructive: false };
    const input = document({ id: 'run', title: 'Run', type: 'primary-button', layout: { span: 1 }, props: {}, action });
    const direct = recording(), observed = recording();
    expression.checkCallService(action, '/document/pages/0/components/0/action', true, 'lenient', 'any', direct.observer);
    const spy = vi.spyOn(expression, 'checkCallService'), plain = refusal(() => compileCompositionDocument(input));
    expect(spy).not.toHaveBeenCalled();
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: observed.observer }))).toStrictEqual(plain);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(observed.events).toStrictEqual(direct.events);
  });

  it('tries a malformed refused node once while retaining each partial guard snapshot', () => {
    const action = call(), observed = recording();
    action.optimistic = Array.from({ length: 17 }, () => ({ sourceId: 'source', value: 'on', revertAfterSeconds: 1, failsOnTimeout: false }));
    if (!action.data || action.confirmation?.type !== 'additional') throw new Error('Expected call fixture');
    Reflect.set(action.data, 'fields', null);
    action.confirmation.title = 'x'.repeat(241);
    const input = document({ id: 'run', title: 'Run', type: 'primary-button', layout: { span: 1 }, props: {}, action });
    const spy = vi.spyOn(expression, 'checkCallService'), plain = refusal(() => compileCompositionDocument(input));
    expect(spy).not.toHaveBeenCalled();
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: observed.observer }))).toStrictEqual(plain);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(observed.events).toEqual([
      { type: 'schema-limit', pointer: '/document/pages/0/components/0/action/optimistic', count: 17, limit: 16, direction: 'maximum', partial: true },
      { type: 'schema-limit', pointer: '/document/pages/0/components/0/action/confirmation/title', count: 241, limit: 240, direction: 'maximum', partial: true },
    ]);
  });

  it('restores outer observation across nested observed and unobserved checks', () => {
    const direct = recording(), outer = recording(), inner = recording(), value = choose();
    expression.checkOperand(value, '/outer', false, false, undefined, direct.observer);
    let nested = false;
    expression.checkOperand(value, '/outer', false, false, undefined, event => {
      outer.observer(event);
      if (!nested) {
        nested = true;
        expression.checkOperand(literal(), '/unobserved');
        expression.checkPredicate(compare(), '/inner', false, undefined, inner.observer);
      }
    });
    const innerDirect = recording();
    expression.checkPredicate(compare(), '/inner', false, undefined, innerDirect.observer);
    expect(outer.events).toStrictEqual(direct.events);
    expect(inner.events).toStrictEqual(innerDirect.events);
  });
});

describe('expression limit guard sweep', () => {
  const read = (path: string[] = ['state']): Operand => ({ type: 'read', from: { type: 'source', sourceId: 'source', path }, as: 'string', missing: 'unavailable' });
  const fields = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`value${index}`, literal()]));
  const count = (length: number): Operand => ({ type: 'count', of: Array.from({ length }, () => ({ test: { type: 'viewer', isAdmin: true } })) });
  const format = (maximumFractionDigits: number, minimumFractionDigits?: number): Operand => ({
    type: 'format', pattern: '{value}', args: { value: literal() }, formats: { value: { number: { maximumFractionDigits, ...(minimumFractionDigits === undefined ? {} : { minimumFractionDigits }) } } },
  });
  const operandCases: [string, Operand][] = [
    ['source path minimum', read([])], ['source path maximum', read(Array(9).fill('state'))],
    ['source segment length', read(['x'.repeat(161)])], ['source UTF-8 byte limit', read(['\u00e9'.repeat(81)])],
    ['source identifier minimum', { type: 'raw-state', sourceId: '' }],
    ['source identifier size', { type: 'raw-state', sourceId: 'a'.repeat(81) }],
    ['format pattern length', { type: 'format', pattern: 'x'.repeat(2001), args: {} }],
    ['format nonblank pattern', { type: 'format', pattern: '', args: {} }],
    ['format maximum precision minimum', format(-1)], ['format maximum precision maximum', format(7)],
    ['format minimum precision minimum', format(6, -1)], ['format minimum precision maximum', format(6, 7)],
    ['format arguments', { type: 'format', pattern: 'Text', args: fields(17) }],
    ['format argument name', { type: 'format', pattern: 'Text', args: { ['a'.repeat(33)]: literal() } }],
    ['format argument name minimum', { type: 'format', pattern: 'Text', args: { '': literal() } }],
    ['count minimum', count(0)], ['count maximum', count(33)],
    ...[0, 33].map((length): [string, Operand] => [`count viewer cardinality ${length}`, {
      type: 'count', of: [{ test: { type: 'viewer', isAdmin: true }, viewer: { personEntityIds: Array(length).fill('person.example') } }],
    }]),
    ...[0, 256].map((length): [string, Operand] => [`count viewer identifier length ${length}`, {
      type: 'count', of: [{ test: { type: 'viewer', isAdmin: true }, viewer: { personEntityIds: ['p'.repeat(length)] } }],
    }]),
    ...[0, 33].map((length): [string, Operand] => [`map cases ${length}`, {
      type: 'map', of: literal(), otherwise: literal(), cases: Array.from({ length }, () => ({ equals: 1, then: literal() })),
    }]),
    ['math structural argument maximum', { type: 'math', op: 'add', args: Array.from({ length: 9 }, () => literal()) }],
    ['object fields', { type: 'object', fields: fields(65) }],
    ['object field name', { type: 'object', fields: { ['a'.repeat(65)]: literal() } }],
    ['object field name minimum', { type: 'object', fields: { '': literal() } }],
    ['list items', { type: 'list', items: Array.from({ length: 65 }, () => literal()) }],
    ['item path', { type: 'item', path: Array(9).fill('field') }],
    ['item path segment length', { type: 'item', path: ['x'.repeat(65)] }],
    ['parameter name maximum', { type: 'param', name: 'n'.repeat(33) }],
    ['parameter name minimum', { type: 'param', name: '' }],
    ['empty rules', { type: 'choose', cases: [], otherwise: literal() }],
    ['literal string', { type: 'literal', value: 'x'.repeat(2001) }],
    ['literal array size', { type: 'literal', value: Array(65).fill(1) }],
    ['literal object size', { type: 'literal', value: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`k${index}`, 1])) }],
    ['literal depth', { type: 'literal', value: [[[[[1]]]]] }],
    ['expression depth', Array.from({ length: 8 }).reduce<Operand>(value => ({ type: 'format', pattern: '{value}', args: { value } }), literal())],
    ['condition depth', { type: 'choose', cases: [{ when: Array.from({ length: 6 }).reduce<Predicate>(of => ({ type: 'not', of }), { type: 'viewer', isAdmin: true }), then: literal() }], otherwise: literal() }],
    ['condition nodes', { type: 'choose', cases: [{ when: { type: 'all', of: [allOf(), allOf()] }, then: literal() }], otherwise: literal() }],
    ...expression.mathOperations.flatMap((op): [string, Operand][] => {
      const [low, high] = expression.mathArity[op];
      return [[`${op} lower arity`, { type: 'math', op, args: Array.from({ length: low - 1 }, () => literal()) }],
        [`${op} upper arity`, { type: 'math', op, args: Array.from({ length: high + 1 }, () => literal()) }]];
    }),
  ];
  it.each(operandCases)('reports direct operand counts for %s without changing refusal diagnostics', (_name, value) => {
    const direct = recording(), observed = recording(), input = document(text(value));
    expression.checkOperand(value, '/document/pages/0/components/0/props/value/value', true, false, 'lenient', direct.observer);
    const plain = refusal(() => compileCompositionDocument(input));
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: observed.observer }))).toStrictEqual(plain);
    expect(observed.events).toStrictEqual(direct.events);
    expect(observed.events.length).toBeGreaterThan(0);
  });
  const predicateCases: [string, Predicate][] = [
    ...[0, 33].flatMap((length): [string, Predicate][] => [
      [`state options ${length}`, { type: 'state', sourceId: 'source', path: ['state'], in: Array(length).fill('on') }],
      [`viewer ids ${length}`, { type: 'viewer', userIds: Array(length).fill('user') }],
      [`viewer-person ids ${length}`, { type: 'viewer-person', in: Array(length).fill('person.example') }],
    ]),
    ['state option length', { type: 'state', sourceId: 'source', path: ['state'], in: ['x'.repeat(161)] }],
    ['viewer id length', { type: 'viewer', userIds: ['x'.repeat(161)] }],
    ['viewer-person id length', { type: 'viewer-person', in: ['x'.repeat(161)] }],
    ['state option minimum', { type: 'state', sourceId: 'source', path: ['state'], in: [''] }],
    ['viewer id minimum', { type: 'viewer', userIds: [''] }],
    ['viewer-person id minimum', { type: 'viewer-person', in: [''] }],
    ...[0, 17].flatMap((length): [string, Predicate][] => [
      ['all children ' + length, { type: 'all', of: Array.from({ length }, () => compare()) }],
      ['any children ' + length, { type: 'any', of: Array.from({ length }, () => compare()) }],
      ['membership options ' + length, { type: 'in', value: literal(), in: Array.from({ length }, () => literal()) }],
    ]),
    ['predicate node budget', { type: 'all', of: Array.from({ length: 4 }, () => ({ type: 'all', of: Array.from({ length: 16 }, () => ({ type: 'viewer', isAdmin: true })) })) }],
    ['predicate depth', Array.from({ length: 8 }).reduce<Predicate>(of => ({ type: 'not', of }), { type: 'viewer', isAdmin: true })],
    ['numeric early return', { type: 'numeric', sourceId: 'source', path: ['state'] }],
  ];
  it.each(predicateCases)('reports direct predicate counts for %s without changing refusal diagnostics', (_name, value) => {
    const direct = recording(), observed = recording(), input = document(text(undefined, value));
    expression.checkPredicate(value, '/document/pages/0/components/0/visibleWhen', false, 'lenient', direct.observer);
    const plain = refusal(() => compileCompositionDocument(input));
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: observed.observer }))).toStrictEqual(plain);
    expect(observed.events).toStrictEqual(direct.events);
  });
});

describe('call and pipeline limit guard sweep', () => {
  const confirmation = (value: CallService) => {
    if (value.confirmation?.type !== 'additional') throw new Error('Expected additional confirmation');
    return value.confirmation;
  };
  const callLimits: [string, (value: CallService) => void][] = [
    ...(['domain', 'service'] as const).flatMap((key): [string, (value: CallService) => void][] =>
      [0, 65].map(length => [`${key} length ${length}`, value => { value[key] = 'a'.repeat(length); }])),
    ...(['title', 'confirmLabel'] as const).flatMap((key): [string, (value: CallService) => void][] =>
      [0, 241].map(length => [`confirmation ${key} length ${length}`, value => { confirmation(value)[key] = 'x'.repeat(length); }])),
    ['confirmation message', value => { confirmation(value).message = 'x'.repeat(2001); }],
    ...[0, 33].map((length): [string, (value: CallService) => void] =>
      [`exempt user cardinality ${length}`, value => { confirmation(value).exemptUserIds = Array(length).fill('user'); }]),
    ['exempt user length', value => { confirmation(value).exemptUserIds = ['x'.repeat(161)]; }],
    ['exempt user minimum', value => { confirmation(value).exemptUserIds = ['']; }],
    ['optimistic count', value => { value.optimistic = Array.from({ length: 17 }, () => ({ sourceId: 'source', value: 'on', revertAfterSeconds: 1, failsOnTimeout: false })); }],
    ...[0, 161].map((length): [string, (value: CallService) => void] =>
      [`optimistic text ${length}`, value => { value.optimistic = [{ sourceId: 'source', value: 'x'.repeat(length), revertAfterSeconds: 1, failsOnTimeout: false }]; }]),
    ...[0, 61].map((seconds): [string, (value: CallService) => void] =>
      [`optimistic timeout ${seconds}`, value => { value.optimistic = [{ sourceId: 'source', value: 'on', revertAfterSeconds: seconds, failsOnTimeout: false }]; }]),
    ['shared-call budget', value => { value.target = call(60).target; }],
  ];
  it.each(callLimits)('preserves direct call accounting for %s', (_name, update) => {
    const action = call(), direct = recording(), observed = recording();
    update(action);
    expression.checkCallService(action, '/document/pages/0/components/0/action', true, 'lenient', 'any', direct.observer);
    const input = document({ id: 'run', title: 'Run', type: 'primary-button', layout: { span: 1 }, props: {}, action });
    const plain = refusal(() => compileCompositionDocument(input));
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: observed.observer }))).toStrictEqual(plain);
    expect(observed.events).toStrictEqual(direct.events);
  });

  const entity = () => ({ type: 'literal' as const, value: 'sensor.example' });
  const pipelineLimits: [string, string, (source: PipelineSource) => void][] = [
    ...[0, 81].flatMap((length): [string, string, (source: PipelineSource) => void][] => [
      [`source id length ${length}`, '/id', source => { source.id = 'a'.repeat(length); }],
      [`step id length ${length}`, '/inputs/steps/0/id', source => { source.inputs.steps[0].id = 'a'.repeat(length); }],
    ]),
    ...[0, 241].map((length): [string, string, (source: PipelineSource) => void] =>
      [`title length ${length}`, '/inputs/title', source => { source.inputs.title = 'x'.repeat(length); }]),
    ['parameters', '/inputs/parameters', source => { source.inputs.parameters = Array.from({ length: 9 }, (_, index) => ({ name: `p${index}`, type: 'number', value: literal() })); }],
    ...[0, 33].map((length): [string, string, (source: PipelineSource) => void] =>
      [`parameter name length ${length}`, '/inputs/parameters/0/name', source => { source.inputs.parameters[0].name = 'a'.repeat(length); }]),
    ['steps', '/inputs/steps', source => { source.inputs.steps = Array.from({ length: 33 }, (_, index) => ({ id: `step${index}`, op: 'limit', count: 1 })); }],
    ...[0, 5].map((length): [string, string, (source: PipelineSource) => void] =>
      [`sort keys ${length}`, '/inputs/steps/0/by', source => { source.inputs.steps = [{ id: 'sort', op: 'sort', by: Array.from({ length }, () => ({ value: literal(), kind: 'number', direction: 'ascending' })) }]; }]),
    ...[0, 1001].map((count): [string, string, (source: PipelineSource) => void] =>
      [`limit count ${count}`, '/inputs/steps/0/count', source => { source.inputs.steps = [{ id: 'limit', op: 'limit', count }]; }]),
    ...[0, 9].map((length): [string, string, (source: PipelineSource) => void] =>
      [`get path ${length}`, '/inputs/steps/0/path', source => { source.inputs.steps = [{ id: 'get', op: 'get', path: Array(length).fill('field') }]; }]),
    ['flatten path', '/inputs/steps/0/path', source => { source.inputs.steps = [{ id: 'flatten', op: 'flatten', path: Array(9).fill('field') }]; }],
    ['default path', '/inputs/steps/0/path', source => { source.inputs.steps = [{ id: 'default', op: 'default', path: [], value: literal() }]; }],
    ['path segment', '/inputs/steps/0/path/0', source => { source.inputs.steps = [{ id: 'get', op: 'get', path: ['x'.repeat(65)] }]; }],
    ['written field name', '/inputs/steps/0/into', source => { source.inputs.steps = [{ id: 'scan', op: 'running-sum', value: literal(), into: 'x'.repeat(161), nullPropagates: false }]; }],
    ...[0, 33].flatMap((length): [string, string, (source: PipelineSource) => void][] => [
      [`map fields ${length}`, '/inputs/steps/0/fields', source => { source.inputs.steps = [{ id: 'map', op: 'map', fields: Object.fromEntries(Array.from({ length }, (_, index) => [`f${index}`, literal()])) }]; }],
      [`annotate fields ${length}`, '/inputs/steps/0/fields', source => {
        source.inputs.request = { type: 'entity-attribute', entityId: entity(), path: ['values'], responseShape: { kind: 'array', of: { kind: 'object', fields: {} } } };
        source.inputs.steps = [{ id: 'annotate', op: 'annotate', fields: Object.fromEntries(Array.from({ length }, (_, index) => [`f${index}`, { aggregate: 'min', value: literal() }])) }];
      }],
    ]),
    ...[1, 31].map((timeoutSeconds): [string, string, (source: PipelineSource) => void] =>
      [`service timeout ${timeoutSeconds}`, '/inputs/request/timeoutSeconds', source => { source.inputs.request = { type: 'service-response', domain: 'script', service: 'example', timeoutSeconds: timeoutSeconds === 1 ? 0 : timeoutSeconds, responseShape: { kind: 'number' } }; }]),
    ...(['domain', 'service'] as const).flatMap((key): [string, string, (source: PipelineSource) => void][] =>
      [0, 65].map(length => [`service ${key} ${length}`, `/inputs/request/${key}`, source => { source.inputs.request = { type: 'service-response', domain: 'script', service: 'example', [key]: 'a'.repeat(length), timeoutSeconds: 1, responseShape: { kind: 'number' } }; }])),
    ['literal entity length', '/inputs/request/entityId/value', source => { source.inputs.request = { type: 'entity-attribute', entityId: { type: 'literal', value: 'x'.repeat(161) }, path: ['state'], responseShape: { kind: 'number' } }; }],
    ['literal entity minimum', '/inputs/request/entityId/value', source => { source.inputs.request = { type: 'entity-attribute', entityId: { type: 'literal', value: '' }, path: ['state'], responseShape: { kind: 'number' } }; }],
    ['request path', '/inputs/request/path', source => { source.inputs.request = { type: 'entity-attribute', entityId: entity(), path: Array(9).fill('state'), responseShape: { kind: 'number' } }; }],
    ...[0, 65].map((length): [string, string, (source: PipelineSource) => void] =>
      [`entity request cardinality ${length}`, '/inputs/request/entityIds', source => { source.inputs.request = { type: 'entities', entityIds: Array.from({ length }, entity), attributes: [] }; }]),
    ['attribute count', '/inputs/request/attributes', source => { source.inputs.request = { type: 'entities', entityIds: [entity()], attributes: Array(9).fill('value') }; }],
    ...[0, 65].map((length): [string, string, (source: PipelineSource) => void] =>
      [`attribute length ${length}`, '/inputs/request/attributes/0', source => { source.inputs.request = { type: 'entities', entityIds: [entity()], attributes: ['a'.repeat(length)] }; }]),
    ...[0, 101].flatMap((max): [string, string, (source: PipelineSource) => void][] => [
      [`row maximum ${max}`, '/inputs/output/max', source => { source.inputs.output = { kind: 'rows', max, row: { id: literal('id'), title: literal('title') } }; }],
      [`record maximum ${max}`, '/inputs/output/max', source => { source.inputs.output = { kind: 'records', max }; }],
    ]),
    ...[0, 4].map((length): [string, string, (source: PipelineSource) => void] =>
      [`refresh trigger count ${length}`, '/inputs/refresh/on', source => { source.inputs.refresh = { on: Array(length).fill('open'), staleAfterSeconds: 30 }; }]),
    ...[0, 9].map((length): [string, string, (source: PipelineSource) => void] =>
      [`refresh entity count ${length}`, '/inputs/refresh/entityIds', source => { source.inputs.refresh = { on: ['entity-change'], entityIds: Array.from({ length }, entity), staleAfterSeconds: 30 }; }]),
    ...[29, 86_401].map((staleAfterSeconds): [string, string, (source: PipelineSource) => void] =>
      [`stale seconds ${staleAfterSeconds}`, '/inputs/refresh/staleAfterSeconds', source => { source.inputs.refresh = { on: ['open'], staleAfterSeconds }; }]),
    ['flow operand nodes', '/inputs/steps/1/fields/value/items/63', source => { source.inputs.steps[1] = { id: 'map', op: 'map', fields: { value: { type: 'list', items: Array.from({ length: 64 }, () => literal()) } } }; }],
    ['flow operand depth', '/inputs/steps/1/fields/value' + '/args/value'.repeat(8), source => { source.inputs.steps[1] = { id: 'map', op: 'map', fields: { value: Array.from({ length: 8 }).reduce<Operand>(value => ({ type: 'format', pattern: '{value}', args: { value } }), literal()) } }; }],
    ['flow condition nodes', '/inputs/steps/0/where/of/1/of/13', source => { source.inputs.steps[0] = { id: 'filter', op: 'filter', where: { type: 'all', of: [allOf(), allOf()] } }; }],
    ['flow condition depth', '/inputs/steps/0/where' + '/of'.repeat(6), source => { source.inputs.steps[0] = { id: 'filter', op: 'filter', where: Array.from({ length: 6 }).reduce<Predicate>(of => ({ type: 'not', of }), compare()) }; }],
    ['flow object fields', '/inputs/steps/1/fields/value/fields', source => { source.inputs.steps[1] = { id: 'map', op: 'map', fields: { value: { type: 'object', fields: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`f${index}`, literal()])) } } }; }],
  ];
  it.each(pipelineLimits)('accounts for %s in documents and bundles with unchanged diagnostic ordering', (_name, path, update) => {
    const source = flow();
    update(source);
    const observed = recording(), input = { ...document(), dataSources: [source] }, plain = refusal(() => compileCompositionDocument(input));
    expect(plain.some(issue => issue.pointer === `/document/dataSources/0${path}`)).toBe(true);
    expect(refusal(() => compileCompositionDocument(input, { accountingObserver: observed.observer }))).toStrictEqual(plain);
    expect(observed.events.length).toBeGreaterThan(0);
    const bundle = recording();
    expect(checkCompositionPipelineBundle([source], '/sources', bundle.observer)).toStrictEqual(checkCompositionPipelineBundle([source], '/sources'));
    expect(bundle.events.length).toBeGreaterThan(0);
    expect(observed.events.map(event => ({ ...event, pointer: event.pointer.replace('/document/dataSources', '/sources'),
      ...('scopeId' in event ? { scopeId: event.scopeId.replace('/document/dataSources', '/sources') } : {}),
      ...('previousScopeId' in event ? { previousScopeId: event.previousScopeId.replace('/document/dataSources', '/sources') } : {}),
    }))).toStrictEqual(bundle.events);
  });
  it('counts Unicode schema limits in code points and keeps direct pipeline-count refusals observable', () => {
    const source = flow(), observed = recording();
    source.inputs.title = '\u{1f600}'.repeat(241);
    refusal(() => compileCompositionDocument({ ...document(), dataSources: [source] }, { accountingObserver: observed.observer }));
    expect(observed.events).toEqual([{ type: 'schema-limit', pointer: '/document/dataSources/0/inputs/title', count: 241, limit: 240, direction: 'maximum', partial: true }]);
    const direct = recording(), value = flow();
    expect(checkCompositionPipelineSource(value, '/flow', 129, direct.observer)).toStrictEqual(checkCompositionPipelineSource(value, '/flow', 129));
    expect(direct.events.length).toBeGreaterThan(0);
  });
});

describe('inherited pipeline shape limits', () => {
  const shapeLimits: [string, Shape, string, { count: number; limit: number; direction: 'minimum' | 'maximum' }?][] = [
    ...[0, 161].map((length): [string, Shape, string, { count: number; limit: number; direction: 'minimum' | 'maximum' }] =>
      [`field name ${length}`, { kind: 'object', fields: { ['a'.repeat(length)]: { shape: { kind: 'number' } } } }, `/fields/${'a'.repeat(length)}`,
        { count: length, limit: length ? 160 : 1, direction: length ? 'maximum' : 'minimum' }]),
    ...[0, 9].map((length): [string, Shape, string, { count: number; limit: number; direction: 'minimum' | 'maximum' }] =>
      [`enum size ${length}`, { kind: 'string', enum: Array(length).fill('value') }, '/enum',
        { count: length, limit: length ? 8 : 1, direction: length ? 'maximum' : 'minimum' }]),
    ['enum value length', { kind: 'string', enum: ['a'.repeat(65)] }, '/enum/0', { count: 65, limit: 64, direction: 'maximum' }],
    ...[1, 7].map((length): [string, Shape, string, { count: number; limit: number; direction: 'minimum' | 'maximum' }] =>
      [`union members ${length}`, { kind: 'union', of: Array.from({ length }, () => ({ kind: 'number' })) }, '/of',
        { count: length, limit: length === 1 ? 2 : 6, direction: length === 1 ? 'minimum' : 'maximum' }]),
    ['object field cardinality', { kind: 'object', fields: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`f${index}`, { shape: { kind: 'number' } }])) }, '/fields'],
    ['shape depth', Array.from({ length: 6 }).reduce<Shape>(of => ({ kind: 'array', of }), { kind: 'number' }), '/of'.repeat(6)],
  ];
  it.each(shapeLimits.flatMap(([name, shape, suffix, snapshot]) => (['request', 'output'] as const).map(location => ({ location, name, shape, suffix, snapshot }))))('$location $name preserves all entry-point diagnostics and emits accounting', ({ location, name, shape, suffix, snapshot }) => {
    const source = flow();
    source.inputs.parameters = [];
    source.inputs.steps = [];
    const at = location === 'request' ? '/inputs/request/responseShape' : '/inputs/schema';
    if (location === 'request') source.inputs.request = { type: 'entity-attribute', entityId: { type: 'literal', value: 'sensor.example' }, path: ['values'], responseShape: shape };
    else source.inputs.schema = shape;
    const input = { ...document(), dataSources: [source] };
    const entries: [string, (observer?: BudgetAccountingObserver) => unknown][] = [
      ['/document/dataSources/0', observer => refusal(() => compileCompositionDocument(input, { accountingObserver: observer }))],
      ['/document/dataSources/0', observer => refusal(() => compileCompositionDocumentWithOrigins(input, { accountingObserver: observer }))],
      ['/sources/0', observer => checkCompositionPipelineBundle([source], '/sources', observer)],
    ];
    for (const [prefix, invoke] of entries) {
      const observed = recording(), plain = invoke();
      expect(invoke(observed.observer)).toStrictEqual(plain);
      if (snapshot) expect(observed.events).toEqual([{ type: 'schema-limit', pointer: `${prefix}${at}${suffix}`, ...snapshot, partial: true }]);
      else expect(observed.events.length).toBeGreaterThan(0);
      const issues = Array.isArray(plain) ? plain : checkCompositionPipelineBundle([source], '/sources').issues;
      expect(issues).toContainEqual(expect.objectContaining({ pointer: `${prefix}${at}${suffix}`, ...(name.startsWith('field name') ? { code: 'invalid_value' } : {}) }));
    }
  });
});

describe('observer exceptions are not document diagnostics', () => {
  it.each(['Error', 'CompositionValidationError'] as const)('propagates the identical %s from every native entry point and from early schema refusal', kind => {
    const source = flow(), valid = document(text(choose()));
    source.inputs.parameters = [];
    source.inputs.steps = [];
    const pipeline = document();
    pipeline.dataSources = [source];
    const bad = document({ id: 'run', title: 'Run', type: 'primary-button', layout: { span: 1 }, props: {}, action: call(60) });
    const entries: ((observer: BudgetAccountingObserver) => unknown)[] = [
      observer => expression.checkOperand(choose(), '/value', false, false, undefined, observer),
      observer => expression.checkPredicate(compare(), '/condition', false, undefined, observer),
      observer => expression.checkCallService(call(), '/action', false, undefined, undefined, observer),
      observer => checkPipelineSource(source, '/source', observer),
      observer => checkCompositionPipelineSource(source, '/source', 1, observer),
      observer => checkCompositionPipelineBundle([source], '/sources', observer),
      observer => compileCompositionDocument(valid, { accountingObserver: observer }),
      observer => compileCompositionDocumentWithOrigins(valid, { accountingObserver: observer }),
      observer => compileCompositionDocument({ ...valid, logicLibrary: [] }, { accountingObserver: observer }),
      observer => compileCompositionDocumentWithOrigins({ ...pipeline, logicLibrary: [] }, { accountingObserver: observer }),
      observer => compileCompositionDocument(bad, { accountingObserver: observer }),
      observer => compileCompositionDocumentWithOrigins({ ...bad, logicLibrary: [] }, { accountingObserver: observer }),
    ];
    for (const compile of entries) {
      const error = kind === 'Error' ? new Error('Observer failed') : new CompositionValidationError([{ code: 'invalid_value', pointer: '/observer' }]);
      expect(thrown(() => compile(() => { throw error; }))).toBe(error);
    }
    const spy = vi.spyOn(expression, 'checkOperand');
    compileCompositionDocument(valid);
    expect(spy.mock.calls.every(args => args[5] === undefined)).toBe(true);
  });
});

describe('pipeline accounting observer forwarding', () => {
  it('preserves real flow-budget refusals while exposing the direct failing checker events', () => {
    const source = flow(), first = source.inputs.steps[0];
    if (first.op !== 'filter') throw new Error('Expected the flow fixture to begin with a filter');
    first.where = { type: 'all', of: [allOf(), allOf()] };
    const input = document(), direct = recording(), compiled = recording();
    input.dataSources = [source];
    const facts = checkPipelineSource(source, '/document/dataSources/0', direct.observer);
    expect(facts.issues.length).toBeGreaterThan(0);
    let plainError: CompositionValidationError | undefined;
    try { compileCompositionDocument(input); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      plainError = error;
    }
    expect(plainError).toBeInstanceOf(CompositionValidationError);
    expect(() => compileCompositionDocument(input, { accountingObserver: compiled.observer })).toThrow(plainError);
    expect(compiled.events).toStrictEqual(direct.events);
    expect(compiled.events).toContainEqual(expect.objectContaining({ type: 'node', charged: false, remaining: 0 }));
  });

  it('forwards document/source/bundle compilation into the same flow typing pass, including step slots and filter scopes', () => {
    const source = flow(), input = document(), direct = recording(), compiled = recording(), at = '/document/dataSources/0';
    input.dataSources = [source];
    const facts = checkPipelineSource(source, at, direct.observer);
    expect(facts.issues).toEqual([]);
    expect(compileCompositionDocument(input, { accountingObserver: compiled.observer })).toStrictEqual(compileCompositionDocument(input));
    expect(compiled.events).toStrictEqual(direct.events);

    const sourceEvents = recording();
    expect(checkCompositionPipelineSource(source, at, 1, sourceEvents.observer)).toStrictEqual(checkCompositionPipelineSource(source, at));
    expect(sourceEvents.events).toStrictEqual(direct.events);
    const bundleEvents = recording();
    expect(checkCompositionPipelineBundle([source], '/document/dataSources', bundleEvents.observer)).toStrictEqual(checkCompositionPipelineBundle([source], '/document/dataSources'));
    expect(bundleEvents.events).toStrictEqual(direct.events);

    const steps = recording(), stepFacts = newFacts();
    typeSteps(source.inputs.steps, { kind: 'array', of: { kind: 'number' } }, new Map([['factor', 'number']]), `${at}/inputs`, stepFacts, steps.observer);
    const nativeStepEvents = compiled.events.filter(event => event.type === 'steps' || event.pointer.startsWith(`${at}/inputs/steps/`));
    expect(nativeStepEvents).toStrictEqual(steps.events);
    expect(nativeStepEvents).toContainEqual({ type: 'steps', scopeId: `steps:${at}/inputs`, pointer: `${at}/inputs/steps`, count: 3, limit: 32 });
    expect(nativeStepEvents).toContainEqual(expect.objectContaining({ type: 'scope', kind: 'flow-condition', nodeLimit: 32, depthLimit: 6 }));
    expect(nativeStepEvents).toContainEqual(expect.objectContaining({ type: 'node', nodes: 17, remaining: 15 }));
    expect(nativeStepEvents.filter(event => event.type === 'scope' && event.kind === 'flow-operand')).toHaveLength(34);
  });

  it('observes request targets/data and row operands, and preserves the existing repeated none-request visit', () => {
    const source = flow();
    source.inputs.parameters = [];
    source.inputs.request = {
      type: 'service-response', domain: 'script', service: 'demo_rows', timeoutSeconds: 1,
      target: { entity_id: literal('sensor.demo_values') },
      data: { type: 'object', fields: { count: literal(1) } },
      responseShape: { kind: 'array', of: { kind: 'number' } },
    };
    source.inputs.steps = [];
    source.inputs.output = { kind: 'rows', max: 10, row: { id: literal('item'), title: literal('Title'), subtitle: literal('Detail'), value: { type: 'item', path: [] } } };
    source.inputs.schema = { kind: 'array', of: { kind: 'number' } };
    const { events, observer } = recording();
    expect(checkPipelineSource(source, '/flow', observer)).toStrictEqual(checkPipelineSource(source, '/flow'));
    for (const pointer of ['/flow/inputs/request/target/entity_id', '/flow/inputs/request/data', ...['id', 'title', 'subtitle', 'value'].map(key => `/flow/inputs/output/row/${key}`)]) {
      expect(events).toContainEqual(expect.objectContaining({ type: 'scope', kind: 'flow-operand', pointer }));
    }
    source.inputs.request = { type: 'none', value: literal('Text') };
    source.inputs.output = { kind: 'scalar' };
    source.inputs.schema = { kind: 'string' };
    delete source.inputs.refresh;
    const none = recording();
    expect(checkPipelineSource(source, '/flow', none.observer)).toStrictEqual(checkPipelineSource(source, '/flow'));
    expect(none.events.filter(event => event.type === 'scope' && event.pointer === '/flow/inputs/request/value')).toHaveLength(2);
  });
});
