import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { compositionSymbol } from '../../../src/shared/composition/workspace';
import { newFlow, updateFlow } from '../../../src/workspace2/data/flow';
import type { LogicFieldKind } from '../../../src/workspace2/logic-fields/registry';
import type { EditorPath } from '../../../src/composition-editor';
import { draftDocument, tile } from '../draft/fixtures';
import type { Operand } from '../../../src/shared/composition/expression';
import type { NativeSnapshot } from '../../../src/shared/native-state';

export const integrationSnapshot: NativeSnapshot = {
  mode: 'live', houseConfig: { schema: 2, hash: 'configured-integration-fixture', config: {} },
  states: [
    { entityId: 'binary_sensor.demo_window', name: 'Window', state: 'closed', deviceClass: 'window' },
    { entityId: 'sensor.demo_living_room_temperature', name: 'Living Room', state: '23.6', unit: 'C' },
    { entityId: 'sensor.demo_bedroom_temperature', name: 'Bedroom', state: '22.4', unit: 'C' },
  ],
  currentUser: { id: 'fixture-owner', name: 'Alex', isOwner: true, isAdmin: true },
};

export function integrationDocument() {
  const raw = draftDocument('w2-i-fixture');
  const formula: Operand = { type: 'math', op: 'add', args: [{ type: 'literal', value: 2 }, { type: 'literal', value: 3 }] };
  const check = { type: 'state', sourceId: 'source-a', path: ['state'], in: ['open'] };
  const call = { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: { type: 'literal', value: 'light.example' } }, data: { type: 'object', fields: { brightness: formula } }, feedback: 'policy' };
  const icon = compositionSymbol();
  const document = compileCompositionDocument({
    ...raw,
    name: 'Flows integration',
    dataSources: raw.dataSources.map((source, index) => ({ ...source, entityId: { type: 'literal', value: integrationSnapshot.states[index].entityId } })),
    logicLibrary: [
      { ...raw.logicLibrary[0], name: 'Room words', params: [{ name: 'source', label: 'Entity', kind: 'source-id', sample: 'source-a' }] },
      { id: 'samples', name: 'Sample settings', kind: 'operand', params: [{ name: 'test', kind: 'condition', sample: check }, { name: 'value', kind: 'operand', sample: formula }], body: formula },
    ],
    pages: [{
      ...raw.pages[0],
      components: [
        { ...raw.pages[0].components[0], title: 'First room' },
        { ...raw.pages[0].components[1], title: 'Second room' },
        { ...tile('inline', 'source-a'), title: 'One check', visibleWhen: check, whenUnknown: 'show' },
        { ...tile('summary', 'source-a'), title: 'Multiple checks', visibleWhen: { type: 'all', of: [check, { type: 'viewer', isAdmin: true }] }, whenUnknown: 'show' },
        { id: 'bound', type: 'bound-control', title: 'Editable choices', layout: { span: 1 }, icon, props: { kind: 'choice', unavailableText: 'Not available', options: [
          { id: 'option', label: 'Option', selectedWhen: check, action: call }, { id: 'other', label: 'Other', selectedWhen: { type: 'not', of: check }, action: call },
        ] } },
        { id: 'standalone', type: 'row', title: 'Standalone text', layout: { span: 1 }, props: { primary: { type: 'expr', value: { type: 'format', pattern: '{value}', args: { value: formula } } }, secondary: { type: 'literal', value: '' }, value: { type: 'literal', value: '' }, accessory: 'none', loadingText: 'Loading', unavailableText: 'Not available' } },
        { id: 'dial', type: 'dial-control', title: 'Editable dial', layout: { span: 1 }, props: {
          range: { min: 0, max: 30, step: 1 }, size: 'compact',
          stoppers: [{ id: 'heat', value: formula, label: { type: 'literal', value: 'Heat' }, ink: { type: 'solid-rgb', red: 20, green: 90, blue: 180 } }],
          center: { value: { shows: 'heat', fractionDigits: 0, unit: 'C' } }, unavailableText: 'Not available', failureText: 'Not sent',
        }, action: { ...call, data: { type: 'object', fields: { temperature: { type: 'control', stopper: 'heat' } } } }, a11y: { label: { type: 'literal', value: 'Temperature' } } },
        { id: 'progress', type: 'state-tile', title: 'Editable progress', layout: { span: 1 }, icon, binding: { entityId: 'switch.example', builtIn: 'switch' },
          props: { progress: formula, discs: [{ id: 'button', icon, label: { type: 'expr', value: { type: 'format', pattern: '{value}', args: { value: formula } } }, action: call }] } },
        { id: 'slider', type: 'bound-control', title: 'Editable value', layout: { span: 1 }, props: { kind: 'stepper', value: formula, range: { min: 0, max: 100, step: 1 }, unavailableText: 'Not available' }, action: call },
        { id: 'toggle', type: 'bound-control', title: 'Editable toggle', layout: { span: 1 }, props: { kind: 'toggle', isOn: check, unavailableText: 'Not available' }, onAction: call, offAction: call },
      ],
    }],
  }).document;
  const made = newFlow(document, 'none', { title: 'Existing formula' });
  const withFormula = updateFlow(made.document, made.id, inputs => ({ ...inputs, request: { type: 'none', value: formula } }));
  const rows = newFlow(withFormula, 'group', { title: 'Row output', entityIds: ['sensor.demo_living_room_temperature'] });
  return updateFlow(rows.document, rows.id, inputs => ({ ...inputs, output: { kind: 'rows', max: 50, row: { id: { type: 'item', path: ['entityId'] }, title: { type: 'format', pattern: '{value}', args: { value: formula } } } } }));
}
export const reroutedFields: readonly [string, LogicFieldKind, EditorPath][] = [
  ['selectedWhen', 'condition', ['pages', 0, 'components', 4, 'props', 'options', 0, 'selectedWhen']],
  ['isOn', 'condition', ['pages', 0, 'components', 9, 'props', 'isOn']],
  ['bound-control value', 'operand', ['pages', 0, 'components', 8, 'props', 'value']],
  ['service-data formula', 'operand', ['pages', 0, 'components', 8, 'action', 'data', 'fields', 'brightness']],
  ['dial value', 'operand', ['pages', 0, 'components', 6, 'props', 'stoppers', 0, 'value']],
  ['tile progress', 'operand', ['pages', 0, 'components', 7, 'props', 'progress']],
  ['button text', 'slot', ['pages', 0, 'components', 7, 'props', 'discs', 0, 'label']],
  ['request formula', 'operand', ['dataSources', 2, 'inputs', 'request', 'value']],
  ['output formula', 'operand', ['dataSources', 3, 'inputs', 'output', 'row', 'title']],
  ['template body', 'operand', ['logicLibrary', 0, 'body']],
  ['template condition setting', 'condition', ['logicLibrary', 1, 'params', 0, 'sample']],
  ['template operand setting', 'operand', ['logicLibrary', 1, 'params', 1, 'sample']],
];
