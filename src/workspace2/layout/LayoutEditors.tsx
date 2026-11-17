import { overlayInsets, setOverlayPosition } from '../nodeActions';
import { ArrowDown, ArrowUp, ChevronRight, Trash2 } from 'lucide-react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { createId } from '../../shared/ids';
import type { OverlayAnchor, TabBar } from '../../shared/composition/schema';
import { addArea, addTab, areasOf, removeArea, moveTab, removeTab, setAreaTabs, tabBarOf, tabBarToProps, syncTabState, type TabsNode } from '../../shared/composition/layout-blocks';
import { GlyphByName } from '../../preview2/nodes/shared';
import { ChoiceRow, SegmentRow } from '../SegmentRow';
import { Switch } from '../editors/controls';
import { Tag, usePush } from '../kit';
import { ObjectRows, RowsProvider, useRows } from '../rows';
import { bottomRefusal, inFittedSheet, tabsWithoutIcon } from './tabBarRules';
import { type ReactNode } from 'react';
import { toastManager } from '../toasts';

// MARK: Tab state

/**
 * Rows below it that change a tab's id, name or order also change the choice field the container names, so the two never disagree
 * (the compiler wants the same ids, labels and order in both).
 */
export function SyncedTabs({ tabsPath, children }: { tabsPath: EditorPath; children: ReactNode }) {
  const outer = useRows();
  const value = { ...outer, onChange: (next: typeof outer.document, group?: string) => {
    const node = valueAt(next, tabsPath) as TabsNode | undefined;
    outer.onChange(node ? syncTabState(next, node) : next, group);
  } };
  return <RowsProvider value={value}>{children}</RowsProvider>;
}

// MARK: Tab bar

/** The words for how the bar names its tabs. */
export const tabLabelChoices: readonly { value: TabBar['labels']; label: string }[] = [
  { value: 'by-size', label: 'Automatic' }, { value: 'icons', label: 'Icons' }, { value: 'titles', label: 'Titles' }, { value: 'icons-and-titles', label: 'Icons and Titles' },
];

/** The Tab Bar group of a tab container: where the bar sits and what it shows, written by the storage rule (Top and Automatic write nothing). */
export function TabBarGroup({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const node = valueAt(document, path) as TabsNode | undefined;
  if (!node) return null;
  const bar = tabBarOf(node.props);
  const set = (placement: TabBar['placement'], labels: TabBar['labels']) => onChange(replaceAt(document, [...path, 'props'], tabBarToProps(node.props, placement, labels)));
  const missingIcon = node.tabs.some(tab => !tab.icon);
  const needsIcons = bar.placement === 'bottom' || bar.labels === 'icons' || bar.labels === 'icons-and-titles';
  return <section className="w2-group" data-group="tab-bar" aria-label="Tab Bar">
    <h3 className="w2-group-title">Tab Bar</h3>
    <SegmentRow label="Placement" path={[...path, 'props', 'pinned'].join('/')} value={bar.placement} choices={[{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom', unavailable: bottomRefusal(document, path) }]} onPick={next => set(next, bar.labels)}/>
    <ChoiceRow label="Labels" value={bar.labels} options={tabLabelChoices} onChange={next => set(bar.placement, next as TabBar['labels'])}/>
    {bar.placement === 'bottom' && missingIcon && <p className="w2-caption" role="note">Bottom needs an icon on every tab. {tabsWithoutIcon(node).slice(0, 2).join(' and ')} {tabsWithoutIcon(node).length === 1 ? 'has' : 'have'} none.</p>}
    {bar.placement === 'bottom' && missingIcon && <button type="button" className="w2-link" onClick={() => { const at = node.tabs.findIndex(tab => !tab.icon); push?.push({ title: node.tabs[at].label, body: <TabPage path={[...path, 'tabs', at]}/> }); }}>Choose an Icon</button>}
    {bar.placement !== 'bottom' && needsIcons && missingIcon && <p className="w2-caption" role="note">Every tab needs an icon for this bar. Add them under Tabs.</p>}
    {bar.placement === 'bottom' && inFittedSheet(document, path) && <div role="note"><p className="w2-caption">A bottom bar needs a sheet of a set height.</p>
      <button type="button" className="w2-link" onClick={() => onChange(replaceAt(document, ['modals', path[1], 'presentation', 'height'], { type: 'full' }))}>Make It Full Height</button></div>}
    {bar.placement === 'bottom' && <p className="w2-caption">A bottom bar floats over the content. It needs a newer app.</p>}
  </section>;
}

// MARK: Tabs

/**
 * The document as it is now, readable from a callback that outlives the page that made it (a toast's Undo). A module-level cell the
 * workspace's rows write on every render, so a pushed page that has closed still sees the latest.
 */
const latestDocument: { current?: unknown } = {};
function useLatestDocument(): () => unknown {
  const { document } = useRows();
  latestDocument.current = document;
  return () => latestDocument.current;
}

/** What a removed tab took with it, in the words of the toast: "Removed Rooms and 1 area." */
export function removedWords(label: string, areasGone: number): string {
  return areasGone > 0 ? `Removed ${label} and ${areasGone} ${areasGone === 1 ? 'area' : 'areas'}.` : `Removed ${label}.`;
}

/** The Shows group of a tab: how many shared areas and areas of its own it draws, and Show Its Areas (selects the first). */
function ShowsGroup({ node, tabId, onShow }: { node: TabsNode; tabId: string; onShow: (areaId: string) => void }) {
  const on = areasOf(node).filter(area => area.tabs === 'all' || area.tabs.includes(tabId));
  const shared = on.filter(area => area.tabs === 'all').length, own = on.length - shared;
  const part = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return <section className="w2-group" data-group="shows" aria-label="Shows">
    <h3 className="w2-group-title">Shows</h3>
    <p className="w2-caption">{shared > 0 ? `${part(shared, 'shared area')} and ${own} of its own.` : `${part(own, 'area')} of its own.`}</p>
    {on.length > 0 && <button type="button" className="w2-link" onClick={() => onShow(on.find(area => area.tabs !== 'all')?.id ?? on[0].id)}>Show Its Areas</button>}
  </section>;
}

/** One tab's own page (pushed): Label, Icon, Badge, Only show when and If it can't tell, the Shows group, and Remove Tab with an Undo toast. */
function TabPage({ path }: { path: EditorPath }) {
  const { document, onChange, onError, onSelect } = useRows();
  const push = usePush();
  const current = useLatestDocument();
  const tabsPath = path.slice(0, -2);
  const node = valueAt(document, tabsPath) as TabsNode | undefined;
  const tab = valueAt(document, path) as { id: string; label: string } | undefined;
  if (!node || !tab) return null;
  const remove = () => {
    try {
      const gone = areasOf(node).length - areasOf(removeTab(node, tab.id)).length;
      const after = syncTabState(replaceAt(document, tabsPath, removeTab(node, tab.id)), removeTab(node, tab.id));
      onChange(after);
      push?.pop();
      toastManager.add({ title: removedWords(tab.label, gone), actionProps: { children: 'Undo', onClick: () => { if (current() === after) onChange(document); } } });
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return <SyncedTabs tabsPath={tabsPath}><div className="w2-editor-page">
    <ObjectRows path={path} owner="local-tab-settings" skip={at => at.at(-1) === 'children' || at.at(-1) === 'id'}/>
    <ShowsGroup node={node} tabId={tab.id} onShow={areaId => { const container = (node as unknown as { id: string }).id; onSelect?.(`local-tab:${container}/${areaId}`); }}/>
    <div className="w2-row"><button type="button" className="w2-remove" disabled={node.tabs.length <= 2} onClick={remove}>Remove Tab</button>
      {node.tabs.length <= 2 && <p className="w2-caption">A tab container needs 2 tabs.</p>}</div>
  </div></SyncedTabs>;
}

/** The Tabs list of a tab container: add, remove, reorder, and a page for each tab's name, icon and rule. */
export function TabsList({ path }: { path: EditorPath }) {
  const { document, onChange, onError } = useRows();
  useLatestDocument();
  const push = usePush();
  const node = valueAt(document, path) as TabsNode | undefined;
  if (!node) return null;
  const run = (change: () => TabsNode) => { try { const next = change(); onChange(syncTabState(replaceAt(document, path, next), next)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const open = (index: number) => push?.push({ title: node.tabs[index].label, body: <TabPage path={[...path, 'tabs', index]}/> });
  const first = node.props.fallbackTabId && node.tabs.some(item => item.id === node.props.fallbackTabId) ? node.props.fallbackTabId : node.tabs[0].id;
  const areas = areasOf(node);
  const empty = (tabId: string) => { const on = areas.filter(area => area.tabs === 'all' || area.tabs.includes(tabId)); return on.length > 0 && on.every(area => area.children.length === 0); };
  return <SyncedTabs tabsPath={path}><section className="w2-group" data-group="tabs" aria-label="Tabs">
    <h3 className="w2-group-title">Tabs · {node.tabs.length} of 5</h3>
    <ul className="w2-tab-list">
      {node.tabs.map((tab, index) => <li key={tab.id} className="w2-tab-row">
        <button type="button" className="w2-tab-open" onClick={() => open(index)} aria-label={`${tab.label}${tab.id === first ? ', opens first' : ''}${tab.visibleWhen ? ', has a rule' : ''}${empty(tab.id) ? ', empty' : ''}`}>
          {tab.icon ? <GlyphByName name={tab.icon.name} size={18}/> : <span aria-hidden className="w2-tab-noicon"/>}
          <span className="w2-page-text"><span className="w2-page-title">{tab.label}</span>{tab.id === first && <span className="w2-tab-sub">Opens first</span>}</span>
          {tab.visibleWhen && <Tag>Rule</Tag>}{empty(tab.id) && <Tag tone="warning" className="w2-tab-empty">Empty</Tag>}<ChevronRight size={16} aria-hidden/>
        </button>
        <button type="button" className="w2-icon-button" aria-label={`Move ${tab.label} up`} disabled={index === 0} onClick={() => run(() => moveTab(node, index, -1))}><ArrowUp size={16} aria-hidden/></button>
        <button type="button" className="w2-icon-button" aria-label={`Move ${tab.label} down`} disabled={index === node.tabs.length - 1} onClick={() => run(() => moveTab(node, index, 1))}><ArrowDown size={16} aria-hidden/></button>
        <button type="button" className="w2-icon-button" aria-label={`Remove ${tab.label}`} disabled={node.tabs.length <= 2} onClick={() => run(() => removeTab(node, tab.id))}><Trash2 size={16} aria-hidden/></button>
      </li>)}
    </ul>
    <div className="w2-tabs-add">
      <button type="button" disabled={node.tabs.length >= 5} onClick={() => run(() => addTab(node, { id: createId('tab'), label: `Tab ${node.tabs.length + 1}` }))}>Add Tab</button>
      {node.tabs.length >= 5 && <p className="w2-caption">A tab bar holds 5.</p>}
      <button type="button" onClick={() => run(() => addArea(node, { id: createId('area'), shared: true }))}>Add Shared Area</button>
      <button type="button" onClick={() => run(() => addArea(node, { id: createId('area'), shared: false }))}>Add Tab Area</button>
    </div>
  </section></SyncedTabs>;
}

// MARK: Area

/** The Shows on rows of an area: every tab (a Shared Area) or a choice of tabs, with a switch for each. */
export function ShowsOn({ tabsPath, areaId }: { tabsPath: EditorPath; areaId: string }) {
  const { document, onChange, onError } = useRows();
  const node = valueAt(document, tabsPath) as TabsNode | undefined;
  const area = node && areasOf(node).find(item => item.id === areaId);
  if (!node || !area) return null;
  const apply = (tabs: typeof area.tabs) => { try { onChange(replaceAt(document, tabsPath, setAreaTabs(node, areaId, tabs))); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const shared = area.tabs === 'all';
  const listed = area.tabs === 'all' ? node.tabs.map(tab => tab.id) : area.tabs;
  return <section className="w2-group" data-group="shows-on" aria-label="Shows on">
    <h3 className="w2-group-title">Shows On</h3>
    <Switch label="All Tabs" checked={shared} onChange={on => apply(on ? 'all' : [listed[0] ?? node.tabs[0].id])}/>
    {!shared && node.tabs.map(tab => <Switch key={tab.id} label={tab.label} checked={listed.includes(tab.id)}
      onChange={on => { const next = on ? node.tabs.map(item => item.id).filter(id => id === tab.id || listed.includes(id)) : listed.filter(id => id !== tab.id); if (next.length > 0) apply(next); }}/>)}
    {shared && <p className="w2-caption">The same controls on every tab. They stay put when the tab changes.</p>}
  </section>;
}

/** The inspector of an area: its tabs and, when it has a rule, "Only show when". */
export function AreaInspector({ tabsPath, areaPath, areaId }: { tabsPath: EditorPath; areaPath: EditorPath; areaId: string }) {
  const { document, onChange, onError } = useRows();
  const node = valueAt(document, tabsPath) as TabsNode | undefined;
  const area = node && areasOf(node).find(item => item.id === areaId);
  if (!node || !area) return null;
  const shipped = !node.blocks;
  const remove = () => { try { onChange(replaceAt(document, tabsPath, removeArea(node, areaId))); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  return <SyncedTabs tabsPath={tabsPath}>
    {shipped && <ObjectRows path={areaPath} owner="local-tab-settings" skip={at => at.at(-1) === 'children' || at.at(-1) === 'id'}/>}
    {!shipped && <ShowsOn tabsPath={tabsPath} areaId={areaId}/>}
    {!shipped && <ObjectRows path={areaPath} owner="area" skip={at => at.at(-1) === 'children' || at.at(-1) === 'id' || at.at(-1) === 'tabs'}/>}
    {!shipped && <div className="w2-row"><button type="button" className="w2-remove" disabled={area.children.length > 0} onClick={remove}>Remove Area</button>
      {area.children.length > 0 && <p className="w2-caption">Move or delete its controls first.</p>}</div>}
  </SyncedTabs>;
}

// MARK: Overlay

const anchorChoices: readonly { value: OverlayAnchor; label: string }[] = [
  { value: 'top-leading', label: 'Top Leading' }, { value: 'top-trailing', label: 'Top Trailing' }, { value: 'bottom-leading', label: 'Bottom Leading' },
  { value: 'bottom-trailing', label: 'Bottom Trailing' }, { value: 'center', label: 'Center' },
];

/** The Position group of an overlay: for each control on top of the base, its place (five points) and its Inset. */
export function OverlayPosition({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const node = valueAt(document, path) as { children: { id: string; title: string }[]; props: { anchors: { childId: string; anchor: OverlayAnchor; inset: { type: string; value?: number } }[] } } | undefined;
  if (!node) return null;
  const on = node.children.slice(1);
  const insetOf = (childId: string) => { const found = node.props.anchors.find(item => item.childId === childId)?.inset; return String(found?.type === 'points' ? found.value : 12); };
  return <section className="w2-group" data-group="position" aria-label="Position">
    <h3 className="w2-group-title">Position</h3>
    {on.length === 0 && <p className="w2-caption">The first child is the base. Add controls to put on top of it.</p>}
    {on.map(child => <div key={child.id}>
      <ChoiceRow label={child.title} value={node.props.anchors.find(item => item.childId === child.id)?.anchor ?? 'top-trailing'} options={anchorChoices} onChange={next => onChange(setOverlayPosition(document, path, child.id, next))}/>
      <ChoiceRow label={`${child.title} inset`} value={insetOf(child.id)} options={overlayInsets.map(item => ({ value: String(item.value), label: item.label }))}
        onChange={next => onChange(setOverlayPosition(document, path, child.id, node.props.anchors.find(item => item.childId === child.id)?.anchor ?? 'top-trailing', Number(next)))}/>
    </div>)}
    {on.length > 0 && <p className="w2-caption">Left and right swap in right-to-left languages.</p>}
  </section>;
}
