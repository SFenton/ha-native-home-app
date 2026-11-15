import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CallService } from '../src/shared/composition/schema';
import type { NativeState } from '../src/shared/native-state';
import { evaluateOperand, evaluatePredicate, loading, unavailable, value } from '../src/preview2/evaluate';
import {
  applyCall, applyLocal, createEnvironment, emptyOverlay, houseFrom, localValue, projectSource, resolveCall, shownEntity, type House,
} from '../src/preview2/projections';
import fixture from '../src/preview2/fixtures/home-domains.json';

const document = compileCompositionDocument(structuredClone(fixture.document)).document;
const source = (id: string) => document.dataSources.find(item => item.id === id)!;
const entity = (entityId: string, state: string, rest: Partial<NativeState> = {}): NativeState => ({ entityId, state, name: entityId, ...rest });
const literalOf = (entityId: unknown) => (entityId as { value?: string })?.value;
const house = (...states: NativeState[]): House => houseFrom({ states, currentUser: { id: 'user-1', name: 'Demo', isOwner: false, isAdmin: true, personEntityId: 'person.demo' } });
const project = (id: string, h: House, overlay = emptyOverlay) => projectSource(source(id), h, overlay, literalOf);

describe('ha-entity', () => {
  const entityOf = (id: string) => { const s = source(id); return s.kind === 'ha-entity' ? literalOf(s.entityId)! : ''; };
  const id = 'hc-entity-switch-demo-entity-98', entityId = entityOf(id);

  it('reads state and attributes, and is unavailable for a missing entity or before the first read', () => {
    const e = createEnvironment(document, house(entity(entityId, 'on', { unit: '%', brightness: 128, deviceClass: 'plug', name: 'Plug' })));
    expect(e.read(id, ['state'])).toEqual(value('on'));
    expect(e.read(id, ['attributes', 'unit_of_measurement'])).toEqual(value('%'));
    expect(e.read(id, ['attributes', 'brightness'])).toEqual(value(128));
    expect(e.read(id, ['attributes', 'device_class'])).toEqual(value('plug'));
    expect(e.read(id, ['attributes', 'friendly_name'])).toEqual(value('Plug'));
    expect(e.read(id, ['attributes', 'nothing'])).toEqual(unavailable);
    expect(e.read(id, ['attributes'])).toEqual(unavailable);
    expect(createEnvironment(document, house()).read(id, ['state'])).toEqual(unavailable);
    expect(createEnvironment(document, {}).read(id, ['state'])).toEqual(loading);
    expect(createEnvironment(document, house()).read('no-such-source', ['state'])).toEqual(unavailable);
  });

  it('resolves an entity given as a read of another source, and refuses a cycle', () => {
    const doc = { dataSources: [
      { id: 'pick', kind: 'ha-entity' as const, entityId: { type: 'literal' as const, value: 'input_text.demo_pick' } },
      { id: 'target', kind: 'ha-entity' as const, entityId: { type: 'read' as const, from: { type: 'source' as const, sourceId: 'pick', path: ['state'] }, as: 'entity-id' as const, missing: 'unavailable' as const } },
      { id: 'loop', kind: 'ha-entity' as const, entityId: { type: 'read' as const, from: { type: 'source' as const, sourceId: 'loop', path: ['state'] }, as: 'entity-id' as const, missing: 'unavailable' as const } },
    ] } as never;
    const e = createEnvironment(doc, house(entity('input_text.demo_pick', 'light.demo_a'), entity('light.demo_a', 'on')));
    expect(e.read('target', ['state'])).toEqual(value('on'));
    expect(e.read('loop', ['state'])).toEqual(unavailable);
  });
});

describe('power-toggle', () => {
  const id = 'hc-guest-0', entityId = 'input_boolean.demo_entity_122';
  it('projects on, off, unavailable and loading', () => {
    expect(project(id, house(entity(entityId, 'on'))).fields).toEqual({ stateText: 'On', isOn: true, phase: 'ready', isError: false });
    expect(project(id, house(entity(entityId, 'off'))).fields).toMatchObject({ stateText: 'Off', isOn: false, phase: 'ready' });
    expect(project(id, house(entity(entityId, 'unavailable')))).toMatchObject({ phase: 'unavailable', fields: { stateText: 'Unavailable', isOn: false } });
    expect(project(id, house())).toMatchObject({ phase: 'unavailable' });
    expect(project(id, {})).toMatchObject({ phase: 'loading', fields: { stateText: 'Loading' } });
  });
  it('feeds a read through the environment with the typed fields', () => {
    const e = createEnvironment(document, house(entity(entityId, 'on')));
    expect(e.read(id, ['isOn'])).toEqual(value(true));
    expect(e.read(id, ['stateText'])).toEqual(value('On'));
    expect(e.read(id, ['nope'])).toEqual(unavailable);
    expect(createEnvironment(document, {}).read(id, ['isOn'])).toEqual(loading);
  });
});

describe('home-status', () => {
  const lights = ['light.demo_entity_308', 'light.demo_entity_309', 'light.demo_entity_310', 'light.demo_entity_311', 'light.demo_entity_313', 'light.demo_entity_314'];
  it('counts active lights, shows the idle label, and does not vouch for a partial set', () => {
    const some = house(...lights.map((id, i) => entity(id, i < 2 ? 'on' : 'off')));
    expect(project('hc-status-lights', some)).toMatchObject({ phase: 'ready', fields: { stateText: '2 On', state: 'active', isActive: true } });
    expect(project('hc-status-lights', house(...lights.map(id => entity(id, 'off'))))).toMatchObject({ fields: { stateText: 'All Off', state: 'idle', isActive: false } });
    const partial = house(entity(lights[0], 'off'), entity(lights[1], 'unavailable'));
    expect(project('hc-status-lights', partial)).toMatchObject({ phase: 'unavailable', fields: { stateText: 'Unavailable', state: 'unavailable' } });
    expect(project('hc-status-lights', house(entity(lights[0], 'on'), entity(lights[1], 'unavailable'))).fields).toMatchObject({ stateText: '1 On', isActive: true });
    expect(project('hc-status-lights', house())).toMatchObject({ phase: 'unavailable' });
    expect(project('hc-status-lights', {})).toMatchObject({ phase: 'loading', fields: { stateText: 'Loading', state: 'loading' } });
  });
  it('words a contact item, a contact summary, occupancy and an entity projection', () => {
    const contact = 'binary_sensor.demo_entity_77';
    expect(project('hc-reading-binary-sensor-demo-entity-77', house(entity(contact, 'on'))).fields.stateText).toBe('Open');
    expect(project('hc-reading-binary-sensor-demo-entity-77', house(entity(contact, 'off'))).fields.stateText).toBe('Closed');
    expect(project('hc-status-contacts', house(entity(contact, 'on'), entity('binary_sensor.demo_entity_78', 'off'), entity('binary_sensor.demo_entity_289', 'off'))).fields)
      .toMatchObject({ stateText: '1 Open', state: 'open-home', isActive: true });
    expect(project('hc-status-contacts', house(entity(contact, 'off'), entity('binary_sensor.demo_entity_78', 'off'), entity('binary_sensor.demo_entity_289', 'off'))).fields)
      .toMatchObject({ stateText: 'All Closed', state: 'idle' });
    expect(project('hc-status-occupancy', house(entity('binary_sensor.demo_entity_128', 'on'))).fields).toMatchObject({ stateText: 'Detected', isActive: true });
    expect(project('hc-status-occupancy', house(entity('binary_sensor.demo_entity_128', 'off'))).fields).toMatchObject({ stateText: 'Clear', isActive: false });
    expect(project('hc-status-security', house(entity('alarm_control_panel.demo_entity_125', 'armed_home'))).fields).toMatchObject({ stateText: 'armed_home', state: 'armed_home' });
  });
  it('words a climate range and an air-quality pair, and drops an unavailable member', () => {
    expect(project('hc-status-climate', house(entity('input_text.demo_entity_127', '68-72'))).fields.stateText).toBe('68-72');
    expect(project('hc-air-0', house(entity('sensor.demo_entity_206', '42'), entity('sensor.demo_entity_210', '9.1', { unit: 'µg/m³' }))).fields.stateText).toBe('42 • 9.1 µg/m³');
  });
});

describe('home-light', () => {
  const id = 'hc-light-light-demo-entity-307';
  it('reports power, brightness and members', () => {
    const lit = house(entity('light.demo_entity_307', 'on', { brightness: 128 }), entity('light.demo_entity_308', 'on'), entity('light.demo_entity_309', 'off'));
    expect(project(id, lit)).toMatchObject({ phase: 'ready', fields: { isOn: true, state: 'on', stateText: 'On', brightnessPercent: 50, memberCount: 4, membersOn: 1 } });
    expect(project(id, house(entity('light.demo_entity_307', 'off'))).fields).toMatchObject({ isOn: false, brightnessPercent: null, membersOn: 0 });
    expect(project(id, house(entity('light.demo_entity_307', 'off'), entity('light.demo_entity_309', 'on'))).fields.isOn).toBe(true);
    expect(project(id, house())).toMatchObject({ phase: 'unavailable', fields: { state: 'unavailable', isOn: false } });
    expect(project(id, {})).toMatchObject({ phase: 'loading' });
  });
});

describe('alarm-mode and security-door', () => {
  it('projects the alarm state and activity', () => {
    const panel = 'alarm_control_panel.demo_entity_125';
    expect(project('source-security-panel', house(entity(panel, 'disarmed')))).toMatchObject({ phase: 'ready', fields: { state: 'disarmed', isActive: false } });
    expect(project('source-security-panel', house(entity(panel, 'armed_away'))).fields).toMatchObject({ state: 'armed_away', isActive: true });
    expect(project('source-security-panel', house(entity(panel, 'unknown')))).toMatchObject({ phase: 'unavailable' });
    expect(project('source-security-panel', {})).toMatchObject({ phase: 'loading' });
  });
  it('projects a lock and a garage door', () => {
    expect(project('hc-door-1', house(entity('lock.demo_entity_406', 'locked')))).toMatchObject({ phase: 'ready', fields: { kind: 'lock', state: 'locked', isActive: false, isError: false } });
    expect(project('hc-door-1', house(entity('lock.demo_entity_406', 'jammed'))).fields).toMatchObject({ isActive: true, isError: true });
    expect(project('hc-door-2', house(entity('cover.demo_entity_393', 'closed'))).fields).toMatchObject({ kind: 'garage', isActive: false });
    expect(project('hc-door-2', house(entity('cover.demo_entity_393', 'open'))).fields).toMatchObject({ kind: 'garage', isActive: true });
    expect(project('hc-door-2', house())).toMatchObject({ phase: 'unavailable' });
  });
});

describe('models phase 1 does not resolve', () => {
  it('are unavailable once the house is read, loading before', () => {
    expect(project('home-weather', house())).toMatchObject({ phase: 'unavailable', fields: {} });
    expect(project('home-weather', {})).toMatchObject({ phase: 'loading' });
    expect(createEnvironment(document, house()).read('home-weather', ['stateText'])).toEqual(unavailable);
    expect(createEnvironment(document, {}).read('home-weather', ['stateText'])).toEqual(loading);
  });
});

describe('viewer', () => {
  it('comes from the snapshot user, and the person state from the person entity', () => {
    const h = house(entity('person.demo', 'home'));
    const e = createEnvironment(document, h);
    expect(e.viewer).toEqual({ userId: 'user-1', isAdmin: true, personEntityId: 'person.demo' });
    expect(evaluatePredicate({ type: 'viewer-person', in: ['home'] }, e)).toBe('yes');
    expect(evaluatePredicate({ type: 'viewer-person', in: ['home'] }, createEnvironment(document, house()))).toBe('unknown');
    expect(createEnvironment(document, {}).viewerPersonState!()).toEqual(loading);
  });
});

describe('overlay and simulated calls', () => {
  const light = 'light.demo_entity_308', base = house(entity(light, 'off'), entity('lock.demo_entity_406', 'locked'), entity('cover.demo_entity_393', 'closed'),
    entity('alarm_control_panel.demo_entity_125', 'disarmed'), entity('climate.demo_entity_83', 'heat', { temperature: 20 }), entity('sensor.demo_entity_274', '4'));
  const call = (domain: string, service: string, entityIds: string[], data: Record<string, unknown> = {}) => ({ domain, service, entityIds, data: data as never });

  it('turns an entity on and off without touching the house', () => {
    const on = applyCall(base, emptyOverlay, call('light', 'turn_on', [light]));
    expect(shownEntity(base, on, light)?.state).toBe('on');
    expect(base.states!.get(light)!.state).toBe('off');
    expect(project('hc-light-light-demo-entity-308', base, on).fields.isOn).toBe(true);
    expect(createEnvironment(document, base, on).read('hc-light-light-demo-entity-308', ['isOn'])).toEqual(value(true));
    expect(shownEntity(base, applyCall(base, on, call('light', 'turn_off', [light])), light)?.state).toBe('off');
    expect(shownEntity(base, applyCall(base, on, call('light', 'toggle', [light])), light)?.state).toBe('off');
    expect(emptyOverlay.entities).toEqual({});
  });
  it('sets brightness from a percent or a raw value', () => {
    expect(shownEntity(base, applyCall(base, emptyOverlay, call('light', 'turn_on', [light], { brightness_pct: 50 })), light)).toMatchObject({ state: 'on', brightness: 128 });
    expect(shownEntity(base, applyCall(base, emptyOverlay, call('light', 'turn_on', [light], { brightness: 40 })), light)?.brightness).toBe(40);
  });
  it('simulates lock, cover, alarm and climate calls', () => {
    const run = (domain: string, service: string, id: string, data = {}) => shownEntity(base, applyCall(base, emptyOverlay, call(domain, service, [id], data)), id)!;
    expect(run('lock', 'unlock', 'lock.demo_entity_406').state).toBe('unlocked');
    expect(run('cover', 'open_cover', 'cover.demo_entity_393').state).toBe('open');
    expect(run('alarm_control_panel', 'alarm_arm_away', 'alarm_control_panel.demo_entity_125').state).toBe('armed_away');
    expect(run('climate', 'set_temperature', 'climate.demo_entity_83', { temperature: 22 }).temperature).toBe(22);
    expect(run('climate', 'set_temperature', 'climate.demo_entity_83', { target_temp_low: 19, target_temp_high: 24 })).toMatchObject({ targetTempLow: 19, targetTempHigh: 24 });
    expect(run('climate', 'set_hvac_mode', 'climate.demo_entity_83', { hvac_mode: 'cool' }).state).toBe('cool');
  });
  it('returns the same overlay when nothing is simulated, so a view does not redraw', () => {
    for (const unsimulated of [call('vacuum', 'start', [light]), call('light', 'turn_on', ['light.demo_not_there']), call('climate', 'set_temperature', ['climate.demo_entity_83']),
      call('light', 'turn_on', [])]) expect(applyCall(base, emptyOverlay, unsimulated)).toBe(emptyOverlay);
    const unavailableHouse = house(entity(light, 'unavailable'));
    expect(applyCall(unavailableHouse, emptyOverlay, call('light', 'turn_on', [light]))).toBe(emptyOverlay);
  });
  it('keeps earlier changes when a later call lands, and copies rather than mutating', () => {
    const first = applyCall(base, emptyOverlay, call('lock', 'unlock', ['lock.demo_entity_406']));
    const second = applyCall(base, first, call('light', 'turn_on', [light]));
    expect(second).not.toBe(first);
    expect(second.entities['lock.demo_entity_406']).toBe(first.entities['lock.demo_entity_406']);
    expect(Object.keys(first.entities)).toEqual(['lock.demo_entity_406']);
  });
  it('resolves a call-service action target and data through operands', () => {
    const action: CallService = {
      type: 'call-service', domain: 'light', service: 'turn_on',
      target: { entity_id: { type: 'literal', value: light } },
      data: { type: 'object', fields: { brightness_pct: { type: 'math', op: 'scale', args: [{ type: 'control' }, { type: 'literal', value: 0 }, { type: 'literal', value: 10 }, { type: 'literal', value: 0 }, { type: 'literal', value: 100 }] } } },
    };
    expect(resolveCall(action, createEnvironment(document, base, emptyOverlay, 5))).toEqual({ domain: 'light', service: 'turn_on', entityIds: [light], data: { brightness_pct: 50 } });
    expect(resolveCall(action, createEnvironment(document, base))).toBeUndefined();
    expect(resolveCall({ ...action, data: undefined, target: { entity_id: { type: 'literal', value: ['light.demo_a', 'light.demo_b'] } } }, createEnvironment(document, base)))
      .toEqual({ domain: 'light', service: 'turn_on', entityIds: ['light.demo_a', 'light.demo_b'], data: {} });
    expect(resolveCall({ type: 'call-service', domain: 'light', service: 'turn_off' }, createEnvironment(document, base))?.entityIds).toEqual([]);
    expect(evaluateOperand({ type: 'literal', value: 1 }, createEnvironment(document, base))).toEqual(value(1));
  });
  it('holds local state writes over the initial value', () => {
    const field = document.localState?.[0];
    if (!field) throw new Error('The fixture needs a local state field');
    const initial = localValue(document, emptyOverlay, field.id);
    expect(initial).toBeDefined();
    const written = applyLocal(emptyOverlay, field.id, { type: 'string', value: 'rooms' });
    expect(localValue(document, written, field.id)).toEqual({ type: 'string', value: 'rooms' });
    expect(localValue(document, emptyOverlay, 'missing')).toBeUndefined();
    expect(emptyOverlay.local).toEqual({});
  });
});
