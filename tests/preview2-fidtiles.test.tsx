// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fidtilesStory } from '../src/preview2/fixtures/fidtiles-story';
import { createEnvironment, emptyOverlay, houseFrom, projectSource } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import { lightTileWidths, nodeMinimumWidth } from '../src/preview2/nodes/tile-minimum';
import { isDimmable, lightPercent } from '../src/preview2/nodes/light-tile';
import { roomCardLine } from '../src/preview2/nodes/tiles';
import { familyLook } from '../src/preview2/room-face';
import { tileMinimumWidth, tileStrip, TILE_CHEVRON, TILE_GLYPH_COLUMN } from '../src/preview2/grid';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import type { NativeState } from '../src/shared/native-state';

afterEach(cleanup);

const story = fidtilesStory();
const literalOf = (entityId: unknown) => (entityId as { value?: string })?.value;
const source = (id: string) => story.document.dataSources.find(item => item.id === id)!;
const fields = (id: string, house = story.house) => projectSource(source(id), house, emptyOverlay, literalOf).fields;
function mount(surface: { kind: 'page' | 'modal'; id: string }, over: Partial<Preview2Props> = {}) {
  const props: Preview2Props = { document: story.document, mode: 'use', surface, onSurfaceChange: vi.fn(), onSelect: vi.fn(), window: previewWindows[0], bezel: false,
    house: story.house, overlay: emptyOverlay, onOverlayChange: vi.fn(), ...over };
  return render(<Preview2 {...props}/>);
}
const frame = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;
const line = (container: HTMLElement, id: string) => frame(container, id).querySelector('.sh-tile-line')?.textContent;
const tileOf = (container: HTMLElement, id: string) => frame(container, id).querySelector<HTMLElement>('.sh-tile')!;
const nodes = (list: unknown): CompositionNode[] => (function walk(node: unknown): CompositionNode[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (node && typeof node === 'object') return [...('type' in node && 'id' in node ? [node as CompositionNode] : []), ...Object.values(node).flatMap(walk)];
  return [];
})(list);
const nodeById = (id: string) => nodes([...story.document.pages, ...story.document.modals]).find(node => node.id === id)!;

describe('the home-status projection says what the app says (items 1, 2 and 7)', () => {
  it('lights a room by its family while a light is on, with "N On", "On" or "Off"', () => {
    expect(fields('fid-st-living')).toMatchObject({ stateText: '1 On', state: 'active', isActive: true, family: 'lights', phase: 'ready' });
    expect(fields('fid-st-bed')).toMatchObject({ stateText: '2 On', isActive: true });
    expect(fields('fid-st-kitchen')).toMatchObject({ stateText: 'On', isActive: true });
    expect(fields('fid-st-office')).toMatchObject({ stateText: 'Off', state: 'idle', isActive: false, family: 'lights' });
    expect(fields('fid-st-hall')).toMatchObject({ stateText: 'Unavailable', state: 'unavailable', phase: 'unavailable' });
  });
  it('is active when only the room group light is on', () => {
    const states = [...story.house.states!.values()].map(state => state.entityId === 'light.demo_fid_office_group' ? { ...state, state: 'on' } : state);
    expect(fields('fid-st-office', houseFrom({ states }))).toMatchObject({ isActive: true, state: 'active', stateText: 'On' });
  });
  it('words occupancy and contacts as sentences, and names their families and chip state', () => {
    expect(fields('fid-st-occ-a')).toMatchObject({ stateText: 'Occupied', family: 'occupancy', isActive: true });
    expect(fields('fid-st-occ-b')).toMatchObject({ stateText: 'Not Occupied', isActive: false });
    expect(fields('fid-st-contact')).toMatchObject({ stateText: 'Window Open', family: 'contact', state: 'open-home', isActive: true });
  });
  it('words a climate range and its sensors, and an air pair with the colour of its helper', () => {
    expect(fields('fid-st-range')).toMatchObject({ stateText: '70.0°F - 72.9°F', family: 'climate' });
    expect(fields('fid-st-sensors').stateText).toBe('70.2°F - 72.1°F');
    expect(fields('fid-st-air')).toMatchObject({ stateText: '42 • 9.5 µg/m³', family: 'air', color: 'rgb(220 120 30)' });
  });
  it('gives the colour of an air tile only when the document names a colour helper', () => {
    const bare = structuredClone(source('fid-st-air')) as Extract<ReturnType<typeof source>, { model: 'home-status@1' }>;
    delete bare.inputs.colorEntityId;
    expect(projectSource(bare, story.house, emptyOverlay, literalOf).fields).not.toHaveProperty('color');
  });
  it('reads the entity of a light, for the tile that draws it', () => {
    expect(fields('fid-light-dim')).toMatchObject({ entityId: 'light.demo_fid_dimmer', isOn: true });
    expect(createEnvironment(story.document, story.house).read('fid-light-dim', ['entityId'])).toEqual({ status: 'value', value: 'light.demo_fid_dimmer' });
  });
  it('names the colour family of a vent item, and drops the line for a loading house', () => {
    const vent = { ...structuredClone(source('fid-st-sensors')), id: 'vent' } as Extract<ReturnType<typeof source>, { model: 'home-status@1' }>;
    vent.inputs = { ...vent.inputs, format: 'item', entityIds: [{ type: 'literal', value: 'cover.demo_fid_vent_open' }] };
    expect(projectSource(vent, story.house, emptyOverlay, literalOf).fields).toMatchObject({ family: 'vents', stateText: 'Open · 60%', state: 'active' });
    expect(projectSource(source('fid-st-living'), {}, emptyOverlay, literalOf)).toMatchObject({ phase: 'loading' });
  });
});

describe('the overview tile is lit by its family (item 1)', () => {
  it('lights the rooms with lights on, in the warm lit face, and leaves the others dark', () => {
    const { container } = mount({ kind: 'modal', id: 'modal-fid-lights' });
    for (const id of ['fid-sheet-living', 'fid-sheet-bed', 'fid-sheet-kitchen']) {
      expect(tileOf(container, id).className).toContain('sh-lit-warm');
      expect(tileOf(container, id).className).toContain('sh-lit');
    }
    for (const id of ['fid-sheet-office', 'fid-sheet-hall']) expect(tileOf(container, id).className).not.toContain('sh-lit');
    expect(['fid-sheet-living', 'fid-sheet-bed', 'fid-sheet-kitchen', 'fid-sheet-office', 'fid-sheet-hall'].map(id => line(container, id))).toEqual(['1 On', '2 On', 'On', 'Off', 'Unavailable']);
  });
  it('fills occupancy, contacts and air with their families, and leaves climate dark', () => {
    const { container } = mount({ kind: 'page', id: 'page-fid-overview' });
    expect(tileOf(container, 'fid-ov-occ-a').style.getPropertyValue('--fill')).toBe('#2A732E');
    expect(tileOf(container, 'fid-ov-occ-b').className).not.toContain('sh-lit');
    expect(tileOf(container, 'fid-ov-contact').style.getPropertyValue('--fill')).toBe('#3B523E');
    expect(tileOf(container, 'fid-ov-air').style.getPropertyValue('--fill')).toBe('#006E62');
    expect(tileOf(container, 'fid-ov-range').className).not.toContain('sh-lit');
  });
  it('hides the line of a contact overview that asks to, and keeps the other', () => {
    const { container } = mount({ kind: 'page', id: 'page-fid-overview' });
    expect(line(container, 'fid-ov-contact')).toBeUndefined();
    expect(line(container, 'fid-ov-contact-shown')).toBe('Window Open');
  });
  it('does not light a room that is unavailable, even with an authored fill', () => {
    const states = [...story.house.states!.values()].map(state => state.entityId === 'light.demo_fid_living_a' ? { ...state, state: 'unavailable' } : state);
    const { container } = mount({ kind: 'page', id: 'page-fid-lights' }, { house: houseFrom({ states }) });
    expect(line(container, 'fid-lights-living')).toBe('Unavailable');
    expect(tileOf(container, 'fid-lights-living').className).not.toContain('sh-lit');
  });
});

describe('the family look (TileFaceStyle.resolve)', () => {
  it('is the warm lit tile for lights, a fill with white ink for a family with one, power in its dark ink, and dark when idle', () => {
    expect(familyLook('lights', true).className).toBe('sh-lit-warm');
    expect(familyLook('lights', true).fill).toBeUndefined();
    expect(familyLook('lights', false)).toMatchObject({ className: '' });
    expect(familyLook('lights', false).fill).toBeUndefined();
    expect(familyLook('vents', true)).toMatchObject({ className: 'sh-lit-filled', fill: '#3B58B8' });
    expect(familyLook('power', true)).toMatchObject({ className: 'sh-dark-ink', fill: '#FFD60A' });
    expect(familyLook('neutral', true)).toMatchObject({ className: '' });
    expect(familyLook('climate', true).fill).toBe('#195482');
  });
});

describe('the room card draws its state (item 6)', () => {
  const card = (kind: string, props: Record<string, unknown> = {}) => ({ kind, showState: true, subtitleSourceIds: [], activeStates: [], disabledStates: [], stateLabels: [], ...props }) as never;
  const vent = (state: string, extra: Partial<NativeState> = {}): NativeState => ({ entityId: 'cover.demo_v', state, name: 'v', ...extra });
  it('says a vent state with its position, a configured label before it, and nothing without showState', () => {
    expect(roomCardLine(card('vent'), vent('open', { currentPosition: 60 }), [])).toBe('Open · 60%');
    expect(roomCardLine(card('vent'), vent('closed'), [])).toBe('Closed');
    expect(roomCardLine(card('vent', { stateLabels: [{ state: 'open', label: 'Flowing' }] }), vent('open', { currentPosition: 60 }), [])).toBe('Flowing');
    expect(roomCardLine(card('vent', { showState: false }), vent('open'), [])).toBe('');
    expect(roomCardLine(card('fan'), { entityId: 'fan.demo_f', state: 'on', name: 'f' }, [])).toBe('On');
  });
  it('says the sources\' states with their units, joined, ahead of the card\'s own state', () => {
    const humidity: NativeState = { entityId: 'sensor.demo_h', state: '45', name: 'h', unit: '%' }, temp: NativeState = { entityId: 'sensor.demo_t', state: '70', name: 't', unit: '°F' };
    expect(roomCardLine(card('vent'), vent('open'), [humidity, temp])).toBe('45% • 70°F');
    expect(roomCardLine(card('vent'), vent('open'), [undefined])).toBe('Unavailable');
  });
  it('leaves Open and Closed off a contact card that asks for no state, but keeps Unavailable and a card that shows one', () => {
    const sensor = (state: string): NativeState => ({ entityId: 'binary_sensor.contact_demo_c', state, name: 'c' });
    expect(roomCardLine(card('contact', { showState: false }), sensor('on'), [])).toBe('');
    expect(roomCardLine(card('contact', { showState: false }), sensor('unavailable'), [])).toBe('Unavailable');
    expect(roomCardLine(card('contact', { showState: true }), sensor('on'), [])).toBe('Open');
    expect(roomCardLine(card('contact', { showState: true }), sensor('off'), [])).toBe('Closed');
    expect(roomCardLine(card('contact', { showState: false, action: { type: 'push' } }), sensor('on'), [])).toBe('');
  });
  it('draws them on the room page', () => {
    const { container } = mount({ kind: 'page', id: 'page-fid-room' });
    expect(line(container, 'fid-vent-open')).toBe('Open · 60%');
    expect(line(container, 'fid-vent-closed')).toBe('Closed');
    expect(line(container, 'fid-contact-plain')).toBeUndefined();
    expect(line(container, 'fid-contact-state')).toBe('Open');
    expect(line(container, 'fid-source-line')).toBe('Open');
    expect(tileOf(container, 'fid-vent-open').style.getPropertyValue('--fill')).toBe('#3B58B8');
    expect(tileOf(container, 'fid-vent-closed').className).not.toContain('sh-lit');
    expect(tileOf(container, 'fid-light-card').className).toContain('sh-lit-warm');
  });
});

describe('the light group tile draws the app\'s tile (items 2 and 3)', () => {
  it('knows a dimmable light and its shown percent', () => {
    const light = (state: string, extra: Partial<NativeState> = {}): NativeState => ({ entityId: 'light.demo_l', state, name: 'l', ...extra });
    expect(isDimmable(light('on', { brightness: 100 }))).toBe(true);
    expect(isDimmable(light('on', { supportedColorModes: ['color_temp'] }))).toBe(true);
    expect(isDimmable(light('on', { supportedColorModes: ['onoff'] }))).toBe(false);
    expect(isDimmable(light('on'))).toBe(false);
    expect(isDimmable({ entityId: 'switch.demo_s', state: 'on', name: 's', brightness: 5 })).toBe(false);
    expect(isDimmable(undefined)).toBe(false);
    expect(lightPercent(light('on', { brightness: 128 }))).toBe(50);
    expect(lightPercent(light('on'))).toBe(100);
    expect(lightPercent(light('on', { brightness: 0 }))).toBe(100);
    expect(lightPercent(light('off', { brightness: 128 }))).toBe(0);
    expect(lightPercent(light('unavailable'))).toBe(0);
  });
  it('draws a dimmable light with its band, percent and power disc, and the others with On, Off or Unavailable and a disc', () => {
    const { container } = mount({ kind: 'page', id: 'page-fid-room' });
    const dim = frame(container, 'fid-room-dim');
    expect(dim.querySelector('.sh-dv-lighttile-band')).not.toBeNull();
    expect(dim.querySelector('.sh-row-copy span')!.textContent).toBe('50%');
    expect(dim.querySelectorAll('.sh-dv-disc')).toHaveLength(1);
    expect(dim.querySelector<HTMLElement>('.sh-dv-lighttile')!.style.getPropertyValue('--level')).toBe('50%');
    expect(frame(container, 'fid-room-off').querySelector('.sh-row-copy span')!.textContent).toBe('Off');
    expect(frame(container, 'fid-room-off').querySelector('.sh-dv-lighttile')!.hasAttribute('data-off')).toBe(true);
    expect(line(container, 'fid-room-plain')).toBe('On');
    expect(tileOf(container, 'fid-room-plain').className).toContain('sh-lit-warm');
    expect(frame(container, 'fid-room-plain').querySelectorAll('.sh-tile-disc')).toHaveLength(1);
    expect(line(container, 'fid-room-dead')).toBe('Unavailable');
    expect(frame(container, 'fid-room-dead').querySelector('.sh-tile-disc')!.hasAttribute('disabled')).toBe(true);
  });
  it('flips a plain light with an explicit turn off, as the app does, never a toggle', () => {
    const calls: string[] = [];
    const { container } = mount({ kind: 'page', id: 'page-fid-room' }, { onSimulatedCall: summary => calls.push(summary) });
    (frame(container, 'fid-room-plain').querySelector('.sh-tile-disc') as HTMLElement).click();
    expect(calls.join(' ')).toMatch(/turn off/i);
    expect(calls.join(' ')).not.toMatch(/toggle/i);
  });
});

describe('the grid is asked for the width a light tile needs (item 3)', () => {
  const strip = tileStrip(1);
  it('adds the glyph column, the name, the disc and, when it opens details, the chevron', () => {
    const title = 'Bedroom Reading Light';
    expect(lightTileWidths(title, true).minimum).toBe(tileMinimumWidth(Math.ceil(title.length * 9.2), TILE_GLYPH_COLUMN, TILE_CHEVRON, strip));
    expect(lightTileWidths(title, false).minimum).toBe(tileMinimumWidth(Math.ceil(title.length * 9.2), TILE_GLYPH_COLUMN, 0, strip));
    expect(lightTileWidths(title, true).floor).toBeLessThan(lightTileWidths(title, true).minimum);
    // A short name still gets the room for the widest state ("Didn't Respond").
    expect(lightTileWidths('Lamp', false).minimum).toBe(tileMinimumWidth(96, TILE_GLYPH_COLUMN, 0, strip));
  });
  it('answers for a brightness tile and a light group tile, and for no other custom light control', () => {
    expect(nodeMinimumWidth(nodeById('fid-cl-bed'))).toBe(lightTileWidths('Bedroom Reading Light', true).minimum);
    expect(nodeMinimumWidth(nodeById('fid-cl-dead'))).toBe(lightTileWidths('Hall Sconce', false).minimum);
    expect(nodeMinimumWidth(nodeById('fid-room-dim'))).toBe(lightTileWidths('Living Room Lights', false).minimum);
    const manual = { ...nodeById('fid-cl-bed'), props: { sourceId: 'fid-custom-lights', kind: 'manual' } } as CompositionNode;
    expect(nodeMinimumWidth(manual)).toBe(0);
    expect(nodeMinimumWidth(nodeById('fid-lights-living'))).toBe(0);
  });
  it('keeps a long name on one line by taking two tracks on a narrow page', () => {
    // The 354 point iPhone page holds two 171 point tracks: 286 points does not fit one, so the tile takes both.
    expect(lightTileWidths('Living Room Lamp', true).minimum).toBeGreaterThan(171);
    expect(lightTileWidths('Office Lamp', true).minimum).toBeGreaterThan(171);
  });
});

describe('the Security System tile draws its alarm (item 10b)', () => {
  const states = (state: string) => houseFrom({ states: [...story.house.states!.values()].map(entity => entity.entityId === 'alarm_control_panel.demo_fid' ? { ...entity, state } : entity) });
  const draw = (state: string, over: Partial<Preview2Props> = {}) => { const { container } = mount({ kind: 'page', id: 'page-fid-quick' }, { house: states(state), ...over }); return tileOf(container, 'fid-quick-security'); };
  it('takes the colour, icon words and white ink of the alarm state', () => {
    const away = draw('armed_away');
    expect(away.style.getPropertyValue('--fill')).toBe('rgb(229 57 53)');
    expect(away.className).toContain('sh-lit');
    expect(away.className).toContain('sh-colored');
    expect(away.querySelector('.sh-tile-line')!.textContent).toBe('Armed Away');
    cleanup();
    const disarmed = draw('disarmed');
    expect(disarmed.style.getPropertyValue('--fill')).toBe('rgb(67 160 71)');
    expect(disarmed.querySelector('.sh-tile-line')!.textContent).toBe('Disarmed');
  });
  it('draws the fallback for a state the document does not list, and the unavailable words for a gone alarm', () => {
    const other = draw('armed_vacation');
    expect(other.style.getPropertyValue('--fill')).toBe('rgb(84 110 122)');
    expect(other.querySelector('.sh-tile-line')!.textContent).toBe('Unknown');
    cleanup();
    const gone = draw('unavailable');
    expect(gone.querySelector('.sh-tile-line')!.textContent).toBe('Unavailable');
    cleanup();
    const unknown = draw('unknown');
    expect(unknown.querySelector('.sh-tile-line')!.textContent).toBe('Unavailable');
  });
  it('says Loading before the first read, and a tile with no alarm keeps its own look', () => {
    const { container } = mount({ kind: 'page', id: 'page-fid-quick' }, { house: {} });
    expect(line(container, 'fid-quick-security')).toBe('Loading');
    const chores = tileOf(container, 'fid-quick-chores');
    expect(chores.className).not.toContain('sh-colored');
    expect(chores.className).not.toContain('sh-lit');
  });
});

describe('the story', () => {
  it('names an alarm source the Security System tile can read', () => {
    const doc = story.document as CompositionDocument;
    expect(doc.dataSources.some(item => item.id === 'fid-alarm')).toBe(true);
  });
});
