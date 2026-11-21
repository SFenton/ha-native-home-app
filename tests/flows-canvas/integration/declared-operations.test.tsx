// @vitest-environment jsdom
/**
 * The operations that change linked meaning on purpose (docs/flows-canvas.md, "Declared operations"): Import, Remove Setting,
 * a field's type change, reordering a flow's steps and a canvas Apply over a template body's slot view. Each declares what it
 * removes or moves, so it is applied as one undo step; the same change made without its declaration is still refused.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compilerIssuesOf, compositionEditorSchema, compositionSourceText, fieldVariants, resolveField, importCompositionText, nodeDefinition, replaceAt, valueAt, variantName, type EditorPath } from '../../../src/composition-editor';
import CompositionFields from '../../../src/CompositionFields';
import { CompositionValidationError } from '../../../src/shared/composition/json';
import { encodeStudioCanvas, readStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../../src/shared/composition/studio-logic/schemas';
import type { CompositionDocument } from '../../../src/shared/composition/schema';
import type { Operand } from '../../../src/shared/composition/expression';
import type { Json } from '../../../src/shared/types';
import { createDraft, useDraftDocument } from '../../../src/workspace2/editors/draft';
import { DialogBody } from '../../../src/workspace2/projectDialogs';
import StepList from '../../../src/workspace2/data/StepList';
import { RowsProvider } from '../../../src/workspace2/rowsContext';
import { documentEdit, LINKED_EDIT_REFUSAL } from '../../../src/workspace2/editors/documentEdit';
import { operandSlot } from '../../../src/workspace2/expr/tokens';
import { changeFieldType, compiledBeyond, editWithin, fieldTypeEdit, replaceDocument } from '../../../src/workspace2/editors/provenance';
import { flowStepMoveEdit, moveFlowStep, newFlow, updateFlow } from '../../../src/workspace2/data/flow';
import LogicSettings from '../../../src/workspace2/data/logic/LogicSettings';
import { removeSettingPlan } from '../../../src/workspace2/data/logic/logicModel';
import { LogicFieldsProvider, bodyFromSlotView, canonicalBody, combinedSourceMap, operandBodyDraft, slotApplyEdit, slotBodyView, useLogicFields } from '../../../src/workspace2/logic-fields/LogicFields';
import { fieldAnchor, fieldPointer, liftField } from '../../../src/workspace2/logic-fields/registry';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { toastManager } from '../../../src/workspace2/toasts';
import { houseFrom } from '../../../src/preview2/projections';
import { projectGraph } from '../../../src/shared/composition/graph';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { binding, componentDocument, tile } from '../draft/fixtures';
import { LiveHouse } from '../../../src/preview2/live-house';
import { deriveTheme } from '../../../src/workspace2/theme';
import { resetLiveRuns } from '../../../src/workspace2/data/liveRun';
import { Project } from '../../support/workspace2-surfaces';
import { prepareDraft } from '../../../server/studio-logic/prepare';
import { integrationSnapshot } from './fixture';
import { sameJson } from '../../../src/sameJson';
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

  /** Two linked tiles inside one tile template, the template placed twice: four tiles fill the setting in. */
  function pairedTemplate(secondLinkOnFirstTile: boolean) {
    const raw = componentDocument(), inner = raw.componentLibrary[0].node;
    const first = secondLinkOnFirstTile ? { ...inner, visibleWhen: { type: 'compare', op: 'eq', left: structuredClone(inner.props.subtitle.value), right: text('Demo') }, whenUnknown: 'keep' } : inner;
    const bindings = ['inner-tile', 'inner-second'].map(nodeId => ({ ...binding(nodeId), use: { kind: 'component', id: 'saved-tile', nodeId, field: '/props/subtitle/value' } }));
    if (secondLinkOnFirstTile) bindings.push({ ...binding('inner-tile'), use: { kind: 'component', id: 'saved-tile', nodeId: 'inner-tile', field: '/visibleWhen/left' } });
    return compileCompositionDocument({
      ...raw,
      logicLibrary: raw.logicLibrary.map(entry => ({ ...entry, params: [{ name: 'source', kind: 'source-id', sample: 'source-b' }] })),
      componentLibrary: [{ ...raw.componentLibrary[0], node: { id: 'pair', type: 'stack', title: 'Pair', layout: { span: 1 },
        props: { axis: 'vertical', spacing: { type: 'token', name: 's' } }, children: [first, tile('inner-second', 'source-a')] } }],
      logicUseBindings: bindings,
    } as unknown as CompositionDocument).document;
  }

  it('counts each linked tile inside a tile template at each of its placements', () => {
    const before = pairedTemplate(false);
    expect(before.pages[0].components.filter(node => node.type === 'component-ref')).toHaveLength(2);
    const plan = removeSettingPlan(before, 'tile-label', 'source');
    expect(plan.tiles).toBe(4);
    expect(plan.document.logicUseBindings).toEqual([]);
    valid(plan.document);
  });

  it('counts a tile once however many of its links are lost, but each different tile in the template', () => {
    const before = pairedTemplate(true);
    expect(before.logicUseBindings).toHaveLength(3);
    const plan = removeSettingPlan(before, 'tile-label', 'source');
    expect(plan.tiles).toBe(4);
    expect(plan.document.logicUseBindings).toEqual([]);
    // On a page: tile-a with two links and tile-b with one are two tiles.
    const base = replaceAt(linked(), ['logicLibrary', 0, 'params', 0, 'sample'], 'source-b'), root = ['pages', 0, 'components', 0];
    const use = structuredClone(valueAt(base, ['pages', 0, 'components', 0, 'props', 'subtitle', 'value']));
    const twice = replaceAt(base, root, { ...valueAt(base, root) as object, visibleWhen: { type: 'compare', op: 'eq', left: use, right: text('sensor.demo_1') }, whenUnknown: 'keep' });
    const page = { ...twice, logicUseBindings: [...twice.logicUseBindings!, { ...twice.logicUseBindings![0], use: { ...twice.logicUseBindings![0].use, field: '/visibleWhen/left' } }] };
    valid(page);
    expect(removeSettingPlan(page, 'tile-label', 'source').tiles).toBe(2);
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
    // The very candidate the type change makes, without what it declares.
    draft.set(fieldTypeEdit(before, root, textType(), 'tile').candidate);
    expect(draft.get()).toBe(before); expect(refused(notice)).toBe(1);
    // Declared, the same change also refuses an unrelated binding removal made with it.
    const edit = fieldTypeEdit(before, root, textType(), 'tile');
    expect(editWithin(before, { ...edit, candidate: { ...edit.candidate, logicUseBindings: edit.candidate.logicUseBindings!.slice(0, 2) } })).toBe(before);
    expect(refused(notice)).toBe(2);
  });
});

describe('Reordering flow steps carries their saved layout', () => {
  /** A flow of two steps with a saved layout of the whole flow: a node per step and per input, each at its own place and in its own group. */
  function withFlowLayout() {
    const made = newFlow(linked(), 'group');
    let document = updateFlow(made.document, made.id, inputs => ({ ...inputs, steps: [{ id: 'one', op: 'limit', count: 10 }, { id: 'two', op: 'limit', count: 20 }] }));
    const at = document.dataSources.findIndex(source => source.id === made.id), graph = liftField(document, ['dataSources', at], 'flow').graph;
    const extra = encodeStudioCanvas(document, [{ id: 'flow-layout', roots: [{ anchor: graph.roots[0].anchor, nodes: graph.nodes.map((node, index) => ({ id: node.id, origins: node.origins, x: index * 100, y: 700 + index * 40 })) }] }]);
    extra.canvases[0].groups = extra.canvases[0].nodes.map((node, index) => ({ id: `group-${index}`, label: `Group ${index}`, nodeIds: [node.id] }));
    const stored = studioCanvasMetadataSchema.parse(document.studioCanvas);
    document = { ...document, studioCanvas: { ...stored, canvases: [...stored.canvases, ...extra.canvases] } };
    valid(document);
    return { document, id: made.id, at, saved: extra.canvases[0] };
  }
  const flowCanvas = (value: CompositionDocument) => studioCanvasMetadataSchema.parse(value.studioCanvas).canvases.find(canvas => canvas.id === 'flow-layout')!;

  it('moves a step without asking, each step\'s node keeping its position and group, and is one undo step', () => {
    const { document, id, at, saved } = withFlowLayout(), draft = createDraft(document), notice = refusals();
    const steps = saved.nodes.filter(node => node.origins.some(origin => /^\/inputs\/steps\/[01](?:\/|$)/.test(origin)));
    expect(new Set(steps.map(node => node.origins[0].split('/')[3])).size).toBe(2);
    draft.set(moveFlowStep(document, id, 0, 1));
    expect(refused(notice)).toBe(0);
    const after = draft.get();
    expect((valueAt(after, ['dataSources', at, 'inputs', 'steps']) as { id: string }[]).map(step => step.id)).toEqual(['two', 'one']);
    expect(after.logicUseBindings).toBe(document.logicUseBindings);
    const layout = (value: CompositionDocument) => studioCanvasMetadataSchema.parse(value.studioCanvas).canvases.filter(canvas => canvas.id !== 'flow-layout');
    expect(layout(after)).toEqual(layout(document));
    // Every node follows its step: origins under step 0 are now under step 1 and back, at the same place, in the same group.
    const held = flowCanvas(after), swap = (origin: string) => origin.replace(/^\/inputs\/steps\/([01])(?=\/|$)/, (_, index) => `/inputs/steps/${index === '0' ? 1 : 0}`);
    expect(held.nodes).toHaveLength(saved.nodes.length);
    for (const old of saved.nodes) {
      const moved = held.nodes.find(node => JSON.stringify(node.origins) === JSON.stringify(old.origins.map(swap)));
      expect(moved, old.origins.join(',')).toBeDefined();
      expect([moved!.x, moved!.y]).toEqual([old.x, old.y]);
      expect(held.groups!.filter(group => group.nodeIds.includes(moved!.id)).map(group => group.id)).toEqual(saved.groups!.filter(group => group.nodeIds.includes(old.id)).map(group => group.id));
    }
    expect(readStudioCanvas(after).warnings).toEqual([]);
    valid(after);
    act(() => draft.undo()); expect(draft.get()).toBe(document);
    act(() => draft.redo()); expect(draft.get()).toBe(after);
  });

  it('does nothing past either end; the same move undeclared, or with an unrelated binding removal, is refused whole', () => {
    const { document, id } = withFlowLayout();
    expect(moveFlowStep(document, id, 0, -1)).toBe(document);
    expect(moveFlowStep(document, id, 1, 1)).toBe(document);
    const draft = createDraft(document), notice = refusals(), edit = flowStepMoveEdit(document, id, 0, 1)!;
    draft.set(edit.candidate);
    expect(draft.get()).toBe(document); expect(refused(notice)).toBe(1);
    expect(editWithin(document, { ...edit, candidate: { ...edit.candidate, logicUseBindings: edit.candidate.logicUseBindings!.slice(1) } })).toBe(document);
    expect(refused(notice)).toBe(2);
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
    // A clone, as a parsed document holds it: the fixture's two templates share one body object, which no JSON document can.
    value = replaceAt(value, path, { type: 'choose', cases: [{ when: check, then: structuredClone(valueAt(value, path)) }], otherwise: text('Guest') });
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

    // The control: the applied slot view's own content in its own frame (its body and saved layout, offered afresh so no
    // accepted revision vouches for it), differing from the Apply only in having no declaration, is refused whole.
    const fresh = { ...replaceAt(opened, path, valueAt(applied, path)), studioCanvas: applied.studioCanvas } as CompositionDocument;
    expect(sameJson(fresh, applied)).toBe(true);
    const naive = createDraft(opened);
    naive.set(fresh);
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

  /** `document(true)` with every node of the body's saved layout in one group, when asked. */
  const grouped = (groups: boolean) => {
    const value = document(true);
    if (!groups) return value;
    const stored = studioCanvasMetadataSchema.parse(value.studioCanvas);
    return { ...value, studioCanvas: { ...stored, canvases: stored.canvases.map(canvas => canvas.id === 'body-layout' ? { ...canvas, groups: [{ id: 'all', label: 'All', nodeIds: canvas.nodes.map(node => node.id) }] } : canvas) } };
  };
  const bodyCanvas = (value: CompositionDocument) => studioCanvasMetadataSchema.parse(value.studioCanvas).canvases.find(canvas => canvas.id === 'body-layout')!;

  it.each([false, true])('adds an And check inside a body that has a saved layout, through the slot view and canonically; groups=%s', async groups => {
    const real = grouped(groups), view = slotBodyView(real, path, valueAt(real, path) as Operand), pushed = createDraft(view), notice = refusals();
    await applyOnCanvas(real, canvas => canvas.open({ draft: pushed, path: [...path, 'value', 'cases', 0, 'when'], kind: 'condition', label: 'Rule', combine: 'all' }));
    expect(screen.getAllByText('Edits applied to the draft. Not published.').length).toBeGreaterThan(0);
    expect(refused(notice)).toBe(0);
    const applied = pushed.get();
    expect(valueAt(applied, [...path, 'value', 'cases', 0, 'when'])).toEqual({ type: 'all', of: [check, check] });
    expect(applied.logicUseBindings).toBe(view.logicUseBindings);
    expect(others(applied)).toEqual(others(view));
    // The body's saved layout is the one the canvas handed back (a combine tidies the canvas, so positions are its own): the
    // same root, every node it had still placed (origins under the combined check now in its copies), and the group kept.
    const kept = bodyCanvas(applied), previous = bodyCanvas(view);
    expect(kept.roots.map(root => root.anchor)).toEqual([{ kind: 'logic', id: 'other-label', field: '/body/value' }]);
    expect(kept.nodes.length).toBeGreaterThan(previous.nodes.length);
    const placedOrigins = new Set(kept.nodes.flatMap(node => node.origins));
    for (const node of previous.nodes) for (const origin of node.origins)
      expect(placedOrigins.has(origin) || placedOrigins.has(origin.replace(/^\/cases\/0\/when(?=\/|$)/, '/cases/0/when/of/0')), origin).toBe(true);
    if (groups) {
      const group = kept.groups!.find(group => group.id === 'all')!;
      expect(group.nodeIds.length).toBeGreaterThanOrEqual(previous.nodes.length);
      for (const id of group.nodeIds) expect(kept.nodes.some(node => node.id === id)).toBe(true);
    } else expect(kept.groups ?? []).toEqual([]);
    expect(readStudioCanvas(applied).warnings).toEqual([]);
    act(() => pushed.undo()); expect(pushed.get()).toBe(view);
    act(() => pushed.redo()); expect(pushed.get()).toBe(applied);
    const done = createDraft(real);
    done.set(bodyFromSlotView(real, applied, path));
    expect(refused(notice)).toBe(0);
    expect(valueAt(done.get(), [...path, 'cases', 0, 'when'])).toEqual({ type: 'all', of: [check, check] });
    expect(bodyCanvas(done.get()).roots.map(root => root.anchor)).toEqual([{ kind: 'logic', id: 'other-label', field: '/body' }]);
    valid(done.get());
    cleanup();

    // The same edit on the canonical body (no slot view) is applied too.
    const canonical = createDraft(real);
    await applyOnCanvas(real, canvas => canvas.open({ draft: canonical, path: [...path, 'cases', 0, 'when'], kind: 'condition', label: 'Rule', combine: 'all' }));
    expect(refused(notice)).toBe(0);
    expect(valueAt(canonical.get(), [...path, 'cases', 0, 'when'])).toEqual({ type: 'all', of: [check, check] });
    expect(bodyCanvas(canonical.get()).nodes.length).toBeGreaterThan(bodyCanvas(real).nodes.length);
  });

  it('declares an Apply through the slot view for the places it writes only: an unrelated binding removal with it is refused', () => {
    const real = document(false), view = slotBodyView(real, path, valueAt(real, path) as Operand), notice = refusals();
    // What the canvas works from and hands back when it combines the body's rule with a second check.
    const when = [...path, 'cases', 0, 'when'], working = replaceAt(real, when, { type: 'all', of: [check, check] });
    const lifted = liftField(working, path, 'operand'), projected = projectGraph(lifted.graph);
    const edit = slotApplyEdit(view, path, 'operand', [{ path, ast: projected.ast }], { generatedSources: [], generatedLibrary: [] },
      { graph: lifted.graph, sourceMap: combinedSourceMap(lifted.sourceMap, '/cases/0/when') }, { graph: lifted.graph, sourceMap: projected.sourceMap });
    expect(edit.placed).toEqual([[...path, 'value']]);
    // The same declared Apply, its candidate differing only in one binding removed (same body, same layout and frame).
    const dropped = { ...edit.candidate, logicUseBindings: edit.candidate.logicUseBindings!.slice(1) };
    expect(Object.keys(dropped).filter(key => Reflect.get(dropped, key) !== Reflect.get(edit.candidate, key))).toEqual(['logicUseBindings']);
    expect(editWithin(view, { ...edit, candidate: dropped })).toBe(view);
    expect(refused(notice)).toBe(1);
    const applied = editWithin(view, edit);
    expect(applied).not.toBe(view); expect(refused(notice)).toBe(1);
    expect(valueAt(applied, [...path, 'value', 'cases', 0, 'when'])).toEqual({ type: 'all', of: [check, check] });
    expect(applied.logicUseBindings).toBe(view.logicUseBindings);
  });
});

/**
 * A declared operation made together with an outside edit (one the boundary takes on its own, rewriting a link as it does)
 * is exactly the outside edit followed by the operation: the operation's declarations never replay the stale candidate.
 */
describe('A declared operation with an outside edit equals the two made one after the other', () => {
  const body: EditorPath = ['logicLibrary', 1, 'body'], tileA: EditorPath = ['pages', 0, 'components', 0];
  const textType = () => fieldVariants(nodeDefinition()).find(type => variantName(type) === 'text')!;
  /** The reviewer's fixture: two tiles using the first template, one the second, all bound; with their saved layouts when asked. */
  const start = (policy: 'fallback' | 'keep', layouts = false) => { const made = meaningFixture('page tile', policy); return layouts ? withMeaningCanvas(made.document, made.slot) : made.document; };
  /** tile-b's use moves out of its subtitle into its visibility rule: alone, the boundary retargets its binding there. */
  const intoRule = (document: CompositionDocument) => {
    const at = ['pages', 0, 'components', 1], node = valueAt(document, at) as { props: { subtitle: { value: unknown } } };
    return replaceAt(document, at, { ...node, props: { ...node.props, subtitle: { type: 'expr', value: text('Moved') } },
      visibleWhen: { type: 'compare', op: 'eq', left: node.props.subtitle.value, right: text('sensor.demo_1') }, whenUnknown: 'keep' });
  };
  /** tile-b, still bound, moves to the second page. */
  const toSecondPage = (document: CompositionDocument) => {
    const [home, second] = document.pages, moved = home.components[1];
    return { ...document, pages: [{ ...home, components: home.components.filter(node => node !== moved) }, { ...second, components: [...second.components, moved] }, ...document.pages.slice(2)] } as CompositionDocument;
  };
  /** Done of a body set to a text through its slot view, `outside` made in the same view. */
  const done = (document: CompositionDocument, outside: (document: CompositionDocument) => CompositionDocument = value => value) => {
    const view = slotBodyView(document, body, valueAt(document, body) as Operand);
    return bodyFromSlotView(document, outside(replaceAt(view, body, operandSlot(text('Changed') as Operand, valueAt(view, body)))), body);
  };
  const sequential = (before: CompositionDocument, outside: (document: CompositionDocument) => CompositionDocument, operation: (document: CompositionDocument) => CompositionDocument) => {
    const first = documentEdit(before, outside(before));
    expect(first).not.toBe(before);
    const second = operation(first);
    expect(second).not.toBe(first);
    return second;
  };

  for (const policy of ['fallback', 'keep'] as const) {
    it(`${policy}: Done with a use moved into a rule`, () => {
      const before = start(policy), notice = refusals();
      expect(documentEdit(before, intoRule(before)).logicUseBindings![1].use).toEqual({ kind: 'page', id: 'page-home', nodeId: 'tile-b', field: '/visibleWhen/left' });
      const expected = sequential(before, intoRule, document => done(document));
      const combined = done(before, intoRule);
      expect(refused(notice)).toBe(0);
      expect(combined.logicUseBindings).toEqual(expected.logicUseBindings);
      expect(combined).toEqual(expected);
      expect(valueAt(combined, body)).toEqual(text('Changed'));
      valid(combined);
    });

    it(`${policy}: a type change with a use moved into a rule`, () => {
      const before = start(policy), notice = refusals();
      const expected = sequential(before, intoRule, document => editWithin(document, fieldTypeEdit(document, tileA, textType(), 'tile')));
      const edit = fieldTypeEdit(before, tileA, textType(), 'tile');
      const combined = editWithin(before, { ...edit, candidate: intoRule(edit.candidate) });
      expect(refused(notice)).toBe(0);
      expect(combined.logicUseBindings).toEqual(expected.logicUseBindings);
      expect(combined).toEqual(expected);
      valid(combined);
    });

    it.each([false, true])(`${policy}: Done with a bound tile moved to another page; saved layouts=%s`, layouts => {
      const before = start(policy, layouts), notice = refusals();
      expect(documentEdit(before, toSecondPage(before)).logicUseBindings![1].use).toEqual({ kind: 'page', id: before.pages[1].id, nodeId: 'tile-b', field: '/props/subtitle/value' });
      const expected = sequential(before, toSecondPage, document => done(document));
      const combined = done(before, toSecondPage);
      expect(refused(notice)).toBe(0);
      expect(combined).toEqual(expected);
      valid(combined);
    });
  }
});

describe('Remove Setting keeps the template body\'s saved layout', () => {
  /** The first template's body (a read of its hole) with a saved canvas layout, every node at 10, 20. */
  function withBodyLayout() {
    let document = replaceAt(linked(), ['logicLibrary', 0, 'params', 0, 'sample'], 'source-b');
    const graph = liftField(document, ['logicLibrary', 0, 'body'], 'operand').graph, stored = studioCanvasMetadataSchema.parse(document.studioCanvas);
    const extra = encodeStudioCanvas(document, [{ id: 'template-body', roots: [{ anchor: graph.roots[0].anchor, nodes: graph.nodes.map(node => ({ id: node.id, origins: node.origins, x: 10, y: 20 })) }] }]);
    document = { ...document, studioCanvas: { ...stored, canvases: [...stored.canvases, ...extra.canvases] } };
    valid(document);
    return document;
  }
  const canvas = (document: CompositionDocument) => studioCanvasMetadataSchema.parse(document.studioCanvas).canvases.find(canvas => canvas.id === 'template-body');

  it('fills the hole, keeps each node where it was saved, and is one undo step', () => {
    const before = withBodyLayout(), notice = refusals(), draft = createDraft(before);
    const plan = removeSettingPlan(before, 'tile-label', 'source');
    expect(plan.document).not.toBe(before); expect(refused(notice)).toBe(0);
    expect(plan.tiles).toBe(2);
    const after = plan.document;
    expect(valueAt(after, ['logicLibrary', 0, 'body', 'from', 'sourceId'])).toBe('source-b');
    expect(after.logicLibrary![0].params).toEqual([]);
    expect(after.logicUseBindings).toEqual(before.logicUseBindings!.filter(binding => binding.logicId !== 'tile-label'));
    const saved = canvas(after)!, old = canvas(before)!;
    expect(saved.roots.map(root => root.anchor)).toEqual(old.roots.map(root => root.anchor));
    expect(saved.nodes.map(node => [node.origins, node.x, node.y])).toEqual(old.nodes.map(node => [node.origins, 10, 20]));
    // The tiles' own saved canvases keep their roots, and each node they still draw keeps its place; only the lost value's nodes go.
    const others = (document: CompositionDocument) => studioCanvasMetadataSchema.parse(document.studioCanvas).canvases.filter(canvas => canvas.id !== 'template-body');
    expect(others(after).map(canvas => [canvas.id, canvas.roots.map(root => root.anchor)])).toEqual(others(before).map(canvas => [canvas.id, canvas.roots.map(root => root.anchor)]));
    others(before).forEach((canvas, at) => {
      const places = others(after)[at].nodes.map(node => JSON.stringify([node.origins, node.x, node.y]));
      for (const node of canvas.nodes.filter(node => !node.origins.some(origin => origin.includes('/args/source')))) expect(places, node.origins.join(',')).toContain(JSON.stringify([node.origins, node.x, node.y]));
    });
    expect(readStudioCanvas(after).warnings).toEqual([]);
    valid(after);
    draft.set(after);
    expect(draft.get()).toBe(after);
    act(() => draft.undo()); expect(draft.get()).toBe(before);
    act(() => draft.redo()); expect(draft.get()).toBe(after);
  });

  it('keeps the rest of the body by identity: only the hole and the objects above it are new', () => {
    const before = withBodyLayout(), after = removeSettingPlan(before, 'tile-label', 'source').document;
    const was = before.logicLibrary![0].body as unknown as { from: { path: unknown } }, now = after.logicLibrary![0].body as unknown as { from: { path: unknown } };
    expect(now).not.toBe(was);
    expect(now.from.path).toBe(was.from.path);
    expect(after.logicLibrary![1]).toBe(before.logicLibrary![1]);
  });
});

/**
 * The final whole-branch review's probes, kept (their logging removed, their types made explicit), with the cases around
 * each of its three findings: a field type change that keeps a binding the new type cannot hold, a whole-document layout
 * that blocked a slot-view Apply, and a document-level layout in an export from another workspace.
 */
describe('Final review: real handlers and edge layouts', () => {
  afterEach(() => { resetLiveRuns(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const base = () => meaningFixture('page tile').document;
  const body: EditorPath = ['logicLibrary', 1, 'body'];
  const slot: EditorPath = ['pages', 0, 'components', 0, 'props', 'subtitle', 'value'];
  const withCanvas = (document: CompositionDocument, path: EditorPath, kind: Parameters<typeof liftField>[2] = 'operand', id = 'review-canvas'): CompositionDocument => {
    const graph = liftField(document, path, kind).graph;
    const extra = encodeStudioCanvas(document, [{ id, roots: [{ anchor: graph.roots[0].anchor,
      nodes: graph.nodes.map((node, at) => ({ id: node.id, origins: node.origins, x: at * 80 + 20, y: 120 })) }] }]);
    const old = studioCanvasMetadataSchema.safeParse(document.studioCanvas);
    return { ...document, studioCanvas: { ...extra, canvases: [...(old.success ? old.data.canvases : []), ...extra.canvases] } };
  };
  const history = (draft: ReturnType<typeof createDraft>, before: CompositionDocument, after: CompositionDocument) => {
    act(() => draft.undo()); expect(draft.get()).toBe(before); expect(draft.canUndo()).toBe(false);
    act(() => draft.redo()); expect(draft.get()).toBe(after); expect(draft.canRedo()).toBe(false);
  };
  const canvases = (document: CompositionDocument) => studioCanvasMetadataSchema.parse(document.studioCanvas).canvases;

  describe('Import', () => {
    function ImportUI({ before, seen }: { before: CompositionDocument; seen: (document: CompositionDocument) => void }) {
      return <Project.Live document={before} seen={seen}>{ws => <DialogBody dialog="import" ws={ws} close={() => {}} onError={error => { throw new Error(error); }}/>}</Project.Live>;
    }
    async function importThroughUI(before: CompositionDocument, exported: CompositionDocument) {
      const seen = vi.fn();
      render(<ImportUI before={before} seen={seen}/>);
      fireEvent.change(screen.getByLabelText('Paste JSON'), { target: { value: compositionSourceText(exported) } });
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      const question = await screen.findByRole('dialog', { name: 'Replace the Draft?' });
      fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
      expect(seen).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Replace the Draft?' })).getByRole('button', { name: 'Replace' }));
      return seen;
    }
    const foreign = () => ({ ...base(), id: 'foreign-project', name: 'Foreign project' });

    it('imports an exported draft with owner-based saved layouts', async () => {
      const before = base(), source = withCanvas(foreign(), body);
      valid(source);
      const seen = await importThroughUI(before, source);
      expect(seen).toHaveBeenCalledOnce();
      const after = seen.mock.calls[0][0] as CompositionDocument;
      expect(after.id).toBe(before.id); expect(after.name).toBe('Foreign project');
      expect(readStudioCanvas(after).warnings).toEqual([]);
      expect(after.studioCanvas).toEqual(source.studioCanvas);
      const draft = createDraft(before); draft.set(after); history(draft, before, after);
    });

    it.each([{ path: ['name'] }, { path: [] }])('imports a valid exported draft with a document-based layout rooted at $path', async ({ path }) => {
      const before = base(), source = withCanvas(foreign(), path, path.length ? 'operand' : 'document');
      valid(source); expect(readStudioCanvas(source).warnings).toEqual([]);
      const seen = await importThroughUI(before, source);
      expect(seen, 'a valid export replaces the draft after confirmation').toHaveBeenCalledOnce();
      const after = seen.mock.calls[0][0] as CompositionDocument;
      expect(after.id).toBe(before.id);
      expect(readStudioCanvas(after).warnings).toEqual([]);
      // Re-anchored to this workspace's identity, each node kept where it was saved.
      const [canvas] = canvases(after), [old] = canvases(source);
      expect(canvas.roots.map(root => [root.anchor.kind, root.anchor.id, root.anchor.field, root.ownerId])).toEqual([['document', before.id, fieldPointer(path), before.id]]);
      expect(canvas.nodes.map(node => [node.nodeId, node.origins, node.x, node.y])).toEqual(old.nodes.map(node => [node.nodeId, node.origins, node.x, node.y]));
    });

    it('imports a same-workspace exported draft with a whole-document layout unchanged', async () => {
      const before = base(), source = withCanvas({ ...base(), name: 'Same workspace export' }, [], 'document');
      valid(source); expect(readStudioCanvas(source).warnings).toEqual([]);
      const seen = await importThroughUI(before, source);
      expect(seen).toHaveBeenCalledOnce();
      expect(readStudioCanvas(seen.mock.calls[0][0]).warnings).toEqual([]);
      expect((seen.mock.calls[0][0] as CompositionDocument).studioCanvas).toEqual(source.studioCanvas);
    });

    it('carries each group of a re-anchored canvas to its nodes\' new IDs', () => {
      const plain = foreign(), graph = liftField(plain, [], 'document').graph;
      const source = { ...plain, studioCanvas: encodeStudioCanvas(plain, [{ id: 'grouped', roots: [{ anchor: graph.roots[0].anchor,
        nodes: graph.nodes.map((node, at) => ({ id: node.id, origins: node.origins, x: at, y: 0 })) }] }]) };
      const [stored] = canvases(source), grouped = { ...source, studioCanvas: { ...source.studioCanvas, canvases: [{ ...stored,
        groups: [{ id: 'pair', label: 'Pair', nodeIds: stored.nodes.slice(0, 2).map(node => node.id) }] }] } };
      expect(readStudioCanvas(grouped).warnings).toEqual([]);
      const imported = importCompositionText(compositionSourceText(grouped), 'draft-fixture');
      expect(readStudioCanvas(imported).warnings).toEqual([]);
      const [canvas] = canvases(imported);
      expect(canvas.groups![0].nodeIds).toEqual(canvas.nodes.slice(0, 2).map(node => node.id));
      expect(canvas.groups![0].nodeIds).not.toEqual(stored.groups?.[0]?.nodeIds ?? grouped.studioCanvas.canvases[0].groups[0].nodeIds);
    });

    it('rejects, before asking, an export whose layout still does not fit once re-anchored', async () => {
      const plain = foreign(), graph = liftField(plain, ['name'], 'operand').graph;
      // Saved over the name as it was, then renamed: stale in the export itself, so no identity makes it fit.
      const source = { ...plain, name: 'Renamed later', studioCanvas: encodeStudioCanvas(plain, [{ id: 'stale', roots: [{ anchor: graph.roots[0].anchor, nodes: [] }] }]) };
      expect(readStudioCanvas(source).warnings).toHaveLength(1);
      expect(() => importCompositionText(compositionSourceText(source), 'draft-fixture')).toThrow(CompositionValidationError);
      const seen = vi.fn();
      render(<ImportUI before={base()} seen={seen}/>);
      fireEvent.change(screen.getByLabelText('Paste JSON'), { target: { value: compositionSourceText(source) } });
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      await act(async () => {});
      expect(screen.queryByRole('dialog', { name: 'Replace the Draft?' })).toBeNull();
      expect(seen).not.toHaveBeenCalled();
    });
  });

  it('Remove Setting handles multiple nested uses and a saved body layout through LogicSettings', () => {
    const raw = base(), use = () => ({ type: 'logic-ref', logicId: 'remove-many', args: { source: 'source-a' } });
    const read = () => ({ type: 'read', from: { type: 'source', sourceId: { type: 'hole', name: 'source' }, path: ['state'] }, as: 'string', missing: 'unavailable' });
    const fields = ['/cases/0/then', '/cases/1/then', '/otherwise'];
    let before = replaceAt({ ...raw, logicUseBindings: [...raw.logicUseBindings!.slice(1), ...fields.map(field => ({
      ...raw.logicUseBindings![0], logicId: 'remove-many', use: { ...raw.logicUseBindings![0].use, field: `/props/subtitle/value${field}` },
    }))], logicLibrary: [...raw.logicLibrary!, {
      id: 'remove-many', name: 'Remove many', kind: 'operand', params: [{ name: 'source', kind: 'source-id', sample: 'source-b' }],
      body: { type: 'choose', cases: [{ when: check, then: read() }], otherwise: read() },
    }] } as CompositionDocument, slot, { type: 'choose', cases: [{ when: check, then: use() }, { when: check, then: use() }], otherwise: use() });
    before = withCanvas(before, ['logicLibrary', before.logicLibrary!.length - 1, 'body']);
    valid(before); const draft = createDraft(before);
    function Settings() {
      const document = useDraftDocument(draft);
      return <WorkspaceDataProvider document={document} house={new LiveHouse().house}>
        <LogicSettings document={document} draft={draft} id="remove-many" apply={next => draft.set(next)} onError={error => { throw new Error(error); }}/>
      </WorkspaceDataProvider>;
    }
    render(<Settings/>);
    fireEvent.click(screen.getByRole('button', { name: /^source, Entity/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Setting' }));
    let question = screen.getByTestId('link-loss-question');
    expect(question.textContent).toContain('1 tile that fills it in will lose that value.');
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(draft.get()).toBe(before); expect(draft.canUndo()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /^source, Entity/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Setting' }));
    question = screen.getByTestId('link-loss-question');
    fireEvent.click(within(question).getByRole('button', { name: 'Remove Setting' }));
    const after = draft.get();
    expect(after).not.toBe(before); valid(after);
    for (const path of [[...slot, 'cases', 0, 'then'], [...slot, 'cases', 1, 'then'], [...slot, 'otherwise']])
      expect(valueAt(after, [...path, 'args'])).toEqual({});
    expect(before.logicUseBindings!.length - after.logicUseBindings!.length).toBe(3);
    expect(readStudioCanvas(after).warnings).toEqual([]);
    history(draft, before, after);
  });

  it('StepList Move Down applies with a saved canvas, as a single undo step', async () => {
    vi.useFakeTimers(); resetLiveRuns();
    const made = newFlow(base(), 'group');
    let before = updateFlow(made.document, made.id, inputs => ({ ...inputs, steps: [
      { id: 'one', op: 'limit', count: 10 }, { id: 'two', op: 'limit', count: 20 },
    ] }));
    const at = before.dataSources.findIndex(source => source.id === made.id);
    before = withCanvas(before, ['dataSources', at], 'flow');
    const draft = createDraft(before);
    function Steps() {
      const document = useDraftDocument(draft), inputs = (document.dataSources[at] as { inputs: Parameters<typeof StepList>[0]['inputs'] }).inputs;
      return <WorkspaceDataProvider document={document} house={new LiveHouse().house}>
        <RowsProvider value={{ document, onChange: next => draft.set(next), onError(error) { throw new Error(error); } }}><StepList flowId={made.id} inputs={inputs}/></RowsProvider>
      </WorkspaceDataProvider>;
    }
    render(<Steps/>);
    fireEvent.click(screen.getByRole('button', { name: 'More for step 1, Limit' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Down' }));
    const after = draft.get();
    expect((valueAt(after, ['dataSources', at, 'inputs', 'steps']) as { id: string }[]).map(step => step.id)).toEqual(['two', 'one']);
    expect(readStudioCanvas(after).warnings).toEqual([]); valid(after);
    history(draft, before, after);
  });

  describe('a field type change keeps only the bindings the new type can hold', () => {
    const dataSourceItem = () => { const items = resolveField(compositionEditorSchema.properties!.dataSources).items; if (!items || Array.isArray(items)) throw new Error('Expected source items'); return items; };
    const textChoice = () => fieldVariants(nodeDefinition()).findIndex(type => variantName(type) === 'text');

    it.each([false, true])('drops a value binding to a field the new type does not have, and asks first; saved layout=%s', saved => {
      const made = meaningFixture('page tile');
      const path: EditorPath = ['componentLibrary', made.optionalIndex, 'node', 'children', 0];
      const before = saved ? withCanvas(made.document, path, 'fragment') : made.document, notice = refusals();
      const variants = fieldVariants(nodeDefinition()), choice = textChoice();
      const change = changeFieldType(before, path, variants[choice], 'tile');
      expect(change.bindings).toBe(1); expect(change.layouts).toBe(saved ? 1 : 0);
      expect(compilerIssuesOf(change.document)).toEqual([]);
      const draft = createDraft(before);
      function Fields() {
        const document = useDraftDocument(draft);
        return <CompositionFields document={document} value={valueAt(document, path) as Json} path={path} schema={nodeDefinition()} label="Optional tile"
          onChange={next => draft.set(next)} onError={error => { throw new Error(error); }}/>;
      }
      render(<Fields/>);
      const pick = () => fireEvent.change(screen.getByLabelText('Optional tile type'), { target: { value: String(choice) } });
      pick();
      const question = screen.getByTestId('link-loss-question');
      expect(question.textContent).toContain(saved ? "1 linked value and 1 saved canvas layout can't carry over to text" : "1 linked value can't carry over to text");
      fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
      expect(draft.get()).toBe(before); expect(draft.canUndo()).toBe(false);
      pick();
      fireEvent.click(within(screen.getByTestId('link-loss-question')).getByRole('button', { name: 'Change Type' }));
      const after = draft.get();
      expect(refused(notice)).toBe(0);
      expect(valueAt(after, [...path, 'type'])).toBe('text');
      expect(after.componentLibrary![made.optionalIndex].bindings).toEqual([]);
      expect(compilerIssuesOf(after)).toEqual([]);
      valid(after);
      history(draft, before, after);
    });

    it('keeps a binding to a key the new type copies (the title) while dropping the optional one, and counts only the dropped', () => {
      const made = meaningFixture('page tile'), at = made.optionalIndex, entry = made.document.componentLibrary![at];
      const path: EditorPath = ['componentLibrary', at, 'node', 'children', 0];
      let before = replaceAt(made.document, ['componentLibrary', at], { ...entry, params: [...entry.params!, { name: 'heading', kind: 'text' }],
        bindings: [...entry.bindings!, { param: 'heading', nodeId: 'demo-lamp', field: 'title' }] });
      for (const [page, index] of [[0, 3], [1, 0]]) before = replaceAt(before, ['pages', page, 'components', index, 'args'], { heading: `Heading ${page}` });
      valid(before);
      const change = changeFieldType(before, path, fieldVariants(nodeDefinition())[textChoice()], 'tile');
      expect(change.document).not.toBe(before);
      expect(change.bindings).toBe(1);
      expect(change.document.componentLibrary![at].bindings).toEqual([{ param: 'heading', nodeId: 'demo-lamp', field: 'title' }]);
      valid(change.document);
    });

    it('removes the binding in its own edit and declares it deleted; left in place, the boundary would re-place it where nothing compiles', () => {
      const made = meaningFixture('page tile'), at = made.optionalIndex, path: EditorPath = ['componentLibrary', at, 'node', 'children', 0];
      const edit = fieldTypeEdit(made.document, path, fieldVariants(nodeDefinition())[textChoice()], 'tile');
      expect(edit.scope).toEqual([path, ['componentLibrary', at, 'bindings']]);
      expect(edit.references.deleted).toContainEqual(['componentLibrary', at, 'bindings', 0]);
      expect(edit.candidate.componentLibrary![at].bindings).toEqual([]);
      const after = editWithin(made.document, edit);
      expect(after.componentLibrary![at].bindings).toEqual([]);
      expect(compilerIssuesOf(after)).toEqual([]);
      // The edit as it was before this fix: only the field, the binding left for the boundary's optional-field fallback.
      const kept = editWithin(made.document, { ...edit, scope: [path], candidate: replaceAt(edit.candidate, ['componentLibrary', at, 'bindings'], made.document.componentLibrary![at].bindings) });
      expect(kept.componentLibrary![at].bindings).toEqual(made.document.componentLibrary![at].bindings);
      expect(compilerIssuesOf(kept).map(issue => issue.code)).toEqual(['unknown_field', 'unknown_field']);
    });

    it('still drops an automatic binding whose use the new type does not hold, and counts it', () => {
      const before = base(), change = changeFieldType(before, ['pages', 0, 'components', 0], fieldVariants(nodeDefinition())[textChoice()], 'tile');
      expect(change.bindings).toBe(1);
      expect(change.document.logicUseBindings).toEqual(before.logicUseBindings!.slice(1));
      valid(change.document);
    });

    it('refuses, and never applies, a type change whose result breaks what it does not own', () => {
      const made = meaningFixture('page tile'), at = made.optionalIndex, path: EditorPath = ['componentLibrary', at, 'node', 'children', 0], notice = refusals();
      const edit = fieldTypeEdit(made.document, path, fieldVariants(nodeDefinition())[textChoice()], 'tile');
      // The result this change had before the fix: both placements fail at `values/tint`, outside the changed field.
      const kept = editWithin(made.document, { ...edit, scope: [path], candidate: replaceAt(edit.candidate, ['componentLibrary', at, 'bindings'], made.document.componentLibrary![at].bindings) });
      expect(compilerIssuesOf(kept).map(issue => issue.pointer)).toEqual(['/document/pages/0/components/3/values/tint', '/document/pages/1/components/0/values/tint']);
      const before = refused(notice);
      expect(compiledBeyond(made.document, kept, path)).toBe(made.document);
      expect(refused(notice)).toBe(before + 1);
      expect(compiledBeyond(made.document, editWithin(made.document, edit), path)).not.toBe(made.document);
    });

    it('lets a type change leave its own new value for the author to fill in, and a draft unfinished elsewhere still change', () => {
      const made = meaningFixture('page tile'), notice = refusals();
      const source = { id: 'demo-source', kind: 'model', model: 'alarm-mode@1', inputs: { entityId: { type: 'literal', value: 'alarm_control_panel.demo_unit' } } };
      const document = { ...made.document, dataSources: [...made.document.dataSources, source] } as CompositionDocument, at = document.dataSources.length - 1;
      valid(document);
      const variants = fieldVariants(nodeDefinition()), sources = fieldVariants(dataSourceItem()), summary = sources.find(type => JSON.stringify(type).includes('inventory-summary@1'))!;
      const unfinished = changeFieldType(document, ['dataSources', at], summary, 'dataSources').document;
      expect(unfinished).not.toBe(document);
      expect(compilerIssuesOf(unfinished).every(issue => issue.pointer.startsWith(`/document/dataSources/${at}/`))).toBe(true);
      expect(compilerIssuesOf(unfinished).length).toBeGreaterThan(0);
      // Its issues were there before: a tile's type change elsewhere still applies.
      const tile = changeFieldType(unfinished, ['pages', 0, 'components', 1], variants[textChoice()], 'tile').document;
      expect(tile).not.toBe(unfinished);
      expect(refused(notice)).toBe(0);
    });
  });

  describe('a slot-view Apply and Done keep a whole-document layout as the boundary rebases it', () => {
    beforeEach(() => {
      vi.useFakeTimers(); resetLiveRuns();
      vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
      HTMLElement.prototype.scrollIntoView = vi.fn();
    });
    const rule = () => replaceAt(base(), body, { type: 'choose', cases: [{ when: check, then: text('Owner') }], otherwise: text('Guest') });
    /** A whole-document canvas saved over `document` with its layout set aside (the root's fingerprint never reads it), beside that layout. */
    const withWhole = (document: CompositionDocument) => {
      const { studioCanvas: kept, ...semantic } = document, whole = withCanvas(semantic as CompositionDocument, [], 'document', 'whole');
      const old = studioCanvasMetadataSchema.safeParse(kept);
      return { ...document, studioCanvas: { ...studioCanvasMetadataSchema.parse(whole.studioCanvas), canvases: [...(old.success ? old.data.canvases : []), ...canvases(whole)] } } as CompositionDocument;
    };
    const outsideBody = (document: CompositionDocument, id: string) => canvases(document).find(canvas => canvas.id === id)!.nodes
      .filter(node => !node.origins.some(origin => origin.startsWith(fieldPointer(body))))
      .map(node => [node.origins, node.x, node.y]);

    async function applyAnd(real: CompositionDocument) {
      const view = slotBodyView(real, body, valueAt(real, body) as Operand), pushed = createDraft(view);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => Response.json(prepareDraft(JSON.parse(String(init?.body)).document)));
      function Controls() {
        const canvas = useLogicFields()!;
        return <button type="button" onClick={() => canvas.open({ draft: operandBodyDraft(pushed, body), path: [...body, 'cases', 0, 'when'], kind: 'condition', label: 'Review', combine: 'all' })}>Open review</button>;
      }
      render(<WorkspaceDataProvider document={real} house={new LiveHouse().house}>
        <LogicFieldsProvider ws={Project.workspace(real)} theme={deriveTheme({}, false)}><Controls/></LogicFieldsProvider>
      </WorkspaceDataProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' })));
      return { view, pushed };
    }

    it.each([false, true, 'whole-document'] as const)('slot Apply and Done, layout=%s', async saved => {
      let real = rule();
      if (saved) real = withCanvas(real, saved === 'whole-document' ? [] : body, saved === 'whole-document' ? 'document' : 'operand');
      valid(real); expect(readStudioCanvas(real).warnings).toEqual([]);
      const { pushed } = await applyAnd(real);
      expect(screen.queryAllByText('Edits applied to the draft. Not published.').length).toBeGreaterThan(0);
      expect(valueAt(operandBodyDraft(pushed, body).get(), [...body, 'cases', 0, 'when'])).toEqual({ type: 'all', of: [check, check] });
      const applied = pushed.get();
      expect(readStudioCanvas(applied).warnings).toEqual([]);
      const target = createDraft(real);
      target.set(bodyFromSlotView(real, applied, body));
      expect(target.get()).not.toBe(real);
      valid(target.get()); expect(readStudioCanvas(target.get()).warnings).toEqual([]);
      history(target, real, target.get());
    });

    it('the slot view rebases the whole-document root, and Done keeps every node outside the body where it was saved', async () => {
      const real = withCanvas(rule(), [], 'document', 'whole');
      const view = slotBodyView(real, body, valueAt(real, body) as Operand);
      expect(readStudioCanvas(view).warnings).toEqual([]);
      expect(outsideBody(view, 'whole')).toEqual(outsideBody(real, 'whole'));
      expect(canonicalBody(view, body)).not.toBe(view);
      const { pushed } = await applyAnd(real);
      const after = bodyFromSlotView(real, pushed.get(), body);
      expect(after).not.toBe(real);
      expect(readStudioCanvas(after).warnings).toEqual([]);
      const [root] = canvases(after).find(canvas => canvas.id === 'whole')!.roots;
      const { studioCanvas: _layout, ...semantic } = after;
      expect(root.anchor).toEqual(fieldAnchor(semantic as CompositionDocument, []));
      expect(outsideBody(after, 'whole')).toEqual(outsideBody(real, 'whole'));
      valid(after);
    });

    it('Done with both a body canvas and a whole-document canvas writes the body\'s and rebases the other', async () => {
      const real = withWhole(withCanvas(rule(), body, 'operand', 'body-canvas'));
      valid(real); expect(readStudioCanvas(real).warnings).toEqual([]);
      const { pushed } = await applyAnd(real);
      expect(screen.queryAllByText('Edits applied to the draft. Not published.').length).toBeGreaterThan(0);
      const after = bodyFromSlotView(real, pushed.get(), body);
      expect(after).not.toBe(real);
      expect(readStudioCanvas(after).warnings).toEqual([]);
      // The body's canvases are the editor's (its own, and the one Apply saved); the whole-document one is rebased.
      const ids = canvases(after).map(canvas => canvas.id), written = canvases(canonicalBody(pushed.get(), body));
      expect(ids.slice(0, 2)).toEqual(['body-canvas', 'whole']);
      for (const id of ids.filter(id => id !== 'whole')) expect(canvases(after).find(canvas => canvas.id === id)).toEqual(written.find(canvas => canvas.id === id));
      expect(outsideBody(after, 'whole')).toEqual(outsideBody(real, 'whole'));
      valid(after);
    });

    it('Done of a body replaced outright drops only the whole-document nodes inside it', () => {
      const real = withCanvas(rule(), [], 'document', 'whole');
      const view = slotBodyView(real, body, valueAt(real, body) as Operand);
      const after = bodyFromSlotView(real, replaceAt(view, body, operandSlot(text('Changed'))), body);
      expect(after).not.toBe(real);
      expect(readStudioCanvas(after).warnings).toEqual([]);
      expect(outsideBody(after, 'whole')).toEqual(outsideBody(real, 'whole'));
      expect(canvases(after)[0].nodes.length).toBeLessThan(canvases(real)[0].nodes.length);
      valid(after);
    });
  });
});
