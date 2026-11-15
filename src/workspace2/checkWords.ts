import type { CompositionDocument } from '../shared/composition/schema';
import type { CompositionIssue } from '../shared/composition/json';
import { buildDocumentIndex, type SelectionKey } from '../preview2/model';
import { valueAt } from '../composition-editor';
import { labelFor, mechanicalLabel, valueWords } from './labels';
import { typeName } from './util';
import { sourceName } from './dialogs/sources';
import { modelDomains } from './add/sources';
import { domainName } from './pickers/entities';
import type { DialogKey } from './projectDialogs';
import type { PanelKind } from './useWorkspace2';

/** Where choosing a Checks row goes: a selection in the preview, a Project panel, or a Project dialog. Every problem has one. */
export type Destination = { select: SelectionKey } | { panel: PanelKind } | { dialog: DialogKey };
type Path = readonly (string | number)[];

/** What an issue concerns: the thing by name, the field by its label (when the path names one), and where to go. */
export interface Target {
  place: string; go: Destination; select?: SelectionKey; field?: string; rel: Path; owner?: 'node' | 'other';
  /** The document path of the field the issue names, so choosing the row can focus it. */
  fieldPath?: Path;
}

const entityId = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const quoted = (value: unknown) => typeof value === 'string' && value && value.length <= 40 ? ` “${value}”` : '';

/** Keys of the rule and operand grammar the label map does not name, in a person's words. */
const plain: Record<string, string> = { of: 'Conditions', in: 'States', args: 'Operands', as: 'Read as', above: 'Above', below: 'Below', pattern: 'Text pattern', items: 'Items' };

/** The label a path ends in: authored when the map has it, else the key in words, with the list item it sits in. */
export function fieldName(owner: string, rel: Path): string | undefined {
  // A node's own kind is not a row the person edits, so a clash over it is about the node, not a field.
  if (owner !== 'project' && rel.length === 1 && rel[0] === 'type') return undefined;
  // A literal wrapper (`entityId/value`) is the same field as the wrapper.
  const parts = rel.slice(0, rel.length > 1 && rel.at(-1) === 'value' ? -1 : undefined);
  const authored = (parts.length ? labelFor(owner, parts) : undefined) ?? (parts.length !== rel.length ? labelFor(owner, rel) : undefined);
  if (authored) return authored.label;
  const keyAt = parts.map((part, at) => typeof part === 'string' ? at : -1).filter(at => at >= 0).at(-1);
  if (keyAt === undefined) return undefined;
  const item = [parts[keyAt - 1], parts[keyAt + 1]].find((part): part is number => typeof part === 'number');
  const key = String(parts[keyAt]);
  // An action's data fields are named by their key, so "v" reads as a field of the call, not a letter.
  const label = parts[keyAt - 1] === 'fields' ? `Data field “${key}”` : plain[key] ?? mechanicalLabel(key);
  return item === undefined ? label : `${label} (item ${item + 1})`;
}

/** A source's name for a sentence: its model or entity, with its id when two sources share the name. */
function sourcePlace(document: CompositionDocument, at: number): string {
  const source = document.dataSources[at];
  if (!source) return 'Data';
  const name = sourceName(source);
  return `Data source ${document.dataSources.filter(item => sourceName(item) === name).length > 1 ? `${name} (${source.id})` : name}`;
}

/** The part of the project a path outside every page, sheet and tab belongs to, by name, with where to edit it. */
function projectPart(document: CompositionDocument, path: Path): { place: string; go: Destination; rel: Path } {
  const [root, at, ...rest] = path;
  const index = typeof at === 'number' ? at : -1;
  switch (root) {
    case 'dataSources': return { place: sourcePlace(document, index), go: { dialog: 'data' }, rel: rest };
    case 'localState': return { place: document.localState?.[index] ? `Local state ${document.localState[index].id}` : 'Local State', go: { dialog: 'local-state' }, rel: rest };
    case 'liveActivities': return { place: document.liveActivities[index] ? `Live Activity ${document.liveActivities[index].title}` : 'Live Activities', go: { dialog: 'live' }, rel: rest };
    case 'bootstrap': return { place: 'App Launch', go: { dialog: 'launch' }, rel: path.slice(1) };
    case 'extensions': {
      const route = at === 'routes' ? document.extensions?.routes[Number(path[2])] : undefined;
      return { place: route ? `Link ${route.title}` : 'Links', go: { dialog: 'links' }, rel: route ? path.slice(3) : path.slice(1) };
    }
    case 'theme': case 'assets': return { place: 'Wallpaper', go: { panel: 'wallpaper' }, rel: path.slice(1) };
    case 'navigation': return at === 'chrome' ? { place: 'Header Buttons', go: { panel: 'header' }, rel: path.slice(2) } : { place: 'Tabs', go: { panel: 'tabs' }, rel: path.slice(1) };
    case 'name': return { place: 'Project name', go: { dialog: 'rename' }, rel: [] };
    default: return { place: 'Project', go: { dialog: 'json' }, rel: path };
  }
}

const blank = (value: unknown) => value === undefined || (typeof value === 'string' && value.trim() === '');

/** A node's name for a sentence: its title, or, when it has none, "Untitled action tile in <Section>" by where it sits. */
function nodePlace(document: CompositionDocument, key: SelectionKey, node: { type: string; title?: string }): string {
  const title = node.title?.trim();
  if (title) return title;
  const index = buildDocumentIndex(document);
  const holder = index.ancestors(key).reverse().map(at => {
    const entry = index.get(at);
    if (entry?.node) return entry.node.title?.trim();
    if (entry?.kind === 'page' || entry?.kind === 'modal') return document[entry.kind === 'page' ? 'pages' : 'modals'][entry.path[1] as number]?.title?.trim();
    return undefined;
  }).find(Boolean);
  return `Untitled ${typeName(node.type).toLowerCase()}${holder ? ` in ${holder}` : ''}`;
}

/** A page or sheet's name for a sentence: its title, or "Untitled page" with where it sits (the tab that opens it, else the one before it). */
function surfacePlace(document: CompositionDocument, kind: 'page' | 'modal', at: number): string {
  const surface = document[kind === 'page' ? 'pages' : 'modals'][at];
  const title = surface?.title?.trim();
  if (title) return title;
  const word = kind === 'page' ? 'page' : 'sheet';
  const tab = kind === 'page' ? document.navigation.tabs.find(item => item.pageId === surface?.id) : undefined;
  if (tab) return `Untitled ${word} in the ${tab.label} tab`;
  const before = document[kind === 'page' ? 'pages' : 'modals'][at - 1];
  return before ? `Untitled ${word} after ${before.title?.trim() || `Untitled ${word}`}` : `Untitled ${word}, the first ${word}`;
}

/** The thing a document path stands for, by name: the deepest node, page, sheet or tab it passes through, else the part of the project. */
export function targetOf(document: CompositionDocument, path: Path): Target {
  const index = buildDocumentIndex(document);
  for (let length = path.length; length > 0; length--) {
    const key = index.keyAt(path.slice(0, length));
    const entry = key ? index.get(key) : undefined;
    if (!entry) continue;
    const rel = path.slice(entry.path.length);
    if (entry.node) { const field = fieldName(entry.node.type, rel); return { place: nodePlace(document, entry.key, entry.node), select: entry.key, go: { select: entry.key }, rel, field, owner: 'node', fieldPath: field ? path : undefined }; }
    if (entry.kind === 'page' || entry.kind === 'modal') {
      const field = fieldName(entry.kind === 'page' ? 'page' : 'sheet', rel);
      return { place: surfacePlace(document, entry.kind, entry.path[1] as number), select: entry.key, go: { select: entry.key }, rel, field, owner: 'other', fieldPath: field ? path : undefined };
    }
    if (entry.kind === 'tab') { const field = fieldName('tab', rel); return { place: `Tab ${document.navigation.tabs[entry.path[2] as number]?.label ?? ''}`.trim(), select: entry.key, go: { select: entry.key }, rel, field, owner: 'other', fieldPath: field ? path : undefined }; }
  }
  const part = projectPart(document, path);
  const field = fieldName('project', part.rel);
  return { place: part.place, go: part.go, rel: part.rel, field, owner: 'other', fieldPath: field ? path : undefined };
}

/** An emptied or missing text field: "Title is empty. Add a title." */
const emptyWords = (field: string) => `${field} is empty. Add ${/^[aeiou]/i.test(field) ? 'an' : 'a'} ${field.charAt(0).toLowerCase()}${field.slice(1)}.`;

const tooMany = (value: unknown) => Array.isArray(value) ? (value.length ? 'has more items than the app allows. Remove some.' : 'is empty. Add at least one.')
  : typeof value === 'string' ? 'is too long. Shorten it.' : typeof value === 'number' ? 'is outside the range the app allows. Change the number.' : 'is nested too deeply. Simplify it.';

/**
 * What to change, as a plain sentence about the field: "<Field> ... <what to do>". Each compiler code has its own wording, and a few
 * clashes the compiler reports as one code (a wrong kind of entity, a tile that cannot sit where it is) say what clashes.
 */
export function wordsFor(document: CompositionDocument, issue: CompositionIssue, target: Target, path: Path): string {
  const value = valueAt(document, [...path]);
  const f = target.field;
  const kindRow = target.owner === 'node';
  switch (issue.code) {
    case 'unsupported_schema': return 'This project is saved in a version the app does not read. Open Edit as JSON and set the current version.';
    case 'unknown_field': return `${f ?? 'A setting'} is not one the app knows. Remove it.`;
    case 'unknown_variant': return `${f ?? 'A choice'}${quoted(value)} is not one the app supports. Pick one of the listed choices.`;
    case 'missing_required': return blank(value) && f ? emptyWords(f) : `${f ?? 'A required value'} is needed. Add it.`;
    case 'invalid_value': return blank(value) && f ? emptyWords(f) : `${f ?? 'A value'}${quoted(value)} is not allowed. Change it to a value the app accepts.`;
    case 'duplicate_key': return `${f ?? 'A setting'} appears twice. Delete one of them in Edit as JSON.`;
    case 'limit_exceeded': return `${f ?? 'A list'} ${tooMany(value)}`;
    case 'duplicate_id': return `${f ?? 'An ID'}${quoted(value)} is used twice. Give one of them a different name.`;
    case 'invalid_reference': return `${f ?? 'A link'}${quoted(value)} points to something that is not there. Choose one that exists.`;
    case 'binding_type': return `${f ?? 'The data'} reads data of the wrong kind for this. Choose a source or entity that fits.`;
    case 'capability_manifest_mismatch': return 'The list of features this project uses is out of date. Save it again.';
    case 'asset_integrity': return `${f ?? 'An image'} is missing or has changed. Choose the image again.`;
    case 'unsupported_capability':
      return issue.capability === 'sh.extended-tabs@1' ? 'The tab bar holds 5. Remove a tab.' : `${f ?? 'This'} needs a feature the app does not have yet. Remove it.`;
    case 'invalid_combination':
      if (typeof value === 'string' && entityId.test(value)) {
        // The entity a source's own model reads: say which kinds it takes.
        const source = path[0] === 'dataSources' && path[2] === 'inputs' && path[3] === 'entityId' ? document.dataSources[Number(path[1])] : undefined;
        const domains = source && modelDomains(source);
        if (domains) return `${f ?? 'The entity'}${quoted(value)} is not ${domains.map(domain => domainName(domain).toLowerCase()).join(' or ')}, which this data needs. Choose one that is.`;
      }
      if (typeof value === 'string' && entityId.test(value)) return `${f ?? 'The entity'}${quoted(value)} is the wrong kind of entity here. Choose an entity of the kind it asks for.`;
      if (target.rel.length === 1 && target.rel[0] === 'type') return 'It cannot go inside the item that holds it. Move it somewhere that accepts it, or change its kind.';
      if (!f) return 'This item does not fit where it is. Move it, or change its settings.';
      return kindRow && target.rel.length ? `${f} does not work with this kind. Remove it, or change the kind.` : `${f} does not fit with the other settings here. Change ${f}, or the setting it clashes with.`;
  }
}
