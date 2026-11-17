import { startTransition, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronDown, Plus, Search, Settings } from 'lucide-react';
import { buildDocumentIndex, selectionKey, type SelectionKey } from '../preview2/model';
import type { CompositionDocument } from '../shared/composition/schema';
import { valueAt } from '../composition-editor';
import { useAdd } from './add/AddHost';
import { canHold, endOf, refusalFor, type Destination } from './add/insert';
import { MOUSE_SLOP, TOUCH_DELAY, TOUCH_TOLERANCE, useDrag, type Locator } from './dnd/DragLayer';
import type { Cue } from './dnd/geometry';
import LibraryLevelHead, { RAIL_CRUMB } from './LibraryLevelHead';
import LibraryRow, { type TreeItem } from './LibraryRow';
import { categoryInfo } from './LibraryRail';
import { isOverlayLevel, levelName, levelRows, OVERLAY_SLOT, pathTo, searchLevel, type Crumb } from './levels';
import { moveTab, tabRoom } from './navigation/edit';
import { libraryGroups, type LibraryRow as ListRow, type SurfaceRef } from './outline';
import { NodeMenu, NodeMenuItems } from './PropertiesPanel';
import { TabMenu, TabMenuItems } from './LibraryTabMenu';
import RowGlyph from './RowGlyph';
import ListIconHost, { ListIconOnlyMenu } from './ListIconPicker';
import { listIcons, useListIcons } from './listIcons';
import { LibraryFooter, RowMenu, SurfaceMenuItems, type PagesActions } from './PagesPanel';
import { tabGroups } from './capacity';
import type { Library } from './useLibrary';
import { categoryOfSurface, enterLevel, followSelection, leaveLevel, rowKeyFor, setTrail, toggleOpen, trailOf, useTrailState, validTrail, type LibraryTrail } from './useLibraryTrail';
import type { TreeCategory } from './layout';
import { typeName } from './util';
import { AreaMenu, AreaMenuItems } from './layout/AreaMenu';
import { areaAt, insertArea, moveArea } from './layout/areaOps';
import { shownTabs, useShownTabsVersion } from '../preview2/shown-tabs';
import type { TabsNode } from '../shared/composition/layout-blocks';
import type { Workspace2 } from './useWorkspace2';

/** A hold over a closed container, or over Back and a crumb, this long opens or goes there (spring loading). */
export const SPRING_MS = 700;

/** The position of an area in a container's `blocks`, for the key of the area just added. */
const areasCount = (document: CompositionDocument, path: (string | number)[], areaId: string) => ((valueAt(document, path) as TabsNode).blocks ?? []).findIndex(block => block.id === areaId);
const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;
const titleCase = (words: string) => words.replace(/\b\w/g, letter => letter.toUpperCase());
/** The word a top-level row's glyph is picked by. */
const surfaceType = (category: TreeCategory, surface: SurfaceRef) => category === 'tabs' ? 'tab' : surface.kind === 'page' ? 'page' : category === 'modals' ? 'modal' : 'sheet';

/** Where a node would land just before another in its own container. */
function before(document: CompositionDocument, key: SelectionKey, index: NonNullable<Workspace2['index']>): Destination | undefined {
  const entry = index.get(key);
  return entry?.parent ? { list: entry.path.slice(0, -1), index: Number(entry.path.at(-1)), owner: entry.parent } : undefined;
}

interface Menu { key: SelectionKey; x: number; y: number }

/**
 * The library's lists of Tabs, Pages, Sheets and Modals (studio-ux2 lib3, L-tree, with the owner's G9 change). The root lists the
 * top-level rows; a click on one opens it in place, showing only its first-level children and the surface in the simulator. A click on a
 * child container goes into its level (its children, the path in the header) and selects it; a leaf is selected. The triangle opens any
 * container in place. Back and the path come out a level at a time. The handle at the trailing edge reorders, through the one drag layer.
 */
export default function LibraryTree({ ws, category, library, trailApi, onCategory, onKeepPanel, onError, onClose }: {
  ws: Workspace2; category: TreeCategory; library: Library; trailApi: LibraryTrail; onCategory: (category: TreeCategory) => void;
  /** A selection made here that must not close the panel where it and the inspector cannot both show. */
  onKeepPanel: (key: SelectionKey) => void; onError: (message: string) => void;
  /** Docked, Close sits in the header; the flyout has it in its pop-up row. */
  onClose?: () => void;
}) {
  const document = ws.document!, index = ws.index!;
  const add = useAdd(), drag = useDrag();
  // The levels' rows read each container's shown tab while they draw: they redraw when it changes.
  useShownTabsVersion();
  const state = useTrailState(trailApi), { update } = trailApi;
  const trail = useMemo(() => validTrail(index, trailOf(state, category)), [index, state, category]);
  const level = trail.at(-1);
  const atRoot = trail.length === 0;
  const open = useMemo(() => new Set(state.open), [state.open]);
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<'forward' | 'back'>();
  const [activeKey, setActiveKey] = useState<SelectionKey>();
  const [menu, setMenu] = useState<Menu>();
  const [lift, setLift] = useState<{ key: SelectionKey; to: number }>();
  const [tabCue, setTabCue] = useState<number>();
  const [said, setSaid] = useState('');
  const [refusal, setRefusal] = useState<string>();
  const refusalTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(refusalTimer.current), []);
  const list = useRef<HTMLDivElement>(null);
  const use = ws.mode === 'use';
  /** The icons the person chose for rows (L-icons): read once, and dropped for rows the document no longer has. */
  const picked = useListIcons();
  useEffect(() => { void listIcons.load(); }, []);
  useEffect(() => { listIcons.prune(index); }, [index]);
  const info = categoryInfo[category];
  const surfaceKey = (surface: SurfaceRef) => selectionKey(surface.kind, surface.id);

  // --- What is drawn -----------------------------------------------------------------------------------------
  const groups = useMemo(() => libraryGroups(document, category), [document, category]);
  const nodeItems = (parent: SelectionKey, depth: number): TreeItem[] => levelRows(document, index, parent).flatMap(row => {
    const node = index.get(row.key)?.kind === 'node';
    // An area: its handle appears only when order matters (a container with `blocks`), and its title is muted when the simulator shows none of its tabs.
    const area = row.area ? areaAt(document, index, row.key) : undefined;
    const parentId = area?.node.id, shownTab = parentId ? shownTabs.get(parentId) ?? area?.node.tabs[0]?.id : undefined;
    const muted = Boolean(row.area && shownTab && !row.area.tabIds.includes(shownTab));
    const item: TreeItem = { key: row.key, title: row.title, icon: row.icon, type: row.type, tags: [...(row.rule ? ['Rule'] : []), ...(row.tags ?? [])], count: row.count, container: row.container, depth, open: open.has(row.key), root: false, movable: node ? 'node' : area && area.node.blocks ? 'area' : false, hasMenu: node || Boolean(area), muted: muted || undefined, chosen: picked[row.key], ...(row.linked ? { linked: { places: row.places ?? 0 } } : {}) };
    return [item, ...(item.open && row.container ? nodeItems(row.key, depth + 1) : [])];
  });
  const rootItems = (row: ListRow): TreeItem[] => {
    const surface = surfaceKey(row.surface);
    const item: TreeItem = { key: row.key, title: row.title, icon: row.icon, type: surfaceType(category, row.surface), tags: row.tags, count: index.children(surface).length, container: true, depth: 0, open: open.has(row.key), root: true, movable: category === 'tabs' && document.navigation.tabs.length > 1 ? 'tab' : false, hasMenu: true, chosen: picked[row.key] };
    return [item, ...(item.open ? nodeItems(surface, 1) : [])];
  };
  const needle = query.trim().toLowerCase();
  const rootGroups = groups.map(group => ({ ...group, rows: group.rows.filter(row => !needle || row.title.toLowerCase().includes(needle)) })).filter(group => group.rows.length);
  const hits = !atRoot && needle ? searchLevel(document, index, level!, query) : [];
  const levelItems = !atRoot && !needle ? nodeItems(level!, 0) : [];
  const visible: TreeItem[] = atRoot ? rootGroups.flatMap(group => (library.groupOpen(group.id, true) ? group.rows.flatMap(rootItems) : [])) : levelItems;
  const handleColumn = visible.some(item => item.movable);
  const visibleKeys = useMemo(() => new Set(visible.map(item => item.key)), [visible]);
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const summary = category === 'tabs'
    ? (document.navigation.tabs.length ? `${document.navigation.tabs.length} of ${tabGroups[0].capacity ?? 5} in the tab bar` : 'Not using a tab bar')
    : plural(total, category === 'pages' ? 'page' : category === 'sheets' ? 'sheet' : 'modal');
  const tabLabel = (page: SelectionKey) => document.navigation.tabs.find(tab => `page:${tab.pageId}` === page)?.label;
  const above: Crumb[] = atRoot ? [] : [{ key: RAIL_CRUMB, title: info.label }, ...pathTo(document, index, level!).map((crumb, at) => at === 0 && category === 'tabs' ? { ...crumb, title: tabLabel(crumb.key) ?? crumb.title } : crumb)];
  const title = atRoot ? info.label : levelName(document, index, level!);

  // --- Moving through levels -------------------------------------------------------------------------------
  const openRow = (state_: typeof state, surface: SelectionKey) => toggleOpen(state_, rowKeyFor(document, category, surface), true);
  const toRoot = (surface?: SelectionKey) => { setDirection('back'); setQuery(''); update(old => { const next = setTrail(old, category, []); return surface ? openRow(next, surface) : next; }); };
  const goInto = (key: SelectionKey) => { setDirection('forward'); setQuery(''); update(old => enterLevel(old, category, index, key)); };
  const back = () => { setDirection('back'); setQuery(''); update(old => { const next = leaveLevel(old, category); return trail.length <= 2 ? openRow(next, trail[0]) : next; }); };
  const jump = (key: SelectionKey) => {
    if (key === RAIL_CRUMB) { toRoot(); return; }
    if (index.get(key)?.kind === 'page' || index.get(key)?.kind === 'modal') { toRoot(key); return; }
    setDirection('back'); setQuery(''); update(old => enterLevel(old, category, index, key));
  };

  // --- Following the simulator -------------------------------------------------------------------------------
  // A selection made on the canvas moves the panel to the rail item that owns its surface and to the level that holds it. One the panel already
  // shows (a row clicked here) leaves it where it is.
  // Starting from the selection at mount, so opening the panel from a rail button shows the list that was asked for.
  const lastSeen = useRef<SelectionKey | undefined>(ws.selection);
  useEffect(() => {
    const selection = ws.selection;
    if (!selection || selection === lastSeen.current) return;
    lastSeen.current = selection;
    if (visibleKeys.has(selection) || trail.includes(selection) || hits.some(hit => hit.row.key === selection)) return;
    const found = followSelection(document, index, selection);
    if (!found) return;
    // A transition: a drop selects the tile, and drawing the panel's new level must not be part of the drop's own task.
    startTransition(() => {
      update(old => openRow(setTrail(old, found.category, found.trail), found.surface));
      if (found.category !== category) library.show(found.category);
    });
    window.requestAnimationFrame(() => list.current?.querySelector(`[data-row="${selection}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [ws.selection]); // eslint-disable-line react-hooks/exhaustive-deps
  // The simulator moves to another surface by itself (a tap in Use, an Undo): a panel inside a surface goes to the new one, one at a root stays.
  const shownKey = ws.surface ? surfaceKey(ws.surface) : undefined;
  const lastShown = useRef(shownKey);
  useEffect(() => {
    // Only a change while the panel is open: opening it from a rail button keeps the list that was asked for.
    if (lastShown.current === shownKey) return;
    lastShown.current = shownKey;
    if (!shownKey || !trail.length || trail[0] === shownKey) return;
    const next = categoryOfSurface(document, shownKey);
    update(old => openRow(setTrail(old, category, []), shownKey));
    if (next !== category) library.show(next);
  }, [shownKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Row actions -----------------------------------------------------------------------------------------------
  const actions: PagesActions = {
    onSettings: surface => ws.selectAnywhere(surfaceKey(surface)),
    onChange: ws.studio.apply,
    onShow: surface => { ws.setSurface(surface); ws.select(undefined); },
  };
  const toggle = (item: TreeItem, event?: MouseEvent) => {
    const family = event?.altKey ? descendants(item.key) : [];
    update(old => toggleOpen(old, item.key, undefined, family));
  };
  const descendants = (key: SelectionKey): SelectionKey[] => {
    const out: SelectionKey[] = [];
    const walk = (parent: SelectionKey) => { for (const row of levelRows(document, index, parent)) if (row.container) { out.push(row.key); walk(row.key); } };
    const entry = index.get(key);
    walk(entry?.kind === 'tab' ? selectionKey('page', (entry && document.navigation.tabs.find(tab => `tab:${tab.id}` === key)?.pageId) ?? '') : key);
    return out;
  };
  const activate = (item: TreeItem, event?: MouseEvent | KeyboardEvent) => {
    setActiveKey(item.key);
    if (item.root) {
      const row = groups.flatMap(group => group.rows).find(candidate => candidate.key === item.key)!;
      // A top-level row opens in place and shows its surface; a second click on the one on show closes it.
      const showing = ws.surface?.kind === row.surface.kind && ws.surface.id === row.surface.id;
      ws.setSurface(row.surface); ws.select(undefined);
      update(old => toggleOpen(old, item.key, !(item.open && showing)));
      return;
    }
    if (event && 'altKey' in event && event.altKey && item.container) { toggle(item, event as MouseEvent); return; }
    if (item.container) {
      if (index.get(item.key)?.kind === 'node') { onKeepPanel(item.key); ws.selectAnywhere(item.key); }
      goInto(item.key);
      return;
    }
    ws.selectAnywhere(item.key);
  };
  const moveTabs = (key: SelectionKey, to: number) => {
    const from = document.navigation.tabs.findIndex(tab => `tab:${tab.id}` === key);
    try { ws.studio.apply(moveTab(document, from, to)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const moreOf = (item: TreeItem) => {
    if (use) return <ListIconOnlyMenu rowKey={item.key} title={item.title}/>;
    if (!item.root && index.get(item.key)?.kind === 'local-tab') return <AreaMenu ws={ws} areaKey={item.key} title={item.title} onError={onError}/>;
    if (!item.root) { const entry = index.get(item.key)!; return <NodeMenu ws={ws} path={entry.path} selectionKey={item.key} onError={onError} label={`More for ${item.title}`} className="w2-icon-button"/>; }
    const tab = document.navigation.tabs.findIndex(candidate => `tab:${candidate.id}` === item.key);
    if (tab >= 0) return <TabMenu ws={ws} tabKey={item.key} title={item.title} at={tab} count={document.navigation.tabs.length} onMove={moveTabs}/>;
    const row = groups.flatMap(group => group.rows).find(candidate => candidate.key === item.key)!;
    return <RowMenu document={document} surface={row.surface} title={item.title} actions={actions}/>;
  };

  // --- The context menu ----------------------------------------------------------------------------------------
  const openMenu = (item: TreeItem) => (event: MouseEvent | KeyboardEvent) => {
    if (use || !item.hasMenu) return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const point = 'clientX' in event && event.clientX ? { x: event.clientX, y: event.clientY } : { x: box.left + 24, y: box.top + box.height / 2 };
    setMenu({ key: item.key, ...point });
  };
  const anchor = useMemo(() => menu ? { getBoundingClientRect: () => new DOMRect(menu.x, menu.y, 0, 0) } : undefined, [menu]);

  // --- Keyboard through the rows ---------------------------------------------------------------------------------
  const rows = () => [...(list.current?.querySelectorAll<HTMLElement>('[role=treeitem]') ?? [])];
  const focusRow = (row: HTMLElement | undefined) => { if (!row) return; setActiveKey(row.getAttribute('data-row') as SelectionKey); row.focus(); };
  const treeKeys = (event: KeyboardEvent<HTMLElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[role=treeitem]');
    if (!row || event.target !== row) return;
    const all = rows(), at = all.indexOf(row), key = row.getAttribute('data-row') as SelectionKey;
    const item = visible.find(candidate => candidate.key === key);
    const go = (target: HTMLElement | undefined) => { event.preventDefault(); focusRow(target); };
    if (event.key === 'ArrowDown') go(all[at + 1]);
    else if (event.key === 'ArrowUp') go(all[at - 1]);
    else if (event.key === 'Home') go(all[0]);
    else if (event.key === 'End') go(all.at(-1));
    else if (event.key === 'ArrowRight' && item?.container && !item.open) { event.preventDefault(); update(old => toggleOpen(old, key, true)); }
    else if (event.key === 'ArrowRight' && item?.open) go(all[at + 1]);
    else if (event.key === 'ArrowLeft' && item) {
      event.preventDefault();
      if (item.open) update(old => toggleOpen(old, key, false));
      else { const level_ = Number(row.getAttribute('aria-level')); for (let up = at - 1; up >= 0; up -= 1) if (Number(all[up].getAttribute('aria-level')) < level_) { focusRow(all[up]); break; } }
    }
  };

  // --- Dragging ------------------------------------------------------------------------------------------------------
  // A drag outlives the render it began in: the locator reads the newest list, level and document through this.
  const latest = useRef({ visible, document, index, jump });
  latest.current = { visible, document, index, jump };
  const hover = useRef<{ target: string; timer: number } | undefined>(undefined);
  const clearHover = () => { if (hover.current) window.clearTimeout(hover.current.timer); hover.current = undefined; };
  useEffect(() => clearHover, []);
  /** Holds over `target` for {@link SPRING_MS} and then does `fire`; a different target restarts it. */
  const spring = (target: string | undefined, fire: () => void) => {
    if (!target) { clearHover(); return; }
    if (hover.current?.target === target) return;
    clearHover();
    hover.current = { target, timer: window.setTimeout(fire, SPRING_MS) };
  };
  const cueOnRows = (destination: Destination): Cue | undefined => {
    const host = list.current;
    if (!host) return undefined;
    const rowOf = (key: SelectionKey | undefined) => key ? host.querySelector<HTMLElement>(`[data-row="${key}"]`) : null;
    const siblings = latest.current.index.children(destination.owner);
    const next = rowOf(siblings[destination.index]), last = rowOf(siblings[destination.index - 1]) ?? rowOf(destination.owner);
    const anchorRow = next ?? last;
    if (!anchorRow) return undefined;
    const box = anchorRow.getBoundingClientRect();
    return { line: { left: box.left + 8, top: (next ? box.top : box.bottom) - 1, width: box.width - 16, height: 3 }, name: '', vertical: false };
  };
  /** The line a refused drop says, shown under the list until the next drag (and read out). */
  const refuse = (line: string) => { setRefusal(line); setSaid(line); window.clearTimeout(refusalTimer.current); refusalTimer.current = window.setTimeout(() => setRefusal(undefined), 4000); };
  const within = (key: SelectionKey, ancestor: SelectionKey) => key === ancestor || latest.current.index.ancestors(key).includes(ancestor);
  const locate = (dragged: SelectionKey): Locator => (x, y) => {
    const host = list.current;
    if (!host) return undefined;
    const { document: doc, index: idx, visible: shown } = latest.current;
    const type = idx.get(dragged)?.node?.type ?? '';
    // Back and a crumb take the node to the end of their level; held over, they go there.
    for (const element of window.document.querySelectorAll<HTMLElement>('.w2-lib-level-head [data-drop-level]')) {
      const box = element.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      const target = element.getAttribute('data-drop-level') as SelectionKey;
      spring(`level:${target}`, () => latest.current.jump(target));
      const destination = endOf(doc, target);
      return destination && canHold(doc, target, type) && !within(target, dragged) ? { destination, cue: { line: { left: box.left, top: box.bottom - 2, width: box.width, height: 3 }, container: { left: box.left, top: box.top, width: box.width, height: box.height }, name: '', vertical: false } } : undefined;
    }
    for (const element of host.querySelectorAll<HTMLElement>('[data-row]')) {
      const box = element.getBoundingClientRect();
      if (y < box.top || y > box.bottom || x < box.left || x > box.right) continue;
      const key = element.getAttribute('data-row') as SelectionKey;
      if (within(key, dragged)) { spring(undefined, () => undefined); return undefined; }
      const item = shown.find(candidate => candidate.key === key);
      if (item?.container && !item.open) spring(`row:${key}`, () => update(old => toggleOpen(old, key, true))); else spring(undefined, () => undefined);
      const entry = idx.get(key);
      const frac = (y - box.top) / box.height;
      const options: Destination[] = [];
      if (frac > 0.25 && frac < 0.75 && item?.container) {
        let owner = entry?.kind === 'tab' ? selectionKey('page', doc.navigation.tabs.find(tab => `tab:${tab.id}` === key)?.pageId ?? '') : key;
        // A drop on a tab container's own row adds to the last area that shows on the tab in view: no drop creates an area.
        if (entry?.node?.type === 'local-tabs') {
          const shownTab = shownTabs.get(entry.node.id) ?? (entry.node as TabsNode).tabs[0]?.id;
          const here = idx.children(key).filter(child => idx.get(child)?.tabs?.includes(shownTab ?? ''));
          owner = here.at(-1) ?? owner;
        }
        const end = endOf(doc, owner);
        if (end && canHold(doc, owner, type)) options.push(end);
        else { const why = refusalFor(doc, owner, type); if (why) refuse(why); }
      }
      if (entry?.kind === 'local-tab') { const why = refusalFor(doc, key, type); if (why) refuse(why); }
      const side = entry?.kind === 'node' ? (() => { const b = before(doc, key, idx); return b ? (frac < 0.5 ? b : { ...b, index: b.index + 1 }) : undefined; })() : undefined;
      if (side && canHold(doc, side.owner, type)) options.push(side);
      const destination = options[0];
      const cue = destination && cueOnRows(destination);
      return destination && cue ? { destination, cue } : undefined;
    }
    spring(undefined, () => undefined);
    return undefined;
  };
  const handleDown = (item: TreeItem) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || use) return;
    event.preventDefault();
    const row = event.currentTarget.closest<HTMLElement>('[data-row]');
    const start = { x: event.clientX, y: event.clientY }, touch = event.pointerType === 'touch';
    if (item.movable === 'tab') { dragTab(event, item, row); return; }
    if (item.movable === 'area') { dragArea(event, item, row); return; }
    if (!drag) return;
    let started = false, last = start, timer = 0;
    const begin = (point: { x: number; y: number }) => { started = true; drag.begin({ key: item.key, mode: touch ? 'touch' : 'mouse', point, locate: locate(item.key), ghostOf: row }); drag.move(last.x, last.y); };
    const stop = () => { window.clearTimeout(timer); clearHover(); window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('pointerdown', other, true); };
    const moved = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      last = { x: e.clientX, y: e.clientY };
      const away = Math.hypot(last.x - start.x, last.y - start.y);
      if (!started) {
        if (touch) { if (away > TOUCH_TOLERANCE) stop(); return; }
        if (away < MOUSE_SLOP) return;
        begin(start);
      }
      drag.move(last.x, last.y);
    };
    const up = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; stop(); if (started) drag.end(); };
    const cancel = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; stop(); if (started) drag.cancel(); };
    const other = (e: PointerEvent) => { if (e.pointerId === event.pointerId) return; stop(); if (started) drag.cancel(); };
    if (touch) timer = window.setTimeout(() => begin(last), TOUCH_DELAY);
    window.addEventListener('pointermove', moved); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('pointerdown', other, true);
  };
  /** The tab bar is a list of its own: a handle drag reorders it by the rows' midpoints, and one drop is one undo step. */
  const dragTab = (event: ReactPointerEvent<HTMLButtonElement>, item: TreeItem, row: HTMLElement | null) => {
    const tabs = () => [...(list.current?.querySelectorAll<HTMLElement>('[data-row^="tab:"]') ?? [])];
    const from = document.navigation.tabs.findIndex(tab => `tab:${tab.id}` === item.key);
    const start = { x: event.clientX, y: event.clientY };
    let started = false, to = from;
    const slot = (y: number) => { const boxes = tabs().map(element => element.getBoundingClientRect()); let at = boxes.findIndex(box => y < box.top + box.height / 2); if (at < 0) at = boxes.length; return at; };
    const stop = () => { window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); row?.removeAttribute('data-dragging'); setTabCue(undefined); };
    const moved = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      if (!started) { if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < MOUSE_SLOP) return; started = true; row?.setAttribute('data-dragging', ''); }
      const at = slot(e.clientY);
      to = at > from ? at - 1 : at;
      const boxes = tabs().map(element => element.getBoundingClientRect()), host = list.current!.getBoundingClientRect();
      setTabCue((at >= boxes.length ? boxes.at(-1)!.bottom : boxes[at].top) - host.top);
    };
    const up = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; stop(); if (started && to !== from) moveTabs(item.key, to); };
    const cancel = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; stop(); };
    window.addEventListener('pointermove', moved); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };
  /** Areas are a list of their own: a handle drag reorders them by the rows' midpoints, and one drop is one undo step. */
  const dragArea = (event: ReactPointerEvent<HTMLButtonElement>, item: TreeItem, row: HTMLElement | null) => {
    const at = areaAt(document, index, item.key);
    if (!at) return;
    const areas = () => [...(list.current?.querySelectorAll<HTMLElement>('[data-row^="local-tab:"]') ?? [])];
    const start = { x: event.clientX, y: event.clientY };
    let started = false, to = at.position;
    const slot = (y: number) => { const boxes = areas().map(element => element.getBoundingClientRect()); const found = boxes.findIndex(box => y < box.top + box.height / 2); return found < 0 ? boxes.length : found; };
    const stop = () => { window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); row?.removeAttribute('data-dragging'); setTabCue(undefined); };
    const moved = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      if (!started) { if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < MOUSE_SLOP) return; started = true; row?.setAttribute('data-dragging', ''); }
      const place = slot(e.clientY);
      to = place > at.position ? place - 1 : place;
      const boxes = areas().map(element => element.getBoundingClientRect()), host = list.current!.getBoundingClientRect();
      setTabCue((place >= boxes.length ? boxes.at(-1)!.bottom : boxes[place].top) - host.top);
    };
    const up = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; stop(); if (started && to !== at.position) { try { ws.studio.apply(moveArea(document, at, to - at.position)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } } };
    const cancel = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; stop(); };
    window.addEventListener('pointermove', moved); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };
  const handleKey = (item: TreeItem) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (use) return;
    if (item.movable === 'area') {
      // Up and Down on the handle move the area one place; the line says where it went.
      const at = areaAt(document, index, item.key);
      if (at && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const offset = event.key === 'ArrowDown' ? 1 : -1, to = at.position + offset;
        if (to >= 0 && to < at.areas.length) { ws.studio.apply(moveArea(document, at, offset)); setSaid(`Moved ${item.title} to place ${to + 1} of ${at.areas.length}.`); }
      }
      return;
    }
    if (item.movable === 'tab') {
      const count = document.navigation.tabs.length;
      const from = document.navigation.tabs.findIndex(tab => `tab:${tab.id}` === item.key);
      if (!lift && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); event.stopPropagation(); setLift({ key: item.key, to: from }); setSaid(`Picked up ${item.title}. Tab ${from + 1} of ${count}. Use the arrow keys to move it, Space to drop, Escape to cancel.`); }
      else if (lift && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); const to = Math.max(0, Math.min(count - 1, lift.to + (event.key === 'ArrowDown' ? 1 : -1))); setLift({ key: item.key, to }); setSaid(`Tab ${to + 1} of ${count}.`); }
      else if (lift && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); setLift(undefined); if (lift.to !== from) { moveTabs(item.key, lift.to); setSaid(`Moved ${item.title} to ${lift.to + 1} of ${count}.`); } }
      else if (lift && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLift(undefined); setSaid('Cancelled.'); }
      return;
    }
    if ((event.key === ' ' || event.key === 'Enter') && drag && !drag.active) { event.preventDefault(); event.stopPropagation(); drag.startKeyboard(item.key, cueOnRows); }
  };

  // --- Drawing ---------------------------------------------------------------------------------------------------------
  const first = visible[0]?.key;
  const activeAt = activeKey && visibleKeys.has(activeKey) ? activeKey : first;
  const renderItem = (item: TreeItem) => <LibraryRow key={item.key} item={item} selected={ws.selection === item.key} shown={item.root && ws.surface !== undefined && item.key !== undefined && surfaceKey(ws.surface) === (item.key.startsWith('tab:') ? `page:${document.navigation.tabs.find(tab => `tab:${tab.id}` === item.key)?.pageId}` : item.key)}
    active={item.key === activeAt} handleColumn={handleColumn} use={use} more={moreOf(item)}
    onActivate={event => activate(item, event)} onToggle={event => { event.stopPropagation(); setActiveKey(item.key); toggle(item, event); }}
    onHandleDown={handleDown(item)} onHandleKey={handleKey(item)} onContext={openMenu(item)}/>;
  const empty = category === 'tabs' ? `No tabs yet. The app starts on ${document.pages.find(page => page.id === document.navigation.initialPageId)?.title ?? 'its first page'}.`
    : category === 'pages' ? 'Every page is a tab.' : category === 'sheets' ? 'No sheets yet.' : 'No modals yet. A modal covers the whole screen.';
  const tabbedHits = category === 'pages' && needle ? document.navigation.tabs.filter(tab => (document.pages.find(page => page.id === tab.pageId)?.title ?? '').toLowerCase().includes(needle)) : [];
  const noun = category === 'tabs' ? 'tab' : category === 'pages' ? 'page' : category === 'sheets' ? 'sheet' : 'modal';
  const placeholder = atRoot ? `Find a ${noun}` : `Find in ${title}`;
  const chosen = (key: SelectionKey) => {
    const parent = index.get(key)?.parent, surface = index.get(key)?.surface;
    setQuery('');
    ws.selectAnywhere(key);
    if (parent && surface && parent !== surface) { setDirection('forward'); update(old => enterLevel(old, category, index, parent)); } else if (surface) toRoot(surface);
    if (index.get(key)?.kind === 'node') onKeepPanel(key);
  };

  const here = level ? index.get(level) : undefined;
  const settingsKey = level;
  const settingsEntry = settingsKey ? index.get(settingsKey) : undefined;
  const settingsName = here?.kind === 'local-tab' ? 'Area Settings' : `${titleCase(typeName(settingsEntry?.node ?? 'section'))} Settings`;
  const tabsHere = here?.node?.type === 'local-tabs' ? { node: here.node as TabsNode, path: here.path } : undefined;
  const addArea = (shared: boolean) => {
    if (!tabsHere) return;
    // A new area goes after the selected one, else at the end; a Tab Area is for the tab on show.
    const selected = ws.selection && index.get(ws.selection)?.kind === 'local-tab' && index.get(ws.selection)?.parent === level ? ws.selection.split('/').at(-1) : undefined;
    try {
      const made = insertArea(document, tabsHere.path, tabsHere.node, { shared, tabId: shownTabs.get(tabsHere.node.id), after: selected });
      ws.studio.apply(made.document);
      const key = buildDocumentIndex(made.document).keyAt([...tabsHere.path, 'blocks', areasCount(made.document, tabsHere.path, made.areaId)]);
      if (key) ws.select(key);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const destination = level ? endOf(document, level) : undefined;
  const footer = atRoot
    ? <LibraryFooter scope={category} disabled={use} tabReason={category === 'tabs' ? tabRoom(document).reason : undefined} onEditTabs={() => { ws.select(undefined); ws.setPanel('tabs'); }}/>
    : tabsHere
    ? <footer className="w2-lib-foot w2-area-foot" aria-label="Add Area">
        <button type="button" className="w2-level-add" disabled={use} onClick={() => addArea(true)}><Plus size={16} aria-hidden/>Shared Area</button>
        <button type="button" className="w2-level-add" disabled={use} onClick={() => addArea(false)}><Plus size={16} aria-hidden/>Tab Area</button>
        <button type="button" className="w2-icon-button w2-area-settings" aria-label="Tabs Settings" title="Tabs Settings" onClick={() => { onKeepPanel(level!); ws.selectAnywhere(level!); }}><Settings size={16} aria-hidden/></button>
      </footer>
    : <footer className="w2-lib-foot" aria-label="Add Here">
        <button type="button" className="w2-primary w2-level-add" disabled={use || !add || !destination || !add.accepts(destination)} onClick={() => { if (add && destination) add.open(destination); }}><Plus size={14} aria-hidden/>Add Here</button>
        <button type="button" aria-label={settingsName} onClick={() => { if (settingsKey) { onKeepPanel(settingsKey); ws.selectAnywhere(settingsKey); } }}>Settings</button>
      </footer>;
  const menuItem = menu ? visible.find(item => item.key === menu.key) : undefined;
  const menuTab = menuItem?.key.startsWith('tab:') ? document.navigation.tabs.findIndex(tab => `tab:${tab.id}` === menuItem.key) : -1;
  const menuRow = menuItem?.root && menuTab < 0 ? groups.flatMap(group => group.rows).find(candidate => candidate.key === menuItem.key) : undefined;
  const menuNode = menuItem && !menuItem.root ? index.get(menuItem.key) : undefined;
  const menuArea = menuNode?.kind === 'local-tab';

  return <ListIconHost rowOf={key => list.current?.querySelector<HTMLElement>(`[data-row="${key}"]`) ?? null}><div className="w2-pages w2-tree-host" data-library={category} data-testid="library-tree" data-level={atRoot ? 'root' : 'level'}>
    <LibraryLevelHead title={title} summary={summary} path={above} onBack={back} onJump={jump} onClose={onClose}/>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder={placeholder} aria-label={placeholder} value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div className="w2-pages-scroll w2-lib-scroll" data-base-ui-swipe-ignore>
      <div key={trail.join('|') || 'root'} className="w2-level-view" data-direction={direction}>
        <div ref={list} className="w2-tree-list" data-testid="library-list" onKeyDown={treeKeys} style={{ position: 'relative' }}>
          {!atRoot && needle
            ? (hits.length === 0 ? <p className="w2-empty">Nothing in {title} matches.</p>
              : <div role="tree" aria-label={`Results in ${title}`}>{hits.map(({ row, path }) => <div key={row.key} role="treeitem" className="w2-tree-row w2-tree-hit" data-row={row.key} tabIndex={0} aria-level={1} onClick={() => chosen(row.key)} onKeyDown={event => { if (event.key === 'Enter') chosen(row.key); }}>
                <span className="w2-tree-slot"/><span className="w2-tree-icon"><RowGlyph icon={picked[row.key] ?? row.icon} type={row.type}/></span>
                <span className="w2-tree-text"><span className="w2-tree-title">{row.title}</span><span className="w2-tree-path">{path.join(` › `)}</span></span></div>)}</div>)
            : atRoot
              ? (rootGroups.length === 0 ? <p className="w2-empty">{needle ? `No ${noun}s match.` : empty}</p>
                : rootGroups.map(group => {
                  const shown = library.groupOpen(group.id, true), plain = group.id === 'tabs' || group.id === 'start';
                  const rows = group.rows.flatMap(rootItems);
                  return <section key={group.id} aria-label={group.title}>
                    {!plain && <h3 className="w2-group-title w2-tree-group"><button type="button" className="w2-tree-group-button" aria-expanded={shown} onClick={() => library.setGroup(group.id, !shown)}><ChevronDown size={12} aria-hidden data-open={shown || undefined}/><span>{group.title}</span><span className="w2-tree-count">{group.rows.length}</span></button></h3>}
                    {shown && <div role="tree" aria-label={group.title}>{rows.map(renderItem)}</div>}
                  </section>;
                }))
              : (levelItems.length === 0 ? (isOverlayLevel(index, level!) ? <p className="w2-empty w2-overlay-slot" data-testid="overlay-slot">{OVERLAY_SLOT}</p> : <p className="w2-empty">Nothing here yet.</p>) : <div role="tree" aria-label={title}>{levelItems.map(renderItem)}</div>)}
          {tabCue !== undefined && <div className="w2-cue-line w2-tree-cue" aria-hidden style={{ position: 'absolute', insetInline: 8, top: tabCue - 1, height: 3 }}/>}
        </div>
        {atRoot && tabbedHits.map(tab => <p key={tab.id} className="w2-tree-note">{document.pages.find(page => page.id === tab.pageId)?.title} is a tab. <button type="button" onClick={() => { setQuery(''); onCategory('tabs'); }}>Show in Tabs</button></p>)}
      </div>
    </div>
    {refusal && <p className="w2-tree-note w2-tree-refusal">{refusal}</p>}
    <p className="w2-sr" role="status" aria-live="polite">{said}</p>
    {footer}
    {menu && anchor && (menuRow || menuNode || menuTab >= 0) && <Menu.Root open onOpenChange={next => { if (!next) setMenu(undefined); }}>
      <Menu.Portal><Menu.Positioner anchor={anchor} side="bottom" align="start" sideOffset={2} className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" data-testid="row-menu" aria-label={`${menuItem?.title} menu`}>
        {menuTab >= 0 ? <TabMenuItems ws={ws} tabKey={menu.key} at={menuTab} count={document.navigation.tabs.length} onMove={moveTabs}/> : menuRow ? <SurfaceMenuItems document={document} surface={menuRow.surface} actions={actions}/> : menuArea ? <AreaMenuItems ws={ws} areaKey={menu.key} onError={onError}/> : menuNode ? <NodeMenuItems ws={ws} path={menuNode.path} selectionKey={menu.key} onError={onError}/> : null}
      </Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root>}
  </div></ListIconHost>;
}
