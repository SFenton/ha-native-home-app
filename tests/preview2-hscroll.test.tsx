// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HorizontalScroller } from '../src/preview2/nodes/HorizontalScroller';
import { RenderCtx, type RenderContext } from '../src/preview2/render-context';

afterEach(cleanup);

/** The scroll bars of every row that scrolls sideways (`src/preview2/nodes/HorizontalScroller.tsx`): in Edit only, draggable, never selecting. */
function mount(mode: 'edit' | 'use', kind: 'rail' | 'paged' = 'rail') {
  const view = render(<RenderCtx.Provider value={{ mode } as RenderContext}><HorizontalScroller kind={kind} className={kind === 'rail' ? 'sh-rail' : 'sh-paged-track'} role="list" label="Overview"><i/><i/><i/></HorizontalScroller></RenderCtx.Provider>);
  const row = view.container.querySelector<HTMLElement>('.sh-rail, .sh-paged-track')!;
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: 300 });
  Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 900 });
  const bar = view.container.querySelector<HTMLElement>('.sh-hbar');
  if (bar) Object.defineProperty(bar, 'clientWidth', { configurable: true, value: 300 });
  return { ...view, row, bar };
}
/** Lets the row report a size, the way the browser's resize observer does after layout. */
const settle = (row: HTMLElement) => act(() => { fireEvent.scroll(row); });

describe('the horizontal scroll bar', () => {
  it('draws nothing in Use, so the row keeps the app look', () => {
    for (const kind of ['rail', 'paged'] as const) {
      const { container, unmount } = mount('use', kind);
      expect(container.querySelector('.sh-hbar'), kind).toBeNull();
      expect(container.querySelector('[role=scrollbar]')).toBeNull();
      unmount();
    }
  });

  it('draws a thumb in Edit for a rail and for a paged row, sized by the share of the row that shows', () => {
    for (const kind of ['rail', 'paged'] as const) {
      const { row, bar, unmount } = mount('edit', kind);
      settle(row);
      const thumb = screen.getByRole('scrollbar');
      expect(bar!.getAttribute('data-idle'), kind).toBeNull();
      expect(parseFloat(thumb.style.width), 'a third of the track').toBeCloseTo(100, 0);
      expect(thumb.getAttribute('aria-valuemax')).toBe('600');
      expect(thumb.getAttribute('aria-label')).toBe('Scroll Overview');
      expect(row.closest('.sh-hscroll')!.getAttribute('data-kind')).toBe(kind);
      unmount();
    }
  });

  it('follows the row as it scrolls and hides when nothing overflows', () => {
    const { row, bar } = mount('edit');
    row.scrollLeft = 300;
    settle(row);
    expect(parseFloat(screen.getByRole('scrollbar').style.left)).toBeCloseTo(100, 0);
    expect(screen.getByRole('scrollbar').getAttribute('aria-valuenow')).toBe('300');
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 300 });
    settle(row);
    expect(screen.queryByRole('scrollbar')).toBeNull();
    expect(bar!.getAttribute('data-idle')).toBe('');
  });

  it('moves the row when the thumb is dragged, by the share of the track it travels', () => {
    const { row } = mount('edit');
    settle(row);
    const thumb = screen.getByRole('scrollbar');
    thumb.setPointerCapture = () => undefined;
    const press = (target: Element, type: string, x: number) => { const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 }); Object.assign(event, { pointerId: 1 }); target.dispatchEvent(event); return event; };
    expect(press(thumb, 'pointerdown', 50).defaultPrevented).toBe(true);
    press(thumb, 'pointermove', 80);
    // 30 px of a 200 px travel (track 300 minus thumb 100) over 600 px of scroll.
    expect(row.scrollLeft).toBeCloseTo(90, 0);
    press(thumb, 'pointerup', 80);
    press(thumb, 'pointermove', 200);
    expect(row.scrollLeft, 'a released thumb no longer drags').toBeCloseTo(90, 0);
  });

  it('keeps a press on the bar from reaching the stage, so the node drag and the selection never start', () => {
    const { container, row } = mount('edit');
    settle(row);
    let reached = false;
    container.parentElement!.addEventListener('pointerdown', () => { reached = true; });
    const thumb = screen.getByRole('scrollbar');
    thumb.setPointerCapture = () => undefined;
    thumb.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    expect(reached).toBe(false);
    expect(container.querySelector('.sh-hbar')!.hasAttribute('data-passthrough')).toBe(true);
  });

  it('pages the row toward a press on the bare track and scrolls with the arrow keys', () => {
    const { row, bar } = mount('edit');
    settle(row);
    Object.assign(bar!, { getBoundingClientRect: () => ({ left: 0, width: 300, right: 300, top: 0, bottom: 8, height: 8, x: 0, y: 0, toJSON: () => ({}) }) });
    Object.defineProperty(bar!, 'offsetWidth', { configurable: true, value: 300 });
    const press = (x: number) => { const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, button: 0 }); bar!.dispatchEvent(event); };
    press(280);
    expect(row.scrollLeft).toBeCloseTo(270, 0);
    settle(row); // the browser reports the scroll, which moves the thumb
    press(5);
    expect(row.scrollLeft).toBeCloseTo(0, 0);
    settle(row);
    fireEvent.keyDown(screen.getByRole('scrollbar'), { key: 'ArrowRight' });
    expect(row.scrollLeft).toBe(40);
    fireEvent.keyDown(screen.getByRole('scrollbar'), { key: 'ArrowLeft' });
    expect(row.scrollLeft).toBe(0);
  });
});
