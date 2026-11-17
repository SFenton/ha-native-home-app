import { useId, useState } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import type { TabBar as TabBarSetting } from '../../shared/composition/schema';
import { tabBarOf } from '../../shared/composition/layout-blocks';
import { useRender } from '../render-context';
import { Glyph } from './shared';
import type { NodeOf } from './shared';

type Tab = NodeOf<'local-tabs'>['tabs'][number];

/** How a tab bar draws its tabs: icons, titles, an icon over a title, or one menu of titles (`ModalTabBar`'s forms). */
export type TabForm = 'icons' | 'titles' | 'icons-and-titles' | 'menu';

/**
 * The form the bar takes (`ModalTabBar.swift:25-49`): at the largest text sizes always a menu of titles; otherwise the labels the author chose, with
 * Automatic showing icons on a narrow screen when every tab has one, else titles, and titles on a wide one (icon over title when a tab carries a badge).
 */
export function tabForm(setting: TabBarSetting, tabs: readonly Pick<Tab, 'icon'>[], opts: { regular: boolean; largeText: boolean; badged: boolean }): TabForm {
  if (opts.largeText) return 'menu';
  if (setting.labels !== 'by-size') return setting.labels;
  if (opts.regular) return opts.badged ? 'icons-and-titles' : 'titles';
  return tabs.every(tab => tab.icon) ? 'icons' : 'titles';
}

/** One segment: its title, its icon and its badge, by the form. An icon-only segment keeps the title as its accessible name. */
function Segment({ tab, form, selected, onChoose, areaKey }: { tab: Tab; form: TabForm; selected: boolean; onChoose(): void; areaKey?: string }) {
  return <button type="button" role="tab" aria-selected={selected} aria-label={form === 'icons' ? tab.label : undefined} data-form={form} data-sel={areaKey}
    onClick={onChoose}>
    {form !== 'titles' && tab.icon && <Glyph symbol={tab.icon} size={form === 'icons-and-titles' ? 20 : 18}/>}
    {form !== 'icons' && <span className="sh-seg-title">{tab.label}</span>}
  </button>;
}

/**
 * The bar of a tab container. Top is the segmented control at the head of the container; Bottom is the glass capsule `ModalTabBar` draws over the
 * bottom of the page or sheet. `selectable` names the key each segment selects in Edit (the tab's area in the shipped shape).
 */
export function TabBar({ node, tabs, active, onChoose, selectable }: { node: NodeOf<'local-tabs'>; tabs: readonly Tab[]; active: string; onChoose(id: string): void; selectable: boolean }) {
  const ctx = useRender();
  const setting = tabBarOf(node.props);
  const regular = ctx.fold?.regular === true;
  const form = tabForm(setting, tabs, { regular, largeText: ctx.largeText === true, badged: tabs.some(tab => (tab as { badge?: unknown }).badge !== undefined) });
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const current = tabs.find(tab => tab.id === active) ?? tabs[0];
  if (form === 'menu') return <div className="sh-tab-bar sh-tab-menu" data-placement={setting.placement} data-form="menu">
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)}><span>{current.label}</span><ChevronsUpDown size={14} aria-hidden="true"/></button>
    {open && <div id={menuId} role="menu">{tabs.map(tab => <button key={tab.id} type="button" role="menuitemradio" aria-checked={tab.id === current.id}
      onClick={() => { setOpen(false); onChoose(tab.id); }}>{tab.label}</button>)}</div>}
  </div>;
  return <div className="sh-segments sh-tab-bar" role="tablist" aria-label={node.title} data-placement={setting.placement} data-form={form}>
    {tabs.map(tab => <Segment key={tab.id} tab={tab} form={form} selected={tab.id === current.id} onChoose={() => onChoose(tab.id)}
      areaKey={selectable ? `local-tab:${node.id}/${tab.id}` : undefined}/>)}
  </div>;
}
