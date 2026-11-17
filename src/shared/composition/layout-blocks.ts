import type { CompositionDocument, CompositionNode, TabBar, TabBlock } from './schema';

/**
 * The areas of a tab container, as pure functions over the node (`sh.tab-blocks@1`, `sh.tab-bar@1`).
 *
 * An **area** is what the document calls a block: children drawn once for every tab (`tabs: 'all'`, a Shared Area) or for the listed tabs (a Tab Area).
 * The Studio keeps the shipped shape (`tabs[i].children`) whenever the areas fit it, and writes `blocks` only when they do not, so a container needs
 * `sh.tab-blocks@1` only while it holds a shared area, a second area on one tab, a multi-tab area, an area rule or an order the shipped shape cannot say.
 */
export type TabsNode = Extract<CompositionNode, { type: 'local-tabs' }>;
/** One area of a tab container. */
export type Area = TabBlock;

/** The areas of `node`, in draw order. In the shipped shape each tab's children are one area for that tab, named by the tab's id. */
export function areasOf(node: TabsNode): Area[] {
  if (node.blocks) return node.blocks;
  return node.tabs.map(tab => ({ id: tab.id, tabs: [tab.id], children: tab.children }));
}

/**
 * Whether `areas` can be stored as `tabs[i].children`: each area is for exactly one tab, no tab has two, they follow the tab order, none has its
 * own rule, and each is named by its tab's id (the shipped shape has no other name).
 */
export function fitsShippedTabs(areas: readonly Area[], tabIds: readonly string[]): boolean {
  let last = -1;
  for (const area of areas) {
    if (area.tabs === 'all' || area.tabs.length !== 1 || area.visibleWhen !== undefined || area.whenUnknown !== undefined || area.id !== area.tabs[0]) return false;
    const at = tabIds.indexOf(area.tabs[0]);
    if (at <= last) return false;
    last = at;
  }
  return true;
}

/** `node` with `areas` stored by the D6 rule: the shipped shape when they fit it, else `blocks` with every tab's own children empty. */
export function areasToNode(node: TabsNode, areas: readonly Area[]): TabsNode {
  const tabIds = node.tabs.map(tab => tab.id);
  const { blocks: _unused, ...rest } = node;
  void _unused;
  if (fitsShippedTabs(areas, tabIds)) {
    const byTab = new Map(areas.map(area => [(area.tabs as string[])[0], area.children]));
    return { ...rest, tabs: node.tabs.map(tab => ({ ...tab, children: byTab.get(tab.id) ?? [] })) };
  }
  return { ...rest, tabs: node.tabs.map(tab => ({ ...tab, children: [] })), blocks: areas.map(area => ({ ...area })) };
}

/** The areas that draw while `tabId` is on show, in draw order. */
export function areasOnTab(areas: readonly Area[], tabId: string): Area[] {
  return areas.filter(area => area.tabs === 'all' || area.tabs.includes(tabId));
}

/** The tab ids an area is for: every tab of the container, or the ones it lists. */
export function areaTabIds(area: Area, node: TabsNode): string[] {
  return area.tabs === 'all' ? node.tabs.map(tab => tab.id) : area.tabs;
}

/** The first tab an area shows on (the one the simulator switches to when the area is chosen). */
export function firstTabOf(area: Area, node: TabsNode): string | undefined {
  const named = areaTabIds(area, node);
  return node.tabs.find(tab => named.includes(tab.id))?.id;
}

/** What the bar does: where it sits and how it labels. `pinned` alone means bottom with automatic labels. */
export function tabBarOf(props: TabsNode['props']): TabBar {
  if (props.tabBar) return props.tabBar;
  return { placement: props.pinned ? 'bottom' : 'top', labels: 'by-size' };
}

/**
 * The container's props after choosing a placement and a labelling (D8): Top with Automatic writes nothing, Bottom with Automatic writes `pinned: true`,
 * anything else also writes `tabBar`. Every other prop is kept.
 */
export function tabBarToProps(props: TabsNode['props'], placement: TabBar['placement'], labels: TabBar['labels']): TabsNode['props'] {
  const { tabBar: _bar, pinned: _pinned, ...rest } = props;
  void _bar; void _pinned;
  return {
    ...rest,
    ...(placement === 'bottom' ? { pinned: true } : {}),
    ...(labels === 'by-size' ? {} : { tabBar: { placement, labels } }),
  };
}

/** The container with one more tab (up to five), holding no children; a shared area is not changed, so it shows on the new tab too. */
export function addTab(node: TabsNode, tab: { id: string; label: string }): TabsNode {
  if (node.tabs.length >= 5) throw new Error('A tab bar holds 5 tabs.');
  const next = { ...node, tabs: [...node.tabs, { ...tab, children: [] }] };
  // A container drawn from blocks gets the new tab's own empty Tab Area (the shipped shape already has one: the tab's own children).
  return node.blocks ? { ...next, blocks: [...node.blocks, { id: tab.id, tabs: [tab.id], children: [] }] } : next;
}

/**
 * The container without a tab (down to two). References to it go with it: a rule that picked it, the fallback, and its name in every area; an area left
 * with no tab is dropped when it was only for that tab, with its children.
 */
export function removeTab(node: TabsNode, tabId: string): TabsNode {
  if (node.tabs.length <= 2) throw new Error('A tab container needs 2 tabs.');
  const { automatic, fallbackTabId, ...props } = node.props;
  const kept = automatic?.filter(rule => rule.tabId !== tabId);
  const next: TabsNode = {
    ...node,
    props: { ...props, ...(kept?.length ? { automatic: kept } : {}), ...(fallbackTabId && fallbackTabId !== tabId ? { fallbackTabId } : {}) },
    tabs: node.tabs.filter(tab => tab.id !== tabId),
  };
  if (!node.blocks) return next;
  const blocks = node.blocks.flatMap(block => {
    if (block.tabs === 'all') return [block];
    const rest = block.tabs.filter(id => id !== tabId);
    return rest.length ? [{ ...block, tabs: rest }] : [];
  });
  return { ...next, blocks };
}

/** The container with the tab at `index` moved by `offset` places. */
export function moveTab(node: TabsNode, index: number, offset: number): TabsNode {
  const to = index + offset;
  if (to < 0 || to >= node.tabs.length) return node;
  const tabs = [...node.tabs];
  [tabs[index], tabs[to]] = [tabs[to], tabs[index]];
  return { ...node, tabs };
}

/** The container with an area's tabs set. `'all'` is a Shared Area; a list that names every tab stays a list. */
export function setAreaTabs(node: TabsNode, areaId: string, tabs: Area['tabs']): TabsNode {
  return areasToNode(node, areasOf(node).map(area => area.id === areaId ? { ...area, tabs } : area));
}

/**
 * The document with the choice field a tab container names (`props.stateId`) made to mirror its tabs: the compiler wants the same ids, labels and order.
 * The field's start value is kept while its option remains, else it is the first tab. A document whose container names no such field is returned as is.
 */
export function syncTabState(document: CompositionDocument, node: TabsNode): CompositionDocument {
  const field = document.localState?.find(item => item.id === node.props.stateId);
  if (!field || field.type !== 'choice') return document;
  const options = node.tabs.map(tab => ({ id: tab.id, label: tab.label }));
  const initial = options.some(option => option.id === field.initial) ? field.initial : options[0].id;
  if (field.initial === initial && JSON.stringify(field.options) === JSON.stringify(options)) return document;
  return { ...document, localState: document.localState!.map(item => item === field ? { ...field, initial, options } : item) };
}

/** The container with one more, empty area at the end: a Shared Area (every tab) or a Tab Area (the first tab; the inspector changes it). */
export function addArea(node: TabsNode, area: { id: string; shared: boolean }): TabsNode {
  return areasToNode(node, [...areasOf(node), { id: area.id, tabs: area.shared ? 'all' : [node.tabs[0].id], children: [] }]);
}

/** The container without an area. An area that still holds controls is refused: they would be lost. */
export function removeArea(node: TabsNode, areaId: string): TabsNode {
  const areas = areasOf(node);
  const area = areas.find(item => item.id === areaId);
  if (!area) return node;
  if (area.children.length > 0) throw new Error('Move or delete its controls first.');
  const rest = areas.filter(item => item.id !== areaId);
  // Every tab needs an area to draw: the compiler refuses a tab with none.
  if (node.blocks && node.tabs.some(tab => areasOnTab(rest, tab.id).length === 0)) throw new Error('Every tab needs an area.');
  return areasToNode(node, rest);
}
