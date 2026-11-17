import type { CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { childSlots, valueAt } from '../composition-editor';
import type { DocumentIndex, SelectionKey } from '../preview2/model';
import { typeName, type NodeLike } from './util';
import { surfaceWord } from './outline';
import { componentUses } from '../shared/composition/components';

/** The name of a saved component. */
const componentName = (document: CompositionDocument, id: string | undefined) => document.componentLibrary?.find(entry => entry.id === id)?.name;

/**
 * The model of the phone's "This Page" sheet (studio-ux2, L-phone): the page or sheet seen one level at a time. Pure: no React, no
 * document edits. The sheet draws it; the wide Pages panel keeps the outline tree and shares only the words and what a container holds.
 */

/** One row of a level: a node (or a local tab) with the words the row shows. */
export interface LevelRow {
  key: SelectionKey;
  title: string;
  /** The node's own icon name, when it has one; the row draws the glyph of its type otherwise. */
  icon?: string;
  /** The node type (`tile-grid`), or `local-tab` for a tab of local tabs. */
  type: string;
  /** The type in the app's words ("Tile grid"). */
  typeWord: string;
  /** Whether the row goes into a level of its own. An empty container is still one: it takes an Add Here. */
  container: boolean;
  /** How many children it holds; 0 for a leaf. */
  count: number;
  /** Whether a Visible-when rule decides if it shows. */
  rule: boolean;
  /** The one line under the title: the type, then a count for a container and "Shown by a rule" where one applies. */
  context: string;
  /** Whether the row is a place that uses a saved component: its title is the component's name and its count the body's children. */
  linked?: boolean;
  /** The saved component this row is the root of, for the row's accessible name. */
  places?: number;
  /** For an area of a tab container: whether it is for every tab, the tabs it is for and the labels they carry (`sh.tab-blocks@1`). */
  /** Words a child of an Overlay carries: Base, or the place it sits at (`sh.overlay@1`). */
  tags?: string[];
  area?: { shared: boolean; tabIds: string[]; labels: string[] };
}

/** One step of the path from the page down to a level. */
export interface Crumb { key: SelectionKey; title: string }

/** What the subtitle draws for one place: a crumb, or the "…" that stands for the levels left out. */
export type ShownCrumb = { crumb: Crumb } | { hidden: Crumb[] };


/** The words of the rule note. */
export const RULE_NOTE = 'Shown by a rule';
/** The separator between crumbs. */
export const CRUMB_SEPARATOR = '›';

const units: Record<string, [string, string]> = {
  'tile-grid': ['tile', 'tiles'], stack: ['item', 'items'], repeat: ['cell', 'cells'], 'status-rail': ['chip', 'chips'], 'local-tabs': ['tab', 'tabs'], 'local-tab': ['item', 'items'],
};
/** "9 tiles", "1 item", "No tiles": the count of a container in words. */
export function countWords(type: string, count: number): string {
  const [one, many] = units[type] ?? ['item', 'items'];
  return count === 0 ? `No ${many}` : `${count} ${count === 1 ? one : many}`;
}

/** The context line of a row. One function, so the wide tree and the phone list read the same. */
export function rowContext(named: string | NodeLike, count: number, container: boolean, rule: boolean): string {
  const type = typeof named === 'string' ? named : named.type;
  const parts = [type === 'local-tab' ? 'Tab' : typeName(named)];
  if (container) parts.push(countWords(type, count));
  if (rule) parts.push(RULE_NOTE);
  return parts.join(' · ');
}

/** The title of a surface, node or local tab; empty when the key stands for nothing. */
export function levelName(document: CompositionDocument, index: DocumentIndex, key: SelectionKey): string {
  const entry = index.get(key);
  if (!entry) return '';
  if (entry.node) return entry.bodyPath ? componentName(document, entry.component) ?? entry.node.title : entry.node.title;
  if (entry.kind === 'local-tab') return areaWords(document, index, key)?.title ?? '';
  return (valueAt(document, entry.path) as { title?: string } | undefined)?.title ?? '';
}

/** The words of an area: "Shared" for one that shows on every tab, else the labels of its tabs joined with commas (the shipped shape: the tab's own label). */
export function areaWords(document: CompositionDocument, index: DocumentIndex, key: SelectionKey): { title: string; shared: boolean; tabIds: string[]; labels: string[]; icon?: string } | undefined {
  const entry = index.get(key);
  if (entry?.kind !== 'local-tab') return undefined;
  const tabs = ((entry.parent ? index.get(entry.parent)?.node : undefined) as { tabs?: { id: string; label: string; icon?: { name: string } }[] } | undefined)?.tabs ?? [];
  const named = entry.tabs ?? [], held = tabs.filter(tab => named.includes(tab.id));
  const shared = Boolean(entry.shared);
  const labels = held.map(tab => tab.label);
  return { title: shared ? 'Shared' : labels.join(', ') || ((valueAt(document, entry.path) as { label?: string } | undefined)?.label ?? ''), shared, tabIds: named, labels, icon: shared ? undefined : held[0]?.icon?.name };
}

/** Whether a level can be entered: a page or sheet, a local tab, or a node that holds children. */
export function isLevel(index: DocumentIndex, key: SelectionKey): boolean {
  const entry = index.get(key);
  if (!entry) return false;
  if (entry.kind === 'page' || entry.kind === 'modal' || entry.kind === 'local-tab') return true;
  return Boolean(entry.node && childSlots(entry.node).length);
}

/** The words for an overlay child's place. */
const anchorWords: Record<string, string> = { 'top-leading': 'Top Leading', 'top-trailing': 'Top Trailing', 'bottom-leading': 'Bottom Leading', 'bottom-trailing': 'Bottom Trailing', center: 'Center' };
/** What an empty overlay's level says: a place to drop a map or a tile. */
export const OVERLAY_SLOT = 'Drop a map or a tile here.';
/** Whether the level is an Overlay, which has a base and controls on top rather than a plain list. */
export const isOverlayLevel = (index: DocumentIndex, level: SelectionKey): boolean => index.get(level)?.node?.type === 'overlay';

/** The rows of one level: the children of a page, sheet, container or local tab, in order. Hidden node types never appear. */
export function levelRows(document: CompositionDocument, index: DocumentIndex, level: SelectionKey): LevelRow[] {
  const rows: LevelRow[] = [];
  const overlay = index.get(level)?.node as { children: { id: string }[]; props: { anchors: { childId: string; anchor: string }[] } } | undefined;
  for (const key of index.children(level)) {
    const entry = index.get(key);
    if (!entry) continue;
    if (entry.kind === 'local-tab') {
      const count = index.children(key).length;
      const words = areaWords(document, index, key);
      rows.push({ key, title: words?.title ?? '', icon: words?.icon, type: words?.shared ? 'shared-area' : 'local-tab', typeWord: words?.shared ? 'Shared Area' : 'Tab', container: true, count, rule: false,
        context: words?.shared ? `Shared Area · ${countWords('local-tab', count)}` : rowContext('local-tab', count, true, false), ...(words ? { area: { shared: words.shared, tabIds: words.tabIds, labels: words.labels } } : {}) });
      continue;
    }
    const node: CompositionNode | undefined = entry.node;
    if (!node) continue;
    const container = childSlots(node).length > 0, count = container ? index.children(key).length : 0;
    const rule = 'visibleWhen' in node && Boolean(node.visibleWhen);
    const linked = entry.bodyPath !== undefined;
    rows.push({ key, title: linked ? componentName(document, entry.component) ?? node.title : node.title, icon: (node as { icon?: { name: string } }).icon?.name, type: node.type, typeWord: typeName(node), container, count, rule, context: rowContext(node, count, container, rule),
      ...(linked ? { linked, places: entry.component ? componentUses(document, entry.component).length : 0 } : {}) });
    if (overlay && index.get(level)?.node?.type === 'overlay') {
      const at = overlay.children.findIndex(child => child.id === node.id);
      const word = at === 0 ? 'Base' : anchorWords[overlay.props.anchors.find(item => item.childId === node.id)?.anchor ?? 'top-trailing'];
      const last = rows[rows.length - 1];
      last.tags = [word];
      last.context = `${last.context} · ${word}`;
    }
  }
  return rows;
}

/** The page or sheet a key sits on. */
const surfaceOf = (index: DocumentIndex, key: SelectionKey): SelectionKey | undefined => {
  const entry = index.get(key);
  return entry?.kind === 'page' || entry?.kind === 'modal' ? key : entry?.surface;
};

/**
 * The path from the page (or sheet) down to the level's parent, outermost first. At the root, where there is no parent, it is the
 * page itself. The levels above a nested one are what the subtitle shows: the level's own name is the title, never a crumb.
 */
export function pathTo(document: CompositionDocument, index: DocumentIndex, level: SelectionKey): Crumb[] {
  const above = index.ancestors(level);
  const keys = above.length ? above : surfaceOf(index, level) ? [surfaceOf(index, level)!] : [];
  return keys.map(key => ({ key, title: levelName(document, index, key) }));
}

/** The levels from the page down to `level`, inclusive: the stack the sheet has pushed. */
export function trailTo(index: DocumentIndex, level: SelectionKey): SelectionKey[] {
  const above = index.ancestors(level);
  return [...above, level];
}

/**
 * The deepest level of a remembered trail that still exists and still sits where it did. A node deleted or moved away while its level
 * is open sends the sheet up to the nearest level that is left; the root of the trail is the fallback.
 */
export function survivingLevel(index: DocumentIndex, trail: readonly SelectionKey[]): SelectionKey {
  for (let at = trail.length - 1; at >= 0; at -= 1) {
    const key = trail[at], entry = index.get(key);
    if (!entry || !isLevel(index, key)) continue;
    const parent = trail[at - 1];
    if (at === 0 || index.ancestors(key).at(-1) === parent) return key;
  }
  return trail[0];
}

/** The level to open at: the selected node's own level (the one that holds it), else the root. */
export function openingLevel(index: DocumentIndex, root: SelectionKey, selection: SelectionKey | undefined): SelectionKey {
  const entry = selection ? index.get(selection) : undefined;
  if (!entry || entry.kind !== 'node' || entry.surface !== root || !entry.parent) return root;
  return entry.parent;
}

/** The word for a surface in copy: "Page", "Sheet" or "Modal" (see {@link surfaceWord}); empty for a node. */
export function surfaceWordOf(document: CompositionDocument, index: DocumentIndex, key: SelectionKey): string {
  const entry = index.get(key);
  if (entry?.kind === 'page') return 'Page';
  if (entry?.kind !== 'modal') return '';
  const modal = document.modals[Number(entry.path[1])];
  return modal ? surfaceWord(modal) : 'Sheet';
}

/** The text a level's title shows: "This Page", "This Sheet" or "This Modal" at the root, else the name of the container. */
export function levelTitle(document: CompositionDocument, index: DocumentIndex, level: SelectionKey): string {
  const word = surfaceWordOf(document, index, level);
  return word ? `This ${word}` : levelName(document, index, level);
}

/** One hit of {@link searchLevel}: the row and the titles from the level down to the row's parent, for its second line. */
export interface LevelHit { row: LevelRow; path: string[] }

/** Every row inside `level`, at any depth, whose title or type words contain `text`; each with its path. An empty search finds nothing. */
export function searchLevel(document: CompositionDocument, index: DocumentIndex, level: SelectionKey, text: string): LevelHit[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return [];
  const hits: LevelHit[] = [];
  const visit = (key: SelectionKey, path: string[]) => {
    for (const row of levelRows(document, index, key)) {
      if (row.title.toLowerCase().includes(needle) || row.typeWord.toLowerCase().includes(needle)) hits.push({ row, path });
      if (row.container) visit(row.key, [...path, row.title]);
    }
  };
  visit(level, [levelName(document, index, level)]);
  return hits;
}

/**
 * The lucide glyph of a node type, for a row whose node has no icon of its own (studio-ux2 lib3, L-icons table). A tab, page, sheet and
 * modal without an icon use the entries named by their kind. Any other type is `Component`.
 */
export const typeGlyphs: Readonly<Record<string, string>> = {
  tab: 'Dock', 'shared-area': 'Layers', page: 'Layers', sheet: 'PanelBottom', modal: 'AppWindow',
  section: 'Rows3', stack: 'LayoutList', repeat: 'Repeat', shape: 'Circle', symbol: 'Sparkles', chart: 'ChartColumn', 'linear-gauge': 'Gauge', 'tile-grid': 'LayoutGrid', 'status-rail': 'GalleryHorizontal', 'status-chip': 'Tag', 'status-pill': 'Tag', 'local-tabs': 'PanelsTopLeft', 'local-tab': 'SquareDashed',
  row: 'List', 'row-collection': 'ListTree', collection: 'ListTree', 'paged-row': 'ListTree', text: 'Type', 'info-box': 'Info', 'primary-button': 'RectangleHorizontal',
  'action-tile': 'Power', 'navigation-tile': 'CircleArrowRight', 'state-tile': 'Activity', 'bound-control': 'ToggleRight', 'local-control': 'ToggleRight', 'settings-link': 'Settings', 'settings-control': 'Settings2',
  'room-card': 'Sofa', 'room-chip': 'Tag', 'room-section': 'LayoutList', 'room-overview-tile': 'LayoutDashboard', 'room-navigation-grid': 'Grid2x2', 'light-group-tile': 'Lightbulb',
  'climate-control': 'Thermometer', 'weather-panel': 'CloudSun', 'alarm-panel': 'ShieldAlert', 'door-tile': 'DoorClosed', 'camera-tile': 'Cctv', 'camera-viewer': 'Cctv',
  'camera-video': 'Video', 'camera-controls': 'Video', 'remote-control': 'Gamepad2', 'bedroom-control': 'BedDouble', 'account-header': 'CircleUser', form: 'ClipboardList',
  'pinned-actions': 'Pin', 'recipe-part': 'Puzzle', 'bootstrap-message': 'MessageSquare', 'notification-permission-banner': 'BellRing',
  dial: 'CircleGauge', 'arc-track': 'Spline',
};
/** The glyph name of a type: its table entry, else `Component`. */
export const typeGlyph = (type: string): string => typeGlyphs[type] ?? 'Component';

const crumbWidth = (title: string) => title.length;
const widthOf = (items: { title: string }[], measure: (title: string) => number, gap: number) => items.reduce((sum, item) => sum + measure(item.title), 0) + (items.length - 1) * gap;

/**
 * Fits a path into `room` (the same unit as `measure`, characters by default; `gap` is what a separator takes). A path that fits is shown whole. One that does not
 * keeps its first and its last crumb, with one "…" for the middle ones that did not fit; the nearest levels are kept as long as
 * they fit. When even the first, the "…" and the last do not fit, those three are still returned and the last truncates in the
 * drawing. A path of one or two crumbs has nothing to hide.
 */
export function collapseCrumbs(path: readonly Crumb[], room: number, measure: (title: string) => number = crumbWidth, gap = 3): ShownCrumb[] {
  const whole = path.map(crumb => ({ crumb }));
  if (path.length <= 2 || widthOf([...path], measure, gap) <= room) return whole;
  const first = path[0], last = path[path.length - 1];
  for (let keep = path.length - 2; keep >= 1; keep -= 1) {
    const tail = path.slice(path.length - keep);
    if (widthOf([first, { title: '…' }, ...tail], measure, gap) <= room) return [{ crumb: first }, { hidden: path.slice(1, path.length - keep) }, ...tail.map(crumb => ({ crumb }))];
  }
  return [{ crumb: first }, { hidden: path.slice(1, -1) }, { crumb: last }];
}
