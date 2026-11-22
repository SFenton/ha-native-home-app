import type { CompositionDocument } from '../shared/composition/schema';
import { tabGroups } from './capacity';
import { buildDocumentIndex, selectionKey, type DocumentIndex, type SelectionKey } from '../preview2/model';
import { hidesInForce } from './navigation/hidesInForce';

/** What a page writes to hide: the tab bar, and each header button, whether or not the app already hides it there. The library counts {@link hidesInForce} instead. */
export function hideCount(page: Pick<CompositionDocument['pages'][number], 'hides'>): number {
  return (page.hides?.tabs ? 1 : 0) + (page.hides?.items?.length ?? 0);
}

/**
 * The library row's "Hides 2" for a page: only the hides in force (proposal section 2). A hide the app already applies on that page through "First page only", and an item a Custom
 * header has no copy of, are not counted. None when nothing is in force.
 */
export function hidesTag(document: CompositionDocument, page: Pick<CompositionDocument['pages'][number], 'id' | 'hides' | 'toolbar'>): `Hides ${number}`[] {
  const count = hidesInForce(document, page);
  return count ? [`Hides ${count}`] : [];
}

/** A page or sheet. */
export interface SurfaceRef { kind: 'page' | 'modal'; id: string }

/** A level of a sheet (`levels[]`, `sh.sheet-levels@1`): a surface a push inside a sheet reaches without leaving it. */
export interface LevelRef { kind: 'level'; id: string }

/** The header every page shares (`navigation.chrome`): the source of Quick Links and the profile sheet. */
export interface ChromeRef { kind: 'chrome'; id: 'navigation.chrome' }
/** The one {@link ChromeRef}. */
export const chromeRef: ChromeRef = { kind: 'chrome', id: 'navigation.chrome' };

/** One link from a surface (or the shared header) to another thing, found in an action. */
export interface Link {
  from: SurfaceRef | LevelRef | ChromeRef;
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
  for (const level of document.levels ?? []) visit(level, { kind: 'level', id: level.id });
  return links;
}

/** Which sheet each level belongs to (`levels[]`, `sh.sheet-levels@1`). */
export interface LevelOwners {
  /** A sheet's levels, in the order `levels[]` lists them: the ones its links reach, directly or through another level. A level two sheets reach is listed under the first. */
  bySheet: Map<string, string[]>;
  /** Levels more than one sheet reaches. */
  shared: Set<string>;
  /** Levels no sheet reaches, in the order `levels[]` lists them. */
  loose: string[];
  /** Every level each sheet reaches, owned or shared. */
  reach: Map<string, Set<string>>;
}

/** Finds each level's sheet from the links: a sheet owns the levels it pushes, and those they push in turn. */
export function levelOwners(document: CompositionDocument, links: Link[] = collectLinks(document)): LevelOwners {
  const levelIds = new Set((document.levels ?? []).map(level => level.id));
  const bySheet = new Map<string, string[]>(), shared = new Set<string>(), owner = new Map<string, string>(), reach = new Map<string, Set<string>>();
  for (const modal of document.modals) {
    const reached = new Set<string>();
    const walk = (from: Link['from']) => {
      for (const link of links) {
        if (link.from.kind !== from.kind || link.from.id !== from.id || link.to.kind !== 'page' || !levelIds.has(link.to.id) || reached.has(link.to.id)) continue;
        reached.add(link.to.id);
        walk({ kind: 'level', id: link.to.id });
      }
    };
    walk({ kind: 'modal', id: modal.id });
    reach.set(modal.id, reached);
    for (const id of reached) { if (!owner.has(id)) owner.set(id, modal.id); else if (owner.get(id) !== modal.id) shared.add(id); }
  }
  for (const level of document.levels ?? []) {
    const sheet = owner.get(level.id);
    if (sheet) bySheet.set(sheet, [...(bySheet.get(sheet) ?? []), level.id]);
  }
  return { bySheet, shared, reach, loose: (document.levels ?? []).filter(level => !owner.has(level.id)).map(level => level.id) };
}

/** A row of the Pages outline. */
export interface OutlineRow {
  key: SelectionKey;
  surface: SurfaceRef;
  title: string;
  icon: string;
  /** The tags that apply, as their words. */
  tags: LibraryTag[];
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
  const linkedPages = (from: SurfaceRef | LevelRef) => links.filter(link => link.from.kind === from.kind && link.from.id === from.id).flatMap(link => {
    if (link.to.kind === 'page') return [link.to.id];
    if (link.to.kind === 'tab') { const tab = document.navigation.tabs.find(item => item.id === link.to.id); return tab ? [tab.pageId] : []; }
    return [];
  });
  const owners = levelOwners(document, links);
  // Only a document that declares `levels` (even an empty list) has a sheet's push close the sheet: the app's `pushLeavesSheet` and the preview's navigation say so. Without the key a
  // push stays inside the sheet, so its page is part of the sheet ("From a Sheet").
  const declared = document.levels !== undefined;
  // A page a sheet (or one of its levels) opens belongs to the flow of the page that opens the sheet: the sheet closes first, so the page opens as a page.
  const viaSheets = (from: SurfaceRef): string[] => {
    if (!declared) return [];
    const seen = new Set<string>(), out: string[] = [];
    const walk = (page: SurfaceRef) => {
      for (const link of links) {
        if (link.from.kind !== page.kind || link.from.id !== page.id || link.to.kind !== 'modal' || seen.has(link.to.id)) continue;
        seen.add(link.to.id);
        const sheet: SurfaceRef = { kind: 'modal', id: link.to.id };
        out.push(...linkedPages(sheet), ...(owners.bySheet.get(sheet.id) ?? []).flatMap(level => linkedPages({ kind: 'level', id: level })));
        walk(sheet);
      }
    };
    walk(from);
    return out;
  };
  const row = (id: string, root: string): OutlineRow | undefined => {
    const page = pages.get(id);
    if (!page || placed.has(id)) return undefined;
    placed.add(id); tabOf.set(id, root);
    const children: OutlineRow[] = [];
    for (const next of new Set([...linkedPages({ kind: 'page', id }), ...viaSheets({ kind: 'page', id })])) {
      if (placed.has(next)) { if (tabOf.get(next) !== root) shared.add(next); continue; }
      const child = row(next, root);
      if (child) children.push(child);
    }
    return { key: selectionKey('page', id), surface: { kind: 'page', id }, title: page.title, icon: page.icon.name, tags: hidesTag(document, page), children };
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
  const levelTitles = new Map((document.levels ?? []).map(level => [level.id, level.title]));
  const sayFrom = (from: Link['from']) => from.kind === 'chrome' ? 'the header' : from.kind === 'level' ? levelTitles.get(from.id) ?? from.id : (from.kind === 'page' ? pages : modals).get(from.id)?.title ?? from.id;
  const anchored = new Set((document.extensions?.routes ?? []).flatMap(route => (route.anchors ?? []).map(anchor => anchor.modalId)));
  const sheetRows: OutlineRow[] = document.modals.map(modal => {
    const from = presenters(modal.id).map(sayFrom);
    if (!from.length && anchored.has(modal.id)) from.push('a route');
    // Declaring levels: the pages a sheet opens are pages, not part of the sheet, and stay in the flow that reached them (above), else under Not linked. Otherwise they are the sheet's own.
    const children: OutlineRow[] = [];
    if (!declared) for (const next of new Set(linkedPages({ kind: 'modal', id: modal.id }))) { const child = row(next, `modal:${modal.id}`); if (child) children.push(child); }
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
  tags: LibraryTag[];
  /** The second line of a sheet row. */
  via?: string;
  /** Set on a level's row (`key` is `level:<id>`): the sheet it hangs from, when a sheet reaches it. `surface` is that sheet, so the simulator shows it; for a level no sheet reaches it is the level's own id and is never shown. */
  level?: { id: string; sheetId?: string };
  /** A sheet's levels, in order, drawn indented beneath it. */
  levels?: LibraryRow[];
}
/** The tags a library row can carry. */
export type LibraryTag = 'Shared' | 'No Way In' | 'Level' | `Hides ${number}`;
/** A collapsible group of a list ("From Home", "Opened From a Tile"). `id` is stable across renames, for remembering open and closed. */
export interface LibraryGroup { id: string; title: string; rows: LibraryRow[] }

const flatten = (rows: OutlineRow[]): OutlineRow[] => rows.flatMap(row => [row, ...flatten(row.children)]);
const asRow = (row: OutlineRow): LibraryRow => ({ key: row.key, surface: row.surface, title: row.title, icon: row.icon, tags: row.tags, via: row.via });

/**
 * The groups of a library list, derived from the outline (studio-ux2 lib3, L-tax).
 * Tabs: the tab bar in order (the start page alone, under "Start", when there are none). Pages: every page no tab shows, grouped by the tab
 * the link path starts from ("From Home"), then "Not Linked". A page a sheet opens is listed with the flow of the page that opens the sheet when the document declares `levels` (the sheet closes first, so it opens as a page); without the key it stays inside the sheet, under "From a Sheet".
 * Sheets and Modals: `modals[]` split by {@link surfaceWord}, grouped by how they open, each with its levels (`levels[]`) beneath it.
 */
export function libraryGroups(document: CompositionDocument, category: ListKind): LibraryGroup[] {
  const outline = buildOutline(document);
  if (category === 'tabs') {
    const tabs = document.navigation.tabs;
    if (!tabs.length) {
      const start = document.pages.find(page => page.id === document.navigation.initialPageId);
      return start ? [{ id: 'start', title: 'Start', rows: [{ key: selectionKey('page', start.id), surface: { kind: 'page', id: start.id }, title: start.title, icon: start.icon.name, tags: hidesTag(document, start) }] }] : [];
    }
    return [{ id: 'tabs', title: 'Tabs', rows: tabs.map(tab => ({ key: selectionKey('tab', tab.id), surface: { kind: 'page' as const, id: tab.pageId }, title: tab.label, icon: tab.icon.name, tags: hidesTag(document, document.pages.find(page => page.id === tab.pageId) ?? { id: tab.pageId, toolbar: { type: 'inherit' } }) })) }];
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
    // A document without `levels` keeps the pages a sheet opens inside the sheet: they are listed as "From a Sheet".
    if (document.levels === undefined) {
      const fromSheets = flatten((outline.groups.find(group => group.id === 'sheets')?.rows ?? []).flatMap(row => row.children));
      if (fromSheets.length) groups.push({ id: 'from-sheet', title: 'From a Sheet', rows: fromSheets.map(asRow) });
    }
    const loose = flatten(outline.groups.find(group => group.id === 'not-linked')?.rows ?? []);
    groups.push({ id: 'loose', title: 'Not Linked', rows: loose.map(asRow) });
    return groups.filter(group => group.rows.length);
  }
  const full = category === 'modals';
  const owners = levelOwners(document, outline.links);
  const levelRowOf = (id: string, sheetId?: string): LibraryRow => {
    const level = document.levels!.find(item => item.id === id)!;
    const tags: LibraryTag[] = ['Level'];
    if (owners.shared.has(id)) tags.push('Shared');
    if (!sheetId) tags.push('No Way In');
    return { key: selectionKey('level', id), surface: sheetId ? { kind: 'modal', id: sheetId } : { kind: 'modal', id }, title: level.title, icon: level.icon.name, tags, level: { id, sheetId } };
  };
  const rows = (outline.groups.find(group => group.id === 'sheets')?.rows ?? []).filter(row => document.modals.find(modal => modal.id === row.surface.id) && (surfaceWord(document.modals.find(modal => modal.id === row.surface.id)!) === 'Modal') === full)
    .map(row => ({ ...asRow(row), levels: (owners.bySheet.get(row.surface.id) ?? []).map(id => levelRowOf(id, row.surface.id)) }));
  const header = rows.filter(row => !row.tags.includes('No Way In') && /the header/.test(row.via ?? ''));
  const tile = rows.filter(row => !row.tags.includes('No Way In') && !header.includes(row));
  // A level no sheet reaches is listed with the sheets (the Studio cannot tell which kind it belongs to), under Not Linked.
  const loose = [...rows.filter(row => row.tags.includes('No Way In')), ...(full ? [] : owners.loose.map(id => levelRowOf(id)))];
  return [{ id: 'header', title: 'Opened From the Header', rows: header }, { id: 'tile', title: 'Opened From a Tile', rows: tile }, { id: 'loose', title: 'Not Linked', rows: loose }].filter(group => group.rows.length);
}

/** Every row of the groups in drawing order: each row, then the levels beneath it. */
export const flatRows = (groups: readonly LibraryGroup[]): LibraryRow[] => groups.flatMap(group => group.rows.flatMap(row => [row, ...(row.levels ?? [])]));

/**
 * The groups whose rows match a search (a title containing `needle`, case-insensitive; an empty needle matches all). A sheet stays when its own title or one of its levels matches, with the
 * levels that match (all of them when the sheet itself does); a group with no match goes.
 */
export function matchGroups(groups: readonly LibraryGroup[], needle: string): LibraryGroup[] {
  const text = needle.trim().toLowerCase();
  if (!text) return [...groups];
  const has = (row: LibraryRow) => row.title.toLowerCase().includes(text);
  return groups.map(group => ({ ...group, rows: group.rows.flatMap(row => {
    if (has(row)) return [row];
    const levels = (row.levels ?? []).filter(has);
    return levels.length ? [{ ...row, levels }] : [];
  }) })).filter(group => group.rows.length);
}
