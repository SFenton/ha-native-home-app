import { shownTabs } from '../shown-tabs';
import { Fragment, memo, use, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { EyeOff } from 'lucide-react';
import { createPortal } from 'react-dom';
import { compositionChildren, type CompositionNode } from '../../shared/composition/schema';
import { areasOf, areasOnTab, tabBarOf, type Area } from '../../shared/composition/layout-blocks';
import { ruleHolds, tabOnShow } from '../../shared/composition/evaluator';
import { renderProbe } from '../probe';
import type { SelectionKey } from '../model';
import { useIsSelected } from '../selection-store';
import { TabBar } from './TabBar';
import './layout.css';
import { nodeIsShown } from '../evaluate';
import { MAX_TILE_COLUMNS } from '../grid';
import { lineStyle, useFoldedGrid } from './useFoldedGrid';
import { useTabHint } from '../selection-store';
import { useRender } from '../render-context';
import { TabDockContext, docksAtBottom } from '../tab-dock';
import { arrange, groupStates, type GridGroups, type GroupState } from '../../shared/composition/grid-groups';
import { GridFaces, useRegroupMotion } from '../grid-groups';
import { Children } from './Children';
import { GridPlacement } from './grid-placement';
import { HorizontalScroller } from './HorizontalScroller';
import { settingsRowMinimum } from './settings-minimum';
import { nodeMinimumWidth } from './tile-minimum';
import { points, type NodeOf } from './shared';

/** The smallest tile width each grid rule asks for (`tile@1`, Dynamic Type, wide sections). */
const minimumWidth = { 'tile@1': 150, 'tile-dynamic-type@1': 150, 'section-wide@1': 340 } as const;

/** What a {@link FoldedGridBox} draws. */
interface FoldedGridBoxProps {
  nodes: readonly NodeOf<'tile-grid'>['children'][number][];
  owner: `node:${string}`;
  minimum: number; maxColumns: number; gap: number;
  /** `minimumColumns` of the grid (`sh.grid-min-columns@1`). */
  minimumColumns?: number;
  /** `shortRow: leading` turns the short-row fill off. */
  fill: boolean;
  /** Whether the grid avoids the Duo's hinge on a page. */
  follows: boolean;
  equal: boolean;
  /** Tracks every item takes as one: the room section's joined lead row drops the spans (`UKRoomSectionContent`). */
  ignoreSpans?: boolean;
  /** Tiles under a heading for the state they draw (`sh.grid-state-groups@1`): the same grid, with a full-row heading before each group that has a tile. */
  groups?: GridGroups;
}
/** A heading and the tiles of a grouped grid, in drawn order. */
type GroupedItem = { kind: 'heading'; key: string; title: string; group: string } | { kind: 'tile'; key: string; child: FoldedGridBoxProps['nodes'][number]; group: string };
/**
 * One grid of the app's `UKDynamicGridView`: columns at least `minimum` wide, each child spanning its `layout.span`. Once measured, a
 * short row fills as the app's grid does (one row shares the width, several fill in whole tracks, unless `fill` is off), a grid that
 * follows the fold takes an even track count where the hinge crosses it, and in the book pose two regions around the band. Until
 * measured the CSS `auto-fill` columns stand in.
 */
function FoldedGridBox({ nodes, owner, minimum, maxColumns, gap, minimumColumns, fill, follows, equal, ignoreSpans, groups }: FoldedGridBoxProps) {
  const ctx = useRender();
  const ref = useRef<HTMLDivElement>(null);
  const shown = nodes.filter(child => ctx.mode === 'edit' || nodeIsShown(child, ctx.env, ctx.previous.get(child.id)));
  // Group by state: the tiles say which face they draw (until they have, every tile is idle), and the grid draws the headings and the tiles in one list.
  const [faces, setFaces] = useState<ReadonlyMap<string, GroupState>>(() => new Map());
  const report = useCallback((id: string, state: GroupState) => setFaces(previous => previous.get(id) === state ? previous : new Map(previous).set(id, state)), []);
  const items = useMemo<GroupedItem[] | undefined>(() => groups
    ? arrange(groups, shown.map(child => ({ key: child.id, state: faces.get(child.id) ?? groupStates[1], tile: child }))).flatMap(bucket => [
      { kind: 'heading' as const, key: `head:${bucket.group.id}`, title: bucket.group.title, group: bucket.group.id },
      ...bucket.tiles.map(item => ({ kind: 'tile' as const, key: item.key, child: item.tile, group: bucket.group.id })),
    ])
    : undefined, [groups, faces, shown.map(child => child.id).join(',')]);
  const spans = items ? items.map(item => item.kind === 'heading' ? MAX_TILE_COLUMNS : ignoreSpans ? 1 : item.child.layout.span) : shown.map(child => ignoreSpans ? 1 : child.layout.span);
  const minimums = items ? items.map(item => item.kind === 'heading' || ignoreSpans ? 0 : nodeMinimumWidth(item.child) || settingsRowMinimum(item.child)) : shown.map(child => ignoreSpans ? 0 : nodeMinimumWidth(child) || settingsRowMinimum(child));
  const grid = useFoldedGrid(ref, { minimum, maxColumns, gap, minimumColumns, spans, minimums, fill, follows });
  const placement = useMemo(() => {
    if (!grid.lines) return undefined;
    return items ? new Map(items.flatMap((item, at) => [[item.key, grid.lines![at]] as const])) : new Map(shown.map((child, at) => [child.id, grid.lines![at]]));
  }, [grid, items?.map(item => item.key).join(',') ?? shown.map(child => child.id).join(',')]);
  useRegroupMotion(ref, items?.map(item => item.key).join(',') ?? '', useMemo(() => new Map(items?.map(item => [item.key, item.group]) ?? []), [items]));
  const style = { '--min': `${minimum}px`, '--max': maxColumns, '--gap': `${gap}px`, ...(grid.template ? { gridTemplateColumns: grid.template } : {}) } as CSSProperties;
  return <div ref={ref} className="sh-grid" style={style} data-equal={equal ? '' : undefined} data-columns={grid.columns} data-banded={grid.banded ? '' : undefined} data-grouped={groups ? '' : undefined}>
    <GridPlacement.Provider value={placement}><GridFaces.Provider value={groups ? report : undefined}>
      {items
        ? items.map(item => item.kind === 'heading'
          ? <h2 key={item.key} className="sh-section-header sh-grid-heading" data-group-item={item.key} data-group={item.group} style={lineStyle(placement?.get(item.key)) ?? { gridColumn: '1 / -1' }}>{item.title}</h2>
          : <Fragment key={item.key}><Children nodes={[item.child]}/></Fragment>)
        : <Children nodes={nodes} owner={owner}/>}
      {items && ctx.mode === 'edit' && <div className="sh-add-slot" data-add-for={owner}/>}
    </GridFaces.Provider></GridPlacement.Provider>
  </div>;
}
/**
 * `tile-grid`: columns that are at least the rule's minimum wide (never more than four for a tile), each child spanning its
 * `layout.span`. It follows the Duo's fold only when `fold` is `page` (never in a sheet or a column pane): see {@link FoldedGridBox}.
 */
export function TileGridNode({ node }: { node: NodeOf<'tile-grid'> }) {
  const { props } = node;
  const maxColumns = props.minimum === 'section-wide@1' ? props.maxColumns : Math.min(props.maxColumns, MAX_TILE_COLUMNS);
  return <FoldedGridBox nodes={node.children} owner={`node:${node.id}`} minimum={minimumWidth[props.minimum]} maxColumns={maxColumns} gap={points(props.spacing)} minimumColumns={props.minimumColumns}
    fill={props.shortRow !== 'leading'} follows={props.fold === 'page'} equal={props.equalRowHeights} groups={props.groups}/>;
}
/** `section`: an optional header and footer around its children, plain or as one module of rows. */
export function SectionNode({ node }: { node: NodeOf<'section'> }) {
  const { props } = node;
  return <section className={`sh-section sh-section-${props.style}`} data-density={props.density} aria-label={props.header || node.title}>
    {props.header && <h2 className="sh-section-header">{props.header}</h2>}
    <div className="sh-section-body" style={{ '--gap': `${points(props.spacing)}px` } as CSSProperties}><Children nodes={node.children} owner={`node:${node.id}`}/></div>
    {props.footer && <p className="sh-section-footer">{props.footer}</p>}
  </section>;
}
/** `status-rail`: the chip row under the title. */
export function StatusRailNode({ node }: { node: NodeOf<'status-rail'> }) {
  return <HorizontalScroller kind="rail" className="sh-rail" role="list" label={node.title}><Children nodes={node.children} owner={`node:${node.id}`}/></HorizontalScroller>;
}
/**
 * `room-section`: a room's nodes as the app arranges them (`UKRoomSectionContent`). `grid` is a four-column grid of tiles and
 * `two-column-fill` a two-column one; `lead-row` joins a two-column grid when `leadJoinsAtRegularWidth` and the window is regular
 * width, and otherwise puts the first node full width over a grid of the rest (two columns for three or more, else four). Every
 * grid here follows the Duo's fold on a page.
 */
export function RoomSectionNode({ node }: { node: NodeOf<'room-section'> }) {
  const ctx = useRender();
  const { arrangement, leadJoinsAtRegularWidth } = node.props;
  const grid = (nodes: NodeOf<'room-section'>['children'], maxColumns: number, ignoreSpans = false) =>
    <FoldedGridBox nodes={nodes} owner={`node:${node.id}`} minimum={150} maxColumns={maxColumns} gap={12} fill follows equal ignoreSpans={ignoreSpans}/>;
  const joined = arrangement === 'lead-row' && leadJoinsAtRegularWidth && ctx.fold?.regular === true;
  const shown = node.children.filter(child => ctx.mode === 'edit' || nodeIsShown(child, ctx.env, ctx.previous.get(child.id)));
  const lead = shown[0], rest = lead ? node.children.filter(child => child.id !== lead.id) : node.children;
  const body = arrangement === 'grid' ? grid(node.children, 4)
    : arrangement === 'two-column-fill' ? grid(node.children, 2)
    : joined ? grid(node.children, 2, true)
    : <div className="sh-section-body" style={{ '--gap': '12px' } as CSSProperties}>
      {lead && <Children nodes={[lead]} owner={`node:${node.id}`}/>}
      {rest.length > 0 && grid(rest, shown.length - 1 > 2 ? 2 : 4)}
    </div>;
  return <section className="sh-room-section" data-arrangement={arrangement} aria-label={node.title}>{body}</section>;
}
/** `paged-row`: children in a snapping row, `perPage` to a page, with the page dots when asked. */
export function PagedRowNode({ node }: { node: NodeOf<'paged-row'> }) {
  const { perPage, showsIndicator } = node.props;
  const pages = Math.max(1, Math.ceil(node.children.length / perPage));
  return <div className="sh-paged" aria-label={node.props.pageLabel}>
    <HorizontalScroller kind="paged" className="sh-paged-track" style={{ '--per': perPage } as CSSProperties}><Children nodes={node.children} owner={`node:${node.id}`}/></HorizontalScroller>
    {showsIndicator && pages > 1 && <div className="sh-dots" aria-hidden="true">{Array.from({ length: pages }, (_, i) => <i key={i} data-on={i === 0 ? '' : undefined}/>)}</div>}
  </div>;
}
/** The ids of every node under an area's children, for telling whether the selection is inside it. */
function idsUnder(nodes: readonly CompositionNode[]): ReadonlySet<string> {
  const found = new Set<string>();
  const visit = (list: readonly CompositionNode[]) => list.forEach(item => { found.add(item.id); visit(compositionChildren(item)); });
  visit(nodes);
  return found;
}

/**
 * One area of a tab container: its children, drawn once. Its React key is the area's id, never the tab's, so a tab change keeps every area that shows on
 * both tabs mounted (a shared map keeps its picture and its zoom). In Edit it carries the selection ring and a scope tag while it, or a node inside
 * it, is selected; Use adds nothing.
 */
const AreaView = memo(function AreaView({ node, area, label }: { node: NodeOf<'local-tabs'>; area: Area; label: string }) {
  renderProbe.onArea?.(area.id);
  const ctx = useRender();
  const key: SelectionKey = `local-tab:${node.id}/${area.id}`;
  const selected = useIsSelected(ctx.store, key) && ctx.mode === 'edit';
  const inside = useMemo(() => idsUnder(area.children), [area.children]);
  const within = useSyncExternalStore(ctx.store.subscribe, () => { const chosen = ctx.store.get(); return chosen?.startsWith('node:') === true && inside.has(chosen.slice(5)); }, () => false) && ctx.mode === 'edit';
  const holds = ruleHolds(area, ctx.env, ctx.previous.get(key));
  ctx.previous.set(key, holds);
  if (!holds && ctx.mode === 'use') return null;
  const shared = area.tabs === 'all';
  return <div className="sh-area" data-sel={key} data-shared={shared ? '' : undefined} data-hidden={!holds ? '' : undefined} data-selected={selected ? '' : undefined}>
    <Children nodes={area.children} owner={key}/>
    {ctx.mode === 'edit' && area.children.length === 0 && <div className="sh-area-empty">Empty area</div>}
    {(selected || (within && shared)) && <span className="sh-scope-tag" aria-hidden="true">{selected ? (shared ? 'Shared · All Tabs' : label) : 'In a Shared Area'}</span>}
    {!holds && <span className="sh-tag sh-tag-rule"><EyeOff size={12} aria-hidden="true"/>Hidden by Rule</span>}
    {selected && <span className="sh-handle-slot" data-handle-for={key}/>}
  </div>;
});

/**
 * `local-tabs`: the tab bar and the areas that draw while the tab on show is one of their tabs, top to bottom in the document's order
 * (`sh.tab-blocks@1`; the shipped shape is one area per tab). Use writes the scene value; Edit only looks at a tab, and follows the selection when
 * it sits inside an area for another one. A tab hidden by its rule leaves the bar in Use and gives way to the fallback tab.
 */
export function LocalTabsNode({ node }: { node: NodeOf<'local-tabs'> }) {
  const ctx = useRender();
  const hint = useTabHint(ctx.store, node.id);
  const [picked, setPicked] = useState<string>();
  const stored = ctx.local(node.props.stateId);
  const fromState = stored?.type === 'string' ? stored.value : undefined;
  const has = (id: string | undefined) => node.tabs.some(tab => tab.id === id);
  // The tab to open when none was chosen: the container's `fallbackTabId` (`sh.tab-fallback@1`), else the first tab.
  const fallback = has(node.props.fallbackTabId) ? node.props.fallbackTabId : node.tabs[0].id;
  const choice = (ctx.mode === 'edit' && has(picked) ? picked : undefined) ?? (has(fromState) ? fromState : undefined) ?? fallback!;
  // A selection inside an area for other tabs shows one of them: the tab already shown when it is one, else the area's first.
  const wanted = hint?.split(',').filter(has);
  const requested = wanted?.length ? wanted.includes(choice) ? choice : wanted[0] : choice;
  const active = ctx.mode === 'edit' ? requested : tabOnShow(node.tabs, requested, fallback, ctx.env);
  useEffect(() => { shownTabs.set(node.id, active); }, [node.id, active]);
  const bar = ctx.mode === 'edit' ? node.tabs : node.tabs.filter(tab => ruleHolds(tab, ctx.env, ctx.previous.get(`${node.id}/${tab.id}/tab`)));
  const choose = (id: string) => {
    if (ctx.mode === 'edit') setPicked(id);
    else ctx.run({ type: 'set-local', stateId: node.props.stateId, value: { type: 'string', value: id } });
  };
  const areas = useMemo(() => areasOf(node), [node.blocks, node.tabs]);
  const shown = areasOnTab(areas, active);
  const labelOf = (area: Area) => area.tabs === 'all' ? 'Shared' : node.tabs.filter(tab => (area.tabs as string[]).includes(tab.id)).map(tab => tab.label).join(', ');
  const setting = tabBarOf(node.props);
  const selector = node.props.showsSelector !== false && <TabBar node={node} tabs={bar} active={active} onChoose={choose} selectable={!node.blocks}/>;
  // A bottom bar leaves the flow for the page's or sheet's bottom safe edge (`UKPagePinnedBar`); until a page body has a slot it draws in flow.
  const dock = use(TabDockContext);
  const docked = docksAtBottom(setting) && dock ? createPortal(<div className="sh-tab-slot" data-sel={`node:${node.id}`}>{selector}</div>, dock) : undefined;
  return <div className="sh-local-tabs" data-pinned={node.props.pinned ? '' : undefined} data-placement={setting.placement}>
    {setting.placement === 'top' && selector}
    {docked}
    <div className="sh-local-tab-body" role="tabpanel" data-tab={active}>
      {shown.map(area => <AreaView key={area.id} node={node} area={area} label={labelOf(area)}/>)}
    </div>
    {setting.placement === 'bottom' && !dock && selector}
  </div>;
}
