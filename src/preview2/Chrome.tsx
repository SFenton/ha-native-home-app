import { ChevronLeft, X } from 'lucide-react';
import { useRef, type CSSProperties, type ReactNode } from 'react';
import type { CompositionActionSlot, CompositionDocument, CompositionGroups } from '../shared/composition/schema';
import { chromeGroups } from './chrome-hide';
import { useBarPresence, type BarPhase } from './bar-presence';
import { isShown, type VisibilityRule } from './evaluate';
import type { SelectionKey } from './model';
import { RAIL } from './rail-constants';
import { Badge, GlyphByName, useBadge, type BadgeFace } from './nodes/shared';
import { AvatarDisc, useViewerName } from './nodes/avatar';
import { useRender } from './render-context';
import { useIsSelected } from './selection-store';
import { useTabHold } from './useTabHold';
import { tabBarVars } from './rail-style';

type Item = CompositionGroups[number]['items'][number];

/** A header circle: glass, 44 pt, selectable in Edit and acting in Use (its action, or `onPress` for the menu). */
export function Circle({ selKey, label, icon, action, onPress, expanded, className = '', badge, disc, glyph = 20 }: { selKey?: SelectionKey; label: string; icon: string; action?: CompositionActionSlot; onPress?: () => void; expanded?: boolean; className?: string; badge?: BadgeFace | null; /** Drawn in place of the glyph: the Profile disc. */ disc?: ReactNode; /** The glyph's size in points. */ glyph?: number }) {
  const ctx = useRender();
  const selected = useIsSelected(ctx.store, selKey ?? 'chrome-item:');
  return <button type="button" className={`sh-circle ${className}`.trim()} aria-label={label} title={label} data-sel={selKey}
    data-selected={selKey && selected && ctx.mode === 'edit' ? '' : undefined}
    aria-expanded={expanded} onClick={() => { if (ctx.mode !== 'use') return; if (action) ctx.run(action); onPress?.(); }}>{disc ?? <GlyphByName name={icon} size={glyph}/>}<Badge badge={badge}/></button>;
}
/** A header button with its badge (`sh.badges@1`). */
export function ButtonItem({ item }: { item: Extract<Item, { type: 'button' }> }) {
  const badge = useBadge(item.badge, `chrome-item:${item.id}/badge`);
  return <Circle selKey={`chrome-item:${item.id}`} label={badge.spoken ? `${item.label}, ${badge.spoken}` : item.label} icon={item.icon.name} action={item.action} badge={badge}/>;
}

/**
 * The header's Profile button. With a `profile` block (`sh.shell-profile@1`) it draws the person's disc or the person symbol, with the authored badge;
 * the label is "Profile" and the badge's spoken words follow it. `photo` (and no block, as the app does: photo first) draws a fixed grey stand-in, the same for every person
 * and house, because the Studio never draws a person's picture (house data); `initials` is the blue disc with letters; `symbol` is the outlined person on glass, no fill.
 */
export function ProfileCircle({ item, rail }: { item: Extract<Item, { type: 'shell-header' }>; rail: boolean }) {
  const profile = item.profile;
  const badge = useBadge(profile?.badge, `chrome-item:${item.id}/profile/badge`);
  const name = useViewerName();
  const look = profile?.look ?? 'photo';
  // The rail's disc is 30 pt in a 48.5 pt circle (A4); the horizontal header's is the circle's 44 pt.
  const size = rail ? RAIL.glyph.profile : 44;
  return <Circle selKey={`chrome-item:${item.id}`} label={badge.spoken ? `Profile, ${badge.spoken}` : 'Profile'} icon="person.crop.circle" action={item.profileAction}
    badge={badge} glyph={rail ? RAIL.glyph.profile : 24} className="sh-profile" disc={look === 'symbol' ? undefined : <AvatarDisc name={name} size={size} look={look} standIn/>}/>;
}

/** The two buttons of the app's `shell-header` item: Quick Links, then Profile. */
function ItemView({ item, root, rail = false }: { item: Item; root: boolean; /** In the vertical bar Profile is the person symbol (`person.crop.circle`). */ rail?: boolean }) {
  const ctx = useRender();
  // The menu opens the flyout over the tab bar. Where the tabs sit at the top (the iPad) there is no menu, and the vertical bar has none either.
  if (item.type === 'shell-menu') return root && !ctx.topTabs && !ctx.verticalBar ? <Circle selKey={`chrome-item:${item.id}`} label={item.label} icon={item.icon.name} onPress={ctx.menu?.toggle} expanded={ctx.menu?.open}/> : null;
  // What the app or the page hides is already out of the groups (`chromeGroups`).
  if (item.type === 'button') return <ButtonItem item={item}/>;
  return <>
    <Circle selKey={`chrome-item:${item.id}`} label="Quick Links" icon="square.grid.2x2" action={item.quickLinksAction}/>
    <ProfileCircle item={item} rail={rail}/>
  </>;
}

/**
 * The chrome groups a page shows at `depth` pages below it: its own when it replaces the toolbar, else the document's, less what the app or the page
 * hides (`chromeGroups`). Back and Close are drawn by the bar itself and are never in a group.
 */
export const headerGroups = (document: CompositionDocument, page: CompositionDocument['pages'][number], depth: number): CompositionGroups => chromeGroups(document, page, depth);

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
  /** The leading button is Close (an X) rather than Back: the first page of a column set, which Close returns to full width. It goes where Back goes and is never hidden. */
  close?: boolean;
  /** In columns the bar is one across both panes: a pane draws its own half only. */
  column?: 'leading' | 'trailing';
}
/**
 * The page header: transparent over the wallpaper, leading and trailing glass buttons from the chrome groups, a back button
 * on a pushed page, and the inline title that replaces the large one once the page scrolls (`--sh-progress`).
 */
export function HeaderBar({ groups, root, onBack, title, detail, close, column }: HeaderBarProps) {
  const ctx = useRender();
  const vertical = ctx.verticalBar === true;
  // In the vertical bar the eligible items are in the rail; only a `horizontal-only` button stays here.
  const render = (placement: 'leading' | 'trailing') => groups.filter(group => group.placement === placement).map(group => ({ group, items: vertical ? group.items.filter(item => !railEligible(item) && item.type !== 'shell-menu') : group.items })).filter(entry => entry.items.length).map(({ group, items }) =>
    <div key={group.id} className={`sh-group ${group.horizontal === 'shared@1' ? 'sh-shared' : 'sh-separate'}`}>{items.map(item => <ItemView key={item.id} item={item} root={root}/>)}</div>);
  return <header className="sh-header" data-vertical={vertical ? '' : undefined}>
    <div className="sh-bar-side">
      {!root && !detail && !vertical && (close
        ? <button type="button" className="sh-circle sh-close" aria-label="Close" title="Close" data-leading="close" onClick={() => { if (ctx.mode === 'use') onBack?.(); }}><X size={18}/></button>
        // Back is the chevron alone, with no title (`backButtonDisplayMode = .minimal`), and never hidden.
        : <button type="button" className="sh-circle" aria-label="Back" title="Back" data-leading="back" onClick={() => { if (ctx.mode === 'use') onBack?.(); }}><ChevronLeft size={22}/></button>)}{column !== 'trailing' && render('leading')}</div>
    <h2 className="sh-inline-title" aria-hidden="true">{title}</h2>
    <div className="sh-bar-side sh-trailing">{column !== 'leading' && render('trailing')}</div>
  </header>;
}

/**
 * Whether an item may sit in the vertical bar. The `shell-header` (Quick Links, Profile) always may; a `button` may unless it says
 * `rail: horizontal-only`; the menu never does (`UKServerUIChrome.apply`: `axisBehavior`, and `showsMenuButton` is false there).
 */
export const railEligible = (item: Item): boolean => item.type === 'shell-header' || (item.type === 'button' && item.rail === 'eligible');
/** The items of a group the vertical bar shows now: eligible ones, and not a root-only item on a pushed page. */
export const railItems = (group: CompositionGroups[number], root: boolean) => group.items.filter(item => railEligible(item) && (root || item.visibility !== 'root-only'));

/** Whether a tab is drawn now: its visibility rule against the environment (Edit draws every tab, dimmed). Remembers the answer, as a rule that says `keep` needs. */
export function tabIsShown(tab: CompositionDocument['navigation']['tabs'][number], ctx: ReturnType<typeof useRender>): boolean {
  const key: SelectionKey = `tab:${tab.id}`;
  const visible = isShown(tab as VisibilityRule, ctx.env, ctx.previous.get(key));
  ctx.previous.set(key, visible);
  return visible;
}
/** How many tabs the tab bar draws: in Use a tab its rule hides is not drawn, so it does not count (the rail's height, its compression and the lens depend on it). */
export function useShownTabCount(document: CompositionDocument): number {
  const ctx = useRender();
  const tabs = document.navigation.tabs;
  return ctx.mode === 'use' ? tabs.filter(tab => tabIsShown(tab, ctx)).length : tabs.length;
}

/**
 * The floating tab bar: a glass capsule of the document's tabs, the selected one lit. Pressing and holding it shows what native shows: on the
 * Duo's vertical bar the pill widens and every icon gains its label, and on every bar a lens sits on the tab under the pointer and follows it along
 * the bar; a tab is selected when the press is released over it, never before (`tab-hold.ts`). `vertical` is the Duo's rail; `style` carries its layout.
 */
export function TabBar({ document, tabId, vertical = false, style, phase = 'rest' }: { document: CompositionDocument; tabId?: string; vertical?: boolean; style?: CSSProperties; /** `hiding` or `showing` while the bar moves with a push or a pop; `rest` otherwise. */ phase?: BarPhase }) {
  const ctx = useRender();
  const tabs = document.navigation.tabs, count = useShownTabCount(document);
  const bar = useRef<HTMLElement>(null);
  // A held release picks a tab the way a click does: the click runs the tab's action in Use and selects it in Edit.
  const hold = useTabHold(bar, vertical ? 'y' : 'x', index => bar.current?.querySelectorAll<HTMLElement>('.sh-tab')[index]?.click());
  if (!tabs.length) return null;
  return <nav ref={bar} className="sh-tabbar" aria-label="Tabs" data-no-pan="" data-hold={hold.held ? '' : undefined} data-phase={phase === 'rest' ? undefined : phase} onPointerDown={hold.bind.onPointerDown} onContextMenu={hold.bind.onContextMenu}
    style={{ ...tabBarVars(), ...style, '--hold-p': hold.position, '--tab-n': count } as CSSProperties}>
    {tabs.map(tab => <TabButton key={tab.id} tab={tab} selected={tab.id === tabId} ctx={ctx}/>)}
    <span className="sh-tab-lens" aria-hidden="true"/>
  </nav>;
}
/**
 * The tab navigator as the page on top wants it: drawn, or not drawn while the page hides it (`hidden`; `sh.page-chrome-hide@1`, `sh.tabs-visibility@1`). It moves out and back
 * with the push or the pop that causes it, and not at all under Reduce Motion or in Edit, where it appears and disappears at once. Hidden at rest it is not in the tree.
 */
export function TabBarSlot({ document, tabId, vertical = false, hidden }: { document: CompositionDocument; tabId?: string; vertical?: boolean; hidden: boolean }) {
  const ctx = useRender();
  const presence = useBarPresence(hidden, ctx.mode === 'use');
  return presence.mounted ? <TabBar document={document} tabId={tabId} vertical={vertical} phase={presence.phase}/> : null;
}
/**
 * The navigation flyout: the tabs as a full-height glass drawer flush to the leading edge (300 pt, at most 80% of the window)
 * under a "Navigation" heading, opened by the header's menu button, with the dim over the whole window including the status
 * strip. At regular width with no hinge (the iPad) it replaces the tab bar; in the iPhone window the `shell-menu` button opens it
 * over the tab bar. Its rows are the same tabs, so Edit still selects them.
 */
export function Flyout({ document, tabId, open, onClose }: { document: CompositionDocument; tabId?: string; open: boolean; onClose: () => void }) {
  const ctx = useRender();
  const tabs = document.navigation.tabs;
  return <div className="sh-flyout-layer" data-open={open ? '' : undefined} data-beside="" inert={!open || undefined}>
    <div className="sh-flyout-scrim" data-passthrough="" onClick={onClose}/>
    <nav className="sh-flyout" aria-label="Navigation menu">
      <h2 className="sh-flyout-heading">Navigation</h2>
      {tabs.map(tab => <TabButton key={tab.id} tab={tab} selected={tab.id === tabId} ctx={ctx} onPicked={onClose} selectable={false}/>)}
    </nav>
  </div>;
}
/** A tab as a button. `selectable` is false for the second copy of the tabs (the flyout beside a tab bar), which opens only in Use and so is never selected. */
function TabButton({ tab, selected, ctx, onPicked, selectable = true }: { tab: CompositionDocument['navigation']['tabs'][number]; selected: boolean; ctx: ReturnType<typeof useRender>; onPicked?: () => void; selectable?: boolean }) {
  const key: SelectionKey = `tab:${tab.id}`;
  const picked = useIsSelected(ctx.store, key);
  const visible = tabIsShown(tab, ctx);
  const badge = useBadge(tab.badge, `${key}/badge`);
  if (!visible && ctx.mode === 'use') return null;
  return <button type="button" className="sh-tab" aria-current={selected ? 'page' : undefined} aria-label={badge.spoken ? `${tab.label}, ${badge.spoken}` : undefined} data-sel={selectable ? key : undefined} data-active={selected ? '' : undefined}
    data-selected={selectable && picked && ctx.mode === 'edit' ? '' : undefined} data-hidden={!visible ? '' : undefined}
    onClick={() => { if (ctx.mode === 'use') ctx.run({ type: 'select-tab', tabId: tab.id }); onPicked?.(); }}>
    <span className="sh-tab-glyph"><GlyphByName name={tab.icon.name} size={22}/><Badge badge={badge}/></span><span className="sh-tab-label">{tab.label}</span>
  </button>;
}

/** The sheet's close button, trailing, a glass circle with an X. */
export function CloseButton({ onClose }: { onClose: () => void }) {
  const ctx = useRender();
  return <button type="button" className="sh-circle sh-close" aria-label="Close" title="Close" onClick={() => { if (ctx.mode === 'use') onClose(); }}><X size={18}/></button>;
}
