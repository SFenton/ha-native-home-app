import { ChevronLeft, Menu, X } from 'lucide-react';
import type { CompositionAction, CompositionDocument, CompositionGroups } from '../shared/composition/schema';
import { isShown, type VisibilityRule } from './evaluate';
import type { SelectionKey } from './model';
import { GlyphByName } from './nodes/shared';
import { useRender } from './render-context';
import { useIsSelected } from './selection-store';

type Item = CompositionGroups[number]['items'][number];

/** A header circle: glass, 44 pt, selectable in Edit and acting in Use. */
function Circle({ selKey, label, icon, action, className = '' }: { selKey?: SelectionKey; label: string; icon: string; action?: CompositionAction; className?: string }) {
  const ctx = useRender();
  const selected = useIsSelected(ctx.store, selKey ?? 'chrome-item:');
  return <button type="button" className={`sh-circle ${className}`.trim()} aria-label={label} title={label} data-sel={selKey}
    data-selected={selKey && selected && ctx.mode === 'edit' ? '' : undefined}
    onClick={() => { if (ctx.mode === 'use' && action) ctx.run(action); }}><GlyphByName name={icon} size={20}/></button>;
}

/** The two buttons of the app's `shell-header` item: Quick Links, then Profile. */
function ItemView({ item, root }: { item: Item; root: boolean }) {
  const ctx = useRender();
  if (item.type === 'shell-menu') return root && !ctx.flyout ? <Circle selKey={`chrome-item:${item.id}`} label={item.label} icon={item.icon.name}/> : null;
  if (item.visibility === 'root-only' && !root) return null;
  if (item.type === 'button') return <Circle selKey={`chrome-item:${item.id}`} label={item.label} icon={item.icon.name} action={item.action}/>;
  return <>
    <Circle selKey={`chrome-item:${item.id}`} label="Quick Links" icon="square.grid.2x2" action={item.quickLinksAction}/>
    <Circle selKey={`chrome-item:${item.id}`} label="Profile" icon="person" action={item.profileAction}/>
  </>;
}

/** Props of {@link HeaderBar}. */
export interface HeaderBarProps {
  groups: CompositionGroups;
  /** The first page of its stack: the menu shows and no back button does. */
  root: boolean;
  /** Pops the page; shown as the leading back button when not at the root. */
  onBack?: () => void;
  /** The inline title that fades in as the large title scrolls away. */
  title: string;
  /** The detail pane of a split: no back button, no flyout button. */
  detail?: boolean;
}
/**
 * The page header: transparent over the wallpaper, leading and trailing glass buttons from the chrome groups, a back button
 * on a pushed page, and the inline title that replaces the large one once the page scrolls (`--sh-progress`).
 */
export function HeaderBar({ groups, root, onBack, title, detail }: HeaderBarProps) {
  const ctx = useRender();
  const render = (placement: 'leading' | 'trailing') => groups.filter(group => group.placement === placement).map(group =>
    <div key={group.id} className={`sh-group ${group.horizontal === 'shared@1' ? 'sh-shared' : 'sh-separate'}`}>{group.items.map(item => <ItemView key={item.id} item={item} root={root}/>)}</div>);
  return <header className="sh-header">
    <div className="sh-bar-side">
      {root && !detail && ctx.flyout && <button type="button" className="sh-circle" aria-label="Menu" title="Menu" data-passthrough="" aria-expanded={ctx.flyout.open} onClick={ctx.flyout.toggle}><Menu size={20}/></button>}
      {!root && !detail && <button type="button" className="sh-circle" aria-label="Back" title="Back" onClick={() => { if (ctx.mode === 'use') onBack?.(); }}><ChevronLeft size={22}/></button>}{render('leading')}</div>
    <h2 className="sh-inline-title" aria-hidden="true">{title}</h2>
    <div className="sh-bar-side sh-trailing">{render('trailing')}</div>
  </header>;
}

/** The floating tab bar: a glass capsule of the document's tabs, the selected one lit. */
export function TabBar({ document, tabId }: { document: CompositionDocument; tabId?: string }) {
  const ctx = useRender();
  const tabs = document.navigation.tabs;
  if (!tabs.length) return null;
  return <nav className="sh-tabbar" aria-label="Tabs">
    {tabs.map(tab => <TabButton key={tab.id} tab={tab} selected={tab.id === tabId} ctx={ctx}/>)}
  </nav>;
}
/**
 * The iPad flyout (regular width with no hinge): the tabs as a 300 pt glass panel from the leading edge, opened by the
 * header's menu button, in place of the tab bar. Its rows are the same tabs, so Edit still selects them.
 */
export function Flyout({ document, tabId, open, onClose }: { document: CompositionDocument; tabId?: string; open: boolean; onClose: () => void }) {
  const ctx = useRender();
  const tabs = document.navigation.tabs;
  return <div className="sh-flyout-layer" data-open={open ? '' : undefined} inert={!open || undefined}>
    <div className="sh-flyout-scrim" data-passthrough="" onClick={onClose}/>
    <nav className="sh-flyout" aria-label="Tabs">
      {tabs.map(tab => <TabButton key={tab.id} tab={tab} selected={tab.id === tabId} ctx={ctx} onPicked={onClose}/>)}
    </nav>
  </div>;
}
function TabButton({ tab, selected, ctx, onPicked }: { tab: CompositionDocument['navigation']['tabs'][number]; selected: boolean; ctx: ReturnType<typeof useRender>; onPicked?: () => void }) {
  const key: SelectionKey = `tab:${tab.id}`;
  const picked = useIsSelected(ctx.store, key);
  const visible = isShown(tab as VisibilityRule, ctx.env, ctx.previous.get(key));
  ctx.previous.set(key, visible);
  if (!visible && ctx.mode === 'use') return null;
  return <button type="button" className="sh-tab" aria-current={selected ? 'page' : undefined} data-sel={key} data-active={selected ? '' : undefined}
    data-selected={picked && ctx.mode === 'edit' ? '' : undefined} data-hidden={!visible ? '' : undefined}
    onClick={() => { if (ctx.mode === 'use') ctx.run({ type: 'select-tab', tabId: tab.id }); onPicked?.(); }}>
    <GlyphByName name={tab.icon.name} size={22}/><span>{tab.label}</span>
  </button>;
}

/** The sheet's close button, trailing, a glass circle with an X. */
export function CloseButton({ onClose }: { onClose: () => void }) {
  const ctx = useRender();
  return <button type="button" className="sh-circle sh-close" aria-label="Close" title="Close" onClick={() => { if (ctx.mode === 'use') onClose(); }}><X size={18}/></button>;
}
