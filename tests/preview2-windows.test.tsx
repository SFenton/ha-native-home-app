// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import { withPose } from '../src/preview2';
import { addPage } from '../src/workspace2/navigation/edit';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
const base = homeDomains.document as unknown as CompositionDocument;
const [iphone, , duoUpright, duoSideways, , ipadSideways] = previewWindows;

/** A document whose first tab page opens pages beside it, and a second columns page that links to nothing. */
function columns(): { document: CompositionDocument; lonely: string } {
  const detail = addPage(base, 'Detail', { kind: 'page', id: 'page-home' });
  const made = addPage(detail.document, 'Lonely');
  const document = {
    ...made.document,
    pages: made.document.pages.map(page => page.id === 'page-home' || page.id === made.id
      ? { ...page, navigation: { type: 'navigation-columns', placeholder: page.id === made.id ? 'Pick something' : 'Select a room', standalone: false } } : page),
  } as CompositionDocument;
  return { document, lonely: made.id };
}
const mount = (document: CompositionDocument, over: Partial<Preview2Props> = {}) => render(<Preview2 document={document} mode="edit" surface={{ kind: 'page', id: 'page-home' }}
  onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={iphone} bezel={false} house={demoHouse(document)} overlay={emptyOverlay} onOverlayChange={vi.fn()} {...over}/>);

describe('Preview2 windows', () => {
  it('draws a columns page as two panes at iPad landscape, one at iPhone', () => {
    const { document } = columns();
    const wide = mount(document, { window: ipadSideways });
    expect(wide.container.querySelectorAll('.sh-pane')).toHaveLength(2);
    expect(wide.container.querySelector('.sh-pane[data-pane=detail]')).not.toBeNull();
    cleanup();
    const narrow = mount(document, { window: iphone });
    expect(narrow.container.querySelectorAll('.sh-pane')).toHaveLength(0);
    expect(narrow.container.querySelector('.sh-page[data-page=page-home]')).not.toBeNull();
  });

  it('draws the host page and its first child, or the empty-side text when it links to none', () => {
    const { document, lonely } = columns();
    const host = mount(document, { window: ipadSideways });
    expect(host.container.querySelectorAll('.sh-pane .sh-page')).toHaveLength(2);
    cleanup();
    const plainHome = { ...document, pages: document.pages.map(page => page.id === 'page-home' ? { ...page, navigation: { type: 'stack' } } : page) } as CompositionDocument;
    const empty = mount(plainHome, { window: ipadSideways, surface: { kind: 'page', id: lonely } });
    expect(empty.container.querySelector('.sh-empty-pane')?.textContent).toBe('Pick something');
  });

  it('gives each pane its width from the split: the midpoint at iPad, the hinge in the book pose', () => {
    const { document } = columns();
    const flat = mount(document, { window: ipadSideways });
    expect([...flat.container.querySelectorAll<HTMLElement>('.sh-pane')].map(pane => pane.style.width)).toEqual(['596px', '597px']);
    cleanup();
    const book = mount(document, { window: withPose(duoSideways, 'book') });
    expect([...book.container.querySelectorAll<HTMLElement>('.sh-pane')].map(pane => pane.style.width)).toEqual(['455.3px', '372.3px']);
    expect(book.container.querySelector('.sh-fold[data-axis=vertical]')).not.toBeNull();
  });

  it('keeps one pane when the host starts with one pane, and in a window that cannot split', () => {
    const { document } = columns();
    const onDemand = { ...document, pages: document.pages.map(page => page.id === 'page-home' ? { ...page, navigation: { ...page.navigation, onDemand: true } } : page) } as CompositionDocument;
    expect(mount(onDemand, { window: ipadSideways }).container.querySelectorAll('.sh-pane')).toHaveLength(0);
    cleanup();
    expect(mount(document, { window: duoUpright }).container.querySelectorAll('.sh-pane')).toHaveLength(0);
  });

  it('draws the flyout instead of the tab bar at regular width, opened by the header menu button', () => {
    const { container } = mount(base, { window: ipadSideways });
    expect(container.querySelector('.sh-tabbar')).toBeNull();
    const layer = container.querySelector('.sh-flyout-layer')!;
    expect(layer.hasAttribute('data-open')).toBe(false);
    fireEvent.click(container.querySelector('button[aria-label=Menu]')!);
    expect(layer.hasAttribute('data-open')).toBe(true);
    expect(layer.querySelectorAll('.sh-tab')).toHaveLength(base.navigation.tabs.length);
    cleanup();
    const phone = mount(base, { window: iphone });
    expect(phone.container.querySelector('.sh-tabbar')).not.toBeNull();
    expect(phone.container.querySelector('.sh-flyout-layer')).toBeNull();
  });

  it('keeps the tab bar and draws the hinge band on a Duo opened upright', () => {
    const { container } = mount(base, { window: duoUpright });
    expect(container.querySelector('.sh-tabbar')).not.toBeNull();
    expect(container.querySelector('.sh-fold[data-axis=horizontal]')).not.toBeNull();
  });
});
