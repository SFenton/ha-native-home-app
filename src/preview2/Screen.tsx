import { useEffect, useMemo, useState } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';
import { Flyout, TabBar } from './Chrome';
import { basePageId, columnPanes, tabStack, type NavState } from './navigation';
import { PageView } from './PageView';
import { RenderCtx, useRender } from './render-context';
import { SheetView } from './Sheet';
import { splitGeometry, usesFlyout } from './split';
import type { PreviewWindow } from './windows';

/** How long a push or pop slides, in ms (0.3 s, the app's stack motion). */
const MOTION_MS = 300;

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
  const ctx = useMemo(() => hasFlyout ? { ...parent, flyout: { open: flyoutOpen, toggle: () => setFlyoutOpen(open => !open) } } : parent, [parent, hasFlyout, flyoutOpen]);
  const pageId = basePageId(document, nav);
  const stack = tabStack(document, nav);
  const [shown, setShown] = useState(pageId);
  const [leaving, setLeaving] = useState<{ id: string; motion: 'push' | 'pop' }>();
  if (pageId !== shown) {
    setShown(pageId);
    setLeaving(nav.motion !== 'none' && ctx.mode === 'use' && shown ? { id: shown, motion: nav.motion } : undefined);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(undefined), MOTION_MS + 40);
    return () => clearTimeout(timer);
  }, [leaving]);
  const page = document.pages.find(item => item.id === pageId);
  const out = leaving ? document.pages.find(item => item.id === leaving.id) : undefined;
  const motion = leaving?.motion ?? 'none';
  const background = document.theme.background;
  const geometry = splitGeometry(win), panes = geometry ? columnPanes(document, stack) : undefined;
  const hostPage = panes ? document.pages.find(item => item.id === panes.host) : undefined;
  const detailPage = panes?.detail ? document.pages.find(item => item.id === panes.detail) : undefined;
  const content = geometry && panes && hostPage
    ? <div className="sh-deck sh-columns" data-columns="">
      <div className="sh-pane" style={{ width: geometry.leading }}><PageView key={`lead:${hostPage.id}`} document={document} page={hostPage} root={panes.hostIndex === 0} current
        onBack={() => ctx.run({ type: 'back' })} scrollToTop={nav.scrollTop}/></div>
      <div className="sh-band" data-hinge={geometry.hinge ? '' : undefined} style={{ width: geometry.band }} aria-hidden="true"/>
      <div className="sh-pane" style={{ width: geometry.trailing }} data-pane="detail">
        {detailPage ? <PageView key={`detail:${detailPage.id}`} document={document} page={detailPage} root={false} detail current/>
          : <p className="sh-empty-pane">{panes.placeholder}</p>}
      </div>
    </div>
    : <div className="sh-deck">
      {out && <PageView key={`out:${out.id}`} document={document} page={out} root={false} current={false} motion={`sh-out-${motion}`}/>}
      {page && !nav.emptyBase && <PageView key={page.id} document={document} page={page} root={stack.length <= 1} current onBack={() => ctx.run({ type: 'back' })}
        scrollToTop={nav.scrollTop} motion={leaving ? `sh-in-${motion}` : ''}/>}
    </div>;
  const hinge = win.hinge;
  return <RenderCtx.Provider value={ctx}><div className="sh-screen" data-sel={`page:${pageId}`} data-covered={nav.sheets.length ? '' : undefined}
    data-rail={win.rail ? '' : undefined} data-flyout={hasFlyout ? '' : undefined}
    style={{ '--sh-safe-top': `${win.safeTop}px`, '--sh-safe-bottom': `${win.safeBottom}px`, '--sh-rail': `${win.rail ?? 0}px` } as React.CSSProperties}>
    <div className="sh-wall" data-background={background.type} aria-hidden="true"/>
    {content}
    {hinge && <div className="sh-fold" data-axis={hinge.axis} aria-hidden="true"
      style={hinge.axis === 'vertical' ? { left: (win.rail ?? 0) + hinge.start, width: hinge.length } : { top: hinge.start, height: hinge.length }}/>}
    {hasFlyout ? <Flyout document={document} tabId={nav.tabId} open={flyoutOpen} onClose={() => setFlyoutOpen(false)}/> : <TabBar document={document} tabId={nav.tabId}/>}
    {nav.sheets.map((frame, at) => {
      const modal = document.modals.find(item => item.id === frame.modalId);
      if (!modal) return null;
      return <SheetView key={`${at}:${frame.modalId}`} modal={modal} page={document.pages.find(item => item.id === frame.pages.at(-1))} top={at === nav.sheets.length - 1}
        onClose={() => ctx.run({ type: 'dismiss', scope: 'current-modal' })} onBack={() => ctx.run({ type: 'back' })}/>;
    })}
    <div className="sh-status" aria-hidden="true"><span className="sh-time">9:41</span>{win.safeTop >= 50 && <i className="sh-island"/>}<span className="sh-battery"/></div>
  </div></RenderCtx.Provider>;
}
