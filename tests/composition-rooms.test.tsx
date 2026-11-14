// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import CompositionFields from '../src/CompositionFields';
import { componentLocations, compositionEditorSchema, fieldVariants, moveCompositionNode, resolveField, valueAt, type EditorPath, type SchemaField } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import { createCompositionDocument } from '../src/shared/composition/workspace';
import { CompositionValidationError } from '../src/shared/composition/json';
import type { Json } from '../src/shared/types';

afterEach(cleanup);

function fixture(): CompositionDocument {
  const document = createCompositionDocument('demo-rooms'), pageId = document.pages[0].id, icon = document.pages[0].icon;
  document.dataSources = [
    { id: 'source-state', kind: 'ha-entity', entityId: { type: 'literal', value: 'switch.demo_room' } },
    { id: 'source-visible', kind: 'ha-entity', entityId: { type: 'literal', value: 'input_boolean.demo_visible' } },
    { id: 'source-power', kind: 'model', model: 'power-toggle@1', inputs: { entityId: { type: 'literal', value: 'switch.demo_room' } } },
    { id: 'source-rooms', kind: 'model', model: 'room-navigation@1', ranking: 'visits-descending-configured-ties@1',
      visitScriptEntityId: { type: 'literal', value: 'script.demo_visit' }, items: [
        { id: 'room-a', title: 'Demo A', icon, fill: { type: 'solid-rgb', red: 20, green: 60, blue: 100 },
          counterEntityId: { type: 'literal', value: 'counter.demo_a' }, visitKey: 'demo-a',
          visibility: { sourceId: 'source-visible', states: ['on'] }, bodyHint: 'Opens Demo A',
          action: { type: 'dismiss-then-push', destination: { type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } } },
      ] },
  ];
  const card: CompositionNode = {
    id: 'demo-card', title: 'Demo device', type: 'room-card', layout: { span: 1 }, icon,
    binding: { sourceId: 'source-state', projection: 'room-state@1' },
    props: { kind: 'power', showState: true, subtitleSourceIds: [], activeStates: ['on'], disabledStates: ['locked'],
      stateLabels: [{ state: 'on', label: 'Running' }], visibility: { sourceId: 'source-visible', states: ['on'] },
      action: { type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
      power: { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } } },
  };
  document.pages[0].components = [
    { id: 'demo-section', title: 'Devices', type: 'room-section', layout: { span: 1 },
      props: { arrangement: 'lead-row', leadJoinsAtRegularWidth: false }, children: [card,
        { ...card, id: 'demo-chip', type: 'room-chip', props: {
          kind: 'occupancy', showState: true, subtitleSourceIds: [], activeStates: [], disabledStates: [], stateLabels: [],
        } }] },
    { id: 'demo-navigation', title: 'Rooms', type: 'room-navigation-grid', layout: { span: 1 },
      binding: { sourceId: 'source-rooms', projection: 'room-navigation@1' }, props: {} },
  ];
  return document;
}

function form(document: CompositionDocument, schema: SchemaField, path: EditorPath) {
  let current = document;
  const fields = () => <CompositionFields schema={schema} value={valueAt(current, path) as Json}
    document={current} path={path} label="Configured room"
    onChange={next => { current = next; rendered.rerender(fields()); }}
    onError={message => { throw Error(message); }}/>;
  const rendered = render(fields());
  return () => current;
}

it('compiles exact room capability closure, targets, labels, separate body/disc and dismissal intent', () => {
  const { document, capabilities } = compileCompositionDocument(fixture());
  expect(capabilities).toEqual([
    'sh.actions.navigation@1', 'sh.backdrop@1', 'sh.bindings@1', 'sh.chrome@1', 'sh.composition@1',
    'sh.grid@1', 'sh.page@1', 'sh.power-toggle@1', 'sh.room-card@1', 'sh.room-chip@1',
    'sh.room-navigation@1', 'sh.room-section@1', 'sh.room-visibility@1', 'sh.shell@1', 'sh.symbols@1', 'sh.tiles@1',
  ]);
  expect(document.dataSources[3]).toMatchObject({ model: 'room-navigation@1', ranking: 'visits-descending-configured-ties@1',
    items: [{ visitKey: 'demo-a', action: { type: 'dismiss-then-push' } }] });
  expect(componentLocations(document).map(item => item.node.id)).toEqual(['demo-section', 'demo-card', 'demo-chip', 'demo-navigation']);
});

it('permits canonical room chips in rails without accepting arbitrary cards or unknown auxiliary sources', () => {
  const document = fixture();
  const section = document.pages[0].components[0];
  if (section.type !== 'room-section' || section.children[1].type !== 'room-chip') throw new Error('fixture');
  const chip = section.children[1];
  chip.props.chipSources = { homeAwaySourceId: 'source-state', awaySourceIds: ['source-visible'], pluralContacts: true };
  const rail: Extract<CompositionNode, { type: 'status-rail' }> = {
    id: 'rail', type: 'status-rail', title: 'Overview', layout: { span: 1 }, props: {}, children: [chip],
  };
  section.children.splice(1, 1, rail);
  expect(compileCompositionDocument(document).capabilities).toContain('sh.status-rail@1');
  chip.props.chipSources.homeAwaySourceId = 'absent-source';
  expect(() => compileCompositionDocument(document)).toThrow();
  chip.props.chipSources.homeAwaySourceId = 'source-state';
  rail.children[0] = { ...chip, type: 'room-card' };
  expect(() => compileCompositionDocument(document)).toThrow();
});

it.each([
  ['wrong visit target', (document: CompositionDocument) => {
    const source = document.dataSources[3];
    if (source.kind === 'model' && source.model === 'room-navigation@1') source.visitScriptEntityId!.value = 'switch.demo_wrong';
  }, '/document/dataSources/3/visitScriptEntityId/value'],
  ['missing counter', (document: CompositionDocument) => {
    const source = document.dataSources[3];
    if (source.kind === 'model' && source.model === 'room-navigation@1') delete source.items[0].counterEntityId;
  }, '/document/dataSources/3/items/0/counterEntityId'],
  ['missing visit key', (document: CompositionDocument) => {
    const source = document.dataSources[3];
    if (source.kind === 'model' && source.model === 'room-navigation@1') delete source.items[0].visitKey;
  }, '/document/dataSources/3/items/0/visitKey'],
  ['wrong state provider', (document: CompositionDocument) => {
    const section = document.pages[0].components[0];
    if (section.type === 'room-section' && section.children[0].type === 'room-card') section.children[0].binding.sourceId = 'source-rooms';
  }, '/document/pages/0/components/0/children/0/binding/sourceId'],
  ['ambiguous state labels', (document: CompositionDocument) => {
    const section = document.pages[0].components[0];
    if (section.type === 'room-section' && section.children[0].type === 'room-card') section.children[0].props.stateLabels.push({ state: 'on', label: 'Different' });
  }, '/document/pages/0/components/0/children/0/props/stateLabels/1/state'],
] as const)('rejects %s instead of publishing a placeholder', (_name, mutate, pointer) => {
  const document = fixture();
  mutate(document);
  try { compileCompositionDocument(document); throw Error('Expected rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(CompositionValidationError);
    expect((error as CompositionValidationError).issues).toContainEqual(expect.objectContaining({ pointer }));
  }
});

it('authors navigation ranking, visit intent, counter and live visibility with generated controls', () => {
  const document = fixture(), schema = resolveField(compositionEditorSchema.properties!.dataSources);
  if (!schema.items || Array.isArray(schema.items)) throw Error('Expected source items');
  const current = form(document, schema.items, ['dataSources', 3]);
  fireEvent.change(screen.getByLabelText('Ranking'), { target: { value: 'configured' } });
  fireEvent.change(within(screen.getByRole('group', { name: 'Visit Script Entity Id' })).getByLabelText('Value'),
    { target: { value: 'script.demo_other_visit' } });
  fireEvent.change(screen.getByLabelText('Visit Key'), { target: { value: 'demo-b' } });
  fireEvent.change(within(screen.getByRole('group', { name: 'Counter Entity Id' })).getByLabelText('Value'),
    { target: { value: 'counter.demo_b' } });
  fireEvent.change(screen.getByLabelText('Source Id'), { target: { value: 'source-state' } });
  const result = compileCompositionDocument(current());
  expect(result.document.dataSources[3]).toMatchObject({ ranking: 'configured',
    visitScriptEntityId: { value: 'script.demo_other_visit' }, items: [{ visitKey: 'demo-b',
      counterEntityId: { value: 'counter.demo_b' }, visibility: { sourceId: 'source-state' } }] });
});

it('authors room section arrangement and moves retained nodes between section parents', () => {
  const document = fixture();
  const nodes = compositionEditorSchema.definitions!.__schema0;
  const section = fieldVariants(nodes).find(variant => variant.properties?.type?.const === 'room-section')!;
  const current = form(document, section.properties!.props, ['pages', 0, 'components', 0, 'props']);
  fireEvent.change(screen.getByLabelText('Arrangement'), { target: { value: 'two-column-fill' } });
  fireEvent.click(screen.getByLabelText('Lead Joins At Regular Width'));
  const moved = moveCompositionNode(current(), 'demo-navigation', { kind: 'grid', id: 'demo-section' });
  const result = compileCompositionDocument(moved);
  expect(result.document.pages[0].components[0]).toMatchObject({ props: { arrangement: 'two-column-fill', leadJoinsAtRegularWidth: true },
    children: [{ id: 'demo-card' }, { id: 'demo-chip' }, { id: 'demo-navigation' }] });
});

it('keeps app launch an explicit sibling capability gap', () => {
  const document = fixture();
  const input = { ...document, pages: [{ ...document.pages[0], components: [
    { id: 'demo-apps', title: 'Apps', type: 'room-app-launch', layout: { span: 1 }, props: {} },
  ] }] };
  try { compileCompositionDocument(input); throw Error('Expected capability rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(CompositionValidationError);
    expect((error as CompositionValidationError).issues).toContainEqual({
      code: 'unsupported_capability', pointer: '/document/pages/0/components/0', capability: 'sh.room-app-launch@1',
    });
  }
});
