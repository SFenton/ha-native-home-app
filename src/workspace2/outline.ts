import type { CompositionDocument } from '../shared/composition/schema';
import { buildDocumentIndex, selectionKey, type DocumentIndex, type SelectionKey } from '../preview2/model';

/** A page or sheet. */
export interface SurfaceRef { kind: 'page' | 'modal'; id: string }

/** One link from a surface to another thing, found in an action. */
export interface Link {
  from: SurfaceRef;
  /** The node (or header button) that holds the action, when one does. */
  holder?: { id: string; title: string };
  to: { kind: 'page' | 'modal' | 'tab'; id: string };
}

/** Every `push`, `dismiss-then-push`, `present` and `select-tab` action in a document, with where it lives. */
export function collectLinks(document: CompositionDocument): Link[] {
  const links: Link[] = [];
  const visit = (value: unknown, from: SurfaceRef, holder?: Link['holder']) => {
    if (Array.isArray(value)) { value.forEach(item => visit(item, from, holder)); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const own = typeof record.id === 'string' && ('title' in record || 'label' in record) ? { id: record.id, title: String(record.title ?? record.label) } : holder;
    if (record.type === 'push' && typeof record.pageId === 'string') links.push({ from, holder, to: { kind: 'page', id: record.pageId } });
    else if (record.type === 'present' && typeof record.modalId === 'string') links.push({ from, holder, to: { kind: 'modal', id: record.modalId } });
    else if (record.type === 'select-tab' && typeof record.tabId === 'string') links.push({ from, holder, to: { kind: 'tab', id: record.tabId } });
    for (const child of Object.values(record)) visit(child, from, own);
  };
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
  if (tabRows.length) groups.push({ id: 'tabs', title: `Tabs · ${document.navigation.tabs.length} of 5`, rows: tabRows });
  else {
    const start = row(document.navigation.initialPageId, 'start');
    if (start) groups.push({ id: 'start', title: 'Start', rows: [start] });
  }
  // Pages reached only from a page that is not in a tab or start tree: place under their linker, else they are not linked.
  const presenters = (id: string) => [...new Set(links.filter(link => link.to.kind === 'modal' && link.to.id === id).map(link => link.from))];
  const sheetRows: OutlineRow[] = document.modals.map(modal => {
    const from = presenters(modal.id).map(surface => (surface.kind === 'page' ? pages : modals).get(surface.id)?.title ?? surface.id);
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
  for (const modal of document.modals) if (!presenters(modal.id).length) noWayIn.push({ kind: 'modal', id: modal.id });
  if (orphans.length) groups.push({ id: 'not-linked', title: 'Not linked', rows: orphans });
  const mark = (rows: OutlineRow[]) => rows.forEach(item => { if (item.surface.kind === 'page' && shared.has(item.surface.id) && !item.tags.includes('Shared')) item.tags.push('Shared'); mark(item.children); });
  groups.forEach(group => mark(group.rows));
  return { groups, links, noWayIn };
}

/** One row of "This Page": a node in document order with its depth. */
export interface PageRow { key: SelectionKey; title: string; type: string; depth: number; tags: string[] }

/** The nodes of a page or sheet in document order, indented by depth, with the "Rule" tag where a rule decides. */
export function buildPageRows(document: CompositionDocument, index: DocumentIndex, surface: SurfaceRef): PageRow[] {
  const rows: PageRow[] = [];
  const visit = (key: SelectionKey, depth: number) => {
    for (const child of index.children(key)) {
      const entry = index.get(child);
      if (entry?.node) rows.push({ key: child, title: entry.node.title, type: entry.node.type, depth, tags: 'visibleWhen' in entry.node && entry.node.visibleWhen ? ['Rule'] : [] });
      visit(child, depth + 1);
    }
  };
  void document;
  visit(selectionKey(surface.kind, surface.id), 0);
  return rows;
}

/** Builds the outline together with the index for convenience. */
export const indexOf = (document: CompositionDocument) => buildDocumentIndex(document);
