// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveCompositionNode, replaceAt, valueAt, type EditorPath } from '../../../src/composition-editor';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { bodyNodes, derivedId, expandDocument, fieldSteps, ownedSources, readField, renameSources } from '../../../src/shared/composition/components';
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
import RulePage, { duplicateRule } from '../../../src/workspace2/expr/RulePage';
import { bodyWithSamples, deleteEntry, saveLogicTemplate, workedOut } from '../../../src/workspace2/data/logic/logicModel';
import { resolvedLogicValue, unlinkTemplate } from '../../../src/workspace2/logic-fields/templates';
import { evaluateOperand as editorValue, registerFill } from '../../../src/workspace2/data/logic/logicEval';
import { useSentence } from '../../../src/workspace2/data/logic/logicNames';
import { evaluateOperand, resolveText, type TextSlot, type Environment } from '../../../src/shared/composition/evaluator';
import { operandBase } from '../../../src/shared/composition/expression';
import { record } from '../../../src/shared/composition/studio-logic/anchors';
import { encodeStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../../src/shared/composition/studio-logic/schemas';
import { newToken, operandSlot, slotOperand } from '../../../src/workspace2/expr/tokens';
import { authoredNodes } from '../../../src/workspace2/logic-fields/registry';
import { canvasReferences, copySubtree, editSubtrees, rebuildField } from '../../../src/workspace2/editors/provenance';
import { documentEdit } from '../../../src/workspace2/editors/documentEdit';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { houseFrom } from '../../../src/preview2/projections';
import { binding, componentDocument, draftDocument, labelTemplate, privateSourceFixture, tile } from '../draft/fixtures';
import { integrationSnapshot } from './fixture';
import lamps from '../../fixtures/templates-lamps.json';
import type { Operand } from '../../../src/shared/composition/expression';
import type { ReactNode } from 'react';
import { duplicateNode, moveNodeBy, moveNodeTo, putControlsOnTop, takeOffOverlay } from '../../../src/workspace2/nodeActions';
import { addPage, duplicateSurface } from '../../../src/workspace2/navigation/edit';
import { deleteComponent, forkPlace, insertPlace, saveAsComponent, settleHeld, unlinkPlace } from '../../../src/workspace2/linked';
import { edit as editCanvas, initialEditState } from '../../../src/workspace2/canvas/edit';
import { lower } from '../../../src/shared/composition/graph';
import { moveToSlot } from '../../../src/workspace2/dnd/moves';
import { endOf } from '../../../src/workspace2/add/insert';
import { convertTiles } from '../../../src/workspace2/repeats/convertTiles';
import type { CompositionNode } from '../../../src/shared/composition/schema';

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
  draft.set(rebuildField(draft.get(), slot, operandSlot({ type: 'choose', cases: reverse ? cases.reverse() : cases, otherwise: text('Otherwise') }, valueAt(draft.get(), slot))));
}
function valid(document: CompositionDocument) {
  compileCompositionDocument(document);
  expect(resolveLogicUseBindings(document).bindings).toHaveLength(document.logicUseBindings?.length ?? 0);
  for (const entry of document.componentLibrary ?? []) for (const binding of entry.bindings ?? []) {
    const node = binding.nodeId ? bodyNodes(entry.node).find(node => node.id === binding.nodeId) : ownedSources(entry).find(source => source.id === binding.sourceId);
    expect(node, binding.field).toBeDefined();
    const param = entry.params!.find(param => param.name === binding.param)!;
    expect(readField(node, param.kind === 'value' ? fieldSteps(binding.field).slice(0, -1).join('/') : binding.field), binding.field).toBeDefined();
  }
}
function unchanged(document: CompositionDocument) {
  return {
    use: JSON.stringify(document.logicUseBindings!.find(binding => 'nodeId' in binding.use && binding.use.nodeId === 'tile-b')),
    otherUses: JSON.stringify(document.logicUseBindings!.filter(binding => binding.logicId === 'other-label')),
    fields: JSON.stringify(document.componentLibrary?.flatMap(entry => (entry.bindings ?? []).filter(binding => !binding.field.startsWith('props/subtitle')).map(binding => [entry.id, binding]))),
  };
}
function history(draft: Draft, before: CompositionDocument, sameBindings = true) {
  const after = draft.get();
  expect(after).not.toEqual(before);
  valid(after);
  const stable = (document: CompositionDocument) => {
    const { use, ...others } = unchanged(document);
    return sameBindings ? { use, ...others } : others;
  };
  expect(stable(after)).toEqual(stable(before));
  act(() => draft.undo());
  expect(draft.get()).toEqual(before);
  valid(draft.get());
  act(() => draft.redo());
  expect(draft.get()).toEqual(after);
  valid(draft.get());
  expect(stable(draft.get())).toEqual(stable(before));
}
function meaningFixture(kind: string, policy: 'fallback' | 'keep' = 'fallback') {
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
    draft.set(moveCompositionNode(document, 'place-1', { kind: 'surface', id: 'other-page' }));
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
function withMeaningCanvas(document: CompositionDocument, slot: EditorPath) {
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
function layoutMeaning(document: CompositionDocument) {
  const layout = readStudioCanvas(document);
  expect(layout.warnings).toEqual([]);
  return (layout.present ? studioCanvasMetadataSchema.parse(layout.raw).canvases : []).map(canvas => ({
    id: canvas.id,
    roots: canvas.roots.map(root => {
      const target = resolveLogicAnchor(document, root.anchor)!;
      const graph = liftField(document, pointerPath(target.pointer), 'slot').graph;
      const nodes = canvas.nodes.filter(node => node.rootId === root.id);
      for (const node of nodes) expect(graph.nodes.some(fresh => fresh.id === node.nodeId && JSON.stringify(fresh.origins) === JSON.stringify(node.origins)), node.id).toBe(true);
      return { key: `${'nodeId' in root.anchor ? root.anchor.nodeId : root.anchor.id}:${root.anchor.field}`,
        nodes: nodes.map(node => ({ id: node.nodeId, origins: node.origins, x: node.x, y: node.y,
          groups: (canvas.groups ?? []).filter(group => group.nodeIds.includes(node.id)).map(group => group.id).sort() })),
      };
    }),
    groups: canvas.groups?.map(group => ({ id: group.id, label: group.label })),
  }));
}
function meaning(document: CompositionDocument) {
  const resolution = resolveLogicUseBindings(document);
  for (const binding of resolution.bindings) expect(valueAt(resolution.document, [...pointerPath(binding.usePointer), 'args', binding.argument])).toBe(binding.sourceId);
  const compiled = compileCompositionDocument(document).expanded as CompositionDocument;
  const expanded = expandDocument(compiled);
  const sources = Object.fromEntries(expanded.dataSources.map(source => [source.id, source]));
  const nodes: Record<string, { fixed: unknown; values: unknown[]; unavailable: unknown[]; reads: unknown[]; thens: unknown[] }> = {};
  const add = (node: CompositionDocument['pages'][number]['components'][number], key: string, local = sources) => {
    const env = (isAdmin: boolean): Environment => ({ viewer: { isAdmin }, read: id => {
      const value = readField(local[id], 'entityId/value');
      expect(typeof value, id).toBe('string');
      return { status: 'value', value: value as string };
    } });
    const props = 'props' in node ? node.props as unknown as Record<string, unknown> : {};
    const { subtitle, ...rest } = props;
    const operand = subtitle ? slotOperand(subtitle as { type: string }) : undefined;
    const reads: unknown[] = [], thens: unknown[] = [];
    const walk = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const parsed = operandBase.safeParse(value);
      if (parsed.success && parsed.data.type === 'read') reads.push(evaluateOperand(parsed.data, env(true)));
      if (parsed.success && parsed.data.type === 'choose') for (const item of parsed.data.cases) thens.push(evaluateOperand(item.then, env(true)));
      for (const child of Object.values(value)) walk(child);
    };
    walk(subtitle);
    const { children: _children, ...fixed } = node as typeof node & { children?: unknown };
    const unavailable = operand ? [true, false].flatMap(admin => (['unavailable', 'loading'] as const).flatMap(status =>
      [undefined, 'Last answered value'].map(previous => resolveText(subtitle as TextSlot, { ...env(admin), read: () => ({ status }) }, previous)))) : [];
    const settings = record(subtitle) ? { fallback: subtitle.fallback, whenUnavailable: subtitle.whenUnavailable } : undefined;
    nodes[key] = { fixed: { ...fixed, props: rest, settings }, values: operand ? [true, false].map(admin => evaluateOperand(operand, env(admin))) : [], unavailable, reads, thens };
  };
  for (const surface of [...expanded.pages, ...expanded.modals]) for (const root of surface.components) for (const node of bodyNodes(root)) add(node, node.id);
  for (const entry of compiled.componentLibrary ?? []) for (const node of bodyNodes(entry.node)) add(node, `component:${entry.id}:${node.id}`,
    { ...sources, ...Object.fromEntries(ownedSources(entry).map(source => [source.id, source])) });
  return { nodes, sources, layout: layoutMeaning(document) };
}
const operations = ['insert text before token', 'remove token', 'remove use', 'remove value', 'replace operand', 'move rule up', 'move rule down', 'remove rule', 'add rule', 'replace rebuilt canvas subtree',
  'cross-page Move To', 'unlink component use', 'save as Logic Template', 'delete template', 'duplicate rule', 'remove optional default', 'rename document'] as const;
function preservesMeaning(before: CompositionDocument, after: CompositionDocument, operation: typeof operations[number]) {
  const left = meaning(before), right = meaning(after);
  expect(right.sources).toEqual(left.sources);
  const binding = before.logicUseBindings![0], nodeId = 'nodeId' in binding.use ? binding.use.nodeId! : '';
  const targetIds = binding.use.kind === 'component'
    ? [`component:${binding.use.id}:${nodeId}`, ...before.pages.flatMap(page => page.components).flatMap(node => node.type === 'component-ref' && node.componentId === binding.use.id
      ? [before.componentLibrary!.find(entry => entry.id === binding.use.id)!.node.id === nodeId ? node.id : derivedId(node.id, nodeId)] : [])]
    : [nodeId];
  expect(right.layout.map(canvas => canvas.id)).toEqual(left.layout.map(canvas => canvas.id));
  for (const [index, previous] of left.layout.entries()) {
    const current = right.layout[index];
    expect(current.roots.map(root => root.key)).toEqual(previous.roots.map(root => root.key));
    expect(current.groups?.map(group => group.label)).toEqual(previous.groups?.map(group => group.label));
    const raw = studioCanvasMetadataSchema.parse(before.studioCanvas).canvases[index];
    const usePointer = resolveLogicUseBindings(before).bindings[0].usePointer;
    const removed = operation === 'remove rule' ? usePointer.slice(0, usePointer.lastIndexOf('/then')) : usePointer;
    const retired = new Set(index === 0 && ['remove token', 'remove use', 'remove value', 'replace operand', 'remove rule'].includes(operation)
      ? raw.nodes.filter(node => {
        const base = resolveLogicAnchor(before, raw.roots.find(root => root.id === node.rootId)!.anchor)!.pointer;
        return node.origins.every(origin => `${base}${origin}` === removed || `${base}${origin}`.startsWith(`${removed}/`));
      }).map(node => node.nodeId) : []);
    for (const [rootIndex, root] of previous.roots.entries()) {
      const following = current.roots[rootIndex];
      const base = resolveLogicAnchor(before, raw.roots[rootIndex].anchor)!.pointer;
      const oldUse = usePointer.slice(base.length);
      const newUse = resolveLogicUseBindings(after).bindings.find((_, at) => {
        const binding = after.logicUseBindings![at];
        return binding.logicId === before.logicUseBindings![0].logicId && 'nodeId' in binding.use && binding.use.nodeId === nodeId;
      })?.usePointer;
      const movedUse = newUse?.slice(resolveLogicAnchor(after, studioCanvasMetadataSchema.parse(after.studioCanvas).canvases[index].roots[rootIndex].anchor)!.pointer.length);
      const originAfter = (origin: string) => {
        if (index !== 0) return origin;
        if (['move rule up', 'move rule down'].includes(operation)) return origin.replace(/\/cases\/([01])(?=\/|$)/, (_, at) => `/cases/${1 - Number(at)}`);
        if (operation === 'remove rule') return origin.replace(/\/cases\/(\d+)(?=\/|$)/, (_, at) => `/cases/${Number(at) - 1}`);
        if (operation === 'duplicate rule') return origin.replace(/\/cases\/(\d+)(?=\/|$)/, (_, at) => `/cases/${Number(at) > 0 ? Number(at) + 1 : 0}`);
        if (['insert text before token', 'replace rebuilt canvas subtree'].includes(operation) && movedUse !== undefined && (origin === oldUse || origin.startsWith(`${oldUse}/`))) return `${movedUse}${origin.slice(oldUse.length)}`;
        return origin;
      };
      for (const node of root.nodes) {
        if (retired.has(node.id)) continue;
        const origins = node.origins.map(originAfter);
        const candidates = following.nodes.filter(candidate => JSON.stringify(candidate.origins) === JSON.stringify(origins));
        expect(candidates, `${root.key}:${node.id}`).toHaveLength(1);
        expect({ x: candidates[0].x, y: candidates[0].y, groups: candidates[0].groups }, `${root.key}:${node.id}`)
          .toEqual({ x: node.x, y: node.y, groups: node.groups });
        const stable = following.nodes.find(candidate => candidate.id === node.id);
        if (stable) expect(stable).toEqual(candidates[0]);
      }
    }
    expect(current.groups).toEqual(previous.groups);
  }
  expect(Object.keys(right.nodes).sort()).toEqual(Object.keys(left.nodes).sort());
  for (const [id, previous] of Object.entries(left.nodes)) {
    const current = right.nodes[id];
    if (operation === 'remove optional default' && id === 'component:demo-lamp-pair:demo-lamp') {
      const old = structuredClone(previous), next = structuredClone(current);
      Reflect.deleteProperty(old.fixed as object, 'glyphTint'); Reflect.deleteProperty(next.fixed as object, 'glyphTint');
      expect(next).toEqual(old);
      continue;
    }
    expect(current.fixed, id).toEqual(previous.fixed);
    if (!targetIds.includes(id)) { expect(current, id).toEqual(previous); continue; }
    const removed = ['remove token', 'remove use', 'remove value', 'replace operand', 'remove rule'].includes(operation);
    if (removed) {
      expect(current.reads, id).toEqual([]);
      expect(current.values.length, id).toBe(previous.values.length);
      const replacement = operation === 'remove rule' ? 'Otherwise' : operation === 'remove use' || operation === 'replace operand' ? operation : '';
      expect(current.values, id).toEqual(previous.values.map(value => record(value) && value.status === 'value' && value.value === 'Other' ? value : { status: 'value', value: replacement }));
    } else if (operation === 'insert text before token' || operation === 'replace rebuilt canvas subtree') {
      expect(current.unavailable, id).toEqual(previous.unavailable);
      expect(current.reads, id).toEqual(previous.reads);
      expect(current.values, id).toEqual(previous.values.map(value => record(value) && value.status === 'value' && value.value !== 'Other' ? { ...value, value: `Before ${value.value}` } : value));
    } else {
      expect(current.unavailable, id).toEqual(previous.unavailable);
      expect(current.values, id).toEqual(previous.values);
      const sorted = (values: unknown[]) => values.map(value => JSON.stringify(value)).sort();
      const extra = operation === 'add rule' ? [{ status: 'value', value: 'Added' }] : operation === 'duplicate rule' ? previous.thens.filter(value => record(value) && value.value !== 'Other').slice(0, 1) : [];
      expect(sorted(current.thens), id).toEqual(sorted([...previous.thens, ...extra]));
      expect(sorted([...new Set(current.reads.map(value => JSON.stringify(value)))]), id).toEqual(sorted([...new Set(previous.reads.map(value => JSON.stringify(value)))]));
    }
  }
}
describe('binding meaning invariant: every structural edit and undo/redo preserves effective values on every page and placement', () => {
  for (const policy of ['fallback', 'keep'] as const) for (const kind of ['page tile', 'component anchor', 'component parameters', 'nested operand', 'rule cases', 'private sources', 'id and type arguments']) {
    it.each(operations)(`${kind}, ${policy}: %s preserves effective sources, arguments, tints and Then values`, operation => {
      const { document, slot, optionalIndex } = meaningFixture(kind, policy), draft = createDraft(document);
      if (operation.includes('rule')) {
        const path = pointerPath(resolveLogicUseBindings(draft.get()).bindings[0].usePointer);
        draft.set(rebuildField(draft.get(), slot, operandSlot(valueAt(draft.get(), path) as Operand, valueAt(draft.get(), slot))));
        rules(draft, slot, operation === 'move rule up');
      }
      draft.set(withMeaningCanvas(draft.get(), slot));
      const before = draft.get();
      valid(before);
      const path = pointerPath(resolveLogicUseBindings(before).bindings[0].usePointer);
      const use = valueAt(before, path) as Operand;
      const changes = vi.fn(() => valid(draft.get()));
      draft.subscribe(changes);
      if (operation === 'insert text before token') writeParts(draft, { path, wrap: 'operand' }, [{ text: 'Before ' }, { token: newToken(use) }], false);
      else if (operation === 'replace rebuilt canvas subtree') draft.set(rebuildField(before, path, copySubtree({ type: 'format', pattern: 'Before {a}', args: { a: use } })));
      else if (operation === 'remove token' || operation === 'remove value') writeParts(draft, { path, wrap: 'operand' }, [], false);
      else if (operation === 'remove use' || operation === 'replace operand') draft.set(replaceAt(before, path, text(operation)));
      else if (operation === 'cross-page Move To') draft.set(moveCompositionNode(before, before.pages[0].components[0].id, { kind: 'surface', id: 'other-page' }));
      else if (operation === 'unlink component use') draft.set(unlinkTemplate(before, path));
      else if (operation === 'save as Logic Template') draft.set(saveLogicTemplate(before, path, 'operand', 'Saved meaning', []));
      else if (operation === 'delete template') draft.set(deleteEntry(before, 'tile-label'));
      else if (operation === 'duplicate rule') draft.set(duplicateRule(before, slot, 'text', 0));
      else if (operation === 'remove optional default') {
        const nodePath = ['componentLibrary', optionalIndex, 'node', 'children', 0];
        const { glyphTint: _default, ...node } = valueAt(before, nodePath) as { glyphTint: unknown };
        draft.set(replaceAt(before, nodePath, node));
      } else if (operation === 'rename document') draft.set({ ...before, name: 'Renamed' });
      else {
        const base = [...slot, 'value', 'cases'], cases = valueAt(before, base) as { when: typeof check; then: Operand }[];
        const next = operation === 'add rule' ? [...cases, { when: check, then: text('Added') }]
          : operation === 'remove rule' ? cases.slice(1) : [...cases].reverse();
        draft.set(replaceAt(before, base, next));
      }
      expect(changes).toHaveBeenCalledTimes(1);
      if (['remove token', 'remove use', 'remove value', 'replace operand', 'remove rule'].includes(operation)) {
        expect(draft.get().logicUseBindings).toHaveLength(before.logicUseBindings!.length - 1);
      } else if (operation === 'unlink component use') {
        expect(draft.get().logicUseBindings).toHaveLength(before.logicUseBindings!.length - 1);
      } else if (operation === 'delete template') {
        expect(draft.get().logicUseBindings).toEqual(before.logicUseBindings!.filter(binding => binding.logicId !== 'tile-label'));
      } else {
        expect(draft.get().logicUseBindings).toHaveLength(before.logicUseBindings!.length + (operation === 'duplicate rule' ? 1 : 0));
      }
      preservesMeaning(before, draft.get(), operation);
      const after = meaning(draft.get());
      history(draft, before, operation !== 'delete template');
      expect(meaning(draft.get())).toEqual(after);
      draft.undo(); expect(meaning(draft.get())).toEqual(meaning(before));
      draft.redo(); expect(meaning(draft.get())).toEqual(after);
      expect(changes).toHaveBeenCalledTimes(5);
    });
  }
});

it.each(['tile', 'page'] as const)('round 4 regression: Duplicate %s copies effective B bindings and redo restores the correct copy', kind => {
  const { document, slot } = meaningFixture('page tile'), before = withMeaningCanvas(document, slot), draft = createDraft(before);
  const result = kind === 'tile' ? duplicateNode(before, ['pages', 0, 'components', 0]) : duplicateSurface(before, { kind: 'page', id: before.pages[0].id });
  draft.set(result.document);
  const copy = kind === 'tile' ? draft.get().pages[0].components[1] : draft.get().pages[1].components[0];
  const expected = meaning(before).nodes['tile-a'];
  const assertCopy = () => {
    valid(draft.get());
    const actual = meaning(draft.get()).nodes[copy.id];
    expect(actual.values).toEqual(expected.values);
    expect(actual.unavailable).toEqual(expected.unavailable);
    expect(draft.get().logicUseBindings!.some(binding => 'nodeId' in binding.use && binding.use.nodeId === copy.id)).toBe(true);
    for (const binding of before.logicUseBindings!) expect(draft.get().logicUseBindings!.map(item => JSON.stringify(item))).toContain(JSON.stringify(binding));
  };
  assertCopy();
  draft.undo(); expect(draft.get()).toEqual(before); valid(draft.get());
  draft.redo(); assertCopy();
});

it.each(['component anchor', 'component parameters', 'private sources'])('round 4 regression: detaching a placement materializes resolved values, not caches (%s)', kind => {
  const { document } = meaningFixture(kind), draft = createDraft(document);
  const before = meaning(document).nodes['place-0'];
  draft.set(unlinkPlace(document, ['pages', 0, 'components', 0]));
  const assertDetached = () => {
    valid(draft.get());
    expect(draft.get().pages[0].components[0].type).not.toBe('component-ref');
    expect(meaning(draft.get()).nodes['place-0'].values).toEqual(before.values);
    expect(meaning(draft.get()).nodes['place-0'].unavailable).toEqual(before.unavailable);
    expect(JSON.stringify(draft.get().logicUseBindings)).toBe(JSON.stringify(document.logicUseBindings));
    expect(JSON.stringify(draft.get().componentLibrary)).toBe(JSON.stringify(document.componentLibrary));
  };
  assertDetached(); draft.undo(); expect(draft.get()).toEqual(document); draft.redo(); assertDetached();
});

it('round 4 regression: Canvas Apply distinguishes two identical bound uses through repeated pattern edits', () => {
  const fixture = meaningFixture('page tile'), setup = createDraft(fixture.document), path = [...fixture.slot, 'value'];
  const use = valueAt(setup.get(), path) as Operand;
  setup.set(rebuildField(setup.get(), path, { type: 'format', pattern: '{left}/{right}', args: { left: use, right: copySubtree(use) } }));
  const before = withMeaningCanvas(setup.get(), fixture.slot), draft = createDraft(before);
  expect(valueAt(before, [...path, 'args', 'left'])).toEqual(valueAt(before, [...path, 'args', 'right']));
  let lifted = liftField(before, path, 'operand'), baseline = { graph: lifted.graph, sourceMap: lifted.sourceMap };
  let state = initialEditState(lifted.graph);
  for (const pattern of ['({left}/{right})', '[{left}/{right}]']) {
    const root = state.graph.nodes.find(node => node.id === state.graph.roots[0].nodeId)!;
    state = editCanvas(state, { type: 'update', nodeId: root.id, value: { ...root.payload.value as object, pattern } });
    const lowered = lower(state.graph);
    if (!lowered.ok) throw new Error(JSON.stringify(lowered.errors));
    const next = documentEdit(draft.get(), replaceAt(draft.get(), path, lowered.ast), canvasReferences([path], baseline, { graph: state.graph, sourceMap: lowered.sourceMap }));
    draft.set(next); valid(draft.get());
    expect(draft.get().logicUseBindings!.filter(binding => 'nodeId' in binding.use && binding.use.nodeId === 'tile-a')).toHaveLength(2);
    expect(meaning(draft.get()).nodes['tile-a'].values).toEqual([true, false].map(() => ({ status: 'value', value: pattern.replace('{left}', 'sensor.demo_1').replace('{right}', 'sensor.demo_1') })));
    baseline = { graph: state.graph, sourceMap: lowered.sourceMap };
  }
  const after = draft.get();
  draft.undo(); valid(draft.get()); draft.redo(); expect(draft.get()).toEqual(after); valid(draft.get());
});

it.each(['fallback', 'keep'] as const)('the meaning comparator detects fallback and unavailable-policy changes during an unrelated rename (%s)', policy => {
  const { document, slot } = meaningFixture('page tile', policy);
  for (const [field, value] of [['fallback', 'Wrong fallback'], ['whenUnavailable', policy === 'keep' ? 'fallback' : 'keep']]) {
    const changed = replaceAt({ ...document, name: 'Renamed' }, [...slot, field], value);
    valid(changed);
    expect(() => preservesMeaning(document, changed, 'rename document')).toThrow();
  }
});

it.each(['positions', 'memberships'])('the meaning comparator detects swapped node %s during an unrelated rename', mutation => {
  const { document, slot } = meaningFixture('page tile'), before = withMeaningCanvas(document, slot);
  const changed = structuredClone(before);
  changed.name = 'Renamed';
  const layout = studioCanvasMetadataSchema.parse(changed.studioCanvas), canvas = layout.canvases[0];
  const [first, second] = canvas.nodes;
  if (mutation === 'positions') {
    [first.x, second.x] = [second.x, first.x]; [first.y, second.y] = [second.y, first.y];
  } else canvas.groups![1].nodeIds = [second.id];
  changed.studioCanvas = layout;
  valid(changed);
  expect(() => preservesMeaning(before, changed, 'rename document')).toThrow();
});

const auditedOperations = [
  'duplicate tile', 'duplicate section', 'duplicate page', 'duplicate sheet', 'duplicate placement',
  'detach placement', 'delete component', 'fork placement', 'save held change as new component',
  'paste text', 'cut text', 'drag between sections', 'drag between pages', 'move sibling', 'Move To',
  'Save as Component', 'place component', 'save repeated pieces', 'wrap overlay', 'unwrap overlay',
  'Unlink template', 'Save as Logic Template', 'Delete Template', 'Duplicate Rule',
  'canvas Apply pattern', 'canvas Apply re-parent', 'add page',
] as const;

function placementValues(document: CompositionDocument) {
  const expanded = expandDocument(compileCompositionDocument(document).expanded);
  const names = new Map(expanded.dataSources.map(({ id, ...source }) => [id, JSON.stringify(source)]));
  const snapshot = meaning(document).nodes;
  return Object.fromEntries([...expanded.pages, ...expanded.modals].flatMap(page => page.components.flatMap(root => bodyNodes(root).flatMap(node => {
    if (!('props' in node && 'subtitle' in node.props) && !('glyphTint' in node)) return [];
    const { id: _id, title: _title, layout: _layout, ...fixed } = snapshot[node.id].fixed as Record<string, unknown>;
    return [[node.id, { ...snapshot[node.id], fixed: renameSources(fixed, names) }]];
  }))));
}

function pairs(before: CompositionDocument, oldPath: EditorPath, after: CompositionDocument, newPath: EditorPath) {
  const previous = valueAt(expandDocument(compileCompositionDocument(before).expanded), oldPath) as CompositionNode;
  const next = valueAt(expandDocument(compileCompositionDocument(after).expanded), newPath) as CompositionNode;
  const old = bodyNodes(previous), added = bodyNodes(next);
  expect(added).toHaveLength(old.length);
  return added.map((node, at) => [node.id, old[at].id] as const);
}

function section(id: string, children: CompositionNode[]): CompositionNode {
  return { id, title: 'Section', type: 'section', layout: { span: 1 }, children,
    props: { header: 'Section', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } } };
}

describe('exhaustive subtree-operation meaning matrix: stale A / resolved B, fallback states, provenance and symmetric history', () => {
  for (const policy of ['fallback', 'keep'] as const) it.each(auditedOperations)(`${policy}: %s`, operation => {
    const component = ['duplicate placement', 'detach placement', 'delete component', 'fork placement', 'save held change as new component', 'place component'].includes(operation);
    const fixture = meaningFixture(component ? 'private sources' : 'page tile', policy);
    let document = fixture.document, slot = fixture.slot;
    const root: EditorPath = ['pages', 0, 'components', 0];
    if (['duplicate section', 'drag between sections'].includes(operation)) {
      document = editSubtrees(document, replaceAt(document, ['pages', 0, 'components'],
        [section('bound-section', [document.pages[0].components[0]]), section('empty-section', []), ...document.pages[0].components.slice(1)]));
      slot = [...root, 'children', 0, 'props', 'subtitle'];
    }
    if (operation === 'duplicate sheet') {
      const made = copySubtree(document.pages[0]);
      const { navigation: _navigation, ...surface } = made;
      document = { ...document, modals: [{ ...document.modals[0], ...surface, id: 'bound-sheet', components: [] }] };
      document = moveNodeTo(document, 'tile-a', { kind: 'surface', id: 'bound-sheet' });
      slot = ['modals', 0, 'components', 0, 'props', 'subtitle'];
    }
    if (operation === 'cut text') document = rebuildField(document, [...slot, 'value'],
      { type: 'format', pattern: 'Cut {a}', args: { a: valueAt(document, [...slot, 'value']) } });
    if (operation === 'unwrap overlay') {
      document = putControlsOnTop(document, root); slot = [...root, 'children', 0, 'props', 'subtitle'];
    }
    if (operation === 'Duplicate Rule') {
      const draft = createDraft(document); rules(draft, slot); document = draft.get();
    }
    if (operation === 'save repeated pieces') {
      for (const at of [0, 1]) {
        document = replaceAt(document, ['pages', 0, 'components', at, 'title'], 'Repeated tile');
        document = replaceAt(document, ['pages', 0, 'components', at, 'props', 'titleProviderId'], 'source-b');
        document = replaceAt(document, ['pages', 0, 'components', at, 'props', 'subtitle', 'fallback'], 'Repeated fallback');
      }
    }
    if (operation.startsWith('canvas Apply')) {
      const value = valueAt(document, [...slot, 'value']) as Operand;
      document = rebuildField(document, [...slot, 'value'], { type: 'format', pattern: '{left}/{right}', args: { left: value, right: copySubtree(value) } });
    }
    document = withMeaningCanvas(document, slot);
    const before = document, draft = createDraft(before), aliases = new Map<string, string>();
    const resolved = resolveLogicUseBindings(before);
    expect(resolved.bindings.some(binding => valueAt(before, [...pointerPath(binding.usePointer), 'args', binding.argument]) !== binding.sourceId)).toBe(true);
    const old = placementValues(before);
    const copyPairs = (oldPath: EditorPath, newPath: EditorPath) => { for (const [to, from] of pairs(before, oldPath, document, newPath)) aliases.set(to, from); };
    if (operation === 'duplicate tile' || operation === 'duplicate section' || operation === 'duplicate placement') {
      const duplicated = duplicateNode(before, root); document = duplicated.document; copyPairs(root, duplicated.path);
    } else if (operation === 'duplicate page' || operation === 'duplicate sheet') {
      const key = operation === 'duplicate page' ? 'pages' : 'modals';
      document = duplicateSurface(before, { kind: key === 'pages' ? 'page' : 'modal', id: before[key][0].id }).document;
      before[key][0].components.forEach((_, at) => copyPairs([key, 0, 'components', at], [key, 1, 'components', at]));
    } else if (operation === 'detach placement' || operation === 'delete component') {
      document = operation === 'detach placement' ? unlinkPlace(before, root) : deleteComponent(before, 'saved-tile');
      for (const [pageIndex, page] of before.pages.entries()) page.components.forEach((node, index) => {
        if (node.type === 'component-ref' && node.componentId === 'saved-tile') copyPairs(['pages', pageIndex, 'components', index], ['pages', pageIndex, 'components', index]);
      });
    } else if (operation === 'fork placement') {
      document = forkPlace(before, 'place-0', 'Forked component').document; copyPairs(root, root);
    } else if (operation === 'save held change as new component') {
      const changed = replaceAt(before, ['componentLibrary', 0, 'name'], 'Edited component');
      document = settleHeld(before, changed, 'place-0', { kind: 'new', name: 'Saved component' }).at(-1)!; copyPairs(root, root);
    } else if (operation === 'Save as Component') {
      document = saveAsComponent(before, root, 'Captured bound tile').document; copyPairs(root, root);
    } else if (operation === 'place component') {
      const destination = endOf(before, `page:${before.pages[0].id}`)!;
      document = insertPlace(before, 'saved-tile', destination).document;
      // The unoverridden placement on the other page supplies the resolved component defaults.
      copyPairs(['pages', 1, 'components', 1], [...destination.list, destination.index]);
    } else if (operation === 'save repeated pieces') document = convertTiles(before, { name: 'Repeated bound tiles', nodeIds: ['tile-a', 'tile-b'], labels: {} }).document;
    else if (operation === 'wrap overlay') document = putControlsOnTop(before, root);
    else if (operation === 'unwrap overlay') document = takeOffOverlay(before, root);
    else if (operation === 'move sibling') document = moveNodeBy(before, root, 1);
    else if (operation === 'Move To') document = moveNodeTo(before, before.pages[0].components[0].id, { kind: 'surface', id: 'other-page' });
    else if (operation === 'drag between pages' || operation === 'drag between sections') {
      const owner = operation === 'drag between pages' ? 'page:other-page' : 'node:empty-section';
      document = moveToSlot(before, 'node:tile-a', endOf(before, owner)!).document;
    } else if (operation === 'Unlink template') document = unlinkTemplate(before, pointerPath(resolved.bindings[0].usePointer));
    else if (operation === 'Save as Logic Template') document = saveLogicTemplate(before, slot, 'value', 'Captured bound logic', []);
    else if (operation === 'Delete Template') document = deleteEntry(before, 'tile-label');
    else if (operation === 'Duplicate Rule') document = duplicateRule(before, slot, 'text', 0);
    else if (operation === 'paste text' || operation === 'cut text') {
      const operand = valueAt(before, [...slot, 'value']) as Operand;
      const use = operation === 'cut text' && operand.type === 'format' ? operand.args.a : operand;
      writeParts(draft, { path: slot, wrap: 'slot' }, [...operation === 'paste text' ? [{ text: 'Pasted ' }] : [], { token: newToken(use) }], false);
      document = draft.get();
    } else if (operation.startsWith('canvas Apply')) {
      const lifted = liftField(before, slot, 'slot');
      let state = initialEditState(lifted.graph);
      const format = state.graph.nodes.find(node => {
        const parsed = operandBase.safeParse(node.payload.value);
        return parsed.success && parsed.data.type === 'format';
      })!;
      if (operation === 'canvas Apply pattern') state = editCanvas(state, { type: 'update', nodeId: format.id, value: { ...format.payload.value as object, pattern: '{right}/{left}' } });
      else {
        const [left, right] = state.graph.edges.filter(edge => edge.to.nodeId === format.id);
        state = editCanvas(state, { type: 'connect', from: left.from, to: right.to, replace: true });
        state = editCanvas(state, { type: 'connect', from: right.from, to: left.to, replace: true });
      }
      const projected = projectGraph(state.graph);
      document = documentEdit(before, replaceAt(before, slot, projected.ast), canvasReferences([slot], lifted, { graph: state.graph, sourceMap: projected.sourceMap }));
      document = saveCanvasLayout(document, [{ anchor: lifted.graph.roots[0].anchor, ast: projected.ast }],
        { graph: state.graph, sourceMap: projected.sourceMap, positions: Object.fromEntries(state.graph.nodes.map((node, index) => [node.id, { x: 120 + index * 100, y: 240 }])) },
        { document: before, paths: [slot] });
    } else if (operation === 'add page') document = addPage(before, 'Added page').document;
    else throw new Error(`Missing audited operation: ${operation}`);
    if (document !== draft.get()) draft.set(document);
    const assertMeaning = () => {
      valid(draft.get());
      const current = placementValues(draft.get());
      for (const [id, expected] of Object.entries(old)) {
        const actualId = [...aliases].find(([to, from]) => from === id && !Object.hasOwn(old, to))?.[0];
        const actual = current[id] ?? (actualId ? current[actualId] : undefined);
        if (operation === 'paste text' && id === 'tile-a' || operation === 'cut text' && id === 'tile-a') {
          expect(actual!.unavailable).toEqual(expected.unavailable);
          expect(actual!.values).toEqual(expected.values.map(value => record(value) && value.status === 'value'
            ? { ...value, value: operation === 'paste text' ? `Pasted ${value.value}` : String(value.value).replace(/^Cut /, '') } : value));
        } else if (operation === 'Duplicate Rule' && id === 'tile-a') {
          expect(actual!.values).toEqual(expected.values); expect(actual!.unavailable).toEqual(expected.unavailable);
          expect(actual!.thens).toEqual([expected.thens[0], ...expected.thens]);
        } else expect(actual, id).toEqual(expected);
      }
      for (const [id, from] of aliases) expect(current[id], `${operation}: ${id}`).toEqual(old[from]);
      for (const binding of before.logicUseBindings!.filter(binding => 'nodeId' in binding.use && binding.use.nodeId === 'unrelated-bound')) {
        expect(draft.get().logicUseBindings!.map(item => JSON.stringify(item))).toContain(JSON.stringify(binding));
      }
      const layout = readStudioCanvas(draft.get()); expect(layout.warnings).toEqual([]);
      if (operation.startsWith('canvas Apply')) {
        const saved = studioCanvasMetadataSchema.parse(layout.raw).canvases;
        const original = studioCanvasMetadataSchema.parse(before.studioCanvas).canvases;
        expect(saved[0].groups?.map(group => [group.id, group.nodeIds.length])).toEqual(original[0].groups?.map(group => [group.id, group.nodeIds.length]));
        expect(saved[1]).toEqual(original[1]);
      }
    };
    assertMeaning(); const after = draft.get();
    draft.undo(); expect(draft.get()).toEqual(before); expect(placementValues(draft.get())).toEqual(old); valid(draft.get());
    draft.redo(); expect(draft.get()).toEqual(after); assertMeaning();
  });
});

it('round 3 regression: Move To another page keeps the rebound B source and canvas groups', () => {
  const { document, slot } = meaningFixture('page tile'), before = withMeaningCanvas(document, slot), draft = createDraft(before);
  expect(valueAt(before, [...slot, 'value', 'args', 'source'])).toBe('source-a');
  expect(meaning(before).nodes['tile-a'].values).toEqual([{ status: 'value', value: 'sensor.demo_1' }, { status: 'value', value: 'sensor.demo_1' }]);
  draft.set(moveCompositionNode(before, 'tile-a', { kind: 'surface', id: 'other-page' }));
  expect(draft.get().logicUseBindings![0].use).toMatchObject({ kind: 'page', id: 'other-page', nodeId: 'tile-a' });
  preservesMeaning(before, draft.get(), 'cross-page Move To');
  history(draft, before);
});
it('round 3 regression: component Unlink fans one per-place argument into every output on two pages', () => {
  const { document, slot } = meaningFixture('component parameters');
  const read = document.logicLibrary![0].body;
  const before = withMeaningCanvas(replaceAt(document, ['logicLibrary', 0, 'body'], {
    type: 'format', pattern: '{first}/{second}', args: { first: read, second: structuredClone(read) },
  }), slot), draft = createDraft(before);
  expect(meaning(before).nodes['place-0'].values[0]).toEqual({ status: 'value', value: 'sensor.demo_0/sensor.demo_0' });
  expect(meaning(before).nodes['place-1'].values[0]).toEqual({ status: 'value', value: 'sensor.demo_1/sensor.demo_1' });
  draft.set(unlinkTemplate(before, [...slot, 'value']));
  const fields = draft.get().componentLibrary![0].bindings!.filter(binding => binding.param === 'source').map(binding => binding.field);
  expect(fields).toEqual(expect.arrayContaining(['props/subtitle/value/args/first/from/sourceId', 'props/subtitle/value/args/second/from/sourceId']));
  preservesMeaning(before, draft.get(), 'unlink component use');
  valid(draft.get());
  history(draft, before);
  const next = createDraft(draft.get());
  next.set(replaceAt(next.get(), ['pages', 1, 'components', 1, 'args', 'source'], 'source-a'));
  expect(meaning(next.get()).nodes['place-1'].values[0]).toEqual({ status: 'value', value: 'sensor.demo_0/sensor.demo_0' });
});
it.each(['save as Logic Template', 'delete template'] as const)('round 3 regression: %s reads effective B, never the authored A cache', operation => {
  const { document, slot } = meaningFixture('page tile'), draft = createDraft(document);
  expect(valueAt(document, [...slot, 'value', 'args', 'source'])).toBe('source-a');
  draft.set(operation === 'save as Logic Template' ? saveLogicTemplate(document, slot, 'value', 'Saved value', []) : deleteEntry(document, 'tile-label'));
  expect(meaning(draft.get()).nodes).toEqual(meaning(document).nodes);
  valid(draft.get());
  history(draft, document, operation !== 'delete template');
  if (operation === 'save as Logic Template') {
    draft.set(replaceAt(draft.get(), ['pages', 0, 'components', 0, 'props', 'titleProviderId'], 'source-a'));
    expect(meaning(draft.get()).nodes['tile-a'].values[0]).toEqual({ status: 'value', value: 'sensor.demo_0' });
  }
});
it('round 3 regression: Duplicate Rule keeps both Then values bound to B and future source changes', () => {
  const { document, slot } = meaningFixture('page tile'), draft = createDraft(document);
  rules(draft, slot);
  const before = draft.get();
  draft.set(duplicateRule(before, slot, 'text', 0));
  expect(meaning(draft.get()).nodes['tile-a'].thens).toEqual([
    { status: 'value', value: 'sensor.demo_1' }, { status: 'value', value: 'sensor.demo_1' }, { status: 'value', value: 'Other' },
  ]);
  expect(draft.get().logicUseBindings!.filter(binding => 'nodeId' in binding.use && binding.use.nodeId === 'tile-a')).toHaveLength(2);
  history(draft, before);
  draft.set(replaceAt(draft.get(), ['pages', 0, 'components', 0, 'props', 'titleProviderId'], 'source-a'));
  expect(meaning(draft.get()).nodes['tile-a'].thens.slice(0, 2)).toEqual([
    { status: 'value', value: 'sensor.demo_0' }, { status: 'value', value: 'sensor.demo_0' },
  ]);
});
it('round 3 regression: removing the optional glyphTint default retains both placements custom tints', () => {
  const { document, optionalIndex } = meaningFixture('page tile'), draft = createDraft(document);
  const nodePath = ['componentLibrary', optionalIndex, 'node', 'children', 0];
  const { glyphTint: _default, ...node } = valueAt(document, nodePath) as { glyphTint: unknown };
  draft.set(replaceAt(document, nodePath, node));
  expect(JSON.stringify(draft.get().componentLibrary![optionalIndex].bindings)).toBe(JSON.stringify(document.componentLibrary![optionalIndex].bindings));
  for (const id of ['optional-0~demo-lamp', 'optional-1~demo-lamp']) expect(meaning(draft.get()).nodes[id]).toEqual(meaning(document).nodes[id]);
  history(draft, document);
});
it('round 3 regression: simultaneous id and type arguments are not composition-node ancestors', () => {
  const { document } = meaningFixture('id and type arguments'), draft = createDraft(document);
  draft.set({ ...document, name: 'Renamed without changing values' });
  expect(meaning(draft.get())).toEqual(meaning(document));
  expect(JSON.stringify(draft.get().logicUseBindings)).toBe(JSON.stringify(document.logicUseBindings));
  history(draft, document);
});
it('resolved binding authority is shared by inspector evaluation, sentences and extraction without rewriting authored caches', () => {
  const { document, slot } = meaningFixture('page tile');
  const raw = valueAt(document, [...slot, 'value']) as Operand;
  for (const [current, expected] of [[document, 'source-b'], [replaceAt(document, ['pages', 0, 'components', 0, 'props', 'titleProviderId'], 'source-a'), 'source-a']] as const) {
    const resolve = (value: unknown) => resolvedLogicValue(current, value);
    const env = registerFill({ read: id => ({ status: 'value', value: id }) }, { library: current.logicLibrary!, resolve });
    expect(editorValue(raw, env)).toEqual({ status: 'value', value: expected });
    expect(workedOut(current, raw)).toMatchObject({ type: 'read', from: { sourceId: expected } });
    expect(useSentence(raw as unknown as { logicId: string; args: Record<string, unknown> }, { library: current.logicLibrary!, resolve }, String, String)).toBe(`Tile label ${expected}`);
  }
  expect(valueAt(raw, ['args', 'source'])).toBe('source-a');
  const entry = document.logicLibrary![0];
  expect(bodyWithSamples(document, { ...entry, id: 'samples-only', params: [{ ...entry.params[0], sample: 'source-a' }] })).toMatchObject({ type: 'read', from: { sourceId: 'source-a' } });
});
it('extraction preserves source and text component parameters without inferring their kinds from argument names', () => {
  const { document, slot } = meaningFixture('component parameters');
  let before = replaceAt(document, ['logicLibrary', 0, 'params'], [...document.logicLibrary![0].params, { name: 'word', kind: 'text' }]);
  before = replaceAt(before, ['logicLibrary', 0, 'body'], { type: 'format', pattern: '{value} {word}', args: {
    value: document.logicLibrary![0].body, word: { type: 'literal', value: { type: 'hole', name: 'word' } },
  } });
  for (const binding of before.logicUseBindings!.filter(binding => binding.logicId === 'tile-label')) before = replaceAt(before, [...pointerPath(resolveLogicAnchor(before, binding.use)!.pointer), 'args', 'word'], 'Default');
  before = replaceAt(before, ['componentLibrary', 0, 'params'], [...before.componentLibrary![0].params!, { name: 'word', kind: 'text' }]);
  before = replaceAt(before, ['componentLibrary', 0, 'bindings'], [...before.componentLibrary![0].bindings!, { param: 'word', nodeId: 'inner-tile', field: 'props/subtitle/value/args/word' }]);
  before = replaceAt(before, ['pages', 0, 'components', 0, 'args', 'word'], 'First');
  before = replaceAt(before, ['pages', 1, 'components', 1, 'args', 'word'], 'Second');
  valid(before);
  const draft = createDraft(before);
  draft.set(saveLogicTemplate(before, slot, 'value', 'Per-place words', []));
  expect(meaning(draft.get()).nodes).toEqual(meaning(before).nodes);
  expect(meaning(draft.get()).nodes['place-0'].values[0]).toEqual({ status: 'value', value: 'sensor.demo_0 First' });
  expect(meaning(draft.get()).nodes['place-1'].values[0]).toEqual({ status: 'value', value: 'sensor.demo_1 Second' });
  history(draft, before);
});
it('whole-node canvas roots and group members keep their stable node anchor across a page move', () => {
  const { document } = meaningFixture('page tile'), nodePath = ['pages', 0, 'components', 0];
  const graph = liftField(document, nodePath, 'fragment').graph;
  const encoded = encodeStudioCanvas(document, [{ id: 'whole-node', roots: [{ anchor: graph.roots[0].anchor,
    nodes: graph.nodes.map((node, index) => ({ id: node.id, origins: node.origins, x: index * 80, y: 120 })) }] }]);
  const before = { ...document, studioCanvas: studioCanvasMetadataSchema.parse({ ...encoded, canvases: encoded.canvases.map(canvas => ({
    ...canvas, groups: [{ id: 'group', label: 'Whole tile', nodeIds: canvas.nodes.map(node => node.id) }],
  })) }) }, draft = createDraft(before);
  draft.set(moveCompositionNode(before, 'tile-a', { kind: 'surface', id: 'other-page' }));
  expect(readStudioCanvas(draft.get()).warnings).toEqual([]);
  const saved = studioCanvasMetadataSchema.parse(draft.get().studioCanvas).canvases[0];
  expect(saved.roots[0].anchor).toMatchObject({ kind: 'page', id: 'other-page', nodeId: 'tile-a', field: '' });
  expect(saved.nodes.map(node => [node.x, node.y])).toEqual(encoded.canvases[0].nodes.map(node => [node.x, node.y]));
  expect(saved.groups![0].nodeIds).toHaveLength(graph.nodes.length);
  history(draft, before);
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
it('reanchors moved canvas associations and preserves unrelated valid layout', () => {
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
  expect(readStudioCanvas(draft.get()).metadata!.canvases).toHaveLength(2);
  for (const canvas of readStudioCanvas(draft.get()).metadata!.canvases) {
    expect(canvas.nodes.length).toBeGreaterThan(0);
    for (const node of canvas.nodes) expect({ x: node.x, y: node.y }).toEqual({ x: 120, y: 240 });
  }
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
