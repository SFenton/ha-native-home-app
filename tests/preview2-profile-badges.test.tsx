// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import type { CompositionDocument } from '../src/shared/composition/schema';

afterEach(cleanup);
type J = Record<string, any>;
const home = homeDomains.document as unknown as CompositionDocument;
const icon = { type: 'sf-symbol', name: 'circle', rendering: 'canonical', unavailable: 'fallback' };
const lit = (value: unknown): J => ({ type: 'literal', value });
const count: J = { type: 'read', from: { type: 'source', sourceId: 'temp', path: ['state'] }, as: 'number', missing: 'unavailable' };
const push = (pageId: string): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const value = (operand: J, spoken?: J): J => ({ type: 'value', value: operand, ...(spoken ? { spoken } : {}) });
const spokenWords: J = { type: 'format', pattern: '{count} overdue', args: { count } };
const shownCount: J = { type: 'choose', cases: [{ when: { type: 'compare', op: 'above', left: count, right: lit(9) }, then: lit('9+') }], otherwise: { type: 'format', pattern: '{count}', args: { count } } };
const headerItem = (profile?: J): J => ({ id: 'native-header', type: 'shell-header', visibility: 'always', quickLinksAction: { type: 'present', modalId: 'm', arguments: {}, ifPresented: 'reject' }, profileAction: { type: 'present', modalId: 'm', arguments: {}, ifPresented: 'reject' }, ...(profile ? { profile } : {}) });

interface Setup { sensor?: string; chrome?: J[]; tabs?: J[]; person?: string; viewer?: boolean }
/** Draws a one-page document with extra sources the cases read. */
function draw(components: J[], setup: Setup = {}) {
  const base = home.pages[0];
  const { sensor = '3', chrome = [], tabs = [], person = 'Alex Demo', viewer = true } = setup;
  const groups = [...home.navigation.chrome.groups, ...(chrome.length ? [{ id: 'trailing', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: chrome }] : [])];
  const document = { ...home, dataSources: [...home.dataSources, { id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_temp') }, { id: 'words', kind: 'ha-entity', entityId: lit('sensor.demo_words') },
    { id: 'room-state', kind: 'ha-entity', entityId: lit('switch.demo_room') }],
  navigation: { ...home.navigation, tabs, chrome: { groups }, initialPageId: base.id, initialTabId: null }, pages: [{ ...base, toolbar: { type: 'inherit' }, components }], modals: [] } as unknown as CompositionDocument;
  const states = [{ entityId: 'sensor.demo_temp', name: 'Temp', state: sensor }, { entityId: 'person.demo_alex', name: person, state: 'home' }, { entityId: 'person.demo_blair', name: 'Blair', state: 'home' }, { entityId: 'switch.demo_room', name: 'Room', state: 'on' }];
  const house = houseFrom({ states: states as never, currentUser: viewer ? { id: 'u1', name: 'Alex', isOwner: false, isAdmin: false, personEntityId: 'person.demo_alex' } : undefined });
  return render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: base.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
    window={previewWindows[0]} bezel={false} house={house} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>).container;
}
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const avatar = (props: J = {}, rest: J = {}): J => node('me', 'avatar', { props: { person: { type: 'viewer' }, ...props }, ...rest });
const el = (container: HTMLElement, id: string) => { const found = container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!; return found; };
const badgeOf = (container: HTMLElement) => container.querySelector('[data-testid="badge"]');

describe('the Profile Icon node in the preview', () => {
  it('draws the viewer\'s initials in the standard blue disc and never a photo', () => {
    const shown = draw([avatar()]);
    const disc = shown.querySelector<HTMLElement>('.sh-avatar-disc')!;
    expect(disc.textContent).toBe('AD');
    expect(disc.style.background).toMatch(/rgb\(0, 102, 204\)|#0066cc/i);
    expect(disc.style.width).toBe('36px');
    expect(shown.querySelector('img')).toBeNull();
  });
  it('draws a named person\'s initials, large, with the title under the disc', () => {
    const shown = draw([avatar({ person: { type: 'person', entityId: 'person.demo_blair' }, size: 'large' }, { title: 'Blair' })]);
    expect(shown.querySelector('.sh-avatar-disc')!.textContent).toBe('B');
    expect((shown.querySelector('.sh-avatar-disc') as HTMLElement).style.width).toBe('84px');
    expect(shown.querySelector('.sh-avatar-title')?.textContent).toBe('Blair');
  });
  it('draws the person symbol when no name is known yet, and for no initials', () => {
    const shown = draw([avatar()], { viewer: false });
    expect(shown.querySelector('.sh-avatar-disc')!.getAttribute('data-look')).toBe('symbol');
    expect(shown.querySelector('.sh-avatar-disc svg')).not.toBeNull();
  });
  it('takes an authored fill', () => {
    const disc = draw([avatar({ fill: { type: 'solid-rgb', red: 0, green: 60, blue: 160 } })]).querySelector<HTMLElement>('.sh-avatar-disc')!;
    expect(disc.style.background).toMatch(/rgb\(0 60 160\)|rgb\(0, 60, 160\)/);
  });
  it('is a button named by its title with an action, and its target is at least 44 points', () => {
    const shown = draw([avatar({}, { title: 'Open Profile', action: push(home.pages[1].id) })]);
    const button = el(shown, 'me').matches('button') ? el(shown, 'me') : el(shown, 'me').querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Open Profile');
    expect(shown.querySelector('.sh-avatar-disc')!.getAttribute('aria-hidden')).toBe('true');
  });
  it('is a labelled image with a title and no action, and hidden with neither', () => {
    expect(draw([avatar({}, { title: 'Alex' })]).querySelector('[role="img"][aria-label="Alex"]')).not.toBeNull();
    cleanup();
    const hidden = draw([avatar({}, { title: '' })]);
    expect(hidden.querySelector('[role="img"]')).toBeNull();
    expect(hidden.querySelector('.sh-avatar-node')!.getAttribute('aria-hidden')).toBe('true');
  });
  it('carries a badge, "9+" above nine, and says the whole number', () => {
    const shown = draw([avatar({}, { title: 'Alex', action: push(home.pages[1].id), badge: value(shownCount, spokenWords) })], { sensor: '12' });
    expect(badgeOf(shown)?.textContent).toBe('9+');
    expect(badgeOf(shown)?.getAttribute('aria-label')).toBe('12 overdue');
    expect(shown.querySelector('.sh-avatar-node')?.getAttribute('aria-label')).toBe('Alex, 12 overdue');
  });
});

describe('a badge on each kind that carries one since sh.badge-nodes@1', () => {
  const badge = value(count);
  const kinds: [string, J][] = [
    ['action-tile', node('k', 'action-tile', { icon, binding: { sourceId: 'source-power', projection: 'power-tile@1' }, props: { family: 'lights', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' }, badge,
      action: { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } } })],
    ['room-card', node('k', 'room-card', { icon, binding: { sourceId: 'room-state', projection: 'room-state@1' }, props: { kind: 'power', showState: true, subtitleSourceIds: [], activeStates: [], disabledStates: [], stateLabels: [] }, badge })],
    ['room-chip', node('k', 'room-chip', { icon, binding: { sourceId: 'room-state', projection: 'room-state@1' }, props: { kind: 'occupancy', showState: true, subtitleSourceIds: [], activeStates: [], disabledStates: [], stateLabels: [] }, badge })],
    ['settings-link', node('k', 'settings-link', { icon, props: { subtitle: '', showsChevron: true }, action: push(home.pages[1].id), badge })],
    ['door-tile', node('k', 'door-tile', { props: { sourceId: 'room-state', kind: 'lock', states: [{ state: 'on', appearance: { icon: { ...icon, name: 'lock.fill' }, fill: { type: 'solid-rgb', red: 67, green: 160, blue: 71 }, text: 'Locked' }, active: false, error: false }],
      fallback: { icon, fill: { type: 'solid-rgb', red: 84, green: 110, blue: 122 }, text: 'Unknown' }, loadingText: 'Loading', unavailableText: 'Unavailable', hiddenText: 'Hidden', errorText: "Didn't Respond",
      sendingOpenText: 'Sending Open...', sendingCloseText: 'Sending Close...', openLabel: 'Unlock', closeLabel: 'Lock', reverseLabel: 'Reverse' }, badge })],
    ['light-group-tile', node('k', 'light-group-tile', { props: { sourceId: 'hc-light-light-demo-entity-307' }, badge })],
  ];
  it.each(kinds)('draws the count on a %s', (_name, item) => { expect(badgeOf(draw([item]))?.textContent).toBe('3'); });
  it.each(kinds)('draws nothing on a %s for 0', (_name, item) => { expect(badgeOf(draw([item], { sensor: '0' }))).toBeNull(); });
  it('puts a settings row\'s capsule before its chevron', () => {
    const row = el(draw([kinds[3][1]]), 'k');
    const order = [...(row.matches('button') ? row : row.querySelector('button')!).children];
    expect(order.findIndex(child => child.classList.contains('sh-badge'))).toBeGreaterThan(-1);
    expect(order.findIndex(child => child.classList.contains('sh-badge'))).toBe(order.findIndex(child => child.tagName.toLowerCase() === 'svg') - 1);
  });
});

describe('the spoken words in the preview', () => {
  it('are the label of a tile badge, and the drawn text when there are none', () => {
    const tile = (badge: J) => node('n', 'navigation-tile', { icon, props: { family: 'neutral', selected: 'none', subtitle: lit('x') }, action: push(home.pages[1].id), badge });
    expect(badgeOf(draw([tile(value(shownCount, spokenWords))], { sensor: '12' }))?.getAttribute('aria-label')).toBe('12 overdue');
    cleanup();
    expect(badgeOf(draw([tile(value(count))]))?.getAttribute('aria-label')).toBe('3 new');
  });
  it('keep the tab\'s name and add the words, on a tab', () => {
    const tab = { id: 'tab-a', label: 'Chores', icon, pageId: home.pages[0].id, arguments: {}, badge: value(shownCount, spokenWords) };
    const shown = draw([], { tabs: [tab], sensor: '12' });
    const button = shown.querySelector('button.sh-tab')!;
    expect(button.textContent).toContain('Chores');
    expect(button.querySelector('[data-testid="badge"]')?.getAttribute('aria-label')).toBe('12 overdue');
  });
});

describe('the header in the preview', () => {
  const profile = (shown: HTMLElement) => shown.querySelector<HTMLElement>('button[aria-label^="Profile"]')!;
  it('draws the fixed grey stand-in when there is no profile block, as native shows the photo first', () => {
    const button = profile(draw([], { chrome: [headerItem()] }));
    const disc = button.querySelector('.sh-avatar-disc')!;
    expect(disc.getAttribute('data-look')).toBe('photo');
    // Nothing of the person: no letters, no image, no name.
    expect(disc.textContent).toBe('');
    expect(button.querySelector('img')).toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Profile');
    expect(disc.getAttribute('aria-hidden')).toBe('true');
  });
  it('draws the stand-in for photo and the initials disc for initials, never a picture', () => {
    const photo = profile(draw([], { chrome: [headerItem({ look: 'photo' })] }));
    expect(photo.querySelector('.sh-avatar-disc')?.className).toContain('sh-stand-in');
    expect(photo.querySelector('img')).toBeNull();
    cleanup();
    expect(profile(draw([], { chrome: [headerItem({ look: 'initials' })] })).querySelector('.sh-avatar-disc')?.textContent).toBe('AD');
  });
  it('draws the outlined person symbol with no disc for symbol', () => {
    const button = profile(draw([], { chrome: [headerItem({ look: 'symbol' })] }));
    expect(button.querySelector('.sh-avatar-disc')).toBeNull();
    expect(button.querySelector('svg')).not.toBeNull();
  });
  it('carries the authored badge and says its words after the name', () => {
    const button = profile(draw([], { chrome: [headerItem({ look: 'photo', badge: value(shownCount, spokenWords) })], sensor: '12' }));
    expect(button.querySelector('[data-testid="badge"]')?.textContent).toBe('9+');
    expect(button.getAttribute('aria-label')).toBe('Profile, 12 overdue');
  });
  it('draws no badge for 0 or for a badge of none', () => {
    expect(profile(draw([], { chrome: [headerItem({ badge: value(count) })], sensor: '0' })).querySelector('[data-testid="badge"]')).toBeNull();
    cleanup();
    expect(profile(draw([], { chrome: [headerItem({ badge: { type: 'none' } })] })).querySelector('[data-testid="badge"]')).toBeNull();
  });
  it('draws the badge on a header button and names it with its words', () => {
    const button = { id: 'bell', type: 'button', label: 'Alerts', menuLabel: 'Alerts', icon, visibility: 'always', priority: 'normal', rail: 'eligible', badge: value(count, lit('3 alerts')), action: push(home.pages[1].id) };
    const shown = draw([], { chrome: [button] });
    const found = shown.querySelector<HTMLElement>('button[aria-label^="Alerts"]')!;
    expect(found.querySelector('[data-testid="badge"]')?.textContent).toBe('3');
    expect(found.getAttribute('aria-label')).toBe('Alerts, 3 alerts');
  });
});
