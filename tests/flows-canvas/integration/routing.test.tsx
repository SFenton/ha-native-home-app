// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { replaceAt, valueAt } from '../../../src/composition-editor';
import { RowsProvider } from '../../../src/workspace2/rowsContext';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { houseFrom } from '../../../src/preview2/projections';
import ConditionField from '../../../src/workspace2/expr/ConditionField';
import ValueField from '../../../src/workspace2/expr/ValueField';
import { integrationDocument, integrationSnapshot } from './fixture';
import type { ReactNode } from 'react';
import { LogicField } from '../../../src/workspace2/logic-fields/Field';
import { createDraft } from '../../../src/workspace2/editors/draft';
import { DraftReadRow } from '../../../src/workspace2/expr/SimpleCondition';
import { openSimple } from '../../../src/workspace2/expr/condition';
import type { Predicate } from '../../../src/shared/composition/expression';

const canvas = vi.hoisted(() => ({ suspended: false, open: vi.fn() }));
vi.mock('../../../src/workspace2/logic-fields/LogicFields', async original => ({
  ...await original<typeof import('../../../src/workspace2/logic-fields/LogicFields')>(),
  useLogicFields: () => canvas,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(child: ReactNode, document = integrationDocument()) {
  const onChange = vi.fn(), before = JSON.stringify(document);
  render(<WorkspaceDataProvider document={document} house={houseFrom(integrationSnapshot)}>
    <RowsProvider value={{ document, onChange, onError: vi.fn() }}>{child}</RowsProvider>
  </WorkspaceDataProvider>);
  return { onChange, unchanged: () => expect(JSON.stringify(document)).toBe(before) };
}

it('keeps the Only show when disclosure and Done for one check, without legacy condition cards', async () => {
  const state = setup(<ConditionField label="Only show when" path={['pages', 0, 'components', 2, 'visibleWhen']} place="show" itemName="One check"/>);
  fireEvent.click(screen.getByRole('button', { name: /^Only show when:/ }));
  const editor = await screen.findByRole('dialog', { name: 'Only Show When' });
  expect(within(editor).getByRole('button', { name: 'Entity' }).textContent).toBe('Window');
  expect(within(editor).queryByRole('radiogroup', { name: 'Condition view' })).toBeNull();
  expect(within(editor).queryByRole('button', { name: /^Condition 1:/ })).toBeNull();
  fireEvent.click(within(editor).getByRole('button', { name: 'Done' }));
  expect(state.onChange).not.toHaveBeenCalled();
  state.unchanged();
});

it.each([
  { left: { type: 'last-changed', sourceId: 'source-a' }, value: '2026-11-15T21:30:00.000Z', label: 'Last Changed', note: /never equal to a date/ },
  { left: { type: 'raw-state', sourceId: 'source-a' }, value: 'unknown', label: 'Raw State', note: /Says Unknown or Unavailable/ },
])('updates $label inside a pushed picker without remounting its saved body', ({ left, value, label, note }) => {
  const document = integrationDocument(), draft = createDraft(document);
  const path = ['pages', 0, 'components', 2, 'visibleWhen'];
  const state = setup(<DraftReadRow draft={draft} readLeaf={current => openSimple(valueAt(current, path) as Predicate)} onChange={vi.fn()}/>, document);
  expect(screen.getByRole('combobox', { name: 'Read', exact: true }).textContent).toBe('State');
  act(() => draft.set(replaceAt(draft.get(), path, { type: 'compare', op: left.type === 'last-changed' ? 'before' : 'eq', left, right: { type: 'literal', value } })));
  expect(screen.getByRole('combobox', { name: 'Read', exact: true }).textContent).toBe(label);
  expect(screen.getByText(note)).toBeTruthy();
  state.unchanged();
});

it('keeps a template value in the Subtitle textbox, including its tokens and Done transaction', async () => {
  const state = setup(<ValueField label="Subtitle" path={['pages', 0, 'components', 0, 'props', 'subtitle']} kind="text" itemName="First room"/>);
  fireEvent.click(screen.getByRole('button', { name: /^Subtitle:/ }));
  const editor = await screen.findByRole('dialog', { name: 'Subtitle' });
  expect(within(editor).getByRole('textbox', { name: 'Subtitle' }).querySelectorAll('.w2-token')).toHaveLength(1);
  expect(within(editor).getAllByTestId('logic-use')).toHaveLength(1);
  fireEvent.click(within(editor).getByRole('button', { name: 'Done' }));
  expect(state.onChange).not.toHaveBeenCalled();
  state.unchanged();
});

it('does not replace a value editor with a condition summary even when its value has multiple rule cases', async () => {
  const path = ['pages', 0, 'components', 0, 'props', 'subtitle'];
  const document = replaceAt(integrationDocument(), path, { type: 'expr', value: {
    type: 'choose', cases: [true, false].map(isAdmin => ({ when: { type: 'viewer', isAdmin }, then: { type: 'literal', value: 'Text' } })),
    otherwise: { type: 'literal', value: '' },
  } });
  const state = setup(<ValueField label="Subtitle" path={path} kind="text" itemName="First room"/>, document);
  fireEvent.click(screen.getByRole('button', { name: /^Subtitle: 2 rules/ }));
  const editor = await screen.findByRole('dialog', { name: 'Subtitle' });
  expect(within(editor).getByRole('radio', { name: 'Rules' }).getAttribute('aria-checked')).toBe('true');
  expect(within(editor).queryByTestId('logic-field-summary')).toBeNull();
  expect(within(editor).getByRole('button', { name: 'Done' })).toBeTruthy();
  state.unchanged();
});

it('uses the summary only for a condition field with more than one check', () => {
  const state = setup(<ConditionField label="Only show when" path={['pages', 0, 'components', 3, 'visibleWhen']} place="show" itemName="Multiple checks"/>);
  expect(screen.getByTestId('logic-field-summary')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Only show when:/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit in Canvas' })).toBeTruthy();
  state.unchanged();
});

it('reports the actual value of a one-check formula, not its first source reading', () => {
  const base = integrationDocument();
  const read = (sourceId: string) => ({ type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as: 'number', missing: 'unavailable' });
  const path = ['pages', 0, 'components', 2, 'visibleWhen'];
  const withSources: typeof base = { ...base, dataSources: [...base.dataSources,
    { id: 'source-c', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.demo_bedroom_temperature' } },
  ] };
  const document = replaceAt(withSources, path, { type: 'compare', op: 'above', left: { type: 'math', op: 'divide', args: [
    { type: 'math', op: 'add', args: [read('source-b'), read('source-c')] }, { type: 'literal', value: 2 },
  ] }, right: { type: 'literal', value: 24 } });
  setup(<LogicField draft={createDraft(document)} path={path} kind="condition" label="Only show when"/>, document);
  expect(screen.getByTestId('result-line').textContent).toContain('is 23 right now');
  expect(screen.getByTestId('result-line').textContent).not.toContain('23.6');
  expect(screen.queryByTestId('logic-field-summary')).toBeNull();
});

it.each([
  { name: 'deeply grouped check', predicate: { type: 'all', of: [{ type: 'all', of: [{ type: 'state', sourceId: 'source-a', path: ['state'], in: ['open'] }] }] }, text: 'Window' },
  { name: 'negated numeric check', predicate: { type: 'not', of: { type: 'numeric', sourceId: 'source-b', path: ['state'], above: { type: 'literal', value: 22 } } }, text: 'not (Living Room is above 22)' },
])('displays an existing $name without replacing its bytes or showing an empty picker', ({ predicate, text }) => {
  const path = ['pages', 0, 'components', 2, 'visibleWhen'];
  const document = replaceAt(integrationDocument(), path, predicate), draft = createDraft(document);
  const before = JSON.stringify(document);
  setup(<LogicField draft={draft} path={path} kind="condition" label="Only show when"/>, document);
  expect(screen.getByTestId('logic-field').textContent).toContain(text);
  expect(screen.getByTestId('logic-field').textContent).not.toContain('Choose a value');
  expect(screen.queryByTestId('logic-field-summary')).toBeNull();
  expect(screen.queryByTestId('condition-row')).toBeNull();
  expect(JSON.stringify(draft.get())).toBe(before);
});
