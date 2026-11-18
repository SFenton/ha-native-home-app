import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { createId as uid } from '../../shared/ids';
import { compositionEditorSchema, removeCompositionItem, replaceAt, selectedVariant, type EditorPath } from '../../composition-editor';
import { compilerIssues } from '../checks';
import { collectLinks, type SurfaceRef } from '../outline';
import { groupWithRoom } from '../capacity';
import { cloneNode } from '../util';
import { foldSidesShipped } from '../layout/fold-sides-edit';

type Page = CompositionDocument['pages'][number];
type Modal = CompositionDocument['modals'][number];
type Tab = CompositionDocument['navigation']['tabs'][number];

const symbol = (name: string) => ({ type: 'sf-symbol' as const, name, rendering: 'canonical' as const, unavailable: 'fallback' as const });
const surfaces = (document: CompositionDocument, kind: SurfaceRef['kind']) => kind === 'page' ? document.pages : document.modals;
const keyOf = (kind: SurfaceRef['kind']) => kind === 'page' ? 'pages' : 'modals';

/** A name for a new thing that no other of the same kind uses: "Name", then "Name 2", "Name 3"… (titles may repeat; this keeps them told apart). */
export function freshName(taken: readonly string[], wanted: string): string {
  const base = wanted.trim() || 'Untitled';
  if (!taken.includes(base)) return base;
  let at = 2;
  while (taken.includes(`${base} ${at}`)) at++;
  return `${base} ${at}`;
}

/**
 * A page with nothing on it, laid out like the document's first page when there is one. It is on two sides while the Duo is partly folded (`sh.fold-sides@1`) only once the app has shipped
 * that id (`shipped`): until then the field would make every publication refused by the app, so a new page never carries it.
 */
export function blankPage(document: CompositionDocument, title: string, shipped = foldSidesShipped()): Page {
  const model = document.pages[0];
  const spacing = { type: 'token' as const, name: 'l' as const };
  return {
    id: uid('page'), title, icon: symbol('square.grid.2x2'), parameters: {}, toolbar: { type: 'inherit' }, navigation: { type: 'stack' },
    layout: (({ foldSides: _sides, ...layout }) => ({ ...layout, ...(shipped ? { foldSides: 'auto' as const } : {}) }))((model ? structuredClone(model.layout) : { type: 'column', padding: { top: spacing, leading: spacing, bottom: spacing, trailing: spacing }, spacing, maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host' }) as Page['layout']),
    components: [],
  } as Page;
}

/** A sheet with nothing on it. */
export function blankSheet(document: CompositionDocument, title: string, height: 'fitted' | 'full', fullScreen = false): Modal {
  const model = blankPage(document, title);
  return {
    id: uid('modal'), title, icon: symbol('rectangle.stack'), parameters: {}, toolbar: { type: 'replace', groups: [] }, layout: (({ foldSides: _sides, ...layout }) => layout)(model.layout), components: [],
    presentation: {
      type: 'sheet', width: 'form', ...(fullScreen ? { fullScreen: true } : {}), appearance: 'system', placement: 'canonical-sheet@1', grabber: 'canonical', navigation: 'local-stack@1',
      height: height === 'full' || fullScreen ? { type: 'full' } : { type: 'fitted', follows: 'root', firstOpen: 'canonical@1' },
      close: { type: 'close', visibility: 'root-only', placement: 'trailing', rail: 'automatic', guard: { type: 'none' } },
    },
  } as Modal;
}

/** A navigation tile that opens `pageId`, for the end of the page that links to it. */
export function linkTile(title: string, pageId: string): CompositionNode {
  return {
    id: uid('native'), title, layout: { span: 1 }, type: 'navigation-tile', icon: symbol('chevron.right'),
    props: { family: 'neutral', selected: 'none', subtitle: { type: 'literal', value: '' } },
    action: { type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
  } as unknown as CompositionNode;
}

/** The result of an edit that makes a page. */
export interface Added { document: CompositionDocument; id: string }

/**
 * Adds a page named `name`. Unless `from` is undefined ("Nothing yet"), the page it links from gets a navigation tile at the
 * end, in the same new document, so the dialog is one undo step. A link from a sheet is allowed: sheets hold tiles too.
 */
export function addPage(document: CompositionDocument, name: string, from?: SurfaceRef): Added {
  const page = blankPage(document, freshName(document.pages.map(item => item.title), name));
  const next = structuredClone(document);
  next.pages.push(page);
  if (from) {
    const owner = surfaces(next, from.kind).find(item => item.id === from.id);
    owner?.components.push(linkTile(page.title, page.id) as never);
  }
  return { document: next, id: page.id };
}

/** Adds a sheet named `name` of `height`; with `fullScreen` it is a Modal (covers the whole screen, always full height). */
export function addSheet(document: CompositionDocument, name: string, height: 'fitted' | 'full', fullScreen = false): Added {
  const sheet = blankSheet(document, freshName(document.modals.map(item => item.title), name), height, fullScreen);
  return { document: { ...document, modals: [...document.modals, sheet] }, id: sheet.id };
}

/** Whether another tab fits, and the line that says why not. */
export function tabRoom(document: CompositionDocument): { room: boolean; reason?: string } {
  const room = groupWithRoom(document.navigation.tabs);
  if (room) return { room: true };
  return { room: false, reason: 'The tab bar holds 5.' };
}

/** The first page of a tab carries the app's menu button, so a page with its own header buttons and none of those goes back to the app's. */
function asTabRoot(document: CompositionDocument, pageId: string): CompositionDocument {
  const root = document.pages.findIndex(page => page.id === pageId);
  const own = document.pages[root]?.toolbar;
  return own?.type === 'replace' && !own.groups.some(group => group.items.some(item => item.type === 'shell-menu')) ? replaceAt(document, ['pages', root, 'toolbar'], { type: 'inherit' }) : document;
}

/** Points tab number `index` at another page, keeping the page the app opens first in step when this tab is the one that opens first. */
export function setTabPage(document: CompositionDocument, index: number, pageId: string): CompositionDocument {
  const tab = document.navigation.tabs[index];
  if (!tab) return document;
  let next = asTabRoot(document, pageId);
  next = replaceAt(next, ['navigation', 'tabs', index, 'pageId'], pageId);
  return next.navigation.initialTabId === tab.id ? replaceAt(next, ['navigation', 'initialPageId'], pageId) : next;
}

/** The tab to add: a label, an icon and the page it opens (an existing one, else a new page named for the label). */
export interface TabDraft { label: string; icon: string; pageId?: string }

/** Adds a tab, with a new page when `draft.pageId` is undefined. The first tab also becomes the one that opens first when none did. */
export function addTab(document: CompositionDocument, draft: TabDraft): Added & { pageId: string } {
  if (!tabRoom(document).room) throw new Error('The tab bar holds 5.');
  let next = document, pageId = draft.pageId;
  if (!pageId) { const made = addPage(document, draft.label); next = made.document; pageId = made.id; }
  next = asTabRoot(next, pageId);
  const tab: Tab = { id: uid('tab'), label: draft.label.trim() || 'New Tab', icon: symbol(draft.icon) as Tab['icon'], pageId, arguments: {} } as Tab;
  next = replaceAt(next, ['navigation', 'tabs'], [...next.navigation.tabs, tab]);
  if (next.navigation.tabs.length === 1 && next.navigation.initialTabId === null) next = replaceAt(next, ['navigation'], { ...next.navigation, initialTabId: tab.id, initialPageId: pageId });
  return { document: next, id: tab.id, pageId };
}

/** Renames a page or sheet. */
export function renameSurface(document: CompositionDocument, ref: SurfaceRef, title: string): CompositionDocument {
  const at = surfaces(document, ref.kind).findIndex(item => item.id === ref.id);
  if (at < 0 || !title.trim()) return document;
  return replaceAt(document, [keyOf(ref.kind), at, 'title'], title.trim());
}

/** A copy of a page or sheet, right after it, with fresh ids throughout and "copy" in its name. Nothing links to it yet. */
export function duplicateSurface(document: CompositionDocument, ref: SurfaceRef): Added {
  const list = surfaces(document, ref.kind) as (Page | Modal)[];
  const at = list.findIndex(item => item.id === ref.id);
  if (at < 0) throw new Error('The page no longer exists');
  const source = list[at];
  const copy = structuredClone(source) as Page | Modal;
  copy.id = uid(ref.kind === 'page' ? 'page' : 'modal');
  copy.title = freshName(list.map(item => item.title), `${source.title} copy`);
  copy.components = source.components.map(node => cloneNode(node));
  return { document: replaceAt(document, [keyOf(ref.kind)], [...list.slice(0, at + 1), copy, ...list.slice(at + 1)]), id: copy.id };
}

/** How many actions open a page or sheet (a tab opening a page counts too). */
export function openerCount(document: CompositionDocument, ref: SurfaceRef): number {
  const actions = collectLinks(document).filter(link => link.to.kind === ref.kind && link.to.id === ref.id).length;
  const tabs = ref.kind === 'page' ? document.navigation.tabs.filter(tab => tab.pageId === ref.id).length : 0;
  return actions + tabs;
}

/** Where an action that opens `ref` sits: the path of the action object. */
function referencesTo(document: CompositionDocument, ref: SurfaceRef): EditorPath[] {
  const found: EditorPath[] = [];
  const hit = (record: Record<string, unknown>): boolean => {
    if (ref.kind === 'page') return (record.type === 'push' && record.pageId === ref.id) || (record.type === 'dismiss-then-push' && (record.destination as { pageId?: string } | undefined)?.pageId === ref.id);
    return record.type === 'present' && record.modalId === ref.id;
  };
  const visit = (value: unknown, path: EditorPath) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((item, at) => visit(item, [...path, at])); return; }
    const record = value as Record<string, unknown>;
    if (hit(record)) { found.push(path); return; }
    for (const [key, child] of Object.entries(record)) visit(child, [...path, key]);
  };
  for (const key of ['pages', 'modals'] as const) document[key].forEach((surface, at) => visit(surface, [key, at]));
  visit(document.navigation.chrome, ['navigation', 'chrome']);
  return found;
}

const without = (document: CompositionDocument, path: EditorPath): CompositionDocument => {
  const owner = path.slice(0, -1), key = path.at(-1)!;
  const value = owner.reduce<unknown>((at, step) => (at as Record<string | number, unknown>)[step], document);
  if (Array.isArray(value)) return replaceAt(document, owner, value.filter((_, at) => at !== key));
  const { [key as string]: _gone, ...rest } = value as Record<string, unknown>;
  return replaceAt(document, owner, rest);
};

/** Whether the schema requires the property at `path` of its holder (an action on a navigation tile is required, on a status chip optional). */
function required(document: CompositionDocument, path: EditorPath): boolean {
  const owner = path.slice(0, -1);
  let schema = compositionEditorSchema as Parameters<typeof selectedVariant>[0];
  owner.forEach((step, depth) => {
    const here = path.slice(0, depth).reduce<unknown>((at, key) => (at as Record<string | number, unknown>)[key], document);
    const picked = selectedVariant(schema, here as never);
    const next = typeof step === 'number' ? (Array.isArray(picked.items) ? picked.items[step] : picked.items) : picked.properties?.[step] ?? picked.additionalProperties;
    schema = typeof next === 'object' ? next : {};
  });
  const holder = owner.reduce<unknown>((at, key) => (at as Record<string | number, unknown>)[key], document);
  return Boolean(selectedVariant(schema, holder as never).required?.includes(String(path.at(-1))));
}

/** What deleting a page or sheet takes with it. */
export interface Deleted { document: CompositionDocument; /** Actions that opened it and are gone (a tile whose only job was to open it goes too). */ actions: number; tabs: number }

/**
 * Deletes a page or sheet and tidies what pointed at it, so the draft still compiles: every action that opens it is removed
 * (the tile goes with it when the tile cannot exist without one), a tab that rooted it is removed, the page the app opens first
 * moves on, and links from outside the app that named it are removed. The last page cannot be deleted.
 */
export function deleteSurface(document: CompositionDocument, ref: SurfaceRef): Deleted {
  if (ref.kind === 'page' && document.pages.length <= 1) throw new Error('At least one page is required');
  let next = document, actions = 0, tabs = 0;
  // Deepest and last first, so earlier paths stay valid while the document shrinks.
  const holders = referencesTo(document, ref).sort((a, b) => b.join('/').localeCompare(a.join('/'), undefined, { numeric: true }));
  for (const path of holders) {
    actions++;
    try {
    const asProperty = path.length > 0 && typeof path.at(-1) === 'string';
    let candidate = asProperty && !required(next, path) ? without(next, path) : undefined;
    if (candidate && compilerIssues(candidate).some(issue => issue.pointer.startsWith(`/document/${path.slice(0, -1).join('/')}`))) candidate = undefined;
    if (!candidate) {
      // The tile or button cannot exist without its action: remove the nearest item of a list that holds it.
      let at = path.length - 1;
      while (at > 0 && typeof path[at] !== 'number') at--;
      candidate = at > 0 ? without(next, path.slice(0, at + 1)) : next;
    }
    next = candidate;
    } catch { /* an earlier removal took this action with it */ }
  }
  if (ref.kind === 'page') {
    const gone = next.navigation.tabs.filter(tab => tab.pageId === ref.id);
    tabs = gone.length;
    const remaining = next.navigation.tabs.filter(tab => tab.pageId !== ref.id);
    next = replaceAt(next, ['navigation', 'tabs'], remaining);
    const left = next.pages.filter(page => page.id !== ref.id);
    const initial = remaining.find(tab => tab.id === next.navigation.initialTabId);
    if (!initial && next.navigation.initialPageId === ref.id) {
      const first = remaining[0]?.pageId ?? left[0].id;
      next = replaceAt(next, ['navigation'], { ...next.navigation, initialPageId: first, initialTabId: remaining[0]?.id ?? null });
    } else if (!initial && next.navigation.initialTabId !== null) next = replaceAt(next, ['navigation', 'initialTabId'], null);
  }
  if (next.extensions) {
    const routes = next.extensions.routes
      .filter(route => ref.kind === 'modal' || route.pageId !== ref.id)
      .map(route => ref.kind === 'modal' && route.anchors ? { ...route, anchors: route.anchors.filter(anchor => anchor.modalId !== ref.id) } : route)
      .map(route => route.anchors && route.anchors.length === 0 ? (({ anchors: _a, ...rest }) => rest)(route) : route);
    next = replaceAt(next, ['extensions', 'routes'], routes);
  }
  const list = surfaces(next, ref.kind);
  const at = list.findIndex(item => item.id === ref.id);
  next = ref.kind === 'page' ? { ...next, pages: next.pages.filter((_, i) => i !== at) } : removeCompositionItem(next, ['modals'], at);
  return { document: next, actions, tabs };
}

/** Moves the tab at `from` to position `to` in the tab bar: one new document, so one undo step. */
export function moveTab(document: CompositionDocument, from: number, to: number): CompositionDocument {
  const tabs = [...document.navigation.tabs];
  if (from === to || from < 0 || from >= tabs.length || to < 0 || to >= tabs.length) return document;
  const [tab] = tabs.splice(from, 1);
  tabs.splice(to, 0, tab);
  return replaceAt(document, ['navigation', 'tabs'], tabs);
}
