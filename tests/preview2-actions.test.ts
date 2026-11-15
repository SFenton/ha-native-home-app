import { describe, expect, it } from 'vitest';
import type { CompositionAction } from '../src/shared/composition/schema';
import { planAction, type ActionInput } from '../src/preview2/actions';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';

const house = houseFrom({ states: [{ entityId: 'light.kitchen', name: 'Kitchen', state: 'off' }, { entityId: 'input_boolean.guest', name: 'Guest', state: 'off' }] });
const input = (over: Partial<ActionInput> = {}): ActionInput => ({
  document: { dataSources: [{ id: 'guest', kind: 'model', model: 'power-toggle@1', inputs: { entityId: { type: 'literal', value: 'input_boolean.guest' } } }] as never,
    localState: [{ id: 'flag', type: 'boolean', initial: false }, { id: 'level', type: 'number', initial: 1, minimum: 0, maximum: 4, step: 1 }] },
  house, overlay: emptyOverlay, ...over,
});
const call = (service: string, extra: Record<string, unknown> = {}): CompositionAction => ({ type: 'call-service', domain: 'light', service, target: { entity_id: { type: 'literal', value: 'light.kitchen' } }, ...extra }) as CompositionAction;

describe('planAction', () => {
  it('passes navigation through for the reducer', () => {
    expect(planAction({ type: 'back' }, input())).toEqual({ nav: { type: 'back' } });
  });

  it('plans a simulated call-service with its overlay and summary', () => {
    expect(planAction(call('turn_on'), input())).toEqual({ simulated: 'Simulated light.turn_on', overlay: { entities: { 'light.kitchen': { state: 'on' } }, local: {} } });
  });

  it('reports a call it resolves but changes nothing for without an overlay', () => {
    const plan = planAction(call('turn_off'), input());
    expect(plan.simulated).toBe('Simulated light.turn_off');
    expect(plan.overlay).toBeUndefined();
  });

  it('plans nothing when an operand is not available', () => {
    const missing = { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: { type: 'read', from: { type: 'source', sourceId: 'nope', path: ['state'] }, as: 'entity-id', missing: 'unavailable' } } } as CompositionAction;
    expect(planAction(missing, input())).toEqual({});
  });

  it('passes the control value into the call data', () => {
    const slider = call('turn_on', { data: { type: 'object', fields: { brightness_pct: { type: 'control' } } } });
    const plan = planAction(slider, input({ control: 50 }));
    expect(plan.overlay?.entities['light.kitchen']).toEqual({ state: 'on', brightness: 128 });
  });

  it('toggles the entity of a power domain action through its source', () => {
    const plan = planAction({ type: 'domain', sourceId: 'guest', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } }, input());
    expect(plan.simulated).toBe('Simulated input_boolean.toggle');
    expect(plan.overlay?.entities['input_boolean.guest']).toEqual({ state: 'on' });
    expect(planAction({ type: 'domain', sourceId: 'unknown', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } }, input())).toEqual({});
  });

  it('writes a set-local value the field accepts and refuses one it does not', () => {
    expect(planAction({ type: 'set-local', stateId: 'flag', value: { type: 'boolean', value: true } }, input()).overlay?.local).toEqual({ flag: { type: 'boolean', value: true } });
    expect(planAction({ type: 'set-local', stateId: 'level', value: { type: 'number', value: 9 } }, input())).toEqual({});
    expect(planAction({ type: 'set-local', stateId: 'missing', value: { type: 'boolean', value: true } }, input())).toEqual({});
  });
});
