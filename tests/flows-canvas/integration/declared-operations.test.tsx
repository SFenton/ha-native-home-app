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
import { changeFieldType, editWithin, fieldTypeEdit, replaceDocument } from '../../../src/workspace2/editors/provenance';
import { flowStepMoveEdit, moveFlowStep, newFlow, updateFlow } from '../../../src/workspace2/data/flow';
import LogicSettings from '../../../src/workspace2/data/logic/LogicSettings';
import { removeSettingPlan } from '../../../src/workspace2/data/logic/logicModel';
import { LogicFieldsProvider, bodyFromSlotView, canonicalBody, combinedSourceMap, operandBodyDraft, slotApplyEdit, slotBodyView, useLogicFields } from '../../../src/workspace2/logic-fields/LogicFields';
import { liftField } from '../../../src/workspace2/logic-fields/registry';
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
    expect(editWithin(view, { ...edit, candidate: { ...edit.candidate, logicUseBindings: edit.candidate.logicUseBindings!.slice(1) } })).toBe(view);
    expect(refused(notice)).toBe(1);
    const applied = editWithin(view, edit);
    expect(applied).not.toBe(view); expect(refused(notice)).toBe(1);
    expect(valueAt(applied, [...path, 'value', 'cases', 0, 'when'])).toEqual({ type: 'all', of: [check, check] });
    expect(applied.logicUseBindings).toBe(view.logicUseBindings);
  });
});
