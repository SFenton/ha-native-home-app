import { describe, expect, it } from 'vitest';
import { compileCompositionDocument, supportedCompositionCapabilities } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { callServiceWarnings, compositionWarnings } from '../src/shared/composition/lints';
import { checkCallService, checkOperand, checkPredicate, type CallService, type Operand, type Predicate } from '../src/shared/composition/expression';
import { createCompositionDocument } from '../src/shared/composition/workspace';
import type { CompositionDocument } from '../src/shared/composition/schema';

const lit = (value: unknown) => ({ type: 'literal', value }) as Operand;
const read = (path: string[], as: 'string' | 'number' = 'string'): Operand => ({ type: 'read', from: { type: 'source', sourceId: 'fan', path }, as, missing: 'unavailable' });
function documentWith(components: unknown[], extra: (document: CompositionDocument) => void = () => {}) {
  const document = createCompositionDocument('grammar');
  document.dataSources.push({ id: 'fan', kind: 'ha-entity', entityId: { type: 'literal', value: 'fan.guest' } });
  document.pages[0].components = components as CompositionDocument['pages'][number]['components'];
  extra(document);
  return document;
}
const call = (extra: object = {}) => ({ type: 'call-service', domain: 'fan', service: 'turn_on', target: { entity_id: lit('fan.guest') }, ...extra });
const button = (action: unknown) => ({ id: 'go', title: 'Go', type: 'primary-button', layout: { span: 1 }, props: {}, action });
function firstIssue(document: unknown) {
  try { compileCompositionDocument(document); return undefined; }
  catch (error) { if (!(error instanceof CompositionValidationError)) throw error; return error.issues[0]; }
}

describe('generic grammar compile', () => {
  it('lists the five new capabilities', () => {
    for (const name of ['call-service', 'bound-control', 'visible-when', 'selected-when', 'operands']) expect(supportedCompositionCapabilities).toContain(`sh.${name}@1`);
    expect(supportedCompositionCapabilities.length).toBeGreaterThanOrEqual(161);
  });

  it('requires exactly the capabilities a call, a rule and an operand use', () => {
    const compiled = compileCompositionDocument(documentWith([button(call())]));
    expect(compiled.capabilities).toEqual(expect.arrayContaining(['sh.call-service@1', 'sh.operands@1', 'sh.primary-button@1']));
    expect(compiled.capabilities).not.toContain('sh.visible-when@1');
    const bare = compileCompositionDocument(documentWith([button({ type: 'call-service', domain: 'script', service: 'bedtime' })]));
    expect(bare.capabilities).toContain('sh.call-service@1');
    expect(bare.capabilities).not.toContain('sh.operands@1');
    const ruled = compileCompositionDocument(documentWith([{ id: 't', title: 'T', type: 'text', layout: { span: 1 },
      visibleWhen: { type: 'viewer', isAdmin: true }, props: { value: lit('x'), style: 'body', unavailableText: 'n' } }]));
    expect(ruled.capabilities).toContain('sh.visible-when@1');
    expect(ruled.capabilities).not.toContain('sh.operands@1');
  });

  it('keeps the control value to a control\'s own call', () => {
    expect(firstIssue(documentWith([button(call({ data: { type: 'object', fields: { v: { type: 'control' } } } }))]))).toEqual(
      { code: 'invalid_combination', pointer: '/document/pages/0/components/0/action/data/fields/v' });
  });

  it('accepts a rule on a tile grid child', () => {
    expect(firstIssue(documentWith([{ id: 'g', title: 'G', type: 'tile-grid', layout: { span: 1 },
      props: { minimum: 'tile@1', maxColumns: 2, spacing: { type: 'token', name: 'm' }, equalRowHeights: false, shortRow: 'share', fold: 'page' },
      children: [{ id: 't', title: 'T', type: 'text', layout: { span: 1 }, visibleWhen: { type: 'viewer', isAdmin: true }, props: { value: lit('x'), style: 'body', unavailableText: 'n' } }] }]))).toBeUndefined();
  });

  it('refuses a call-service action where only navigation is allowed', () => {
    const document = documentWith([{ id: 'c', title: 'C', type: 'collection', layout: { span: 1 },
      props: { providerId: 'p', template: 'rows', loadingText: 'l', emptyText: 'e' }, selection: call() }]);
    expect(firstIssue(document)).toBeDefined();
  });
});

describe('expression checks', () => {
  const issues = (operand: Operand, control = false) => checkOperand(operand, '/x', control).issues;
  it('bounds depth, size and text', () => {
    let deep: Operand = lit(1);
    for (let i = 0; i < 8; i++) deep = { type: 'math', op: 'add', args: [deep, lit(1)] };
    expect(issues(deep)[0]).toMatchObject({ code: 'limit_exceeded' });
    expect(issues({ type: 'list', items: Array.from({ length: 65 }, () => lit(1)) })).toContainEqual({ code: 'limit_exceeded', pointer: '/x/items' });
    expect(issues(lit('y'.repeat(2001)))).toEqual([{ code: 'limit_exceeded', pointer: '/x/value' }]);
    expect(issues(lit({ a: { b: { c: { d: { e: 1 } } } } }))).toHaveLength(1);
  });
  it('checks arity, holes and reads', () => {
    expect(issues({ type: 'math', op: 'clamp', args: [lit(1)] })).toEqual([{ code: 'invalid_combination', pointer: '/x/args' }]);
    expect(issues({ type: 'format', pattern: '{a', args: { a: lit(1) } })).toEqual([{ code: 'invalid_value', pointer: '/x/pattern' }]);
    expect(issues({ type: 'format', pattern: '{a}', args: { a: lit(1) }, formats: { b: { number: { maximumFractionDigits: 1 } } } })).toEqual([{ code: 'invalid_reference', pointer: '/x/formats/b' }]);
    expect(issues(read(['attributes', '12']))).toEqual([{ code: 'invalid_reference', pointer: '/x/from/path/1' }]);
    expect(issues({ type: 'object', fields: { '9bad': lit(1) } })).toEqual([{ code: 'invalid_value', pointer: '/x/fields/9bad' }]);
    expect(issues({ type: 'control' })).toEqual([{ code: 'invalid_combination', pointer: '/x' }]);
    expect(issues({ type: 'control' }, true)).toEqual([]);
  });
  it('reports the sources an expression reads', () => {
    const facts = checkOperand({ type: 'format', pattern: '{a}', args: { a: read(['state']) } }, '/x');
    expect(facts.references).toEqual([{ sourceId: 'fan', path: ['state'], pointer: '/x/args/a', kind: 'string' }]);
    expect(facts.usedOperands).toBe(true);
  });
  it('checks predicates', () => {
    const check = (predicate: Predicate) => checkPredicate(predicate, '/p').issues;
    expect(check({ type: 'numeric', sourceId: 'fan', path: ['state'] })).toEqual([{ code: 'invalid_combination', pointer: '/p' }]);
    expect(check({ type: 'viewer' })).toEqual([{ code: 'invalid_combination', pointer: '/p' }]);
    expect(check({ type: 'not', of: { type: 'viewer', isAdmin: true } })).toEqual([]);
    const facts = checkPredicate({ type: 'any', of: [{ type: 'state', sourceId: 'fan', path: ['state'], in: ['on'] }] }, '/p');
    expect(facts.references[0].pointer).toBe('/p/of/0');
  });
  it('checks a call\'s target and data', () => {
    const run = (value: Partial<CallService>) => checkCallService({ type: 'call-service', domain: 'a', service: 'b', ...value } as CallService, '/c', false).issues;
    expect(run({ target: {} })).toEqual([{ code: 'invalid_value', pointer: '/c/target' }]);
    expect(run({ target: { entity_id: lit(4) } })).toEqual([{ code: 'invalid_value', pointer: '/c/target/entity_id/value' }]);
    expect(run({ target: { entity_id: lit(['a.b']) } })).toEqual([]);
    expect(run({ target: { area_id: lit('x') }, data: { type: 'object', fields: { area_id: lit('y') } } })).toEqual([{ code: 'invalid_combination', pointer: '/c/target/area_id' }]);
  });
});

describe('authoring warnings', () => {
  const confirm = { type: 'additional', style: 'alert', title: 'Sure?', confirmLabel: 'Yes', cancelLabel: 'Cancel', destructive: false };
  it.each(['lock', 'alarm_control_panel', 'cover'])('warns for %s without a confirmation and not with one', domain => {
    expect(callServiceWarnings({ type: 'call-service', domain, service: 'x' }, '/a')).toHaveLength(1);
    expect(callServiceWarnings({ type: 'call-service', domain, service: 'x', confirmation: { type: 'policy' } })).toHaveLength(1);
    expect(callServiceWarnings({ type: 'call-service', domain, service: 'x', confirmation: confirm })).toEqual([]);
  });
  it('stays quiet for other domains and flags secret-looking data', () => {
    expect(callServiceWarnings({ type: 'call-service', domain: 'light', service: 'turn_on' })).toEqual([]);
    expect(callServiceWarnings({ type: 'call-service', domain: 'light', service: 'x', data: { fields: { webhook_id: {} } } })).toHaveLength(1);
  });
  it('finds every call in a document without blocking it', () => {
    const document = documentWith([button({ type: 'call-service', domain: 'lock', service: 'unlock' })]);
    expect(compositionWarnings(document)).toEqual([expect.objectContaining({ pointer: '/document/pages/0/components/0/action' })]);
    expect(() => compileCompositionDocument(document)).not.toThrow();
  });
});
