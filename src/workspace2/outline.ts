import type { CompositionDocument } from '../shared/composition/schema';
import { tabGroups } from './capacity';
import { buildDocumentIndex, selectionKey, type DocumentIndex, type SelectionKey } from '../preview2/model';

/** A page or sheet. */
export interface SurfaceRef { kind: 'page' | 'modal'; id: string }

/** The header every page shares (`navigation.chrome`): the source of Quick Links and the profile sheet. */
export interface ChromeRef { kind: 'chrome'; id: 'navigation.chrome' }
/** The one {@link ChromeRef}. */
export const chromeRef: ChromeRef = { kind: 'chrome', id: 'navigation.chrome' };

/** One link from a surface (or the shared header) to another thing, found in an action. */
export interface Link {
  from: SurfaceRef | ChromeRef;
  /** The node (or header button) that holds the action, when one does. */
  holder?: { id: string; title: string };
  to: { kind: 'page' | 'modal' | 'tab'; id: string };
}

/**
 * Every `push`, `dismiss-then-push`, `present` and `select-tab` action in a document, with where it lives. Beyond the pages and
 * sheets it reads what the compiler counts as a way in: the shared header (`navigation.chrome`, Quick Links and the profile
 * button), a `room-device-control`'s bare `modalId`, and the actions held by the data source a node binds to.
 */
export function collectLinks(document: CompositionDocument): Link[] {
  const links: Link[] = [];
  const sources = new Map(document.dataSources.map(source => [source.id, source]));
  const visit = (value: unknown, from: Link['from'], holder?: Link['holder'], seen = new Set<string>()) => {
    if (Array.isArray(value)) { value.forEach(item => visit(item, from, holder, seen)); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const own = typeof record.id === 'string' && ('title' in record || 'label' in record || record.type === 'shell-header') ? { id: record.id, title: String(record.title ?? record.label ?? 'Quick Links and Profile') } : holder;
    if (record.type === 'push' && typeof record.pageId === 'string') links.push({ from, holder, to: { kind: 'page', id: record.pageId } });
    else if (record.type === 'present' && typeof record.modalId === 'string') links.push({ from, holder, to: { kind: 'modal', id: record.modalId } });
    else if (record.type === 'select-tab' && typeof record.tabId === 'string') links.push({ from, holder, to: { kind: 'tab', id: record.tabId } });
    if (record.type === 'room-device-control' && typeof (record.props as { modalId?: unknown } | undefined)?.modalId === 'string')
      links.push({ from, holder: own, to: { kind: 'modal', id: (record.props as { modalId: string }).modalId } });
    const sourceId = (record.binding as { sourceId?: unknown } | undefined)?.sourceId;
    if (typeof sourceId === 'string' && sources.get(sourceId) && !seen.has(sourceId)) visit(sources.get(sourceId), from, own, new Set(seen).add(sourceId));
    for (const child of Object.values(record)) visit(child, from, own, seen);
  };
  visit(document.navigation.chrome, chromeRef);
  for (const kind of ['page', 'modal'] as const)
    for (const surface of document[kind === 'page' ? 'pages' : 'modals']) visit(surface, { kind, id: surface.id });
  return links;
}

/** A row of the Pages outline. */
export interface OutlineRow {
  key: SelectionKey;
  surface: SurfaceRef;
  title: string;
  icon: string;
  /** The tags that apply, as their words. */
  tags: ('Shared' | 'No Way In')[];
  /** The second line of a sheet row. */
  via?: string;
  children: OutlineRow[];
}
export interface OutlineGroup { id: 'tabs' | 'start' | 'sheets' | 'not-linked'; title: string; rows: OutlineRow[] }

/** Every page and sheet reachable some way, for the no-way-in check. */
export interface Outline { groups: OutlineGroup[]; links: Link[]; noWayIn: SurfaceRef[] }

/**
 * Derives the outline from the document's actions (spec 5.3): "Tabs" (each tab's page with the pages it links to
 * nested beneath), "Sheets", then "Not linked". A page reached from several tabs appears once, under the first, tagged
 * Shared. A document with no tabs starts from its first page, under "Start".
 */
export function buildOutline(document: CompositionDocument): Outline {
  const links = collectLinks(document);
  const pages = new Map(document.pages.map(page => [page.id, page])), modals = new Map(document.modals.map(modal => [modal.id, modal]));
  const placed = new Set<string>(), tabOf = new Map<string, string>(), shared = new Set<string>();
  const linkedPages = (from: SurfaceRef) => links.filter(link => link.from.kind === from.kind && link.from.id === from.id).flatMap(link => {
    if (link.to.kind === 'page') return [link.to.id];
    if (link.to.kind === 'tab') { const tab = document.navigation.tabs.find(item => item.id === link.to.id); return tab ? [tab.pageId] : []; }
    return [];
  });
  const row = (id: string, root: string): OutlineRow | undefined => {
    const page = pages.get(id);
    if (!page || placed.has(id)) return undefined;
    placed.add(id); tabOf.set(id, root);
    const children: OutlineRow[] = [];
    for (const next of new Set(linkedPages({ kind: 'page', id }))) {
      if (placed.has(next)) { if (tabOf.get(next) !== root) shared.add(next); continue; }
      const child = row(next, root);
      if (child) children.push(child);
    }
    return { key: selectionKey('page', id), surface: { kind: 'page', id }, title: page.title, icon: page.icon.name, tags: [], children };
  };
  const tabRows: OutlineRow[] = [];
  document.navigation.tabs.forEach(tab => {
    if (placed.has(tab.pageId)) { shared.add(tab.pageId); return; }
    const built = row(tab.pageId, `tab:${tab.id}`);
    if (built) tabRows.push(built);
  });
  const groups: OutlineGroup[] = [];
  if (tabRows.length) groups.push({ id: 'tabs', title: `Tabs · ${document.navigation.tabs.length} of ${tabGroups[0].capacity ?? 5}`, rows: tabRows });
  else {
    const start = row(document.navigation.initialPageId, 'start');
    if (start) groups.push({ id: 'start', title: 'Start', rows: [start] });
  }
  // Pages reached only from a page that is not in a tab or start tree: place under their linker, else they are not linked.
  const presenters = (id: string) => [...new Set(links.filter(link => link.to.kind === 'modal' && link.to.id === id).map(link => link.from))];
  const sayFrom = (from: Link['from']) => from.kind === 'chrome' ? 'the header' : (from.kind === 'page' ? pages : modals).get(from.id)?.title ?? from.id;
  const anchored = new Set((document.extensions?.routes ?? []).flatMap(route => (route.anchors ?? []).map(anchor => anchor.modalId)));
  const sheetRows: OutlineRow[] = document.modals.map(modal => {
    const from = presenters(modal.id).map(sayFrom);
    if (!from.length && anchored.has(modal.id)) from.push('a route');
    const children: OutlineRow[] = [];
    for (const next of new Set(linkedPages({ kind: 'modal', id: modal.id }))) { const child = row(next, `modal:${modal.id}`); if (child) children.push(child); }
    return {
      key: selectionKey('modal', modal.id), surface: { kind: 'modal', id: modal.id }, title: modal.title, icon: modal.icon.name,
      tags: from.length ? [] : ['No Way In'], via: from.length ? `Opened from ${from.join(', ')}` : undefined, children,
    };
  });
  if (sheetRows.length) groups.push({ id: 'sheets', title: 'Sheets', rows: sheetRows });
  const fromRoutes = new Set((document.extensions?.routes ?? []).flatMap(route => [route.pageId, route.tabId ? document.navigation.tabs.find(tab => tab.id === route.tabId)?.pageId : undefined]).filter((id): id is string => Boolean(id)));
  const orphans: OutlineRow[] = [], noWayIn: SurfaceRef[] = [];
  for (const page of document.pages) {
    if (placed.has(page.id)) continue;
    const built = row(page.id, `orphan:${page.id}`);
    if (!built) continue;
    const reachable = fromRoutes.has(page.id) || links.some(link => link.to.kind === 'page' && link.to.id === page.id);
    if (!reachable) { built.tags.push('No Way In'); noWayIn.push({ kind: 'page', id: page.id }); }
    orphans.push(built);
  }
  for (const modal of document.modals) if (!presenters(modal.id).length && !anchored.has(modal.id)) noWayIn.push({ kind: 'modal', id: modal.id });
  if (orphans.length) groups.push({ id: 'not-linked', title: 'Not linked', rows: orphans });
  const mark = (rows: OutlineRow[]) => rows.forEach(item => { if (item.surface.kind === 'page' && shared.has(item.surface.id) && !item.tags.includes('Shared')) item.tags.push('Shared'); mark(item.children); });
  groups.forEach(group => mark(group.rows));
  return { groups, links, noWayIn };
}

/** Builds the outline together with the index for convenience. */
export const indexOf = (document: CompositionDocument) => buildDocumentIndex(document);

/** What the Studio calls a `modals[]` entry: a **Modal** covers the whole screen (`presentation.fullScreen`), every other entry is a **Sheet** (studio-ux2 lib3, D5). */
export const surfaceWord = (modal: Pick<CompositionDocument['modals'][number], 'presentation'>): 'Modal' | 'Sheet' => modal.presentation.fullScreen ? 'Modal' : 'Sheet';

/** The lists the library draws as a tree of surfaces. */
export type ListKind = 'tabs' | 'pages' | 'sheets' | 'modals';

/** One top-level row of a library list: a tab (which stands for its page), a page, a sheet or a modal. */
export interface LibraryRow {
  /** The selection key of the row itself: `tab:<id>` for a tab, else the surface's key. */
  key: SelectionKey;
  /** The page or sheet the row shows in the simulator and whose children it holds. */
  surface: SurfaceRef;
  title: string;
  icon: string;
  tags: ('Shared' | 'No Way In')[];
  /** The second line of a sheet row. */
  via?: string;
}
/** A collapsible group of a list ("From Home", "Opened From a Tile"). `id` is stable across renames, for remembering open and closed. */
export interface LibraryGroup { id: string; title: string; rows: LibraryRow[] }

const flatten = (rows: OutlineRow[]): OutlineRow[] => rows.flatMap(row => [row, ...flatten(row.children)]);
const asRow = (row: OutlineRow): LibraryRow => ({ key: row.key, surface: row.surface, title: row.title, icon: row.icon, tags: row.tags, via: row.via });

/**
 * The groups of a library list, derived from the outline (studio-ux2 lib3, L-tax).
 * Tabs: the tab bar in order (the start page alone, under "Start", when there are none). Pages: every page no tab shows, grouped by the tab
 * the link path starts from ("From Home"), then "From a Sheet" and "Not Linked". Sheets and Modals: `modals[]` split by {@link surfaceWord}, grouped by how they open.
 */
export function libraryGroups(document: CompositionDocument, category: ListKind): LibraryGroup[] {
  const outline = buildOutline(document);
  if (category === 'tabs') {
    const tabs = document.navigation.tabs;
    if (!tabs.length) {
      const start = document.pages.find(page => page.id === document.navigation.initialPageId);
      return start ? [{ id: 'start', title: 'Start', rows: [{ key: selectionKey('page', start.id), surface: { kind: 'page', id: start.id }, title: start.title, icon: start.icon.name, tags: [] }] }] : [];
    }
    return [{ id: 'tabs', title: 'Tabs', rows: tabs.map(tab => ({ key: selectionKey('tab', tab.id), surface: { kind: 'page' as const, id: tab.pageId }, title: tab.label, icon: tab.icon.name, tags: [] })) }];
  }
  if (category === 'pages') {
    const groups: LibraryGroup[] = [];
    const tabbed = outline.groups.find(group => group.id === 'tabs' || group.id === 'start');
    for (const root of tabbed?.rows ?? []) {
      const rows = flatten(root.children);
      if (!rows.length) continue;
      const tab = document.navigation.tabs.find(item => item.pageId === root.surface.id);
      groups.push({ id: `from:${tab ? `tab:${tab.id}` : 'start'}`, title: `From ${tab?.label ?? root.title}`, rows: rows.map(asRow) });
    }
    const fromSheets = flatten((outline.groups.find(group => group.id === 'sheets')?.rows ?? []).flatMap(row => row.children));
    if (fromSheets.length) groups.push({ id: 'from-sheet', title: 'From a Sheet', rows: fromSheets.map(asRow) });
    const loose = flatten(outline.groups.find(group => group.id === 'not-linked')?.rows ?? []);
    groups.push({ id: 'loose', title: 'Not Linked', rows: loose.map(asRow) });
    return groups.filter(group => group.rows.length);
  }
  const full = category === 'modals';
  const rows = (outline.groups.find(group => group.id === 'sheets')?.rows ?? []).filter(row => document.modals.find(modal => modal.id === row.surface.id) && (surfaceWord(document.modals.find(modal => modal.id === row.surface.id)!) === 'Modal') === full);
  const header = rows.filter(row => !row.tags.includes('No Way In') && /the header/.test(row.via ?? ''));
  const tile = rows.filter(row => !row.tags.includes('No Way In') && !header.includes(row));
  const loose = rows.filter(row => row.tags.includes('No Way In'));
  return [{ id: 'header', title: 'Opened From the Header', rows: header }, { id: 'tile', title: 'Opened From a Tile', rows: tile }, { id: 'loose', title: 'Not Linked', rows: loose }].filter(group => group.rows.length).map(group => ({ ...group, rows: group.rows.map(asRow) }));
}
