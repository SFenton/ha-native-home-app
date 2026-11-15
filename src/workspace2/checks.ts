import type { CompositionDocument } from '../shared/composition/schema';
import { compileCompositionDocument } from '../shared/composition/compiler';
import { CompositionValidationError, type CompositionIssue } from '../shared/composition/json';
import { compositionWarnings } from '../shared/composition/lints';
import { formatCompositionIssue } from '../shared/composition/workspace';
import { buildDocumentIndex, type SelectionKey } from '../preview2/model';
import { buildOutline, collectLinks } from './outline';
import { tabGroups } from './capacity';

/** One row of the Checks popover: a sentence, where it is, and what choosing it selects. */
export interface CheckRow { id: string; sentence: string; place: string; select?: SelectionKey }
export interface Checks { problems: CheckRow[]; suggestions: CheckRow[] }

const unescape = (part: string) => part.replace(/~1/g, '/').replace(/~0/g, '~');

/** The path a JSON pointer names, without a leading `document`. */
export function pointerPath(pointer: string): (string | number)[] {
  const parts = pointer.split('/').filter(Boolean).map(unescape);
  if (parts[0] === 'document') parts.shift();
  return parts.map(part => /^\d+$/.test(part) ? Number(part) : part);
}

/**
 * The place a document path stands for, by name: the deepest node, page or sheet the path passes through, else the
 * part of the project it belongs to.
 */
export function placeOf(document: CompositionDocument, path: readonly (string | number)[]): { place: string; select?: SelectionKey } {
  const index = buildDocumentIndex(document);
  for (let length = path.length; length > 0; length--) {
    const key = index.keyAt(path.slice(0, length));
    const entry = key ? index.get(key) : undefined;
    if (!entry) continue;
    if (entry.node) return { place: entry.node.title, select: entry.key };
    if (entry.kind === 'page' || entry.kind === 'modal') return { place: (document[entry.kind === 'page' ? 'pages' : 'modals'][entry.path[1] as number]).title, select: entry.key };
    if (entry.kind === 'tab') return { place: document.navigation.tabs[entry.path[2] as number]?.label ?? 'Tabs', select: entry.key };
  }
  const part = path[0];
  const names: Record<string, string> = { navigation: 'Tabs', dataSources: 'Data', localState: 'Local State', bootstrap: 'App Launch', extensions: 'Links', liveActivities: 'Live Activities', theme: 'Wallpaper', assets: 'Wallpaper', name: 'Project' };
  return { place: names[String(part)] ?? 'Project' };
}

/** The compiler's issues for a document, or none when it compiles. */
export function compilerIssues(document: CompositionDocument): CompositionIssue[] {
  try { compileCompositionDocument(document); return []; }
  catch (error) { if (error instanceof CompositionValidationError) return error.issues; throw error; }
}

/** What each compiler code means in the Studio's words. Edit as JSON keeps the compiler's own wording and its pointers. */
const problemWords: Record<CompositionIssue['code'], string> = {
  unsupported_schema: 'This document is not a version the app reads.',
  unknown_field: 'This setting is not supported. Remove it.',
  unknown_variant: 'This choice is not supported.',
  missing_required: 'A required value is missing.',
  invalid_value: 'This value is not allowed.',
  duplicate_key: 'This key appears twice.',
  limit_exceeded: 'There are more of these than the app allows.',
  duplicate_id: 'Two items use the same ID.',
  invalid_reference: 'This points to something that is not there.',
  binding_type: 'The data does not match what this reads.',
  invalid_combination: 'These settings do not work together.',
  capability_manifest_mismatch: 'The capability list is out of date.',
  unsupported_capability: 'The app does not support this yet.',
  asset_integrity: 'An image is missing or has changed.',
};

/** A compiler sentence with its pointer replaced by the place name (spec 5.8). */
export function sentenceFor(document: CompositionDocument, issue: CompositionIssue): { sentence: string; place: string; select?: SelectionKey } {
  const { place, select } = placeOf(document, pointerPath(issue.pointer));
  return { sentence: `${place}: ${problemWords[issue.code] ?? formatCompositionIssue(issue).replace(/^[^:]*:\s*/, '')}`, place, select };
}

/** Problems (they block publishing) and Suggestions (lints). */
export function runChecks(document: CompositionDocument): Checks {
  const problems = compilerIssues(document).map((issue, at) => ({ id: `problem-${at}`, ...sentenceFor(document, issue) }));
  const suggestions: CheckRow[] = [];
  const outline = buildOutline(document);
  for (const surface of outline.noWayIn) {
    const title = (surface.kind === 'page' ? document.pages : document.modals).find(item => item.id === surface.id)?.title ?? surface.id;
    suggestions.push({ id: `no-way-in-${surface.kind}-${surface.id}`, sentence: `${title} has no way in.`, place: title, select: `${surface.kind}:${surface.id}` });
  }
  const links = collectLinks(document);
  for (const page of document.pages) {
    if (page.navigation.type === 'navigation-columns' && !links.some(link => link.from.kind === 'page' && link.from.id === page.id && link.to.kind === 'page'))
      suggestions.push({ id: `columns-${page.id}`, sentence: `${page.title} opens pages beside it but links to none.`, place: page.title, select: `page:${page.id}` });
  }
  for (const modal of document.modals) {
    if (!modal.presentation.adaptive) continue;
    const presenters = links.filter(link => link.to.kind === 'modal' && link.to.id === modal.id).map(link => document.pages.find(page => page.id === link.from.id));
    if (presenters.length && presenters.every(page => page?.navigation.type !== 'navigation-columns'))
      suggestions.push({ id: `adaptive-${modal.id}`, sentence: `${modal.title} opens beside a list, but its page does not.`, place: modal.title, select: `modal:${modal.id}` });
  }
  const bar = tabGroups[0].capacity ?? 5;
  if (document.navigation.tabs.length > bar) suggestions.push({ id: 'tab-bar', sentence: tabGroups[0].full ?? `The tab bar holds ${bar}.`, place: 'Tabs', select: `tab:${document.navigation.tabs[bar].id}` });
  const owners = new Map<string, string>(), clashes = new Set<string>();
  for (const route of document.extensions?.routes ?? []) {
    for (const path of new Set([route.path, ...(route.aliases ?? [])])) {
      const first = owners.get(path);
      if (first === undefined) owners.set(path, route.id);
      else if (first !== route.id && !clashes.has(path)) {
        clashes.add(path);
        const page = document.pages.find(item => item.id === route.pageId);
        suggestions.push({ id: `link-clash-${path}`, sentence: `Two links use the path ${path}.`, place: page?.title ?? 'Links', select: page ? `page:${page.id}` : undefined });
      }
    }
  }
  for (const warning of compositionWarnings(document)) {
    const { place, select } = placeOf(document, pointerPath(warning.pointer));
    suggestions.push({ id: `warning-${warning.pointer}`, sentence: `${place}: ${warning.message}`, place, select });
  }
  return { problems, suggestions };
}
