// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CompositionFields from '../src/CompositionFields';
import { compositionEditorSchema, fieldVariants, resolveField, valueAt, type SchemaField, type EditorPath, nodeDefinition } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { Json } from '../src/shared/types';
import type { VacuumPrimitive } from '../src/shared/composition/vacuum';
import { vacuumDocument, vacuumIcon, vacuumNode } from './fixtures/vacuum';

afterEach(cleanup);
function fields(document: CompositionDocument, schema: SchemaField, path: EditorPath) {
  let current = document;
  const form = () => <CompositionFields schema={schema} value={valueAt(current, path) as Json}
    document={current} path={path} label="Vacuum"
    onChange={next => { current = next; rendered.rerender(form()); }} onError={message => { throw Error(message); }}/>;
  const rendered = render(form());
  return () => current;
}
describe('configured atomic vacuums', () => {
  it('requires an explicit automatic-cleaning target and validates pause inversion domain', () => {
    const document = vacuumDocument({ kind: 'auto-clean' });
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    const source = document.dataSources[0];
    if (source.kind !== 'model' || source.model !== 'vacuum@1') throw Error('Expected vacuum source');
    source.inputs.autoCleanControl = { title: 'Demo', entityId: 'switch.demo_pause', kind: 'pause' };
    expect(compileCompositionDocument(document).capabilities).toContain('sh.vacuum-auto-clean@1');
    source.inputs.autoCleanControl.entityId = 'automation.demo_wrong';
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
  });
  it('compiles atomic controls, authored ordering, transforms, attachments and exact narrow capability closure', () => {
    const document = vacuumDocument();
    const destination = { type: 'push', pageId: document.pages[0].id, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } as const;
    const primitives: VacuumPrimitive[] = [
      { kind: 'card', icon: vacuumIcon, commands: ['start_pause', 'dock'], destination },
      { kind: 'map', overlay: 'autoClean', height: 300, runtimeHeight: 460, label: 'Demo map', loadingText: 'Reading', unavailableText: 'Offline', locate: false },
      { kind: 'settings', rows: [{ role: 'passes', title: 'Repeats', hint: 'Select repeats' }, { role: 'mode', title: 'Mode', hint: 'Select mode' }] },
      { kind: 'command', command: 'clean', icon: vacuumIcon },
      { kind: 'choice', selection: 'rooms', entityId: 'input_boolean.demo_room' },
      { kind: 'choice', selection: 'autoClean', entityId: 'switch.demo_room_skip' },
      { kind: 'consumable', entityId: 'sensor.demo_brush' },
      { kind: 'target', mode: 'area', icon: vacuumIcon, destination }, { kind: 'clear-area', icon: vacuumIcon },
      { kind: 'notices' }, { kind: 'report', destination }, { kind: 'outcomes' },
      { kind: 'area-editor', height: 650, onUse: { type: 'back' }, discardLabel: 'Discard', onDiscard: { type: 'back' } },
    ];
    document.pages[0].components.push(...primitives.map((p, i) => vacuumNode(p, `control-${i}`)));
    const compiled = compileCompositionDocument(document);
    for (const capability of ['sh.vacuum@1', 'sh.vacuum-map@1', 'sh.vacuum-controls@1', 'sh.vacuum-outcomes@1', 'sh.vacuum-area@1'])
      expect(compiled.capabilities).toContain(capability);
    expect(compiled.document).toEqual(document);
    expect(compileCompositionDocument(vacuumDocument()).capabilities.filter(c => c.startsWith('sh.vacuum'))).toEqual(['sh.vacuum-controls@1', 'sh.vacuum@1']);
  });
  it('rejects wrong domains, room membership, unknown fields, duplicate roles and wrong source types', () => {
    const document = vacuumDocument({ kind: 'choice', selection: 'rooms', entityId: 'input_boolean.demo_not_assigned' });
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    document.pages[0].components = [vacuumNode({ kind: 'settings', rows: [
      { role: 'mode', title: 'A', hint: 'A' }, { role: 'mode', title: 'B', hint: 'B' },
    ] })];
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    document.pages[0].components = [vacuumNode({ kind: 'status', metric: 'battery' })];
    document.dataSources = [{ id: 'source-robot', kind: 'model', model: 'power-toggle@1', inputs: { entityId: { type: 'literal', value: 'switch.demo_unit' } } }];
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    const source = vacuumDocument().dataSources[0];
    if (source.kind !== 'model' || source.model !== 'vacuum@1') throw Error('Expected vacuum source');
    source.inputs.entityId = 'switch.demo_unit';
    document.dataSources = [source];
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    expect(() => compileCompositionDocument({ ...vacuumDocument(), dispatchPage: 'vacuum-sheet' })).toThrow(CompositionValidationError);
  });
  it('authors target, map transform and room titles in the generated inspector without raw JSON', () => {
    const document = vacuumDocument(), schema = resolveField(compositionEditorSchema.properties!.dataSources);
    if (!schema.items || Array.isArray(schema.items)) throw Error('Expected source items');
    const current = fields(document, schema.items, ['dataSources', 0]);
    fireEvent.change(screen.getAllByLabelText('Entity Id')[0], { target: { value: 'vacuum.demo_renamed' } });
    fireEvent.change(screen.getByLabelText('Map Rotation Degrees'), { target: { value: '-90' } });
    fireEvent.change(screen.getByLabelText('Map Scale'), { target: { value: '1.2' } });
    fireEvent.change(within(screen.getByRole('group', { name: 'Zones (1)' })).getByLabelText('Title'), { target: { value: 'Renamed Room' } });
    const result = compileCompositionDocument(current());
    expect(result.document.dataSources[0]).toMatchObject({ inputs: { entityId: 'vacuum.demo_renamed', mapRotationDegrees: -90, mapScale: 1.2,
      zones: [{ title: 'Renamed Room' }] } });
  });
  it('offers every atomic vacuum variant through structured primitive controls', () => {
    const document = vacuumDocument();
    const nodes = nodeDefinition();
    const node = fieldVariants(nodes).find(v => v.properties?.type?.const === 'vacuum-control')!;
    const primitive = resolveField(node.properties!.props).properties!.primitive;
    const current = fields(document, primitive, ['pages', 0, 'components', 0, 'props', 'primitive']);
    const selector = screen.getByLabelText('Vacuum type');
    for (const kind of ['card', 'map', 'settings', 'command', 'choice', 'consumable', 'report', 'outcomes', 'target', 'area-editor'])
      expect(within(selector).getByRole('option', { name: kind })).toBeTruthy();
    const option = within(selector).getByRole<HTMLOptionElement>('option', { name: 'map' });
    fireEvent.change(selector, { target: { value: option.value } });
    fireEvent.change(screen.getByLabelText('Runtime Height'), { target: { value: '460' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Configured map' } });
    expect(valueAt(current(), ['pages', 0, 'components', 0, 'props', 'primitive'])).toMatchObject({ kind: 'map', runtimeHeight: 460, label: 'Configured map' });
  });
});
