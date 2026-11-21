import { describe, expect, it } from 'vitest';
import { valueAt } from '../../../src/composition-editor';
import { compileCompositionDocument, compileCompositionDocumentWithOrigins } from '../../../src/shared/composition/compiler';
import type { Operand } from '../../../src/shared/composition/expression';
import { lift, projectGraph, type GraphNode, type LogicAnchor } from '../../../src/shared/composition/graph';
import { CompositionValidationError } from '../../../src/shared/composition/json';
import { publishedDocument } from '../../../src/shared/composition/logic-library';
import type { CompositionDocument } from '../../../src/shared/composition/schema';
import { encodeStudioCanvas, normalizeAnnotation, prepareStudioDocument, readStudioCanvas, studioCanvasMetadataSchema } from '../../../src/shared/composition/studio-logic';
import { createCompositionDocument } from '../../../src/shared/composition/workspace';
import type { Json } from '../../../src/shared/types';
import { createDraft } from '../../../src/workspace2/editors/draft';
import { rebuildField } from '../../../src/workspace2/editors/provenance';
import { saveCanvasLayout, uncertifiedCanvasRoots } from '../../../src/workspace2/logic-fields/layout';

const path = ['logicLibrary', 0, 'body'];
const anchor = (id = 'sum'): LogicAnchor => ({ kind: 'logic', id, field: '/body' });
const annotation = (owner: string, index: number): GraphNode['annotation'] => [
  { label: `${owner} label`, note: `${owner} purpose` },
  { label: `${owner} first input` },
  { note: `${owner} removed input` },
][index];
function fixture() {
  const body: Operand = { type: 'math', op: 'add', args: [1, 2, 3].map(value => ({ type: 'literal', value })) };
  const document = compileCompositionDocument({
    ...createCompositionDocument('annotations'),
    logicLibrary: ['sum', 'other'].map(id => ({ id, name: id, kind: 'operand', params: [], body })),
  }).document;
  const roots = ['sum', 'other'].map((owner, root) => {
    const graph = lift(body, { kind: 'operand', anchor: anchor(owner) }).graph;
    return { anchor: anchor(owner), nodes: graph.nodes.map((node, index) => ({
      id: node.id, origins: node.origins, x: root * 1000 + index * 100, y: index * 75, ...annotation(owner, index),
    })) };
  });
  const stored = encodeStudioCanvas(document, [{ id: 'annotated', roots }]);
  return { document, roots, stored, saved: { ...document, studioCanvas: stored } };
}
function reopen(document: CompositionDocument, owner = 'sum') {
  const index = owner === 'sum' ? 0 : 1;
  const layout = readStudioCanvas(document);
  expect(layout.warnings).toEqual([]);
  return lift(valueAt(document, ['logicLibrary', index, 'body']) as Json, {
    kind: 'operand', anchor: anchor(owner), metadata: layout.metadata,
  }).graph;
}

describe('Studio-only block annotations', () => {
  it('normalizes editable text, accepts exact limits and removes empty fields', () => {
    expect(normalizeAnnotation({ label: '  Office PC  ', note: '  Power switch  ' })).toEqual({ label: 'Office PC', note: 'Power switch' });
    expect(normalizeAnnotation({ label: '  ', note: ' Purpose ' })).toEqual({ note: 'Purpose' });
    expect(normalizeAnnotation({ label: ' Label ', note: ' ' })).toEqual({ label: 'Label' });
    expect(normalizeAnnotation({ label: '  ', note: '' })).toBeUndefined();
    expect(normalizeAnnotation({})).toBeUndefined();
    expect(normalizeAnnotation(undefined)).toBeUndefined();
    expect(normalizeAnnotation({ label: ` ${'L'.repeat(60)} `, note: ` ${'N'.repeat(280)} ` }))
      .toEqual({ label: 'L'.repeat(60), note: 'N'.repeat(280) });
  });

  it.each([
    { label: 'L'.repeat(61) }, { note: 'N'.repeat(281) },
    { label: '\tOffice PC' }, { note: 'Power switch\n' }, { label: 'Power\u0000switch' },
    { label: 'Power\u007fswitch' }, { note: 'Power\u0085switch' }, { label: 'Power\u200bswitch' },
  ])('refuses invalid edits before trimming: %j', input => {
    expect(() => normalizeAnnotation(input)).toThrow(CompositionValidationError);
  });

  it('A1: encode, save, reopen, read and lift restore the right annotations without changing positions', () => {
    const { roots, saved } = fixture();
    const reopened = compileCompositionDocument(JSON.parse(JSON.stringify(saved))).document;
    expect(studioCanvasMetadataSchema.parse(reopened.studioCanvas).version).toBe(2);
    for (const [root, owner] of ['sum', 'other'].entries()) {
      const graph = reopen(reopened, owner);
      expect(graph.nodes.map(node => ({ id: node.id, origins: node.origins, ...node.position, ...node.annotation }))).toEqual(roots[root].nodes);
      expect(graph.nodes.at(-1)).not.toHaveProperty('annotation');
    }
    expect(reopen(reopened).nodes[0].id).toBe(reopen(reopened, 'other').nodes[0].id);
  });

  it.each([
    { label: 'L'.repeat(61) }, { note: 'N'.repeat(281) },
    { label: 'Bad\nlabel' }, { note: 'Bad\tnote' }, { label: 'Bad\u0000label' },
    { label: 'Bad\u007flabel' }, { note: 'Bad\u0085note' }, { label: 'Bad\u200blabel' },
    { label: '' }, { note: '   ' }, { label: ' untrimmed ' },
    { label: 17 }, { note: null }, { annotation: { label: 'Wrong shape' } }, { unexpected: 'Unknown field' },
  ])('A2: invalid saved annotations warn without changing the AST: %j', invalid => {
    const { document, stored } = fixture();
    Object.assign(stored.canvases[0].nodes[0], invalid);
    const saved = { ...document, studioCanvas: stored }, before = JSON.stringify(saved);
    expect(studioCanvasMetadataSchema.safeParse(stored).success).toBe(false);
    const layout = readStudioCanvas(saved);
    expect(layout.raw).toBe(stored);
    expect(layout.metadata).toBeUndefined();
    expect(layout.warnings).toEqual([{ severity: 'warning', code: 'invalid_layout', pointer: '/studioCanvas', message: "Saved layout can't be used." }]);
    const result = compileCompositionDocumentWithOrigins(saved);
    expect(result.compiled.document).toEqual(saved);
    expect(result.compiled.expanded).toEqual(compileCompositionDocument(document).expanded);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('refuses invalid annotations supplied to the canonical writer rather than repairing them', () => {
    const { document, roots } = fixture();
    const invalid = { ...roots[0], nodes: roots[0].nodes.map(node => ({ ...node, label: 'L'.repeat(61) })) };
    expect(() => encodeStudioCanvas(document, [{ id: 'invalid', roots: [invalid] }])).toThrow(CompositionValidationError);
  });

  it('A3: preparation, publication and lowering contain no annotation text', () => {
    const { document, saved } = fixture();
    expect(prepareStudioDocument(saved).document).toEqual(document);
    expect(publishedDocument(saved)).toEqual(publishedDocument(document));
    expect(compileCompositionDocument(saved).expanded).toEqual(compileCompositionDocument(document).expanded);
    expect(JSON.stringify(prepareStudioDocument(saved).document)).not.toMatch(/sum label|sum purpose|other label|removed input/);
    expect(JSON.stringify(publishedDocument(saved))).not.toMatch(/sum label|sum purpose|other label|removed input/);
    expect(projectGraph(reopen(saved)).ast).toEqual(valueAt(document, path));
  });

  it('A4: structural rebase follows surviving inputs, drops deleted annotations and preserves unrelated owners', () => {
    const { saved, stored } = fixture(), before = JSON.stringify(saved);
    expect(uncertifiedCanvasRoots(saved, stored)).toEqual(new Set());
    const body = valueAt(saved, path) as Extract<Operand, { type: 'math' }>;
    const draft = createDraft(saved);
    draft.set(rebuildField(saved, path, { ...body, args: [body.args[2], body.args[0]] }));
    const after = draft.get(), graph = reopen(after);
    expect(graph.nodes.map(node => ({ origins: node.origins, annotation: node.annotation, position: node.position }))).toEqual([
      { origins: [''], annotation: annotation('sum', 0), position: { x: 0, y: 0 } },
      { origins: ['/args/0'], annotation: undefined, position: { x: 300, y: 225 } },
      { origins: ['/args/1'], annotation: annotation('sum', 1), position: { x: 100, y: 75 } },
    ]);
    expect(JSON.stringify(after.studioCanvas)).not.toContain('sum removed input');
    expect(reopen(after, 'other')).toEqual(reopen(saved, 'other'));
    expect(JSON.stringify(saved)).toBe(before);
    draft.undo();
    expect(draft.get()).toBe(saved);
    draft.redo();
    expect(draft.get()).toBe(after);
  });

  it('Apply associates annotations by lowering source map and is one immutable undoable transaction', () => {
    const { document } = fixture();
    const graph = lift(valueAt(document, path) as Json, { kind: 'operand', anchor: anchor() }).graph;
    const edited = { ...graph, nodes: graph.nodes.map((node, index): GraphNode => index === 1
      ? { ...node, payload: { kind: 'operand', value: { type: 'literal', value: 10 } } } : node) };
    const projected = projectGraph(edited);
    const proposed = rebuildField(document, path, projected.ast);
    const applied = saveCanvasLayout(proposed, [{ anchor: anchor(), ast: projected.ast }], {
      graph: edited, sourceMap: projected.sourceMap,
      positions: Object.fromEntries(edited.nodes.map((node, index) => [node.id, { x: index * 80, y: 240 }])),
      annotations: Object.fromEntries(edited.nodes.map(node => [node.id, { label: '  Applied label  ', note: ' Applied note ' }])),
    }, { document, paths: [path] });
    const draft = createDraft(document);
    draft.set(applied);
    expect(draft.get()).toBe(applied);
    const reopened = reopen(compileCompositionDocument(JSON.parse(JSON.stringify(applied))).document);
    expect(reopened.nodes.every(node => node.annotation?.label === 'Applied label' && node.annotation.note === 'Applied note')).toBe(true);
    expect(reopened.nodes.every(node => node.position?.y === 240)).toBe(true);
    expect(reopened.nodes[1].id).not.toBe(graph.nodes[1].id);
    expect(valueAt(applied, [...path, 'args', 0, 'value'])).toBe(10);
    expect(document.studioCanvas).toBeUndefined();
    expect(valueAt(document, [...path, 'args', 0, 'value'])).toBe(1);
    draft.undo();
    expect(draft.get()).toBe(document);
    expect(draft.canUndo()).toBe(false);
    draft.redo();
    expect(draft.get()).toBe(applied);
  });

  it('A5: stored layouts and handoffs without annotations stay usable; an empty handoff removes annotations', () => {
    const { document, roots, saved } = fixture();
    const legacy = { ...document, studioCanvas: encodeStudioCanvas(document, [{
      id: 'without-annotations', roots: roots.map(root => ({ ...root, nodes: root.nodes.map(({ id, origins, x, y }) => ({ id, origins, x, y })) })),
    }]) };
    for (const owner of ['sum', 'other']) {
      expect(reopen(legacy, owner).nodes.every(node => !Object.hasOwn(node, 'annotation'))).toBe(true);
      expect(reopen(legacy, owner).nodes.map(node => node.position)).toEqual(reopen(saved, owner).nodes.map(node => node.position));
    }
    const graph = reopen(saved), projected = projectGraph(graph);
    const cleared = saveCanvasLayout(saved, [{ anchor: anchor(), ast: projected.ast }], {
      graph, sourceMap: projected.sourceMap,
      positions: Object.fromEntries(graph.nodes.map(node => [node.id, node.position!])),
    });
    expect(reopen(cleared).nodes.every(node => !Object.hasOwn(node, 'annotation'))).toBe(true);
    expect(reopen(cleared).nodes.map(node => node.position)).toEqual(graph.nodes.map(node => node.position));
    expect(reopen(cleared, 'other')).toEqual(reopen(saved, 'other'));
    const stored = studioCanvasMetadataSchema.parse(cleared.studioCanvas);
    for (const node of stored.canvases[0].nodes.filter(node => node.rootId === stored.canvases[0].roots[0].id)) {
      expect(node).not.toHaveProperty('label');
      expect(node).not.toHaveProperty('note');
    }
    expect(saved.studioCanvas.canvases[0].nodes[0].label).toBe('sum label');
  });
});
