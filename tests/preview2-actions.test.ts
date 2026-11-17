import { describe, expect, it } from 'vitest';
import type { CompositionAction } from '../src/shared/composition/schema';
import { callSummary, planAction, type ActionInput } from '../src/preview2/actions';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';

const house = houseFrom({ states: [{ entityId: 'light.demo_kitchen', name: 'Kitchen', state: 'off' }, { entityId: 'input_boolean.demo_guest', name: 'Guest', state: 'off' }] });
const input = (over: Partial<ActionInput> = {}): ActionInput => ({
  document: { dataSources: [{ id: 'guest', kind: 'model', model: 'power-toggle@1', inputs: { entityId: { type: 'literal', value: 'input_boolean.demo_guest' } } }] as never,
    localState: [{ id: 'flag', type: 'boolean', initial: false }, { id: 'level', type: 'number', initial: 1, minimum: 0, maximum: 4, step: 1 }] },
  house, overlay: emptyOverlay, ...over,
});
const call = (service: string, extra: Record<string, unknown> = {}): CompositionAction => ({ type: 'call-service', domain: 'light', service, target: { entity_id: { type: 'literal', value: 'light.demo_kitchen' } }, ...extra }) as CompositionAction;

describe('planAction', () => {
  it('passes navigation through for the reducer', () => {
    expect(planAction({ type: 'back' }, input())).toEqual({ nav: { type: 'back' } });
  });

  it('plans a simulated call-service with its overlay and summary', () => {
    expect(planAction(call('turn_on'), input())).toEqual({ simulated: 'Kitchen: turn on', call: { domain: 'light', service: 'turn_on', entityIds: ['light.demo_kitchen'], data: {} }, overlay: { entities: { 'light.demo_kitchen': { state: 'on' } }, local: {} } });
  });

  it('reports a call it resolves but changes nothing for without an overlay', () => {
    const plan = planAction(call('turn_off'), input());
    expect(plan.simulated).toBe('Kitchen: turn off');
    expect(plan.overlay).toBeUndefined();
  });

  it('plans nothing when an operand is not available', () => {
    const missing = { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: { type: 'read', from: { type: 'source', sourceId: 'nope', path: ['state'] }, as: 'entity-id', missing: 'unavailable' } } } as CompositionAction;
    expect(planAction(missing, input())).toEqual({});
  });

  it('passes the control value into the call data', () => {
    const slider = call('turn_on', { data: { type: 'object', fields: { brightness_pct: { type: 'control' } } } });
    const plan = planAction(slider, input({ control: 50 }));
    expect(plan.overlay?.entities['light.demo_kitchen']).toEqual({ state: 'on', brightness: 128 });
  });

  it('toggles the entity of a power domain action through its source', () => {
    const plan = planAction({ type: 'domain', sourceId: 'guest', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } }, input());
    expect(plan.simulated).toBe('Guest: toggle');
    expect(plan.overlay?.entities['input_boolean.demo_guest']).toEqual({ state: 'on' });
    expect(planAction({ type: 'domain', sourceId: 'unknown', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } }, input())).toEqual({});
  });

  it('writes a set-local value the field accepts and refuses one it does not', () => {
    expect(planAction({ type: 'set-local', stateId: 'flag', value: { type: 'boolean', value: true } }, input()).overlay?.local).toEqual({ flag: { type: 'boolean', value: true } });
    expect(planAction({ type: 'set-local', stateId: 'level', value: { type: 'number', value: 9 } }, input())).toEqual({});
    expect(planAction({ type: 'set-local', stateId: 'missing', value: { type: 'boolean', value: true } }, input())).toEqual({});
  });
});

describe('callSummary', () => {
  const resolved = (entityIds: string[], service = 'turn_on', domain = 'light') => ({ domain, service, entityIds, data: {} });
  it('says the friendly name and the service in words', () => {
    expect(callSummary(resolved(['light.demo_kitchen'], 'toggle'), house, emptyOverlay)).toBe('Kitchen: toggle');
    expect(callSummary(resolved(['light.demo_kitchen'], 'turn_on'), house, emptyOverlay)).toBe('Kitchen: turn on');
    expect(callSummary(resolved(['input_boolean.demo_guest'], 'toggle', 'input_boolean'), house, emptyOverlay)).toBe('Guest: toggle');
  });
  it('counts the rest when several entities are called, and falls back to the words in the id and the domain', () => {
    expect(callSummary(resolved(['light.demo_kitchen', 'light.demo_a', 'light.demo_b'], 'turn_off'), house, emptyOverlay)).toBe('Kitchen and 2 more: turn off');
    expect(callSummary(resolved(['light.demo_not_there']), house, emptyOverlay)).toBe('Demo not there: turn on');
    expect(callSummary(resolved([], 'turn_on', 'input_boolean'), house, emptyOverlay)).toBe('Input boolean: turn on');
  });
  it('never prints a raw service id', () => {
    expect(callSummary(resolved(['light.demo_kitchen'], 'set_temperature', 'climate'), house, emptyOverlay)).not.toMatch(/climate\.set_temperature|_/);
  });
});
