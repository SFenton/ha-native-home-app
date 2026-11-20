// @vitest-environment jsdom
/**
 * The operations that change linked meaning on purpose (docs/flows-canvas.md, "Declared operations"): Import, Remove Setting,
 * a field's type change, reordering a flow's steps and a canvas Apply over a template body's slot view. Each declares what it
 * removes or moves, so it is applied as one undo step; the same change made without its declaration is still refused.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compositionSourceText, fieldVariants, importCompositionText, nodeDefinition, replaceAt, valueAt, variantName, type EditorPath } from '../../../src/composition-editor';
import CompositionFields from '../../../src/CompositionFields';
import { CompositionValidationError } from '../../../src/shared/composition/json';
import { encodeStudioCanvas, readStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../../src/shared/composition/studio-logic/schemas';
import type { CompositionDocument } from '../../../src/shared/composition/schema';
import type { Operand } from '../../../src/shared/composition/expression';
import type { Json } from '../../../src/shared/types';
import { createDraft } from '../../../src/workspace2/editors/draft';
import { LINKED_EDIT_REFUSAL } from '../../../src/workspace2/editors/documentEdit';
import { changeFieldType, replaceDocument } from '../../../src/workspace2/editors/provenance';
import { moveFlowStep, newFlow, updateFlow } from '../../../src/workspace2/data/flow';
import LogicSettings from '../../../src/workspace2/data/logic/LogicSettings';
import { removeSettingPlan } from '../../../src/workspace2/data/logic/logicModel';
import { LogicFieldsProvider, bodyFromSlotView, canonicalBody, operandBodyDraft, slotBodyView, useLogicFields } from '../../../src/workspace2/logic-fields/LogicFields';
import { liftField } from '../../../src/workspace2/logic-fields/registry';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { toastManager } from '../../../src/workspace2/toasts';
import { houseFrom } from '../../../src/preview2/projections';
import { LiveHouse } from '../../../src/preview2/live-house';
import { deriveTheme } from '../../../src/workspace2/theme';
import { resetLiveRuns } from '../../../src/workspace2/data/liveRun';
import { Project } from '../../support/workspace2-surfaces';
import { prepareDraft } from '../../../server/studio-logic/prepare';
import { integrationSnapshot } from './fixture';
import { check, fixture, meaningFixture, text, valid, withMeaningCanvas } from './meaning-fixtures';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const linked = () => { const made = meaningFixture('page tile', 'fallback'); return withMeaningCanvas(made.document, made.slot); };
const refusals = () => vi.spyOn(toastManager, 'add');
const refused = (notice: ReturnType<typeof refusals>) => notice.mock.calls.filter(([toast]) => toast.title === LINKED_EDIT_REFUSAL).length;

describe('Import replaces the document', () => {
  it('takes the imported links as authored and keeps none of the current ones, as one undo step', () => {
    const before = linked(), component = fixture('component parameters').document;
    const imported = importCompositionText(compositionSourceText({ ...component, name: 'Imported' }), before.id);
    const draft = createDraft(before), notice = refusals();
    draft.set(replaceDocument(before, imported));
    expect(refused(notice)).toBe(0);
    expect(draft.get()).toEqual(imported);
    expect(draft.get().logicUseBindings).toEqual(imported.logicUseBindings);
    expect(draft.get().componentLibrary).toEqual(imported.componentLibrary);
    expect(draft.get().studioCanvas).toBeUndefined();
    valid(draft.get());
    const after = draft.get();
    act(() => draft.undo()); expect(draft.get()).toBe(before); expect(draft.canUndo()).toBe(false);
    act(() => draft.redo()); expect(draft.get()).toBe(after);
  });

  it('is refused whole when the replacement is not declared', () => {
    const before = linked(), imported = importCompositionText(compositionSourceText(fixture('component parameters').document), before.id);
    const draft = createDraft(before), notice = refusals();
    draft.set(imported);
    expect(draft.get()).toBe(before); expect(draft.canUndo()).toBe(false);
    expect(refused(notice)).toBe(1);
  });

  it('rejects an invalid import with its validation issues and never repairs it', () => {
    const before = linked();
    const missing = { ...before, logicUseBindings: [...before.logicUseBindings!, { ...before.logicUseBindings![0], logicId: 'no-such-template' }] };
    expect(() => importCompositionText(compositionSourceText(missing), before.id)).toThrow(CompositionValidationError);
    const layout = studioCanvasMetadataSchema.parse(before.studioCanvas);
    const stale = { ...before, studioCanvas: { ...layout, canvases: layout.canvases.map((canvas, index) => index ? canvas : { ...canvas, nodes: canvas.nodes.map(node => ({ ...node, origins: ['/not/here'] })) }) } };
    expect(readStudioCanvas(stale).warnings).not.toEqual([]);
    let issues: unknown;
    try { importCompositionText(compositionSourceText(stale), before.id); } catch (error) { issues = error instanceof CompositionValidationError ? error.issues : error; }
    expect(issues).toEqual([{ code: 'invalid_value', pointer: '/document/studioCanvas' }]);
  });
});

describe('Remove Setting asks before tiles lose the value they fill in', () => {
  const sampled = () => replaceAt(linked(), ['logicLibrary', 0, 'params', 0], { name: 'source', kind: 'source-id', label: 'Source', sample: 'source-b' });
  function Settings({ draft }: { draft: ReturnType<typeof createDraft> }) {
    return <WorkspaceDataProvider document={draft.get()} house={houseFrom(integrationSnapshot)}>
      <LogicSettings draft={draft} document={draft.get()} id="tile-label" onError={message => { throw new Error(message); }} apply={next => draft.set(next)}/>
    </WorkspaceDataProvider>;
  }
  const open = (draft: ReturnType<typeof createDraft>) => {
    const view = render(<Settings draft={draft}/>);
    fireEvent.click(screen.getByRole('button', { name: /^Source, Entity/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Setting' }));
    return view;
  };

  it('names how many tiles lose their link; Cancel changes nothing', () => {
    const before = sampled(), draft = createDraft(before);
    open(draft);
    const question = screen.getByTestId('link-loss-question');
    expect(within(question).getByText('Remove “Source”?')).toBeTruthy();
    expect(within(question).getByText('2 tiles that fill it in will lose that value.')).toBeTruthy();
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('link-loss-question')).toBeNull();
    expect(draft.get()).toBe(before); expect(draft.canUndo()).toBe(false);
  });

  it('on confirm removes exactly the bindings and values that filled it in, as one undo step', () => {
    const before = sampled(), draft = createDraft(before), notice = refusals();
    const view = open(draft);
    fireEvent.click(within(screen.getByTestId('link-loss-question')).getByRole('button', { name: 'Remove Setting' }));
    expect(refused(notice)).toBe(0);
    const after = draft.get();
    expect(after).toEqual(removeSettingPlan(before, 'tile-label', 'source').document);
    expect(after.logicUseBindings).toEqual(before.logicUseBindings!.filter(binding => binding.logicId !== 'tile-label'));
    expect(after.componentLibrary).toEqual(before.componentLibrary);
    for (const index of [0, 1]) expect(valueAt(after, ['pages', 0, 'components', index, 'props', 'subtitle', 'value', 'args'])).toEqual({});
    expect(after.logicLibrary![0].params).toEqual([]);
    valid(after);
    view.unmount();
    act(() => draft.undo()); expect(draft.get()).toBe(before); expect(draft.canUndo()).toBe(false);
    act(() => draft.redo()); expect(draft.get()).toBe(after);
  });

  it('asks nothing when no tile fills the setting in', () => {
    const base = sampled(), before = { ...base, logicUseBindings: base.logicUseBindings!.filter(binding => binding.logicId !== 'tile-label') };
    const draft = createDraft(before);
    open(draft);
    expect(screen.queryByTestId('link-loss-question')).toBeNull();
    expect(draft.get().logicLibrary![0].params).toEqual([]);
    expect(draft.canUndo()).toBe(true);
  });

  it('counts each place of a tile template that fills it in, and refuses a Try With value the body cannot read', () => {
    const { document } = fixture('component parameters');
    const sampledComponent = replaceAt(document, ['logicLibrary', 0, 'params', 0, 'sample'], 'source-b');
    expect(removeSettingPlan(sampledComponent, 'tile-label', 'sourceId').tiles).toBe(3);
    expect(() => removeSettingPlan(document, 'tile-label', 'sourceId')).toThrow('Give “sourceId” a Try With value its template can read, then remove it.');
  });
});

describe("A field's type change asks before linked values go", () => {
  const root: EditorPath = ['pages', 0, 'components', 0];
  const textType = () => fieldVariants(nodeDefinition()).find(type => variantName(type) === 'text')!;
  function Fields({ draft }: { draft: ReturnType<typeof createDraft> }) {
    return <CompositionFields schema={nodeDefinition()} value={valueAt(draft.get(), root) as Json} path={root} label="Tile" document={draft.get()}
      onChange={next => draft.set(next)} onError={message => { throw new Error(message); }}/>;
  }
  const pick = () => fireEvent.change(screen.getByLabelText('Tile type'), { target: { value: String(fieldVariants(nodeDefinition()).indexOf(textType())) } });

  it('names what loses its link; Cancel changes nothing; confirm applies the declared change as one step', () => {
    const before = linked(), draft = createDraft(before), notice = refusals();
    const view = render(<Fields draft={draft}/>);
    pick();
    const question = screen.getByTestId('link-loss-question');
    expect(within(question).getByText('Change Tile to text?')).toBeTruthy();
    expect(within(question).getByText("1 linked value and 1 saved canvas layout can't carry over to text, so they will be removed.")).toBeTruthy();
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(draft.get()).toBe(before);
    pick();
    fireEvent.click(within(screen.getByTestId('link-loss-question')).getByRole('button', { name: 'Change Type' }));
    expect(refused(notice)).toBe(0);
    const after = draft.get();
    expect(after).toEqual(changeFieldType(before, root, textType(), 'tile').document);
    expect(after.logicUseBindings).toEqual(before.logicUseBindings!.filter(binding => !('nodeId' in binding.use) || binding.use.nodeId !== 'tile-a'));
    valid(after);
    view.unmount();
    act(() => draft.undo()); expect(draft.get()).toBe(before);
    act(() => draft.redo()); expect(draft.get()).toBe(after);
  });

  it('keeps a binding whose target the new type copies unchanged (the title), and removes the rest', () => {
    const base = fixture('component tile').document;
    const before = replaceAt(base, ['componentLibrary', 0], { ...base.componentLibrary![0],
      params: [...base.componentLibrary![0].params!, { name: 'heading', kind: 'text' }],
      bindings: [...base.componentLibrary![0].bindings!, { param: 'heading', nodeId: 'inner-tile', field: 'title' }] });
    const placed = before.pages[0].components.map(node => node.type === 'component-ref' ? { ...node, args: { ...node.args, heading: `Heading ${node.id}` } } : node);
    const document = { ...before, pages: [{ ...before.pages[0], components: placed }, ...before.pages.slice(1)] } as CompositionDocument;
    valid(document);
    const change = changeFieldType(document, ['componentLibrary', 0, 'node'], textType(), 'node');
    expect(change.document).not.toBe(document);
    expect(change.document.componentLibrary![0].bindings).toEqual([{ param: 'heading', nodeId: 'inner-tile', field: 'title' }]);
    expect(change.bindings).toBe(2);
  });

  it('is refused whole when the type change is not declared', () => {
    const before = linked(), draft = createDraft(before), notice = refusals();
    draft.set(replaceAt(before, root, structuredClone(changeFieldType(before, root, textType(), 'tile').document.pages[0].components[0])));
    expect(draft.get()).toBe(before); expect(refused(notice)).toBe(1);
  });
});

describe('Reordering flow steps carries their saved layout', () => {
  function withFlowLayout() {
    const made = newFlow(linked(), 'group');
    let document = updateFlow(made.document, made.id, inputs => ({ ...inputs, steps: [{ id: 'one', op: 'limit', count: 10 }, { id: 'two', op: 'limit', count: 20 }] }));
    const at = document.dataSources.findIndex(source => source.id === made.id), graph = liftField(document, ['dataSources', at, 'inputs'], 'flow').graph;
    const extra = encodeStudioCanvas(document, [{ id: 'flow-layout', roots: [{ anchor: graph.roots[0].anchor, nodes: graph.nodes.map(node => ({ id: node.id, origins: node.origins, x: 40, y: 700 })) }] }]);
    const stored = studioCanvasMetadataSchema.parse(document.studioCanvas);
    document = { ...document, studioCanvas: { ...stored, canvases: [...stored.canvases, ...extra.canvases] } };
    return { document, id: made.id, at };
  }

  it('moves a step without asking, keeps every node position and link, and is one undo step', () => {
    const { document, id, at } = withFlowLayout(), draft = createDraft(document), notice = refusals();
    draft.set(moveFlowStep(document, id, 0, 1));
    expect(refused(notice)).toBe(0);
    const after = draft.get();
    expect((valueAt(after, ['dataSources', at, 'inputs', 'steps']) as { id: string }[]).map(step => step.id)).toEqual(['two', 'one']);
    expect(after.logicUseBindings).toBe(document.logicUseBindings);
    const layout = (value: CompositionDocument) => studioCanvasMetadataSchema.parse(value.studioCanvas).canvases;
    expect(layout(after).slice(0, -1)).toEqual(layout(document).slice(0, -1));
    expect(layout(after).at(-1)!.nodes.map(node => [node.origins, node.x, node.y])).toEqual([[[''], 40, 700]]);
    valid(after);
    act(() => draft.undo()); expect(draft.get()).toBe(document);
    act(() => draft.redo()); expect(draft.get()).toBe(after);
  });

  it('does nothing past either end, and is refused whole when the move is not declared', () => {
    const { document, id } = withFlowLayout();
    expect(moveFlowStep(document, id, 0, -1)).toBe(document);
    expect(moveFlowStep(document, id, 1, 1)).toBe(document);
    const draft = createDraft(document), notice = refusals();
    draft.set(updateFlow(document, id, inputs => ({ ...inputs, steps: [inputs.steps[1], inputs.steps[0]] })));
    expect(draft.get()).toBe(document); expect(refused(notice)).toBe(1);
  });
});

describe('Canvas Apply over a template body slot view in a linked document', () => {
  beforeEach(() => {
    vi.useFakeTimers(); resetLiveRuns();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => { resetLiveRuns(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const path: EditorPath = ['logicLibrary', 1, 'body'];
  /** A linked document (automatic bindings, component bindings, saved layouts) whose `other-label` body is a rule, so its slot view wraps it. */
  function document(bodyLayout: boolean) {
    let value = linked();
    value = replaceAt(value, path, { type: 'choose', cases: [{ when: check, then: valueAt(value, path) }], otherwise: text('Guest') });
    if (bodyLayout) {
      const graph = liftField(value, path, 'operand').graph, stored = studioCanvasMetadataSchema.parse(value.studioCanvas);
      const extra = encodeStudioCanvas(value, [{ id: 'body-layout', roots: [{ anchor: graph.roots[0].anchor, nodes: graph.nodes.map((node, at) => ({ id: node.id, origins: node.origins, x: at * 80, y: 500 })) }] }]);
      value = { ...value, studioCanvas: { ...stored, canvases: [...stored.canvases, ...extra.canvases] } };
    }
    valid(value);
    return value;
  }
  const roots = (value: CompositionDocument) => studioCanvasMetadataSchema.parse(value.studioCanvas).canvases.flatMap(canvas => canvas.roots.map(root => root.anchor));
  const others = (value: CompositionDocument) => studioCanvasMetadataSchema.parse(value.studioCanvas).canvases.filter(canvas => !canvas.roots.some(root => root.anchor.kind === 'logic'));
  async function applyOnCanvas(real: CompositionDocument, open: (canvas: NonNullable<ReturnType<typeof useLogicFields>>) => void) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => Response.json(prepareDraft(JSON.parse(String(init?.body)).document)));
    function Controls() { const canvas = useLogicFields()!; return <button type="button" onClick={() => open(canvas)}>Open</button>; }
    render(<WorkspaceDataProvider document={real} house={new LiveHouse().house}>
      <LogicFieldsProvider ws={Project.workspace(real)} theme={deriveTheme({}, false)}><Controls/></LogicFieldsProvider>
    </WorkspaceDataProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' })));
  }

  it('applies a rule edit where the slot view holds the body, as one step, and Done hands it back canonically', async () => {
    const real = document(false), pushed = createDraft(slotBodyView(real, path, valueAt(real, path) as Operand)), opened = pushed.get(), notice = refusals();
    await applyOnCanvas(real, canvas => canvas.open({ draft: pushed, path: [...path, 'value', 'cases', 0, 'when'], kind: 'condition', label: 'Rule', combine: 'all' }));
    expect(screen.getAllByText('Edits applied to the draft. Not published.').length).toBeGreaterThan(0);
    expect(refused(notice)).toBe(0);
    const applied = pushed.get();
    expect(valueAt(applied, [...path, 'value', 'cases', 0, 'when'])).toEqual({ type: 'all', of: [check, check] });
    expect(applied.logicUseBindings).toBe(opened.logicUseBindings);
    expect(applied.componentLibrary).toBe(opened.componentLibrary);
    expect(others(applied)).toEqual(others(opened));
    expect(roots(applied).filter(anchor => anchor.kind === 'logic')).toEqual([{ kind: 'logic', id: 'other-label', field: '/body/value' }]);
    act(() => pushed.undo()); expect(pushed.get()).toBe(opened);
    act(() => pushed.redo()); expect(pushed.get()).toBe(applied);

    const target = createDraft(real);
    target.set(bodyFromSlotView(real, applied, path));
    expect(refused(notice)).toBe(0);
    const done = target.get();
    expect(valueAt(done, [...path, 'cases', 0, 'when'])).toEqual({ type: 'all', of: [check, check] });
    expect(done.logicUseBindings).toBe(real.logicUseBindings);
    expect(done.componentLibrary).toBe(real.componentLibrary);
    expect(others(done)).toEqual(others(real));
    expect(roots(done).filter(anchor => anchor.kind === 'logic')).toEqual([{ kind: 'logic', id: 'other-label', field: '/body' }]);
    valid(done);

    // The same edit written into the slot view without the slot mapping (its layout anchored canonically): refused whole.
    const naive = createDraft(opened);
    naive.set(replaceAt(canonicalBody(applied, path), path, valueAt(applied, path)));
    expect(naive.get()).toBe(opened); expect(naive.canUndo()).toBe(false); expect(refused(notice)).toBe(1);
  });

  it('carries the body\'s saved layout into the slot view, through Apply, and back on Done', async () => {
    const real = document(true), view = slotBodyView(real, path, valueAt(real, path) as Operand), notice = refusals();
    expect(readStudioCanvas(view).warnings).toEqual([]);
    expect(roots(view).filter(anchor => anchor.kind === 'logic')).toEqual([{ kind: 'logic', id: 'other-label', field: '/body/value' }]);
    const pushed = createDraft(view);
    // As the value editor opens it: through the canonical view of its slot view.
    await applyOnCanvas(real, canvas => canvas.open({ draft: operandBodyDraft(pushed, path), path, kind: 'operand', label: 'Logic' }));
    expect(screen.getAllByText('Edits applied to the draft. Not published.').length).toBeGreaterThan(0);
    expect(refused(notice)).toBe(0);
    const applied = pushed.get(), body = (value: CompositionDocument) => studioCanvasMetadataSchema.parse(value.studioCanvas).canvases.find(canvas => canvas.id === 'body-layout')!;
    expect(pushed.canUndo()).toBe(true);
    expect(body(applied).nodes.map(node => [node.origins, node.x, node.y])).toEqual(body(view).nodes.map(node => [node.origins, node.x, node.y]));
    const done = bodyFromSlotView(real, applied, path), target = createDraft(real);
    target.set(done);
    expect(target.get()).toBe(done); expect(refused(notice)).toBe(0);
    expect(body(done)).toEqual(body(real));
    expect(others(done)).toEqual(others(real));
    expect(done.logicUseBindings).toBe(real.logicUseBindings);
  });
});
