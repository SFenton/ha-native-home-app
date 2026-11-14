// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import baseline from './fixtures/composition-first-slice.json';
import camera from './fixtures/camera-composition.json';
import { compileCompositionDocument, supportedCompositionCapabilities } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { compositionEditorSchema, fieldVariants, replaceAt, resolveField, valueAt, type EditorPath, type SchemaField } from '../src/composition-editor';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { Json } from '../src/shared/types';
import CompositionFields from '../src/CompositionFields';

afterEach(cleanup);

function fixture() {
  let document = structuredClone(baseline.document);
  document = replaceAt(document, ['dataSources'], [...document.dataSources, camera.source]);
  document = replaceAt(document, ['pages', 0, 'components'], [...document.pages[0].components, camera.tile]);
  document = replaceAt(document, ['modals', 0, 'components'], [camera.viewer]);
  document = replaceAt(document, ['modals', 0, 'presentation', 'width'], 'page');
  document = replaceAt(document, ['modals', 0, 'presentation', 'appearance'], 'dark');
  return compileCompositionDocument(document).document;
}

it('compiles exact camera capability closure without altering the frozen first slice', () => {
  const { document, capabilities } = compileCompositionDocument(fixture());
  expect(capabilities).toEqual([...baseline.capabilities, 'sh.camera-stream@1', 'sh.camera-tile@1',
    'sh.camera-video@1', 'sh.camera-controls@1', 'sh.camera-viewer@1'].sort());
  expect(capabilities.every(item => supportedCompositionCapabilities.includes(item))).toBe(true);
  expect(document.dataSources.at(-1)).toEqual(camera.source);
  expect(document.modals[0].components[0]).toEqual(camera.viewer);
  expect(compileCompositionDocument(baseline.document).capabilities).toEqual(baseline.capabilities);
});

it('resolves camera viewers inside initially hidden tabs and shared sections', () => {
  const document = fixture();
  document.localState = [{ id: 'camera-tab', type: 'choice', initial: 'details',
    options: [{ id: 'details', label: 'Details' }, { id: 'video', label: 'Video' }] }];
  const viewers = document.modals[0].components;
  document.modals[0].components = [{
    id: 'camera-section', title: 'Camera', type: 'section', layout: { span: 1 },
    props: { header: '', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } },
    children: [{
      id: 'camera-tabs', title: 'Camera tabs', type: 'local-tabs', layout: { span: 1 },
      props: { stateId: 'camera-tab', transition: 'canonical-swap@1' },
      tabs: [{ id: 'details', label: 'Details', children: [] }, { id: 'video', label: 'Video', children: viewers }],
    }],
  }];
  expect(compileCompositionDocument(document).document).toEqual(document);
});

it.each([
  [['dataSources', 2, 'inputs', 'entityId', 'value'], 'switch.demo_entry', 'invalid_combination'],
  [['dataSources', 2, 'inputs', 'snapshotEntityId', 'value'], 'camera.demo_still\n', 'invalid_value'],
  [['dataSources', 2, 'inputs', 'rtcStreamId'], 'https://example.invalid/stream', 'invalid_value'],
  [['dataSources', 2, 'inputs', 'aspectRatio'], 0, 'limit_exceeded'],
  [['dataSources', 2, 'inputs', 'recording', 'scriptEntityId', 'value'], 'light.demo_record', 'invalid_combination'],
  [['dataSources', 2, 'labels', 'hidden'], ' ', 'invalid_value'],
  [['modals', 0, 'components', 0, 'props', 'sourceId'], 'source-power', 'binding_type'],
  [['modals', 0, 'components', 0, 'props', 'controls', 1, 'intent'], 'snapshot', 'invalid_combination'],
  [['modals', 0, 'components', 0, 'props', 'controls', 0, 'tint'], 'arbitrary-color', 'unknown_variant'],
  [['modals', 0, 'presentation', 'width'], 'form', 'invalid_combination'],
  [['modals', 0, 'presentation', 'appearance'], 'system', 'invalid_combination'],
] satisfies [EditorPath, Json, string][])('rejects invalid camera contracts at %j', (path, replacement, code) => {
  try { compileCompositionDocument(replaceAt(fixture(), path, replacement)); throw Error('Expected rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(CompositionValidationError);
    if (!(error instanceof CompositionValidationError)) throw error;
    expect(error.issues).toContainEqual({ code, pointer: `/document/${path.join('/')}` });
  }
});

it('rejects record controls without recording support, conflicting pooled identities, unknown fields and mismatched viewers', () => {
  const document = fixture();
  for (const [path, replacement] of [
    [['dataSources', 2, 'inputs', 'recording'], { type: 'disabled' }],
    [['dataSources'], [...document.dataSources, { ...camera.source, id: 'conflicting-source' }]],
    [['dataSources', 2, 'inputs', 'url'], 'https://example.invalid/private'],
    [['modals', 0, 'components'], []],
  ] satisfies [EditorPath, Json][]) {
    expect(() => compileCompositionDocument(replaceAt(document, path, replacement))).toThrow(CompositionValidationError);
  }
});

function fields(document: CompositionDocument, schema: SchemaField, path: EditorPath) {
  let current = document;
  const form = () => <CompositionFields schema={schema} value={valueAt(current, path) as Json}
    document={current} path={path} label="Camera configuration"
    onChange={next => { current = next; rendered.rerender(form()); }} onError={message => { throw Error(message); }}/>;
  const rendered = render(form());
  return () => current;
}

it('authors native camera targets, privacy/permission copy and recording through structured fields', () => {
  const sourceSchema = resolveField(compositionEditorSchema.properties!.dataSources);
  if (!sourceSchema.items || Array.isArray(sourceSchema.items)) throw Error('Expected source items');
  const current = fields(fixture(), sourceSchema.items, ['dataSources', 2]);
  expect(within(screen.getByLabelText('Camera configuration type')).getByRole<HTMLOptionElement>('option', { name: 'camera-stream@1' }).selected).toBe(true);
  fireEvent.change(screen.getByLabelText('Rtc Stream Id'), { target: { value: 'demo_side' } });
  fireEvent.change(within(screen.getByRole('group', { name: 'Snapshot Entity Id' })).getByLabelText('Value'),
    { target: { value: 'camera.demo_side' } });
  fireEvent.change(screen.getByLabelText('Hidden'), { target: { value: 'Camera hidden for privacy' } });
  fireEvent.change(screen.getByLabelText('Photos Message'), { target: { value: 'Allow photo additions in Settings to save a snapshot.' } });
  fireEvent.change(within(screen.getByRole('group', { name: 'Script Entity Id' })).getByLabelText('Value'),
    { target: { value: 'script.demo_side_record' } });
  expect(compileCompositionDocument(current()).document.dataSources.at(-1)).toMatchObject({
    inputs: { rtcStreamId: 'demo_side', snapshotEntityId: { value: 'camera.demo_side' },
      recording: { scriptEntityId: { value: 'script.demo_side_record' } } },
    labels: { hidden: 'Camera hidden for privacy' },
  });
});

it('authors control order, labels, symbols and source selection without raw JSON', () => {
  const nodes = compositionEditorSchema.definitions!.__schema0;
  const schema = fieldVariants(nodes).find(variant => variant.properties?.type?.const === 'camera-viewer')!;
  const current = fields(fixture(), schema, ['modals', 0, 'components', 0]);
  expect(screen.getByLabelText('Source Id').tagName).toBe('SELECT');
  fireEvent.change(within(screen.getByRole('group', { name: 'Snapshot' })).getByLabelText('Active Title'),
    { target: { value: 'Photo saved' } });
  fireEvent.change(within(screen.getByRole('group', { name: 'Snapshot' })).getByLabelText('Tint'),
    { target: { value: 'danger' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move Record up' }));
  const result = compileCompositionDocument(current()).document.modals[0].components[0];
  if (result.type !== 'camera-viewer') throw Error('Expected camera viewer');
  expect(result.props.controls.map(control => control.intent)).toEqual(['snapshot', 'record', 'sound']);
  expect(result.props.controls[0].activeTitle).toBe('Photo saved');
  expect(result.props.controls[0].tint).toBe('danger');
});
