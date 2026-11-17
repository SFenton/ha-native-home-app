// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { simfixStates, simfixStory } from '../src/preview2/fixtures/simfix-story';
import { demoHouse } from '../src/preview2/demo-house';
import { createEnvironment, emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import { nodeIsShown, roomVisibilityHolds } from '../src/preview2/evaluate';
import { contentSpans, tileMinimumWidth, tileStrip } from '../src/preview2/grid';
import { discTileWidths } from '../src/preview2/nodes/tile-minimum';
import { autoCleanDisplay, selectedSegments, tileFit } from '../src/preview2/nodes/vacuum';
import { roomBackground, roomFace, roomFamily } from '../src/preview2/room-face';
import type { ValetudoMap } from '../src/preview2/valetudo-map';
import type { CompositionDocument } from '../src/shared/composition/schema';

afterEach(cleanup);

const story = simfixStory();
function mount(page: string, over: Partial<Preview2Props> = {}) {
  const props: Preview2Props = { document: story.document, mode: 'edit', surface: { kind: 'page', id: page }, onSurfaceChange: vi.fn(), onSelect: vi.fn(), window: previewWindows[0], bezel: false,
    house: story.house, overlay: emptyOverlay, onOverlayChange: vi.fn(), ...over };
  return { ...render(<Preview2 {...props}/>), props };
}
const frame = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`);

describe('H2 status chips', () => {
  it('draw the title over the state, not the state in place of the title', () => {
    const { container } = mount('page-sim-chips');
    const chip = frame(container, 'sim-chip-lights')!;
    expect(chip.querySelector('.sh-chip-text strong')!.textContent).toBe('Lights');
    expect(chip.querySelector('.sh-chip-text span')!.textContent).toBe('2 On');
    expect(frame(container, 'sim-chip-vents')!.querySelector('.sh-chip-text strong')!.textContent).toBe('Vents');
  });
});

describe('H9 settings rows', () => {
  it('draws the icon, title and subtitle of a link and gives its hint to the screen reader, as the app does', () => {
    const { container } = mount('page-sim-chips');
    const link = frame(container, 'sim-link')!.querySelector('.sh-settings-link')!;
    expect(link.querySelector('.sh-row-glyph svg')).not.toBeNull();
    expect(link.textContent).toContain('Household');
    expect(link.textContent).toContain('Away, presence and relay');
    const hint = link.getAttribute('aria-describedby');
    expect(hint).toBe('sim-link-hint');
    expect(container.querySelector(`#${hint}`)!.textContent).toBe('Opens the household settings.');
    expect(container.querySelector(`#${hint}`)!.hasAttribute('hidden')).toBe(true);
  });

  it('draws a section footer under its rows', () => {
    const document = structuredClone(story.document);
    const section = document.pages.find(page => page.id === 'page-sim-vacuums')!.components.find(node => node.id === 'sim-auto-section') as unknown as { props: { footer: string } };
    section.props.footer = 'Turns automatic cleaning on or off.';
    const { container } = mount('page-sim-vacuums', { document });
    expect(frame(container, 'sim-auto-section')!.querySelector('.sh-section-footer')!.textContent).toBe('Turns automatic cleaning on or off.');
  });
});

describe('accessibility of the drawn nodes', () => {
  it('names a chip by its title and state, and every disc and switch by what it does', () => {
    const chips = mount('page-sim-chips');
    expect(frame(chips.container, 'sim-chip-lights')!.textContent).toBe('Lights2 On');
    chips.unmount();
    const { container } = mount('page-sim-vacuums');
    const tile = frame(container, 'sim-robot-1')!;
    expect(within(tile).getByRole('button', { name: 'Start Main Floor' })).toBeTruthy();
    expect(within(tile).getByRole('button', { name: 'Dock Main Floor' })).toBeTruthy();
    expect(within(tile).getByRole('button', { name: 'Open Main Floor' })).toBeTruthy();
    expect(within(frame(container, 'sim-auto')!).getByRole('switch', { name: 'Main Floor' }).getAttribute('aria-checked')).toBe('true');
  });

  it('labels the map, keeps its canvas out of the reading order and keeps the locate button named', () => {
    const { container } = mount('page-sim-sheet');
    expect(container.querySelector('.sh-dv-map')!.getAttribute('role')).toBe('img');
    expect(container.querySelector('.sh-dv-map')!.getAttribute('aria-label')).toBe('Main Floor map');
    expect(within(container).getByRole('button', { name: 'Locate' })).toBeTruthy();
  });
});

describe('H5b the tile minimum width and the grid', () => {
  it('declares the least width of a tile with two discs and a chevron, from its content, as the app does', () => {
    // 2 * 12 padding + 42 glyph column + 96 text floor + 20 chevron + the strip of two 44 point discs and their gaps.
    expect(tileStrip(2)).toBe(108);
    expect(tileMinimumWidth(0, 42, 20, tileStrip(2))).toBe(24 + 42 + 96 + 20 + 108);
    const widths = discTileWidths('Main Floor', 2);
    expect(widths.floor).toBe(290);
    expect(widths.minimum).toBeGreaterThanOrEqual(widths.floor);
    expect(discTileWidths('A Very Long Robot Title Here', 2).minimum).toBeGreaterThan(widths.minimum);
    expect(discTileWidths('Main Floor', 0).floor).toBe(24 + 42 + 96 + 20);
  });

  it('gives a tile with a minimum ceil((minimum + gap) / (track + gap)) tracks, capped at the row', () => {
    // A phone: two tracks of 174.5 with a 12 gap and a tile that needs 300: two tracks, one robot per row.
    expect(contentSpans([undefined, undefined], [300, 300], 174.5, 2, 12)).toEqual([2, 2]);
    expect(contentSpans([undefined], [300], 400, 2, 12)).toEqual([1]);
    expect(contentSpans([undefined], [900], 100, 2, 12)).toEqual([2]);
    expect(contentSpans([1, 1], [0, 0], 100, 4, 12)).toEqual([1, 1]);
    expect(contentSpans([undefined], [300], 0, 3, 12)).toEqual([3]);
  });

  it('keeps a span the author set, 1 included: the grid decides only when it is unset', () => {
    expect(contentSpans([3, 2, undefined], [300, 300, 300], 100, 4, 8)).toEqual([3, 2, 3]);
    // A span of 1 the author set is theirs: it is no longer the same as unset.
    expect(contentSpans([1], [900], 100, 2, 12)).toEqual([1]);
  });

  it('draws the tile natural at its minimum, ticker down to its floor and the discs below under that', () => {
    const widths = { minimum: 300, floor: 290 };
    expect(tileFit(0, widths)).toBe('natural');
    expect(tileFit(300, widths)).toBe('natural');
    expect(tileFit(299.6, widths)).toBe('natural');
    expect(tileFit(295, widths)).toBe('ticker');
    expect(tileFit(289.6, widths)).toBe('ticker');
    expect(tileFit(174, widths)).toBe('below');
  });

  it('marks a tile with its fit and puts its discs in one group, so its text cannot sit under them', () => {
    const { container } = mount('page-sim-vacuums');
    const tiles = [...container.querySelectorAll('.sh-dv-card-tile')];
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) expect(tile.getAttribute('data-fit')).toBe('natural');
    expect(tiles[0].querySelectorAll('.sh-dv-card-discs .sh-dv-disc')).toHaveLength(2);
  });
});

describe('H5c the automatic-cleaning switch', () => {
  it('reads Enabled for an automation that is on and Paused for a pause switch that is on', () => {
    expect(autoCleanDisplay('automation', 'on')).toEqual({ enabled: true, unavailable: false, subtitle: 'Enabled' });
    expect(autoCleanDisplay('automation', 'off')).toEqual({ enabled: false, unavailable: false, subtitle: 'Paused' });
    expect(autoCleanDisplay('pause', 'on')).toEqual({ enabled: false, unavailable: false, subtitle: 'Paused' });
    expect(autoCleanDisplay('pause', 'off')).toMatchObject({ enabled: true, subtitle: 'Enabled' });
    expect(autoCleanDisplay('automation', 'unavailable')).toEqual({ enabled: false, unavailable: true, subtitle: 'Unavailable' });
    expect(autoCleanDisplay('automation', undefined).unavailable).toBe(true);
  });

  it('draws one switch for the automation and flips it through a simulated call in Use only', () => {
    const calls: string[] = [];
    const edit = mount('page-sim-vacuums', { onSimulatedCall: summary => calls.push(summary) });
    const row = frame(edit.container, 'sim-auto')!;
    expect(within(row).getAllByRole('switch')).toHaveLength(1);
    expect(row.textContent).toContain('Enabled');
    fireEvent.click(within(row).getByRole('switch'));
    expect(calls).toEqual([]);
    edit.unmount();
    const use = mount('page-sim-vacuums', { mode: 'use', onSimulatedCall: summary => calls.push(summary) });
    fireEvent.click(within(frame(use.container, 'sim-auto')!).getByRole('switch'));
    expect(calls).toEqual(['automation.demo_auto_clean: turn off']);
  });

  it('says so when the vacuum has no automatic-cleaning control', () => {
    const document = structuredClone(story.document);
    const source = document.dataSources.find(item => item.id === 'demo-vacuum') as unknown as { inputs: Record<string, unknown> };
    delete source.inputs.autoCleanControl;
    const { container } = mount('page-sim-vacuums', { document });
    expect(frame(container, 'sim-auto')!.textContent).toContain('Automatic cleaning is unavailable.');
  });
});

describe('H5e and H5h the map', () => {
  const map: ValetudoMap = { pixelSize: 5, size: { x: 100, y: 100 }, entities: [], layers: [
    { type: 'segment', pixels: [1, 1], hasPixels: true, name: 'Kitchen', segmentId: '3', active: false },
    { type: 'segment', pixels: [2, 1], hasPixels: true, name: 'Living  Room', segmentId: '4', active: false },
    { type: 'wall', pixels: [0, 0], hasPixels: true, active: false },
  ] };

  it('lights the rooms of the zones that are on, matched by name', () => {
    expect([...selectedSegments(map, [{ mapName: ' kitchen ', on: true }, { mapName: 'Living Room', on: false }])]).toEqual(['3']);
    expect([...selectedSegments(map, [{ mapName: 'living room', on: true }])]).toEqual(['4']);
    expect(selectedSegments(map, []).size).toBe(0);
  });

  it('is a labelled schematic when the Studio has no map to read', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = mount('page-sim-sheet');
    const maps = container.querySelectorAll('.sh-dv-map');
    expect(maps).toHaveLength(1);
    expect(maps[0].querySelector('.sh-dv-map-tag')!.textContent).toBe('Schematic');
    expect(container.querySelector('[data-testid=valetudo-map]')).toBeNull();
  });

  it('draws the map the camera picture carries when one is read, and says it is live', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const picture = vi.fn(async () => new ArrayBuffer(8));
    vi.resetModules();
    vi.doMock('../src/preview2/valetudo-map', async original => ({ ...(await original<typeof import('../src/preview2/valetudo-map')>()), decodeValetudoPng: async () => map }));
    try {
      const { default: Fresh, previewWindows: windows } = await import('../src/preview2/Preview2');
      const props: Preview2Props = { document: story.document, mode: 'edit', surface: { kind: 'page', id: 'page-sim-sheet' }, onSurfaceChange: vi.fn(), onSelect: vi.fn(), window: windows[0], bezel: false,
        house: story.house, overlay: emptyOverlay, onOverlayChange: vi.fn(), mapPicture: picture };
      const { container } = render(<Fresh {...props}/>);
      await waitFor(() => expect(container.querySelector('[data-testid=valetudo-map]')).not.toBeNull());
      expect(picture).toHaveBeenCalledWith('camera.demo_robot_map_data', expect.anything());
      expect(container.querySelector('.sh-dv-map-tag')!.textContent).toBe('Live map');
    } finally { vi.doUnmock('../src/preview2/valetudo-map'); vi.resetModules(); }
  });

  it('puts a map only on the tabs whose children the document gives one', () => {
    // A tab shows while it holds the selection, which is how Edit looks at a tab.
    const on = (select: `node:${string}`) => mount('page-sim-sheet', { selection: select });
    const first = on('node:sim-status');
    expect(first.container.querySelectorAll('.sh-dv-map')).toHaveLength(1);
    first.unmount();
    const rooms = on('node:sim-notices');
    expect(rooms.container.querySelectorAll('.sh-dv-map')).toHaveLength(0);
    rooms.unmount();
    expect(on('node:sim-map-auto').container.querySelectorAll('.sh-dv-map')).toHaveLength(1);
  });
});

describe('H8 room cards', () => {
  const entity = (entityId: string, state: string, extra = {}) => ({ entityId, state, name: entityId, ...extra });

  it('puts each kind in its colour family, a heater on the power family', () => {
    expect(roomFamily('vent', 'wind')).toBe('vents');
    expect(roomFamily('light', 'lightbulb')).toBe('lights');
    expect(roomFamily('light', 'mdi:heat-wave')).toBe('power');
    expect(roomFamily('humidifier', 'x')).toBe('water');
    expect(roomFamily('laundry', 'x')).toBe('cleaning');
    expect(roomFamily('grill', 'x')).toBe('cooking');
  });

  it('fills a vent while it is open, by `activeStates` or the shared rule', () => {
    expect(roomFace('vent', 'wind', entity('cover.demo_v', 'open'), ['open'])).toEqual({ family: 'vents', active: true });
    expect(roomFace('vent', 'wind', entity('cover.demo_v', 'closed'), ['open']).active).toBe(false);
    expect(roomFace('vent', 'wind', entity('cover.demo_v', 'on'), []).active).toBe(true);
    expect(roomFace('vent', 'wind', entity('cover.demo_v', 'unavailable'), ['unavailable']).active).toBe(false);
    expect(roomFace('vent', 'wind', undefined, ['open']).active).toBe(false);
  });

  it('follows the rules of each kind: a purifier sensor is a reading, a thermostat changes family with its action', () => {
    expect(roomFace('air', 'x', entity('sensor.demo_aqi', '12'), []).active).toBe(false);
    expect(roomFace('air', 'x', entity('fan.demo_purifier', 'auto'), []).active).toBe(true);
    expect(roomFace('climate', 'x', entity('climate.demo_t', 'heat', { hvacAction: 'heating' }), [])).toEqual({ family: 'heating', active: true });
    expect(roomFace('climate', 'x', entity('climate.demo_t', 'cool', { hvacAction: 'idle' }), [])).toEqual({ family: 'cooling', active: false });
    expect(roomFace('climate', 'x', entity('climate.demo_t', 'heat', { hvacAction: 'idle' }), []).family).toBe('heating');
    expect(roomFace('occupancy', 'x', entity('binary_sensor.demo_o', 'occupied'), []).active).toBe(true);
    expect(roomFace('vacuum', 'x', entity('vacuum.demo_r', 'cleaning'), []).active).toBe(true);
    expect(roomFace('light', 'x', entity('light.demo_l', 'off'), []).active).toBe(false);
  });

  it('paints a state colour, or the climate action tone, over the family fill', () => {
    const red = { type: 'solid-rgb', red: 200, green: 10, blue: 20 };
    expect(roomBackground({ stateColors: [{ state: 'open', fill: red }] }, entity('cover.demo_v', 'open'))).toBe('rgb(200 10 20)');
    expect(roomBackground({ stateColors: [{ state: 'open', fill: red }] }, entity('cover.demo_v', 'closed'))).toBeUndefined();
    expect(roomBackground({ climateActionTone: true }, entity('climate.demo_t', 'heat', { hvacAction: 'heating' }))).toBe('rgb(136 64 26 / .6)');
    expect(roomBackground({ climateActionTone: true }, entity('climate.demo_t', 'off'))).toBeUndefined();
    expect(roomBackground({}, entity('climate.demo_t', 'heat', { hvacAction: 'heating' }))).toBeUndefined();
  });

  it('draws the open vent in the vents fill and the closed one dark', () => {
    const { container } = mount('page-sim-rooms', { mode: 'use' });
    const style = (id: string) => frame(container, id)!.querySelector<HTMLElement>('.sh-tile')!.style;
    expect(style('sim-vent-open').getPropertyValue('--fill')).toBe('#3B58B8');
    expect(style('sim-vent-open').getPropertyValue('--glyph')).toBe('#8FA8FF');
    expect(style('sim-vent-closed').getPropertyValue('--fill')).toBe('');
    expect(style('sim-vent-closed').getPropertyValue('--glyph')).toBe('#8FA8FF');
  });
});

describe('E12 room visibility', () => {
  const house = houseFrom({ states: simfixStates });
  const env = createEnvironment(story.document, house, emptyOverlay);
  const card = (states: string[], sourceId = 'sim-party-source') => ({ type: 'room-card', props: { visibility: { sourceId, states } } });

  it('shows a card while its source reads a listed state and hides it otherwise', () => {
    expect(roomVisibilityHolds(card(['on'], 'sim-guest-source'), env)).toBe(true);
    expect(roomVisibilityHolds(card(['on']), env)).toBe(false);
    expect(roomVisibilityHolds(card(['off']), env)).toBe(true);
  });

  it('hides a card whose source is unavailable and repeats the last answer while it loads', () => {
    expect(roomVisibilityHolds(card(['on'], 'no-such-source'), env)).toBe(false);
    const loading = createEnvironment(story.document, {}, emptyOverlay);
    expect(roomVisibilityHolds(card(['on'], 'sim-guest-source'), loading, true)).toBe(true);
    expect(roomVisibilityHolds(card(['on'], 'sim-guest-source'), loading, false)).toBe(false);
    expect(roomVisibilityHolds(card(['on'], 'sim-guest-source'), loading)).toBe(true);
  });

  it('has no say on a node that is not a room card, chip or section, or has no rule', () => {
    expect(roomVisibilityHolds({ type: 'tile-grid', props: { visibility: { sourceId: 'x', states: ['on'] } } }, env)).toBe(true);
    expect(roomVisibilityHolds({ type: 'room-card', props: {} }, env)).toBe(true);
    expect(nodeIsShown({ type: 'room-card', props: {} }, env)).toBe(true);
  });

  it('leaves a hidden card and section out in Use and draws them tagged in Edit', () => {
    const use = mount('page-sim-rooms', { mode: 'use' });
    expect(frame(use.container, 'sim-guest')).not.toBeNull();
    expect(frame(use.container, 'sim-party')).toBeNull();
    expect(frame(use.container, 'sim-section-hidden')).toBeNull();
    use.unmount();
    const edit = mount('page-sim-rooms', { mode: 'edit' });
    expect(frame(edit.container, 'sim-party')!.getAttribute('data-hidden')).toBe('');
    expect(frame(edit.container, 'sim-section-hidden')!.getAttribute('data-hidden')).toBe('');
    expect(screen.queryAllByText('Hidden by Rule').length).toBeGreaterThan(0);
  });
});

describe('H8 thermostat and option rows', () => {
  it('centres the readout on a square the size of the ring, with no card and no step buttons', () => {
    const { container } = mount('page-climate');
    const dial = container.querySelector<HTMLElement>('.sh-dv-dial')!;
    expect(dial.style.getPropertyValue('--dial-px')).toBe('300px');
    expect(dial.querySelector('.sh-dv-dial-face')!.parentElement).toBe(dial);
    expect(dial.querySelector('.sh-dv-round, .sh-dv-dial-steps')).toBeNull();
    expect(dial.querySelectorAll('button')).toHaveLength(0);
  });

  it('draws an options node as its choices, the title appearing only in the fallback row', () => {
    const document = homeDomains.document as unknown as CompositionDocument;
    const { container } = render(<Preview2 document={document} mode="edit" surface={{ kind: 'page', id: 'hc-eco-critical-detail' }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
      window={previewWindows[0]} bezel={false} house={demoHouse(document)} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
    const options = frame(container, 'hc-eco-critical-options')!;
    expect(options.querySelectorAll('.sh-dv-option')).toHaveLength(3);
    expect(options.textContent).not.toContain('Eco Mode Critical Tracking');
    expect(options.textContent).toContain('Track Select Critical');
  });
});
