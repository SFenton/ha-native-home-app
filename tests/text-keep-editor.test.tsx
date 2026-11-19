// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/composition-first-slice.json';
import { valueAt } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionNode } from '../src/shared/composition/schema';
import { createDraft } from '../src/workspace2/editors/draft';
import { lineOperand, writeParts } from '../src/workspace2/expr/TokenField';
import { parseLine } from '../src/workspace2/expr/tokens';
import { PushStack } from '../src/workspace2/kit';
import { ToastHost } from '../src/workspace2/toasts';
import ValueEditor from '../src/workspace2/expr/ValueEditor';
import type { Draft } from '../src/workspace2/editors/draft';
import type { TextSlot } from '../src/shared/composition/evaluator';

afterEach(cleanup);

const read = { type: 'read', from: { type: 'source', sourceId: 's', path: ['state'] }, as: 'string', missing: 'unavailable' } as const;
const operand = { ...read, from: { ...read.from, path: [...read.from.path] } };
const settings = { fallback: 'No reading', whenUnavailable: 'keep' as const };
const path = ['pages', 0, 'components', 0, 'props', 'value'];
const choose = { type: 'choose' as const, cases: [{ when: { type: 'state' as const, sourceId: 's', path: ['state'], in: ['on'] }, then: { type: 'literal' as const, value: 'On' } }],
  otherwise: { type: 'literal' as const, value: 'Off' } };
function draftWith(slot: TextSlot) {
  const base = compileCompositionDocument(fixture.document).document;
  const node: CompositionNode = { id: 'keep-text', title: 'Reading', type: 'text', layout: { span: 1 }, props: { value: slot, style: 'body', unavailableText: 'Unknown' } };
  return createDraft({ ...base,
    dataSources: [...base.dataSources, { id: 's', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.demo_keep' } }],
    pages: base.pages.map((page, index) => index ? page : { ...page, components: [node] }) });
}
function mount(draft: Draft) {
  return render(<ToastHost><PushStack rootTitle="Reading" root={<ValueEditor draft={draft} path={path} kind="text" modes={['fixed', 'entity', 'rules']} label="Reading"/>}/></ToastHost>);
}
function expectKept(draft: Draft) {
  expect(valueAt(draft.get(), path)).toMatchObject(settings);
  expect(compileCompositionDocument(draft.get()).capabilities).toContain('sh.text-keep@1');
}
async function duplicate() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'More for Rule 1' })); });
  await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' })); });
}

describe.each(['read', 'expr'] as const)('editing a %s text slot', kind => {
  it('preserves fallback and keep when writing text and editing a token', () => {
    const slot = kind === 'read' ? { ...operand, ...settings } : { type: 'expr' as const, value: operand, ...settings };
    const base = compileCompositionDocument(fixture.document).document;
    const node: CompositionNode = { id: 'keep-text', title: 'Reading', type: 'text', layout: { span: 1 }, props: { value: slot, style: 'body', unavailableText: 'Unknown' } };
    const draft = createDraft({ ...base, pages: base.pages.map((page, index) => index ? page : { ...page, components: [node] }) });
    const address = { path: ['pages', 0, 'components', 0, 'props', 'value'], wrap: 'slot' as const };
    const parts = parseLine(lineOperand(valueAt(draft.get(), address.path), 'slot')!)!;
    writeParts(draft, address, [...parts, { text: ' degrees' }], true);
    expect(valueAt(draft.get(), address.path)).toEqual({ type: 'expr', value: { type: 'format', pattern: '{a} degrees', args: { a: operand } }, ...settings });
    const replacement = { ...operand, from: { ...operand.from, sourceId: 'new-source' } };
    writeParts(draft, address, [{ token: { operand: replacement } }], false);
    expect(valueAt(draft.get(), address.path)).toEqual({ ...replacement, ...settings });
    draft.undo();
    expect(valueAt(draft.get(), address.path)).toMatchObject({ type: 'expr', ...settings });
  });

  describe('preserving text settings through root rewrites', () => {
    it('keeps settings when duplicating on the rules list and page, editing a Then, and removing a rule', async () => {
      const draft = draftWith({ type: 'expr', value: choose, ...settings });
      mount(draft);
      await duplicate();
      expectKept(draft);
      expect(valueAt(draft.get(), [...path, 'value', 'cases'])).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: /^Rule 1 of 2: if/ }));
      await duplicate();
      expectKept(draft);
      expect(valueAt(draft.get(), [...path, 'value', 'cases'])).toHaveLength(3);
      act(() => writeParts(draft, { path: [...path, 'value', 'cases', 0, 'then'], wrap: 'operand' }, [{ text: 'Changed' }], true));
      expectKept(draft);
      expect(valueAt(draft.get(), [...path, 'value', 'cases', 0, 'then'])).toEqual({ type: 'literal', value: 'Changed' });
      fireEvent.click(screen.getByRole('button', { name: 'Remove Rule' }));
      expectKept(draft);
      expect(valueAt(draft.get(), [...path, 'value', 'cases'])).toHaveLength(2);
    });

    it('keeps settings across rules, token and fixed modes, including literal-only contents', () => {
      const draft = draftWith({ type: 'expr', value: choose, ...settings });
      mount(draft);
      for (const mode of ['From Entity', 'Rules', 'Fixed', 'From Entity', 'Rules']) {
        fireEvent.click(screen.getByRole('radio', { name: mode }));
        expectKept(draft);
      }
      fireEvent.click(screen.getByRole('radio', { name: 'Fixed' }));
      const input = screen.getByRole('textbox', { name: 'Reading' });
      fireEvent.change(input, { target: { value: 'Fixed for now' } });
      fireEvent.blur(input);
      expectKept(draft);
      expect(valueAt(draft.get(), path)).toEqual({ type: 'expr', value: { type: 'literal', value: 'Fixed for now' }, ...settings });
    });

    it.each(['read', 'format', 'choose'] as const)('keeps %s settings when saving a Logic Template', async kind => {
      const slot: TextSlot = kind === 'read' ? { ...operand, ...settings } : { type: 'expr', value: kind === 'choose' ? choose : { type: 'format', pattern: '{v} now', args: { v: operand } }, ...settings };
      const draft = draftWith(slot);
      mount(draft);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'More' })); });
      await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Save as Logic Template…' })); });
      const dialog = await screen.findByRole('dialog', { name: 'Save as Logic Template' });
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Saved Reading' } });
      await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
      expectKept(draft);
      expect(valueAt(draft.get(), [...path, 'value', 'type'])).toBe('logic-ref');
      expect(draft.get().logicLibrary).toHaveLength(1);
      expect(JSON.stringify(draft.get().logicLibrary)).not.toContain('whenUnavailable');
      expect(JSON.stringify(draft.get().logicLibrary)).not.toContain('fallback');
    });
  });
});
