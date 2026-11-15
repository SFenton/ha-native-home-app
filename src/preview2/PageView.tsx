import { useEffect, useRef, type CSSProperties } from 'react';
import type { CompositionDocument, CompositionGroups } from '../shared/composition/schema';
import { HeaderBar } from './Chrome';
import { Children } from './nodes/Children';
import { points, useSourceText } from './nodes/shared';
import { useRender } from './render-context';

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
  const { mode } = useRender();
  const title = useSourceText(surface.titleSourceId, surface.title);
  useEffect(() => {
    if (scrollToTop > 0) scroller.current?.scrollTo({ top: 0, behavior: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [scrollToTop]);
  const { layout } = surface;
  const column = {
    '--pad-top': `${points(layout.padding.top, 0)}px`, '--pad-lead': `${points(layout.padding.leading, 16)}px`,
    '--pad-bottom': `${points(layout.padding.bottom, 0)}px`, '--pad-trail': `${points(layout.padding.trailing, 16)}px`,
    '--gap': `${points(layout.spacing, 12)}px`, maxWidth: layout.maxWidth.type === 'points' ? layout.maxWidth.value : undefined,
  } as CSSProperties;
  return <div ref={scroller} className="sh-scroll" onScroll={event => { const page = event.currentTarget.closest<HTMLElement>('.sh-page, .sh-sheet'); if (page) setProgress(page, event.currentTarget.scrollTop); }}>
    <div className="sh-column" style={column}>
      {largeTitle && <h1 className="sh-large-title">{title.state === 'ready' && title.text ? title.text : surface.title}</h1>}
      {surface.components.length ? <Children nodes={surface.components} owner={`${'presentation' in surface ? 'modal' : 'page'}:${surface.id}`}/> : <><p className="sh-empty">Nothing on this page yet.</p>{mode === 'edit' && <div className="sh-add-slot" data-add-for={`${'presentation' in surface ? 'modal' : 'page'}:${surface.id}`}/>}</>}
    </div>
  </div>;
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
/** One page of the stack: its header over its scroller. The selection key of the page itself rides on this element. */
export function PageView({ document, page, root, onBack, scrollToTop, motion = '', current, detail }: PageViewProps) {
  const groups: CompositionGroups = page.toolbar.type === 'replace' ? page.toolbar.groups : document.navigation.chrome.groups;
  const title = useSourceText(page.titleSourceId, page.title);
  return <div className={`sh-page ${motion}`.trim()} data-sel={`page:${page.id}`} data-page={page.id} data-current={current ? '' : undefined}
    aria-hidden={current ? undefined : true} inert={!current || undefined}>
    <PageBody surface={page} largeTitle scrollToTop={root ? scrollToTop : 0}/>
    <HeaderBar groups={groups} root={root} onBack={onBack} detail={detail} title={title.state === 'ready' && title.text ? title.text : page.title}/>
  </div>;
}
