/**
 * Documents shared by the binding invariant suite and the oracle comparison: real draft and component fixtures, then
 * meaning fixtures (automatic bindings, value and private-source component parameters, an optional component and a
 * second page), optionally with saved canvas layouts and groups.
 */
import { expect } from 'vitest';
import { replaceAt, valueAt, type EditorPath } from '../../../src/composition-editor';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { bodyNodes, fieldSteps, ownedSources, readField } from '../../../src/shared/composition/components';
import { record, resolveLogicAnchor } from '../../../src/shared/composition/studio-logic/anchors';
import { resolveLogicUseBindings } from '../../../src/shared/composition/studio-logic/bindings';
import { encodeStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../../src/shared/composition/studio-logic/schemas';
import type { CompositionDocument } from '../../../src/shared/composition/schema';
import type { Operand } from '../../../src/shared/composition/expression';
import { createDraft, type Draft } from '../../../src/workspace2/editors/draft';
import { editSubtrees, rebuildField } from '../../../src/workspace2/editors/provenance';
import { authoredNodes, liftField, pointerPath } from '../../../src/workspace2/logic-fields/registry';
import { setPerPlace } from '../../../src/workspace2/params';
import { operandSlot, slotOperand } from '../../../src/workspace2/expr/tokens';
import { moveNodeTo } from '../../../src/workspace2/nodeActions';
import { binding, componentDocument, draftDocument, labelTemplate, privateSourceFixture, tile } from '../draft/fixtures';
import lamps from '../../fixtures/templates-lamps.json';

export const pageSlot: EditorPath = ['pages', 0, 'components', 0, 'props', 'subtitle'];
export const componentSlot: EditorPath = ['componentLibrary', 0, 'node', 'props', 'subtitle'];
export const text = (value: string): Operand => ({ type: 'literal', value });
export const check = { type: 'viewer' as const, isAdmin: true };
export function fixture(kind: string) {
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
    draft.set(editSubtrees(document, { ...replaceAt(document, [...slot, 'value'], { type: 'logic-ref', logicId: 'outer', args: { value: operand } }),
      logicLibrary: [...document.logicLibrary!, { id: 'outer', name: 'Outer', kind: 'operand', params: [{ name: 'value', kind: 'operand' }],
        body: { type: 'format', pattern: '{value}', args: { value: { type: 'hole', name: 'value' } } } }],
    }));
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
export function rules(draft: Draft, slot: EditorPath, reverse = false) {
  const operand = slotOperand(valueAt(draft.get(), slot) as { type: string })!;
  const cases = [{ when: check, then: operand }, { when: { ...check, isAdmin: false }, then: text('Other') }];
  draft.set(rebuildField(draft.get(), slot, operandSlot({ type: 'choose', cases: reverse ? cases.reverse() : cases, otherwise: text('Otherwise') }, valueAt(draft.get(), slot))));
}
export function valid(document: CompositionDocument) {
  compileCompositionDocument(document);
  expect(resolveLogicUseBindings(document).bindings).toHaveLength(document.logicUseBindings?.length ?? 0);
  for (const entry of document.componentLibrary ?? []) for (const binding of entry.bindings ?? []) {
    const node = binding.nodeId ? bodyNodes(entry.node).find(node => node.id === binding.nodeId) : ownedSources(entry).find(source => source.id === binding.sourceId);
    expect(node, binding.field).toBeDefined();
    const param = entry.params!.find(param => param.name === binding.param)!;
    expect(readField(node, param.kind === 'value' ? fieldSteps(binding.field).slice(0, -1).join('/') : binding.field), binding.field).toBeDefined();
  }
}
export function meaningFixture(kind: string, policy: 'fallback' | 'keep' = 'fallback') {
  const { document: original, slot } = fixture(kind === 'private sources' ? 'component parameters' : kind === 'id and type arguments' ? 'nested operand' : kind);
  let document = replaceAt(original, kind.startsWith('component') || kind === 'private sources'
    ? ['componentLibrary', 0, 'node', 'props', 'titleProviderId'] : ['pages', 0, 'components', 0, 'props', 'titleProviderId'], 'source-b');
  if (kind === 'id and type arguments') {
    document = replaceAt(document, ['logicLibrary', 1, 'params'], [...document.logicLibrary![1].params, { name: 'id', kind: 'text' }, { name: 'type', kind: 'text' }]);
    document = replaceAt(document, [...slot, 'value', 'args'], { ...valueAt(document, [...slot, 'value', 'args']) as object, id: 'not-a-node', type: 'literal' });
  }
  if (kind === 'private sources') {
    document = replaceAt(document, ['componentLibrary', 0, 'sources'], [privateSourceFixture.source]);
    document = replaceAt(document, ['componentLibrary', 0, 'params'], [...document.componentLibrary![0].params!, { name: 'privateEntity', kind: 'entity-id' }]);
    document = replaceAt(document, ['componentLibrary', 0, 'bindings'], [...document.componentLibrary![0].bindings!, { param: 'privateEntity', sourceId: 'private-state', field: 'entityId/value' }]);
    for (const index of [0, 1]) document = replaceAt(document, ['pages', 0, 'components', index, 'args', 'privateEntity'], privateSourceFixture.placements[index]);
  }
  const independent = replaceAt(tile('unrelated-bound', 'source-b'), ['props', 'subtitle', 'value', 'logicId'], 'other-label');
  document = { ...document, logicLibrary: [...document.logicLibrary!, { ...labelTemplate, id: 'other-label', name: 'Other label' } as NonNullable<CompositionDocument['logicLibrary']>[number]],
    logicUseBindings: [...document.logicUseBindings!, { ...binding('unrelated-bound'), logicId: 'other-label' }],
    pages: [{ ...document.pages[0], components: [...document.pages[0].components, independent as CompositionDocument['pages'][number]['components'][number]] }, ...document.pages.slice(1)],
  };
  const optional = compileCompositionDocument(lamps.document).document.componentLibrary![0];
  document = { ...document, componentLibrary: [...document.componentLibrary ?? [], {
    ...optional, params: [{ name: 'tint', kind: 'value' }], bindings: [{ param: 'tint', nodeId: 'demo-lamp', field: 'glyphTint' }],
  }], pages: [...document.pages, { ...document.pages[0], id: 'other-page', title: 'Other page', components: [] }] };
  const optionalIndex = document.componentLibrary!.length - 1;
  document = replaceAt(document, ['componentLibrary', optionalIndex, 'node', 'children', 0, 'glyphTint'], { type: 'solid-rgb', red: 10, green: 20, blue: 30 });
  for (const index of [0, 1]) document = replaceAt(document, ['pages', index, 'components'], [...document.pages[index].components, {
    id: `optional-${index}`, type: 'component-ref', componentId: optional.id, layout: { span: 1 },
    values: { tint: { type: 'solid-rgb', red: 20 + index * 80, green: 40, blue: 60 } },
  }]);
  if (kind.startsWith('component') || kind === 'private sources') {
    const draft = createDraft(document);
    draft.set(moveNodeTo(document, 'place-1', { kind: 'surface', id: 'other-page' }));
    document = draft.get();
  }
  for (const location of authoredNodes(document)) {
    const subtitlePath = [...location.path, 'props', 'subtitle'];
    const subtitle = valueAt(document, subtitlePath);
    if (record(subtitle) && (subtitle.type === 'expr' || subtitle.type === 'read')) document = replaceAt(document, subtitlePath,
      { ...subtitle, fallback: `Fallback for ${location.node.id}`, whenUnavailable: policy });
  }
  valid(document);
  return { document, slot, optionalIndex };
}
export function withMeaningCanvas(document: CompositionDocument, slot: EditorPath) {
  const unrelated = document.pages.flatMap((page, pageIndex) => page.components.flatMap((node, nodeIndex) => node.id === 'tile-b'
    ? [['pages', pageIndex, 'components', nodeIndex, 'props', 'subtitle']] : []))[0];
  const graphs = [slot, unrelated].map(path => liftField(document, path, 'slot').graph);
  const metadata = encodeStudioCanvas(document, graphs.map((graph, index) => ({
    id: `meaning-${index}`, roots: [{ anchor: graph.roots[0].anchor, nodes: graph.nodes.map((node, nodeIndex) => ({
      id: node.id, origins: node.origins, x: 120 + nodeIndex * 100, y: 240 + index * 100,
    })) }],
  })));
  return { ...document, studioCanvas: studioCanvasMetadataSchema.parse({ ...metadata, canvases: metadata.canvases.map(canvas => ({
    ...canvas, groups: [{ id: 'meaning-group', label: 'Keep these together', nodeIds: canvas.nodes.map(node => node.id) },
      { id: 'featured', label: 'Keep this member', nodeIds: [canvas.nodes[0].id] }],
  })) }) };
}
