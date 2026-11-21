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

  it('draws the host page and its empty-side text while nothing is opened, even when it links to a page', () => {
    const { document, lonely } = columns();
    const host = mount(document, { window: ipadSideways });
    expect(host.container.querySelectorAll('.sh-pane .sh-page')).toHaveLength(1);
    expect(host.container.querySelector('.sh-empty-pane')?.textContent).toBe('Select a room');
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
    expect(book.container.querySelector('.sh-crease[data-on][data-axis=vertical]')).not.toBeNull();
  });

  it('keeps one pane when the host starts with one pane, and in a window that cannot split', () => {
    const { document } = columns();
    const onDemand = { ...document, pages: document.pages.map(page => page.id === 'page-home' ? { ...page, navigation: { ...page.navigation, onDemand: true } } : page) } as CompositionDocument;
    expect(mount(onDemand, { window: ipadSideways }).container.querySelectorAll('.sh-pane')).toHaveLength(0);
    cleanup();
    expect(mount(document, { window: duoUpright }).container.querySelectorAll('.sh-pane')).toHaveLength(0);
  });

  it('draws the tabs at the top at regular width, in the header row, with no menu button and no flyout', () => {
    const { container } = mount(base, { window: ipadSideways });
    const screen = container.querySelector('.sh-screen')!;
    expect(screen.hasAttribute('data-tabs-top')).toBe(true);
    expect(container.querySelector('.sh-tabbar')).not.toBeNull();
    expect(container.querySelectorAll('.sh-tabbar .sh-tab')).toHaveLength(base.navigation.tabs.length);
    expect(container.querySelector('.sh-flyout-layer')).toBeNull();
    expect(container.querySelector('button[aria-label=Menu]')).toBeNull();
    expect(container.querySelector('button[aria-label=Sections]')).toBeNull();
    cleanup();
    const phone = mount(base, { window: iphone });
    expect(phone.container.querySelector('.sh-tabbar')).not.toBeNull();
    expect(phone.container.querySelector('.sh-screen')!.hasAttribute('data-tabs-top')).toBe(false);
  });

  it('opens the same flyout from the iPhone header menu button, in Use, and closes it on the scrim or a pick', () => {
    const { container } = mount(base, { window: iphone, mode: 'use' });
    // At rest the page carries one copy of the tabs: the tab bar's.
    expect(container.querySelector('.sh-flyout-layer')).toBeNull();
    expect(container.querySelectorAll('.sh-tab')).toHaveLength(base.navigation.tabs.length);
    const button = container.querySelector<HTMLElement>('button[aria-label=Sections]')!;
    fireEvent.click(button);
    const layer = container.querySelector('.sh-flyout-layer')!;
    expect(layer.hasAttribute('data-open')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(layer.querySelectorAll('.sh-tab')).toHaveLength(base.navigation.tabs.length);
    expect(container.querySelector('.sh-tabbar')).not.toBeNull();
    fireEvent.click(layer.querySelector('.sh-flyout-scrim')!);
    expect(container.querySelector('.sh-flyout-layer')!.hasAttribute('data-open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    fireEvent.click(container.querySelector('.sh-flyout-layer')!.querySelectorAll('.sh-tab')[1]);
    expect(container.querySelector('.sh-flyout-layer')!.hasAttribute('data-open')).toBe(false);
  });

  it('leaves the header menu button selectable, not acting, in Edit', () => {
    const { container } = mount(base, { window: iphone, mode: 'edit' });
    fireEvent.click(container.querySelector('button[aria-label=Sections]')!);
    expect(container.querySelector('.sh-flyout-layer')).toBeNull();
  });

  it('keeps the tab bar on a Duo opened upright, flat with no band, and draws the band across the page only when partly folded', () => {
    const { container } = mount(base, { window: duoUpright });
    expect(container.querySelector('.sh-tabbar')).not.toBeNull();
    expect(container.querySelector('.sh-crease[data-on]')).toBeNull();
    cleanup();
    const hinged = mount(base, { window: withPose(duoUpright, 'book') });
    expect(hinged.container.querySelector('.sh-tabbar')).not.toBeNull();
    expect(hinged.container.querySelector('.sh-crease[data-on][data-axis=horizontal]')).not.toBeNull();
    expect(hinged.container.querySelector('.sh-crease[data-on][data-axis=vertical]')).toBeNull();
  });

  it('puts the Duo rail on the trailing edge and the fold at window x 455.3, so the panes are 455.3, 40.4 and 372.3 of 868 pt', () => {
    const { document } = columns();
    const { container } = mount(document, { window: withPose(duoSideways, 'book') });
    const screen = container.querySelector<HTMLElement>('.sh-screen')!;
    expect(screen.hasAttribute('data-rail')).toBe(true);
    expect(screen.style.getPropertyValue('--sh-rail')).toBe('83px');
    expect(container.querySelector<HTMLElement>('.sh-crease[data-on][data-axis=vertical]')!.style.left).toBe('455.3px');
    expect([...container.querySelectorAll<HTMLElement>('.sh-pane, .sh-band')].map(item => item.style.width)).toEqual(['455.3px', '40.4px', '372.3px']);
    expect(455.3 + 40.4 + 372.3).toBeCloseTo(868, 5);
  });

  it('names the iPhone flyout "Navigation"', () => {
    const { container } = mount(base, { window: iphone, mode: 'use' });
    fireEvent.click(container.querySelector('button[aria-label=Sections]')!);
    expect(container.querySelector('.sh-flyout .sh-flyout-heading')?.textContent).toBe('Navigation');
  });

  describe('sheets', () => {
    const modalId = base.modals[0].id;
    const present = (win: typeof iphone, document = base) => mount(document, { window: win, surface: { kind: 'modal', id: modalId } });
    const withWidth = (width: 'form' | 'page') => ({ ...base, modals: base.modals.map(modal => modal.id === modalId ? { ...modal, presentation: { ...modal.presentation, width, fullScreen: false } } : modal) }) as CompositionDocument;

    it('is full width from the bottom on the iPhone, and scales the page behind back', () => {
      const { container } = present(iphone);
      expect(container.querySelector('.sh-sheet-layer')?.getAttribute('data-placement')).toBe('bottom');
      expect(container.querySelector('.sh-screen')?.hasAttribute('data-covered')).toBe(true);
    });

    it('is the leading half on the Duo landscape, with no scale-back', () => {
      const { container } = present(duoSideways);
      const layer = container.querySelector<HTMLElement>('.sh-sheet-layer')!;
      expect(layer.getAttribute('data-placement')).toBe('leading');
      expect(layer.style.getPropertyValue('--sheet-w')).toBe('425px');
      expect(layer.style.getPropertyValue('--sheet-h')).toBe('653px');
      expect(container.querySelector('.sh-screen')?.hasAttribute('data-covered')).toBe(false);
    });

    it('is a 580 pt form or a page sheet on iPad by presentation.width, with no scale-back', () => {
      const form = present(ipadSideways, withWidth('form'));
      expect(form.container.querySelector('.sh-sheet-layer')?.getAttribute('data-placement')).toBe('center');
      expect(form.container.querySelector<HTMLElement>('.sh-sheet-layer')!.style.getPropertyValue('--sheet-w')).toBe('580px');
      expect(form.container.querySelector('.sh-screen')?.hasAttribute('data-covered')).toBe(false);
      cleanup();
      const page = present(ipadSideways, withWidth('page'));
      expect(page.container.querySelector<HTMLElement>('.sh-sheet-layer')!.style.getPropertyValue('--sheet-w')).toBe('704px');
    });
  });

  describe('the iPad header (F18)', () => {
    /** The owner's shape: the menu leads and Quick Links and Profile trail, both from `navigation.chrome`, and pages inherit it. */
    const withChrome = (): CompositionDocument => {
      const present = { type: 'present', modalId: base.modals[0].id, arguments: {}, ifPresented: 'reject' };
      return { ...base, navigation: { ...base.navigation, chrome: { groups: [
        ...base.navigation.chrome.groups,
        { id: 'demo_utilities', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [{ id: 'demo_header', type: 'shell-header', visibility: 'always', quickLinksAction: present, profileAction: present }] },
      ] } } } as unknown as CompositionDocument;
    };
    const names = (container: HTMLElement) => [...container.querySelectorAll('.sh-page[data-current] .sh-header button')].map(button => button.getAttribute('aria-label'));

    it('draws no hamburger, Quick Links then Profile trailing and the large title below, on every tab root', () => {
      const document = withChrome();
      for (const win of [ipadSideways, previewWindows[4]]) {
        for (const tab of document.navigation.tabs) {
          const { container } = mount(document, { window: win, surface: { kind: 'page', id: tab.pageId } });
          expect(names(container), `${win.name} ${tab.label}`).toEqual(['Quick Links', 'Profile']);
          expect(container.querySelector('.sh-page[data-current] .sh-large-title')).not.toBeNull();
          expect(container.querySelector('.sh-page[data-current] .sh-bar-side:not(.sh-trailing) .sh-circle')).toBeNull();
          expect(container.querySelector('.sh-page[data-current] .sh-trailing')?.textContent).toBe('');
          cleanup();
        }
      }
    });

    it('follows the page when it replaces the chrome: a root that authors no groups draws no button at all', () => {
      const document = withChrome();
      const bare = { ...document, pages: document.pages.map(page => page.id === 'page-home' ? { ...page, toolbar: { type: 'replace', groups: [] } } : page) } as CompositionDocument;
      const { container } = mount(bare, { window: ipadSideways });
      expect(names(container)).toEqual([]);
    });
  });
});
