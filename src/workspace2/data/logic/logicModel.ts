import { compilerIssuesOf, componentLocations, replaceAt, valueAt, type EditorPath } from '../../../composition-editor';
import type { CompositionDocument } from '../../../shared/composition/schema';
import type { Json } from '../../../shared/types';
import type { Operand } from '../../../shared/composition/expression';
import { logicWords } from './logicWords';
import { resolvedLogicValue, unlinkTemplate } from '../../logic-fields/templates';
import { resolveLogicUseBindings } from '../../../shared/composition/studio-logic/bindings';
import { replacePointer, resolveLogicAnchor } from '../../../shared/composition/studio-logic/anchors';
import { fieldSteps } from '../../../shared/composition/components';
import { fieldAnchor, fieldPointer, pointerPath } from '../../logic-fields/registry';
import { operandSlot, slotOperand } from '../../expr/tokens';
import { copySubtree, editSubtrees, editWithin, type ScopedEdit } from '../../editors/provenance';
import {
  argFits, expandLogic, MAX_LOGIC_ENTRIES, MAX_LOGIC_PARAMS, type LogicEntry,
} from '../../../shared/composition/logic-library';

/**
 * Logic templates as the Studio edits them (studio-logic proposal, section 1). The engine (`logic-library.ts`) owns the contract and the expansion; this
 * file owns what a person does with them: making, changing and deleting an entry, its settings (the UI's word for a parameter), its uses, and the
 * count-case starter. Every function is pure and returns a new document; none renders.
 */

// MARK: Kinds

/** What a setting takes, in the UI's words. `time` is a `number` of minutes that the editor draws as a time of day (`display: 'time'`); `person` is a `text` that holds a person's entity id, drawn as a person picker (`display: 'person'`). */
export const settingKinds = ['entity', 'person', 'text', 'number', 'time', 'value', 'condition'] as const;
export type SettingKind = typeof settingKinds[number];
/** One setting of an entry. */
export type LogicParam = LogicEntry['params'][number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
const isRecord = (value: unknown): value is Rec => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The kind a parameter is in the UI. */
export function settingKindOf(param: LogicParam): SettingKind {
  switch (param.kind) {
    case 'source-id': return 'entity';
    case 'text': return param.display === 'person' ? 'person' : 'text';
    case 'number': return param.display === 'time' ? 'time' : 'number';
    case 'operand': return 'value';
    case 'condition': return 'condition';
  }
}
/** The contract fields a UI kind writes. */
const paramKindOf = (kind: SettingKind): Pick<LogicParam, 'kind' | 'display'> =>
  kind === 'entity' ? { kind: 'source-id' } : kind === 'time' ? { kind: 'number', display: 'time' } : kind === 'person' ? { kind: 'text', display: 'person' } : kind === 'value' ? { kind: 'operand' } : { kind };

/** The most settings an entry holds and the most entries a library holds. */
export const MAX_SETTINGS = MAX_LOGIC_PARAMS;
export const MAX_TEMPLATES = MAX_LOGIC_ENTRIES;

/** What a freshly added setting is tried with, by kind. An Entity needs a source of the document, and a Person a person's entity id, so the caller passes it. */
export function defaultSample(kind: SettingKind, sourceId?: string): Json {
  switch (kind) {
    case 'entity': return sourceId ?? '';
    case 'person': return sourceId ?? 'person.example';
    case 'text': return 'On';
    case 'number': return 3;
    case 'time': return 22 * 60;
    case 'value': return { type: 'literal', value: 3 };
    case 'condition': return { type: 'viewer', isAdmin: true };
  }
}

// MARK: Library

/** The library of a document, never undefined. */
export const libraryOf = (document: Pick<CompositionDocument, 'logicLibrary'>): readonly LogicEntry[] => document.logicLibrary ?? [];
/** The entry with `id`. */
export const entryOf = (document: Pick<CompositionDocument, 'logicLibrary'>, id: string): LogicEntry | undefined => libraryOf(document).find(entry => entry.id === id);
/** The UI word for an entry's kind. */
export const kindWord = (entry: Pick<LogicEntry, 'kind'>): 'Value' | 'Condition' => entry.kind === 'operand' ? 'Value' : 'Condition';
/** Whether another entry fits. */
export const canAddEntry = (document: Pick<CompositionDocument, 'logicLibrary'>): boolean => libraryOf(document).length < MAX_TEMPLATES;
/** Whether the entry holds another setting. */
export const canAddSetting = (entry: LogicEntry): boolean => entry.params.length < MAX_SETTINGS;

const withLibrary = (document: CompositionDocument, library: LogicEntry[]): CompositionDocument => {
  if (library.length) return { ...document, logicLibrary: library };
  const { logicLibrary: _gone, ...rest } = document;
  return rest as CompositionDocument;
};
const mapEntry = (document: CompositionDocument, id: string, change: (entry: LogicEntry) => LogicEntry): CompositionDocument =>
  withLibrary(document, libraryOf(document).map(entry => entry.id === id ? change(entry) : entry));

/** The first id `base`, `base-2`, ... that no entry holds. */
export function freshId(document: Pick<CompositionDocument, 'logicLibrary'>, base: string): string {
  const taken = new Set(libraryOf(document).map(entry => entry.id));
  const root = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'logic';
  let id = root, count = 1;
  while (taken.has(id)) id = `${root}-${++count}`;
  return id;
}
/** `name`, or `name 2`, `name 3`, ... when another entry (not `except`) already has it. Names are 1 to 80 characters. */
export function freshName(document: Pick<CompositionDocument, 'logicLibrary'>, name: string, except?: string): string {
  const taken = new Set(libraryOf(document).filter(entry => entry.id !== except).map(entry => entry.name.toLowerCase()));
  const root = name.trim().slice(0, 74) || 'Logic Template';
  let next = root, count = 1;
  while (taken.has(next.toLowerCase())) next = `${root} ${++count}`;
  return next;
}
/** Whether `name` is free among the other entries, and 1 to 80 characters. */
export const nameFree = (document: Pick<CompositionDocument, 'logicLibrary'>, name: string, except?: string): boolean =>
  name.trim().length > 0 && name.trim().length <= 80 && !libraryOf(document).some(entry => entry.id !== except && entry.name.toLowerCase() === name.trim().toLowerCase());

/** The body a new entry starts with: a value that says nothing, or a test of the person that the author replaces. */
const startBody = (kind: LogicEntry['kind']): Rec => kind === 'operand' ? { type: 'literal', value: '' } : { type: 'viewer', isAdmin: true };

/** Adds an empty entry of a kind and says its id. */
export function addEntry(document: CompositionDocument, kind: 'value' | 'condition', name?: string): { document: CompositionDocument; id: string } {
  if (!canAddEntry(document)) throw new Error('A document holds at most 100 logic templates');
  const entryKind = kind === 'value' ? 'operand' : 'condition';
  const label = freshName(document, name ?? (kind === 'value' ? 'New Value' : 'New Condition'));
  const id = freshId(document, label);
  return { document: withLibrary(document, [...libraryOf(document), { id, name: label, kind: entryKind, params: [], body: startBody(entryKind) }]), id };
}
/** Adds a finished entry (Save as Logic Template). */
export function addMadeEntry(document: CompositionDocument, entry: LogicEntry): CompositionDocument {
  if (!canAddEntry(document)) throw new Error('A document holds at most 100 logic templates');
  return withLibrary(document, [...libraryOf(document), entry]);
}
/** Renames an entry; a name another entry has is refused. */
export function renameEntry(document: CompositionDocument, id: string, name: string): CompositionDocument {
  if (!nameFree(document, name, id)) throw new Error('Choose a name no other logic template has.');
  return mapEntry(document, id, entry => ({ ...entry, name: name.trim() }));
}
/** A copy of an entry with its own id and name. */
export function duplicateEntry(document: CompositionDocument, id: string): { document: CompositionDocument; id: string } {
  const entry = entryOf(document, id);
  if (!entry) throw new Error('That logic template is gone.');
  if (!canAddEntry(document)) throw new Error('A document holds at most 100 logic templates');
  const name = freshName(document, `${entry.name} Copy`);
  const copyId = freshId(document, name);
  return { document: editSubtrees(document, withLibrary(document, [...libraryOf(document), { ...copySubtree(entry), id: copyId, name }])), id: copyId };
}
/** Replaces an entry's body. */
export const setBody = (document: CompositionDocument, id: string, body: Rec): CompositionDocument => mapEntry(document, id, entry => ({ ...entry, body }));

// MARK: Settings

/** The names of the settings the body marks with a hole. */
export function holesIn(body: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!isRecord(value)) return;
    if (value.type === 'hole' && typeof value.name === 'string') { found.add(value.name); return; }
    Object.values(value).forEach(walk);
  };
  walk(body);
  return found;
}
/** Whether the body uses a setting. */
export const settingUsed = (entry: LogicEntry, name: string): boolean => holesIn(entry.body).has(name);
/** `Setting 1`, `Setting 2`, ... the first name no setting has. */
const freshParamName = (entry: LogicEntry, kind: SettingKind): string => {
  const taken = new Set(entry.params.map(param => param.name));
  for (let at = 1; ; at += 1) { const name = `${kind}${at}`; if (!taken.has(name)) return name; }
};

/** Adds a setting. `sourceId` is the source an Entity setting is tried with (made by the caller with `ensureSource`). */
export function addSetting(document: CompositionDocument, id: string, kind: SettingKind, sourceId?: string): { document: CompositionDocument; name: string } {
  const entry = entryOf(document, id);
  if (!entry) throw new Error('That logic template is gone.');
  if (!canAddSetting(entry)) throw new Error('A logic template holds 8 settings.');
  const name = freshParamName(entry, kind);
  const label = `${kind[0].toUpperCase()}${kind.slice(1)}${entry.params.some(param => param.label?.startsWith(kind[0].toUpperCase() + kind.slice(1))) ? ` ${entry.params.length + 1}` : ''}`;
  const param: LogicParam = { name, ...paramKindOf(kind), label, sample: defaultSample(kind, sourceId) };
  return { document: mapEntry(document, id, held => ({ ...held, params: [...held.params, param] })), name };
}
/** Changes a setting's label, kind or Try With. A kind changes only while the body does not use the setting. */
export function updateSetting(document: CompositionDocument, id: string, name: string, change: { label?: string; kind?: SettingKind; sample?: Json }): CompositionDocument {
  return mapEntry(document, id, entry => ({
    ...entry,
    params: entry.params.map(param => {
      if (param.name !== name) return param;
      let next: LogicParam = { ...param };
      if (change.label !== undefined) next.label = change.label.trim().slice(0, 80) || undefined;
      if (change.kind !== undefined && change.kind !== settingKindOf(param)) {
        if (settingUsed(entry, name)) throw new Error('Kind can change only while the setting is not used in this template.');
        const { display: _display, ...rest } = next;
        next = { ...rest, ...paramKindOf(change.kind), sample: change.sample ?? defaultSample(change.kind) };
      } else if (change.sample !== undefined) next.sample = change.sample;
      if (next.label === undefined) delete next.label;
      return next;
    }),
  }));
}
const fillHoles = (value: unknown, name: string, replacement: unknown): unknown => {
  if (Array.isArray(value)) return value.map(item => fillHoles(item, name, replacement));
  if (!isRecord(value)) return value;
  if (value.type === 'hole' && value.name === name) return copySubtree(replacement);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillHoles(item, name, replacement)]));
};
/**
 * Removes a setting. Where the body used it, the setting's Try With value stands in; each use drops its value for it. The remaining uses keep drawing what they
 * drew only when they had given the Try With value, which is why Remove Setting is a change a person asks for by name.
 *
 * Only the uses' `args` change, and only along their paths, so every other object keeps its identity. Each dropped value is declared deleted: an automatic
 * binding or a component parameter binding that filled it in is removed with it, and every other link stays exactly as it was.
 */
export function removeSetting(document: CompositionDocument, id: string, name: string): CompositionDocument {
  const edit = settingRemovalEdit(document, id, name);
  return edit ? editWithin(document, edit) : document;
}

/**
 * Remove Setting as a scoped edit: it changes, and speaks for, the template's entry and each use's `args` only. Undefined when the template or the
 * setting is gone.
 */
export function settingRemovalEdit(document: CompositionDocument, id: string, name: string): ScopedEdit | undefined {
  const entry = entryOf(document, id);
  const param = entry?.params.find(item => item.name === name);
  if (!entry || !param) return undefined;
  const next = mapEntry(document, id, held => ({ ...held, params: held.params.filter(item => item.name !== name), body: fillHoles(held.body, name, param.sample ?? defaultSample(settingKindOf(param))) as Rec }));
  const deleted: EditorPath[] = [];
  const strip = (value: unknown, path: EditorPath): unknown => {
    if (Array.isArray(value)) {
      let changed = false;
      const items = value.map((item, at) => { const stripped = strip(item, [...path, at]); if (stripped !== item) changed = true; return stripped; });
      return changed ? items : value;
    }
    if (!isRecord(value)) return value;
    let out: Rec | undefined;
    if (value.type === 'logic-ref' && value.logicId === id && isRecord(value.args) && Object.hasOwn(value.args, name)) {
      const { [name]: _gone, ...args } = value.args;
      out = { ...value, args }; deleted.push([...path, 'args', name]);
    }
    for (const [key, item] of Object.entries(out ?? value)) {
      if (key === 'logicLibrary') continue;
      const stripped = strip(item, [...path, key]);
      if (stripped !== item) { out ??= { ...value }; out[key] = stripped; }
    }
    return out ?? value;
  };
  const at = document.logicLibrary!.findIndex(held => held.id === id);
  return { candidate: strip(next, []) as CompositionDocument, scope: [['logicLibrary', at], ...deleted.map(path => path.slice(0, -1))], references: { deleted }, retained: true };
}

/**
 * The tiles a link fills in, each counted once however many of its links are lost: a place on a page or sheet by its node; inside a tile template, the
 * template's node at each of the template's placements. A placement is every component-ref that shows the template on a page or sheet, also through
 * another template that holds it (one per placement of that one), so two linked tiles in a template shown twice are four tiles.
 */
function filledTiles(before: CompositionDocument, after: CompositionDocument): number {
  const tiles = new Set<string>(), located = componentLocations(before, true), placements = new Map<string, string[]>();
  const placementsOf = (componentId: string, visiting: ReadonlySet<string> = new Set()): string[] => {
    const known = placements.get(componentId);
    if (known) return known;
    if (visiting.has(componentId)) return [];
    const inside = new Set([...visiting, componentId]);
    const found = located.filter(({ node }) => node.type === 'component-ref' && node.componentId === componentId).flatMap(({ node, path }) =>
      path[0] === 'componentLibrary' ? placementsOf(before.componentLibrary![Number(path[1])].id, inside).map(outer => `${outer}/${node.id}`) : [`${path[0]}:${path[1]}/${node.id}`]);
    placements.set(componentId, found);
    return found;
  };
  const kept = new Set((after.logicUseBindings ?? []).map(binding => JSON.stringify(binding)));
  for (const binding of before.logicUseBindings ?? []) {
    if (kept.has(JSON.stringify(binding))) continue;
    if (binding.use.kind === 'component') for (const place of placementsOf(binding.use.id)) tiles.add(`${place}:${binding.use.nodeId ?? ''}`);
    else tiles.add(binding.use.kind === 'document' ? 'document' : `${binding.use.kind}:${binding.use.id}:${binding.use.nodeId ?? binding.use.field}`);
  }
  for (const entry of before.componentLibrary ?? []) {
    const held = new Set((after.componentLibrary?.find(next => next.id === entry.id)?.bindings ?? []).map(binding => JSON.stringify(binding)));
    for (const binding of entry.bindings ?? []) if (!held.has(JSON.stringify(binding)))
      for (const place of placementsOf(entry.id)) tiles.add(`${place}:${binding.nodeId ?? ''}`);
  }
  return tiles.size;
}

/**
 * Remove Setting as the editor asks it: the declared removal, and how many tiles that fill the setting in lose that value (0 when no link fills it in,
 * so nothing needs asking). `document` comes back unchanged when the setting is gone or the removal cannot keep the other links.
 */
export function removeSettingPlan(document: CompositionDocument, id: string, name: string): { document: CompositionDocument; tiles: number } {
  const next = removeSetting(document, id, name);
  // The Try With value stands in for the setting; one the template cannot read leaves a document that does not compile, which is refused, never repaired.
  if (next !== document && compilerIssuesOf(next).length && !compilerIssuesOf(document).length) {
    const param = entryOf(document, id)?.params.find(item => item.name === name);
    throw new Error(logicWords.removeNeedsSample(param?.label ?? name));
  }
  return { document: next, tiles: next === document ? 0 : filledTiles(document, next) };
}

// MARK: Uses

/** One use: where it stands in the draft, and the words that say where. */
export interface LogicUse {
  /** The use's path in the draft. */
  path: EditorPath;
  /** The page, sheet or template it is on. */
  place: string;
  /** The node it is on, when it is on one. */
  nodeId?: string;
  nodeTitle?: string;
  /** The field, in words ("Subtitle"). */
  field: string;
  /** Set when the use is inside a template's body (a tile template): the place reads "Vent Tile · Template". */
  inTemplate?: boolean;
  /** Set when the use is inside another logic template's body: the id of that template ("Door Words · Logic Template"). */
  inLogic?: string;
}
const fieldName = (key: string): string => key === 'visibleWhen' ? 'Only Show When' : key === 'enabledWhen' ? 'Only Enabled When' : key.replace(/([A-Z])/g, ' $1').replace(/^\w/, letter => letter.toUpperCase());
const KEYS_IGNORED = new Set(['value', 'expr', 'args', 'of', 'then', 'otherwise', 'when', 'left', 'right', 'cases', 'items', 'in', 'fields']);
const isNodeLike = (value: unknown): value is Rec & { id: string } => isRecord(value) && typeof value.id === 'string' && typeof value.type === 'string' && ('layout' in value || 'props' in value);

/** Every use of an entry, once per field it sits in (a field with two uses counts both), wherever it is in the draft, including the bodies of the other logic templates. */
export function usesOf(document: CompositionDocument, id: string): LogicUse[] {
  const out: LogicUse[] = [];
  const doc = document as unknown as Rec;
  const visit = (value: unknown, path: EditorPath, owner: { place: string; inTemplate?: boolean; inLogic?: string }, node: { id: string; title: string } | undefined, field: string): void => {
    if (Array.isArray(value)) { value.forEach((item, at) => visit(item, [...path, at], owner, node, field)); return; }
    if (!isRecord(value)) return;
    if (value.type === 'logic-ref' && value.logicId === id) { out.push({ path, place: owner.place, nodeId: node?.id, nodeTitle: node?.title, field: fieldName(field || 'value'), inTemplate: owner.inTemplate, inLogic: owner.inLogic }); }
    const here = isNodeLike(value) ? { id: value.id, title: String(value.title ?? value.id) } : node;
    for (const [key, child] of Object.entries(value)) {
      visit(child, [...path, key], owner, here, KEYS_IGNORED.has(key) || /^\d+$/.test(key) ? field : key);
    }
  };
  for (const [key, list] of Object.entries(doc)) {
    if (!Array.isArray(list)) continue;
    list.forEach((item, at) => {
      if (!isRecord(item)) return;
      if (key === 'logicLibrary') { if (item.id !== id) visit(item.body, [key, at, 'body'], { place: String(item.name ?? item.id), inLogic: String(item.id) }, undefined, ''); return; }
      const place = key === 'componentLibrary' ? String(item.name ?? item.id ?? 'Template') : String(item.title ?? item.id ?? key);
      visit(item, [key, at], { place, inTemplate: key === 'componentLibrary' }, undefined, '');
    });
  }
  return out;
}
/** How many uses an entry has. */
export const useCount = (document: CompositionDocument, id: string): number => usesOf(document, id).length;
/** How many uses every entry has, in one walk of the draft (the Data panel draws a row for each, so it must not walk once per row). */
export function useCounts(document: CompositionDocument): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isRecord(value)) return;
    if (value.type === 'logic-ref' && typeof value.logicId === 'string') { counts.set(value.logicId, (counts.get(value.logicId) ?? 0) + 1); }
    Object.values(value).forEach(visit);
  };
  for (const [key, list] of Object.entries(document as unknown as Rec)) {
    if (!Array.isArray(list)) continue;
    if (key === 'logicLibrary') { for (const entry of list) if (isRecord(entry)) visit(entry.body); } else visit(list);
  }
  return counts;
}

/** The value a use gives a setting that it does not set: the Try With value, or the kind's own starting value. */
function argFor(param: LogicParam, sourceFallback?: string): Json {
  if (param.sample !== undefined) return param.sample;
  return defaultSample(settingKindOf(param), sourceFallback);
}
/** The arguments of a new use: every setting at its Try With value. */
export function defaultArgs(entry: LogicEntry, fallbackSource?: string): Record<string, Json> {
  return Object.fromEntries(entry.params.map(param => [param.name, structuredClone(argFor(param, fallbackSource))]));
}
/** A use of an entry. */
export const makeUse = (entry: LogicEntry, args: Record<string, Json> = defaultArgs(entry)): { type: 'logic-ref'; logicId: string; args: Record<string, Json> } => ({ type: 'logic-ref', logicId: entry.id, args });
/** Whether a value is a use. */
export const isUse = (value: unknown): value is { type: 'logic-ref'; logicId: string; args: Record<string, Json> } => isRecord(value) && value.type === 'logic-ref' && typeof value.logicId === 'string' && isRecord(value.args);
/** Whether a value is a hole. */
export const isHole = (value: unknown): value is { type: 'hole'; name: string } => isRecord(value) && value.type === 'hole' && typeof value.name === 'string';

/** The settings of a use that name no data source (an Entity) or are missing: what Checks reports at the use ("Count has no value"). */
export function useProblems(document: CompositionDocument, use: { logicId: string; args: Record<string, unknown> }): string[] {
  const entry = entryOf(document, use.logicId);
  if (!entry) return [];
  const sources = new Set(document.dataSources.map(source => source.id));
  return entry.params.filter(param => {
    const arg = use.args[param.name];
    if (arg === undefined || arg === null) return true;
    return param.kind === 'source-id' && !(typeof arg === 'string' && sources.has(arg));
  }).map(param => param.label ?? param.name);
}

/** What `entry` sets, in words: "Sets Count, Word, When None". */
export const setsLine = (entry: LogicEntry): string => entry.params.length ? `Sets ${entry.params.map(param => param.label ?? param.name).join(', ')}` : 'Sets nothing';

// MARK: Working out

/** A use worked out into plain logic, or undefined when it cannot be. */
export function workedOut(document: CompositionDocument, use: unknown): unknown {
  const effective = resolvedLogicValue(document, use);
  try { return (expandLogic({ logicLibrary: libraryOf(document), x: effective }).document as { x: unknown }).x; } catch { return undefined; }
}
/** The entry's body with each setting at its Try With value: what the editor's result line works out. */
export function bodyWithSamples(document: CompositionDocument, entry: LogicEntry): unknown {
  return workedOut({ ...document, logicUseBindings: [], logicLibrary: [...libraryOf(document).filter(item => item.id !== entry.id), entry] }, makeUse(entry, defaultArgs(entry)));
}
/** Replaces the use at `path` with the logic it works out to, with this use's values written in (Unlink From Template). */
export function unlinkUse(document: CompositionDocument, path: EditorPath): CompositionDocument {
  return isUse(valueAt(document, path)) ? unlinkTemplate(document, path) : document;
}
/** Unlinks every use of an entry. */
export function unlinkAll(document: CompositionDocument, id: string): CompositionDocument {
  let next = document;
  // Each unlink works on the path it found; a use inside a use's arguments is worked out with its parent.
  for (const use of usesOf(document, id).sort((a, b) => b.path.length - a.path.length)) next = unlinkUse(next, use.path);
  return next;
}
/** Deletes an entry; with `unlink`, each use keeps its logic. */
export function deleteEntry(document: CompositionDocument, id: string, unlink = true): CompositionDocument {
  const base = unlink ? unlinkAll(document, id) : document;
  if (unlink && usesOf(base, id).length) return document;
  return editSubtrees(base, withLibrary(base, libraryOf(base).filter(entry => entry.id !== id)), { deleted: [['logicLibrary', libraryOf(base).findIndex(entry => entry.id === id)]] });
}

// MARK: Save as Logic Template

/** One thing the logic reads that a use could set. */
export interface ExtractRow { key: string; kind: 'entity' | 'person' | 'text' | 'number'; label: string; detail: string; value: string | number }
const isReadKey = (key: string) => key === 'sourceId';
/** A comparison of the person using the app with a person's entity id (the viewer's `personEntityId` equals a literal). */
const isViewerIs = (value: Rec): value is Rec & { right: { type: 'literal'; value: string } } => value.type === 'compare' && value.op === 'eq' && isRecord(value.left) && value.left.type === 'viewer'
  && value.left.field === 'personEntityId' && isRecord(value.right) && value.right.type === 'literal' && typeof value.right.value === 'string' && value.right.value.split('.')[0] === 'person';

/** What a piece of logic reads and states: each source it names, then each text or number it states, once each, up to 8. */
export function extractRows(body: unknown, nameOf: (sourceId: string) => string, personName: (entityId: string) => string = id => id): ExtractRow[] {
  const people = new Set<string>(), sources = new Set<string>(), texts = new Set<string>(), numbers = new Set<number>();
  const walk = (value: unknown, key = ''): void => {
    if (Array.isArray(value)) { value.forEach(item => walk(item, key)); return; }
    if (!isRecord(value)) { if (isReadKey(key) && typeof value === 'string') sources.add(value); return; }
    // "The person using the app is Sam": a comparison of the viewer's person with a person entity id.
    if (isViewerIs(value)) { people.add(value.right.value); return; }
    if (value.type === 'literal' && typeof value.value === 'string' && value.value.trim()) texts.add(value.value);
    else if (value.type === 'literal' && typeof value.value === 'number') numbers.add(value.value);
    for (const [name, child] of Object.entries(value)) walk(child, name);
  };
  walk(body);
  const rows: ExtractRow[] = [
    ...[...people].map(id => ({ key: `person:${id}`, kind: 'person' as const, label: personName(id), detail: 'Person', value: id })),
    ...[...sources].map(id => ({ key: `entity:${id}`, kind: 'entity' as const, label: nameOf(id), detail: 'Entity', value: id })),
    ...[...texts].map(text => ({ key: `text:${text}`, kind: 'text' as const, label: text.slice(0, 40), detail: 'Text', value: text })),
    ...[...numbers].map(number => ({ key: `number:${number}`, kind: 'number' as const, label: String(number), detail: 'Number', value: number })),
  ];
  return rows.slice(0, MAX_SETTINGS);
}
/** The body with a hole for each ticked row. */
function holeBody(body: unknown, ticked: readonly { row: ExtractRow; name: string }[]): unknown {
  const bySource = new Map(ticked.filter(item => item.row.kind === 'entity').map(item => [item.row.value as string, item.name]));
  const byPerson = new Map(ticked.filter(item => item.row.kind === 'person').map(item => [item.row.value as string, item.name]));
  const byText = new Map(ticked.filter(item => item.row.kind === 'text').map(item => [item.row.value as string, item.name]));
  const byNumber = new Map(ticked.filter(item => item.row.kind === 'number').map(item => [item.row.value as number, item.name]));
  const walk = (value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) return value.map(item => walk(item, key));
    if (!isRecord(value)) return isReadKey(key) && typeof value === 'string' && bySource.has(value) ? { type: 'hole', name: bySource.get(value) } : value;
    if (isViewerIs(value) && byPerson.has(value.right.value)) return { ...value, right: { ...value.right, value: { type: 'hole', name: byPerson.get(value.right.value) } } };
    if (value.type === 'literal' && typeof value.value === 'string' && byText.has(value.value)) return { ...value, value: { type: 'hole', name: byText.get(value.value) } };
    if (value.type === 'literal' && typeof value.value === 'number' && byNumber.has(value.value)) return { ...value, value: { type: 'hole', name: byNumber.get(value.value) } };
    return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, walk(child, name)]));
  };
  return walk(body);
}
/** The entry Save as Logic Template makes from `body`, with the values each use starts with; the use that replaces `body` is `makeUse(entry, args)`. */
export function entryFromLogic(document: CompositionDocument, kind: 'value' | 'condition', name: string, body: unknown, ticked: readonly ExtractRow[]): { entry: LogicEntry; args: Record<string, Json> } {
  const named = ticked.map((row, at) => ({ row, name: `${row.kind}${at + 1}` }));
  const params: LogicParam[] = named.map(({ row, name: paramName }) => ({ name: paramName, ...paramKindOf(row.kind), label: row.kind === 'entity' || row.kind === 'person' ? row.label : row.kind === 'number' ? `Number ${row.label}` : row.label, sample: row.value }));
  const entry: LogicEntry = { id: freshId(document, name), name: freshName(document, name), kind: kind === 'value' ? 'operand' : 'condition', params, body: holeBody(body, named) as Rec };
  return { entry, args: Object.fromEntries(named.map(({ row, name: paramName }) => [paramName, row.value])) };
}

/** Extraction reads resolved values and promotes dependent fields to explicit parameters of the new use. */
export function saveLogicTemplate(document: CompositionDocument, path: EditorPath, kind: 'value' | 'condition' | 'operand', name: string, ticked: readonly ExtractRow[]): CompositionDocument {
  const resolution = resolveLogicUseBindings(document), effective = resolution.document as CompositionDocument;
  const slot = valueAt(effective, path) as { type: string };
  const body = kind === 'value' ? slotOperand(slot) : slot;
  if (!body) throw new Error('This field has no logic to save.');
  const bodyPath = kind === 'value' && slot.type === 'expr' ? [...path, 'value'] : path;
  const base = fieldPointer(bodyPath), inside = (pointer: string) => pointer === base || pointer.startsWith(`${base}/`);
  const made = entryFromLogic(document, kind === 'condition' ? 'condition' : 'value', name, body, ticked);
  const targets = new Map<string, { kind: LogicParam['kind']; group: string }>();
  const automatic = resolution.bindings.flatMap((binding, index) => {
    if (!inside(binding.usePointer)) return [];
    const pointer = `${binding.usePointer}/args/${binding.argument}`;
    targets.set(pointer, { kind: 'source-id', group: `automatic:${document.logicUseBindings![index].from.field}` });
    return [{ index, pointer }];
  });
  const component = path[0] === 'componentLibrary' ? effective.componentLibrary![Number(path[1])] : undefined;
  const componentTargets = (component?.bindings ?? []).flatMap((binding, index) => {
    if (!binding.nodeId) return [];
    const target = resolveLogicAnchor(effective, { kind: 'component', id: component!.id, nodeId: binding.nodeId, field: fieldPointer(fieldSteps(binding.field)) });
    if (!target || !inside(target.pointer)) return [];
    const param = component!.params!.find(param => param.name === binding.param)!;
    const value = target.value;
    const kind = param.kind === 'source-id' ? 'source-id' : typeof value === 'string' ? 'text' : typeof value === 'number' ? 'number'
      : argFits('operand', value) ? 'operand' : argFits('condition', value) ? 'condition' : undefined;
    if (!kind) throw new Error('This field cannot be extracted without changing a per-place setting.');
    targets.set(target.pointer, { kind, group: `component:${binding.param}` });
    return [{ index, pointer: target.pointer, binding }];
  });
  const forced = new Map<string, string>(), groups = new Map<string, string>();
  let templateBody: unknown = made.entry.body;
  for (const [pointer, target] of targets) {
    let param = groups.get(target.group);
    if (!param) {
      let suffix = groups.size + 1;
      while (made.entry.params.some(param => param.name === `binding${suffix}`)) suffix++;
      param = `binding${suffix}`;
      groups.set(target.group, param);
      made.entry.params.push({ name: param, kind: target.kind });
      made.args[param] = valueAt(effective, pointerPath(pointer)) as Json;
    }
    forced.set(pointer, param);
    templateBody = replacePointer(templateBody, pointer.slice(base.length), { type: 'hole', name: param });
  }
  const used = holesIn(templateBody);
  made.entry = { ...made.entry, params: made.entry.params.filter(param => used.has(param.name)), body: templateBody as Rec };
  made.args = Object.fromEntries(made.entry.params.map(param => [param.name, made.args[param.name]]));
  if (made.entry.params.length > MAX_SETTINGS) throw new Error('This extraction needs more than eight settings to preserve its bindings.');
  const use = makeUse(made.entry, made.args);
  let next = replaceAt(addMadeEntry(document, made.entry), path, kind === 'value' ? operandSlot(use as unknown as Operand, slot) : use);
  const usePath = kind === 'value' ? [...path, 'value'] : path;
  const relocated = new Map<string, string[]>([[fieldPointer(path), [fieldPointer(path)]]]);
  for (const [pointer, param] of forced) relocated.set(pointer, [fieldPointer([...usePath, 'args', param])]);
  if (automatic.length) {
    const removed = new Set(automatic.map(binding => binding.index)), seen = new Set<string>();
    const bindings = document.logicUseBindings!.filter((_, index) => !removed.has(index));
    for (const binding of automatic) {
      const argument = forced.get(binding.pointer)!;
      if (seen.has(argument)) continue;
      seen.add(argument);
      bindings.push({ ...document.logicUseBindings![binding.index], logicId: made.entry.id, use: fieldAnchor(next, usePath), argument });
    }
    next = { ...next, logicUseBindings: bindings };
  }
  if (component) {
    const raw = document.componentLibrary![Number(path[1])];
    const generated = componentTargets.filter(target => target.index >= (raw.bindings?.length ?? 0)).map(target => {
      const anchor = fieldAnchor(next, [...usePath, 'args', forced.get(target.pointer)!]);
      return { ...target.binding, field: fieldSteps(anchor.field).join('/') };
    });
    if (generated.length) next = replaceAt(next, ['componentLibrary', path[1], 'bindings'], [...raw.bindings ?? [], ...generated]);
  }
  return editSubtrees(document, next, { relocated, deleted: [path], fields: new Map([[fieldPointer(path), [fieldPointer(path)]]]) });
}

// MARK: Count cases

/**
 * The three rules of a count: 0, 1 and more than 1, each with the text it gives. `count` is the operand the rules count. The count appears in each rule and once in
 * the last text, and an operand holds 64 nodes, so a count of up to 3 entities fits; more is the "more than one rule can hold" limit.
 */
export function countCases(count: Rec): { cases: { when: Rec; then: Rec }[]; otherwise: Rec } {
  const one = (op: 'eq' | 'above', value: number): Rec => ({ type: 'compare', op, left: copySubtree(count), right: { type: 'literal', value } });
  const shown: Rec = { type: 'format', pattern: '{a}', args: { a: copySubtree(count) } };
  return {
    cases: [
      { when: one('eq', 0), then: { type: 'literal', value: 'None' } },
      { when: one('eq', 1), then: { type: 'literal', value: 'One' } },
      { when: one('above', 1), then: copySubtree(shown) },
    ],
    otherwise: { type: 'literal', value: '' },
  };
}
/**
 * The most entities a count over `math` and `choose` holds. A count case writes its count four times and each entity costs four nodes, so a fourth entity passes
 * the 64-node operand limit.
 *
 * SEAM: this is the only place the count is built. When the one-node count operand (`sh.count@1`, a separate lane) lands, `howManyAre` returns that node, this
 * limit and `logicWords.howManyLimit` go, and `countCases` is unchanged.
 */
export const COUNT_MAX_ENTITIES = 3;
/** How many of the named Entity settings are in one of `states`: the sum of one 1 or 0 for each, which is `math` over `choose`, both operands the grammar already has. */
export function howManyAre(settings: readonly string[], states: readonly string[]): Rec {
  if (settings.length > COUNT_MAX_ENTITIES) throw new Error(logicWords.tooBig);
  const one = (name: string): Rec => ({
    type: 'choose',
    cases: [{ when: { type: 'state', sourceId: { type: 'hole', name }, path: ['state'], in: [...states] }, then: { type: 'literal', value: 1 } }],
    otherwise: { type: 'literal', value: 0 },
  });
  return settings.length === 1 ? one(settings[0]) : { type: 'math', op: 'add', args: settings.map(one) };
}
