// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { useBarPresence } from '../src/preview2/bar-presence';
import { demoHouse } from '../src/preview2/demo-house';
import { emptyOverlay, type Overlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type PreviewSurface, type PreviewWindow } from '../src/preview2/Preview2';
import { duoWindow } from '../src/preview2/windows';
import { demoDocument } from './preview2-gc-fixture';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const [iphone, , , duoSideways, ipadUpright, ipadSideways] = previewWindows;

/** The shell's job: it holds the surface and the overlay and passes them down. */
function Shell({ document, window: win = iphone, mode = 'use' }: { document: CompositionDocument; window?: PreviewWindow; mode?: 'edit' | 'use' }) {
  const [surface, setSurface] = useState<PreviewSurface>({ kind: 'page', id: 'page-home' });
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
  return <Preview2 document={document} mode={mode} surface={surface} onSurfaceChange={setSurface} onSelect={() => undefined} window={win} bezel={false}
    house={demoHouse(document)} overlay={overlay} onOverlayChange={setOverlay}/>;
}
const tapIn = (scope: Element, target: string) => act(() => { fireEvent.click(scope.querySelector<HTMLElement>(`[data-sel^="node:"][data-sel$="_to_${target}"] button`)!); });
const current = (root: HTMLElement) => root.querySelector<HTMLElement>('.sh-page[data-current]')!;
/** Ends the slide of the page that is coming in, as the browser's `animationend` does, and lets the tab navigator's own move run out. */
const settle = (root: HTMLElement) => act(() => { root.querySelectorAll('.sh-page[class*="sh-in-"]').forEach(page => fireEvent.animationEnd(page)); vi.advanceTimersByTime(400); });
const labels = (scope: Element) => [...scope.querySelectorAll('.sh-header button')].map(button => button.getAttribute('aria-label'));

describe('a push from a sheet in the preview', () => {
  it('closes the sheet and every level, then lands the page on the tab; Back returns to the page under the sheet', () => {
    const { container } = render(<Shell document={demoDocument()}/>);
    tapIn(container, 'sheet');
    const sheet = container.querySelector('.sh-sheet')!;
    expect(sheet.getAttribute('aria-label')).toBe('Demo Sheet');
    tapIn(sheet, 'demo_level_a');
    expect(container.querySelector('.sh-sheet')!.getAttribute('aria-label')).toBe('Demo Level A');
    tapIn(container.querySelector('.sh-sheet')!, 'demo_plain');
    expect(container.querySelector('.sh-sheet')).toBeNull();
    settle(container);
    expect(current(container).dataset.page).toBe('demo_plain');
    act(() => { fireEvent.click(current(container).querySelector('button[aria-label="Back"]')!); });
    settle(container);
    expect(current(container).dataset.page).toBe('page-home');
    expect(container.querySelector('.sh-sheet')).toBeNull();
  });

  it('a level stays in the sheet with Back and Close, whatever the sheet\'s own Close rule says', () => {
    const document = demoDocument();
    const { container } = render(<Shell document={document}/>);
    tapIn(container, 'sheet');
    const root = container.querySelector('.sh-sheet')!;
    expect(root.querySelector('button[aria-label="Back"]')).toBeNull();
    tapIn(root, 'demo_level_a');
    const level = container.querySelector('.sh-sheet')!;
    expect(level.querySelector('button[aria-label="Back"]')).not.toBeNull();
    expect(level.querySelector('button[aria-label="Close"]')).not.toBeNull();
    // A level on a level: still in the sheet, with both buttons.
    tapIn(level, 'demo_level_b');
    expect(container.querySelectorAll('.sh-sheet')).toHaveLength(1);
    expect(container.querySelector('.sh-sheet button[aria-label="Close"]')).not.toBeNull();
    act(() => { fireEvent.click(container.querySelector('.sh-sheet button[aria-label="Back"]')!); });
    expect(container.querySelector('.sh-sheet')!.getAttribute('aria-label')).toBe('Demo Level A');
    act(() => { fireEvent.click(container.querySelector('.sh-sheet button[aria-label="Close"]')!); });
    expect(container.querySelector('.sh-sheet')).toBeNull();
    expect(current(container).dataset.page).toBe('page-home');
  });
});

describe('a level in Edit (sl-surface)', () => {
  /** A shell that holds the surface the preview reports, as the workspace does. */
  function Held({ surface: first, window: win = iphone }: { surface: PreviewSurface; window?: PreviewWindow }) {
    const [surface, setSurface] = useState<PreviewSurface>(first);
    const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
    const document = demoDocument();
    return <>
      <output data-testid="surface">{JSON.stringify(surface)}</output>
      <Preview2 document={document} mode="edit" surface={surface} onSurfaceChange={setSurface} onSelect={() => undefined} window={win} bezel={false}
        house={demoHouse(document)} overlay={overlay} onOverlayChange={setOverlay}/>
    </>;
  }
  const reported = (container: HTMLElement) => JSON.parse(container.querySelector('[data-testid="surface"]')!.textContent!);

  it('draws the level in its sheet, with the Add slot of the level, and Back titled for where it goes', () => {
    const { container } = render(<Held surface={{ kind: 'level', id: 'demo_level_b' }}/>);
    const sheet = container.querySelector('.sh-sheet')!;
    expect(sheet.getAttribute('aria-label')).toBe('Demo Level B');
    expect(sheet.querySelector('.sh-add-slot[data-add-for="level:demo_level_b"]')).not.toBeNull();
    expect(sheet.querySelector('button[aria-label="Back"]')!.getAttribute('title')).toBe('Back to Demo Level A');
  });

  it('a click on the level\'s bar or empty area selects the level (its Level Settings), not the sheet it is shown in; a sheet\'s own bar still selects the sheet', () => {
    const { container, unmount } = render(<Held surface={{ kind: 'level', id: 'demo_level_b' }}/>);
    expect(container.querySelector('.sh-sheet')!.getAttribute('data-sel')).toBe('level:demo_level_b');
    unmount();
    const root = render(<Held surface={{ kind: 'modal', id: 'demo_sheet' }}/>);
    expect(root.container.querySelector('.sh-sheet')!.getAttribute('data-sel')).toBe('modal:demo_sheet');
  });

  it('Back steps out of a level in Edit, to the level beneath and then to the sheet, and the shell is told; Close does nothing', () => {
    const { container } = render(<Held surface={{ kind: 'level', id: 'demo_level_b' }}/>);
    act(() => { fireEvent.click(container.querySelector('.sh-sheet button[aria-label="Close"]')!); });
    expect(container.querySelector('.sh-sheet')!.getAttribute('aria-label')).toBe('Demo Level B');
    act(() => { fireEvent.click(container.querySelector('.sh-sheet button[aria-label="Back"]')!); });
    expect(container.querySelector('.sh-sheet')!.getAttribute('aria-label')).toBe('Demo Level A');
    expect(reported(container)).toEqual({ kind: 'level', id: 'demo_level_a', sheetId: 'demo_sheet' });
    act(() => { fireEvent.click(container.querySelector('.sh-sheet button[aria-label="Back"]')!); });
    expect(container.querySelector('.sh-sheet')!.getAttribute('aria-label')).toBe('Demo Sheet');
    expect(reported(container)).toEqual({ kind: 'modal', id: 'demo_sheet' });
    expect(container.querySelector('.sh-sheet button[aria-label="Back"]')).toBeNull();
  });

  it('puts Back in the rail on the folded Duo, live in Edit too', () => {
    const { container } = render(<Held surface={{ kind: 'level', id: 'demo_level_a' }} window={duoWindow({ turn: 0, fold: 'closed' })}/>);
    const back = container.querySelector('.sh-sheet-rail button[data-leading="back"]')!;
    expect(back.getAttribute('title')).toBe('Back to Demo Sheet');
    act(() => { fireEvent.click(back); });
    expect(container.querySelector('.sh-sheet')!.getAttribute('aria-label')).toBe('Demo Sheet');
  });

  it('draws a level no sheet opens alone: over the empty page, with Close and no Back', () => {
    const { container } = render(<Held surface={{ kind: 'level', id: 'demo_level_alone' }}/>);
    const sheet = container.querySelector('.sh-sheet')!;
    expect(sheet.getAttribute('aria-label')).toBe('Demo Level Alone');
    expect(sheet.getAttribute('data-sel')).toBe('level:demo_level_alone');
    expect(sheet.querySelector('button[aria-label="Back"]')).toBeNull();
    expect(sheet.querySelector('button[aria-label="Close"]')).not.toBeNull();
    expect(sheet.querySelector('.sh-add-slot[data-add-for="level:demo_level_alone"]')).not.toBeNull();
    expect(container.querySelector('.sh-page')).toBeNull();
  });
});

describe('the tab navigator follows the page on top', () => {
  const hidden = (document: CompositionDocument) => {
    const { container } = render(<Shell document={document}/>);
    tapIn(container, 'demo_plain');
    settle(container);
    return container;
  };

  it('is not drawn while a page that hides it is on top, and is drawn again after Back', () => {
    const container = hidden(demoDocument({ demo_plain: { hides: { tabs: true } } }));
    expect(container.querySelector('.sh-tabbar')).toBeNull();
    expect(container.querySelector('.sh-screen')!.hasAttribute('data-tabs-hidden')).toBe(true);
    act(() => { fireEvent.click(current(container).querySelector('button[aria-label="Back"]')!); });
    settle(container);
    expect(container.querySelector('.sh-tabbar')).not.toBeNull();
  });

  it('leaves and returns with the push and the pop, the bar still drawn while it moves', () => {
    const { container } = render(<Shell document={demoDocument({ demo_plain: { hides: { tabs: true } } })}/>);
    tapIn(container, 'demo_plain');
    expect(container.querySelector('.sh-tabbar')!.getAttribute('data-phase')).toBe('hiding');
    settle(container);
    expect(container.querySelector('.sh-tabbar')).toBeNull();
    act(() => { fireEvent.click(current(container).querySelector('button[aria-label="Back"]')!); });
    expect(container.querySelector('.sh-tabbar')!.getAttribute('data-phase')).toBe('showing');
  });

  it('is not drawn at any depth: a page two deep that hides it, though the page between did not', () => {
    const { container } = render(<Shell document={demoDocument({ demo_vacation: {}, demo_full: { hides: { tabs: true } } })}/>);
    tapIn(container, 'demo_settings'); settle(container);
    expect(container.querySelector('.sh-tabbar')).not.toBeNull();
    tapIn(current(container), 'demo_vacation'); settle(container);
    expect(container.querySelector('.sh-tabbar')).not.toBeNull();
    tapIn(current(container), 'demo_full'); settle(container);
    expect(container.querySelector('.sh-tabbar')).toBeNull();
  });

  it('shows on a root page only, with tabsVisibility root-only', () => {
    const document = demoDocument({}, { tabsVisibility: 'root-only' });
    const { container } = render(<Shell document={document}/>);
    expect(container.querySelector('.sh-tabbar')).not.toBeNull();
    tapIn(container, 'demo_plain'); settle(container);
    expect(container.querySelector('.sh-tabbar')).toBeNull();
  });

  it('is hidden on every family: the iPad top bar and the Duo rail leave too', () => {
    for (const win of [ipadUpright, ipadSideways, duoSideways]) {
      const { container } = render(<Shell document={demoDocument({ demo_plain: { hides: { tabs: true } } }, {})} window={win}/>);
      expect(container.querySelector('.sh-tabbar'), win.name).not.toBeNull();
      tapIn(container, 'demo_plain'); settle(container);
      expect(container.querySelector('.sh-tabbar'), win.name).toBeNull();
      cleanup();
    }
  });

  it('is decided by the page opened last in columns', () => {
    // Settings | Vacation: Vacation was opened last and hides the tabs; Settings alone does not.
    const document = demoDocument({ demo_vacation: { hides: { tabs: true } } });
    const { container } = render(<Shell document={document} window={ipadSideways}/>);
    tapIn(container, 'demo_settings');
    expect(container.querySelector('.sh-tabbar')).not.toBeNull();
    tapIn(container.querySelector('.sh-pane[data-pane=leading]')!, 'demo_vacation');
    expect(container.querySelector('.sh-pane[data-pane=detail] .sh-page')!.getAttribute('data-page')).toBe('demo_vacation');
    settle(container);
    expect(container.querySelector('.sh-tabbar')).toBeNull();
  });

  it('takes the root-only depth from the page opened last, not from the host page', () => {
    // Security is a tab root and opens Vacation beside itself: the one bar reads the depth of Vacation (1), so the first-page-only button goes.
    // Native keeps the host's depth (0) there; the difference is an open question for gc-runtime-chrome-hide, and this pins the preview's rule.
    const { container } = render(<Shell document={demoDocument()} window={ipadSideways}/>);
    act(() => { fireEvent.click(container.querySelectorAll('.sh-tabbar .sh-tab')[1]); });
    settle(container);
    expect(labels(container)).toContain('demo_btn_first');
    tapIn(container.querySelector('.sh-pane[data-pane=leading]')!, 'demo_vacation');
    settle(container);
    expect(labels(container)).not.toContain('demo_btn_first');
    expect(labels(container)).toContain('demo_btn_always');
  });

  it('moves out with the push, and does not slide under Reduce Motion', () => {
    const slide = renderHook(() => useBarPresence(false, true));
    expect(slide.result.current).toEqual({ mounted: true, phase: 'rest' });
    slide.rerender();
    const moving = renderHook(({ hidden }) => useBarPresence(hidden, true), { initialProps: { hidden: false } });
    moving.rerender({ hidden: true });
    expect(moving.result.current).toEqual({ mounted: true, phase: 'hiding' });
    moving.rerender({ hidden: false });
    expect(moving.result.current).toEqual({ mounted: true, phase: 'showing' });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const still = renderHook(({ hidden }) => useBarPresence(hidden, true), { initialProps: { hidden: false } });
    still.rerender({ hidden: true });
    expect(still.result.current).toEqual({ mounted: false, phase: 'rest' });
    still.rerender({ hidden: false });
    expect(still.result.current).toEqual({ mounted: true, phase: 'rest' });
  });
});

describe('items a page hides', () => {
  it('are not drawn: the app\'s first-page-only item on a pushed page, a hidden button, and Quick Links and Profile when the page names them', () => {
    const document = demoDocument({ demo_plain: { hides: { items: ['demo_btn_hidden'] } }, demo_beside: { hides: { items: ['demo_header'] } } });
    const { container } = render(<Shell document={document}/>);
    expect(labels(current(container))).toEqual(['Sections', 'demo_btn_always', 'demo_btn_first', 'demo_btn_hidden', 'Quick Links', 'Profile']);
    tapIn(container, 'demo_plain'); settle(container);
    expect(labels(current(container))).toEqual(['Back', 'demo_btn_always', 'Quick Links', 'Profile']);
    act(() => { fireEvent.click(current(container).querySelector('button[aria-label="Back"]')!); }); settle(container);
    tapIn(container, 'demo_beside'); settle(container);
    // Back is not chrome: it stays whatever the page hides.
    expect(labels(current(container))).toEqual(['Back', 'demo_btn_always', 'demo_btn_hidden']);
  });
});

describe('Back and Close', () => {
  it('Back is the chevron alone: a button named Back with no title beside it', () => {
    const { container } = render(<Shell document={demoDocument()}/>);
    tapIn(container, 'demo_plain'); settle(container);
    const back = current(container).querySelector<HTMLElement>('button[aria-label="Back"]')!;
    expect(back.textContent).toBe('');
    expect(back.querySelector('svg')).not.toBeNull();
  });
});

describe('the iPad frame', () => {
  it('draws the tabs in the header row with no menu button, upright and sideways', () => {
    for (const win of [ipadUpright, ipadSideways]) {
      const { container } = render(<Shell document={demoDocument()} window={win}/>);
      expect(container.querySelector('.sh-screen')!.hasAttribute('data-tabs-top'), win.name).toBe(true);
      expect(container.querySelectorAll('.sh-tabbar .sh-tab'), win.name).toHaveLength(3);
      expect(container.querySelector('button[aria-label="Sections"], button[aria-label="Menu"]'), win.name).toBeNull();
      cleanup();
    }
  });
});

describe('wide windows in the preview', () => {
  const paneOf = (root: HTMLElement, pane: 'leading' | 'detail') => root.querySelector(`.sh-pane[data-pane=${pane}] .sh-page`)?.getAttribute('data-page');

  it('Automatic from Home is full width: Home does not open pages beside it', () => {
    const { container } = render(<Shell document={demoDocument()} window={ipadSideways}/>);
    tapIn(container, 'demo_plain'); settle(container);
    expect(container.querySelector('.sh-columns')).toBeNull();
    expect(current(container).dataset.page).toBe('demo_plain');
  });

  it('Automatic from a columns page opens beside it, then cascades: Vacation moves leading and Trip opens trailing, Back reverses', () => {
    const { container } = render(<Shell document={demoDocument()} window={ipadSideways}/>);
    tapIn(container, 'demo_settings'); settle(container);
    // Nothing opened yet: the empty-side text, not a first child. The columns page was pushed, so its own Back leads.
    expect([paneOf(container, 'leading'), paneOf(container, 'detail')]).toEqual(['demo_settings', undefined]);
    expect(container.querySelector('.sh-empty-pane')?.textContent).toBe('Pick from Demo Settings');
    tapIn(container.querySelector('.sh-pane[data-pane=leading]')!, 'demo_vacation');
    expect([paneOf(container, 'leading'), paneOf(container, 'detail')]).toEqual(['demo_settings', 'demo_vacation']);
    tapIn(container.querySelector('.sh-pane[data-pane=detail]')!, 'demo_trip');
    expect([paneOf(container, 'leading'), paneOf(container, 'detail')]).toEqual(['demo_vacation', 'demo_trip']);
    // Close for the first page beside the host, Back from depth 2: the leading pane's button is Back now.
    const leading = container.querySelector<HTMLElement>('.sh-pane[data-pane=leading]')!;
    expect(leading.querySelector('button[data-leading="back"]')).not.toBeNull();
    act(() => { fireEvent.click(leading.querySelector('button[data-leading="back"]')!); });
    expect([paneOf(container, 'leading'), paneOf(container, 'detail')]).toEqual(['demo_settings', 'demo_vacation']);
  });

  it('Close leads the first column set and Close returns to full width; the bar is one across both panes', () => {
    const { container } = render(<Shell document={demoDocument()} window={ipadSideways}/>);
    tapIn(container, 'demo_settings'); settle(container);
    tapIn(container.querySelector('.sh-pane[data-pane=leading]')!, 'demo_vacation');
    const leading = container.querySelector<HTMLElement>('.sh-pane[data-pane=leading]')!, detail = container.querySelector<HTMLElement>('.sh-pane[data-pane=detail]')!;
    // The set started on Settings (depth 1 on its stack): a first page of the set is Close; the leading half holds Back or Close, the trailing half holds the items.
    expect(labels(leading).filter(name => name === 'Back' || name === 'Close')).toHaveLength(1);
    expect(labels(detail)).toEqual(['Quick Links', 'Profile']);
    expect(labels(leading)).toEqual([...labels(leading).filter(name => name === 'Back' || name === 'Close'), 'demo_btn_always', 'demo_btn_hidden']);
  });

  it('Full width opens over the columns, and Back returns to them as they were', () => {
    const { container } = render(<Shell document={demoDocument()} window={ipadSideways}/>);
    tapIn(container, 'demo_settings'); settle(container);
    tapIn(container.querySelector('.sh-pane[data-pane=leading]')!, 'demo_vacation');
    tapIn(container.querySelector('.sh-pane[data-pane=detail]')!, 'demo_full'); settle(container);
    expect(container.querySelector('.sh-columns')).toBeNull();
    expect(current(container).dataset.page).toBe('demo_full');
    act(() => { fireEvent.click(current(container).querySelector('button[aria-label="Back"]')!); });
    expect([paneOf(container, 'leading'), paneOf(container, 'detail')]).toEqual(['demo_settings', 'demo_vacation']);
  });

  it('Beside from a page with no columns: Home takes the leading half and Close returns it to full width', () => {
    const { container } = render(<Shell document={demoDocument()} window={ipadSideways}/>);
    tapIn(container, 'demo_beside'); settle(container);
    expect([paneOf(container, 'leading'), paneOf(container, 'detail')]).toEqual(['page-home', 'demo_beside']);
    const close = container.querySelector<HTMLElement>('.sh-pane[data-pane=leading] button[data-leading="close"]')!;
    expect(close.getAttribute('aria-label')).toBe('Close');
    act(() => { fireEvent.click(close); });
    expect(container.querySelector('.sh-columns')).toBeNull();
    expect(current(container).dataset.page).toBe('page-home');
  });

  it('is one page in a narrow window, in the same order: the same route', () => {
    const { container } = render(<Shell document={demoDocument()} window={iphone}/>);
    tapIn(container, 'demo_settings'); settle(container);
    expect(container.querySelector('.sh-columns')).toBeNull();
    tapIn(current(container), 'demo_vacation'); settle(container);
    expect(current(container).dataset.page).toBe('demo_vacation');
    act(() => { fireEvent.click(current(container).querySelector('button[aria-label="Back"]')!); }); settle(container);
    expect(current(container).dataset.page).toBe('demo_settings');
  });

  it('a tab\'s first page that opens pages beside it: nothing leads, then Close, then Back (the owner\'s case)', () => {
    const { container } = render(<Shell document={demoDocument()} window={ipadSideways}/>);
    act(() => { fireEvent.click(container.querySelectorAll('.sh-tabbar .sh-tab')[1]); });
    settle(container);
    const lead = () => container.querySelector<HTMLElement>('.sh-pane[data-pane=leading]')!;
    expect(container.querySelector('.sh-empty-pane')?.textContent).toBe('Pick from Security');
    expect(lead().querySelector('button[data-leading]')).toBeNull();
    tapIn(lead(), 'demo_vacation');
    expect(lead().querySelector('button[data-leading="close"]')).not.toBeNull();
    tapIn(container.querySelector('.sh-pane[data-pane=detail]')!, 'demo_trip');
    expect(lead().querySelector('button[data-leading="back"]')).not.toBeNull();
    expect([paneOf(container, 'leading'), paneOf(container, 'detail')]).toEqual(['demo_vacation', 'demo_trip']);
  });

  it('keeps the row that opened the trailing pane selected, in the cascade and in Beside from Home', () => {
    const { container } = render(<Shell document={demoDocument()} window={ipadSideways}/>);
    tapIn(container, 'demo_beside'); settle(container);
    const opened = () => [...container.querySelectorAll('.sh-pane[data-pane=leading] [data-opened]')].map(node => node.getAttribute('data-sel'));
    expect(opened()).toEqual(['node:home_to_demo_beside']);
    cleanup();
    const second = render(<Shell document={demoDocument()} window={ipadSideways}/>);
    tapIn(second.container, 'demo_settings'); settle(second.container);
    expect(second.container.querySelector('[data-opened]')).toBeNull();
    tapIn(second.container.querySelector('.sh-pane[data-pane=leading]')!, 'demo_vacation');
    expect([...second.container.querySelectorAll('.sh-pane[data-pane=leading] [data-opened]')].map(node => node.getAttribute('data-sel'))).toEqual(['node:demo_settings_to_demo_vacation']);
    tapIn(second.container.querySelector('.sh-pane[data-pane=detail]')!, 'demo_trip');
    expect([...second.container.querySelectorAll('.sh-pane[data-pane=leading] [data-opened]')].map(node => node.getAttribute('data-sel'))).toEqual(['node:demo_vacation_to_demo_trip']);
  });
});

describe('Back and Close on the rail frames', () => {
  const duoFolded = duoWindow({ turn: 0, fold: 'closed' });

  it('are the first item of the rail, above Quick Links and Profile, and not in the header row', () => {
    const { container } = render(<Shell document={demoDocument()} window={duoFolded}/>);
    expect(container.querySelector('.sh-rail-bar button[data-leading]')).toBeNull();
    tapIn(container, 'demo_plain'); settle(container);
    const first = container.querySelector('.sh-rail-bar .sh-rail-header button')!;
    expect(first.getAttribute('data-leading')).toBe('back');
    expect(current(container).querySelector('.sh-header button[aria-label="Back"]')).toBeNull();
    const names = [...container.querySelectorAll('.sh-rail-bar .sh-rail-header button')].map(button => button.getAttribute('aria-label'));
    expect(names.indexOf('Back')).toBeLessThan(names.indexOf('Quick Links'));
    act(() => { fireEvent.click(first); }); settle(container);
    expect(current(container).dataset.page).toBe('page-home');
  });

  it('Close leads the rail beside a host, and the sheet\'s Close sits in the rail below the camera with the bar holding the title alone', () => {
    const wideRail = render(<Shell document={demoDocument()} window={duoSideways}/>);
    tapIn(wideRail.container, 'demo_beside'); settle(wideRail.container);
    expect(wideRail.container.querySelector('.sh-rail-bar .sh-rail-header button')!.getAttribute('data-leading')).toBe('close');
    cleanup();
    const { container } = render(<Shell document={demoDocument()} window={duoFolded}/>);
    tapIn(container, 'sheet');
    const rail = container.querySelector<HTMLElement>('.sh-sheet-rail')!;
    expect(rail.querySelector('button[aria-label="Close"]')).not.toBeNull();
    expect(rail.querySelector('button[aria-label="Back"]')).toBeNull();
    expect(container.querySelector('.sh-sheet-bar button')).toBeNull();
    expect(parseFloat(rail.style.top)).toBeGreaterThan(170);
    tapIn(container.querySelector('.sh-sheet')!, 'demo_level_a');
    expect(container.querySelector('.sh-sheet-rail button[aria-label="Back"]')).not.toBeNull();
    expect(container.querySelector('.sh-sheet-rail button[aria-label="Close"]')).not.toBeNull();
  });
});
