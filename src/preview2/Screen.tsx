import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';
import { windowFold } from './fold';
import { Flyout, headerGroups, RailBar, TabBar } from './Chrome';
import { basePageId, columnPanes, tabStack, type NavState } from './navigation';
import { PageView } from './PageView';
import { RenderCtx, useRender } from './render-context';
import { SheetView } from './Sheet';
import { wallpaperImage } from './wallpaper';
import { sheetFrame, scalesBackBehindSheet } from './sheet-frame';
import { inVerticalBar, splitGeometry, usesFlyout } from './split';
import { beginTransition, endTransition, MOTION_MS, type Transition } from './transition';
import { railSideOf, type PreviewWindow } from './windows';

/** Props of {@link Screen}. */
export interface ScreenProps {
  document: CompositionDocument;
  nav: NavState;
  window: PreviewWindow;
}

/**
 * The app inside the window: one still wallpaper, the page stack of the selected tab (a push or pop slides both pages a full
 * width, a reduced-motion setting cross-fades), the floating tab bar and any presented sheets over a dimmed, scaled-back page.
 */
export function Screen({ document, nav, window: win }: ScreenProps) {
  const parent = useRender();
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  useEffect(() => setFlyoutOpen(false), [nav.tabId]);
  const hasFlyout = usesFlyout(win) && document.navigation.tabs.length > 0;
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
    return vertical ? { ...base, verticalBar: true } : hasFlyout ? { ...base, flyout: { open: flyoutOpen, toggle } } : hasTabs ? { ...base, menu: { open: flyoutOpen, toggle } } : base;
  }, [parent, fold, vertical, hasFlyout, hasTabs, flyoutOpen]);
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
  const geometry = splitGeometry(win), panes = geometry ? columnPanes(document, stack) : undefined;
  const hostPage = panes ? document.pages.find(item => item.id === panes.host) : undefined;
  const detailPage = panes?.detail ? document.pages.find(item => item.id === panes.detail) : undefined;
  const content = geometry && panes && hostPage
    ? <div className="sh-deck sh-columns" data-columns="">
      <div className="sh-pane" style={{ width: geometry.leading }}><PageView key={`lead:${hostPage.id}`} document={document} page={hostPage} root={panes.hostIndex === 0} current
        onBack={back} scrollToTop={nav.scrollTop}/></div>
      <div className="sh-band" style={{ width: geometry.band }} aria-hidden="true"/>
      <div className="sh-pane" style={{ width: geometry.trailing }} data-pane="detail">
        {detailPage ? <PageView key={`detail:${detailPage.id}`} document={document} page={detailPage} root={false} detail current/>
          : <p className="sh-empty-pane">{panes.placeholder}</p>}
      </div>
    </div>
    : <div className="sh-deck" onAnimationEnd={event => { if ((event.target as HTMLElement).classList.contains(`sh-in-${motion}`)) endMove(leaving?.id); }}>
      {out && <PageView key={out.id} document={document} page={out} root={stack[0] === out.id} current={false} motion={`sh-out-${motion}`}/>}
      {page && !nav.emptyBase && <PageView key={page.id} document={document} page={page} root={stack.length <= 1} current onBack={back}
        scrollToTop={nav.scrollTop} motion={leaving ? `sh-in-${motion}` : ''}/>}
    </div>;
  // The fold's crease: drawn wherever the window can fold, lit only while it is (the book pose), so it fades with the tilt rather than appearing.
  const crease = win.bookHinge;
  const camera = win.camera?.corner.vertical, clear = win.camera?.statusColumn.height ?? 0;
  // The rail carries the trailing header items of the page the header shows: the host page of a split, else the top of the stack.
  const headerPage = hostPage ?? page;
  const rootPage = panes ? panes.hostIndex === 0 : stack.length <= 1;
  return <RenderCtx.Provider value={ctx}><div className="sh-screen" data-sel={`page:${pageId}`} data-covered={nav.sheets.length > 0 && scalesBackBehindSheet(win) ? '' : undefined}
    data-rail={win.rail ? '' : undefined} data-rail-side={win.rail ? railSideOf(win) : undefined} data-camera={camera} data-short-bar={win.safeTop < 50 ? '' : undefined} data-flyout={hasFlyout ? '' : undefined}
    style={{ '--sh-safe-top': `${win.safeTop}px`, '--sh-safe-bottom': `${win.safeBottom}px`, '--sh-rail': `${win.rail ?? 0}px`, '--sh-rail-bar': `${win.railBar ?? win.rail ?? 0}px`,
      '--sh-camera-top': `${camera === 'top' ? clear : 0}px`, '--sh-camera-bottom': `${camera === 'bottom' ? clear : 0}px` } as React.CSSProperties}>
    <div className="sh-wall" data-background={background.type} aria-hidden="true">{image && <div className="sh-wall-image" style={{ backgroundImage: `url("${image.url}")`, filter: `blur(${image.blur}px)` }}/>}</div>
    {content}
    {crease && <div className="sh-crease" data-axis={crease.axis} data-on={win.hinge ? '' : undefined} aria-hidden="true"
      style={crease.axis === 'vertical' ? { left: crease.start, width: crease.length } : { top: crease.start, height: crease.length }}/>}
    {vertical && hasTabs && headerPage ? <RailBar document={document} tabId={nav.tabId} groups={headerGroups(document, headerPage)} root={rootPage}/>
      : !hasFlyout && <TabBar document={document} tabId={nav.tabId}/>}
    {hasTabs && !vertical && (hasFlyout || flyoutOpen || lingering) && <Flyout document={document} tabId={nav.tabId} open={flyoutOpen} onClose={() => setFlyoutOpen(false)} replacesTabBar={hasFlyout}/>}
    {nav.sheets.map((frame, at) => {
      const modal = document.modals.find(item => item.id === frame.modalId);
      if (!modal) return null;
      return <SheetView key={`${at}:${frame.modalId}`} modal={modal} frame={sheetFrame(win, modal.presentation)} page={document.pages.find(item => item.id === frame.pages.at(-1))} top={at === nav.sheets.length - 1}
        onClose={() => ctx.run({ type: 'dismiss', scope: 'current-modal' })} onBack={() => ctx.run({ type: 'back' })}/>;
    })}
    {win.camera
      // The closed Duo has no status bar across the top: the time and the connection stack on the rail, in the region kept clear around the camera (HIG, Designing for iPhone Duo, Vertical controls).
      ? <div className="sh-rail-status" data-camera-h={win.camera.corner.horizontal} data-camera-v={win.camera.corner.vertical} aria-hidden="true"
        style={{ left: win.camera.statusColumn.x, top: win.camera.statusColumn.y, width: win.camera.statusColumn.width, height: win.camera.statusColumn.height, '--sh-camera-y': `${win.camera.y - win.camera.statusColumn.y}px`, '--sh-camera-size': `${win.camera.size}px`, '--sh-keep-h': `${win.camera.statusColumn.height}px` } as React.CSSProperties}>
        <span className="sh-time">9:41</span><i className="sh-wifi"/>
      </div>
      : <div className="sh-status" aria-hidden="true"><span className="sh-time">9:41</span>{win.island && <i className="sh-island"/>}<span className="sh-battery"/></div>}
  </div></RenderCtx.Provider>;
}
