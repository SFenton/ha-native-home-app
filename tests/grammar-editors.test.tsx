// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CompositionFields from '../src/CompositionFields';
import { resetHaEntities } from '../src/GrammarEditors';
import { compositionEditorSchema, fieldVariants, nodeDefinition, valueAt, type EditorPath } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { createCompositionDocument } from '../src/shared/composition/workspace';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { Json } from '../src/shared/types';

const lit = (value: unknown) => ({ type: 'literal', value });
const nodeSchema = (type: string) => fieldVariants(nodeDefinition()).find(variant => variant.properties?.type?.const === type)!;
function fixture(components: unknown[]) {
  const document = createCompositionDocument('grammar-ui');
  document.dataSources.push({ id: 'fan', kind: 'ha-entity', entityId: { type: 'literal', value: 'fan.demo_guest' } },
    { id: 'temp', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.demo_temp' } });
  document.pages[0].components = components as CompositionDocument['pages'][number]['components'];
  return document;
}
function mount(document: CompositionDocument, schema = nodeSchema('primary-button'), path: EditorPath = ['pages', 0, 'components', 0]) {
  let current = document;
  const form = () => <CompositionFields schema={schema} value={valueAt(current, path) as Json} document={current} path={path} label="Node"
    onChange={next => { current = next; rendered.rerender(form()); }} onError={message => { throw Error(message); }}/>;
  const rendered = render(form());
  return () => current;
}
const button = (action: unknown) => ({ id: 'go', title: 'Go', type: 'primary-button', layout: { span: 1 }, props: {}, action });
const node = (current: () => CompositionDocument) => { try { return compileCompositionDocument(current()).document.pages[0].components[0] as any; } catch (e: any) { throw new Error(JSON.stringify(e.issues)); } };

beforeEach(() => {
  resetHaEntities();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ states: [{ entityId: 'light.demo_kitchen' }, { entityId: 'lock.demo_front_door' }, { entityId: 'fan.demo_guest' }] }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('service call editor', () => {
  it('authors domain, service, a picked entity, data operands, optimistic state and a confirmation', async () => {
    const current = mount(fixture([button({ type: 'call-service', domain: 'light', service: 'turn_on' })]));
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'fan' } });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'set_percentage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add entity_id' }));
    await waitFor(() => expect(document.querySelector('datalist option[value="light.demo_kitchen"]')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Entity'), { target: { value: 'fan.demo_guest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add service data' }));
    fireEvent.change(screen.getByLabelText('New data field name'), { target: { value: 'percentage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add data field' }));
    fireEvent.change(screen.getByLabelText('percentage literal type'), { target: { value: 'number' } });
    fireEvent.change(screen.getByLabelText('percentage number'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add optimistic state' }));
    fireEvent.change(screen.getByLabelText('Show on source 1'), { target: { value: 'fan' } });
    fireEvent.change(screen.getByLabelText('Ask before sending'), { target: { value: 'additional' } });
    fireEvent.change(screen.getByLabelText('Confirmation title'), { target: { value: 'Speed up?' } });
    fireEvent.change(screen.getByLabelText('Skip for these user ids (comma separated)'), { target: { value: 'u1, u2' } });
    expect(node(current).action).toEqual({
      type: 'call-service', domain: 'fan', service: 'set_percentage', target: { entity_id: lit('fan.demo_guest') },
      data: { type: 'object', fields: { percentage: lit(50) } },
      optimistic: [{ sourceId: 'fan', value: 'on', revertAfterSeconds: 2, failsOnTimeout: false }],
      confirmation: { type: 'additional', style: 'alert', title: 'Speed up?', confirmLabel: 'Confirm', cancelLabel: 'Cancel', destructive: false, exemptUserIds: ['u1', 'u2'] },
    });
  });

  it('binds a target to an entity read and a data field to a format', () => {
    const current = mount(fixture([button({ type: 'call-service', domain: 'notify', service: 'mobile_app', target: { entity_id: lit('fan.demo_guest') } })]));
    fireEvent.click(screen.getByRole('button', { name: 'Use a bound value' }));
    fireEvent.change(screen.getByLabelText('entity_id source'), { target: { value: 'fan' } });
    fireEvent.change(screen.getByLabelText('entity_id as'), { target: { value: 'entity-id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add service data' }));
    fireEvent.change(screen.getByLabelText('New data field name'), { target: { value: 'message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add data field' }));
    fireEvent.change(screen.getByLabelText('message kind'), { target: { value: 'format' } });
    fireEvent.change(screen.getByLabelText('message pattern'), { target: { value: '{value} now' } });
    const action = node(current).action;
    expect(action.target.entity_id).toMatchObject({ type: 'read', as: 'entity-id', from: { sourceId: 'fan', path: ['state'] } });
    expect(action.data.fields.message).toMatchObject({ type: 'format', pattern: '{value} now' });
  });

  it('shows the confirmation warning for locks, alarms and covers, and clears it once a confirmation is set', () => {
    mount(fixture([button({ type: 'call-service', domain: 'lock', service: 'unlock' })]));
    expect(screen.getByRole('status').textContent).toContain('has no confirmation');
    fireEvent.change(screen.getByLabelText('Ask before sending'), { target: { value: 'additional' } });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('condition builder', () => {
  const text = (extra: object = {}) => ({ id: 't', title: 'T', type: 'text', layout: { span: 1 }, props: { value: lit('x'), style: 'body', unavailableText: 'n' }, ...extra });
  it('adds a visibleWhen rule and builds all, viewer and numeric conditions with an unknown policy', () => {
    const current = mount(fixture([text()]), nodeSchema('text'));
    fireEvent.click(screen.getByLabelText('Include Visible When'));
    expect(node(current).visibleWhen).toEqual({ type: 'state', sourceId: 'fan', path: ['state'], in: ['on'] });
    fireEvent.change(screen.getByLabelText('Visible When condition'), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    fireEvent.change(screen.getByLabelText('Visible When 2 condition'), { target: { value: 'viewer' } });
    fireEvent.change(screen.getByLabelText('Visible When 2 administrator'), { target: { value: 'true' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    fireEvent.change(screen.getByLabelText('Visible When 3 condition'), { target: { value: 'numeric' } });
    fireEvent.change(screen.getByLabelText('Visible When 3 source'), { target: { value: 'temp' } });
    fireEvent.change(screen.getByLabelText('Is above number'), { target: { value: '70' } });
    fireEvent.click(screen.getByLabelText('Include When Unknown'));
    fireEvent.change(screen.getByLabelText('When Unknown'), { target: { value: 'hide' } });
    expect(node(current).visibleWhen).toEqual({ type: 'all', of: [
      { type: 'state', sourceId: 'fan', path: ['state'], in: ['on'] },
      { type: 'viewer', isAdmin: true },
      { type: 'numeric', sourceId: 'temp', path: ['state'], above: lit(70) },
    ] });
    expect(node(current).whenUnknown).toBe('hide');
  });

  it('edits state lists and attribute paths inside a negation', () => {
    const current = mount(fixture([text({ visibleWhen: { type: 'not', of: { type: 'state', sourceId: 'fan', path: ['state'], in: ['on'] } } })]), nodeSchema('text'));
    fireEvent.change(screen.getByLabelText('Visible When (negated) states (comma separated)'), { target: { value: 'on, auto' } });
    fireEvent.change(screen.getByLabelText('Read'), { target: { value: 'attribute' } });
    fireEvent.change(screen.getByLabelText('Attribute name'), { target: { value: 'preset_mode' } });
    expect(node(current).visibleWhen).toEqual({ type: 'not', of: { type: 'state', sourceId: 'fan', path: ['attributes', 'preset_mode'], in: ['on', 'auto'] } });
  });
});

describe('bound control editor', () => {
  it('edits a stepper: its value read and a call that receives the control value', () => {
    const stepper = { id: 'st', title: 'Temp', type: 'bound-control', layout: { span: 1 },
      props: { kind: 'stepper', value: { type: 'read', from: { type: 'source', sourceId: 'temp', path: ['state'] }, as: 'number', missing: 'unavailable' },
        range: { min: 60, max: 80, step: 1 }, unavailableText: 'No reading' },
      action: { type: 'call-service', domain: 'climate', service: 'set_temperature', target: { entity_id: lit('climate.demo_hall') }, data: { type: 'object', fields: { temperature: { type: 'control' } } } } };
    const current = mount(fixture([stepper]), nodeSchema('bound-control'));
    fireEvent.change(screen.getByLabelText('Value source'), { target: { value: 'fan' } });
    const result = node(current);
    expect(result.props.value.from.sourceId).toBe('fan');
    expect(result.action.data.fields.temperature).toEqual({ type: 'control' });
  });

  it('offers the control value inside a bound control call and not inside a plain button', () => {
    const call = { type: 'call-service', domain: 'fan', service: 'x', data: { type: 'object', fields: { v: lit(1) } } };
    mount(fixture([button(call)]));
    expect(within(screen.getByLabelText('v kind')).queryByRole('option', { name: /control/ })).toBeNull();
    cleanup();
    const bound = { id: 'b', title: 'B', type: 'bound-control', layout: { span: 1 }, props: { kind: 'slider', value: lit(1), unavailableText: 'u' }, action: call };
    mount(fixture([bound]), nodeSchema('bound-control'));
    expect(within(screen.getByLabelText('v kind')).getByRole('option', { name: /control/ })).toBeTruthy();
  });
});

it('keeps the generated schema representable for the structured editor', () => {
  expect(JSON.stringify(compositionEditorSchema)).toContain('call-service');
});
