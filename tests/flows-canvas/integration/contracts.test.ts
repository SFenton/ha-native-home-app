import { describe, expect, it } from 'vitest';
import { compositionEditorSchema, fieldVariants, replaceAt, resolveField, valueAt, type SchemaField } from '../../../src/composition-editor';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { expandDocument } from '../../../src/shared/composition/components';
import { createCompositionDocument, compositionSymbol } from '../../../src/shared/composition/workspace';
import { lower, lift, type GraphDestination } from '../../../src/shared/composition/graph';
import { projectGraph } from '../../../src/shared/composition/graph/lower';
import { readStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { fieldAdapters, fieldAnchor, fieldPointer, liftField, schemaFieldKind, type LogicFieldKind } from '../../../src/workspace2/logic-fields/registry';
import { explicitTemplateUse, unlinkTemplate } from '../../../src/workspace2/logic-fields/templates';
import { createDraft } from '../../../src/workspace2/editors/draft';
import { rebuildField } from '../../../src/workspace2/editors/provenance';
import { saveCanvasLayout } from '../../../src/workspace2/logic-fields/layout';
import { componentDocument, draftDocument } from '../draft/fixtures';
import type { Json } from '../../../src/shared/types';
import { integrationDocument, reroutedFields } from './fixture';
import { previewGraph, templateUses } from '../../../src/workspace2/logic-fields/lenses';
import { createSimulationProgram } from '../../../src/workspace2/logic-simulation/program';

const typed = () => compileCompositionDocument(draftDocument()).document;
it('requires a registry adapter for every graph destination at compile time', () => {
  const exhaustive: Record<GraphDestination['kind'], { destination: LogicFieldKind }> = fieldAdapters;
  expect(Object.keys(exhaustive).sort()).toEqual(['call', 'condition', 'document', 'flow', 'fragment', 'operand', 'slot']);
  // @ts-expect-error a field kind cannot bypass the registry
  const missing: LogicFieldKind = 'unregistered-field';
  expect(Object.hasOwn(exhaustive, missing)).toBe(false);
});
it('lists every schema logic boundary and resolves each through its adapter', () => {
  const fields: string[] = [];
  function visit(raw: SchemaField, at: string, parents: Set<SchemaField>) {
    const schema = resolveField(raw);
    if (parents.has(schema)) return;
    const variants = fieldVariants(schema);
    const types = variants.map(variant => variant.properties?.type?.const);
    const expected = schema.xValue ? 'slot' : types.includes('compare') ? 'condition' : types.includes('math') ? 'operand'
      : types.length === 1 && types[0] === 'call-service' ? 'call' : schema.properties?.model?.const === 'pipeline@1' ? 'flow' : undefined;
    if (expected) {
      expect(schemaFieldKind(schema), at).toBe(expected);
      expect(fieldAdapters[expected].destination).toBe(expected);
      fields.push(`${at}: ${expected}`);
      return;
    }
    const branch = new Set(parents).add(schema);
    for (const [key, child] of Object.entries(schema.properties ?? {})) visit(child, `${at}/${key}`, branch);
    if (schema.items && !Array.isArray(schema.items)) visit(schema.items, `${at}/*`, branch);
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') visit(schema.additionalProperties, `${at}/*`, branch);
    for (const variant of schema.anyOf ?? schema.oneOf ?? []) visit(variant, `${at}[${variant.properties?.type?.const ?? variant.properties?.model?.const ?? variant.properties?.kind?.const ?? 'variant'}]`, branch);
  }
  visit(compositionEditorSchema, '', new Set());
  expect(fields.some(field => field.includes('/selectedWhen: condition'))).toBe(true);
  expect(fields.some(field => field.includes('/isOn: condition'))).toBe(true);
  expect(fields.some(field => field.includes('[bound-control]/props/value: operand'))).toBe(true);
  expect(fields.sort()).toMatchSnapshot();
});
describe('unchanged field bytes survive the registry', () => {
  it.each(reroutedFields)('%s lifts and saves exactly its existing bytes', (_field, kind, path) => {
    const document = integrationDocument();
    const before = JSON.stringify(document);
    const lifted = liftField(document, path, kind);
    const projected = projectGraph(lifted.graph);
    const after = fieldAdapters[kind].write(document, path, projected.ast);
    expect(after).toBe(document);
    expect(JSON.stringify(after)).toBe(before);
    expect(compileCompositionDocument(after).document).toEqual(document);
  });
  it.each(reroutedFields)('%s layout survives Apply, save and reopen at its real consuming address', (_field, kind, path) => {
    const document = integrationDocument(), graph = liftField(document, path, kind).graph, projected = projectGraph(graph);
    const saved = saveCanvasLayout(document, [{ anchor: graph.roots[0].anchor, ast: projected.ast }], {
      graph, sourceMap: projected.sourceMap, positions: Object.fromEntries(graph.nodes.map(node => [node.id, { x: 120, y: 240 }])),
    });
    const reopened = lift(valueAt(saved, path) as Json, { anchor: fieldAnchor(saved, path), kind, metadata: readStudioCanvas(saved).metadata,
      context: { document: saved as unknown as Json, pointer: fieldPointer(path) },
    }).graph;
    expect(readStudioCanvas(saved).warnings).toEqual([]);
    expect(reopened.nodes.map(node => node.position)).toEqual(graph.nodes.map(() => ({ x: 120, y: 240 })));
    expect(saved.logicUseBindings).toEqual(document.logicUseBindings);
  });
});
it('preserves canonical library layout and bindings through save, reopen and lift', () => {
  const document = typed(), path = ['logicLibrary', 0, 'body'];
  const graph = liftField(document, path, 'operand').graph, projected = projectGraph(graph);
  const positioned = saveCanvasLayout(document, [{ anchor: graph.roots[0].anchor, ast: projected.ast }], {
    graph, sourceMap: projected.sourceMap, positions: Object.fromEntries(graph.nodes.map(node => [node.id, { x: 480, y: 120 }])),
  });
  const saved = compileCompositionDocument(JSON.parse(JSON.stringify(positioned))).document;
  expect(fieldAnchor(saved, path)).toEqual({ kind: 'logic', id: 'tile-label', field: '/body' });
  expect(saved.logicUseBindings).toEqual(document.logicUseBindings);
  const reopened = lift(valueAt(saved, path) as Json, { kind: 'operand', anchor: fieldAnchor(saved, path), metadata: readStudioCanvas(saved).metadata });
  expect(reopened.graph.nodes.every(node => node.position?.x === 480)).toBe(true);
});
it('reanchors a document-level field after semantic edits instead of saving stale positions', () => {
  const path = ['navigation', 'tabs', 0, 'visibleWhen'];
  const base = typed();
  const before = compileCompositionDocument({ ...base, navigation: { ...base.navigation, tabs: [{ id: 'tab', label: 'Home', icon: compositionSymbol(), pageId: 'page-home', arguments: {}, visibleWhen: { type: 'viewer', isAdmin: true } }] } }).document;
  const graph = liftField(before, path, 'condition').graph, projection = projectGraph(graph);
  const after = replaceAt(before, path, { type: 'viewer', isAdmin: false });
  const saved = saveCanvasLayout(after, [{ anchor: graph.roots[0].anchor, ast: valueAt(after, path) as Json }], {
    graph, sourceMap: projection.sourceMap, positions: Object.fromEntries(graph.nodes.map(node => [node.id, { x: 12, y: 24 }])),
  }, { document: before, paths: [path] });
  expect(readStudioCanvas(saved).warnings).toEqual([]);
  expect(readStudioCanvas(saved).metadata?.canvases[0].roots[0]).toEqual(fieldAnchor(after, path));
});
it('refuses missing arguments instead of copying a template sample into a real use', () => {
  const entry = { ...typed().logicLibrary![0], params: [{ name: 'source', kind: 'source-id' as const, sample: 'source-a' }] };
  expect(() => explicitTemplateUse(entry, {})).toThrow(/explicitly/);
  expect(explicitTemplateUse(entry, { source: 'source-b' })).toEqual({ type: 'logic-ref', logicId: 'tile-label', args: { source: 'source-b' } });
});
it('unlinks two bound uses with different tile values without leaving stale bindings', () => {
  const document = typed();
  const first = unlinkTemplate(document, ['pages', 0, 'components', 0, 'props', 'subtitle', 'value']);
  const second = unlinkTemplate(first, ['pages', 0, 'components', 1, 'props', 'subtitle', 'value']);
  expect(valueAt(second, ['pages', 0, 'components', 0, 'props', 'subtitle', 'value', 'from', 'sourceId'])).toBe('source-a');
  expect(valueAt(second, ['pages', 0, 'components', 1, 'props', 'subtitle', 'value', 'from', 'sourceId'])).toBe('source-b');
  expect(second.logicUseBindings).toEqual([]);
  expect(compileCompositionDocument(second).expanded).toEqual(compileCompositionDocument(document).expanded);
});
it('reanchors a moved component-owned use with its canonical owner and resolves each placed tile independently', () => {
  const document = compileCompositionDocument(componentDocument()).document;
  const path = ['componentLibrary', 0, 'node', 'props', 'subtitle'];
  const use = valueAt(document, [...path, 'value']);
  const draft = createDraft(document);
  draft.set(rebuildField(document, path, {
    type: 'expr', value: { type: 'format', pattern: 'Room: {value}', args: { value: use } },
  }));
  const next = draft.get();
  expect(next.logicUseBindings![0].use).toEqual({ kind: 'component', id: 'saved-tile', nodeId: 'inner-tile', field: '/props/subtitle/value/args/value' });
  const expanded = expandDocument(compileCompositionDocument(next).expanded);
  for (const [index, sourceId] of ['source-a', 'source-b'].entries()) {
    expect(valueAt(expanded, ['pages', 0, 'components', index, 'props', 'subtitle', 'value', 'args', 'value', 'from', 'sourceId'])).toBe(sourceId);
  }
});
it('unlinks nested uses without filling the enclosing template holes', () => {
  const document = typed();
  const nested = { id: 'nested', name: 'Nested', kind: 'operand' as const, params: [{ name: 'source', kind: 'source-id' as const }], body: { type: 'logic-ref' as const, logicId: 'tile-label', args: { source: { type: 'hole', name: 'source' } } } };
  const original = { ...document, logicLibrary: [...document.logicLibrary!, nested] };
  const next = unlinkTemplate(original, ['logicLibrary', 1, 'body']);
  expect(valueAt(next, ['logicLibrary', 1, 'body', 'from', 'sourceId'])).toEqual({ type: 'hole', name: 'source' });
  expect(compileCompositionDocument(next).expanded).toEqual(compileCompositionDocument(original).expanded);
});
it('allows only explicitly selected, matching enclosing holes in nested uses', () => {
  const document = integrationDocument(), entry = document.logicLibrary![0], hole = { type: 'hole', name: 'enclosingSource' };
  expect(() => explicitTemplateUse(entry, { source: hole })).toThrow(/explicitly/);
  expect(() => explicitTemplateUse(entry, { source: hole }, [{ name: 'enclosingSource', kind: 'text' }])).toThrow(/explicitly/);
  expect(explicitTemplateUse(entry, { source: hole }, [{ name: 'enclosingSource', kind: 'source-id' }]).args).toEqual({ source: hole });
});
it('projects values, stand-in and per-use lenses without serializing preview settings', () => {
  const document = integrationDocument(), before = JSON.stringify(document), path = ['logicLibrary', 0, 'body'];
  const graph = liftField(document, path, 'operand').graph;
  const values = previewGraph(document, graph, path, { kind: 'values' });
  const standIn = previewGraph(document, graph, path, { kind: 'stand-in' }, { source: 'source-b' });
  expect(projectGraph(values).ast).toMatchObject({ from: { sourceId: 'source-a' } });
  expect(projectGraph(standIn).ast).toMatchObject({ from: { sourceId: 'source-b' } });
  const uses = templateUses(document, document.logicLibrary![0]);
  const first = previewGraph(document, graph, path, { kind: 'use', anchor: uses[0].anchor });
  const second = previewGraph(document, graph, path, { kind: 'use', anchor: uses[1].anchor });
  expect(projectGraph(first).ast).toMatchObject({ from: { sourceId: 'source-a' } });
  expect(projectGraph(second).ast).toMatchObject({ from: { sourceId: 'source-b' } });
  expect(createSimulationProgram([second]).roots[0].body.kind).toBe('operand');
  expect(second.roots[0].nodeId).toBe(graph.roots[0].nodeId);
  expect(JSON.stringify(document)).toBe(before);
  expect(graph.original).toEqual(valueAt(document, path));
});
it.each([0, 1, 5])('simulates a real text slot with its consuming context and without persisting resolved use %i', index => {
  const document = integrationDocument(), before = JSON.stringify(document);
  const path = index === 5 ? ['pages', 0, 'components', index, 'props', 'primary'] : ['pages', 0, 'components', index, 'props', 'subtitle'];
  const graph = liftField(document, path, 'slot').graph;
  const preview = previewGraph(document, graph, path, { kind: 'values' });
  expect(createSimulationProgram([preview]).roots[0].body.kind).toBe('slot');
  expect(JSON.stringify(document)).toBe(before);
});
