// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import CompositionFields from '../src/CompositionFields';
import { compositionEditorSchema, fieldVariants, resolveField, valueAt, type EditorPath, type SchemaField, nodeDefinition } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import { createCompositionDocument } from '../src/shared/composition/workspace';
import type { Json } from '../src/shared/types';

afterEach(cleanup);

function fields(document: CompositionDocument, schema: SchemaField, path: EditorPath) {
  let current = document;
  const form = () => <CompositionFields schema={schema} value={valueAt(current, path) as Json}
    document={current} path={path} label="Configured source"
    onChange={next => { current = next; rendered.rerender(form()); }}
    onError={message => { throw Error(message); }}/>;
  const rendered = render(form());
  return () => current;
}

it('edits sprinkler entities and thresholds using generated structured controls', () => {
  const document = createCompositionDocument('demo-document');
  const literal = (value: string) => ({ type: 'literal' as const, value });
  document.dataSources = [{ id: 'irrigation', kind: 'model', model: 'sprinkler-state@1', inputs: {
    title: 'Controller', lowBatteryPercent: 20,
    stateEntityId: literal('sensor.demo_state'), modeEntityId: literal('select.demo_mode'),
    batteryEntityId: literal('sensor.demo_battery'), faultEntityId: literal('binary_sensor.demo_fault'),
    nextWateringEntityId: literal('sensor.demo_next'), hubConnectedEntityId: literal('binary_sensor.demo_hub'),
    rainDelayEntityId: literal('switch.demo_rain'), smartWateringEntityId: literal('switch.demo_smart'),
    zones: [{ valveEntityId: literal('valve.demo_zone'), programEntityId: literal('switch.demo_program'),
      historyEntityId: literal('sensor.demo_history') }],
  } }];
  const schema = resolveField(compositionEditorSchema.properties!.dataSources);
  if (!schema.items || Array.isArray(schema.items)) throw Error('Expected source items');
  const current = fields(document, schema.items, ['dataSources', 0]);
  fireEvent.change(screen.getByLabelText('Low Battery Percent'), { target: { value: '30' } });
  fireEvent.change(within(screen.getByRole('group', { name: 'Valve Entity Id' })).getByLabelText('Value'),
    { target: { value: 'valve.demo_second' } });
  const result = compileCompositionDocument(current());
  expect(result.capabilities).toContain('sh.sprinkler-state@1');
  expect(result.document.dataSources[0]).toMatchObject({
    inputs: { lowBatteryPercent: 30, zones: [{ valveEntityId: { value: 'valve.demo_second' } }] },
  });
});

it('authors an independent inventory list space through structured source fields', () => {
  const document = createCompositionDocument('demo-document');
  document.dataSources = [{ id: 'demo-source', kind: 'model', model: 'alarm-mode@1',
    inputs: { entityId: { type: 'literal', value: 'alarm_control_panel.demo_unit' } } }];
  const schema = resolveField(compositionEditorSchema.properties!.dataSources);
  if (!schema.items || Array.isArray(schema.items)) throw Error('Expected source items');
  const current = fields(document, schema.items, ['dataSources', 0]);
  const selector = screen.getByLabelText('Configured source type');
  const list = within(selector).getByRole<HTMLOptionElement>('option', { name: 'inventory-list@1' });
  fireEvent.change(selector, { target: { value: list.value } });
  fireEvent.change(screen.getByLabelText('Space'), { target: { value: 'fridge' } });
  const result = compileCompositionDocument(current());
  expect(result.capabilities).toContain('sh.inventory-list@1');
  expect(result.document.dataSources[0]).toEqual({
    id: 'demo-source', kind: 'model', model: 'inventory-list@1', inputs: { space: 'fridge' },
  });
});

it('authors inventory targets and copy using the existing schema-derived inspector, without JSON', () => {
  const document = createCompositionDocument('demo-document');
  document.dataSources = [{ id: 'demo-source', kind: 'model', model: 'alarm-mode@1',
    inputs: { entityId: { type: 'literal', value: 'alarm_control_panel.demo_unit' } } }];
  const schema = resolveField(compositionEditorSchema.properties!.dataSources);
  if (!schema.items || Array.isArray(schema.items)) throw Error('Expected source items');
  const current = fields(document, schema.items, ['dataSources', 0]);
  const selector = screen.getByLabelText('Configured source type');
  expect(within(selector).getByRole<HTMLOptionElement>('option', { name: 'alarm-mode@1' }).selected).toBe(true);
  const summary = within(selector).getByRole<HTMLOptionElement>('option', { name: 'inventory-summary@1' });
  fireEvent.change(selector, { target: { value: summary.value } });
  fireEvent.change(within(screen.getByRole('group', { name: 'Total Entity Id' })).getByLabelText('Value'),
    { target: { value: 'sensor.demo_total' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include Expiring Entity Id' }));
  fireEvent.change(within(screen.getByRole('group', { name: 'Expiring Entity Id' })).getByLabelText('Value'),
    { target: { value: 'sensor.demo_expiry' } });
  fireEvent.change(within(screen.getByRole('group', { name: 'Space Entity Ids (1)' })).getByLabelText('Value'),
    { target: { value: 'sensor.demo_space' } });
  for (const [label, value] of [['Singular', 'Unit'], ['Plural', 'Units'], ['Expiring Suffix', 'Due'],
    ['Separator', ' / '], ['Loading Text', 'Reading'], ['Unavailable Text', 'No stock data']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  const result = compileCompositionDocument(current());
  expect(result.capabilities).toContain('sh.inventory-summary@1');
  expect(result.document.dataSources[0]).toMatchObject({
    id: 'demo-source', model: 'inventory-summary@1', labels: { singular: 'Unit', separator: ' / ' },
    inputs: { totalEntityId: { value: 'sensor.demo_total' }, spaceEntityIds: [{ value: 'sensor.demo_space' }] },
  });
});

it('authors alarm source selection, state appearance and all status copy through structured fields', () => {
  const document = createCompositionDocument('demo-document'), icon = document.pages[0].icon;
  document.dataSources = ['demo-panel-a', 'demo-panel-b'].map(id => ({
    id, kind: 'model', model: 'alarm-mode@1', inputs: { entityId: { type: 'literal', value: `alarm_control_panel.${id.replaceAll('-', '_')}` } },
  }));
  const tile: CompositionNode = {
    id: 'demo-navigation', title: 'Panel', type: 'navigation-tile', icon, layout: { span: 1 },
    props: { family: 'neutral', selected: 'none', subtitle: { type: 'literal', value: '' }, alarm: {
      sourceId: 'demo-panel-a', projection: 'alarm-navigation@1', states: [],
      fallback: { icon, fill: { type: 'solid-rgb', red: 84, green: 110, blue: 122 }, text: 'Panel' },
      loadingText: 'Reading', unavailableText: 'No panel data', errorText: 'No response', hiddenText: 'Private',
    } },
    action: { type: 'push', pageId: document.pages[0].id, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
  };
  document.pages[0].components = [tile];
  const nodes = nodeDefinition();
  const navigation = fieldVariants(nodes).find(variant => variant.properties?.type?.const === 'navigation-tile')!;
  const alarm = resolveField(navigation.properties!.props).properties!.alarm;
  const current = fields(document, alarm, ['pages', 0, 'components', 0, 'props', 'alarm']);
  expect(screen.getByLabelText('Source Id').tagName).toBe('SELECT');
  fireEvent.change(screen.getByLabelText('Source Id'), { target: { value: 'demo-panel-b' } });
  fireEvent.change(within(screen.getByRole('group', { name: 'Fallback' })).getByLabelText('Red'), { target: { value: '42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add states item' }));
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'armed_home' } });
  fireEvent.change(within(screen.getByRole('group', { name: 'Appearance' })).getByLabelText('Text'), { target: { value: 'Guarding' } });
  for (const [label, value] of [['Loading Text', 'Connecting'], ['Unavailable Text', 'Offline'],
    ['Error Text', 'Call rejected'], ['Hidden Text', 'Redacted']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  const result = compileCompositionDocument(current());
  expect(result.capabilities).toContain('sh.alarm-mode@1');
  const authored = result.document.pages[0].components[0];
  if (authored.type !== 'navigation-tile') throw Error('Expected navigation tile');
  expect(authored.props.alarm).toMatchObject({
    sourceId: 'demo-panel-b', fallback: { fill: { red: 42 } }, hiddenText: 'Redacted',
    states: [{ state: 'armed_home', appearance: { text: 'Guarding' } }],
  });
});
