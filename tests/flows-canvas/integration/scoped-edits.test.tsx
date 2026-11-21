// @vitest-environment jsdom
/**
 * Scoped edits (`editWithin`, docs/flows-canvas.md "Declared operations"): an operation's declarations speak for its own
 * scope only, its scope must still name the same owners, and an operation made together with an outside edit is exactly
 * the outside edit followed by the operation, or refused. The describes named for ffcabcbe and a8d4c83d are the independent
 * reviews' probes, kept as they were written (their logging removed, their types made explicit).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { compositionEditorSchema, fieldVariants, nodeDefinition, replaceAt, valueAt, variantName, type EditorPath, type SchemaField } from '../../../src/composition-editor';
import type { CompositionDocument } from '../../../src/shared/composition/schema';
import type { Operand } from '../../../src/shared/composition/expression';
import { encodeStudioCanvas, readStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../../src/shared/composition/studio-logic/schemas';
import { operandSlot } from '../../../src/workspace2/expr/tokens';
import { documentEdit, LINKED_EDIT_REFUSAL } from '../../../src/workspace2/editors/documentEdit';
import { editWithin, fieldTypeEdit, retargetLogicLayout } from '../../../src/workspace2/editors/provenance';
import { fieldAnchor, fieldPointer, liftField } from '../../../src/workspace2/logic-fields/registry';
import { canonicalOfBounded } from '../../../src/shared/composition/json';
import { deleteSurface } from '../../../src/workspace2/navigation/edit';
import { flowStepMoveEdit, newFlow, updateFlow } from '../../../src/workspace2/data/flow';
import { bodyFromSlotView, canonicalBody, combinedSourceMap, slotApplyEdit, slotBodyView } from '../../../src/workspace2/logic-fields/LogicFields';
import { projectGraph } from '../../../src/shared/composition/graph';
import { removeSettingPlan, settingRemovalEdit } from '../../../src/workspace2/data/logic/logicModel';
import { toastManager } from '../../../src/workspace2/toasts';
import { check, meaningFixture, text, valid, withMeaningCanvas } from './meaning-fixtures';

afterEach(() => vi.restoreAllMocks());
const body: EditorPath = ['logicLibrary', 1, 'body'];
const start = (layouts = false) => {
  const made = meaningFixture('page tile');
  return layouts ? withMeaningCanvas(made.document, made.slot) : made.document;
};
const move = (document: CompositionDocument): CompositionDocument => {
  const [first, second] = document.pages, moved = first.components[1];
  return { ...document, pages: [{ ...first, components: first.components.filter(node => node !== moved) },
    { ...second, components: [...second.components, moved] }, ...document.pages.slice(2)] };
};
const done = (document: CompositionDocument, change: (view: CompositionDocument) => CompositionDocument = view => view) =>
  bodyFromSlotView(document, change(replaceAt(slotBodyView(document, body, valueAt(document, body) as Operand), body, operandSlot(text('Changed')))), body);
const noBundles = (document: CompositionDocument): CompositionDocument => {
  const { bundles: _gone, ...layout } = studioCanvasMetadataSchema.parse(document.studioCanvas);
  return { ...document, studioCanvas: layout };
};
function addCanvas(document: CompositionDocument, path: EditorPath, id: string): CompositionDocument {
  const graph = liftField(document, path, 'operand').graph;
  const extra = encodeStudioCanvas(document, [{ id, roots: [{ anchor: graph.roots[0].anchor,
    nodes: graph.nodes.map((node, at) => ({ id: node.id, origins: node.origins, x: at * 80, y: 200 })) }] }]);
  const stored = studioCanvasMetadataSchema.safeParse(document.studioCanvas);
  return { ...document, studioCanvas: { version: 2, canvases: [...(stored.success ? stored.data.canvases : []), ...extra.canvases] } };
}
/** The schema of a literal text operand, for a field type change to it. */
function literalSchema(): SchemaField {
  const schemas: SchemaField[] = [];
  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const properties = (value as { properties?: Record<string, { const?: unknown; type?: unknown }> }).properties;
    if (properties?.type?.const === 'literal' && properties.value?.type === 'string') schemas.push(value as SchemaField);
    Object.values(value).forEach(collect);
  };
  collect(compositionEditorSchema);
  expect(schemas[0]).toBeDefined();
  return schemas[0];
}
const ids = (document: CompositionDocument) => studioCanvasMetadataSchema.parse(document.studioCanvas).canvases.map(canvas => canvas.id);

describe('Scoped edits: review of ffcabcbe', () => {
  it('external fields must not retarget an unrelated binding', () => {
    const before = start(), a = '/pages/0/components/0/props/subtitle/value', b = '/pages/0/components/1/props/subtitle/value';
    const after = editWithin(before, { candidate: replaceAt(before, body, text('Changed')), scope: [body], retained: true,
      references: { fields: new Map([[a, [b]], [`${a}/args/source`, [`${b}/args/source`]]]) } });
    valid(after);
    expect(after.logicUseBindings).toEqual(before.logicUseBindings);
  });

  it('a removed bundles key must not be silently restored by a combined Done', () => {
    const base = start(true), layout = studioCanvasMetadataSchema.parse(base.studioCanvas);
    const before = { ...base, studioCanvas: { ...layout, bundles: [{ id: 'one', name: 'One', outputs: [{ name: 'label', logicId: 'other-label' }] }] } };
    valid(before);
    const first = documentEdit(before, move(before));
    expect(first).not.toBe(before);
    const sequential = done(first, noBundles);
    const combined = done(before, view => noBundles(move(view)));
    valid(combined);
    expect(combined).toBe(before);
  });

  it('reordering existing scoped canvases is preserved or refused', () => {
    let before = replaceAt(start(true), body, { type: 'choose', cases: [{ when: check, then: text('one') }], otherwise: text('two') });
    before = addCanvas(before, body, 'body-a');
    before = addCanvas(before, [...body, 'otherwise'], 'body-b');
    valid(before);
    const operation = (document: CompositionDocument, outside: (view: CompositionDocument) => CompositionDocument = view => view) => {
      const view = outside(slotBodyView(document, body, valueAt(document, body) as Operand));
      const stored = studioCanvasMetadataSchema.parse(view.studioCanvas), canvases = [...stored.canvases];
      [canvases[2], canvases[3]] = [canvases[3], canvases[2]];
      canvases[2] = { ...canvases[2], nodes: canvases[2].nodes.map(node => ({ ...node, x: node.x + 10 })) };
      return bodyFromSlotView(document, { ...view, studioCanvas: { ...stored, canvases } }, body);
    };
    const first = documentEdit(before, move(before)), sequential = operation(first), combined = operation(before, move);
    valid(combined);
    expect(combined === before || JSON.stringify(ids(combined)) === JSON.stringify(ids(sequential))).toBe(true);
  });

  it('a new scoped canvas must keep its insertion order', () => {
    const before = start(true);
    const operation = (document: CompositionDocument, outside: (view: CompositionDocument) => CompositionDocument = view => view) => {
      let view = replaceAt(slotBodyView(document, body, valueAt(document, body) as Operand), body, operandSlot(text('Changed')));
      view = addCanvas(view, body, 'new-body');
      const stored = studioCanvasMetadataSchema.parse(view.studioCanvas);
      view = { ...view, studioCanvas: { ...stored, canvases: [stored.canvases.at(-1)!, ...stored.canvases.slice(0, -1)] } };
      return bodyFromSlotView(document, outside(view), body);
    };
    const first = documentEdit(before, move(before)), sequential = operation(first), combined = operation(before, move);
    valid(combined);
    expect(combined === before || JSON.stringify(ids(combined)) === JSON.stringify(ids(sequential))).toBe(true);
  });

  it('a shifted scope must not silently retarget its canvas to a different template', () => {
    let before = replaceAt(replaceAt(start(), ['logicLibrary', 0, 'body'], text('Tile label')), body, text('Other label'));
    before = addCanvas(before, body, 'other-body');
    valid(before);
    const insert = (document: CompositionDocument): CompositionDocument => ({ ...document, logicLibrary: [
      { id: 'inserted', name: 'Inserted', kind: 'operand', params: [], body: text('Inserted') }, ...document.logicLibrary!,
    ] });
    const first = documentEdit(before, insert(before));
    const nextPath: EditorPath = ['logicLibrary', 2, 'body'];
    const sequential = bodyFromSlotView(first, replaceAt(slotBodyView(first, nextPath, valueAt(first, nextPath) as Operand),
      nextPath, operandSlot(text('Changed'))), nextPath);
    const combined = done(before, insert);
    const root = (document: CompositionDocument) => studioCanvasMetadataSchema.parse(document.studioCanvas).canvases[0].roots[0].anchor;
    valid(combined);
    const { studioCanvas: _combinedLayout, ...combinedContent } = combined;
    const { studioCanvas: _sequentialLayout, ...sequentialContent } = sequential;
    if (combined !== before) expect(combinedContent).toEqual(sequentialContent);
    expect(combined === before || JSON.stringify(root(combined)) === JSON.stringify(root(sequential))).toBe(true);
  });

  it.each(['multiple nested array holes', 'primitive pattern hole'])('Remove Setting handles %s', mode => {
    const hole = { type: 'hole', name: 'value' };
    const param = mode === 'primitive pattern hole' ? { name: 'value', kind: 'text', sample: 'Hello {word}' }
      : { name: 'value', kind: 'operand', sample: text('Sample') };
    const value = mode === 'primitive pattern hole'
      ? { type: 'format', pattern: hole, args: { word: text('World') } }
      : { type: 'list', items: [hole, { type: 'choose', cases: [{ when: check, then: hole }], otherwise: hole }] };
    const base = start(), index = base.logicLibrary!.length, path: EditorPath = ['logicLibrary', index, 'body'];
    let before = { ...base, logicLibrary: [...base.logicLibrary!, { id: 'remove-me', name: 'Remove Me', kind: 'operand', params: [param], body: value }] } as CompositionDocument;
    before = addCanvas(JSON.parse(JSON.stringify(before)), path, 'holes');
    valid(before);
    const old = studioCanvasMetadataSchema.parse(before.studioCanvas).canvases[0];
    const after = removeSettingPlan(before, 'remove-me', 'value').document;
    const next = studioCanvasMetadataSchema.parse(after.studioCanvas).canvases[0];
    expect(after).not.toBe(before);
    expect(after.logicLibrary![index].params).toEqual([]);
    expect(readStudioCanvas(after).warnings).toEqual([]);
    valid(after);
    if (mode === 'primitive pattern hole') {
      expect(old.nodes.some(node => node.origins.includes('/pattern'))).toBe(true);
      expect(next.nodes.some(node => node.origins.includes('/pattern'))).toBe(false);
      expect(next.nodes).toHaveLength(old.nodes.length - 1);
    } else expect(next.nodes).toHaveLength(old.nodes.length);
    for (const node of next.nodes) expect([node.x, node.y]).toEqual([old.nodes.find(held => held.origins[0] === node.origins[0])!.x, 200]);
  });

  it('nested overlapping scopes remove all the intended arguments', () => {
    const base = start(), inner = { type: 'logic-ref', logicId: 'remove-me', args: { remove: text('inner'), keep: text('kept inner') } };
    const before = replaceAt({ ...base, logicLibrary: [...base.logicLibrary!, {
      id: 'remove-me', name: 'Remove Me', kind: 'operand', params: [
        { name: 'remove', kind: 'operand', sample: text('sample') }, { name: 'keep', kind: 'operand', sample: text('kept') }],
      body: { type: 'hole', name: 'keep' },
    }] } as CompositionDocument, ['pages', 0, 'components', 0, 'props', 'subtitle', 'value'],
    { type: 'logic-ref', logicId: 'remove-me', args: { remove: text('outer'), keep: inner } });
    const unbound = { ...before, logicUseBindings: before.logicUseBindings!.slice(1) };
    valid(unbound);
    const edit = settingRemovalEdit(unbound, 'remove-me', 'remove')!;
    expect(edit.scope.some(path => edit.scope.some(other => other.length > path.length && fieldPointer(other).startsWith(`${fieldPointer(path)}/`)))).toBe(true);
    const after = editWithin(unbound, edit);
    expect(after).not.toBe(unbound);
    expect(valueAt(after, ['pages', 0, 'components', 0, 'props', 'subtitle', 'value', 'args', 'remove'])).toBeUndefined();
    expect(valueAt(after, ['pages', 0, 'components', 0, 'props', 'subtitle', 'value', 'args', 'keep', 'args', 'remove'])).toBeUndefined();
    valid(after);
  });

  it.each(['keep', 'remove'])('Remove Setting handles a nested automatic binding inside %s', position => {
    const base = start(), usePath: EditorPath = ['pages', 0, 'components', 0, 'props', 'subtitle', 'value'];
    const nested = valueAt(base, usePath);
    const args = { keep: text('Kept'), remove: text('Removed'), [position]: nested };
    let before = replaceAt({ ...base, logicLibrary: [...base.logicLibrary!, {
      id: 'outer-remove', name: 'Outer Remove', kind: 'operand',
      params: [{ name: 'remove', kind: 'operand', sample: text('Sample') }, { name: 'keep', kind: 'operand', sample: text('Kept') }],
      body: { type: 'format', pattern: '{a}{b}', args: { a: { type: 'hole', name: 'remove' }, b: { type: 'hole', name: 'keep' } } },
    }], logicUseBindings: base.logicUseBindings!.map((binding, at) => at ? binding : {
      ...binding, use: { ...binding.use, field: `/props/subtitle/value/args/${position}` },
    }) } as CompositionDocument, usePath, { type: 'logic-ref', logicId: 'outer-remove', args });
    before = addCanvas(before, usePath, 'outer');
    valid(before);
    const after = removeSettingPlan(before, 'outer-remove', 'remove').document;
    expect(after).not.toBe(before);
    expect(after.logicUseBindings).toEqual(position === 'keep' ? before.logicUseBindings : before.logicUseBindings!.slice(1));
    expect(readStudioCanvas(after).warnings).toEqual([]);
    valid(after);
  });

  it('ancestor root fields and primitive siblings do not drop outside bindings', () => {
    const before = start(), path: EditorPath = ['pages', 0, 'components', 0], notice = vi.spyOn(toastManager, 'add');
    const schema = fieldVariants(nodeDefinition()).find(type => variantName(type) === 'text')!;
    const edit = fieldTypeEdit(before, path, schema, 'tile'), after = editWithin(before, edit);
    expect(after).not.toBe(before);
    expect(after.logicUseBindings).toEqual(before.logicUseBindings!.slice(1));
    expect(notice.mock.calls.filter(([toast]) => toast.title === LINKED_EDIT_REFUSAL)).toHaveLength(0);
    valid(after);
  });

  it('the empty ancestor field pins a whole-document canvas without declaring all descendants', () => {
    const base = start(), graph = liftField(base, [], 'document').graph;
    const before = { ...base, studioCanvas: encodeStudioCanvas(base, [{ id: 'whole-document',
      roots: [{ anchor: graph.roots[0].anchor, nodes: graph.nodes.map((node, at) => ({ id: node.id, origins: node.origins, x: at * 10, y: 30 })) }] }]) };
    const schema = fieldVariants(nodeDefinition()).find(type => variantName(type) === 'text')!;
    const after = editWithin(before, fieldTypeEdit(before, ['pages', 0, 'components', 0], schema, 'tile'));
    expect(after).not.toBe(before);
    expect(after.logicUseBindings).toEqual(before.logicUseBindings!.slice(1));
    expect(readStudioCanvas(after).warnings).toEqual([]);
    valid(after);
  });

  it('a saved primitive sibling stays at its exact field through Done', () => {
    const before = addCanvas(start(), ['logicLibrary', 1, 'name'], 'name');
    const after = done(before);
    expect(after).not.toBe(before);
    expect(studioCanvasMetadataSchema.parse(after.studioCanvas).canvases[0]).toEqual(studioCanvasMetadataSchema.parse(before.studioCanvas).canvases[0]);
    expect(after.logicUseBindings).toEqual(before.logicUseBindings);
    valid(after);
  });
});

describe('Scoped edits: combined equals sequential, or both are refused', () => {
  const refusals = () => vi.spyOn(toastManager, 'add');
  const refused = (notice: ReturnType<typeof refusals>) => notice.mock.calls.filter(([toast]) => toast.title === LINKED_EDIT_REFUSAL).length;
  const insert = (document: CompositionDocument): CompositionDocument => ({ ...document, logicLibrary: [
    { id: 'inserted', name: 'Inserted', kind: 'operand', params: [], body: text('Inserted') }, ...document.logicLibrary!] } as CompositionDocument);
  const append = (document: CompositionDocument): CompositionDocument => ({ ...document, logicLibrary: [
    ...document.logicLibrary!, { id: 'appended', name: 'Appended', kind: 'operand', params: [], body: text('Appended') }] } as CompositionDocument);
  const dropSecondPage = (document: CompositionDocument): CompositionDocument => ({ ...document, pages: document.pages.filter((_, at) => at !== 1) });
  const both = (...changes: ((document: CompositionDocument) => CompositionDocument)[]) => (document: CompositionDocument) => changes.reduce((value, change) => change(value), document);
  const tileType = () => fieldVariants(nodeDefinition()).find(type => variantName(type) === 'text')!;

  it('a Done whose template shifted to another position is refused, and its canvas keeps its template', () => {
    let before = replaceAt(replaceAt(start(), ['logicLibrary', 0, 'body'], text('Tile label')), body, text('Other label'));
    before = addCanvas(before, body, 'other-body');
    const notice = refusals();
    expect(done(before, insert)).toBe(before);
    expect(refused(notice)).toBe(1);
    expect(studioCanvasMetadataSchema.parse(before.studioCanvas).canvases[0].roots[0].anchor).toEqual({ kind: 'logic', id: 'other-label', field: '/body' });
    // A tile shifted under a type change is refused the same way.
    const shifted = (document: CompositionDocument) => replaceAt(document, ['pages', 0, 'components'], [{ ...document.pages[0].components[3], id: 'first' }, ...document.pages[0].components]);
    const edit = fieldTypeEdit(before, ['pages', 0, 'components', 0], tileType(), 'tile');
    expect(editWithin(before, { ...edit, candidate: shifted(edit.candidate) })).toBe(before);
    expect(refused(notice)).toBe(2);
  });

  it.each([['an appended template', append], ['a removed page', dropSecondPage], ['both', both(append, dropSecondPage)]] as const)('Done, a type change and Remove Setting with %s elsewhere equal the two made in turn', (_, outside) => {
    for (const layouts of [false, true]) {
      const before = replaceAt(start(layouts), ['logicLibrary', 0, 'params', 0, 'sample'], 'source-b'), notice = refusals();
      const first = documentEdit(before, outside(before));
      expect(first).not.toBe(before);
      const operations: [string, (document: CompositionDocument) => CompositionDocument, () => CompositionDocument][] = [
        ['Done', document => done(document), () => done(before, outside)],
        ['type change', document => editWithin(document, fieldTypeEdit(document, ['pages', 0, 'components', 0], tileType(), 'tile')),
          () => { const edit = fieldTypeEdit(before, ['pages', 0, 'components', 0], tileType(), 'tile'); return editWithin(before, { ...edit, candidate: outside(edit.candidate) }); }],
        ['Remove Setting', document => editWithin(document, settingRemovalEdit(document, 'tile-label', 'source')!),
          () => { const edit = settingRemovalEdit(before, 'tile-label', 'source')!; return editWithin(before, { ...edit, candidate: outside(edit.candidate) }); }],
      ];
      for (const [name, operation, combined] of operations) {
        const sequential = operation(first), result = combined();
        expect(sequential, `${name} in turn`).not.toBe(first);
        expect(result, name).not.toBe(before);
        expect(result, name).toEqual(sequential);
        valid(result);
      }
      expect(refused(notice)).toBe(0);
      notice.mockRestore();
    }
  });

  it.each([['an appended template', append], ['a removed page', dropSecondPage]] as const)('a slot-view Apply with %s elsewhere equals the two made in turn; a shifted template is refused', (_, outside) => {
    const real = replaceAt(start(true), body, { type: 'choose', cases: [{ when: check, then: text('Owner') }], otherwise: text('Guest') });
    const view = slotBodyView(real, body, valueAt(real, body) as Operand), notice = refusals();
    const apply = (document: CompositionDocument) => {
      const working = replaceAt(canonicalBody(document, body), [...body, 'cases', 0, 'when'], { type: 'all', of: [check, check] });
      const lifted = liftField(working, body, 'operand'), projected = projectGraph(lifted.graph);
      return slotApplyEdit(document, body, 'operand', [{ path: body, ast: projected.ast }], { generatedSources: [], generatedLibrary: [] },
        { graph: lifted.graph, sourceMap: combinedSourceMap(lifted.sourceMap, '/cases/0/when') }, { graph: lifted.graph, sourceMap: projected.sourceMap });
    };
    const first = documentEdit(view, outside(view));
    expect(first).not.toBe(view);
    const sequential = editWithin(first, apply(first)), edit = apply(view), combined = editWithin(view, { ...edit, candidate: outside(edit.candidate) });
    expect(sequential).not.toBe(first); expect(combined).not.toBe(view);
    expect(valueAt(combined, [...body, 'value', 'cases', 0, 'when'])).toEqual({ type: 'all', of: [check, check] });
    expect(combined).toEqual(sequential);
    expect(refused(notice)).toBe(0);
    expect(editWithin(view, { ...edit, candidate: insert(edit.candidate) })).toBe(view);
    expect(refused(notice)).toBe(1);
  });

  it('a Done that removes the bundles with an outside move is refused, as it is in turn', () => {
    const base = start(true), layout = studioCanvasMetadataSchema.parse(base.studioCanvas);
    const before = { ...base, studioCanvas: { ...layout, bundles: [{ id: 'one', name: 'One', outputs: [{ name: 'label', logicId: 'other-label' }] }] } } as CompositionDocument;
    const first = documentEdit(before, move(before)), notice = refusals();
    expect(first).not.toBe(before);
    expect(done(first, noBundles)).toBe(first);
    expect(done(before, view => noBundles(move(view)))).toBe(before);
    expect(refused(notice)).toBe(2);
    // Keeping the bundles, the same combined Done equals the two in turn.
    expect(done(before, move)).toEqual(done(first));
  });

  it('a new canvas the operation puts first stays first, as it does in turn', () => {
    const before = start(true);
    const operation = (document: CompositionDocument, outside: (view: CompositionDocument) => CompositionDocument = view => view) => {
      let view = replaceAt(slotBodyView(document, body, valueAt(document, body) as Operand), body, operandSlot(text('Changed')));
      view = addCanvas(view, body, 'new-body');
      const stored = studioCanvasMetadataSchema.parse(view.studioCanvas);
      view = { ...view, studioCanvas: { ...stored, canvases: [stored.canvases.at(-1)!, ...stored.canvases.slice(0, -1)] } };
      return bodyFromSlotView(document, outside(view), body);
    };
    const first = documentEdit(before, move(before)), sequential = operation(first), combined = operation(before, move);
    expect(sequential).not.toBe(first); expect(combined).not.toBe(before);
    expect(ids(combined)).toEqual(['new-body', ...ids(before)]);
    expect(combined).toEqual(sequential);
  });

  it('existing canvases the operation reorders keep its order, as they do in turn', () => {
    let before = replaceAt(start(true), body, { type: 'choose', cases: [{ when: check, then: text('one') }], otherwise: text('two') });
    before = addCanvas(addCanvas(before, body, 'body-a'), [...body, 'otherwise'], 'body-b');
    const operation = (document: CompositionDocument, outside: (view: CompositionDocument) => CompositionDocument = view => view) => {
      const view = outside(slotBodyView(document, body, valueAt(document, body) as Operand));
      const stored = studioCanvasMetadataSchema.parse(view.studioCanvas), canvases = [...stored.canvases];
      [canvases[2], canvases[3]] = [canvases[3], canvases[2]];
      canvases[2] = { ...canvases[2], nodes: canvases[2].nodes.map(node => ({ ...node, x: node.x + 10 })) };
      return bodyFromSlotView(document, { ...view, studioCanvas: { ...stored, canvases } }, body);
    };
    const first = documentEdit(before, move(before)), sequential = operation(first), combined = operation(before, move);
    expect(sequential).not.toBe(first); expect(combined).not.toBe(before);
    expect(ids(combined)).toEqual(['meaning-0', 'meaning-1', 'body-b', 'body-a']);
    expect(combined).toEqual(sequential);
  });

  it('an operation\'s fields from or to anywhere outside its scope are not its declaration', () => {
    const before = start(), a = '/pages/0/components/0/props/subtitle/value', b = '/pages/0/components/1/props/subtitle/value';
    const candidate = replaceAt(before, body, text('Changed'));
    const after = editWithin(before, { candidate, scope: [body], retained: true, references: { fields: new Map([[a, [b]], [`${a}/args/source`, [`${b}/args/source`]], [fieldPointer(body), [a]]]) } });
    expect(after).not.toBe(before);
    expect(after.logicUseBindings).toEqual(before.logicUseBindings);
    expect(valueAt(after, body)).toEqual(text('Changed'));
  });

  it('Remove Setting drops only the node of a hole its Try With value cannot draw (a text pattern), keeping every other node', () => {
    const hole = { type: 'hole', name: 'value' }, base = start(), index = base.logicLibrary!.length, path: EditorPath = ['logicLibrary', index, 'body'];
    let before = { ...base, logicLibrary: [...base.logicLibrary!, { id: 'remove-me', name: 'Remove Me', kind: 'operand',
      params: [{ name: 'value', kind: 'text', sample: 'Hello {word}' }], body: { type: 'format', pattern: hole, args: { word: text('World') } } }] } as CompositionDocument;
    before = addCanvas(JSON.parse(JSON.stringify(before)), path, 'holes');
    const old = studioCanvasMetadataSchema.parse(before.studioCanvas).canvases[0], notice = refusals();
    const after = removeSettingPlan(before, 'remove-me', 'value').document;
    expect(after).not.toBe(before); expect(refused(notice)).toBe(0);
    expect(valueAt(after, [...path, 'pattern'])).toBe('Hello {word}');
    const next = studioCanvasMetadataSchema.parse(after.studioCanvas).canvases[0];
    expect(next.nodes.map(node => [node.origins, node.x, node.y])).toEqual(old.nodes.filter(node => !node.origins.includes('/pattern')).map(node => [node.origins, node.x, node.y]));
    expect(old.nodes.length - next.nodes.length).toBe(1);
    expect(readStudioCanvas(after).warnings).toEqual([]);
    valid(after);
  });
});

describe('Scoped edits: review of a8d4c83d', () => {
  const slot: EditorPath = ['pages', 0, 'components', 0, 'props', 'subtitle', 'value'];
  it('Remove Setting handles two uses in the same id-less case array', () => {
    const base = meaningFixture('page tile').document;
    const use = (value: string) => ({ type: 'logic-ref', logicId: 'remove-me', args: { value: text(value) } });
    const before = replaceAt({
      ...base,
      logicUseBindings: base.logicUseBindings!.slice(1),
      logicLibrary: [...base.logicLibrary!, { id: 'remove-me', name: 'Remove Me', kind: 'operand', params: [
        { name: 'value', kind: 'operand', sample: text('Sample') },
      ], body: { type: 'hole', name: 'value' } }],
    } as CompositionDocument, slot, { type: 'choose', cases: [{ when: check, then: use('First') }, { when: check, then: use('Second') }], otherwise: text('Fallback') });
    valid(before);
    const edit = settingRemovalEdit(before, 'remove-me', 'value')!;
    const after = editWithin(before, edit);
    expect(after).not.toBe(before);
    expect(after).toEqual(removeSettingPlan(before, 'remove-me', 'value').document);
    expect(after.logicLibrary!.find(entry => entry.id === 'remove-me')!.params).toEqual([]);
    expect(valueAt(after, [...slot, 'cases', 0, 'then', 'args'])).toEqual({});
    expect(valueAt(after, [...slot, 'cases', 1, 'then', 'args'])).toEqual({});
    expect(valueAt(after, [...slot, 'cases', 0, 'then', 'logicId'])).toBe('remove-me');
    expect(valueAt(after, [...slot, 'cases', 1, 'then', 'logicId'])).toBe('remove-me');
    expect(after.logicUseBindings).toEqual(before.logicUseBindings);
    valid(after);
  });

  it('relocations may not move an inside binding to an outside use', () => {
    const base = meaningFixture('page tile').document;
    const before = { ...base, logicUseBindings: [base.logicUseBindings![0]] };
    const a = '/pages/0/components/0/props/subtitle/value';
    const b = '/pages/0/components/1/props/subtitle/value';
    valid(before);
    const after = editWithin(before, { candidate: replaceAt(before, slot, text('Replaced')), scope: [slot], retained: true,
      references: { relocated: new Map([[a, [b]]]) } });
    valid(after);
    expect(after === before || JSON.stringify(after.logicUseBindings) === JSON.stringify(before.logicUseBindings)).toBe(true);
  });

  it.each(['root', 'canvas'])('the full boundary rejects a retargeted %s collision with an unmoved canvas', collision => {
    const body: EditorPath = ['logicLibrary', 1, 'body'];
    const base = replaceAt(meaningFixture('page tile').document, body, text('Body'));
    const moving = fieldAnchor(base, [...body, 'value']);
    const destination = fieldAnchor(base, body);
    const stationary = collision === 'root' ? destination : fieldAnchor(base, ['logicLibrary', 0, 'body']);
    const before = { ...base, studioCanvas: encodeStudioCanvas(base, [
      { id: canonicalOfBounded([moving]), roots: [{ anchor: moving, nodes: [] }] },
      { id: collision === 'root' ? 'stationary' : canonicalOfBounded([destination]), roots: [{ anchor: stationary, nodes: [] }] },
    ], [{ id: 'bundle', name: 'Bundle', outputs: [{ name: 'value', logicId: 'other-label' }] }]) };
    expect(readStudioCanvas(before).warnings).toEqual([]);
    const next = retargetLogicLayout(before, 'other-label', '/body/value', '/body');
    expect(readStudioCanvas(next).warnings).toHaveLength(1);
    expect(documentEdit(before, next, { layout: [body] })).toBe(before);
  });

  it('a new leaf key uses the ordinary fallback, while a missing middle is refused', () => {
    const before = meaningFixture('page tile').document;
    const parent: EditorPath = ['pages', 0, 'components', 0];
    const leaf = [...parent, 'visibleWhen'];
    const candidate = replaceAt(before, leaf, check);
    valid(candidate);
    const ordinary = documentEdit(before, candidate);
    expect(ordinary).not.toBe(before);
    const next = editWithin(before, { candidate, scope: [leaf], references: {}, retained: true });
    expect(next).toEqual(ordinary);
    expect(editWithin(before, { candidate, scope: [[...leaf, 'isAdmin']], references: {}, retained: true })).toBe(before);
  });

  it('Done plus a bound-tile move keeps the rebased canvas and binding', () => {
    const made = meaningFixture('page tile');
    const before = withMeaningCanvas(made.document, made.slot);
    const body: EditorPath = ['logicLibrary', 1, 'body'];
    const move = (document: CompositionDocument): CompositionDocument => {
      const [first, second] = document.pages, moved = first.components[1];
      return { ...document, pages: [{ ...first, components: first.components.filter(node => node !== moved) },
        { ...second, components: [...second.components, moved] }, ...document.pages.slice(2)] };
    };
    const done = (document: CompositionDocument, outside = (view: CompositionDocument) => view) =>
      bodyFromSlotView(document, outside(replaceAt(slotBodyView(document, body, valueAt(document, body) as Operand), body, operandSlot(text('Changed')))), body);
    const first = documentEdit(before, move(before));
    const sequential = done(first), combined = done(before, move);
    expect(first).not.toBe(before);
    expect(sequential).not.toBe(first);
    expect(combined).not.toBe(before);
    expect(combined).toEqual(sequential);
    valid(combined);
  });

  it('a field type change with saved layouts accepts and discards only its own root', () => {
    const made = meaningFixture('page tile');
    const before = withMeaningCanvas(made.document, made.slot);
    const schema = fieldVariants(nodeDefinition()).find(type => variantName(type) === 'text')!;
    const after = editWithin(before, fieldTypeEdit(before, ['pages', 0, 'components', 0], schema, 'tile'));
    expect(after).not.toBe(before);
    expect(studioCanvasMetadataSchema.parse(after.studioCanvas).canvases.map(canvas => canvas.id)).toEqual(['meaning-1']);
    expect(readStudioCanvas(after).warnings).toEqual([]);
    valid(after);
  });

  it('Apply can introduce the new value wrapper key in a literal template body', () => {
    const body: EditorPath = ['logicLibrary', 1, 'body'];
    const real = replaceAt(meaningFixture('page tile').document, body, text('Before'));
    const view = slotBodyView(real, body, valueAt(real, body) as Operand);
    const working = replaceAt(real, body, { type: 'choose', cases: [{ when: check, then: text('Owner') }], otherwise: text('Guest') });
    const previous = liftField(real, body, 'operand'), next = liftField(working, body, 'operand'), projected = projectGraph(next.graph);
    const edit = slotApplyEdit(view, body, 'operand', [{ path: body, ast: projected.ast }],
      { generatedSources: [], generatedLibrary: [] }, previous, { graph: next.graph, sourceMap: projected.sourceMap });
    expect(edit.scope).toEqual([body]);
    const after = editWithin(view, edit);
    expect(after).not.toBe(view);
    expect(valueAt(after, [...body, 'type'])).toBe('expr');
    expect(valueAt(canonicalBody(after, body), body)).toEqual(valueAt(working, body));
    valid(canonicalBody(after, body));
  });

  it('a page deletion with a saved canvas is refused by the ordinary outside boundary, not the merge', () => {
    const body: EditorPath = ['logicLibrary', 1, 'body'];
    const base = meaningFixture('page tile').document, anchor = fieldAnchor(base, ['pages', 1, 'components', 0]);
    const before: CompositionDocument = { ...base, studioCanvas: encodeStudioCanvas(base, [{ id: 'deleted-page', roots: [{ anchor, nodes: [] }] }]) };
    const outside = deleteSurface(before, { kind: 'page', id: before.pages[1].id }).document;
    expect(documentEdit(before, outside)).toBe(before);
    const view = replaceAt(slotBodyView(before, body, valueAt(before, body) as Operand), body, operandSlot(text('Changed')));
    const changed = deleteSurface(view, { kind: 'page', id: before.pages[1].id }).document;
    expect(bodyFromSlotView(before, changed, body)).toBe(before);
  });

  it.each(['components', 'children', 'tabs', 'blocks', 'componentLibrary'])('a shifted %s owner is refused', branch => {
    let before = meaningFixture(branch === 'componentLibrary' ? 'component tile' : 'page tile').document;
    let list: EditorPath = ['pages', 0, 'components'], path: EditorPath = [...list, 0];
    if (branch === 'componentLibrary') {
      list = ['componentLibrary'];
      path = ['componentLibrary', 0, 'node'];
    } else if (branch !== 'components') {
      const children = before.pages[0].components;
      const container = branch === 'children'
        ? { id: 'container', title: 'Container', type: 'stack', layout: { span: 1 }, props: { axis: 'vertical', spacing: { type: 'token', name: 'm' } }, children }
        : { id: 'container', title: 'Container', type: 'local-tabs', layout: { span: 1 }, props: { stateId: 'selected-tab', transition: 'canonical-swap@1' },
          tabs: [{ id: 'first', label: 'First', children: branch === 'tabs' ? children : [] }, { id: 'second', label: 'Second', children: [] }],
          ...(branch === 'blocks' ? { blocks: [{ id: 'common', tabs: 'all', children }] } : {}) };
      before = replaceAt(before, list, [container]);
      if (branch !== 'children') before = { ...before, localState: [...before.localState ?? [], { id: 'selected-tab', type: 'choice', initial: 'first',
        options: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }] }] };
      list = [...list, 0, ...(branch === 'children' ? ['children'] : [branch, 0, 'children'])];
      path = [...list, 0];
    }
    valid(before);
    const schema = fieldVariants(nodeDefinition()).find(type => variantName(type) === 'text')!, edit = fieldTypeEdit(before, path, schema, 'tile');
    const items = valueAt(edit.candidate, list) as readonly Record<string, unknown>[];
    const candidate = replaceAt(edit.candidate, list, [{ ...structuredClone(items[0]), id: 'inserted-owner' }, ...items]);
    expect(editWithin(before, { ...edit, candidate })).toBe(before);
  });

  it('a duplicate ID cannot fool the boundary after passing the owner check', () => {
    const before = meaningFixture('page tile').document;
    const list: EditorPath = ['pages', 0, 'components'];
    const schema = fieldVariants(nodeDefinition()).find(type => variantName(type) === 'text')!, edit = fieldTypeEdit(before, [...list, 0], schema, 'tile');
    const items = valueAt(edit.candidate, list) as readonly unknown[];
    const candidate = replaceAt(edit.candidate, list, [structuredClone(before.pages[0].components[0]), ...items]);
    expect(editWithin(before, { ...edit, candidate })).toBe(before);
  });

  it('a shifted flow owner is refused while an unshifted step move accepts', () => {
    const made = newFlow(meaningFixture('page tile').document, 'group');
    const before = updateFlow(made.document, made.id, inputs => ({ ...inputs, steps: [
      { id: 'one', op: 'limit', count: 10 }, { id: 'two', op: 'limit', count: 20 },
    ] }));
    valid(before);
    const edit = flowStepMoveEdit(before, made.id, 0, 1)!;
    expect(editWithin(before, edit)).not.toBe(before);
    const candidate = { ...edit.candidate, dataSources: [
      { ...before.dataSources[0], id: 'inserted-source' }, ...edit.candidate.dataSources,
    ] };
    expect(editWithin(before, { ...edit, candidate })).toBe(before);
  });

  it('recreating the page with identical JSON under its old ID preserves the intended result', () => {
    const before = meaningFixture('page tile').document;
    const schema = fieldVariants(nodeDefinition()).find(type => variantName(type) === 'text')!;
    const edit = fieldTypeEdit(before, ['pages', 0, 'components', 0], schema, 'tile');
    const candidate = replaceAt(edit.candidate, ['pages', 0], structuredClone(edit.candidate.pages[0]));
    const after = editWithin(before, { ...edit, candidate });
    expect(after).not.toBe(before);
    expect(after).toEqual(editWithin(before, edit));
    const shallow = replaceAt(edit.candidate, ['pages', 0], { ...edit.candidate.pages[0] });
    expect(editWithin(before, { ...edit, candidate: shallow })).not.toBe(before);
  });

  it('an equal-JSON outside swap has the same result combined and sequential', () => {
    const base = meaningFixture('page tile').document, use = valueAt(base, slot);
    const before = replaceAt({ ...base, logicUseBindings: base.logicUseBindings!.map((binding, at) => at ? binding : {
      ...binding, use: { ...binding.use, field: `${binding.use.field}/cases/1/then` },
    }) }, slot, { type: 'choose', cases: [{ when: check, then: text('Target') },
      { when: check, then: structuredClone(use) }, { when: check, then: structuredClone(use) }], otherwise: text('Fallback') });
    valid(before);
    const scope = [...slot, 'cases', 0, 'then'];
    const swap = (document: CompositionDocument) => {
      const cases = valueAt(document, [...slot, 'cases']) as readonly unknown[];
      return replaceAt(document, [...slot, 'cases'], [cases[0], cases[2], cases[1]]);
    };
    const operation = (document: CompositionDocument) => ({
      candidate: replaceAt(document, scope, text('Changed')), scope: [scope], retained: true,
      references: { fields: new Map([[fieldPointer(scope), [fieldPointer(scope)]]]) },
    });
    const first = documentEdit(before, swap(before)), sequential = editWithin(first, operation(first)), edit = operation(before);
    const combined = editWithin(before, { ...edit, candidate: swap(edit.candidate) });
    expect(first).not.toBe(before);
    expect(first.logicUseBindings![0].use.field).toContain('/cases/1/then');
    expect(sequential).not.toBe(first);
    expect(combined).not.toBe(before);
    expect(combined).toEqual(sequential);
    valid(combined);
  });

  it('an id-less swap masked by a field type change must not leave the outside canvas on the wrong case', () => {
    const base = meaningFixture('page tile').document;
    const casesPath = [...slot, 'cases'], scope = [...casesPath, 0, 'then'], second = [...casesPath, 1, 'then'];
    const semantic = replaceAt({ ...base, logicUseBindings: base.logicUseBindings!.slice(1) }, slot, {
      type: 'choose', cases: [{ when: check, then: { type: 'format', pattern: 'First', args: {} } }, { when: check, then: text('') }], otherwise: text('Fallback'),
    });
    const graph = liftField(semantic, second, 'operand').graph;
    const before: CompositionDocument = { ...semantic, studioCanvas: encodeStudioCanvas(semantic, [{ id: 'case-b', roots: [{ anchor: graph.roots[0].anchor,
      nodes: graph.nodes.map(node => ({ id: node.id, origins: node.origins, x: 42, y: 80 })) }] }]) };
    valid(before);
    const swap = (document: CompositionDocument) => {
      const cases = valueAt(document, casesPath) as readonly unknown[];
      return replaceAt(document, casesPath, [cases[1], cases[0]]);
    };
    const literal = literalSchema();
    const operation = (document: CompositionDocument, path: EditorPath) => fieldTypeEdit(document, path, literal, 'then');
    const first = documentEdit(before, swap(before)), sequential = editWithin(first, operation(first, second));
    const edit = operation(before, scope), combined = editWithin(before, { ...edit, candidate: swap(edit.candidate) });
    const anchor = (document: CompositionDocument) => studioCanvasMetadataSchema.parse(document.studioCanvas).canvases[0].roots[0].anchor;
    expect(first).not.toBe(before);
    expect(sequential).not.toBe(first);
    valid(sequential);
    valid(combined);
    expect(combined === before || JSON.stringify(combined) === JSON.stringify(sequential)).toBe(true);
    // In turn, the outside canvas follows its case to index 0; together, the moved case is no object of before's, so it is refused.
    expect('field' in anchor(sequential) && anchor(sequential).field).toBe(fieldPointer(scope).replace(/^\/pages\/0\/components\/0/, ''));
    expect(combined).toBe(before);
  });
});

describe('Scoped edits: declarations and id-less owners, fixes for a8d4c83d', () => {
  const a: EditorPath = ['pages', 0, 'components', 0, 'props', 'subtitle', 'value'], b: EditorPath = ['pages', 0, 'components', 1, 'props', 'subtitle', 'value'];
  const subtitle = a.slice(0, -1), pa = fieldPointer(a), pb = fieldPointer(b);
  const tiles = (document: CompositionDocument) => (document.logicUseBindings ?? []).map(binding => 'nodeId' in binding.use ? binding.use.nodeId : binding.use.id);
  /** Only tile-a's (and the unrelated tile's) bindings, or only tile-b's. */
  const onlyA = () => { const base = meaningFixture('page tile').document; return { ...base, logicUseBindings: [base.logicUseBindings![0], base.logicUseBindings![2]] }; };
  const onlyB = () => { const base = meaningFixture('page tile').document; return { ...base, logicUseBindings: base.logicUseBindings!.slice(1) }; };
  /** A change inside tile-a's subtitle that keeps its use. */
  const touch = (document: CompositionDocument) => replaceAt(document, [...subtitle, 'fallback'], 'Changed');
  const scoped = (before: CompositionDocument, candidate: CompositionDocument, references: Parameters<typeof documentEdit>[2] = {}) =>
    editWithin(before, { candidate, scope: [subtitle], retained: true, references });

  it('a forwarded relocation with any destination outside the scope is ignored, not half-kept', () => {
    const before = onlyA();
    valid(before);
    // Ordinarily these relocations would move tile-a's binding to tile-b, or copy it there.
    expect(tiles(documentEdit(before, touch(before), { relocated: new Map([[pa, [pb]]]) }))).toEqual(['tile-b', 'unrelated-bound']);
    expect(tiles(documentEdit(before, touch(before), { relocated: new Map([[pa, [pa, pb]]]) }))).toEqual(['tile-a', 'tile-b', 'unrelated-bound']);
    for (const to of [[pb], [pa, pb]]) {
      const after = scoped(before, touch(before), { relocated: new Map([[pa, to]]) });
      expect(after, to.join()).not.toBe(before);
      expect(after.logicUseBindings, to.join()).toEqual(before.logicUseBindings);
      expect(valueAt(after, [...subtitle, 'fallback'])).toBe('Changed');
      valid(after);
    }
  });

  it('a forwarded copy from inside to outside the scope is ignored', () => {
    const before = onlyA();
    expect(tiles(documentEdit(before, touch(before), { copied: [{ from: a, to: b }] }))).toEqual(['tile-a', 'tile-b', 'unrelated-bound']);
    const after = scoped(before, touch(before), { copied: [{ from: a, to: b }] });
    expect(after).not.toBe(before);
    expect(after.logicUseBindings).toEqual(before.logicUseBindings);
    valid(after);
  });

  it('a forwarded copy from outside into the scope is ignored', () => {
    const before = onlyB(), candidate = touch(replaceAt(before, a, structuredClone(valueAt(before, b))));
    expect(tiles(documentEdit(before, candidate, { copied: [{ from: b, to: a }] }))).toEqual(['tile-b', 'tile-a', 'unrelated-bound']);
    const after = scoped(before, candidate, { copied: [{ from: b, to: a }] });
    expect(after).not.toBe(before);
    expect(after.logicUseBindings).toEqual(before.logicUseBindings);
    valid(after);
  });

  it('a retained object also placed outside the scope declares nothing there', () => {
    const before = onlyA(), candidate = touch(replaceAt(before, b, valueAt(before, a)));
    const after = scoped(before, candidate);
    expect(after).not.toBe(before);
    expect(valueAt(after, b)).toEqual(valueAt(before, a));
    expect(after.logicUseBindings).toEqual(before.logicUseBindings);
    valid(after);
  });

  it('an object the operation drops from its scope, placed outside, is followed by the boundary alone, as in turn', () => {
    // Not the operation's declaration: step 2 declares tile-a's subtitle only; the binding follows its use by the boundary's
    // own identity rule, exactly as when the outside edit is made first.
    const before = onlyA(), outside = (document: CompositionDocument) => replaceAt(document, b, valueAt(document, a));
    const operation = (document: CompositionDocument) => replaceAt(document, a, text('Replaced'));
    const first = documentEdit(before, outside(before));
    expect(tiles(first)).toEqual(['tile-a', 'unrelated-bound']);
    const sequential = scoped(first, operation(first)), combined = scoped(before, operation(outside(before)));
    expect(sequential).not.toBe(first);
    expect(tiles(combined)).toEqual(['tile-b', 'unrelated-bound']);
    expect(combined).toEqual(sequential);
    valid(combined);
  });

  describe('an id-less list on the scope path', () => {
    const cases = [...a, 'cases'], scope = [...cases, 0, 'then'];
    const choose = (): CompositionDocument => {
      const base = meaningFixture('page tile').document;
      return replaceAt({ ...base, logicUseBindings: base.logicUseBindings!.slice(1) }, a, { type: 'choose',
        cases: [{ when: check, then: text('Target') }, { when: check, then: text('One') }, { when: check, then: text('Two') }], otherwise: text('Fallback') });
    };
    const operation = (document: CompositionDocument) => ({ candidate: replaceAt(document, scope, text('Changed')), scope: [scope], retained: true,
      references: { fields: new Map([[fieldPointer(scope), [fieldPointer(scope)]]]) } });
    const list = (document: CompositionDocument) => valueAt(document, cases) as readonly unknown[];

    it('two other elements trading places is accepted, and is the trade followed by the operation', () => {
      const before = choose(), trade = (document: CompositionDocument) => { const [target, one, two] = list(document); return replaceAt(document, cases, [target, two, one]); };
      valid(before);
      const first = documentEdit(before, trade(before)), sequential = editWithin(first, operation(first)), edit = operation(before);
      const combined = editWithin(before, { ...edit, candidate: trade(edit.candidate) });
      expect(first).not.toBe(before);
      expect(sequential).not.toBe(first);
      expect(combined).not.toBe(before);
      expect(combined).toEqual(sequential);
      expect(valueAt(combined, [...cases, 1, 'then'])).toEqual(text('Two'));
      valid(combined);
    });

    it('a structurally equal clone at another index is refused', () => {
      const before = choose(), edit = operation(before);
      const candidate = replaceAt(edit.candidate, [...cases, 1], structuredClone(list(before)[1]));
      expect(JSON.stringify(list(candidate)[1])).toBe(JSON.stringify(list(before)[1]));
      expect(editWithin(before, edit)).not.toBe(before);
      expect(editWithin(before, { ...edit, candidate })).toBe(before);
    });

    it('a changed length is refused, and so is an element replaced by another of before\'s', () => {
      const before = choose(), edit = operation(before), [target, one, two] = list(edit.candidate);
      expect(editWithin(before, { ...edit, candidate: replaceAt(edit.candidate, cases, [target, one, two, one]) })).toBe(before);
      expect(editWithin(before, { ...edit, candidate: replaceAt(edit.candidate, cases, [target, one]) })).toBe(before);
      expect(editWithin(before, { ...edit, candidate: replaceAt(edit.candidate, cases, [target, one, one]) })).toBe(before);
      expect(two).toBe(list(before)[2]);
    });
  });
});

describe('Scoped edits: the element at a scoped index of an id-less list is a rebuild of before\'s there', () => {
  const slot: EditorPath = ['pages', 0, 'components', 0, 'props', 'subtitle', 'value'], cases = [...slot, 'cases'];
  const guest = { type: 'viewer' as const, isAdmin: false };
  /** Two uses of "Remove Me" in one choose, under different `when`s; only the first use's `source` is filled in from the tile. */
  const twoUses = (): CompositionDocument => {
    const base = meaningFixture('page tile').document;
    const use = (value: string) => ({ type: 'logic-ref', logicId: 'remove-me', args: { value: text(value), source: 'source-a' } });
    return replaceAt({
      ...base,
      logicUseBindings: [...base.logicUseBindings!.slice(1), { use: { kind: 'page', id: 'page-home', nodeId: 'tile-a', field: '/props/subtitle/value/cases/0/then' },
        logicId: 'remove-me', argument: 'source', from: { kind: 'use-tile', field: '/props/titleProviderId' } }],
      logicLibrary: [...base.logicLibrary!, { id: 'remove-me', name: 'Remove Me', kind: 'operand', params: [
        { name: 'value', kind: 'operand', sample: text('Sample') }, { name: 'source', kind: 'source-id', sample: 'source-b' },
      ], body: { type: 'hole', name: 'value' } }],
    } as CompositionDocument, slot, { type: 'choose', cases: [{ when: check, then: use('First') }, { when: guest, then: use('Second') }], otherwise: text('Fallback') });
  };
  const swap = (document: CompositionDocument) => { const [first, second] = valueAt(document, cases) as readonly unknown[]; return replaceAt(document, cases, [second, first]); };
  const removal = (document: CompositionDocument) => settingRemovalEdit(document, 'remove-me', 'value')!;
  const bound = (document: CompositionDocument) => document.logicUseBindings!.filter(binding => binding.logicId === 'remove-me').map(binding => binding.use.field);
  const otherTitle = (document: CompositionDocument) => replaceAt(document, ['pages', 0, 'components', 1, 'title'], 'Elsewhere');

  it('(a) Remove Setting with its two uses\' cases swapped is refused; in turn the binding follows its use', () => {
    const before = twoUses();
    valid(before);
    expect(removal(before).scope.filter(path => path.length > 2)).toEqual([[...cases, 0, 'then'], [...cases, 1, 'then']]);
    const first = documentEdit(before, swap(before)), sequential = editWithin(first, removal(first));
    expect(bound(sequential)).toEqual(['/props/subtitle/value/cases/1/then']);
    // The uses' self-relocations would hold the binding at cases/0, now the guest case's use: refused instead.
    const edit = removal(before);
    expect(editWithin(before, { ...edit, candidate: swap(edit.candidate) })).toBe(before);
    // Likewise the plan made on the swapped document, offered against the unswapped one.
    expect(editWithin(before, removal(swap(before)))).toBe(before);
  });

  it('(c) the same Remove Setting, unswapped, applies to both uses and keeps the binding on its use', () => {
    const before = twoUses(), after = editWithin(before, removal(before));
    expect(after).not.toBe(before);
    expect(after).toEqual(removeSettingPlan(before, 'remove-me', 'value').document);
    expect(after.logicLibrary!.find(entry => entry.id === 'remove-me')!.params.map(param => param.name)).toEqual(['source']);
    expect(valueAt(after, [...cases, 0, 'then', 'args'])).toEqual({ source: 'source-a' });
    expect(valueAt(after, [...cases, 1, 'then', 'args'])).toEqual({ source: 'source-a' });
    expect(valueAt(after, [...cases, 1, 'when'])).toBe(valueAt(before, [...cases, 1, 'when']));
    expect(bound(after)).toEqual(['/props/subtitle/value/cases/0/then']);
    valid(after);
  });

  it('(d) an outside change to a scoped case\'s own `when` is refused together, though it applies in turn', () => {
    const before = twoUses(), outside = (document: CompositionDocument) => replaceAt(document, [...cases, 0, 'when'], { ...check });
    const flip = (document: CompositionDocument) => replaceAt(document, [...cases, 0, 'when'], guest);
    for (const change of [outside, flip]) {
      const first = documentEdit(before, change(before));
      expect(first).not.toBe(before);
      expect(editWithin(first, removal(first))).not.toBe(first);
      const edit = removal(before);
      expect(editWithin(before, { ...edit, candidate: change(edit.candidate) })).toBe(before);
    }
  });

  it('(b) a field type change is refused when an outside edit swaps, or rewrites the `when` of, its case', () => {
    const base = meaningFixture('page tile').document, scope = [...cases, 0, 'then'];
    const before = replaceAt({ ...base, logicUseBindings: base.logicUseBindings!.slice(1) }, slot, { type: 'choose',
      cases: [{ when: check, then: { type: 'format', pattern: 'First', args: {} } }, { when: guest, then: text('') }], otherwise: text('Fallback') });
    valid(before);
    const edit = fieldTypeEdit(before, scope, literalSchema(), 'then');
    expect(editWithin(before, edit)).not.toBe(before);
    expect(editWithin(before, { ...edit, candidate: swap(edit.candidate) })).toBe(before);
    const rewritten = replaceAt(edit.candidate, [...cases, 0, 'when'], guest);
    expect(documentEdit(before, replaceAt(before, [...cases, 0, 'when'], guest))).not.toBe(before);
    expect(editWithin(before, { ...edit, candidate: rewritten })).toBe(before);
  });

  it('(e) Remove Setting, a field type change and Done with unrelated outside edits still equal their results in turn', () => {
    const elsewhere = (document: CompositionDocument) => replaceAt(otherTitle(document), [...slot, 'otherwise'], text('Other fallback'));
    const before = twoUses(), first = documentEdit(before, elsewhere(before));
    expect(first).not.toBe(before);
    const removed = removal(before), sequential = editWithin(first, removal(first)), combined = editWithin(before, { ...removed, candidate: elsewhere(removed.candidate) });
    expect(sequential).not.toBe(first);
    expect(combined).not.toBe(before);
    expect(combined).toEqual(sequential);
    valid(combined);

    const typed = replaceAt(before, [...cases, 1, 'then'], { type: 'format', pattern: 'Second', args: {} }), path = [...cases, 1, 'then'];
    valid(typed);
    const typedFirst = documentEdit(typed, elsewhere(typed)), change = fieldTypeEdit(typed, path, literalSchema(), 'then');
    const typedSequential = editWithin(typedFirst, fieldTypeEdit(typedFirst, path, literalSchema(), 'then'));
    const typedCombined = editWithin(typed, { ...change, candidate: elsewhere(change.candidate) });
    expect(typedSequential).not.toBe(typedFirst);
    expect(typedCombined).not.toBe(typed);
    expect(typedCombined).toEqual(typedSequential);
    valid(typedCombined);

    const layouts = start(true), doneFirst = documentEdit(layouts, otherTitle(layouts));
    const doneSequential = done(doneFirst), doneCombined = done(layouts, otherTitle);
    expect(doneSequential).not.toBe(doneFirst);
    expect(doneCombined).not.toBe(layouts);
    expect(doneCombined).toEqual(doneSequential);
    valid(doneCombined);
  });
});
