// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import CompositionFields from '../src/CompositionFields';
import { compositionEditorSchema, fieldVariants, resolveField, valueAt, type EditorPath, type SchemaField, nodeDefinition } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { Json } from '../src/shared/types';
import fixture from './fixtures/remote-composition.json';

afterEach(cleanup);
const document = () => compileCompositionDocument(structuredClone(fixture.document)).document;

function fields(schema: SchemaField, path: EditorPath) {
  let current = document();
  const form = () => <CompositionFields schema={schema} value={valueAt(current, path) as Json}
    document={current} path={path} label="Remote fields"
    onChange={next => { current = next; rendered.rerender(form()); }}
    onError={message => { throw Error(message); }}/>;
  const rendered = render(form());
  return () => current;
}

function atomSchema() {
  const nodes = nodeDefinition();
  return fieldVariants(nodes).find(variant => variant.properties?.type?.const === 'remote-control')!;
}

it('matches the native all-atom fixture and exact capability closure without widening the first slice', () => {
  const result = compileCompositionDocument(fixture.document);
  expect(result.capabilities).toEqual(fixture.capabilities);
  expect(result.document.pages[0].components).toHaveLength(11);
  expect(result.capabilities).not.toContain('sh.tiles@1');
  expect(result.capabilities).not.toContain('sh.power-toggle@1');
});

it('rejects binding remote atoms to an ordinary entity source', () => {
  const input = document();
  input.dataSources = [{ id: 'source-demo', kind: 'ha-entity', entityId: { type: 'literal', value: 'media_player.demo_unit' } }];
  try { compileCompositionDocument(input); throw Error('Expected rejection'); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    expect(error.issues).toContainEqual({ code: 'binding_type', pointer: '/document/pages/0/components/0/binding/sourceId' });
  }
});

it.each([
  [0, 'service', 'remote.send_command', 'unknown_field', 'service'],
  [7, 'options', [], 'invalid_combination', 'options'],
  [7, 'options', [{ value: 'game', label: 'Game' }, { value: 'game', label: 'Game' }], 'invalid_combination', 'options/1/value'],
  [10, 'action', { type: 'back' }, 'unknown_variant', 'action/type'],
] as const)('rejects invalid authored remote data (%s, %s)', (index, field, replacement, code, suffix) => {
  const input = structuredClone(fixture.document);
  Object.assign(input.pages[0].components[index].props, { [field]: replacement });
  try { compileCompositionDocument(input); throw Error('Expected rejection'); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    expect(error.issues).toContainEqual({
      code, pointer: `/document/pages/0/components/${index}/props/${suffix}`,
    });
  }
});

it('edits typed provider references rather than executable command fields', () => {
  const sources = resolveField(compositionEditorSchema.properties!.dataSources);
  if (!sources.items || Array.isArray(sources.items)) throw Error('Expected sources');
  const current = fields(sources.items, ['dataSources', 0]);
  fireEvent.change(screen.getByLabelText('Provider Id'), { target: { value: 'alternate-demo-provider' } });
  expect(compileCompositionDocument(current()).document.dataSources[0]).toMatchObject({
    model: 'media-remote@1', inputs: { providerId: 'alternate-demo-provider' },
  });
  expect(screen.queryByLabelText('Command')).toBeNull();
});

it('edits key geometry, glyphs and state copy with structured fields', () => {
  const props = resolveField(atomSchema().properties!.props);
  const current = fields(props, ['pages', 0, 'components', 0, 'props']);
  const keys = screen.getByRole('group', { name: 'Keys (4)' });
  fireEvent.click(within(keys).getByText('1. Power', { selector: 'summary' }));
  const power = within(keys).getByRole('group', { name: 'Power' });
  fireEvent.change(within(power).getByLabelText('Label'), { target: { value: 'Wake display' } });
  fireEvent.change(within(power).getByLabelText('Active Text'), { target: { value: 'Awake' } });
  fireEvent.change(within(power).getByLabelText('Rotation'), { target: { value: '30' } });
  const result = compileCompositionDocument(current());
  const node = result.document.pages[0].components[0];
  if (node.type !== 'remote-control' || node.props.kind !== 'keys') throw Error('Expected keys');
  expect(node.props.keys[0]).toMatchObject({ label: 'Wake display', rotation: 30, activeText: 'Awake' });
});

it('authors Hue option labels and order without hidden canonical mode ordering', () => {
  const current = fields(resolveField(atomSchema().properties!.props), ['pages', 0, 'components', 7, 'props']);
  const options = screen.getByRole('group', { name: 'Options (2)' });
  fireEvent.click(within(options).getByText('2. Video', { selector: 'summary' }));
  fireEvent.click(within(options).getByRole('button', { name: 'Move Video up' }));
  fireEvent.click(within(options).getByText('1. Video', { selector: 'summary' }));
  const video = within(options).getByRole('group', { name: 'Video' });
  fireEvent.change(within(video).getByLabelText('Label'), { target: { value: 'Cinema' } });
  const node = compileCompositionDocument(current()).document.pages[0].components[7];
  expect(node).toMatchObject({ props: { options: [{ value: 'video', label: 'Cinema' }, { value: 'game', label: 'Game' }] } });
});

it('exposes keyboard failure copy and media-card action order and volume attachment', () => {
  const props = resolveField(atomSchema().properties!.props);
  const keyboard = fields(props, ['pages', 0, 'components', 3, 'props']);
  fireEvent.change(screen.getByLabelText('Error Text'), { target: { value: 'Keep this draft and retry' } });
  expect(compileCompositionDocument(keyboard()).document.pages[0].components[3]).toMatchObject({
    props: { errorText: 'Keep this draft and retry' },
  });
  cleanup();
  const card = fields(props, ['pages', 0, 'components', 10, 'props']);
  fireEvent.click(screen.getByLabelText('Shows Volume'));
  fireEvent.click(screen.getByText('5. Next', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move Next up' }));
  expect(compileCompositionDocument(card()).document.pages[0].components[10]).toMatchObject({
    props: { showsVolume: false, actions: [{ slot: 'power' }, { slot: 'previous' }, { slot: 'pause' }, { slot: 'next' }, { slot: 'play' }] },
  });
});
