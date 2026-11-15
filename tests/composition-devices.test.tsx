// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CompositionFields from '../src/CompositionFields';
import { compositionEditorSchema, fieldVariants, nodeDefinition } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import {
  deviceControlKinds, deviceControlModel, deviceDomains, deviceModels, roomDeviceControlSchema, roomDeviceSourceSchema,
  type DeviceControlKind, type RoomDeviceControl,
} from '../src/shared/composition/room-devices';
import { createCompositionDocument, createCompositionPage, compositionSymbol } from '../src/shared/composition/workspace';
import type { CompositionDocument } from '../src/shared/composition/schema';

afterEach(cleanup);
const labels = {
  loading: 'Reading device', unavailable: 'Device offline', failed: 'No response', on: 'Enabled', off: 'Disabled',
  action: 'Adjust', cancel: 'Clear timer', footnote: 'Authored help', sleep: 'Sleeping',
  tankFault: 'Replace tank', waterFault: 'Refill water', invalidTarget: 'Choose a target', highTarget: 'Condensation risk',
};
function source(model: typeof deviceModels[number]) {
  const inputs: Record<string, unknown> = Object.fromEntries(Object.entries(deviceDomains[model]).map(([field, domain]) =>
    [field, `${domain}.synthetic_${field.toLowerCase()}`]));
  if (model === 'air-purifier@1') inputs.roomTitle = 'Synthetic Room';
  if (model === 'bathroom-fan@1') Object.assign(inputs, { id: 'synthetic-fan', roomTitle: 'Synthetic Room', scriptService: 'synthetic_fan_command' });
  if (model === 'grill@1') Object.assign(inputs, {
    title: 'Synthetic Grill', roomTitle: 'Synthetic Room',
    details: [{ title: 'Probe', entityId: 'sensor.demo_probe', icon: 'thermometer' }, { title: 'Warm', entityId: 'switch.demo_warm', icon: 'flame' }],
  });
  if (model === 'humidifier@1') Object.assign(inputs, {
    id: 'synthetic-humidifier', title: 'Synthetic Mist', scheduleId: 'synthetic_schedule',
    applyProfileScriptService: 'synthetic_apply_profile', setLevelScriptService: 'synthetic_set_level',
  });
  return roomDeviceSourceSchema.parse({ id: `source-${model.slice(0, -2)}`, kind: 'model', model, inputs });
}
function atom(kind: DeviceControlKind): RoomDeviceControl {
  const options = kind === 'purifier-mode' ? [{ value: 'Auto', label: 'Automatic' }, { value: 'Manual', label: 'Manual output' }]
    : kind === 'purifier-auto' ? [{ value: 'Quiet', label: 'Quiet output' }]
      : kind === 'purifier-speed' ? [{ value: '100', label: 'Fast' }, { value: '0', label: 'Stopped' }]
        : kind === 'fan-timer' ? [{ value: '10', label: 'Ten minutes', actionLabel: 'Stop after ten minutes' }]
          : kind === 'humidifier-mode' ? [{ value: 'Sleep', label: 'Quiet hours' }, { value: 'Manual', label: 'My output' }]
            : kind === 'humidifier-presets' ? [{ value: '8', label: 'Strong output' }]
              : kind === 'humidifier-warm' ? [{ value: '0', label: 'No heat' }, { value: '3', label: 'Warm' }] : [];
  return roomDeviceControlSchema.parse({
    id: `atom-${kind}`, title: `My ${kind}`, type: 'room-device-control', layout: { span: 1 }, icon: compositionSymbol('drop'),
    binding: { sourceId: `source-${deviceControlModel(kind).slice(0, -2)}` },
    props: { control: kind, family: 'water', options, labels,
      ...(kind === 'fan-timer' ? { initialMinutes: 10 } : {}),
      ...(kind === 'grill-detail' ? { detailEntityId: 'sensor.demo_probe' } : {}),
      ...(kind === 'humidifier-info' ? { info: 'humidity' } : {}),
      ...(kind === 'fan-room' ? { modalId: 'synthetic-fan-modal', fanRail: {
        order: ['power', 'lock'],
        powerIcon: compositionSymbol('power'), lockedIcon: compositionSymbol('lock.fill'), unlockedIcon: compositionSymbol('lock.open'),
        powerOn: 'Start fan', powerOff: 'Stop fan', lock: 'Hold fan', unlock: 'Release fan', locked: 'Held',
      } } : {}),
    },
  });
}
function document(kind: DeviceControlKind) {
  const document = createCompositionDocument('synthetic-device-document');
  document.dataSources = [source(deviceControlModel(kind))];
  document.pages[0].components = [atom(kind)];
  if (kind === 'fan-room') {
    const { navigation: _navigation, ...surface } = createCompositionPage('synthetic-fan-modal');
    document.modals = [{ ...surface, toolbar: { type: 'replace', groups: [] }, presentation: {
      type: 'sheet', width: 'form', height: { type: 'full' }, appearance: 'system', placement: 'canonical-sheet@1',
      grabber: 'canonical', navigation: 'local-stack@1', close: { type: 'close', visibility: 'root-only',
        placement: 'trailing', rail: 'automatic', guard: { type: 'none' } },
    } }];
  }
  return document;
}
const issues = (document: unknown) => {
  try { compileCompositionDocument(document); throw new Error('Expected rejection'); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return error.issues;
  }
};

describe('room-device contract', () => {
  it.each(deviceControlKinds)('compiles atomic %s with exact narrow closure and authored copy', kind => {
    const result = compileCompositionDocument(document(kind));
    const capabilities = [
      'sh.composition@1', 'sh.shell@1', 'sh.backdrop@1', 'sh.chrome@1', 'sh.page@1', 'sh.symbols@1',
      'sh.bindings@1', `sh.${deviceControlModel(kind)}`, ...(kind === 'humidifier-scheduling' ? ['sh.humidifier-scheduling@1'] : []),
      ...(kind === 'fan-room' ? ['sh.actions.navigation@1', 'sh.sheet@1'] : []),
    ].sort();
    expect(result.capabilities).toEqual(capabilities);
    expect(result.document.pages[0].components[0]).toEqual(atom(kind));
  });

  it('rejects wrong or omitted targets, raw service escape hatches, wrong model bindings and duplicate choices', () => {
    const wrong = document('humidifier-mode');
    const model = wrong.dataSources[0];
    if (model.kind !== 'model' || model.model !== 'humidifier@1') throw new Error('Expected humidifier');
    model.inputs.modeEntityId = 'switch.demo_mode';
    expect(issues(wrong)).toContainEqual({ code: 'invalid_combination', pointer: '/document/dataSources/0/inputs/modeEntityId' });
    const unknown = structuredClone(wrong);
    Reflect.set(unknown.dataSources[0], 'service', 'homeassistant.toggle');
    expect(issues(unknown).some(issue => issue.code === 'unknown_field')).toBe(true);
    const missing = structuredClone(wrong);
    Reflect.deleteProperty(model.inputs, 'modeEntityId');
    expect(issues(wrong).some(issue => issue.code === 'missing_required')).toBe(true);
    const mismatch = document('humidifier-power');
    mismatch.dataSources = [source('bathroom-fan@1')];
    const control = mismatch.pages[0].components[0];
    if (control.type !== 'room-device-control') throw new Error('Expected atom');
    control.binding.sourceId = mismatch.dataSources[0].id;
    expect(issues(mismatch)).toContainEqual({ code: 'binding_type', pointer: '/document/pages/0/components/0/binding/sourceId' });
    const duplicate = document('humidifier-mode'), node = duplicate.pages[0].components[0];
    if (node.type !== 'room-device-control') throw new Error('Expected atom');
    node.props.options.push(node.props.options[0]);
    expect(issues(duplicate)).toContainEqual({ code: 'invalid_combination', pointer: '/document/pages/0/components/0/props/options/2/value' });
    expect(issues(missing)).toContainEqual({ code: 'invalid_combination', pointer: '/document/dataSources/0/inputs/modeEntityId' });
  });

  it('rejects unconfigured grill targets, unsupported timer values and unimplemented schedule composition', () => {
    const grill = document('grill-detail'), node = grill.pages[0].components[0];
    if (node.type !== 'room-device-control') throw new Error('Expected atom');
    node.props.detailEntityId = 'switch.demo_not_in_descriptor';
    expect(issues(grill)).toContainEqual({ code: 'invalid_reference', pointer: '/document/pages/0/components/0/props/detailEntityId' });
    const fan = document('fan-timer'), timer = fan.pages[0].components[0];
    if (timer.type !== 'room-device-control') throw new Error('Expected atom');
    timer.props.options[0].value = '11'; timer.props.initialMinutes = 11;
    expect(issues(fan)).toContainEqual({ code: 'invalid_combination', pointer: '/document/pages/0/components/0/props/options/0/value' });
    const unsupported = document('humidifier-power');
    Reflect.set(unsupported.pages[0].components[0], 'type', 'humidifier-schedule-field');
    expect(issues(unsupported).some(issue => issue.capability === 'sh.humidifier-schedule-editor@1')).toBe(true);
  });

  it('validates room navigation and permits only typed status projections', () => {
    const fan = document('fan-room'), room = fan.pages[0].components[0];
    if (room.type !== 'room-device-control') throw new Error('Expected atom');
    room.props.modalId = 'missing-modal';
    expect(issues(fan)).toContainEqual({ code: 'invalid_reference', pointer: '/document/pages/0/components/0/props/modalId' });
    if (!room.props.fanRail) throw new Error('Expected fan rail');
    room.props.fanRail.order = ['lock', 'lock'];
    expect(issues(fan)).toContainEqual({ code: 'invalid_combination', pointer: '/document/pages/0/components/0/props/fanRail/order' });
    const status = document('humidifier-info');
    status.pages[0].components.push({
      id: 'authored-summary', title: 'Device summary', type: 'text', layout: { span: 1 },
      props: { style: 'caption1', unavailableText: 'Summary offline',
        value: { type: 'read', from: { type: 'source', sourceId: status.dataSources[0].id, path: ['stateText'] },
          as: 'string', missing: 'unavailable' } },
    });
    expect(compileCompositionDocument(status).capabilities).toContain('sh.humidifier@1');
    const summary = status.pages[0].components[1];
    if (summary.type !== 'text' || summary.props.value.type !== 'read') throw new Error('Expected read');
    summary.props.value.from.path = ['rawService'];
    expect(issues(status)).toContainEqual({ code: 'invalid_reference', pointer: '/document/pages/0/components/1/props/value/from/path' });
  });
});

describe('structured device authoring', () => {
  it('exposes domain targets, ordered options, states, labels and relationship selectors without JSON editing', () => {
    const initial = document('fan-timer');
    let updated: CompositionDocument | undefined;
    const components = nodeDefinition();
    expect(components).toBeDefined();
    const schema = fieldVariants(components!).find(field => field.properties?.type?.const === 'room-device-control')!;
    render(<CompositionFields schema={schema} value={initial.pages[0].components[0]} path={['pages', 0, 'components', 0]}
      label="Device atom" document={initial} onChange={next => { updated = next; }} onError={message => { throw new Error(message); }}/>);
    expect(screen.getByLabelText('Source Id').tagName).toBe('SELECT');
    expect(within(screen.getByLabelText('Control')).getAllByRole('option')).toHaveLength(deviceControlKinds.length);
    expect(screen.getByLabelText('Initial Minutes').tagName).toBe('INPUT');
    fireEvent.change(screen.getByLabelText('Action Label'), { target: { value: 'My timed action' } });
    const node = updated?.pages[0].components[0];
    expect(node?.type === 'room-device-control' && node.props.options[0].actionLabel).toBe('My timed action');
    expect(screen.getByLabelText('High Target').tagName).toBe('INPUT');
    expect(screen.getByRole('button', { name: 'Add options item' })).toBeDefined();
  });
});
