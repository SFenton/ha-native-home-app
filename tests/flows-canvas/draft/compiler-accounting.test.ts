import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkCompositionPipelineBundle, checkCompositionPipelineSource, compileCompositionDocument, compileCompositionDocumentWithOrigins, parseCompositionShape,
} from '../../../src/shared/composition/compiler';
import * as expression from '../../../src/shared/composition/expression';
import type { BudgetAccountingEvent, BudgetAccountingObserver, CallService, Operand, Predicate } from '../../../src/shared/composition/expression';
import { checkPipelineSource } from '../../../src/shared/composition/pipeline/compile';
import type { PipelineSource } from '../../../src/shared/composition/pipeline/schema';
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
