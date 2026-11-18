import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { evaluateOperand, type Environment } from '../src/shared/composition/evaluator';
import { tokenProblem } from '../src/shared/composition/dial-control';
import { layoutDial } from '../src/shared/composition/dial-math';
import { CompositionValidationError } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { isHiddenNode } from '../src/preview2/model';

/**
 * `sh.dial-control@1` and `sh.dial-text-place@1`: what declares each, that a document without them compiles as it did, the structural rules, the `control`
 * operand's `stopper`, and the text place's arithmetic. The accept and refuse cases themselves are the corpus (`dialctl-*`, `dial-text-place-*`).
 */
type J = Record<string, any>;
const corpus = path.resolve(__dirname, '../contract/corpus');
const first = JSON.parse(readFileSync(path.join(corpus, 'accept/fixture-composition-first-slice.json'), 'utf8')) as { document: J };
const lit = (value: unknown): J => ({ type: 'literal', value });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
/** A value with its undefined fields dropped, as a document file would hold it. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const control = (stopper?: string): J => (stopper === undefined ? { type: 'control' } : { type: 'control', stopper });
const call = (fields: J): J => ({ type: 'call-service', domain: 'climate', service: 'set_temperature', target: { entity_id: lit('climate.demo_hall') }, data: { type: 'object', fields } });
const stopper = (id: string, value: number, rest: J = {}): J => ({ id, value: lit(value), label: lit(id), ink: solid(1, 2, 3), ...rest });
const dialControl = (props: J = {}, rest: J = {}, id = 'c'): J => plain(node(id, 'dial-control', {
  props: {
    range: { min: 60, max: 80, step: 0.5 }, size: 'page', stoppers: [stopper('low', 68), stopper('high', 75)], between: { rule: 'stop' },
    center: { value: { shows: 'low', fractionDigits: 0, unit: '' } }, unavailableText: 'Unavailable', failureText: 'Could not set {value}', ...props,
  },
  action: call({ target_temp_low: control('low'), target_temp_high: control('high') }), a11y: { label: lit('Thermostat') }, ...rest,
}));
const display = (props: J = {}): J => plain(node('d', 'dial', {
  props: { sweep: { start: 145, length: 250 }, center: [{ value: lit('x'), style: 'body', unavailableText: '-' }], ...props }, a11y: { element: 'hidden' },
}));
const compile = (components: J[], tweak?: (document: J) => void) => {
  const document = structuredClone(first.document);
  document.pages[2].components = components;
  tweak?.(document);
  return compileCompositionDocument(document).capabilities;
};
const issue = (components: J[]) => {
  try { compile(components); } catch (error) { if (error instanceof CompositionValidationError) return error.issues[0]; throw error; }
  return undefined;
};
const at = (rest: string) => `/document/pages/2/components/0${rest}`;
const ids = ['sh.dial-control@1', 'sh.dial-text-place@1'];

describe('the two dial ids', () => {
  it('are pending and sorted, and the Studio supports them', () => {
    for (const id of ids) expect(pendingCompositionCapabilities).toContain(id);
    expect(JSON.parse(readFileSync(path.join(corpus, 'capabilities.pending.json'), 'utf8'))).toEqual([...pendingCompositionCapabilities]);
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
    expect(JSON.parse(readFileSync(path.join(corpus, 'capabilities.json'), 'utf8'))).not.toContain('sh.dial-control@1');
  });
  it('are declared by what uses them and only then', () => {
    const wanted = (list: string[]) => list.filter(id => ids.includes(id));
    expect(wanted(compile([]))).toEqual([]);
    expect(wanted(compile([dialControl()]))).toEqual(['sh.dial-control@1']);
    expect(wanted(compile([display()]))).toEqual([]);
    expect(wanted(compile([display({ textAt: { share: 0.5, offset: 4 } })]))).toEqual(['sh.dial-text-place@1']);
    expect(compile([display({ textAt: { share: 0.5 } })])).toContain('sh.dial@1');
  });
  it('declare the call and the enabled-when ids a dial control needs, as other controls do', () => {
    const capabilities = compile([dialControl({}, { enabledWhen: { condition: { type: 'compare', op: 'above', left: lit(1), right: lit(0) }, whenUnknown: 'disabled' } })]);
    expect(capabilities).toEqual(expect.arrayContaining(['sh.call-service@1', 'sh.enabled-when@1', 'sh.conditions@1']));
    expect(compile([dialControl()])).not.toContain('sh.enabled-when@1');
  });
  it('declare the rules id for a rim that follows a rule, and not otherwise', () => {
    const ruled = { type: 'conditional', cases: [{ when: { type: 'compare', op: 'above', left: lit(2), right: lit(1) }, then: solid(4, 5, 6) }], otherwise: solid(7, 8, 9) };
    expect(compile([dialControl({ stoppers: [stopper('low', 68, { ink: ruled }), stopper('high', 75)] })])).toContain('sh.rules@1');
    expect(compile([dialControl()])).not.toContain('sh.rules@1');
  });
  it('leave a document that uses neither as it was', () => {
    const names = readdirSync(path.join(corpus, 'accept')).filter(name => name.endsWith('.json') && !/^(pending-)?(dialctl|dial-text-place)-/.test(name));
    let count = 0;
    for (const name of names) {
      const envelope = JSON.parse(readFileSync(path.join(corpus, 'accept', name), 'utf8')) as { capabilities: string[]; document: J };
      if (!envelope.document?.pages) continue;
      const compiled = compileCompositionDocument(envelope.document);
      expect(compiled.capabilities, name).toEqual(envelope.capabilities);
      for (const id of ids) expect(compiled.capabilities, name).not.toContain(id);
      count += 1;
    }
    expect(count).toBeGreaterThan(100);
  });
  it('are exercised by a pending case each, which the Studio compiles', () => {
    for (const id of ids) {
      const hits = readdirSync(path.join(corpus, 'reject')).filter(name => name.startsWith('pending-')).filter(name => {
        const envelope = JSON.parse(readFileSync(path.join(corpus, 'reject', name), 'utf8')) as { capabilities: string[] };
        return envelope.capabilities.includes(id);
      });
      expect(hits.length, id).toBeGreaterThan(3);
    }
  });
});

describe('the rules the compiler adds to a dial control', () => {
  it('takes one call for the dial or one on each stopper, never a mix or none', () => {
    expect(issue([dialControl()])).toBeUndefined();
    expect(issue([dialControl({}, { action: undefined })])).toMatchObject({ code: 'missing_required', pointer: at('/action') });
    expect(issue([dialControl({ stoppers: [stopper('low', 68, { action: call({ a: control() }) }), stopper('high', 75)] })])).toMatchObject({ code: 'invalid_combination', pointer: at('/props/stoppers/0/action') });
    const each = [stopper('low', 68, { action: call({ a: control() }) }), stopper('high', 75, { action: call({ b: control() }) })];
    expect(issue([dialControl({ stoppers: each, between: { rule: 'free' } }, { action: undefined })])).toBeUndefined();
  });
  it('lets control name a stopper in the dial\'s call only, and a bare control in a stopper\'s own', () => {
    expect(issue([dialControl({}, { action: call({ a: control('low'), b: control('missing') }) })])).toMatchObject({ code: 'invalid_reference', pointer: at('/action/data/fields/b/stopper') });
    expect(issue([dialControl({}, { action: call({ a: control() }) })])).toMatchObject({ code: 'invalid_combination', pointer: at('/action/data/fields/a') });
    const named = [stopper('low', 68, { action: call({ a: control('low') }) }), stopper('high', 75, { action: call({ b: control() }) })];
    expect(issue([dialControl({ stoppers: named, between: { rule: 'free' } }, { action: undefined })])).toMatchObject({ code: 'invalid_combination', pointer: at('/props/stoppers/0/action/data/fields/a/stopper') });
  });
  it('refuses a stopper on a control anywhere else, at the `stopper` field', () => {
    const slider = (action: J) => node('s', 'bound-control', { props: { unavailableText: 'Unavailable', kind: 'slider', value: lit(1) }, action });
    const fan = (value: J) => ({ type: 'call-service', domain: 'fan', service: 'set_percentage', target: { entity_id: lit('fan.demo_bath_fan') }, data: { type: 'object', fields: { percentage: value } } });
    expect(issue([slider(fan(control()))])).toBeUndefined();
    expect(issue([slider(fan(control('low')))])).toMatchObject({ code: 'invalid_combination', pointer: at('/action/data/fields/percentage/stopper') });
    const button = node('b', 'primary-button', { props: {}, action: fan(control('low')) });
    expect(issue([button])).toMatchObject({ code: 'invalid_combination' });
  });
  it('asks for a between with two stoppers and none with one', () => {
    expect(issue([dialControl({ between: undefined })])).toMatchObject({ code: 'missing_required', pointer: at('/props/between') });
    expect(issue([dialControl({ stoppers: [stopper('low', 68)] }, { action: call({ a: control('low') }) })])).toMatchObject({ code: 'invalid_combination', pointer: at('/props/between') });
    expect(issue([dialControl({ stoppers: [stopper('low', 68)], between: undefined, center: { value: { shows: 'low', fractionDigits: 0, unit: '' } } }, { action: call({ a: control('low') }) })])).toBeUndefined();
  });
  it('keeps a literal gap in 0 up to the range, and only under `stop`', () => {
    expect(issue([dialControl({ between: { rule: 'stop', gap: lit(0) } })])).toBeUndefined();
    expect(issue([dialControl({ between: { rule: 'stop', gap: lit(19.5) } })])).toBeUndefined();
    expect(issue([dialControl({ between: { rule: 'stop', gap: lit(20) } })])).toMatchObject({ pointer: at('/props/between/gap') });
    expect(issue([dialControl({ between: { rule: 'free', gap: lit(1) } })])).toMatchObject({ code: 'invalid_combination' });
  });
  it('holds a range to 2,000 steps and a ring to 60 dots', () => {
    expect(issue([dialControl({ range: { min: 0, max: 100, step: 0.05 } })])).toBeUndefined();
    // Exactly 2,000 steps pass even where floating point says 2000.0000000000002 (580 / 0.29, 700 / 0.35, 820 / 0.41).
    for (const [max, step] of [[580, 0.29], [700, 0.35], [820, 0.41], [20, 0.01]]) expect(issue([dialControl({ range: { min: 0, max, step } })]), `${max}/${step}`).toBeUndefined();
    expect(issue([dialControl({ range: { min: 0, max: 580.3, step: 0.29 } })])).toMatchObject({ code: 'limit_exceeded', pointer: at('/props/range/step') });
    expect(issue([dialControl({ range: { min: 0, max: 100, step: 0.04 } })])).toMatchObject({ code: 'limit_exceeded', pointer: at('/props/range/step') });
    expect(issue([dialControl({ range: { min: 0, max: 59, step: 1 }, ticks: { every: 1 } })])).toBeUndefined();
    expect(issue([dialControl({ range: { min: 0, max: 60, step: 1 }, ticks: { every: 1 } })])).toMatchObject({ code: 'limit_exceeded', pointer: at('/props/ticks/every') });
  });
  it('has no sweep to author', () => expect(issue([dialControl({ sweep: { start: 0, length: 90 } })])).toMatchObject({ code: 'unknown_field', pointer: at('/props/sweep') }));
  it('allows `{value}` and no other token in the spoken value and the failure line', () => {
    expect(tokenProblem('{value} degrees')).toBeUndefined();
    expect(tokenProblem('no token')).toBeUndefined();
    expect(tokenProblem('{degrees}')).toBe('invalid_reference');
    expect(tokenProblem('{value')).toBe('invalid_value');
    expect(tokenProblem('value}')).toBe('invalid_value');
  });
  it('takes a stopper whose value, limits and gap are reads that give numbers', () => {
    const read = (as: string): J => ({ type: 'read', from: { type: 'source', sourceId: 'source-entity', path: ['state'] }, as, missing: 'unavailable' });
    expect(issue([dialControl({ stoppers: [stopper('low', 68, { value: read('number'), limit: { max: read('number') } }), stopper('high', 75)], between: { rule: 'stop', gap: read('number') } })])).toBeUndefined();
    expect(issue([dialControl({ stoppers: [stopper('low', 68, { value: read('string') }), stopper('high', 75)] })])).toMatchObject({ code: 'binding_type' });
  });
  it('is drawn and edited in the Studio now (SD3)', () => expect(isHiddenNode({ type: 'dial-control' })).toBe(false));
});

describe('the text place of a dial', () => {
  it('needs lines to place and a share or an offset', () => {
    expect(issue([display({ textAt: { share: 0.5, offset: 4 } })])).toBeUndefined();
    expect(issue([display({ textAt: {} })])).toMatchObject({ code: 'invalid_value', pointer: at('/props/textAt') });
    expect(issue([display({ textAt: { share: 0.5 }, center: undefined })])).toMatchObject({ code: 'invalid_combination', pointer: at('/props/textAt') });
  });
  it('leaves a dial that states neither where it was', () => {
    const base = { width: 140, aspect: 1.4, centerY: 0.56, sweep: { start: 145, length: 250 } };
    expect(layoutDial(base).textCenterY).toBe(layoutDial({ ...base, textAt: {} }).textCenterY);
    expect(layoutDial(base).textCenterY).toBe(layoutDial(base).cy);
  });
  it('puts the barometer\'s text at half the height and 4 points', () => {
    const base = { width: 140, aspect: 1.4, centerY: 0.56, sweep: { start: 145, length: 250 } };
    expect(layoutDial({ ...base, textAt: { share: 0.5, offset: 4 } }).textCenterY).toBe(54);
    expect(layoutDial({ ...base, textAt: { offset: -8 } }).textCenterY).toBe(48);
    expect(layoutDial({ ...base, textAt: { share: 0 } }).textCenterY).toBe(0);
  });
});

describe('the control operand', () => {
  const env = (rest: Partial<Environment>): Environment => ({ read: () => ({ status: 'unavailable' }), ...rest });
  it('reads the value of the stopper it names', () => {
    expect(evaluateOperand(control('low') as never, env({ controlValues: { low: 68, high: 75 } }))).toEqual({ status: 'value', value: 68 });
    expect(evaluateOperand(control('high') as never, env({ controlValues: { low: 68 } }))).toEqual({ status: 'unavailable' });
  });
  it('reads a bare control from the one value being sent, and a named one never from it', () => {
    expect(evaluateOperand(control() as never, env({ controlValue: 72 }))).toEqual({ status: 'value', value: 72 });
    expect(evaluateOperand(control('low') as never, env({ controlValue: 72 }))).toEqual({ status: 'unavailable' });
  });
});
