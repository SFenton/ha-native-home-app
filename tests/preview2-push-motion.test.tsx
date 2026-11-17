// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { emptyOverlay, type Overlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type PreviewSurface } from '../src/preview2/Preview2';
import { documentWithPush, PUSH_TARGET } from './support/push-document';

const document = documentWithPush() as unknown as CompositionDocument;
afterEach(cleanup);
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** The shell's job: it holds the surface and the overlay and passes them down. */
function Shell({ mode = 'use' }: { mode?: 'edit' | 'use' }) {
  const [surface, setSurface] = useState<PreviewSurface>({ kind: 'page', id: 'page-home' });
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
  return <Preview2 document={document} mode={mode} surface={surface} onSurfaceChange={setSurface} onSelect={() => undefined} window={previewWindows[0]} bezel={false}
    house={demoHouse(document)} overlay={overlay} onOverlayChange={setOverlay}/>;
}
const pages = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.sh-page')];
const tile = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-sel="node:demo-push-tile"] button')!;
const tap = (root: HTMLElement) => act(() => { fireEvent.click(tile(root)); });
const back = (root: HTMLElement) => act(() => { fireEvent.click(root.querySelector('button[aria-label="Back"]')!); });

describe('a push and a pop in the preview', () => {
  it('slides the new page in at once and removes the old one when its animation ends', () => {
    const { container } = render(<Shell/>);
    expect(pages(container)).toHaveLength(1);
    tap(container);
    const [out, incoming] = pages(container);
    expect(pages(container)).toHaveLength(2);
    expect(out.dataset.page).toBe('page-home');
    expect(out.className).toContain('sh-out-push');
    expect(incoming.dataset.page).toBe(PUSH_TARGET.pageId);
    expect(incoming.className).toContain('sh-in-push');
    expect(out.hasAttribute('inert')).toBe(true);
    expect(incoming.hasAttribute('data-current')).toBe(true);
    act(() => { fireEvent.animationEnd(incoming); });
    expect(pages(container)).toHaveLength(1);
    expect(pages(container)[0].dataset.page).toBe(PUSH_TARGET.pageId);
    expect(pages(container)[0].className).not.toContain('sh-in-');
  });

  it('keeps the root page\'s own header while it slides away: no Back button appears on it', () => {
    const { container } = render(<Shell/>);
    tap(container);
    expect(pages(container)[0].querySelector('button[aria-label="Back"]')).toBeNull();
    expect(pages(container)[1].querySelectorAll('button[aria-label="Back"]')).toHaveLength(1);
  });

  it('keeps the old page mounted through the move, so it is not drawn twice', () => {
    const { container } = render(<Shell/>);
    const before = pages(container)[0];
    tap(container);
    expect(pages(container)[0]).toBe(before);
  });

  it('removes the old page by itself when the browser runs no animation', () => {
    const { container } = render(<Shell/>);
    tap(container);
    expect(pages(container)).toHaveLength(2);
    act(() => { vi.advanceTimersByTime(450); });
    expect(pages(container)).toHaveLength(1);
  });

  it('pops with the mirrored motion and ends on one page', () => {
    const { container } = render(<Shell/>);
    tap(container);
    act(() => { vi.advanceTimersByTime(450); });
    back(container);
    const [out, incoming] = pages(container);
    expect(out.className).toContain('sh-out-pop');
    expect(incoming.className).toContain('sh-in-pop');
    expect(incoming.dataset.page).toBe('page-home');
    act(() => { fireEvent.animationEnd(incoming); });
    expect(pages(container).map(page => page.dataset.page)).toEqual(['page-home']);
  });

  it('a Back straight after the push never leaves three pages', () => {
    const { container } = render(<Shell/>);
    tap(container);
    back(container);
    expect(pages(container).length).toBeLessThanOrEqual(2);
    act(() => { vi.advanceTimersByTime(450); });
    expect(pages(container).map(page => page.dataset.page)).toEqual(['page-home']);
  });

  it('cuts a tab switch with no second page and no motion', () => {
    const { container } = render(<Shell/>);
    act(() => { fireEvent.click(container.querySelector('[data-sel="tab:hc-tab-security"]')!); });
    expect(pages(container)).toHaveLength(1);
    expect(pages(container)[0].dataset.page).toBe('page-security');
    expect(pages(container)[0].className).not.toContain('sh-in-');
  });

  it('draws one page in Edit, where a change cuts', () => {
    const { container } = render(<Shell mode="edit"/>);
    expect(pages(container)).toHaveLength(1);
  });
});
