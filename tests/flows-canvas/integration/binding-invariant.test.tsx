// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replaceAt, valueAt, type EditorPath } from '../../../src/composition-editor';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { fieldSteps, readField } from '../../../src/shared/composition/components';
import { resolveLogicAnchor } from '../../../src/shared/composition/studio-logic/anchors';
import { resolveLogicUseBindings } from '../../../src/shared/composition/studio-logic/bindings';
import type { CompositionDocument } from '../../../src/shared/composition/schema';
import { createDraft, type Draft } from '../../../src/workspace2/editors/draft';
import { AddressedField } from '../../../src/workspace2/logic-fields/AddressedField';
import { RowsProvider } from '../../../src/workspace2/rowsContext';
import { request } from '../../../src/api';
import { useCompositionStudio } from '../../../src/useCompositionStudio';
import { liftField } from '../../../src/workspace2/logic-fields/registry';
import { saveCanvasLayout } from '../../../src/workspace2/logic-fields/layout';
import { projectGraph } from '../../../src/shared/composition/graph/lower';
import { readStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { fieldPointer, pointerPath } from '../../../src/workspace2/logic-fields/registry';
import { setPerPlace } from '../../../src/workspace2/params';
import TokenField, { writeParts } from '../../../src/workspace2/expr/TokenField';
import TokenSettings from '../../../src/workspace2/expr/TokenSettings';
import RulesList from '../../../src/workspace2/expr/RulesList';
import RulePage from '../../../src/workspace2/expr/RulePage';
import { newToken, slotOperand } from '../../../src/workspace2/expr/tokens';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { houseFrom } from '../../../src/preview2/projections';
import { componentDocument, draftDocument } from '../draft/fixtures';
import { integrationSnapshot } from './fixture';
import lamps from '../../fixtures/templates-lamps.json';
import type { Operand } from '../../../src/shared/composition/expression';
import type { ReactNode } from 'react';

afterEach(cleanup);
vi.mock('../../../src/api', async original => ({ ...await original<typeof import('../../../src/api')>(), request: vi.fn() }));
const canvas = vi.hoisted(() => ({ suspended: false, open: vi.fn() }));
vi.mock('../../../src/workspace2/logic-fields/LogicFields', async original => ({
  ...await original<typeof import('../../../src/workspace2/logic-fields/LogicFields')>(),
  useLogicFields: () => canvas,
}));

const pageSlot: EditorPath = ['pages', 0, 'components', 0, 'props', 'subtitle'];
const componentSlot: EditorPath = ['componentLibrary', 0, 'node', 'props', 'subtitle'];
const text = (value: string): Operand => ({ type: 'literal', value });
const check = { type: 'viewer' as const, isAdmin: true };

function fixture(kind: string) {
  let document = compileCompositionDocument(kind.startsWith('component') ? componentDocument() : draftDocument()).document;
  const slot = kind.startsWith('component') ? componentSlot : pageSlot;
  if (kind.startsWith('component')) {
    const unrelated = compileCompositionDocument(draftDocument()).document;
    document = { ...document,
      pages: [{ ...document.pages[0], components: [...document.pages[0].components, unrelated.pages[0].components[1]] }],
      logicUseBindings: [...document.logicUseBindings!, unrelated.logicUseBindings![1]],
    };
  }
  if (kind === 'component parameters') {
    document = replaceAt(document, ['logicLibrary', 0, 'params', 0, 'name'], 'sourceId');
    document = replaceAt(document, ['logicLibrary', 0, 'body', 'from', 'sourceId', 'name'], 'sourceId');
    for (const binding of document.logicUseBindings!) {
      const path = pointerPath(resolveLogicAnchor(document, binding.use)!.pointer);
      document = replaceAt(document, [...path, 'args'], { sourceId: 'source-a' });
    }
    document = { ...document, logicUseBindings: document.logicUseBindings!.map(binding => ({ ...binding, argument: 'sourceId' })) };
    document = setPerPlace(document, 'saved-tile', 'inner-tile', 'props/subtitle/value/args/sourceId', 'source');
  }
  if (kind === 'nested operand') {
    const draft = createDraft(document), operand = valueAt(document, [...slot, 'value']);
    draft.set({ ...replaceAt(document, [...slot, 'value'], { type: 'logic-ref', logicId: 'outer', args: { value: operand } }),
      logicLibrary: [...document.logicLibrary!, { id: 'outer', name: 'Outer', kind: 'operand', params: [{ name: 'value', kind: 'operand' }],
        body: { type: 'format', pattern: '{value}', args: { value: { type: 'hole', name: 'value' } } } }],
    });
    document = draft.get();
  }
  if (kind === 'rule cases') {
    const draft = createDraft(document);
    rules(draft, slot);
    document = draft.get();
  }
  compileCompositionDocument(document);
  return { document, slot };
}
function rules(draft: Draft, slot: EditorPath, reverse = false) {
  const operand = slotOperand(valueAt(draft.get(), slot) as { type: string })!;
  const cases = [{ when: check, then: operand }, { when: { ...check, isAdmin: false }, then: text('Other') }];
  draft.set(replaceAt(draft.get(), slot, { type: 'expr', value: { type: 'choose', cases: reverse ? cases.reverse() : cases, otherwise: text('Otherwise') } }));
}
function valid(document: CompositionDocument) {
  compileCompositionDocument(document);
  expect(resolveLogicUseBindings(document).bindings).toHaveLength(document.logicUseBindings?.length ?? 0);
  for (const entry of document.componentLibrary ?? []) for (const binding of entry.bindings ?? []) {
    const target = resolveLogicAnchor(document, { kind: 'component', id: entry.id, nodeId: binding.nodeId, field: fieldPointer(fieldSteps(binding.field)) });
    expect(target, binding.field).toBeDefined();
    expect(readField(target!.node!.value, binding.field), binding.field).toBeDefined();
  }
}
function unchanged(document: CompositionDocument) {
  return {
    use: JSON.stringify(document.logicUseBindings!.find(binding => 'nodeId' in binding.use && binding.use.nodeId === 'tile-b')),
    source: JSON.stringify(document.componentLibrary?.[0].bindings?.find(binding => binding.field === 'props/titleProviderId')),
  };
}
function history(draft: Draft, before: CompositionDocument) {
  const after = draft.get();
  expect(after).not.toEqual(before);
  valid(after);
  expect(unchanged(after)).toEqual(unchanged(before));
  act(() => draft.undo());
  expect(draft.get()).toEqual(before);
  valid(draft.get());
  act(() => draft.redo());
  expect(draft.get()).toEqual(after);
  valid(draft.get());
  expect(unchanged(draft.get())).toEqual(unchanged(before));
}
const operations = ['insert text before token', 'remove token', 'remove use', 'remove value', 'replace operand', 'move rule up', 'move rule down', 'remove rule', 'add rule', 'replace rebuilt canvas subtree'] as const;
describe('binding invariant: every structural edit and undo/redo preserves all dependent references', () => {
  for (const kind of ['page tile', 'component anchor', 'component parameters', 'nested operand', 'rule cases']) {
    it.each(operations)(`${kind}: %s compiles, resolves references and preserves unrelated binding bytes`, operation => {
      const { document, slot } = fixture(kind), draft = createDraft(document);
      if (operation.includes('rule')) rules(draft, slot, operation === 'move rule up');
      const before = draft.get();
      valid(before);
      const path = pointerPath(resolveLogicUseBindings(before).bindings[0].usePointer);
      const use = valueAt(before, path) as Operand;
      const changes = vi.fn(() => valid(draft.get()));
      draft.subscribe(changes);
      if (operation === 'insert text before token') writeParts(draft, { path, wrap: 'operand' }, [{ text: 'Before ' }, { token: newToken(use) }], false);
      else if (operation === 'replace rebuilt canvas subtree') draft.set(replaceAt(before, path, structuredClone({ type: 'format', pattern: 'Before {a}', args: { a: use } })));
      else if (operation === 'remove token' || operation === 'remove value') writeParts(draft, { path, wrap: 'operand' }, [], false);
      else if (operation === 'remove use' || operation === 'replace operand') draft.set(replaceAt(before, path, text(operation)));
      else {
        const base = [...slot, 'value', 'cases'], cases = valueAt(before, base) as { when: typeof check; then: Operand }[];
        const next = operation === 'add rule' ? [...cases, { when: check, then: text('Added') }]
          : operation === 'remove rule' ? cases.slice(1) : [...cases].reverse();
        draft.set(replaceAt(before, base, next));
      }
      expect(changes).toHaveBeenCalledTimes(1);
      if (['remove token', 'remove use', 'remove value', 'replace operand', 'remove rule'].includes(operation)) {
        expect(draft.get().logicUseBindings).toHaveLength(before.logicUseBindings!.length - 1);
      } else {
        expect(draft.get().logicUseBindings).toHaveLength(before.logicUseBindings!.length);
      }
      history(draft, before);
      expect(changes).toHaveBeenCalledTimes(3);
    });
  }
});

function mount(document: CompositionDocument, child: ReactNode) {
  render(<WorkspaceDataProvider document={document} house={houseFrom(integrationSnapshot)}>{child}</WorkspaceDataProvider>);
}
it('regression: replacing a tile-bound nested template operand through the real addressed picker is atomic', async () => {
  const { document } = fixture('nested operand'), draft = createDraft(document);
  const path = pointerPath(resolveLogicUseBindings(document).bindings[0].usePointer);
  const observed = vi.fn(() => valid(draft.get()));
  draft.subscribe(observed);
  mount(document, <RowsProvider value={{ document, onChange: next => draft.set(next), onError: vi.fn() }}>
    <AddressedField path={path} kind="operand" label="Operand"/>
  </RowsProvider>);
  fireEvent.click(screen.getByRole('button', { name: /Operand/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Person Using the App' }));
  expect(observed).toHaveBeenCalledTimes(1);
  expect(draft.get().logicUseBindings).toHaveLength(1);
  history(draft, document);
});
it('the workspace apply boundary reconciles raw structural edits before storing undo/redo snapshots', async () => {
  const { document, slot } = fixture('component parameters');
  vi.mocked(request).mockResolvedValueOnce({ document, revision: 1 });
  const { result } = renderHook(useCompositionStudio);
  await waitFor(() => expect(result.current.document).toBe(document));
  const use = valueAt(document, [...slot, 'value']);
  act(() => result.current.apply(replaceAt(document, slot, { type: 'expr', value: { type: 'format', pattern: 'Before {a}', args: { a: use } } })));
  const next = result.current.document!;
  valid(next);
  expect(next.componentLibrary![0].bindings![1].field).toBe('props/subtitle/value/args/a/args/sourceId');
  expect(unchanged(next)).toEqual(unchanged(document));
  act(() => result.current.undo());
  expect(result.current.document).toEqual(document);
  valid(result.current.document!);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(next);
  valid(result.current.document!);
});
it('component parameter references reconcile even without automatic logic-use bindings', () => {
  const { document, slot } = fixture('component parameters');
  const before = { ...document, logicUseBindings: [] }, draft = createDraft(before);
  writeParts(draft, { path: slot, wrap: 'slot' }, [{ text: 'Before ' }, { token: newToken(valueAt(before, [...slot, 'value']) as Operand) }], false);
  expect(draft.get().componentLibrary![0].bindings![1].field).toBe('props/subtitle/value/args/a/args/sourceId');
  valid(draft.get());
  const wrapped = draft.get();
  draft.set(replaceAt(draft.get(), slot, { type: 'literal', value: '' }));
  expect(draft.get().componentLibrary![0].bindings).toEqual([before.componentLibrary![0].bindings![0]]);
  valid(draft.get());
  history(draft, wrapped);
});
it.each(['glyphTint', 'props/subtitle'])('keeps an absent optional component field at %s on its original node', field => {
  const document = compileCompositionDocument(lamps.document).document;
  const before = setPerPlace(document, 'demo-lamp-pair', 'demo-lamp', field);
  compileCompositionDocument(before);
  const draft = createDraft(before), binding = before.componentLibrary![0].bindings![0];
  draft.set(setPerPlace(before, 'demo-lamp-pair', 'demo-fan', 'props/subtitle'));
  const after = draft.get();
  expect(after.componentLibrary![0].bindings![0]).toEqual(binding);
  expect(after.componentLibrary![0].bindings).toHaveLength(2);
  compileCompositionDocument(after);
  draft.undo();
  expect(draft.get()).toEqual(before);
  compileCompositionDocument(draft.get());
  draft.redo();
  expect(draft.get()).toEqual(after);
  compileCompositionDocument(draft.get());
});
it.each(['id', 'type'])('preserves automatic fill when an unrelated text argument named %s changes', name => {
  const { document } = fixture('page tile');
  let before = replaceAt(document, ['logicLibrary', 0, 'params'], [...document.logicLibrary![0].params, { name, kind: 'text' }]);
  for (const binding of before.logicUseBindings!) {
    const path = pointerPath(resolveLogicAnchor(before, binding.use)!.pointer);
    before = replaceAt(before, [...path, 'args', name], 'Before');
  }
  valid(before);
  const draft = createDraft(before), path = pointerPath(resolveLogicUseBindings(before).bindings[0].usePointer);
  draft.set(replaceAt(before, [...path, 'args', name], 'After'));
  expect(draft.get().logicUseBindings).toEqual(before.logicUseBindings);
  history(draft, before);
});
it('does not reconcile ambiguous unbound uses outside the referenced subtrees', () => {
  const { document } = fixture('page tile'), extra = structuredClone(document.pages[0].components[0]);
  const slot = ['pages', 0, 'components', 2, 'props', 'subtitle'];
  let before = replaceAt(document, ['pages', 0, 'components'], [...document.pages[0].components, { ...extra, id: 'unbound' }]);
  const use = valueAt(before, [...slot, 'value']);
  before = replaceAt(before, slot, { type: 'expr', value: { type: 'format', pattern: '{a} {b}', args: { a: use, b: structuredClone(use) } } });
  valid(before);
  const draft = createDraft(before);
  draft.set(replaceAt(before, slot, structuredClone({ ...valueAt(before, slot) as object, fallback: 'Changed' })));
  expect(draft.get().logicUseBindings).toBe(before.logicUseBindings);
  history(draft, before);
});
it('retains binding references while a template rule is unfinished, then compiles when its condition is filled', () => {
  const { document } = fixture('page tile'), draft = createDraft(document);
  draft.set(replaceAt(document, ['logicLibrary', 0, 'body'], {
    type: 'choose', cases: [{ then: text('Then') }], otherwise: text('Otherwise'),
  }));
  expect(draft.get().logicUseBindings).toBe(document.logicUseBindings);
  expect(() => compileCompositionDocument(draft.get())).toThrow();
  draft.set(replaceAt(draft.get(), ['logicLibrary', 0, 'body', 'cases', 0, 'when'], check));
  expect(draft.get().logicUseBindings).toBe(document.logicUseBindings);
  valid(draft.get());
});
it('drops only saved canvas associations whose origins moved, preserving unrelated valid layout', () => {
  const { document } = fixture('page tile');
  let before = document;
  for (const index of [0, 1]) {
    const path = ['pages', 0, 'components', index, 'props', 'subtitle'];
    const graph = liftField(before, path, 'slot').graph, projected = projectGraph(graph);
    before = saveCanvasLayout(before, [{ anchor: graph.roots[0].anchor, ast: projected.ast }], {
      graph, sourceMap: projected.sourceMap, positions: Object.fromEntries(graph.nodes.map(node => [node.id, { x: 120, y: 240 }])),
    });
  }
  const draft = createDraft(before), stored = before.studioCanvas;
  const path = pointerPath(resolveLogicUseBindings(before).bindings[0].usePointer);
  writeParts(draft, { path, wrap: 'operand' }, [{ text: 'Before ' }, { token: newToken(valueAt(before, path) as Operand) }], false);
  expect(readStudioCanvas(draft.get()).warnings).toEqual([]);
  expect(draft.get().studioCanvas).not.toEqual(stored);
  expect(readStudioCanvas(draft.get()).metadata!.canvases).toHaveLength(1);
  history(draft, before);
});
it('regression: the real rule keyboard reorder and RulePage Remove Rule keep bindings valid through undo and redo', () => {
  const { document, slot } = fixture('rule cases'), draft = createDraft(document);
  const observed = vi.fn(() => valid(draft.get()));
  draft.subscribe(observed);
  const view = render(<RulesList draft={draft} path={slot} kind="text" label="Subtitle"/>);
  const grip = screen.getByRole('button', { name: /^Rule 1 of 2: drag to move/ });
  fireEvent.keyDown(grip, { key: ' ' });
  fireEvent.keyDown(grip, { key: 'ArrowDown' });
  expect(draft.get().logicUseBindings![0].use.field).toContain('/cases/1/then');
  expect(observed).toHaveBeenCalledTimes(1);
  history(draft, document);
  const moved = draft.get();
  view.rerender(<RulePage draft={draft} path={slot} kind="text" index={1} label="Subtitle"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Rule' }));
  expect(draft.get().logicUseBindings).toHaveLength(1);
  history(draft, moved);
});
it.each(['type before token', 'remove token'])('regression: setPerPlace component argument binding survives %s and undo/redo', change => {
  const { document, slot } = fixture('component parameters'), draft = createDraft(document);
  expect(document.componentLibrary![0].bindings![1].field).toBe('props/subtitle/value/args/sourceId');
  const observed = vi.fn(() => valid(draft.get()));
  draft.subscribe(observed);
  if (change === 'type before token') {
    mount(document, <TokenField draft={draft} address={{ path: slot, wrap: 'slot' }} label="Subtitle"/>);
    const input = screen.getByRole('textbox', { name: 'Subtitle' });
    input.prepend(globalThis.document.createTextNode('Before '));
    fireEvent.input(input);
    expect(draft.get().componentLibrary![0].bindings![1].field).toBe('props/subtitle/value/args/a/args/sourceId');
  } else {
    mount(document, <TokenSettings draft={draft} address={{ path: slot, wrap: 'slot' }} index={0} inline/>);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Value' }));
    expect(draft.get().componentLibrary![0].bindings).toHaveLength(1);
  }
  expect(observed).toHaveBeenCalledTimes(1);
  history(draft, document);
});
