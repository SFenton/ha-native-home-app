// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import { withPose } from '../src/preview2';
import { inVerticalBar } from '../src/preview2/split';
import { duoWindow } from '../src/preview2/windows';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

/**
 * The Duo rail as the app draws it (`ShellChrome.resolve(inVerticalBar:)`, `UKServerUIChrome.install`, `duo.md` "Duo rail", mockup kit `ui-rail`):
 * in the vertical bar the header items and the tabs are in the rail (the tabs in a rounded pill), there is no menu button, and the title is the
 * fixed inline title in the header row. Unfolded upright has horizontal bars and keeps the iPhone chrome.
 */
afterEach(cleanup);
const base = homeDomains.document as unknown as CompositionDocument;
const [iphone, duoFolded, duoUpright, duoSideways, , ipadSideways] = previewWindows;
const present = { type: 'present', modalId: base.modals[0].id, arguments: {}, ifPresented: 'reject' };
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const button = (id: string, rail: 'eligible' | 'horizontal-only') => ({ id, type: 'button', label: `Demo ${id}`, menuLabel: `Demo ${id}`, icon: symbol('star'), visibility: 'always', priority: 'normal', rail, badge: { type: 'none' }, action: present });

/** The fixture's leading menu, then the owner's trailing Quick Links and Profile, a rail-eligible button and a button that stays horizontal. */
const withChrome = (extra: unknown[] = []): CompositionDocument => ({ ...base, navigation: { ...base.navigation, chrome: { groups: [
  ...base.navigation.chrome.groups,
  { id: 'demo_utilities', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [{ id: 'demo_header', type: 'shell-header', visibility: 'always', quickLinksAction: present, profileAction: present }] },
  ...extra,
] } } }) as unknown as CompositionDocument;

const mount = (document: CompositionDocument, window: Preview2Props['window'], over: Partial<Preview2Props> = {}) => render(<Preview2 document={document} mode="edit" surface={{ kind: 'page', id: 'page-home' }}
  onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={window} bezel={false} house={demoHouse(document)} overlay={emptyOverlay} onOverlayChange={vi.fn()} {...over}/>);
const labels = (root: Element | null) => [...(root?.querySelectorAll('button') ?? [])].map(item => item.getAttribute('aria-label') ?? item.textContent);
const tabCount = base.navigation.tabs.length;

/** What every pose in the vertical bar shares. */
function expectRail(container: HTMLElement, inset = 83) {
  const rail = container.querySelector('.sh-rail-bar')!;
  expect(rail, 'the rail').not.toBeNull();
  // Order from the top: the header, then the tabs in their pill. Nothing folds here, so there is no More.
  expect([...rail.children].map(child => child.className.split(' ').find(name => ['sh-rail-header', 'sh-rail-more', 'sh-tabbar'].includes(name)))).toEqual(['sh-rail-header', 'sh-tabbar']);
  expect(labels(rail.querySelector('.sh-rail-group'))).toEqual(['Quick Links', 'Profile']);
  expect(rail.querySelector('.sh-rail-group')!.classList.contains('sh-shared')).toBe(true);
  expect(rail.querySelectorAll('.sh-tabbar .sh-tab')).toHaveLength(tabCount);
  // No hamburger and no flyout anywhere, and the header holds the title, not the header items.
  expect(container.querySelector('button[aria-label=Menu], button[aria-label=Sections]')).toBeNull();
  expect(container.querySelector('.sh-flyout-layer')).toBeNull();
  const header = container.querySelector('.sh-page[data-current] .sh-header')!;
  expect(header.hasAttribute('data-vertical')).toBe(true);
  expect(header.querySelector('.sh-inline-title')?.textContent).toBe('Home');
  expect(labels(header)).toEqual([]);
  expect(container.querySelector('.sh-large-title')).toBeNull();
  // The rail is on the trailing edge, at the window's rail width.
  expect(container.querySelector<HTMLElement>('.sh-screen')!.style.getPropertyValue('--sh-rail')).toBe(`${inset}px`);
}

describe('the Duo rail', () => {
  it('is only the windows that get a rail width', () => {
    expect([iphone, duoFolded, duoUpright, duoSideways, withPose(duoSideways, 'book'), ipadSideways].map(inVerticalBar)).toEqual([false, true, false, true, true, false]);
  });

  it('folded upright: Quick Links and Profile above the tabs pill, no hamburger, the title in the header row', () => {
    const { container } = mount(withChrome(), duoFolded);
    // R1: the closed portrait's rail inset is 84 pt; the pill is 48.5 pt wide on the camera's centre line (418 of 466).
    expectRail(container, 84);
    expect(container.querySelector('.sh-crease[data-on]')).toBeNull();
  });

  it('folded upright: the time and the connection stack on the rail in the keep-clear region, and no status bar crosses the top', () => {
    const { container } = mount(withChrome(), duoWindow({ turn: 0, fold: 'closed' }));
    const status = container.querySelector<HTMLElement>('.sh-rail-status')!;
    expect(status, 'the rail status').not.toBeNull();
    expect(container.querySelector('.sh-status')).toBeNull();
    expect(status.querySelector('.sh-time')?.textContent).toBe('9:41');
    expect(status.querySelector('.sh-wifi')).not.toBeNull();
    // A1: the time at y 92.5 and the mark at 130, on the rail's centre line, 418 pt in.
    expect(status.style.getPropertyValue('--rail-cx')).toBe('418px');
    expect([(status.querySelector('.sh-time') as HTMLElement).style.top, (status.querySelector('.sh-wifi') as unknown as HTMLElement).style.top]).toEqual(['92.5px', '130px']);
    expect(status.getAttribute('aria-hidden')).toBe('true');
  });

  it('a window with a status bar (the iPhone, the unfolded Duo) keeps it and has no rail status', () => {
    for (const win of [iphone, duoUpright, duoSideways]) {
      const { container, unmount } = mount(withChrome(), win);
      expect(container.querySelector('.sh-status'), win.name).not.toBeNull();
      expect(container.querySelector('.sh-rail-status'), win.name).toBeNull();
      unmount();
    }
  });

  it('unfolded sideways, flat: the same rail, no fold line', () => {
    const { container } = mount(withChrome(), duoSideways);
    expectRail(container);
    expect(container.querySelector('.sh-crease[data-on]')).toBeNull();
  });

  it('partly folded (book pose): the same rail, the fold at window x 455.3', () => {
    const { container } = mount(withChrome(), withPose(duoSideways, 'book'));
    expectRail(container);
    expect(container.querySelector<HTMLElement>('.sh-crease[data-on][data-axis=vertical]')!.style.left).toBe('455.3px');
  });

  it('unfolded upright: no rail; the hamburger leads, Quick Links and Profile trail, the large title sits below, the tab bar floats', () => {
    const { container } = mount(withChrome(), duoUpright);
    expect(container.querySelector('.sh-rail-bar')).toBeNull();
    const header = container.querySelector('.sh-page[data-current] .sh-header')!;
    expect(header.hasAttribute('data-vertical')).toBe(false);
    expect(labels(header)).toEqual(['Sections', 'Quick Links', 'Profile']);
    expect(container.querySelector('.sh-large-title')).not.toBeNull();
    expect(container.querySelectorAll('.sh-tabbar .sh-tab')).toHaveLength(tabCount);
    expect(container.querySelector('.sh-crease[data-on]')).toBeNull();
  });

  it('draws the initials disc in the rail as in the header, with or without a profile block; only look symbol draws the symbol', () => {
    const profileIn = (document: CompositionDocument, window: Preview2Props['window'], where: string) => mount(document, window, { house: houseFrom({ states: [{ entityId: 'person.demo_alex', name: 'Alex Demo', state: 'home' }] as never, currentUser: { id: 'u1', name: 'Alex', isOwner: false, isAdmin: false, personEntityId: 'person.demo_alex' } }) }).container.querySelector(`${where} button[aria-label=Profile]`)!;
    const withProfile = (look: string) => withChrome().navigation.chrome.groups.map(group => ({ ...group, items: group.items.map(item => item.type === 'shell-header' ? { ...item, profile: { look } } : item) }));
    const withLook = (look: string) => ({ ...withChrome(), navigation: { ...withChrome().navigation, chrome: { groups: withProfile(look) } } }) as unknown as CompositionDocument;
    const rail = profileIn(withChrome(), duoFolded, '.sh-rail-group');
    // No block, or `photo`: native shows the photo first, so the sim draws the fixed grey stand-in (never a real picture, initials or a name).
    expect(rail.querySelector('.sh-avatar-disc')?.getAttribute('data-look')).toBe('photo');
    expect(rail.querySelector('.sh-stand-in')?.textContent).toBe('');
    cleanup();
    const header = profileIn(withChrome(), iphone, '.sh-header');
    expect(header.querySelector('.sh-avatar-disc')?.getAttribute('data-look')).toBe('photo');
    cleanup();
    expect(profileIn(withLook('photo'), duoFolded, '.sh-rail-group').querySelector('.sh-avatar-disc')?.getAttribute('data-look')).toBe('photo');
    cleanup();
    expect(profileIn(withLook('initials'), duoFolded, '.sh-rail-group').querySelector('.sh-avatar-disc')?.getAttribute('data-look')).toBe('initials');
    cleanup();
    // `symbol` is the outlined person on glass, with no filled disc.
    const symbolButton = profileIn(withLook('symbol'), duoFolded, '.sh-rail-group');
    expect(symbolButton.querySelector('.sh-avatar-disc')).toBeNull();
    expect(symbolButton.querySelector('svg')).not.toBeNull();
  });

  it('opens More on the folded items and closes it after a keyboard choice in Edit, giving focus back to the circle', async () => {
    const win = duoWindow({ turn: 90, fold: 'closed' });
    const view = mount(withChrome([{ id: 'demo_extra', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [button('demo_a', 'eligible'), button('demo_b', 'eligible')] }]), win);
    const more = view.container.querySelector<HTMLButtonElement>('.sh-rail-more');
    expect(more, 'the short rail folds something into More').not.toBeNull();
    fireEvent.click(more!);
    expect(more!.getAttribute('aria-expanded')).toBe('true');
    const menu = view.container.querySelector<HTMLElement>('.sh-more-menu')!;
    const row = menu.querySelector<HTMLElement>('[role=menuitem]')!;
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    await vi.waitFor(() => expect(more!.getAttribute('aria-expanded')).toBe('false'));
  });

  it('ends a held press when the window loses focus: the release after it commits nothing', () => {
    // jsdom has no PointerEvent: a mouse event carrying the pointer fields the hold reads stands in for it.
    if (!('PointerEvent' in window)) Object.defineProperty(window, 'PointerEvent', { configurable: true, value: class extends MouseEvent {
      pointerId: number; isPrimary: boolean; pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; this.isPrimary = init.isPrimary ?? false; this.pointerType = init.pointerType ?? ''; }
    } });
    const view = mount(withChrome(), duoFolded, { mode: 'use' });
    const tabs = [...view.container.querySelectorAll<HTMLElement>('.sh-tabbar .sh-tab')];
    const select = vi.spyOn(HTMLElement.prototype, 'click');
    fireEvent.pointerDown(tabs[0], { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 40 });
    expect(view.container.querySelector('.sh-tab[data-lit]'), 'held before the blur').not.toBeNull();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    fireEvent.blur(window);
    select.mockClear();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 40 });
    expect(select).not.toHaveBeenCalled();
    expect(view.container.querySelector('.sh-tab[data-lit]')).toBeNull();
    vi.restoreAllMocks();
  });

  it('counts only the tabs it draws: a tab its rule hides in Use is not in the rail pill, in Edit it is (dimmed)', () => {
    const hidden = { type: 'state', sourceId: 'missing', path: ['state'], in: ['on'] };
    const tabs = base.navigation.tabs.map((tab, at) => at === tabCount - 1 ? { ...tab, visibleWhen: hidden, whenUnknown: 'hide' } : tab);
    const document = { ...withChrome(), navigation: { ...withChrome().navigation, tabs } } as unknown as CompositionDocument;
    const height = (container: HTMLElement) => container.querySelector<HTMLElement>('.sh-rail-bar')!.style.getPropertyValue('--tabs-h');
    const use = mount(document, duoFolded, { mode: 'use' });
    expect(use.container.querySelectorAll('.sh-tabbar .sh-tab')).toHaveLength(tabCount - 1);
    expect(height(use.container)).toBe(`${11 + 50 * (tabCount - 1)}px`);
    expect(use.container.querySelector<HTMLElement>('.sh-tabbar')!.style.getPropertyValue('--tab-n')).toBe(String(tabCount - 1));
    cleanup();
    const edit = mount(document, duoFolded);
    expect(edit.container.querySelectorAll('.sh-tabbar .sh-tab')).toHaveLength(tabCount);
    expect(height(edit.container)).toBe(`${11 + 50 * tabCount}px`);
  });

  it('keeps the title in the header row of a pushed page, beside Back, and takes no menu there either', () => {
    const { container } = mount(withChrome(), duoFolded, { surface: { kind: 'page', id: 'page-security-system' } });
    const header = container.querySelector('.sh-page[data-current] .sh-header')!;
    expect(labels(header)).toEqual(['Back']);
    expect(header.querySelector('.sh-inline-title')?.textContent).toBeTruthy();
    expect(container.querySelector('.sh-large-title')).toBeNull();
  });

  it('closes an open flyout when the window turns into the rail, and the menu button never shows there', () => {
    const view = mount(withChrome(), iphone, { mode: 'use' });
    fireEvent.click(view.container.querySelector('button[aria-label=Sections]')!);
    expect(view.container.querySelector('.sh-flyout-layer')!.hasAttribute('data-open')).toBe(true);
    view.rerender(<Preview2 document={withChrome()} mode="use" surface={{ kind: 'page', id: 'page-home' }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={duoFolded} bezel={false}
      house={demoHouse(base)} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
    expect(view.container.querySelector('.sh-flyout-layer')).toBeNull();
    expect(view.container.querySelector('button[aria-label=Sections]')).toBeNull();
  });

  describe('the composition decides what goes in the rail', () => {
    it('puts an eligible button in the rail and leaves a horizontal-only one in the header', () => {
      const document = withChrome([{ id: 'demo_extra', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [button('demo_rail', 'eligible'), button('demo_stay', 'horizontal-only')] }]);
      const { container } = mount(document, duoFolded);
      expect(labels(container.querySelector('.sh-rail-bar'))).toEqual(expect.arrayContaining(['Quick Links', 'Profile', 'Demo demo_rail']));
      expect(labels(container.querySelector('.sh-rail-bar'))).not.toContain('Demo demo_stay');
      expect(labels(container.querySelector('.sh-page[data-current] .sh-header'))).toEqual(['Demo demo_stay']);
    });

    it('draws a group that says vertical separate as one circle each, and shared as one glass blob', () => {
      const document = withChrome([{ id: 'demo_apart', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'separate@1', items: [button('demo_one', 'eligible'), button('demo_two', 'eligible')] }]);
      const rail = mount(document, duoSideways).container.querySelector('.sh-rail-bar')!;
      expect(rail.querySelectorAll('.sh-rail-group')).toHaveLength(1);
      expect(rail.querySelectorAll('.sh-rail-circles')).toHaveLength(1);
      expect(labels(rail.querySelector('.sh-rail-circles'))).toEqual(['Demo demo_one', 'Demo demo_two']);
    });

    it('puts the leading groups above the trailing ones', () => {
      const document = withChrome([{ id: 'demo_lead', placement: 'leading', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [button('demo_first', 'eligible')] }]);
      const rail = mount(document, duoFolded).container.querySelector('.sh-rail-bar')!;
      expect(labels(rail).slice(0, 3)).toEqual(['Demo demo_first', 'Quick Links', 'Profile']);
    });

    it('shows no header group on a page that replaces the toolbar with none, only the tabs', () => {
      const { container } = mount(withChrome(), duoFolded, { surface: { kind: 'page', id: 'page-security-system' } });
      expect(container.querySelector('.sh-rail-group, .sh-rail-circles')).toBeNull();
      expect(container.querySelectorAll('.sh-rail-bar .sh-tab')).toHaveLength(tabCount);
    });
  });
});
