// @vitest-environment jsdom
/**
 * Scoped edits (`editWithin`, docs/flows-canvas.md "Declared operations"): an operation's declarations speak for its own
 * scope only, its scope must still name the same owners, and an operation made together with an outside edit is exactly
 * the outside edit followed by the operation, or refused. The first describe is the independent review of ffcabcbe, kept.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fieldVariants, nodeDefinition, replaceAt, valueAt, variantName, type EditorPath } from '../../../src/composition-editor';
import type { CompositionDocument } from '../../../src/shared/composition/schema';
import type { Operand } from '../../../src/shared/composition/expression';
import { encodeStudioCanvas, readStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../../src/shared/composition/studio-logic/schemas';
import { operandSlot } from '../../../src/workspace2/expr/tokens';
import { documentEdit, LINKED_EDIT_REFUSAL } from '../../../src/workspace2/editors/documentEdit';
import { editWithin, fieldTypeEdit } from '../../../src/workspace2/editors/provenance';
import { fieldPointer, liftField } from '../../../src/workspace2/logic-fields/registry';
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
