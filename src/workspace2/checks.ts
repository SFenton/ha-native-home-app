import { overlaysWithStackedControls, tabsWithCutTitles } from './layout/tabBarRules';
import type { CompositionDocument } from '../shared/composition/schema';
import { compilerIssuesOf, valueAt } from '../composition-editor';
import type { CompositionIssue } from '../shared/composition/json';
import { compositionWarnings } from '../shared/composition/lints';
import { targetOf, wordsFor, type Destination } from './checkWords';
import type { DialogKey } from './projectDialogs';
import type { PanelKind } from './useWorkspace2';
import { buildDocumentIndex, type SelectionKey } from '../preview2/model';
import { buildOutline, collectLinks } from './outline';
import { tabGroups } from './capacity';
import { labelFor } from './labels';
import { pendingUseWords } from './pendingUse';
import { customWithoutQuickLinks, quickLinksFirstPageOnly, tabsHiddenOnFirstPage, type ChromeCheck } from './navigation/chromeRules';

/** One row of the Checks popover: a sentence, where it is, and what choosing it selects. */
export interface CheckRow { id: string; sentence: string; place: string; select?: SelectionKey; /** Where choosing the row goes; every problem has one. */ go?: Destination;
  /** The `data-field-path` of the field the row names, when it names one: choosing the row focuses it. */ fieldPath?: string }
export interface Checks { problems: CheckRow[]; suggestions: CheckRow[] }

const unescape = (part: string) => part.replace(/~1/g, '/').replace(/~0/g, '~');

/** The path a JSON pointer names, without a leading `document`. */
export function pointerPath(pointer: string): (string | number)[] {
  const parts = pointer.split('/').filter(Boolean).map(unescape);
  if (parts[0] === 'document') parts.shift();
  return parts.map(part => /^\d+$/.test(part) ? Number(part) : part);
}

/**
 * The place a document path stands for, by name: the deepest node, page, sheet or tab the path passes through, else the part of
 * the project it belongs to, with where choosing it goes.
 */
export function placeOf(document: CompositionDocument, path: readonly (string | number)[]): { place: string; select?: SelectionKey; field?: string; go: Destination; fieldPath?: string } {
  const { place, select, field, go, fieldPath } = targetOf(document, path);
  return { place, select, field, go, fieldPath: fieldPath?.join('/') };
}

/** What choosing a row does in the workspace: select an item, open a Project panel, or open a Project dialog. */
export interface CheckHandlers { select: (key: SelectionKey) => void; panel: (panel: PanelKind) => void; dialog: (dialog: DialogKey) => void; /** Opens a Logic Template's editor. */ logic?: (id: string) => void; /** Focuses the field at a `data-field-path` once the surface that holds it has opened. */ focus?: (fieldPath: string) => void }

/** Takes the person to what a row names (selecting a row goes there), and to the field it names. */
export function followCheck(row: CheckRow, to: CheckHandlers): void {
  const go = row.go ?? (row.select ? { select: row.select } : undefined);
  if (!go) return;
  if ('select' in go) to.select(go.select); else if ('panel' in go) to.panel(go.panel); else if ('logic' in go) to.logic?.(go.logic); else to.dialog(go.dialog);
  if (row.fieldPath) to.focus?.(row.fieldPath);
}

/** The compiler's issues for a document, or none when it compiles. */
export function compilerIssues(document: CompositionDocument): CompositionIssue[] {
  return compilerIssuesOf(document);
}

/**
 * A compiler issue in the Studio's words (spec 5.8): the thing it concerns by name, the field by its label, a plain sentence
 * saying what to change, and where choosing the row goes. The pointer never shows.
 */
export function sentenceFor(document: CompositionDocument, issue: CompositionIssue): { sentence: string; place: string; select?: SelectionKey; go: Destination; fieldPath?: string } {
  const path = pointerPath(issue.pointer);
  const target = targetOf(document, path);
  const level = levelLinkedFromPage(document, issue, path);
  if (level) return { sentence: level.sentence, place: level.place, select: target.select, go: target.go, fieldPath: target.fieldPath?.join('/') };
  return { sentence: `${target.place}: ${wordsFor(document, issue, target, path)}`, place: target.place, select: target.select, go: target.go, fieldPath: target.fieldPath?.join('/') };
}

/**
 * The error for a page that opens a level (`invalid_combination` at a `pageId`, on a page, that names an entry of `levels[]`): "<Page> links to <Name>, a level.
 * A page cannot open a level. Move <Name> to Pages, or open it from a sheet." Anything else gets no special words.
 */
export function levelLinkedFromPage(document: CompositionDocument, issue: CompositionIssue, path: readonly (string | number)[]): { sentence: string; place: string } | undefined {
  if (issue.code !== 'invalid_combination' || path.at(-1) !== 'pageId' || path[0] !== 'pages' || typeof path[1] !== 'number') return undefined;
  const level = (document.levels ?? []).find(item => item.id === valueAt(document, [...path]));
  const from = document.pages[path[1]]?.title?.trim();
  if (!level || !from) return undefined;
  return { place: from, sentence: `${from} links to ${level.title}, a level. A page cannot open a level. Move ${level.title} to Pages, or open it from a sheet.` };
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
  const keys = buildDocumentIndex(document);
  for (const cut of tabsWithCutTitles(document)) {
    const place = placeOf(document, cut.path);
    suggestions.push({ id: `tab-titles-${cut.path.join('-')}`, sentence: `${place.place}: tab titles may be cut on an iPhone. Shorten them or show icons.`, place: place.place, select: keys.keyAt(cut.path) ?? place.select, go: place.go });
  }
  for (const stacked of overlaysWithStackedControls(document)) {
    const place = placeOf(document, stacked.path);
    suggestions.push({ id: `overlay-stack-${stacked.path.join('-')}`, sentence: `${place.place}: two controls sit at the same place. Move one to another place.`, place: place.place, select: keys.keyAt(stacked.path) ?? place.select, go: place.go });
  }
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
  // Global chrome (proposal `build/design/global-chrome/proposal.md`, sections 2, 3 and 5).
  const named = (check: ChromeCheck): CheckRow => ({ id: check.id, sentence: check.sentence, place: check.page.title, select: `page:${check.page.id}` });
  for (const check of [...tabsHiddenOnFirstPage(document), ...customWithoutQuickLinks(document)]) suggestions.push(named(check));
  const firstOnly = quickLinksFirstPageOnly(document);
  if (firstOnly) suggestions.push({ id: 'quick-links-first-page', sentence: firstOnly, place: 'Tabs and header buttons', go: { panel: 'header' } });
  const waiting = pendingUseWords(document);
  if (waiting) suggestions.push({ id: 'pending-capabilities', sentence: waiting, place: 'Project' });
  const warned = new Map<string, number>();
  for (const warning of compositionWarnings(document)) {
    const { place, select, go, fieldPath } = placeOf(document, pointerPath(warning.pointer));
    // Several notes can stand at one place (a map that overflows on three families): each keeps its own row.
    const seen = warned.get(warning.pointer) ?? 0;
    warned.set(warning.pointer, seen + 1);
    suggestions.push({ id: `warning-${warning.pointer}${seen ? `-${seen + 1}` : ''}`, sentence: `${place}: ${warning.message}`, place, select, go, fieldPath });
  }
  return { problems, suggestions };
}
