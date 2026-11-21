/**
 * Randomized differential test: the dependency-scoped `documentEdit` against the whole-document reconciliation it
 * replaced (`./oracle`, a verbatim copy of 5b28fc4). Each seed picks a fixture and applies a multi-step sequence of
 * random edits, carrying accepted results forward so index reuse and carrying are exercised, and after every step both
 * implementations must agree on refusal and give the same JSON (including `studioCanvas`).
 *
 * Edits mix: sibling typing that rebuilds ancestors (declared through `fields` or not), placing an existing object at
 * extra places (also while rebuilding one of its original containers in the same edit), removing such aliases (by
 * cloning, or by deleting one of the properties holding it), undeclared clones, array reorder/insert/delete, moves and
 * copies (declared through `relocated`, `copied` and `deleted` or not), declared provenance that need not match the edit,
 * objects of earlier revisions placed back, ID changes, `logicUseBindings` and component binding edits, canvas metadata
 * edits (with and without `layout`), `discardLayouts`, renames, reapplying an earlier revision, malformed owners in every
 * owner list (see `malformed`), links restored to a draft that had none, and resubmitting a refused candidate after
 * mutating it in place, and adopting accepted content as a revision that never passed the boundary. Some keep every
 * owner and node object but change a read across them (owner lists reordered, owners or node IDs repeated, the logic
 * library rebuilt): the index build memoizes per owner, node and root by identity, and these are the reads such a memo
 * must still check.
 *
 * Documented deviation: where the oracle throws (a field with no unambiguous owner, such as duplicate IDs; or an owner it
 * cannot walk or read, such as a page without `components`), the scoped implementation refuses (and keeps `before`)
 * instead. That pair counts as agreement; `EDIT_ORACLE_REPORT=1` tallies each such oracle error by message and site. Any
 * other error must be the same error from both, and the scoped implementation must never accept where the oracle throws.
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
import { editSubtrees } from '../../../src/workspace2/editors/provenance';
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

/** Whether the compiler accepts `document` (as a reload would, before installing it as authored). */
const compiles = (document: Doc) => { try { compileCompositionDocument(document); return true; } catch { return false; } };

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
/**
 * A raw draft whose component binding fills an argument of a use in the body that its logic never reads: expansion re-points
 * such a binding to every place the argument lands, here none, so the compiler never sees it and accepts the draft with
 * whatever `param` it names. Installed as is (as a reload installs authored content), never through this boundary.
 */
function hiddenBindingDraft(param: string): Doc {
  const raw = componentDocument(), entry = raw.componentLibrary[0];
  const constant = { id: 'constant', name: 'Constant', kind: 'operand', params: [{ name: 'source', kind: 'source-id' }], body: { type: 'literal', value: 'Fixed' } };
  const node = { ...entry.node, props: { ...entry.node.props, subtitle: { type: 'expr', value: { type: 'logic-ref', logicId: 'constant', args: { source: 'source-a' } } } } };
  const document = { ...raw, logicUseBindings: [], logicLibrary: [...raw.logicLibrary, constant],
    componentLibrary: [{ ...entry, node, bindings: [...entry.bindings, { param, nodeId: 'inner-tile', field: 'props/subtitle/value/args/source' }] }] } as unknown as Doc;
  if (!compiles(document)) throw new Error('The hidden-binding draft no longer compiles.');
  return document;
}
/**
 * A raw draft whose component body is a `local-tabs` node holding the bound tile in its first tab. Both addresses of the
 * tile's field compile; the reconciliation derives the tile's own (`inner-tile`), so a binding stored through the tabs
 * node is re-addressed by every edit, while one stored at the tile is a fixed point. `node` lets two drafts share a body.
 */
function tabbedComponentDraft(through: 'tile' | 'tabs', node?: unknown): Doc {
  const raw = componentDocument(), entry = raw.componentLibrary[0];
  const choice = [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }];
  const body = node ?? { id: 'tab-container', title: 'Tabs', type: 'local-tabs', layout: { span: 1 }, props: { stateId: 'selected-tab', transition: 'canonical-swap@1' },
    tabs: [{ ...choice[0], children: [entry.node] }, { ...choice[1], children: [] }] };
  const binding = through === 'tile' ? { param: 'source', nodeId: 'inner-tile', field: 'props/titleProviderId' }
    : { param: 'source', nodeId: 'tab-container', field: 'tabs/0/children/0/props/titleProviderId' };
  const document = { ...raw, logicUseBindings: [], localState: [{ id: 'selected-tab', type: 'choice', initial: 'first', options: choice }],
    componentLibrary: [{ ...entry, node: body, bindings: [binding] }] } as unknown as Doc;
  if (!compiles(document)) throw new Error('The tabbed component draft no longer compiles.');
  return document;
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
  // Compiler-accepted raw drafts, installed without passing the boundary.
  'raw component draft': () => { const document = componentDocument() as unknown as Doc; if (!compiles(document)) throw new Error('The raw component draft no longer compiles.'); return document; },
  'raw draft, hidden binding with an unknown parameter': () => hiddenBindingDraft('missing'),
  'raw draft, hidden binding': () => hiddenBindingDraft('source'),
  'raw draft, binding addressed through its tabs node': () => tabbedComponentDraft('tabs'),
  'shared frame': () => storedVariant('normal'),
  'shared frame, stale lifted ID': () => storedVariant('stale lifted ID'),
  'shared frame, missing origin': () => storedVariant('missing origin'),
  'shared frame, unreconcilable scalar origin': () => storedVariant('scalar origin'),
  'shared frame, reversed nodes': () => storedVariant('reversed nodes'),
  // Nothing linked: neither reconciler reads any owner, so malformed ones are accepted until `relink` links the draft.
  'unlinked draft': () => ({ ...compiled(), logicUseBindings: [] }),
  // Starts with an owner the oracle cannot walk, which stays untouched once `relink` links the draft.
  'unlinked draft with a null modal': () => ({ ...compiled(), logicUseBindings: [], modals: [...compiled().modals, null] }) as unknown as Doc,
  'unlinked component draft': () => {
    const document = compileCompositionDocument(componentDocument()).document;
    return { ...document, logicUseBindings: [], componentLibrary: document.componentLibrary!.map(entry => ({ ...entry, bindings: [] })) };
  },
  // The only link is a root on a logic entry's body, which `fieldAnchor` finds by ID without walking any owner.
  'logic body canvas': () => {
    const document = { ...compiled(), logicUseBindings: [] }, graph = liftField(document, ['logicLibrary', 0, 'body'], 'operand').graph;
    return framed(document, [{ anchor: graph.roots[0].anchor, nodes: graph.nodes.map((node, at) => ({ id: node.id, origins: node.origins, x: at * 100, y: 0 })) }]);
  },
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
/** The links `relink` restores: the sequence's own fixture, or for the unlinked draft its linked counterpart. */
let links: Doc;
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
  // An object of an older revision placed back into the current one: its identity is a witness the index may have retired.
  'borrow an object from an earlier revision': { weight: 4, apply(document, rng, history) {
    if (history.length < 2) return undefined;
    const surveyed = survey(pick(rng, history.slice(0, -1)));
    if (!surveyed.bound.length) return undefined;
    const source = near(rng, surveyed), targets = survey(document).semantic.filter(({ path }) => path.at(-1) === source.path.at(-1));
    if (!targets.length) return undefined;
    const target = pick(rng, targets), pointer = fieldPointer(target.path);
    return { document: replaceAt(document, target.path, source.value), references: rng() < 0.5 ? { fields: new Map([[pointer, [pointer]]]) } : {},
      label: `borrow historical ${fieldPointer(source.path)} at ${pointer}` };
  } },
  // Declared provenance that need not match the edit: no destination, several, or ones holding something else.
  'arbitrary field provenance': { weight: 3, apply(document, rng) {
    const surveyed = survey(document);
    if (!surveyed.bound.length) return undefined;
    const from = near(rng, surveyed), same = surveyed.semantic.filter(({ path }) => path.at(-1) === from.path.at(-1));
    const destinations = Array.from({ length: Math.floor(rng() * 4) }, () => fieldPointer(pick(rng, same).path));
    const declared = new Map([[fieldPointer(from.path), destinations]]), fields = rng() < 0.5;
    return { document: { ...document, name: fresh('provenance') }, references: fields ? { fields: declared } : { relocated: declared },
      label: `declared ${fields ? 'fields' : 'relocated'} ${fieldPointer(from.path)} -> [${destinations.join(', ')}]` };
  } },
  'arbitrary copy provenance': { weight: 2, apply(document, rng) {
    const surveyed = survey(document);
    if (!surveyed.bound.length) return undefined;
    const from = near(rng, surveyed), to = pick(rng, surveyed.semantic.filter(({ path }) => path.at(-1) === from.path.at(-1)));
    return { document: { ...document, name: fresh('copy-provenance') }, references: { copied: [{ from: from.path, to: to.path }] },
      label: `declare existing copy ${fieldPointer(from.path)} -> ${fieldPointer(to.path)}` };
  } },
  // One of an object's places removed, leaving the others (declared deleted or not).
  'delete an aliased property': { weight: 2, apply(document, rng) {
    const surveyed = survey(document), shared = surveyed.bound.filter(({ path, value }) => surveyed.counts.get(value)! > 1 && typeof path.at(-1) === 'string');
    if (!shared.length) return undefined;
    const { path } = pick(rng, shared), parent = path.slice(0, -1), holder = valueAt(document, parent);
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) return undefined;
    const copy = { ...holder };
    Reflect.deleteProperty(copy, path.at(-1)!);
    const declare = rng() < 0.5;
    return { document: replaceAt(document, parent, copy), references: declare ? { deleted: [path] } : {}, label: `${declare ? 'declared ' : ''}delete shared ${fieldPointer(path)}` };
  } },
  'malformed owner': { weight: 4, apply: malformed },
  // Edits that keep every owner (and so every memoized owner and node) as it is but change what is read across them: an
  // owner list reordered (every owner's pointer moves), an owner repeated by object or by ID (the owner list ID scan no
  // longer finds one), or a new node taking an existing node's ID (inside the same owner, its node scan no longer does).
  'owner list edit': { weight: 4, apply(document, rng) {
    const list = pick(rng, ['pages', 'modals', 'componentLibrary'] as const), owners: unknown = Reflect.get(document, list);
    if (!Array.isArray(owners) || !owners.length) return undefined;
    const items = [...owners], at = Math.floor(rng() * items.length), owner = items[at] as { id?: unknown } | null;
    const kind = pick(rng, ['swap', 'reverse', 'repeat the object', 'repeat the ID', 'move to the front'] as const);
    if (kind === 'swap' && items.length > 1) {
      const other = (at + 1 + Math.floor(rng() * (items.length - 1))) % items.length;
      [items[at], items[other]] = [items[other], items[at]];
    } else if (kind === 'reverse' || kind === 'swap') items.reverse();
    else if (kind === 'repeat the object') items.splice(Math.floor(rng() * (items.length + 1)), 0, owner);
    else if (kind === 'repeat the ID') {
      if (!owner || typeof owner !== 'object') return undefined;
      const twin = list === 'componentLibrary' ? { id: owner.id, name: 'Twin', node: tile(fresh('twin'), 'source-a') } : { id: owner.id, title: 'Twin', components: [tile(fresh('twin'), 'source-a')] };
      items.splice(Math.floor(rng() * (items.length + 1)), 0, twin);
    } else items.unshift(...items.splice(at, 1));
    return { document: { ...document, [list]: items } as Doc, references: {}, label: `${kind} ${list}/${at}` };
  } },
  'repeat a node ID': { weight: 3, apply(document, rng) {
    const lists = nodeLists(document), nodes = lists.flatMap(({ path, value }) => (value as { id: string }[]).map(node => ({ path, id: node.id })));
    if (!nodes.length) return undefined;
    const { path, id } = pick(rng, nodes);
    // Mostly the same owner (its node scan), sometimes another one (which must not matter).
    const same = lists.filter(list => list.path[0] === path[0] && list.path[1] === path[1]), target = pick(rng, rng() < 0.75 && same.length ? same : lists);
    const items = [...target.value as object[]];
    items.splice(Math.floor(rng() * (items.length + 1)), 0, { ...tile(fresh('twin'), 'source-a'), id });
    return { document: replaceAt(document, target.path, items), references: {}, label: `repeat node ID ${id} in ${fieldPointer(target.path)}` };
  } },
  // The bindings' library, rebuilt equal (another object) or with a parameter's kind changed.
  'logic library edit': { weight: 2, apply(document, rng) {
    const library: unknown = document.logicLibrary;
    if (!Array.isArray(library) || !library.length) return undefined;
    const at = Math.floor(rng() * library.length), entry = library[at] as { params?: { kind?: string }[] } | null;
    const kind = pick(rng, ['clone the library', 'clone an entry', 'change a parameter kind'] as const);
    if (kind === 'clone the library') return { document: { ...document, logicLibrary: structuredClone(library) } as Doc, references: {}, label: kind };
    if (kind === 'clone an entry' || !entry?.params?.length) return { document: replaceAt(document, ['logicLibrary', at], structuredClone(entry)), references: {}, label: `clone logicLibrary/${at}` };
    const param = Math.floor(rng() * entry.params.length), old = entry.params[param]?.kind;
    return { document: replaceAt(document, ['logicLibrary', at, 'params', param, 'kind'], old === 'source-id' ? 'text' : 'source-id'), references: {},
      label: `logicLibrary/${at} parameter ${param} kind ${old} -> other` };
  } },
  // Links put back (bindings, layout metadata or both), so a revision accepted while nothing was linked gets linked.
  'relink': { weight: 2, apply(document, rng) {
    const what = pick(rng, ['bindings', 'layout', 'both'] as const), next = { ...document };
    if (what !== 'layout') next.logicUseBindings = links.logicUseBindings;
    if (what !== 'layout' && links.componentLibrary && Array.isArray(document.componentLibrary)) next.componentLibrary = document.componentLibrary.map(entry =>
      links.componentLibrary!.find(linked => linked.id === entry?.id)?.bindings ? { ...entry, bindings: links.componentLibrary!.find(linked => linked.id === entry.id)!.bindings } : entry);
    if (what !== 'bindings' && links.studioCanvas) next.studioCanvas = links.studioCanvas;
    return { document: next, references: what !== 'bindings' ? { layout: rootTargets(next) } : {}, label: `relink ${what}` };
  } },
};

// MARK: - Malformed owners

/**
 * Node shapes for `authoredNodes`' walk (`registry.ts`), named for what it reads: a node's `id`, then its child lists
 * (`children`, or a `local-tabs` node's `tabs` and `blocks` and each one's `children`). The first group throws in the
 * oracle wherever it walks; the second is walked safely (a primitive has no `id` or lists; falsy `children` is no list;
 * `local-tabs` ignores `children`), so both implementations must accept it alike.
 */
const brokenNodes: Record<string, () => unknown> = {
  'null node': () => null,
  'children not a list': () => ({ ...tile(fresh('broken'), 'source-a'), children: { first: tile(fresh('inner'), 'source-a') } }),
  'children a string': () => ({ ...tile(fresh('broken'), 'source-a'), children: 'x' }),
  'null child': () => ({ ...tile(fresh('broken'), 'source-a'), children: [tile(fresh('inner'), 'source-a'), null] }),
  'tabs not a list': () => ({ id: fresh('tabs'), type: 'local-tabs', tabs: {} }),
  'null tab': () => ({ id: fresh('tabs'), type: 'local-tabs', tabs: [null] }),
  'tab without children': () => ({ id: fresh('tabs'), type: 'local-tabs', tabs: [{ id: 'tab', title: 'Tab' }] }),
  'blocks not a list': () => ({ id: fresh('tabs'), type: 'local-tabs', tabs: [], blocks: 'x' }),
};
const walkableNodes: Record<string, () => unknown> = {
  'primitive node': () => 7,
  'falsy children': () => ({ ...tile(fresh('odd'), 'source-a'), children: '' }),
  'local-tabs children ignored': () => ({ id: fresh('tabs'), type: 'local-tabs', children: {}, tabs: [{ children: [] }] }),
};
const anyNode = (rng: Rng): [string, unknown] => {
  const [name, make] = pick(rng, Object.entries(rng() < 0.75 ? brokenNodes : walkableNodes));
  return [name, make()];
};
/** Owner shapes per owner list. `pages`, `modals` and `componentLibrary` entries are walked; the rest are only looked up. */
const brokenOwners: Record<'pages' | 'modals' | 'componentLibrary' | 'logicLibrary' | 'dataSources', (rng: Rng) => [string, unknown]> = {
  pages: rng => surface(rng, 'page'),
  modals: rng => surface(rng, 'modal'),
  componentLibrary: rng => {
    const id = fresh('owner'), base = { id, name: 'Broken', params: [{ name: 'label', kind: 'text' }], node: tile(fresh('body'), 'source-a') };
    const parameter = { param: 'label', nodeId: base.node.id, field: 'props/subtitle/value' }, source = { param: 'label', sourceId: 'own', field: 'entityId' };
    const shapes: Record<string, () => unknown> = {
      'null entry': () => null,
      'primitive entry': () => 'component',
      'entry without node': () => ({ id, name: 'Missing node' }),
      'node not walkable': () => ({ ...base, node: anyNode(rng)[1] }),
      'bindings not a list': () => ({ ...base, bindings: { 0: parameter } }),
      'null binding': () => ({ ...base, bindings: [null] }),
      'binding field not text': () => ({ ...base, bindings: [{ ...parameter, field: 7 }] }),
      'params not a list': () => ({ ...base, params: { label: 'text' }, bindings: [parameter] }),
      'null param': () => ({ ...base, params: [null], bindings: [parameter] }),
      'sources not a list': () => ({ ...base, sources: { own: 'source' }, bindings: [source] }),
      'null source': () => ({ ...base, sources: [null], bindings: [source] }),
      'flows not a list': () => ({ ...base, flows: 5, bindings: [source] }),
    };
    const [name, make] = pick(rng, Object.entries(shapes));
    return [name, make()];
  },
  logicLibrary: rng => pick(rng, [['null entry', null], ['primitive entry', 'logic'], ['entry without id', { name: 'No id', body: { type: 'literal', value: 1 } }],
    ['entry without body', { id: fresh('logic'), name: 'No body' }], ['null body', { id: fresh('logic'), name: 'Null body', body: null }]] as [string, unknown][]),
  dataSources: rng => pick(rng, [['null entry', null], ['primitive entry', 'source'], ['entry without id', { kind: 'ha-entity' }],
    ['entities not a list', { id: fresh('source'), kind: 'ha-entity', entities: {} }]] as [string, unknown][]),
};
function surface(rng: Rng, kind: string): [string, unknown] {
  const id = fresh(kind), shapes: Record<string, () => [string, unknown]> = {
    'null entry': () => ['null entry', null],
    'primitive entry': () => ['primitive entry', kind],
    'entry without components': () => ['entry without components', { id, title: 'No components' }],
    'components not a list': () => ['components not a list', { id, title: 'Odd', components: { 0: tile(fresh('tile'), 'source-a') } }],
    'node': () => { const [name, node] = anyNode(rng); return [name, { id, title: 'Broken node', components: [tile(fresh('tile'), 'source-a'), node] }]; },
  };
  return pick(rng, Object.values(shapes))();
}
type OwnerList = keyof typeof brokenOwners;
/**
 * A malformed owner added, put in place of an existing one, or a broken node put inside an existing owner's tree; or an
 * owner list replaced by something that is not a list. Unrelated to any binding, so the scoped reconciliation must notice
 * the shape itself rather than through a binding in scope.
 */
function malformed(document: Doc, rng: Rng): Step | undefined {
  const list = pick(rng, Object.keys(brokenOwners) as OwnerList[]), owners = (document as unknown as Record<string, unknown>)[list];
  const items = Array.isArray(owners) ? owners as unknown[] : [];
  const mode = pick(rng, ['add', 'add', 'replace', 'nest', 'list', 'bindings', 'field', 'field'] as const);
  // A list field of an owner or node (a surface's components, an entry's bindings, params, sources or flows, any node list)
  // given a string, a number or an object.
  if (mode === 'field') {
    const fields = [...nodeLists(document).map(({ path }) => path),
      ...(document.componentLibrary ?? []).flatMap((_, at) => ['bindings', 'params', 'sources', 'flows'].map(key => ['componentLibrary', at, key]))];
    if (!fields.length) return undefined;
    const path = pick(rng, fields), value = pick(rng, ['', 'list', 0, 5, {}, { 0: null }] as const);
    return { document: replaceAt(document, path, value), references: {}, label: `malformed ${fieldPointer(path)}: ${JSON.stringify(value)} for the list` };
  }
  if (mode === 'bindings') {
    const value = pick(rng, [{}, 'list', 5, '', null, 'a missing entry'] as const);
    const bindings = value === 'a missing entry' ? [...document.logicUseBindings ?? [], null] : value;
    return { document: { ...document, logicUseBindings: bindings } as unknown as Doc, references: {}, label: `malformed logicUseBindings: ${JSON.stringify(value)}` };
  }
  if (mode === 'list') {
    const value = pick(rng, [undefined, {}, 'list', '', 5] as const);
    const next = { ...document } as Record<string, unknown>;
    if (value === undefined) delete next[list]; else next[list] = value;
    return { document: next as unknown as Doc, references: {}, label: `malformed ${list}: ${value === undefined ? 'removed' : `${JSON.stringify(value)} for the list`}` };
  }
  if (mode === 'nest' && (list === 'pages' || list === 'modals' || list === 'componentLibrary')) {
    const holders = nodeLists(document).filter(({ path }) => path[0] === list);
    const [name, node] = anyNode(rng);
    if (list === 'componentLibrary' && (!holders.length || rng() < 0.4)) {
      if (!items.length) return undefined;
      const at = Math.floor(rng() * items.length);
      return { document: replaceAt(document, [list, at, 'node'], node), references: {}, label: `malformed ${list}/${at} node: ${name}` };
    }
    if (!holders.length) return undefined;
    const { path, value } = pick(rng, holders), nodes = [...value as unknown[]];
    if (rng() < 0.5 || !nodes.length) nodes.push(node); else nodes[Math.floor(rng() * nodes.length)] = node;
    return { document: replaceAt(document, path, nodes), references: {}, label: `malformed node in ${fieldPointer(path)}: ${name}` };
  }
  const [name, owner] = brokenOwners[list](rng);
  if (mode === 'replace' && items.length) {
    const at = Math.floor(rng() * items.length);
    return { document: replaceAt(document, [list, at], owner), references: {}, label: `malformed ${list}/${at} replaced: ${name}` };
  }
  return { document: { ...document, [list]: [...items, owner] } as Doc, references: {}, label: `malformed ${list} added: ${name}` };
}
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
const site = (error: unknown) => error instanceof Error ? error.stack?.split('\n').find(line => line.includes('/src/') || line.includes('/oracle/'))?.trim()
  .replace(/^at /, '').replace(/\(?\/.*\/(src|oracle)\//, '$1/').replace(/\)$/, '') ?? '?' : '?';
const where = (error: unknown) => error instanceof Error ? ` at ${site(error)}` : '';
const describeOutcome = (outcome: Outcome, before: Doc, candidate: Doc) => outcome.kind === 'error' ? `throws ${String(outcome.error)}${where(outcome.error)}`
  : outcome.document === before ? 'refuses' : outcome.document === candidate ? 'accepts as proposed' : 'accepts with reconciled metadata';
/** Each time the oracle threw and the scoped implementation refused instead (the documented deviation), by oracle message and site. */
const deviations = new Map<string, number>();
/**
 * Where `document` holds a value of a type its schema forbids at a place the boundaries read (as a pattern, `*` for each
 * index), or undefined: a root that is not a plain object, or a value other than a list where the schema requires one (the
 * owner lists and the bindings list, a surface's components, a component entry's bindings, params, sources and flows, a
 * node's children, a `local-tabs` node's tabs and blocks, and each tab's or block's children). Absent is allowed.
 */
function schemaInvalid(document: unknown): string | undefined {
  const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!plain(document) || ![Object.prototype, null].includes(Object.getPrototypeOf(document))) return '(root)';
  const list = (holder: Record<string, unknown>, key: string, at: string) => holder[key] !== undefined && !Array.isArray(holder[key]) ? `${at}/${key}` : undefined;
  const node = (value: unknown, at: string): string | undefined => {
    if (!plain(value)) return undefined;
    const areas = value.type === 'local-tabs' ? ['tabs', 'blocks'] : [];
    for (const key of areas) {
      const found = list(value, key, at);
      if (found) return found;
      for (const area of (value[key] ?? []) as unknown[]) {
        if (!plain(area)) continue;
        const inner = list(area, 'children', `${at}/${key}/*`) ?? children(area.children, `${at}/${key}/*/children`);
        if (inner) return inner;
      }
    }
    if (areas.length) return undefined;
    return list(value, 'children', at) ?? children(value.children, `${at}/children`);
  };
  const children = (value: unknown, at: string) => Array.isArray(value) ? value.reduce<string | undefined>((found, child) => found ?? node(child, `${at}/*`), undefined) : undefined;
  for (const key of ['pages', 'modals', 'componentLibrary', 'logicLibrary', 'dataSources', 'logicUseBindings']) {
    const found = list(document, key, '');
    if (found) return found;
  }
  for (const key of ['pages', 'modals']) for (const owner of (document[key] ?? []) as unknown[]) {
    if (!plain(owner)) continue;
    const found = list(owner, 'components', `/${key}/*`) ?? children(owner.components, `/${key}/*/components`);
    if (found) return found;
  }
  for (const entry of (document.componentLibrary ?? []) as unknown[]) {
    if (!plain(entry)) continue;
    for (const key of ['bindings', 'params', 'sources', 'flows']) {
      const found = list(entry, key, '/componentLibrary/*');
      if (found) return found;
    }
    const found = node(entry.node, '/componentLibrary/*/node');
    if (found) return found;
  }
  return undefined;
}
/** Each time the scoped implementation refused where the oracle accepted a schema-invalid document (the narrowed contract). */
const schemaRefusals = new Map<string, number>();
/** Agreement, or a description of the disagreement. */
function compare(before: Doc, candidate: Doc, scoped: Outcome, oracle: Outcome): string | undefined {
  if (oracle.kind === 'error') {
    // The one deviation: where the oracle throws, the scoped boundary refuses. A matching raw error is not agreement.
    if (scoped.kind === 'result' && scoped.document === before) {
      const key = `${String(oracle.error)} at ${site(oracle.error)}`;
      deviations.set(key, (deviations.get(key) ?? 0) + 1);
      return undefined;
    }
  } else if (scoped.kind === 'result') {
    const refused = scoped.document === before, oracleRefused = oracle.document === before;
    if (refused === oracleRefused && sameJson(scoped.document, oracle.document)) return undefined;
    // The narrowed contract: the scoped boundary may also refuse a candidate or revision holding a schema-invalid type.
    const invalid = refused && !oracleRefused ? schemaInvalid(candidate) ?? schemaInvalid(before) : undefined;
    if (invalid) {
      schemaRefusals.set(invalid, (schemaRefusals.get(invalid) ?? 0) + 1);
      return undefined;
    }
    if (refused === oracleRefused) {
      const canvas = sameJson(scoped.document.studioCanvas, oracle.document.studioCanvas) ? 'same studioCanvas' : 'different studioCanvas';
      return `both ${refused ? 'refuse' : 'accept'} but outputs differ (${canvas})`;
    }
  }
  return `scoped ${describeOutcome(scoped, before, candidate)}, oracle ${describeOutcome(oracle, before, candidate)}`;
}

const adoptions = { compiled: 0, copied: 0 };
interface Disagreement { readonly seed: number; readonly fixture: string; readonly step: number; readonly edit: string; readonly detail: string }
function sequence(seed: number, steps: number, fixture = Object.keys(fixtures)[seed % Object.keys(fixtures).length]): { disagreement?: Disagreement; accepted: number; refused: number } {
  const rng = random(seed);
  counter = 0;
  let before = fixtures[fixture]();
  links = fixture.startsWith('unlinked draft') ? fixtures['automatic with canvas']()
    : fixture === 'unlinked component draft' ? compileCompositionDocument(componentDocument()).document : before;
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
        // Both accepted with the same JSON. Where each built its own result, the sequence carries on with the scoped one;
        // the oracle records it as the descendant of its own result (an edit that changes nothing), so its history of
        // validated revisions (which lets an edit back to a descendant through) matches the one the scoped boundary keeps.
        if (oracle.kind === 'result' && oracle.document !== scoped.document && oracleEdit(oracle.document, scoped.document) !== scoped.document) {
          throw new Error('The oracle did not take an identical revision as its own result.');
        }
        accepted++; before = scoped.document; history.push(before); break;
      }
      refused++;
      // A refused candidate is the caller's to change and offer again; not one the oracle accepted (a schema-invalid shape),
      // which its history now holds as a descendant of `before`.
      if (oracle.kind === 'result' && oracle.document !== before) break;
      if (rng() >= 0.35 || !retry(before, candidate, rng, history)) break;
      label = `${label} (refused, then mutated in place and resubmitted)`;
    }
    // Sometimes the caller installs a revision that never passed this boundary. A reload compiles the stored authored draft
    // and installs it as is, so any candidate the compiler accepts can become `before`, refused here or not. Otherwise it is
    // a copy of the current revision sharing its objects, sometimes with one owner list rebuilt around the same elements.
    // Neither implementation has indexed either, while both have seen their objects. (A `before` the compiler rejects is
    // not covered by the contract.)
    if (rng() < 0.04) {
      if (candidate !== before && compiles(candidate)) {
        if (process.env.EDIT_ORACLE_TRACE) process.stdout.write(`Edit oracle trace: seed ${seed} step ${index}: install the candidate, which compiles\n`);
        adoptions.compiled++;
        before = candidate; history.push(before);
      } else {
        const copy: Record<string, unknown> = { ...before }, lists = ['pages', 'modals', 'componentLibrary', 'logicUseBindings', 'logicLibrary']
          .filter(key => Array.isArray(copy[key]));
        const rebuilt = lists.length && rng() < 0.5 ? pick(rng, lists) : undefined;
        if (rebuilt) copy[rebuilt] = [...copy[rebuilt] as unknown[]];
        if (process.env.EDIT_ORACLE_TRACE) process.stdout.write(`Edit oracle trace: seed ${seed} step ${index}: adopt a copy of the revision${rebuilt ? ` with ${rebuilt} rebuilt` : ''}\n`);
        adoptions.copied++;
        before = copy as unknown as CompositionDocument; history.push(before);
      }
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
    process.stdout.write(`Edit oracle: ${seeds} seeds from ${from}, ${steps} steps; ${accepted} accepted and ${refused} refused submissions; ${adoptions.compiled} compiled candidates and ${adoptions.copied} copies installed; deviations: ${[...deviations.values()].reduce((sum, count) => sum + count, 0)} oracle throws (scoped refuses), ${[...schemaRefusals.values()].reduce((sum, count) => sum + count, 0)} schema-invalid shapes refused (oracle accepts); ${disagreements.length} disagreeing seeds.\n`);
    if (process.env.EDIT_ORACLE_REPORT) {
      for (const found of disagreements) process.stdout.write(`Edit oracle disagreement: ${JSON.stringify(found)}\n`);
      for (const [error, count] of [...deviations].sort(([, left], [, right]) => right - left)) process.stdout.write(`Edit oracle deviation (oracle throws, scoped refuses) x${count}: ${error}\n`);
      for (const [shape, count] of [...schemaRefusals].sort(([, left], [, right]) => right - left)) process.stdout.write(`Edit oracle deviation (schema-invalid shape refused, oracle accepts) x${count}: ${shape}\n`);
    }
    expect(disagreements).toEqual([]);
  }, Math.max(120_000, seeds * steps * 50));
});

/**
 * A component body whose bound node sits in a `local-tabs` node's `children`: `resolveLogicAnchor` walks those, the authored
 * walk (`fieldAnchor`) does not, so the whole-document reconciliation re-addresses the component binding to the tabs node
 * on any edit. (The draft does not compile; a revision like it reached the boundary through a resubmitted candidate in seed
 * 2000862.)
 */
function untabbedBindings(): Doc {
  const document = compileCompositionDocument(componentDocument()).document;
  return { ...document, logicUseBindings: [], componentLibrary: document.componentLibrary!.map(entry => ({ ...entry,
    node: { id: 'tabs-1', type: 'local-tabs', tabs: [{ children: [] }], children: [entry.node] } as unknown as typeof entry.node })) };
}
/** The same for an automatic binding: its use's tile sits in a page's `local-tabs` node's `children`. */
function untabbedUse(): Doc {
  const document = compiled(), [first, second] = document.pages[0].components;
  return replaceAt(document, ['pages', 0, 'components'], [{ id: 'tabs-1', type: 'local-tabs', tabs: [{ children: [] }], children: [first] }, second]);
}
const rename = (document: Doc): Doc => ({ ...document, name: `${document.name} again` });
const retitle = (document: Doc): Doc => replaceAt(document, ['pages', 0, 'title'], 'Retitled');

describe('edit oracle regressions', () => {
  let toast: ReturnType<typeof vi.spyOn>;
  beforeAll(() => { toast = vi.spyOn(toastManager, 'add').mockImplementation(() => ''); });
  afterAll(() => toast.mockRestore());

  // Found by long runs; pinned with their fixtures, since adding fixtures moves each seed to another one.
  it.each([
    // The scoped boundary carried its own rebuilt result forward; the oracle had never validated that object, so it did not
    // let a later edit back through the redo shortcut that the scoped boundary (rightly) took.
    ['already-aliased component parameter', 2000803, 40],
    // A revision whose component binding the whole-document reconciliation re-addresses on every edit.
    ['nested operand', 2000862, 40],
    // A compiler-accepted draft whose hidden binding names an unknown parameter: declaring its target deleted removes it.
    ['raw draft, hidden binding with an unknown parameter', 277, 14],
  ] as const)('%s, seed %i, %i steps', (fixture, seed, steps) => {
    expect(sequence(seed, steps, fixture).disagreement).toBeUndefined();
  });

  it('reconciles, on every edit, a binding whose stored address is not the one derived for its location', () => {
    const before = untabbedBindings(), edit = rename(before);
    // Each on its own copy, so neither sees what the other built.
    const oracle = oracleEdit(before, edit), own = untabbedBindings(), scoped = documentEdit(own, rename(own));
    expect(oracle).not.toBe(before);
    expect(oracle.componentLibrary![0].bindings).toEqual([{ param: 'source', nodeId: 'tabs-1', field: 'children/0/props/titleProviderId' }]);
    expect(scoped).toEqual(oracle);
  });

  it('reconciles, on every edit, a use whose stored address is not the one derived for its location', () => {
    // Re-addressed to the tabs node, the use would run through `children`, which the resolution rejects: every edit refuses.
    const before = untabbedUse(), own = untabbedUse();
    expect(oracleEdit(before, rename(before))).toBe(before);
    expect(documentEdit(own, rename(own))).toBe(own);
  });

  it('certifies a binding by its own address, not only by its target', () => {
    // The same body object first under a binding at its fixed point, then under one through the tabs node at the same
    // target: the certification remembered for the first must not answer for the second.
    const settled = tabbedComponentDraft('tile'), body = settled.componentLibrary![0].node;
    expect(documentEdit(settled, rename(settled)).componentLibrary![0].bindings).toEqual(settled.componentLibrary![0].bindings);
    const before = tabbedComponentDraft('tabs', body), own = tabbedComponentDraft('tabs', body);
    const oracle = oracleEdit(before, rename(before));
    expect(oracle.componentLibrary![0].bindings).toEqual([{ param: 'source', nodeId: 'inner-tile', field: 'props/titleProviderId' }]);
    expect(documentEdit(own, rename(own))).toEqual(oracle);
  });

  it('removes a binding naming an unknown parameter when its target is declared deleted', () => {
    const before = hiddenBindingDraft('missing'), own = hiddenBindingDraft('missing'), subtitle = ['componentLibrary', 0, 'node', 'props', 'subtitle'];
    // A rename declaring the slot that holds the binding's target deleted (as seed 277 does).
    const edit = rename;
    const references = { relocated: new Map([[fieldPointer(subtitle), []]]) };
    const oracle = oracleEdit(before, edit(before), references), scoped = documentEdit(own, edit(own), references);
    expect(oracle).not.toBe(before);
    expect(oracle.componentLibrary![0].bindings!.map(binding => binding.param)).toEqual(['source']);
    expect(scoped).toEqual(oracle);
  });

  // The one deviation: where the oracle throws on a shape it cannot read, the scoped boundary refuses (and never throws).
  const unreadable = (before: Doc, edit: Doc) => {
    expect(() => oracleEdit(before, edit)).toThrow(TypeError);
    expect(documentEdit(before, edit)).toBe(before);
  };

  it('refuses a candidate whose component library cannot be read for links, before anything reads it', () => {
    const before = { ...compiled(), logicUseBindings: [] };
    expect(compiles(before)).toBe(true);
    for (const componentLibrary of [[null], {}, 'list']) unreadable(before, { ...before, componentLibrary } as unknown as Doc);
  });

  it('refuses a candidate whose bindings list cannot be read where the revision holds bindings', () => {
    const before = compiled();
    for (const logicUseBindings of [{}, 'list', 5, [...before.logicUseBindings!, null]]) unreadable(before, { ...before, logicUseBindings } as unknown as Doc);
  });

  it('refuses an edit that is not a plain object, before reading it', () => {
    const before = compiled(), unlinked = { ...before, logicUseBindings: [] };
    for (const edit of [null, undefined, 5, 'document', [], new Map()]) {
      expect(documentEdit(before, edit as unknown as Doc)).toBe(before);
      expect(documentEdit(unlinked, edit as unknown as Doc)).toBe(unlinked);
    }
  });

  it('decides, in editSubtrees, a candidate the authored walk cannot take without walking it', () => {
    const before = compiled(), page = before.pages[0];
    const candidates = [{ ...before, componentLibrary: [null] }, { ...before, componentLibrary: {} }, { ...before, pages: [null] }, { ...before, pages: 'list' },
      { ...before, pages: [{ ...page, components: 5 }] }, { ...before, pages: [{ ...page, components: [{ ...page.components[0], children: 5 }] }] }, null];
    for (const candidate of candidates) expect(editSubtrees(before, candidate as unknown as Doc)).toBe(before);
  });

  it('counts a refusal of a schema-invalid shape the oracle accepts as the narrowed deviation, and nothing else', () => {
    // A component entry whose bindings are a string: the oracle's `for...of` takes it as empty, the scoped boundary refuses.
    const before = compiled(), entry = { ...compileCompositionDocument(componentDocument()).document.componentLibrary![0], bindings: '' };
    const invalid = { ...before, componentLibrary: [entry] } as unknown as Doc, tallied = () => [...schemaRefusals.values()].reduce((sum, count) => sum + count, 0);
    for (const [from, edit] of [[before, invalid], [invalid, rename(invalid)]] as const) {
      const scoped = run(() => documentEdit(from, edit)), oracle = run(() => oracleEdit(from, edit)), count = tallied();
      expect(scoped).toEqual({ kind: 'result', document: from });
      expect(oracle.kind === 'result' && oracle.document !== from).toBe(true);
      expect(compare(from, edit, scoped, oracle)).toBeUndefined();
      expect(tallied()).toBe(count + 1);
    }
    // The same divergence over schema-valid documents stays a disagreement.
    const valid = rename(before);
    expect(compare(before, valid, { kind: 'result', document: before }, { kind: 'result', document: valid })).toBeDefined();
  });

  it('refuses every edit to a revision whose bindings value is not a list', () => {
    // Installed by an edit both accept (no bindings before, and no length to check); the oracle then throws on every edit.
    const empty = { ...compiled(), logicUseBindings: [] }, linked = framed(empty, [lifted(empty, slot(0))]);
    for (const logicUseBindings of [{}, 5]) {
      const before = { ...linked, logicUseBindings } as unknown as Doc;
      expect(oracleEdit(linked, before)).toBe(before);
      unreadable(before, retitle(before));
    }
  });

  it('reads a bindings value that is not a list as the oracle does where the revision holds none', () => {
    // Nothing reads the list for links here: one with a length is checked whole (and refused), one without passes.
    const before = framed({ ...compiled(), logicUseBindings: [] }, [lifted({ ...compiled(), logicUseBindings: [] }, slot(0))]);
    for (const logicUseBindings of [{}, 'list', 5]) {
      const edit = { ...before, logicUseBindings } as unknown as Doc, oracle = oracleEdit(before, edit);
      expect(documentEdit(before, edit)).toBe(oracle === before ? before : edit);
      expect(oracle === before || oracle === edit).toBe(true);
    }
  });

  it('lets an edit back to a descendant through on each implementation\'s own history, across a rebuilt result', () => {
    for (const edit of [documentEdit, oracleEdit]) {
      const first = untabbedBindings(), proposed = rename(first), rebuilt = edit(first, proposed);
      expect(rebuilt).not.toBe(proposed);
      expect(rebuilt).not.toBe(first);
      const later = retitle(rebuilt);
      expect(edit(rebuilt, later)).toBe(later);
      // Back to `first`, then forward again to `later` in one step: `later` descends from `first` through validated edits.
      expect(edit(first, later)).toBe(later);
    }
  });
});
