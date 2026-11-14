// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import CompositionFields from '../src/CompositionFields';
import { compositionEditorSchema, fieldVariants, resolveField, valueAt, type SchemaField } from '../src/composition-editor';
import { compileCompositionDocument, firstSliceCapabilities } from '../src/shared/composition/compiler';
import { securityExample } from '../src/shared/composition/security-example';
import { CompositionValidationError } from '../src/shared/composition/json';
import type { Json } from '../src/shared/types';
import securityNodes from './fixtures/security-nodes.json';

afterEach(cleanup);

it('accepts the exact native synthetic wire fixture', () => {
  const document = securityExample();
  const nativeDocument: unknown = {
    ...document, dataSources: securityNodes.sources,
    pages: [{ ...document.pages[0], components: securityNodes.components }],
    modals: [],
  };
  const compiled = compileCompositionDocument(nativeDocument);
  expect(compiled.document.pages[0].components.map(node => node.type)).toEqual(['alarm-panel', 'door-tile', 'door-tile']);
  expect(compiled.capabilities).toContain('sh.alarm-panel@1');
  expect(compiled.capabilities).toContain('sh.security-door@1');
});

it('compiles atomic controls and a Quick Links modal-local push with exact capability closure', () => {
  const { document, capabilities } = compileCompositionDocument(securityExample());
  expect(capabilities).toEqual([
    'sh.actions.navigation@1', 'sh.alarm-mode@1', 'sh.alarm-panel@1', 'sh.backdrop@1', 'sh.bindings@1',
    'sh.chrome@1', 'sh.composition@1', 'sh.grid-dynamic-type@1', 'sh.grid@1', 'sh.page@1', 'sh.security-door@1',
    'sh.sheet-fit@1', 'sh.sheet@1', 'sh.shell@1', 'sh.symbols@1', 'sh.tile-presentation@1', 'sh.tiles@1',
  ].sort());
  expect(firstSliceCapabilities).not.toContain('sh.alarm-panel@1');
  const link = document.modals[0].components[0];
  if (link.type !== 'navigation-tile') throw Error('Expected local navigation tile');
  expect(link.action).toMatchObject({ type: 'push', pageId: 'demo-local-alarm', origin: 'sender' });
  expect(link.props.alarm).toMatchObject({ sourceId: 'demo-alarm', projection: 'alarm-navigation@1' });
  expect(document.pages[1].components[0].type).toBe('alarm-panel');
});

it.each([
  ['wrong alarm target', (document: ReturnType<typeof securityExample>) => { document.dataSources[0] = {
    id: 'demo-alarm', kind: 'model', model: 'alarm-mode@1', inputs: { entityId: { type: 'literal', value: 'switch.demo' } },
  }; }],
  ['wrong garage target', (document: ReturnType<typeof securityExample>) => { document.dataSources[2] = {
    id: 'demo-garage', kind: 'model', model: 'security-door@1', inputs: { kind: 'garage', entityId: { type: 'literal', value: 'lock.demo' } },
  }; }],
  ['wrong consumer type', (document: ReturnType<typeof securityExample>) => {
    const panel = document.pages[1].components[0];
    if (panel.type === 'alarm-panel') panel.props.sourceId = 'demo-lock';
  }],
  ['duplicate mode', (document: ReturnType<typeof securityExample>) => {
    const panel = document.pages[1].components[0];
    if (panel.type === 'alarm-panel') panel.props.modes[1] = structuredClone(panel.props.modes[0]);
  }],
  ['duplicate state', (document: ReturnType<typeof securityExample>) => {
    const panel = document.pages[1].components[0];
    if (panel.type === 'alarm-panel') panel.props.states.push(structuredClone(panel.props.states[0]));
  }],
])('rejects %s without successful placeholders', (_, mutate) => {
  const document = securityExample();
  mutate(document);
  expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
});

it('rejects service injection and removal of the mandatory confirmation', () => {
  const document = securityExample(), panel = document.pages[1].components[0];
  if (panel.type !== 'alarm-panel') throw Error('Expected panel');
  const untrusted: unknown = { ...panel, props: { ...panel.props, service: 'alarm_disarm' } };
  expect(() => compileCompositionDocument({ ...document, pages: [{ ...document.pages[0], components: [untrusted] }] })).toThrow();
  const { confirmation: _confirmation, ...withoutConfirmation } = panel.props;
  expect(() => compileCompositionDocument({
    ...document, pages: [document.pages[0], { ...document.pages[1], components: [{ ...panel, props: withoutConfirmation }] }],
  })).toThrow();
});

function nodeSchema(type: string): SchemaField {
  const schema = Object.values(compositionEditorSchema.definitions ?? {}).flatMap(fieldVariants)
    .find(candidate => candidate.properties?.type?.const === type);
  if (!schema) throw Error(`Missing structured ${type} fields`);
  return schema;
}

it('authors panel mode order, labels, symbols, colors, status and confirmation copy without raw JSON', () => {
  let document = securityExample();
  const path = ['pages', 1, 'components', 0] as (string | number)[];
  const form = () => <CompositionFields schema={nodeSchema('alarm-panel')} value={valueAt(document, path) as Json}
    path={path} label="Alarm panel" document={document}
    onChange={next => { document = next; rendered.rerender(form()); }} onError={message => { throw Error(message); }}/>;
  const rendered = render(form());
  fireEvent.change(screen.getByLabelText('Source Id'), { target: { value: 'demo-alarm' } });
  fireEvent.click(screen.getByText('1. Disarm'));
  const mode = screen.getByRole('group', { name: 'Disarm' });
  fireEvent.change(within(mode).getByLabelText('Label'), { target: { value: 'Stand down' } });
  fireEvent.change(within(mode).getByLabelText('Name'), { target: { value: 'shield.slash' } });
  fireEvent.change(within(mode).getByLabelText('Red'), { target: { value: '42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move Stand down down' }));
  fireEvent.change(screen.getByLabelText('Pending Text'), { target: { value: 'Contacting panel' } });
  const question = screen.getByRole('group', { name: 'Confirmation' });
  fireEvent.change(within(question).getByLabelText('Title'), { target: { value: 'Stand down now?' } });
  fireEvent.change(within(question).getByLabelText('Confirm Label'), { target: { value: 'Stand down' } });
  const result = compileCompositionDocument(document).document.pages[1].components[0];
  if (result.type !== 'alarm-panel') throw Error('Expected panel');
  expect(result.props.modes.map(mode => mode.state)).toEqual(['armed_home', 'disarmed', 'armed_away', 'armed_night']);
  expect(result.props.modes[1]).toMatchObject({ label: 'Stand down', fill: { red: 42 } });
  expect(result.props.confirmation.title).toBe('Stand down now?');
  expect(result.props.pendingText).toBe('Contacting panel');
});

it('exposes lock and garage targets, appearance, feedback and body/disc command labels in the generated editor', () => {
  const schema = nodeSchema('door-tile');
  const sources = resolveField(compositionEditorSchema.properties!.dataSources);
  const variants = fieldVariants(sources.items as SchemaField);
  expect(variants.some(variant => variant.properties?.model?.const === 'security-door@1')).toBe(true);
  expect(resolveField(schema.properties!.props).properties).toMatchObject({
    sourceId: expect.anything(), states: expect.anything(), openLabel: expect.anything(),
    closeLabel: expect.anything(), reverseLabel: expect.anything(), errorText: expect.anything(), sendingOpenText: expect.anything(),
  });
});
