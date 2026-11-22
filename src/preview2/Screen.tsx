import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';
import { windowFold } from './fold';
import { Flyout, headerGroups, TabBarSlot } from './Chrome';
import { hidesTabs } from './chrome-hide';
import { RailBar } from './RailBar';
import { WifiMark } from './WifiMark';
import { basePageId, tabStack, type NavState } from './navigation';
import { arrangeWide, leadingButton, type LeadingButton } from './wide-open';
import { openedNodes } from './opened-row';
import { PageView } from './PageView';
import { RenderCtx, useRender } from './render-context';
import { SheetView } from './Sheet';
import { aloneSheet } from './level-sheet';
import { wallpaperImage } from './wallpaper';
import { sheetFrame, scalesBackBehindSheet } from './sheet-frame';
import { inVerticalBar, splitGeometry, tabsAtTop } from './split';
import { beginTransition, endTransition, MOTION_MS, type Transition } from './transition';
import { railCentre, railSideOf, type PreviewWindow } from './windows';
import { railLayout, statusStack } from './rail-layout';
import { RAIL, STATUS } from './rail-constants';

/** Props of {@link Screen}. */
export interface ScreenProps {
  document: CompositionDocument;
  nav: NavState;
  window: PreviewWindow;
}

/** Marks the nodes of the leading pane that opened the trailing page: `data-opened` on each, set after the nodes draw. */
function OpenedRow({ ids }: { ids: string[] }) {
  const mark = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const pane = mark.current?.parentElement;
    if (!pane) return;
    const apply = () => pane.querySelectorAll<HTMLElement>('[data-sel^="node:"]').forEach(node => {
      if (ids.includes(node.dataset.sel!.slice(5))) node.setAttribute('data-opened', ''); else node.removeAttribute('data-opened');
    });
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(pane, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ids]);
  return <span ref={mark} hidden/>;
}

/**
 * The app inside the window: one still wallpaper, the page stack of the selected tab (a push or pop slides both pages a full
 * width, a reduced-motion setting cross-fades), the tab bar (floating at the bottom, at the top on the iPad, the rail on a Duo) while the page on top
 * does not hide it, and any presented sheets over a dimmed, scaled-back page. A wide window draws the stack in columns by each page's `wideOpen` (`arrangeWide`).
 */
export function Screen({ document, nav, window: win }: ScreenProps) {
  const parent = useRender();
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  useEffect(() => setFlyoutOpen(false), [nav.tabId]);
  // The iPad draws the tabs at the top and no menu button; no flyout there.
  const topTabs = tabsAtTop(win) && document.navigation.tabs.length > 0;
  // Beside the tab bar the flyout is mounted while open and for the slide out, so the page carries one copy of the tabs at rest.
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (flyoutOpen) { setLingering(true); return; }
    const timer = setTimeout(() => setLingering(false), 400);
    return () => clearTimeout(timer);
  }, [flyoutOpen]);
  // The vertical bar (the Duo's rail) has no menu button, so nothing opens a flyout there: the system draws no hamburger beside it.
  const vertical = inVerticalBar(win);
  const hasTabs = document.navigation.tabs.length > 0;
  const toggle = () => setFlyoutOpen(open => !open);
  useEffect(() => { if (vertical) setFlyoutOpen(false); }, [vertical]);
  const fold = useMemo(() => windowFold(win), [win]);
  const ctx = useMemo(() => {
    const base = { ...parent, fold };
    return vertical ? { ...base, verticalBar: true } : topTabs ? { ...base, topTabs: true } : hasTabs ? { ...base, menu: { open: flyoutOpen, toggle } } : base;
  }, [parent, fold, vertical, topTabs, hasTabs, flyoutOpen]);
  const pageId = basePageId(document, nav);
  const stack = tabStack(document, nav);
  const [transition, setTransition] = useState<Transition>({ shown: pageId });
  const next = beginTransition(transition, pageId, nav.motion, ctx.mode === 'use');
  if (next !== transition) setTransition(next);
  const leaving = next.leaving;
  const endMove = useCallback((id?: string) => setTransition(now => endTransition(now, id)), []);
  // The move ends with the incoming page's animation; the timer only covers a browser that runs none.
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => endMove(leaving.id), MOTION_MS + 120);
    return () => clearTimeout(timer);
  }, [leaving, endMove]);
  const back = useCallback(() => ctx.run({ type: 'back' }), [ctx]);
  const page = document.pages.find(item => item.id === pageId);
  const out = leaving ? document.pages.find(item => item.id === leaving.id) : undefined;
  const motion = leaving?.motion ?? 'none';
  const background = document.theme.background;
  const image = wallpaperImage(document);
  const geometry = splitGeometry(win), layout = geometry ? arrangeWide(document, stack) : undefined;
  const columns = geometry && layout?.type === 'columns' ? layout : undefined;
  const pageAt = (index: number | undefined) => index === undefined ? undefined : document.pages.find(item => item.id === stack[index]);
  const hostPage = pageAt(columns?.leading), openedPage = pageAt(columns?.trailing);
  // Nothing opened yet: the trailing pane shows the host's empty-side text, not a page.
  const detailPage = openedPage;
  const leadKind: LeadingButton = columns ? leadingButton(columns) : stack.length > 1 ? 'back' : 'none';
  // The page opened last decides the one bar's items and whether the tabs show; in a narrow window that is the page on top as well.
  const topIndex = stack.length - 1, decider = document.pages.find(item => item.id === stack[topIndex]);
  const tabsHidden = hasTabs && hidesTabs(decider?.hides, document.navigation.tabsVisibility, topIndex);
  // A push from the leading column cuts the trailing one first: the pane tells the reducer who sent it.
  const leadingSender = hostPage?.id;
  const leadingCtx = useMemo(() => leadingSender ? { ...ctx, run: (...args: Parameters<typeof ctx.run>) => ctx.run(args[0], args[1], args[2], args[3], leadingSender) } : ctx, [ctx, leadingSender]);
  // The row of the leading pane that opened the trailing one stays selected, in the cascade too (HIG, Split views).
  const openedIds = useMemo(() => hostPage && openedPage ? openedNodes(hostPage, openedPage.id) : [], [hostPage, openedPage]);
  const content = geometry && columns && hostPage
    ? <div className="sh-deck sh-columns" data-columns="" data-layout={`${columns.leading}:${columns.trailing ?? ''}`}>
      <div className="sh-pane" data-pane="leading" style={{ width: geometry.leading }}><RenderCtx.Provider value={leadingCtx}><PageView key={`lead:${hostPage.id}`} document={document} page={hostPage} root={leadKind === 'none'} depth={topIndex} chrome={decider}
        close={leadKind === 'close'} column="leading" current onBack={back} scrollToTop={nav.scrollTop}/></RenderCtx.Provider><OpenedRow ids={openedIds}/></div>
      <div className="sh-band" style={{ width: geometry.band }} aria-hidden="true"/>
      <div className="sh-pane" style={{ width: geometry.trailing }} data-pane="detail">
        {detailPage ? <PageView key={`detail:${detailPage.id}`} document={document} page={detailPage} root={false} depth={topIndex} chrome={decider} column="trailing" detail current/>
          : <p className="sh-empty-pane">{hostPage.navigation.type === 'navigation-columns' ? hostPage.navigation.placeholder : ''}</p>}
      </div>
    </div>
    : <div className="sh-deck" onAnimationEnd={event => { if ((event.target as HTMLElement).classList.contains(`sh-in-${motion}`)) endMove(leaving?.id); }}>
      {out && <PageView key={out.id} document={document} page={out} root={stack[0] === out.id} depth={Math.max(0, stack.indexOf(out.id))} current={false} motion={`sh-out-${motion}`} sides/>}
      {page && !nav.emptyBase && <PageView key={page.id} document={document} page={page} root={stack.length <= 1} depth={topIndex} current onBack={back}
        scrollToTop={nav.scrollTop} motion={leaving ? `sh-in-${motion}` : ''} sides/>}
    </div>;
  // The fold's crease: drawn wherever the window can fold, lit only while it is (the book pose), so it fades with the tilt rather than appearing.
  const crease = win.bookHinge;
  const camera = win.camera?.corner.vertical;
  // The rail carries the trailing header items of the page the header shows: the host page of a split, else the top of the stack.
  const headerPage = decider;
  const railStatus = win.camera && win.pose ? statusStack(win.pose.turn, win.height) : undefined;
  const rootPage = stack.length <= 1;
  return <RenderCtx.Provider value={ctx}><div className="sh-screen" data-sel={`page:${pageId}`} data-covered={nav.sheets.length > 0 && scalesBackBehindSheet(win) ? '' : undefined}
    data-rail={win.rail ? '' : undefined} data-rail-side={win.rail ? railSideOf(win) : undefined} data-camera={camera} data-short-bar={win.safeTop < 50 ? '' : undefined} data-tabs-top={topTabs ? '' : undefined} data-tabs-hidden={tabsHidden ? '' : undefined}
    style={{ '--sh-safe-top': `${win.safeTop}px`, '--sh-safe-bottom': `${win.safeBottom}px`, '--sh-rail': `${win.rail ?? 0}px` } as React.CSSProperties}>
    <div className="sh-wall" data-background={background.type} aria-hidden="true">{image && <div className="sh-wall-image" style={{ backgroundImage: `url("${image.url}")`, filter: `blur(${image.blur}px)` }}/>}</div>
    {content}
    {crease && <div className="sh-crease" data-axis={crease.axis} data-on={win.hinge ? '' : undefined} aria-hidden="true"
      style={crease.axis === 'vertical' ? { left: crease.start, width: crease.length } : { top: crease.start, height: crease.length }}/>}
    {vertical && hasTabs && headerPage ? <RailBar document={document} tabId={nav.tabId} groups={headerGroups(document, headerPage, topIndex)} root={rootPage} window={win} tabsHidden={tabsHidden} leading={leadKind} onLeading={back}/>
      : hasTabs && <TabBarSlot document={document} tabId={nav.tabId} hidden={tabsHidden}/>}
    {hasTabs && !vertical && !topTabs && (flyoutOpen || lingering) && <Flyout document={document} tabId={nav.tabId} open={flyoutOpen} onClose={() => setFlyoutOpen(false)}/>}
    {nav.sheets.map((frame, at) => {
      const alone = frame.alone ? document.levels?.find(item => item.id === frame.modalId) : undefined;
      const modal = alone ? aloneSheet(alone) : document.modals.find(item => item.id === frame.modalId);
      if (!modal) return null;
      // A level drawn alone follows the levels pushed inside it: the one on top is drawn, and Back returns to the one beneath.
      const inside = frame.pages.at(-1), level = document.levels?.find(item => item.id === (inside ?? (alone ? alone.id : undefined)));
      // Back returns to the level beneath, else to the sheet; the bar and the rail both name it.
      const beneath = frame.pages.at(-2), backTo = (beneath === undefined ? modal : document.levels?.find(item => item.id === beneath) ?? document.pages.find(item => item.id === beneath))?.title;
      const placed = sheetFrame(win, modal.presentation);
      const pushed = frame.pages.length;
      // The folded Duo's sheet fills the height, so its Close sits in the rail like any sheet's (`DuoSheetPolicy`, `UKHassModal`): under the camera's keep-clear region and the status items, never beside the title.
      const rail = win.camera && win.rail !== undefined && placed.placement === 'bottom' ? (() => {
        const buttons = pushed ? 2 : 1;
        const laid = railLayout({ width: win.width, length: win.height, side: railSideOf(win), camera: { end: win.camera.corner.vertical, reach: win.camera.reach }, tabs: 0,
          groups: [{ id: 'sheet', shared: false, items: Array.from({ length: buttons }, (_, key) => ({ key: String(key), priority: 'required' as const })) }] });
        return { centre: laid.centre, top: laid.header?.top ?? RAIL.openTop, side: railSideOf(win), back: pushed > 0 };
      })() : undefined;
      return <SheetView key={`${at}:${frame.modalId}`} modal={modal} frame={placed} rail={rail} alone={alone !== undefined} back={pushed > 0} backTo={backTo} page={level ?? document.pages.find(item => item.id === inside)} closeAlways={level !== undefined} top={at === nav.sheets.length - 1}
        onClose={() => ctx.run({ type: 'dismiss', scope: 'current-modal' })} onBack={() => ctx.navigate?.({ type: 'back' })}/>;
    })}
    {win.camera
      // The closed Duo has no status bar across the top: at the portrait turns the time and the connection mark stack on the rail's centre line, in the region kept clear around the camera (HIG, Designing for iPhone Duo, Vertical controls); at 90 and 270 native shows neither.
      ? railStatus && <div className="sh-rail-status" aria-hidden="true" data-camera-h={win.camera.corner.horizontal} data-camera-v={win.camera.corner.vertical} style={{ '--rail-cx': `${railCentre(win)}px`, '--rail-time': `${STATUS.timeSize}px` } as React.CSSProperties}>
        <span className="sh-time" style={{ top: railStatus.time }}>9:41</span><WifiMark style={{ top: railStatus.wifi }}/>
      </div>
      : <div className="sh-status" aria-hidden="true"><span className="sh-time">9:41</span>{win.island && <i className="sh-island"/>}<span className="sh-battery"/></div>}
  </div></RenderCtx.Provider>;
}
