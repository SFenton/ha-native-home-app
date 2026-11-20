/**
 * Randomized differential test: the dependency-scoped `documentEdit` against the whole-document reconciliation it
 * replaced (`./oracle`, a verbatim copy of 5b28fc4). Each seed picks a fixture and applies a multi-step sequence of
 * random edits, carrying accepted results forward so index reuse and carrying are exercised, and after every step both
 * implementations must agree on refusal and give the same JSON (including `studioCanvas`).
 *
 * Edits mix: sibling typing that rebuilds ancestors (declared through `fields` or not), placing an existing object at
 * extra places (also while rebuilding one of its original containers in the same edit), removing such aliases, undeclared clones, array reorder/insert/delete, moves and copies (declared through
 * `relocated`, `copied` and `deleted` or not), ID changes, `logicUseBindings` and component binding edits, canvas metadata
 * edits (with and without `layout`), `discardLayouts`, renames, reapplying an earlier revision, and resubmitting a
 * refused candidate after mutating it in place.
 *
 * Documented deviation: where a field has no unambiguous owner (duplicate IDs, or an owner too malformed to walk), the
 * oracle lets `fieldAnchor`'s raw error escape; the scoped implementation refuses (and keeps `before`) instead. That pair
 * counts as agreement. Any other error must be the same error from both.
 *
 * CI runs seeds 1-256 (14 steps each, a few seconds). Each bug class reviews 5 and 6 found is caught within that range
 * when its fix is reverted. For a longer local run: `EDIT_ORACLE_SEEDS=2000 npx vitest run <this file>` (optionally
 * `EDIT_ORACLE_FROM`, `EDIT_ORACLE_STEPS`; `EDIT_ORACLE_REPORT=1` prints every disagreeing seed instead of failing on the
 * first summary; `EDIT_ORACLE_DUMP=<dir>` writes each disagreeing step's documents there).
 */
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { replaceAt, valueAt, type EditorPath } from '../../../src/composition-editor';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { resolveLogicAnchor } from '../../../src/shared/composition/studio-logic/anchors';
import { encodeStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema, type StoredStudioCanvasMetadata } from '../../../src/shared/composition/studio-logic/schemas';
import type { CompositionDocument } from '../../../src/shared/composition/schema';
import { documentEdit, type EditReferences } from '../../../src/workspace2/editors/documentEdit';
import { fieldPointer, liftField, pointerPath } from '../../../src/workspace2/logic-fields/registry';
import { toastManager } from '../../../src/workspace2/toasts';
import { sameJson } from '../../../src/sameJson';
import { componentDocument, draftDocument, tile } from '../draft/fixtures';
import { meaningFixture, withMeaningCanvas } from './meaning-fixtures';
import { documentEdit as oracleEdit } from './oracle/documentEdit';

type Doc = CompositionDocument;
type Rng = () => number;
/** mulberry32: small, fast and identical everywhere, so a seed names one exact sequence. */
function random(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];

// MARK: - Fixtures

const slot = (at: number): EditorPath => ['pages', 0, 'components', at, 'props', 'subtitle'];
const compiled = () => compileCompositionDocument(draftDocument()).document;
const lifted = (document: Doc, path: EditorPath, kind: 'slot' | 'operand' = 'slot', y = 200) => {
  const graph = liftField(document, path, kind).graph;
  return { anchor: graph.roots[0].anchor, nodes: graph.nodes.map((node, at) => ({ id: node.id, origins: node.origins, x: at * 100, y })) };
};
const framed = (document: Doc, roots: ReturnType<typeof lifted>[], groups = false): Doc => {
  let stored: StoredStudioCanvasMetadata = encodeStudioCanvas(document, [{ id: 'frame', roots }]);
  if (groups) stored = { ...stored, canvases: stored.canvases.map(canvas => ({ ...canvas, groups: [{ id: 'all', label: 'All', nodeIds: canvas.nodes.map(node => node.id) }] })) };
  return { ...document, studioCanvas: stored };
};
const call = { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: { type: 'literal', value: 'light.example' } },
  data: { type: 'object', fields: {} }, feedback: 'policy' };
const withThirdTile = (document: Doc): Doc => replaceAt(document, ['pages', 0, 'components'], [...document.pages[0].components,
  { id: 'third-tile', type: 'bound-control', title: 'Third', layout: { span: 1 },
    props: { kind: 'toggle', isOn: { type: 'state', sourceId: 'source-a', path: ['state'], in: ['on'] }, unavailableText: 'Unavailable' },
    onAction: call, offAction: call }]);
const aliasedUse = (document: Doc) => replaceAt(document, [...slot(0), 'value'], valueAt(document, [...slot(1), 'value']));
function storedVariant(mode: string): Doc {
  const document = { ...compiled(), logicUseBindings: [] };
  let stored = framed(document, [0, 1].map(at => lifted(document, slot(at), 'slot', at * 200)), true).studioCanvas as StoredStudioCanvasMetadata;
  const canvas = stored.canvases[0];
  if (mode === 'stale lifted ID') {
    const node = canvas.nodes[2], id = JSON.stringify([node.rootId, 'stale']);
    stored = { ...stored, canvases: [{ ...canvas, nodes: canvas.nodes.map((old, at) => at === 2 ? { ...node, id, nodeId: 'stale' } : old),
      groups: canvas.groups!.map(group => ({ ...group, nodeIds: group.nodeIds.map(old => old === node.id ? id : old) })) }] };
  }
  if (mode === 'missing origin') stored = { ...stored, canvases: [{ ...canvas, nodes: canvas.nodes.map((old, at) => at === 2 ? { ...old, origins: ['/missing'] } : old) }] };
  // Reads as usable (the origin exists) but cannot be carried: the origin is a scalar no lifted node comes from.
  if (mode === 'scalar origin') {
    stored = { ...stored, canvases: [{ ...canvas, nodes: canvas.nodes.map((old, at) => at === 0 ? { ...old, origins: ['/fallback'] } : old) }] };
    return { ...replaceAt(document, [...slot(0), 'fallback'], 'Existing scalar, not a graph node'), studioCanvas: stored };
  }
  if (mode === 'reversed nodes') stored = { ...stored, canvases: [{ ...canvas, nodes: [...canvas.nodes].reverse() }] };
  return { ...document, studioCanvas: stored };
}
const fixtures: Record<string, () => Doc> = {
  'page tile with canvas': () => { const { document, slot } = meaningFixture('page tile'); return withMeaningCanvas(document, slot); },
  'component parameters with canvas': () => { const { document, slot } = meaningFixture('component parameters'); return withMeaningCanvas(document, slot); },
  'private sources with canvas': () => { const { document, slot } = meaningFixture('private sources'); return withMeaningCanvas(document, slot); },
  'nested operand': () => meaningFixture('nested operand').document,
  'automatic with canvas': () => { const document = { ...compiled(), logicUseBindings: compiled().logicUseBindings!.slice(0, 1) }; return framed(document, [lifted(document, slot(0))]); },
  'already-aliased use': () => aliasedUse({ ...compiled(), logicUseBindings: compiled().logicUseBindings!.slice(1) }),
  'already-aliased canvas operand': () => {
    const document = aliasedUse({ ...compiled(), logicUseBindings: [] });
    return framed(document, [lifted(document, [...slot(1), 'value'], 'operand')]);
  },
  'already-aliased component parameter': () => {
    const raw = componentDocument();
    const document = compileCompositionDocument({ ...raw, logicUseBindings: [],
      componentLibrary: raw.componentLibrary.map(entry => ({ ...entry, params: [{ name: 'label', kind: 'text' }],
        bindings: [{ param: 'label', nodeId: 'inner-tile', field: 'props/subtitle/value/value' }],
        node: { ...entry.node, props: { ...entry.node.props, subtitle: { type: 'expr', value: { type: 'literal', value: 'Default' } } } } })),
      pages: raw.pages.map(page => ({ ...page, components: [...page.components.map(node => ({ ...node, args: { label: 'Placed' } })), tile('alias', 'source-a')] })),
    } as unknown as Doc).document;
    return replaceAt(document, [...slot(2), 'value'], valueAt(document, ['componentLibrary', 0, 'node', 'props', 'subtitle', 'value']));
  },
  'third tile with aliased use and canvas': () => {
    const document = aliasedUse(withThirdTile({ ...compiled(), logicUseBindings: compiled().logicUseBindings!.slice(1) }));
    return framed(document, [lifted(document, slot(0))]);
  },
  'partial canvas root over a bound use': () => {
    const document = withThirdTile({ ...compiled(), logicUseBindings: compiled().logicUseBindings!.slice(0, 1) }), root = lifted(document, slot(0));
    return framed(document, [{ ...root, nodes: root.nodes.filter(node => node.origins.includes('')) }]);
  },
  'source parameter': () => {
    const document = compileCompositionDocument(componentDocument()).document;
    return { ...document, logicUseBindings: [], componentLibrary: document.componentLibrary!.map(entry => ({
      ...entry, bindings: [{ param: 'source', nodeId: 'inner-tile', field: 'props/titleProviderId' }] })) };
  },
  'private component': () => {
    const raw = componentDocument();
    return compileCompositionDocument({ ...raw, logicUseBindings: [],
      componentLibrary: raw.componentLibrary.map(entry => ({ ...entry, params: [{ name: 'entity', kind: 'entity-id' }],
        bindings: [{ param: 'entity', sourceId: 'private-state', field: 'entityId/value' }],
        sources: [{ id: 'private-state', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.demo_private' } }] })),
      pages: raw.pages.map(page => ({ ...page, components: page.components.map(node => ({ ...node, args: { entity: 'sensor.example' } })) })),
    } as unknown as Doc).document;
  },
  'shared frame': () => storedVariant('normal'),
  'shared frame, stale lifted ID': () => storedVariant('stale lifted ID'),
  'shared frame, missing origin': () => storedVariant('missing origin'),
  'shared frame, unreconcilable scalar origin': () => storedVariant('scalar origin'),
  'shared frame, reversed nodes': () => storedVariant('reversed nodes'),
};

// MARK: - Edits

interface Position { readonly path: EditorPath; readonly value: object }
/** Every object and array below the root, in document order, with the number of places each object occurs. */
function survey(document: Doc) {
  const all: Position[] = [], counts = new Map<object, number>();
  const visit = (value: unknown, path: EditorPath) => {
    if (value === null || typeof value !== 'object') return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
    if (path.length) all.push({ path, value });
    for (const [key, child] of Object.entries(value)) visit(child, [...path, Array.isArray(value) ? Number(key) : key]);
  };
  visit(document, []);
  const semantic = all.filter(({ path }) => path[0] !== 'studioCanvas' && path[0] !== 'logicUseBindings');
  // Objects near linked values: slots, operands, props, sources and parameter targets.
  const bound = semantic.filter(({ path }) => path.some(part => part === 'subtitle' || part === 'value' || part === 'props' || part === 'sources' || part === 'glyphTint' || part === 'args'));
  return { all, semantic, bound, counts };
}
const near = (rng: Rng, surveyed: ReturnType<typeof survey>) => pick(rng, rng() < 0.7 && surveyed.bound.length ? surveyed.bound : surveyed.semantic);
const fixedKeys = new Set(['type', 'kind', 'model', 'version', 'originFrame', 'id', 'nodeId', 'logicId', 'componentId', 'pageId', 'rootId', 'param']);
const nodeLists = (document: Doc) => survey(document).semantic.filter(({ path, value }) => Array.isArray(value)
  && (path.at(-1) === 'components' || path.at(-1) === 'children') && value.every(item => item && typeof item === 'object' && 'id' in item));
const rootTargets = (document: Doc): EditorPath[] => {
  const parsed = studioCanvasMetadataSchema.safeParse(document.studioCanvas);
  if (!parsed.success) return [];
  return parsed.data.canvases.flatMap(canvas => canvas.roots.flatMap(root => {
    const target = resolveLogicAnchor(document, root.anchor);
    return target ? [pointerPath(target.pointer)] : [];
  }));
};
const merge = (left: EditReferences, right: EditReferences): EditReferences => ({
  ...left.relocated || right.relocated ? { relocated: new Map([...left.relocated ?? [], ...right.relocated ?? []]) } : {},
  ...left.fields || right.fields ? { fields: new Map([...left.fields ?? [], ...right.fields ?? []]) } : {},
  ...left.copied || right.copied ? { copied: [...left.copied ?? [], ...right.copied ?? []] } : {},
  ...left.deleted || right.deleted ? { deleted: [...left.deleted ?? [], ...right.deleted ?? []] } : {},
  ...left.discardLayouts || right.discardLayouts ? { discardLayouts: [...left.discardLayouts ?? [], ...right.discardLayouts ?? []] } : {},
  ...left.layout || right.layout ? { layout: [...left.layout ?? [], ...right.layout ?? []] } : {},
});
interface Step { readonly document: Doc; readonly references: EditReferences; readonly label: string }
let counter = 0;
const fresh = (prefix: string) => `${prefix}-${++counter}`;

/** Place `source`'s object at a second place: a place of the same kind, or a new tile on some surface. */
function aliasOf(document: Doc, rng: Rng, source: Position): Step | undefined {
  const surveyed = survey(document), last = source.path.at(-1);
  if (rng() < 0.5) {
    // Same kind of place: the same key, or for a list item, an item of a list under the same key.
    const same = surveyed.semantic.filter(({ path, value }) => path.at(-1) === last && value !== source.value
      && (typeof last !== 'number' || path.at(-2) === source.path.at(-2)));
    if (same.length) {
      const target = pick(rng, same);
      return { document: replaceAt(document, target.path, source.value), references: {}, label: `alias ${fieldPointer(source.path)} at ${fieldPointer(target.path)}` };
    }
  }
  const lists = nodeLists(document).filter(({ path }) => path[0] === 'pages' || path[0] === 'modals');
  if (!lists.length) return undefined;
  const list = pick(rng, lists), base = tile(fresh('alias'), 'source-a');
  const value = source.value as { type?: unknown };
  const node = last === 'props' && !Array.isArray(value) ? { ...base, props: source.value }
    : value.type === 'expr' || value.type === 'read' ? { ...base, props: { ...base.props, subtitle: source.value } }
      : { ...base, props: { ...base.props, subtitle: { type: 'expr', value: source.value } } };
  return { document: replaceAt(document, list.path, [...list.value as object[], node]), references: {}, label: `alias ${fieldPointer(source.path)} in a new tile at ${fieldPointer(list.path)}` };
}

/** Type in an object at or above `path` (below the root), which rebuilds every container from there up. */
function rebuildNear(document: Doc, rng: Rng, path: EditorPath): Step | undefined {
  for (let attempt = 0; attempt < 6; attempt++) {
    const depth = 1 + Math.floor(rng() * path.length), at = path.slice(0, depth), value = valueAt(document, at);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const keys = Object.entries(value).filter(([key, child]) => typeof child === 'string' && !fixedKeys.has(key)).map(([key]) => key);
    const key = keys.length ? pick(rng, keys) : (value as { type?: unknown }).type === 'expr' ? 'fallback' : undefined;
    if (!key) continue;
    return { document: replaceAt(document, [...at, key], `Rebuilt ${counter++}`), references: {}, label: `type ${fieldPointer([...at, key])}` };
  }
  return undefined;
}

/** Each edit takes the document so far (which may already be a candidate) and returns the next candidate. */
const edits: Record<string, { weight: number; apply(document: Doc, rng: Rng, history: readonly Doc[]): Step | undefined }> = {
  'sibling typing': { weight: 8, apply(document, rng) {
    const surveyed = survey(document);
    for (let attempt = 0; attempt < 8; attempt++) {
      const { path, value } = near(rng, surveyed);
      if (Array.isArray(value)) continue;
      const keys = Object.entries(value).filter(([key, child]) => typeof child === 'string' && !fixedKeys.has(key)).map(([key]) => key);
      const key = keys.length ? pick(rng, keys) : 'type' in value && (value.type === 'expr' || value.type === 'read') ? 'fallback' : undefined;
      if (!key) continue;
      const old = Reflect.get(value, key);
      const next = key === 'titleProviderId' || key === 'sourceId' ? (old === 'source-a' ? 'source-b' : 'source-a') : `${typeof old === 'string' ? old : ''}~${counter++}`;
      return { document: replaceAt(document, [...path, key], next), references: {}, label: `type ${fieldPointer([...path, key])}` };
    }
    return undefined;
  } },
  // The identity reasoning's weak points: a container of a bound value rebuilt (its witness may be lost), alone or while
  // the bound object, or one holding it, is also placed somewhere else in the same edit.
  'rebuild near a bound value': { weight: 5, apply(document, rng) { return rebuildNear(document, rng, near(rng, survey(document)).path); } },
  'alias and rebuild origin': { weight: 5, apply(document, rng) {
    const origin = near(rng, survey(document)), depth = Math.max(1, origin.path.length - Math.floor(rng() * 3));
    // The bound object itself, or a container holding it, goes to a second place.
    const held = origin.path.slice(0, depth), value = valueAt(document, held);
    if (value === null || typeof value !== 'object') return undefined;
    const placed = aliasOf(document, rng, { path: held, value });
    if (!placed) return undefined;
    const rebuilt = rebuildNear(placed.document, rng, origin.path);
    return rebuilt ? { document: rebuilt.document, references: {}, label: `${placed.label} + ${rebuilt.label}` } : placed;
  } },
  'declared slot typing': { weight: 5, apply(document, rng) {
    const roots = rootTargets(document).filter(path => { const value = valueAt(document, path); return value !== null && typeof value === 'object' && !Array.isArray(value); });
    if (!roots.length) return undefined;
    const path = pick(rng, roots), pointer = fieldPointer(path), declared = rng() < 0.8;
    return { document: replaceAt(document, [...path, 'fallback'], `Typed ${counter++}`), references: declared ? { fields: new Map([[pointer, [pointer]]]) } : {},
      label: `${declared ? 'declared' : 'undeclared'} slot typing ${pointer}` };
  } },
  'alias': { weight: 7, apply(document, rng) { return aliasOf(document, rng, near(rng, survey(document))); } },
  'remove alias': { weight: 3, apply(document, rng) {
    const surveyed = survey(document), shared = surveyed.semantic.filter(({ value }) => surveyed.counts.get(value)! > 1);
    if (!shared.length) return undefined;
    const { path, value } = pick(rng, shared);
    return { document: replaceAt(document, path, structuredClone(value)), references: {}, label: `unalias ${fieldPointer(path)}` };
  } },
  'undeclared clone': { weight: 2, apply(document, rng) {
    const { path, value } = near(rng, survey(document));
    return { document: replaceAt(document, path, structuredClone(value)), references: {}, label: `clone ${fieldPointer(path)}` };
  } },
  'array edit': { weight: 5, apply(document, rng) {
    const lists = nodeLists(document).filter(({ value }) => (value as object[]).length);
    if (!lists.length) return undefined;
    const { path, value } = pick(rng, lists), items = [...value as { id: string }[]], at = Math.floor(rng() * items.length), declare = rng() < 0.5;
    const kind = pick(rng, ['reorder', 'insert', 'delete', 'copy', 'move'] as const);
    if (kind === 'reorder' && items.length > 1) {
      const other = (at + 1 + Math.floor(rng() * (items.length - 1))) % items.length;
      [items[at], items[other]] = [items[other], items[at]];
      return { document: replaceAt(document, path, items), references: {}, label: `swap ${fieldPointer(path)} ${at}/${other}` };
    }
    if (kind === 'insert') {
      items.splice(at, 0, tile(fresh('inserted'), 'source-a') as unknown as { id: string });
      return { document: replaceAt(document, path, items), references: {}, label: `insert at ${fieldPointer([...path, at])}` };
    }
    if (kind === 'delete') {
      items.splice(at, 1);
      return { document: replaceAt(document, path, items), references: declare ? { deleted: [[...path, at]] } : {}, label: `${declare ? 'declared' : 'undeclared'} delete ${fieldPointer([...path, at])}` };
    }
    if (kind === 'copy') {
      items.push({ ...structuredClone(items[at]), id: fresh('copied') });
      return { document: replaceAt(document, path, items), references: declare ? { copied: [{ from: [...path, at], to: [...path, items.length - 1] }] } : {},
        label: `${declare ? 'declared' : 'undeclared'} copy ${fieldPointer([...path, at])}` };
    }
    const targets = nodeLists(document).filter(list => fieldPointer(list.path) !== fieldPointer(path) && list.path[0] === path[0]);
    if (!targets.length) return undefined;
    const target = pick(rng, targets), moved = items.splice(at, 1)[0];
    let next = replaceAt(document, path, items);
    const destination = valueAt(next, target.path) as object[] | undefined;
    if (!Array.isArray(destination)) return undefined;
    next = replaceAt(next, target.path, [...destination, moved]);
    const from = fieldPointer([...path, at]), to = fieldPointer([...target.path, destination.length]);
    return { document: next, references: declare ? { relocated: new Map([[from, [to]]]) } : {}, label: `${declare ? 'declared' : 'undeclared'} move ${from} to ${to}` };
  } },
  'id change': { weight: 3, apply(document, rng) {
    const owners = survey(document).semantic.filter(({ value }) => !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string');
    if (!owners.length) return undefined;
    const { path, value } = pick(rng, owners), id = (value as { id: string }).id;
    const next = rng() < 0.3 ? pick(rng, owners.map(owner => (owner.value as { id: string }).id)) : `${id}-renamed`;
    return { document: replaceAt(document, [...path, 'id'], next), references: {}, label: `id ${fieldPointer(path)} ${id} -> ${next}` };
  } },
  'binding edit': { weight: 4, apply(document, rng) {
    const automatic = document.logicUseBindings ?? [], parameters = (document.componentLibrary ?? []).flatMap((entry, index) => (entry.bindings ?? []).map((_, at) => [index, at] as const));
    if (automatic.length && (rng() < 0.6 || !parameters.length)) {
      const at = Math.floor(rng() * automatic.length), bindings = [...automatic];
      const kind = pick(rng, ['remove', 'duplicate', 'reverse', 'rebuild', 'retarget'] as const);
      if (kind === 'remove') bindings.splice(at, 1);
      else if (kind === 'duplicate') bindings.push(bindings[at]);
      else if (kind === 'reverse') bindings.reverse();
      else if (kind === 'rebuild') bindings[at] = structuredClone(bindings[at]);
      else {
        const ids = survey(document).semantic.filter(({ path, value }) => path[0] === 'pages' && typeof (value as { id?: unknown }).id === 'string' && path.at(-2) === 'components').map(({ value }) => (value as { id: string }).id);
        if (!ids.length || !('nodeId' in bindings[at].use)) return undefined;
        bindings[at] = { ...bindings[at], use: { ...bindings[at].use, nodeId: pick(rng, ids) } };
      }
      return { document: { ...document, logicUseBindings: bindings }, references: {}, label: `${kind} logic use binding ${at}` };
    }
    if (!parameters.length) return undefined;
    const [index, at] = pick(rng, parameters), entry = document.componentLibrary![index], bindings = [...entry.bindings!];
    const kind = pick(rng, ['remove', 'rebuild', 'retarget', 'field'] as const);
    if (kind === 'remove') bindings.splice(at, 1);
    else if (kind === 'rebuild') bindings[at] = structuredClone(bindings[at]);
    else if (kind === 'retarget') bindings[at] = { ...bindings[at], ...bindings[at].nodeId ? { nodeId: `${bindings[at].nodeId}-x` } : { sourceId: `${bindings[at].sourceId}-x` } };
    else bindings[at] = { ...bindings[at], field: `${bindings[at].field}/x` };
    return { document: replaceAt(document, ['componentLibrary', index, 'bindings'], bindings), references: {}, label: `${kind} component binding ${index}/${at}` };
  } },
  'canvas edit': { weight: 3, apply(document, rng) {
    const parsed = studioCanvasMetadataSchema.safeParse(document.studioCanvas);
    if (!parsed.success || !parsed.data.canvases.length) return undefined;
    const layout = structuredClone(parsed.data), canvas = pick(rng, layout.canvases);
    const kind = pick(rng, ['move node', 'drop node', 'drop group member', 'reverse nodes', 'drop root'] as const);
    if (kind === 'move node' && canvas.nodes.length) pick(rng, canvas.nodes).x += 40;
    else if (kind === 'drop node' && canvas.nodes.length) {
      const id = canvas.nodes.splice(Math.floor(rng() * canvas.nodes.length), 1)[0].id;
      if (canvas.groups) canvas.groups = canvas.groups.map(group => ({ ...group, nodeIds: group.nodeIds.filter(node => node !== id) }));
    } else if (kind === 'drop group member' && canvas.groups?.[0]?.nodeIds.length) canvas.groups[0].nodeIds.pop();
    else if (kind === 'reverse nodes') canvas.nodes.reverse();
    else if (kind === 'drop root' && canvas.roots.length) {
      const root = canvas.roots.splice(Math.floor(rng() * canvas.roots.length), 1)[0];
      const dropped = new Set(canvas.nodes.filter(node => node.rootId === root.id).map(node => node.id));
      canvas.nodes = canvas.nodes.filter(node => !dropped.has(node.id));
      if (canvas.groups) canvas.groups = canvas.groups.map(group => ({ ...group, nodeIds: group.nodeIds.filter(node => !dropped.has(node)) }));
    }
    const roots = rootTargets(document), declare = roots.length && rng() < 0.5;
    return { document: { ...document, studioCanvas: layout }, references: declare ? { layout: [pick(rng, roots)] } : {}, label: `${declare ? 'declared ' : ''}canvas ${kind}` };
  } },
  'discard layout': { weight: 1, apply(document, rng) {
    const roots = rootTargets(document);
    if (!roots.length) return undefined;
    return { document: { ...document, name: fresh('discard') }, references: { discardLayouts: [pick(rng, roots)] }, label: 'discard a layout' };
  } },
  'rename': { weight: 3, apply(document) { return { document: { ...document, name: fresh('name') }, references: {}, label: 'rename' }; } },
  'reapply earlier revision': { weight: 1, apply(_document, rng, history) {
    return history.length > 1 ? { document: pick(rng, history.slice(0, -1)), references: {}, label: 'reapply an earlier revision' } : undefined;
  } },
};
const weighted = Object.entries(edits).flatMap(([name, edit]) => Array.from({ length: edit.weight }, () => name));

/** Make one step: one to three edits composed into a single candidate. */
function step(before: Doc, rng: Rng, history: readonly Doc[]): Step {
  let document = before, references: EditReferences = {};
  const labels: string[] = [];
  const count = rng() < 0.6 ? 1 : rng() < 0.75 ? 2 : 3;
  for (let attempt = 0; labels.length < count && attempt < 12; attempt++) {
    const name = pick(rng, weighted);
    if (name === 'reapply earlier revision' && labels.length) continue;
    let made: Step | undefined;
    try { made = edits[name].apply(document, rng, history); } catch { made = undefined; }
    if (!made) continue;
    document = made.document; references = merge(references, made.references); labels.push(made.label);
    if (name === 'reapply earlier revision') break;
  }
  if (!labels.length) return { document: { ...before, name: fresh('name') }, references: {}, label: 'rename' };
  return { document, references, label: labels.join(' + ') };
}

/**
 * Mutate a refused candidate in place, as a caller retrying it might: only objects the candidate built itself are
 * changed (never an object of a committed revision: mutating those is outside the contract), each by restoring
 * `before`'s object or a clone of it at that place.
 */
function retry(before: Doc, candidate: Doc, rng: Rng, history: readonly Doc[]): boolean {
  const committed = new Set<unknown>(history);
  for (const revision of history) for (const { value } of survey(revision).all) committed.add(value);
  if (committed.has(candidate)) return false;
  const built = survey(candidate).all.filter(({ value, path }) => !committed.has(value) && path[0] !== 'studioCanvas');
  for (let changed = 0, attempt = 0; changed < 2 && attempt < 6 && built.length; attempt++) {
    const { path, value } = pick(rng, built), keys = Object.keys(value);
    if (!keys.length) continue;
    const key = pick(rng, keys), original = valueAt(before, [...path, Array.isArray(value) ? Number(key) : key]);
    if (original === undefined) continue;
    Reflect.set(value, key, rng() < 0.5 || original === null || typeof original !== 'object' ? original : structuredClone(original));
    changed++;
  }
  Reflect.set(candidate, 'name', fresh('retry'));
  return true;
}

// MARK: - Comparison

type Outcome = { kind: 'result'; document: Doc } | { kind: 'error'; error: unknown };
const run = (edit: () => Doc): Outcome => { try { return { kind: 'result', document: edit() }; } catch (error) { return { kind: 'error', error }; } };
/** `fieldAnchor`'s own errors, or one raised while it walks a malformed owner (an entry without a node, say). */
const fromFieldAnchor = (error: unknown) => error instanceof Error && (['This field does not have an unambiguous logic owner.', 'The logic owner no longer exists.'].includes(error.message)
  || /\/logic-fields\/registry\.ts:/.test(error.stack?.split('\n').find(line => line.includes('/src/') || line.includes('/oracle/')) ?? ''));
const where = (error: unknown) => error instanceof Error ? ` at ${error.stack?.split('\n').find(line => line.includes('/src/') || line.includes('/oracle/'))?.trim() ?? '?'}` : '';
const describeOutcome = (outcome: Outcome, before: Doc, candidate: Doc) => outcome.kind === 'error' ? `throws ${String(outcome.error)}${where(outcome.error)}`
  : outcome.document === before ? 'refuses' : outcome.document === candidate ? 'accepts as proposed' : 'accepts with reconciled metadata';
/** Agreement, or a description of the disagreement. */
function compare(before: Doc, candidate: Doc, scoped: Outcome, oracle: Outcome): string | undefined {
  if (oracle.kind === 'error') {
    if (scoped.kind === 'error' && String(scoped.error) === String(oracle.error)) return undefined;
    if (scoped.kind === 'result' && scoped.document === before && fromFieldAnchor(oracle.error)) return undefined;
  } else if (scoped.kind === 'result') {
    const refused = scoped.document === before, oracleRefused = oracle.document === before;
    if (refused === oracleRefused && sameJson(scoped.document, oracle.document)) return undefined;
    if (refused === oracleRefused) {
      const canvas = sameJson(scoped.document.studioCanvas, oracle.document.studioCanvas) ? 'same studioCanvas' : 'different studioCanvas';
      return `both ${refused ? 'refuse' : 'accept'} but outputs differ (${canvas})`;
    }
  }
  return `scoped ${describeOutcome(scoped, before, candidate)}, oracle ${describeOutcome(oracle, before, candidate)}`;
}

interface Disagreement { readonly seed: number; readonly fixture: string; readonly step: number; readonly edit: string; readonly detail: string }
function sequence(seed: number, steps: number): { disagreement?: Disagreement; accepted: number; refused: number } {
  const rng = random(seed), names = Object.keys(fixtures), fixture = names[seed % names.length];
  counter = 0;
  let before = fixtures[fixture]();
  const history = [before];
  let accepted = 0, refused = 0;
  for (let index = 0; index < steps; index++) {
    const made = step(before, rng, history);
    const candidate = made.document;
    let label = made.label;
    for (let resubmit = 0; resubmit < 2; resubmit++) {
      const scoped = run(() => documentEdit(before, candidate, made.references));
      const oracle = run(() => oracleEdit(before, candidate, made.references));
      const detail = compare(before, candidate, scoped, oracle);
      if (detail) {
        if (process.env.EDIT_ORACLE_DUMP) {
          const output = (outcome: Outcome) => outcome.kind === 'result' ? outcome.document : { error: String(outcome.error) };
          writeFileSync(`${process.env.EDIT_ORACLE_DUMP}/seed-${seed}.json`, JSON.stringify({ before, candidate,
            references: Object.fromEntries(Object.entries(made.references).map(([key, value]) => [key, value instanceof Map ? [...value] : value])),
            scoped: output(scoped), oracle: output(oracle) }, null, 1));
        }
        return { disagreement: { seed, fixture, step: index, edit: label, detail }, accepted, refused };
      }
      if (process.env.EDIT_ORACLE_TRACE) process.stdout.write(`Edit oracle trace: seed ${seed} step ${index}: ${label} -> ${describeOutcome(scoped, before, candidate)}\n`);
      if (scoped.kind === 'result' && scoped.document !== before) {
        accepted++; before = scoped.document; history.push(before); break;
      }
      refused++;
      // A refused candidate is the caller's to change and offer again.
      if (rng() >= 0.35 || !retry(before, candidate, rng, history)) break;
      label = `${label} (refused, then mutated in place and resubmitted)`;
    }
  }
  return { accepted, refused };
}

const environment = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const from = environment('EDIT_ORACLE_FROM', 1), seeds = environment('EDIT_ORACLE_SEEDS', 256), steps = environment('EDIT_ORACLE_STEPS', 14);

describe('scoped documentEdit agrees with the whole-document oracle on seeded random edit sequences', () => {
  let toast: ReturnType<typeof vi.spyOn>;
  beforeAll(() => { toast = vi.spyOn(toastManager, 'add').mockImplementation(() => ''); });
  afterAll(() => toast.mockRestore());

  it(`seeds ${from}..${from + seeds - 1}, ${steps} steps each`, () => {
    const disagreements: Disagreement[] = [];
    let accepted = 0, refused = 0;
    for (let seed = from; seed < from + seeds; seed++) {
      const result = sequence(seed, steps);
      accepted += result.accepted; refused += result.refused;
      if (result.disagreement) disagreements.push(result.disagreement);
    }
    process.stdout.write(`Edit oracle: ${seeds} seeds from ${from}, ${steps} steps; ${accepted} accepted and ${refused} refused submissions; ${disagreements.length} disagreeing seeds.\n`);
    if (process.env.EDIT_ORACLE_REPORT) for (const found of disagreements) process.stdout.write(`Edit oracle disagreement: ${JSON.stringify(found)}\n`);
    expect(disagreements).toEqual([]);
  }, Math.max(120_000, seeds * steps * 50));
});
