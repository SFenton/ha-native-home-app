// @vitest-environment jsdom
import { fireEvent, render, screen, within, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileCompositionDocument, firstSliceCapabilities } from '../src/shared/composition/compiler';
import { compositionDocumentSchema, type CompositionDocument, type CompositionNode, type CompositionPublication } from '../src/shared/composition/schema';
import { CompositionValidationError } from '../src/shared/composition/json';
import { componentLocations, compositionEditorSchema, fieldVariants, moveCompositionNode, removeCompositionItem } from '../src/composition-editor';
import CompositionFields from '../src/CompositionFields';

const text = (id: string): CompositionNode => ({
  id, title: id, type: 'text', layout: { span: 1 },
  props: { value: { type: 'literal', value: id }, style: 'body', unavailableText: 'No text' },
});
function fixture(): CompositionDocument {
  const publication: CompositionPublication = JSON.parse(readFileSync(resolve('tests/fixtures/composition-first-slice.json'), 'utf8'));
  const document = publication.document;
  document.localState = [
    { id: 'enabled', type: 'boolean', initial: false },
    { id: 'count', type: 'number', initial: 2, minimum: 0, maximum: 10, step: 2 },
    { id: 'panel', type: 'choice', initial: 'details', options: [{ id: 'details', label: 'Details' }, { id: 'options', label: 'Options' }] },
  ];
  document.pages[2].components = [{
    id: 'section', title: 'Section', type: 'section', layout: { span: 1 },
    props: { header: 'Controls', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } },
    children: [
      { id: 'row', title: 'Row', type: 'row', layout: { span: 1 }, props: {
        primary: { type: 'literal', value: 'Item' }, secondary: { type: 'literal', value: '' }, value: { type: 'literal', value: 'Ready' },
        accessory: 'none', loadingText: 'Reading item', unavailableText: 'No item',
      } },
      { id: 'toggle', title: 'Enabled', type: 'local-control', layout: { span: 1 }, props: { stateId: 'enabled', kind: 'toggle', placeholder: '' } },
      { id: 'button', title: 'Enable', type: 'primary-button', layout: { span: 1 }, props: {},
        action: { type: 'set-local', stateId: 'enabled', value: { type: 'boolean', value: true } } },
      { id: 'panels', title: 'Panels', type: 'local-tabs', layout: { span: 1 }, props: { stateId: 'panel', transition: 'canonical-swap@1' },
        tabs: [{ id: 'details', label: 'Details', children: [text('detail-copy')] }, { id: 'options', label: 'Options', children: [text('option-copy')] }] },
      { id: 'rows', title: 'Rows', type: 'row-collection', layout: { span: 1 }, props: {
        providerId: 'sample-items', loadingText: 'Reading items', emptyText: 'No items', unavailableText: 'Items unavailable',
        errorText: 'Items failed', staleText: 'Last known items',
      } },
    ],
  }];
  return document;
}
function section(document: CompositionDocument) {
  const node = document.pages[2].components[0];
  if (node.type !== 'section') throw Error('Expected section');
  return node;
}
function issue(document: CompositionDocument, code: string, pointer: string) {
  try { compileCompositionDocument(document); throw Error('Expected rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(CompositionValidationError);
    expect((error as CompositionValidationError).issues).toContainEqual(expect.objectContaining({ code, pointer }));
  }
}
afterEach(cleanup);

describe('shared typed shell compiler', () => {
  it('negotiates the exact additional closure and visits hidden tab definitions', () => {
    const document = fixture();
    expect(compileCompositionDocument(document).capabilities).toEqual([...firstSliceCapabilities,
      'sh.section@1', 'sh.rows@1', 'sh.local-tabs@1', 'sh.local-state@1',
      'sh.local-controls@1', 'sh.primary-button@1', 'sh.row-collection@1',
    ].sort());
    expect(componentLocations(document).map(entry => entry.node.id)).toContain('option-copy');
    const panels = section(document).children[3];
    if (panels.type !== 'local-tabs') throw Error('Expected tabs');
    panels.tabs[1].children.push({ id: 'hidden-action', title: 'Hidden', type: 'primary-button', layout: { span: 1 }, props: {},
      action: { type: 'set-local', stateId: 'missing', value: { type: 'boolean', value: true } } });
    issue(document, 'invalid_reference', '/document/pages/2/components/0/children/3/tabs/1/children/1/action/stateId');
  });
  it('rejects coercion, off-step defaults, incompatible controls and mismatched tab catalogs', () => {
    let document = fixture();
    document.localState![1] = { id: 'count', type: 'number', initial: 3, minimum: 0, maximum: 10, step: 2 };
    issue(document, 'invalid_value', '/document/localState/1/initial');
    document = fixture();
    const toggle = section(document).children[1];
    if (toggle.type !== 'local-control') throw Error('Expected control');
    toggle.props.stateId = 'count';
    issue(document, 'binding_type', '/document/pages/2/components/0/children/1/props/stateId');
    document = fixture();
    const panels = section(document).children[3];
    if (panels.type !== 'local-tabs') throw Error('Expected tabs');
    panels.tabs.reverse();
    issue(document, 'invalid_combination', '/document/pages/2/components/0/children/3/props/stateId');
    expect(compositionDocumentSchema.safeParse({ ...fixture(), localState: [{ id: 'enabled', type: 'boolean', initial: 'true' }] }).success).toBe(false);
  });
  it('guards relationships and moves nested nodes without losing identity or allowing cycles', () => {
    const document = fixture();
    expect(() => removeCompositionItem(document, ['localState'], 0)).toThrow('stateId');
    expect(() => moveCompositionNode(document, 'section', { kind: 'local-tab', id: 'panels', tabId: 'options' })).toThrow('descendants');
    const moved = moveCompositionNode(document, 'row', { kind: 'local-tab', id: 'panels', tabId: 'options' });
    expect(componentLocations(moved).find(entry => entry.node.id === 'row')?.parent).toBe('panels:options');
    compileCompositionDocument(moved);
  });
  it('keeps module lists row-only and refuses domain commands without a busy/failure adapter', () => {
    const document = fixture();
    section(document).props.style = 'module-list';
    issue(document, 'invalid_combination', '/document/pages/2/components/0/children/2/type');
    section(document).props.style = 'plain';
    const button = section(document).children[2];
    if (button.type !== 'primary-button') throw Error('Expected button');
    button.action = { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } };
    issue(document, 'invalid_combination', '/document/pages/2/components/0/children/2/action/type');
    const fields = document.localState!;
    fields[2] = { id: 'panel', type: 'choice', initial: 'details', options: [
      { id: 'details', label: 'Details' }, { id: 'options', label: 'Options' }, { id: 'third', label: 'Third' },
      { id: 'fourth', label: 'Fourth' }, { id: 'fifth', label: 'Fifth' },
    ] };
    const toggle = section(document).children[1];
    if (toggle.type !== 'local-control') throw Error('Expected control');
    toggle.props = { stateId: 'panel', kind: 'segmented-choice', placeholder: '' };
    issue(document, 'invalid_combination', '/document/pages/2/components/0/children/1/props/stateId');
  });
  it('authors local tabs through generated field/option selectors without raw JSON', () => {
    const document = fixture();
    const nodeSchema = Object.values(compositionEditorSchema.definitions ?? {}).find(schema =>
      fieldVariants(schema).some(item => item.properties?.type?.const === 'tile-grid'));
    expect(nodeSchema).toBeDefined();
    expect(fieldVariants(nodeSchema!).map(item => item.properties?.type?.const)).toContain('local-tabs');
    const panels = section(document).children[3];
    if (panels.type !== 'local-tabs') throw Error('Expected tabs');
    const tabsSchema = fieldVariants(nodeSchema!).find(item => item.properties?.type?.const === 'local-tabs')!;
    let changed = document;
    render(<CompositionFields schema={tabsSchema} value={panels} document={document}
      path={['pages', 2, 'components', 0, 'children', 3]} label="Panels" onChange={next => { changed = next; }} onError={message => { throw Error(message); }}/>);
    expect(screen.getByLabelText('State Id').tagName).toBe('SELECT');
    const options = screen.getAllByLabelText('Id').filter(element => element.tagName === 'SELECT');
    expect(options).toHaveLength(2);
    expect(within(options[0]).getAllByRole('option').map(option => option.textContent)).toContain('Options');
    fireEvent.change(options[0], { target: { value: 'options' } });
    const next = section(changed).children[3];
    if (next.type !== 'local-tabs') throw Error('Expected tabs');
    expect(next.tabs[0]).toMatchObject({ id: 'options', label: 'Options' });
  });
});
