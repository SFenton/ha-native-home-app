import { isHiddenNode } from './model';
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CompositionDocument, CompositionGroups } from '../shared/composition/schema';
import { HeaderBar, headerGroups } from './Chrome';
import { Children } from './nodes/Children';
import { points, useSourceText } from './nodes/shared';
import { useRender } from './render-context';
import { TabDockContext } from './tab-dock';

type Surface = CompositionDocument['pages'][number] | CompositionDocument['modals'][number];

/** Scroll distance over which the large title collapses into the inline one. */
const COLLAPSE = 44;
/** Writes the header progress straight to the element, so scrolling re-renders nothing. */
function setProgress(page: HTMLElement, scrollTop: number) {
  const progress = Math.min(1, Math.max(0, scrollTop / COLLAPSE));
  page.style.setProperty('--sh-progress', String(progress));
  page.style.setProperty('--sh-ramp', `${Math.round(progress * 40)}px`);
}

/** Props of {@link PageBody}. */
export interface PageBodyProps {
  surface: Surface;
  /** A page draws its large title; a sheet's title lives in its bar. */
  largeTitle: boolean;
  /** Asks for a smooth scroll to the top each time the number grows (a tab reselect). */
  scrollToTop?: number;
}
/** The scroller of a page or sheet: the title, then the surface's nodes in its column layout. */
export function PageBody({ surface, largeTitle, scrollToTop = 0 }: PageBodyProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const { mode } = useRender();
  const title = useSourceText(surface.titleSourceId, surface.title);
  useEffect(() => {
    if (scrollToTop > 0) scroller.current?.scrollTo({ top: 0, behavior: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [scrollToTop]);
  const { layout } = surface;
  // The floating action bar is pinned over the bottom edge, outside the scrolling column (`UKPagePinnedBar`); the rest scrolls.
  const pinned = surface.components.filter(node => node.type === 'pinned-actions'), flow = surface.components.filter(node => node.type !== 'pinned-actions');
  const docked = pinned.some(node => !isHiddenNode(node));
  // The scroller keeps the bar's height clear at the end, as the app adds it to the page's bottom safe area.
  useEffect(() => {
    const element = dock.current, host = scroller.current;
    if (!host) return;
    if (!element) { host.style.removeProperty('--sh-dock-h'); return; }
    const apply = () => host.style.setProperty('--sh-dock-h', `${element.offsetHeight}px`);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, [docked]);
  // The bottom tab bar's slot: the bar sits on the safe edge outside the scroller, and its height joins the scroller's bottom inset.
  const [tabDock, setTabDock] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const element = tabDock, host = scroller.current;
    if (!element || !host) return;
    const apply = () => {
      const height = element.offsetHeight;
      host.style.setProperty('--sh-tabs-h', `${height}px`);
      host.toggleAttribute('data-tabs-docked', height > 0);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => { observer.disconnect(); host.style.removeProperty('--sh-tabs-h'); host.removeAttribute('data-tabs-docked'); };
  }, [tabDock]);
  const column = {
    '--pad-top': `${points(layout.padding.top, 0)}px`, '--pad-lead': `${points(layout.padding.leading, 16)}px`,
    '--pad-bottom': `${points(layout.padding.bottom, 0)}px`, '--pad-trail': `${points(layout.padding.trailing, 16)}px`,
    '--gap': `${points(layout.spacing, 12)}px`, maxWidth: layout.maxWidth.type === 'points' ? layout.maxWidth.value : undefined,
  } as CSSProperties;
  return <TabDockContext value={tabDock}><div ref={scroller} className="sh-scroll" onScroll={event => { const page = event.currentTarget.closest<HTMLElement>('.sh-page, .sh-sheet'); if (page) setProgress(page, event.currentTarget.scrollTop); }}>
    <div className="sh-column" style={column}>
      {largeTitle && <h1 className="sh-large-title">{title.state === 'ready' && title.text ? title.text : surface.title}</h1>}
      {flow.some(node => !isHiddenNode(node)) ? <Children nodes={flow} owner={`${'presentation' in surface ? 'modal' : 'page'}:${surface.id}`}/> : <><p className="sh-empty">Nothing on this page yet.</p>{mode === 'edit' && <div className="sh-add-slot" data-add-for={`${'presentation' in surface ? 'modal' : 'page'}:${surface.id}`}/>}</>}
    </div>
  </div>{docked && <div ref={dock} className="sh-dock"><Children nodes={pinned}/></div>}
    <div ref={setTabDock} className="sh-tab-dock" data-tab-dock=""/></TabDockContext>;
}

/** Props of {@link PageView}. */
export interface PageViewProps {
  document: CompositionDocument;
  page: CompositionDocument['pages'][number];
  root: boolean;
  onBack?: () => void;
  scrollToTop?: number;
  /** Classes for the push and pop motion (`sh-in-push`, `sh-out-pop`, ...). */
  motion?: string;
  current: boolean;
  /** The detail pane of a split: no back button and no menu. */
  detail?: boolean;
}
/**
 * One page of the stack: its header over its scroller. The selection key of the page itself rides on this element. Memoised, so
 * the page a push leaves, and the page a window resize or a flyout toggle does not touch, is not drawn again.
 */
export const PageView = memo(function PageView({ document, page, root, onBack, scrollToTop, motion = '', current, detail }: PageViewProps) {
  const groups: CompositionGroups = headerGroups(document, page);
  const { verticalBar } = useRender();
  const title = useSourceText(page.titleSourceId, page.title);
  return <div className={`sh-page ${motion}`.trim()} data-sel={`page:${page.id}`} data-page={page.id} data-current={current ? '' : undefined}
    aria-hidden={current ? undefined : true} inert={!current || undefined}>
    <PageBody surface={page} largeTitle={!verticalBar} scrollToTop={root ? scrollToTop : 0}/>
    <HeaderBar groups={groups} root={root} onBack={onBack} detail={detail} title={title.state === 'ready' && title.text ? title.text : page.title}/>
  </div>;
});
