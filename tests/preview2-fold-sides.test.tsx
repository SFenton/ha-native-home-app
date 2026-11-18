// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { planFoldSides } from '../src/preview2/fold-sides-plan';
import { windowFold } from '../src/preview2/fold';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { duoWindow, type PreviewWindow } from '../src/preview2/windows';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const base = homeDomains.document as unknown as CompositionDocument;
const named = (name: string) => previewWindows.find(item => item.name === name)!;
const book = duoWindow({ turn: 0, fold: 'partly' }), flat = duoWindow({ turn: 0, fold: 'open' });

/** The Home page with its switch on, or off, and each top-level component's side as `pins` says. */
function home(switchOn: boolean, pins: Record<string, 'span' | 'leading' | 'trailing'> = {}) {
  const document = structuredClone(base);
  const page = document.pages.find(item => item.id === 'page-home')!;
  if (switchOn) page.layout.foldSides = 'auto'; else delete page.layout.foldSides;
  for (const node of page.components) if (pins[node.id]) (node.layout as { foldSide?: string }).foldSide = pins[node.id];
  return document;
}
function mount(document: CompositionDocument, win: PreviewWindow, textScale?: number) {
  const view = render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: 'page-home' }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={win}
    bezel={false} house={demoHouse(document)} overlay={emptyOverlay} onOverlayChange={vi.fn()} textScale={textScale}/>);
  return { ...view, again: (next: PreviewWindow) => view.rerender(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: 'page-home' }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={next}
    bezel={false} house={demoHouse(document)} overlay={emptyOverlay} onOverlayChange={vi.fn()} textScale={textScale}/>) };
}
const column = (root: HTMLElement) => root.querySelector<HTMLElement>('.sh-page[data-current] .sh-column')!;
const nodeIn = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;
const ids = (element: Element | null) => [...(element?.querySelectorAll(':scope > .sh-node') ?? [])].map(item => item.getAttribute('data-sel')!.slice(5));

describe('the windows that have two sides', () => {
  it('gives the Duo partly folded sideways the app\'s three widths: 455.3, the 40.4 band, then what the rail leaves', () => {
    const sides = windowFold(book).sides!;
    expect(sides.leading).toBeCloseTo(455.3, 1);
    expect(sides.band).toBeCloseTo(40.4, 1);
    expect(sides.leading + sides.band + sides.trailing).toBeCloseTo(book.width - (book.rail ?? 0), 1);
    expect(sides.trailing).toBeGreaterThanOrEqual(360);
  });
  it('gives none flat, folded, upright, on the iPhone or on the iPad', () => {
    expect(windowFold(flat).sides).toBeUndefined();
    expect(windowFold(duoWindow({ turn: 0, fold: 'closed' })).sides).toBeUndefined();
    expect(windowFold(duoWindow({ turn: 90, fold: 'partly' })).sides).toBeUndefined();
    expect(windowFold(duoWindow({ turn: 90, fold: 'open' })).sides).toBeUndefined();
    expect(windowFold(named('iPhone')).sides).toBeUndefined();
    expect(windowFold(named('iPad sideways')).sides).toBeUndefined();
  });
  it('turned half way round, the other sideways pose has sides too, the rail on the other edge', () => {
    const turned = duoWindow({ turn: 180, fold: 'partly' });
    const sides = windowFold(turned).sides!;
    expect(sides.leading + sides.band + sides.trailing).toBeCloseTo(turned.width - (turned.rail ?? 0), 1);
    expect(Math.min(sides.leading, sides.trailing)).toBeGreaterThanOrEqual(360);
  });
});

describe('a page on two sides, partly folded sideways', () => {
  it('puts the strip across the top, the first section on the leading side and the next on the trailing, by the automatic rule', () => {
    const { container } = mount(home(true), book);
    const page = column(container);
    expect(page.hasAttribute('data-sides')).toBe(true);
    expect(page.getAttribute('data-sides')).toBe('top');
    expect(ids(page.querySelector('.sh-fold-strip'))).toEqual(['hc-status-rail']);
    expect(ids(page.querySelector('.sh-fold-side[data-side=leading]'))).toEqual(['hc-weather-summary', 'hc-home-cameras']);
    expect(ids(page.querySelector('.sh-fold-side[data-side=trailing]'))).toEqual(['hc-home-guests-visible']);
  });
  it('hands the grid the app\'s widths as tracks: leading, the band, trailing', () => {
    const { container } = mount(home(true), book);
    const style = column(container).style;
    expect(parseFloat(style.getPropertyValue('--fold-lead'))).toBeCloseTo(windowFold(book).sides!.leading, 1);
    expect(parseFloat(style.getPropertyValue('--fold-band'))).toBeCloseTo(40.4, 1);
    expect(parseFloat(style.getPropertyValue('--fold-trail'))).toBeCloseTo(windowFold(book).sides!.trailing, 1);
    expect(style.maxWidth).toBe('');
  });
  it('lets a pinned section move to the other side and keeps its own place in the count', () => {
    const { container } = mount(home(true, { 'hc-home-cameras': 'trailing' }), book);
    const page = column(container);
    expect(ids(page.querySelector('.sh-fold-side[data-side=leading]'))).toEqual(['hc-weather-summary']);
    expect(ids(page.querySelector('.sh-fold-side[data-side=trailing]'))).toEqual(['hc-home-guests-visible', 'hc-home-cameras']);
  });
  it('lays the strip over the leading side at the largest text sizes', () => {
    const { container } = mount(home(true), book, 1.42);
    expect(column(container).getAttribute('data-sides')).toBe('head');
    expect(column(container).hasAttribute('data-strip')).toBe(true);
  });
  it('takes sides from a pinned section alone, with no page switch', () => {
    const { container } = mount(home(false, { 'hc-home-cameras': 'trailing' }), book);
    expect(column(container).getAttribute('data-sides')).toBe('top');
    expect(ids(column(container).querySelector('.sh-fold-side[data-side=trailing]'))).toContain('hc-home-cameras');
  });
  it('is the page it was in every other pose: one column in document order, no box for the groups', () => {
    for (const win of [flat, duoWindow({ turn: 90, fold: 'partly' }), named('iPhone'), named('iPad sideways')]) {
      const { container, unmount } = mount(home(true), win);
      const page = column(container);
      expect(page.hasAttribute('data-sides'), win.name).toBe(false);
      const order = [...page.querySelectorAll<HTMLElement>('.sh-node')].filter(item => item.parentElement?.closest('.sh-node') === null)
        .sort((a, b) => Number(a.style.order) - Number(b.style.order)).map(item => item.getAttribute('data-sel')!.slice(5));
      expect(order, win.name).toEqual(['hc-status-rail', 'hc-weather-summary', 'hc-home-guests-visible', 'hc-home-cameras']);
      unmount();
    }
  });
  it('never re-creates a section when the fold changes: the same elements move', () => {
    const view = mount(home(true), flat);
    const before = ['hc-status-rail', 'hc-weather-summary', 'hc-home-guests-visible', 'hc-home-cameras'].map(id => nodeIn(view.container, id));
    view.again(book);
    expect(column(view.container).hasAttribute('data-sides')).toBe(true);
    expect(['hc-status-rail', 'hc-weather-summary', 'hc-home-guests-visible', 'hc-home-cameras'].map(id => nodeIn(view.container, id))).toEqual(before);
    view.again(flat);
    expect(['hc-status-rail', 'hc-weather-summary', 'hc-home-guests-visible', 'hc-home-cameras'].map(id => nodeIn(view.container, id))).toEqual(before);
  });
});

describe('a page with no word about sides', () => {
  it('draws exactly what it drew: no groups, no order, in every pose', () => {
    for (const win of [book, flat]) {
      const { container, unmount } = mount(home(false), win);
      const page = column(container);
      expect(page.hasAttribute('data-fold-sides')).toBe(false);
      expect(page.querySelector('.sh-fold-side, .sh-fold-strip, .sh-fold-lower')).toBeNull();
      expect(page.querySelector<HTMLElement>('.sh-node')!.style.order).toBe('');
      unmount();
    }
  });
});

describe('the plan of a page', () => {
  const library = new Map();
  const page = (switchOn: boolean) => { const found = structuredClone(base.pages.find(item => item.id === 'page-home')!); if (switchOn) found.layout.foldSides = 'auto'; return found; };
  it('counts a section a rule hides: its side and the others\' do not depend on what is shown', () => {
    const shown = planFoldSides(page(true), library);
    const hidden = page(true);
    const guests = hidden.components.find(item => item.id === 'hc-home-guests-visible')!;
    (guests as { visibleWhen?: unknown }).visibleWhen = { type: 'state', sourceId: 'missing', path: ['state'], in: ['never'] };
    const after = planFoldSides(hidden, library);
    expect([...after.sides]).toEqual([...shown.sides]);
    expect(shown.sides.get('hc-home-guests-visible')).toBe('trailing');
  });
  it('is inactive with no switch and no pinned side, and active with either', () => {
    expect(planFoldSides(page(false), library).active).toBe(false);
    expect(planFoldSides(page(true), library).active).toBe(true);
    const pinned = page(false);
    (pinned.components[3].layout as { foldSide?: string }).foldSide = 'trailing';
    expect(planFoldSides(pinned, library).active).toBe(true);
  });
  it('gives each component its place in the page\'s own order', () => {
    expect([...planFoldSides(page(true), library).order]).toEqual([['hc-status-rail', 0], ['hc-weather-summary', 1], ['hc-home-guests-visible', 2], ['hc-home-cameras', 3]]);
  });
});
