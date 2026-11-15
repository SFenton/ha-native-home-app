import { useEffect, useState } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';
import { TabBar } from './Chrome';
import { basePageId, tabStack, type NavState } from './navigation';
import { PageView } from './PageView';
import { useRender } from './render-context';
import { SheetView } from './Sheet';
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
  const ctx = useRender();
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
  return <div className="sh-screen" data-sel={`page:${pageId}`} data-covered={nav.sheets.length ? '' : undefined}
    style={{ '--sh-safe-top': `${win.safeTop}px`, '--sh-safe-bottom': `${win.safeBottom}px` } as React.CSSProperties}>
    <div className="sh-wall" data-background={background.type} aria-hidden="true"/>
    <div className="sh-deck">
      {out && <PageView key={`out:${out.id}`} document={document} page={out} root={false} current={false} motion={`sh-out-${motion}`}/>}
      {page && !nav.emptyBase && <PageView key={page.id} document={document} page={page} root={stack.length <= 1} current onBack={() => ctx.run({ type: 'back' })}
        scrollToTop={nav.scrollTop} motion={leaving ? `sh-in-${motion}` : ''}/>}
    </div>
    <TabBar document={document} tabId={nav.tabId}/>
    {nav.sheets.map((frame, at) => {
      const modal = document.modals.find(item => item.id === frame.modalId);
      if (!modal) return null;
      return <SheetView key={`${at}:${frame.modalId}`} modal={modal} page={document.pages.find(item => item.id === frame.pages.at(-1))} top={at === nav.sheets.length - 1}
        onClose={() => ctx.run({ type: 'dismiss', scope: 'current-modal' })} onBack={() => ctx.run({ type: 'back' })}/>;
    })}
    <div className="sh-status" aria-hidden="true"><span className="sh-time">9:41</span>{win.safeTop >= 50 && <i className="sh-island"/>}<span className="sh-battery"/></div>
  </div>;
}
