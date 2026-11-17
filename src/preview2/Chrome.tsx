import { ChevronLeft, Menu, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CompositionActionSlot, CompositionDocument, CompositionGroups } from '../shared/composition/schema';
import { isShown, type VisibilityRule } from './evaluate';
import type { SelectionKey } from './model';
import { Badge, GlyphByName, useBadge, type BadgeFace } from './nodes/shared';
import { AvatarDisc, useViewerName } from './nodes/avatar';
import { useRender } from './render-context';
import { useIsSelected } from './selection-store';

type Item = CompositionGroups[number]['items'][number];

/** A header circle: glass, 44 pt, selectable in Edit and acting in Use (its action, or `onPress` for the menu). */
function Circle({ selKey, label, icon, action, onPress, expanded, className = '', badge, disc }: { selKey?: SelectionKey; label: string; icon: string; action?: CompositionActionSlot; onPress?: () => void; expanded?: boolean; className?: string; badge?: BadgeFace | null; /** Drawn in place of the glyph: the Profile disc. */ disc?: ReactNode }) {
  const ctx = useRender();
  const selected = useIsSelected(ctx.store, selKey ?? 'chrome-item:');
  return <button type="button" className={`sh-circle ${className}`.trim()} aria-label={label} title={label} data-sel={selKey}
    data-selected={selKey && selected && ctx.mode === 'edit' ? '' : undefined}
    aria-expanded={expanded} onClick={() => { if (ctx.mode !== 'use') return; if (action) ctx.run(action); onPress?.(); }}>{disc ?? <GlyphByName name={icon} size={20}/>}<Badge badge={badge}/></button>;
}
/** A header button with its badge (`sh.badges@1`). */
function ButtonItem({ item }: { item: Extract<Item, { type: 'button' }> }) {
  const badge = useBadge(item.badge, `chrome-item:${item.id}/badge`);
  return <Circle selKey={`chrome-item:${item.id}`} label={badge.spoken ? `${item.label}, ${badge.spoken}` : item.label} icon={item.icon.name} action={item.action} badge={badge}/>;
}

/**
 * The header's Profile button. With a `profile` block (`sh.shell-profile@1`) it draws the person's disc (initials in the preview, never a photo) or the
 * person symbol, with the authored badge; the label is "Profile" and the badge's spoken words follow it. Without one it draws the initials disc, as the app does; only `look: symbol` draws the person symbol.
 */
function ProfileCircle({ item, rail }: { item: Extract<Item, { type: 'shell-header' }>; rail: boolean }) {
  const profile = item.profile;
  const badge = useBadge(profile?.badge, `chrome-item:${item.id}/profile/badge`);
  const name = useViewerName();
  const look = profile?.look ?? 'photo';
  return <Circle selKey={`chrome-item:${item.id}`} label={badge.spoken ? `Profile, ${badge.spoken}` : 'Profile'} icon={rail ? 'person.crop.circle' : 'person'} action={item.profileAction}
    badge={badge} disc={<AvatarDisc name={name} size={44} look={look}/>}/>;
}

/** The two buttons of the app's `shell-header` item: Quick Links, then Profile. */
function ItemView({ item, root, rail = false }: { item: Item; root: boolean; /** In the vertical bar Profile is the person symbol (`person.crop.circle`). */ rail?: boolean }) {
  const ctx = useRender();
  // The iPad draws its own menu button; elsewhere this one opens the same flyout, over the tab bar. The vertical bar has no menu at all.
  if (item.type === 'shell-menu') return root && !ctx.flyout && !ctx.verticalBar ? <Circle selKey={`chrome-item:${item.id}`} label={item.label} icon={item.icon.name} onPress={ctx.menu?.toggle} expanded={ctx.menu?.open}/> : null;
  if (item.visibility === 'root-only' && !root) return null;
  if (item.type === 'button') return <ButtonItem item={item}/>;
  return <>
    <Circle selKey={`chrome-item:${item.id}`} label="Quick Links" icon="square.grid.2x2" action={item.quickLinksAction}/>
    <ProfileCircle item={item} rail={rail}/>
  </>;
}

/** The chrome groups a page shows: its own when it replaces the toolbar, else the document's. */
export const headerGroups = (document: CompositionDocument, page: CompositionDocument['pages'][number]): CompositionGroups =>
  page.toolbar.type === 'replace' ? page.toolbar.groups : document.navigation.chrome.groups;

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
  const vertical = ctx.verticalBar === true;
  // In the vertical bar the eligible items are in the rail; only a `horizontal-only` button stays here.
  const render = (placement: 'leading' | 'trailing') => groups.filter(group => group.placement === placement).map(group => ({ group, items: vertical ? group.items.filter(item => !railEligible(item) && item.type !== 'shell-menu') : group.items })).filter(entry => entry.items.length).map(({ group, items }) =>
    <div key={group.id} className={`sh-group ${group.horizontal === 'shared@1' ? 'sh-shared' : 'sh-separate'}`}>{items.map(item => <ItemView key={item.id} item={item} root={root}/>)}</div>);
  return <header className="sh-header" data-vertical={vertical ? '' : undefined}>
    <div className="sh-bar-side">
      {root && !detail && ctx.flyout && <button type="button" className="sh-circle" aria-label="Menu" title="Menu" data-passthrough="" aria-expanded={ctx.flyout.open} onClick={ctx.flyout.toggle}><Menu size={20}/></button>}
      {!root && !detail && <button type="button" className="sh-circle" aria-label="Back" title="Back" onClick={() => { if (ctx.mode === 'use') onBack?.(); }}><ChevronLeft size={22}/></button>}{render('leading')}</div>
    <h2 className="sh-inline-title" aria-hidden="true">{title}</h2>
    <div className="sh-bar-side sh-trailing">{render('trailing')}</div>
  </header>;
}

/**
 * Whether an item may sit in the vertical bar. The `shell-header` (Quick Links, Profile) always may; a `button` may unless it says
 * `rail: horizontal-only`; the menu never does (`UKServerUIChrome.apply`: `axisBehavior`, and `showsMenuButton` is false there).
 */
export const railEligible = (item: Item): boolean => item.type === 'shell-header' || (item.type === 'button' && item.rail === 'eligible');
/** The items of a group the vertical bar shows now: eligible ones, and not a root-only item on a pushed page. */
const railItems = (group: CompositionGroups[number], root: boolean) => group.items.filter(item => railEligible(item) && (root || item.visibility !== 'root-only'));

/**
 * The Duo's vertical bar (the folded Duo and the unfolded Duo sideways), `ui-rail` in the mockup kit: down the trailing edge from the
 * status strip, the header items in glass groups at the top, then the tabs in a rounded glass pill at the bottom. The leading groups sit
 * above the trailing ones, and each group is one glass blob (Quick Links, then Profile as the person symbol, no spacer) unless it says
 * `vertical: separate@1`, which gives each item its own circle (`UKServerUIChrome.install`). No menu button. The title is in the header row.
 */
export function RailBar({ document, tabId, groups, root }: { document: CompositionDocument; tabId?: string; groups: CompositionGroups; root: boolean }) {
  const ordered = ['leading', 'trailing'].flatMap(placement => groups.filter(group => group.placement === placement)).map(group => ({ group, items: railItems(group, root) })).filter(entry => entry.items.length);
  return <div className="sh-rail-bar" data-rail-bar="">
    {ordered.map(({ group, items }) => <div key={group.id} className={group.vertical === 'separate@1' ? 'sh-group sh-rail-circles' : 'sh-group sh-shared sh-rail-group'}>
      {items.map(item => <ItemView key={item.id} item={item} root={root} rail/>)}</div>)}
    <div className="sh-rail-grow"/>
    <TabBar document={document} tabId={tabId}/>
  </div>;
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
 * The navigation flyout: the tabs as a full-height glass drawer flush to the leading edge (300 pt, at most 80% of the window)
 * under a "Navigation" heading, opened by the header's menu button, with the dim over the whole window including the status
 * strip. At regular width with no hinge (the iPad) it replaces the tab bar; in the iPhone window the `shell-menu` button opens it
 * over the tab bar. Its rows are the same tabs, so Edit still selects them.
 */
export function Flyout({ document, tabId, open, onClose, replacesTabBar = true }: { document: CompositionDocument; tabId?: string; open: boolean; onClose: () => void; /** False beside the tab bar, so the two landmarks differ. */ replacesTabBar?: boolean }) {
  const ctx = useRender();
  const tabs = document.navigation.tabs;
  return <div className="sh-flyout-layer" data-open={open ? '' : undefined} data-beside={replacesTabBar ? undefined : ''} inert={!open || undefined}>
    <div className="sh-flyout-scrim" data-passthrough="" onClick={onClose}/>
    <nav className="sh-flyout" aria-label={replacesTabBar ? 'Tabs' : 'Navigation menu'}>
      <h2 className="sh-flyout-heading">Navigation</h2>
      {tabs.map(tab => <TabButton key={tab.id} tab={tab} selected={tab.id === tabId} ctx={ctx} onPicked={onClose} selectable={replacesTabBar}/>)}
    </nav>
  </div>;
}
/** A tab as a button. `selectable` is false for the second copy of the tabs (the flyout beside a tab bar), which opens only in Use and so is never selected. */
function TabButton({ tab, selected, ctx, onPicked, selectable = true }: { tab: CompositionDocument['navigation']['tabs'][number]; selected: boolean; ctx: ReturnType<typeof useRender>; onPicked?: () => void; selectable?: boolean }) {
  const key: SelectionKey = `tab:${tab.id}`;
  const picked = useIsSelected(ctx.store, key);
  const visible = isShown(tab as VisibilityRule, ctx.env, ctx.previous.get(key));
  ctx.previous.set(key, visible);
  const badge = useBadge(tab.badge, `${key}/badge`);
  if (!visible && ctx.mode === 'use') return null;
  return <button type="button" className="sh-tab" aria-current={selected ? 'page' : undefined} aria-label={badge.spoken ? `${tab.label}, ${badge.spoken}` : undefined} data-sel={selectable ? key : undefined} data-active={selected ? '' : undefined}
    data-selected={selectable && picked && ctx.mode === 'edit' ? '' : undefined} data-hidden={!visible ? '' : undefined}
    onClick={() => { if (ctx.mode === 'use') ctx.run({ type: 'select-tab', tabId: tab.id }); onPicked?.(); }}>
    <span className="sh-tab-glyph"><GlyphByName name={tab.icon.name} size={22}/><Badge badge={badge}/></span><span>{tab.label}</span>
  </button>;
}

/** The sheet's close button, trailing, a glass circle with an X. */
export function CloseButton({ onClose }: { onClose: () => void }) {
  const ctx = useRender();
  return <button type="button" className="sh-circle sh-close" aria-label="Close" title="Close" onClick={() => { if (ctx.mode === 'use') onClose(); }}><X size={18}/></button>;
}
