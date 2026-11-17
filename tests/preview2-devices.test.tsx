// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import deviceControls from '../src/preview2/fixtures/device-controls.json';
import { deviceHouse } from '../src/preview2/fixtures/device-house';
import { projectDevice } from '../src/preview2/device-state';
import { emptyOverlay, houseFrom, shownEntity, type House } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import { drawnTypes } from '../src/preview2/nodes/registry';
import { compositionDocumentSchema, compositionChildren, type CompositionDocument, type CompositionNode } from '../src/shared/composition/schema';
import { settingsKinds } from '../src/shared/composition/settings';

afterEach(cleanup);

const document = deviceControls.document as unknown as CompositionDocument;
const types = ['settings-control', 'vacuum-control', 'custom-light-control', 'climate-control', 'sprinkler-control', 'remote-control'] as const;
const nodes: CompositionNode[] = [];
const collect = (node: CompositionNode) => { nodes.push(node); compositionChildren(node).forEach(collect); };
document.pages.forEach(page => page.components.forEach(collect));
const kindOf = (node: CompositionNode) => { const p = (node as { props: { kind?: string; primitive?: { kind: string } } }).props; return p.kind ?? p.primitive?.kind ?? ''; };

function mount(page: string, over: Partial<Preview2Props> = {}) {
  const props: Preview2Props = { document, mode: 'edit', surface: { kind: 'page', id: page }, onSurfaceChange: vi.fn(), onSelect: vi.fn(), window: previewWindows[0], bezel: false,
    house: deviceHouse(), overlay: emptyOverlay, onOverlayChange: vi.fn(), ...over };
  return { ...render(<Preview2 {...props}/>), props };
}
const frame = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;
const typeOnPage = (type: string) => document.pages.find(page => page.components.some(function has(node: CompositionNode): boolean { return node.type === type || compositionChildren(node).some(has); }))!.id;

describe('the device-controls fixture', () => {
  it('is a synthetic document the schema accepts, with every kind of the six types', () => {
    expect(compositionDocumentSchema.safeParse(document).success).toBe(true);
    for (const type of types) expect(nodes.some(node => node.type === type), type).toBe(true);
    expect(JSON.stringify(document)).not.toMatch(/"(?:light|switch|sensor|climate|vacuum|valve|select)\.(?!demo_)/);
    const kinds = (type: string) => new Set(nodes.filter(node => node.type === type).map(kindOf));
    expect(kinds('settings-control').size).toBe(settingsKinds.length);
    expect(kinds('vacuum-control').size).toBe(14);
    expect(kinds('custom-light-control').size).toBe(8);
    expect(kinds('climate-control').size).toBe(13);
    expect(kinds('sprinkler-control').size).toBe(18);
    expect(kinds('remote-control').size).toBe(10);
  });

  it('registers the six types as drawn', () => { for (const type of types) expect(drawnTypes).toContain(type); });

  it.each(types)('draws every %s kind in Edit and Use without the placeholder', type => {
    for (const mode of ['edit', 'use'] as const) {
      const { container, unmount } = mount(typeOnPage(type), { mode });
      for (const node of nodes.filter(item => item.type === type)) {
        const el = frame(container, node.id);
        expect(el, `${type}/${kindOf(node)} ${node.id} in ${mode}`).not.toBeNull();
        expect(el.querySelector('.sh-placeholder'), `${node.id} is not a placeholder`).toBeNull();
        expect(el.textContent!.length + el.querySelectorAll('svg, input, button').length, `${node.id} draws something`).toBeGreaterThan(0);
      }
      unmount();
    }
  });

  it('draws unavailable and loading states from the node own text, never blank', () => {
    const none: House = houseFrom({ states: [] });
    const { container, unmount } = mount('page-vacuum', { house: none });
    expect(frame(container, 'vac-card').textContent).toContain('Unavailable');
    expect(frame(container, 'vac-battery').textContent).toContain('Unavailable');
    expect(frame(container, 'vac-map').textContent).toContain('Map unavailable');
    unmount();
    const waiting = mount('page-climate', { house: undefined });
    expect(frame(waiting.container, 'cl-st-state').textContent).toContain('Loading');
    waiting.unmount();
    const climate = mount('page-climate', { house: none });
    expect(frame(climate.container, 'cl-dial').textContent).toContain('Unavailable');
    expect(frame(climate.container, 'cl-room1').textContent).toContain('Unavailable');
  });
});

describe('settings-control', () => {
  it('draws rows by kind from the house and its own subtitle', () => {
    const { container } = mount('page-settings');
    expect(within(frame(container, 'set-household-toggle-input_boolean-demo_auto_lock')).getByRole('switch', { name: 'Front Door Auto-Lock' }).getAttribute('aria-checked')).toBe('true');
    expect(within(frame(container, 'set-household-toggle-input_boolean-demo_garage_close')).getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(frame(container, 'set-household-read-only-sensor-demo_charge').textContent).toContain('Charging');
    expect(frame(container, 'set-household-relay-warning').textContent).toContain('Guest mode is active');
    expect(frame(container, 'set-profile-people').textContent).toContain('A');
    expect(frame(container, 'set-ha-value-connection').textContent).toContain('Connected');
    expect(frame(container, 'set-sign-out').textContent).toContain('Sign Out');
    expect(frame(container, 'set-app-icon-choice-navySky').querySelector('[aria-label=Selected]')).not.toBeNull();
    expect((within(frame(container, 'set-background-blur')).getByRole('slider') as HTMLInputElement).value).toBe('50');
  });

  it('toggles a household switch in Use through the overlay and never in Edit', () => {
    const calls: string[] = [], overlays: unknown[] = [];
    const edit = mount('page-settings', { onOverlayChange: o => overlays.push(o) });
    fireEvent.click(within(frame(edit.container, 'set-household-toggle-input_boolean-demo_auto_lock')).getByRole('switch'));
    expect(overlays).toHaveLength(0);
    edit.unmount();
    const use = mount('page-settings', { mode: 'use', onOverlayChange: o => overlays.push(o), onSimulatedCall: summary => calls.push(summary) });
    fireEvent.click(within(frame(use.container, 'set-household-toggle-input_boolean-demo_auto_lock')).getByRole('switch'));
    expect(calls).toEqual(['input_boolean.demo_auto_lock: turn off']);
    expect(shownEntity(use.props.house!, (overlays[0] as typeof emptyOverlay), 'input_boolean.demo_auto_lock')?.state).toBe('off');
  });

  it('keeps a typed feedback draft and a chosen app icon in Use only', () => {
    const { container } = mount('page-settings', { mode: 'use' });
    const field = within(frame(container, 'set-feedback-field-title')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Hello' } });
    expect(field.value).toBe('Hello');
    fireEvent.click(frame(container, 'set-app-icon-choice-tealMint').querySelector('button')!);
    expect(frame(container, 'set-app-icon-choice-tealMint').querySelector('[aria-label=Selected]')).not.toBeNull();
    expect(frame(container, 'set-app-icon-choice-navySky').querySelector('[aria-label=Selected]')).toBeNull();
  });
});

describe('vacuum-control', () => {
  it('shows the robot state, battery, dock, consumables and rooms from the house', () => {
    const { container } = mount('page-vacuum');
    expect(frame(container, 'vac-card').textContent).toContain('Docked • 87%');
    expect(frame(container, 'vac-status').textContent).toContain('Docked');
    expect(frame(container, 'vac-battery').textContent).toContain('87%');
    expect(frame(container, 'vac-dock').textContent).toContain('Idle');
    expect(frame(container, 'vac-brush').textContent).toContain('233 h');
    expect(frame(container, 'vac-notices').textContent).toContain('No notices');
    expect(frame(container, 'vac-settings').textContent).toMatch(/Fan\s*Max/);
    // One switch for the automation, not a row per room (`UKServerUIVacuumView`'s `auto-clean`).
    expect(frame(container, 'vac-auto-list').textContent).toMatch(/Auto-Clean\s*Enabled/);
    expect(within(frame(container, 'vac-auto-list')).getAllByRole('switch')).toHaveLength(1);
    expect(frame(container, 'vac-choice-k').querySelector('[aria-label=Selected]')).not.toBeNull();
    expect(frame(container, 'vac-map').querySelector('[role=img]')!.getAttribute('aria-label')).toBe('Main Floor map');
  });

  it('opens the sheet from the card in Use and toggles a room choice without a service', () => {
    const calls: string[] = [];
    const { container, props } = mount('page-vacuum', { mode: 'use', onSimulatedCall: summary => calls.push(summary) });
    fireEvent.click(within(frame(container, 'vac-choice-l')).getByRole('button'));
    expect(calls).toEqual(['input_boolean.demo_zone_living: toggle']);
    fireEvent.click(within(frame(container, 'vac-card')).getByRole('button', { name: 'Open Main Floor' }));
    expect(props.onSurfaceChange).toHaveBeenCalledWith({ kind: 'modal', id: 'modal-demo' });
  });
});

describe('custom-light-control', () => {
  it('draws a tile with the light colour and level, an off light and a light the house lacks', () => {
    const { container } = mount('page-lights');
    const left = frame(container, 'lt-left');
    expect(left.textContent).toContain('100%');
    expect((left.querySelector('.sh-dv-lighttile') as HTMLElement).style.getPropertyValue('--band')).toBe('rgb(120 240 90)');
    expect(frame(container, 'lt-b2').textContent).toContain('Off');
    expect(frame(container, 'lt-missing').textContent).toContain('Unavailable');
    expect(frame(container, 'lt-mode').textContent).toContain('Holiday');
    expect(within(frame(container, 'lt-manual')).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(frame(container, 'lt-c3').textContent).toContain('Off');
  });

  it('powers a light off in Use through the overlay', () => {
    const calls: string[] = [];
    const { container } = mount('page-lights', { mode: 'use', onSimulatedCall: summary => calls.push(summary) });
    fireEvent.click(within(frame(container, 'lt-left')).getByRole('button', { name: 'Power Left Door Light' }));
    expect(calls).toEqual(['light.demo_left: toggle']);
  });
});

describe('climate-control', () => {
  it('draws the dial reading, the range, the action and the room tile with its palette', () => {
    const { container } = mount('page-climate');
    const dial = frame(container, 'cl-dial');
    expect(dial.textContent).toContain('Heating');
    expect(dial.textContent).toContain('70.0 · 76.0');
    expect(dial.querySelector('.sh-dv-dial-face strong')!.textContent).toContain('71');
    expect(frame(container, 'cl-dial-range').textContent).toContain('Cooling');
    expect(frame(container, 'cl-room1').textContent).toContain('70.9°F');
    expect(frame(container, 'cl-room1').textContent).toContain('Occupied');
    expect(frame(container, 'cl-room2').textContent).toContain('Inactive');
    expect(frame(container, 'cl-notice').textContent).toContain('Away Mode Active');
    // Mode and Fan are rows with a menu (`UKHubPicker`), the title once and the choice as its value: no heading over buttons.
    expect(frame(container, 'cl-mode').textContent).toMatch(/Mode\s*Heat/);
    expect(frame(container, 'cl-fan').textContent).toMatch(/Fan\s*Auto/);
    expect(within(frame(container, 'cl-fan')).queryAllByText('Fan')).toHaveLength(1);
    expect(within(frame(container, 'cl-toggle')).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(frame(container, 'cl-link').textContent).toContain('Track Select Critical');
    expect(frame(container, 'cl-hub').textContent).toContain('Heat · Auto');
  });

  it('draws the dial with no step buttons and a fan menu that changes in Use only', () => {
    const calls: string[] = [];
    const edit = mount('page-climate', { onSimulatedCall: s => calls.push(s) });
    expect(within(frame(edit.container, 'cl-dial')).queryAllByRole('button')).toHaveLength(0);
    expect(calls).toEqual([]);
    edit.unmount();
    const use = mount('page-climate', { mode: 'use', onSimulatedCall: s => calls.push(s) });
    expect(within(frame(use.container, 'cl-dial')).queryAllByRole('button')).toHaveLength(0);
    fireEvent.click(within(frame(use.container, 'cl-fan')).getByRole('button', { name: 'Fan' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'On' }));
    expect(frame(use.container, 'cl-fan').textContent).toMatch(/Fan\s*On/);
  });
});

describe('sprinkler-control', () => {
  it('draws the card, the status grid and the blocker from the controller', () => {
    const { container } = mount('page-sprinklers');
    expect(frame(container, 'sp-card').textContent).toContain('Auto · Next 7:00 AM');
    const status = frame(container, 'sp-status').textContent!;
    for (const text of ['82%', '7:00 AM', '6:00 AM', 'Connected']) expect(status).toContain(text);
    expect(frame(container, 'sp-blocker').textContent).toContain('is allowed');
    expect(within(frame(container, 'sp-smart')).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(within(frame(container, 'sp-rain')).getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(within(frame(container, 'sp-enabled')).getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('shows watering and a blocked state when the house says so', () => {
    const states = [...deviceHouse().states!.values()].map(state => state.entityId === 'valve.demo_zone_1' ? { ...state, state: 'open' } : state.entityId === 'switch.demo_sprinkler_rain' ? { ...state, state: 'on' } : state);
    const { container } = mount('page-sprinklers', { house: houseFrom({ states }) });
    expect(frame(container, 'sp-card').textContent).toContain('Watering');
    expect(frame(container, 'sp-blocker').textContent).toContain('blocked by a rain delay');
  });

  it('steps the duration and picks days in Use, preview only', () => {
    const { container } = mount('page-sprinklers', { mode: 'use' });
    fireEvent.click(within(frame(container, 'sp-duration')).getByRole('button', { name: 'Increase Duration' }));
    expect(frame(container, 'sp-duration').textContent).toContain('11 min');
    fireEvent.click(within(frame(container, 'sp-presets')).getByRole('radio', { name: '20' }));
    expect(frame(container, 'sp-duration').textContent).toContain('20 min');
    fireEvent.click(within(frame(container, 'sp-days')).getByRole('button', { name: 'Monday' }));
    expect(within(frame(container, 'sp-days')).getByRole('button', { name: 'Monday' }).querySelector('span')!.hasAttribute('data-on')).toBe(false);
  });
});

describe('remote-control', () => {
  it('draws the pad by position with the power key lit, the volume level and the app and device state', () => {
    const { container } = mount('page-remote');
    const pad = frame(container, 'rm-pad');
    expect(pad.querySelectorAll('button')).toHaveLength(9);
    expect(within(pad).getByRole('button', { name: 'Power' }).className).toContain('sh-dv-key-on');
    expect(frame(container, 'rm-vol').textContent).toContain('32%');
    expect(frame(container, 'rm-app1').className).toBeDefined();
    expect(frame(container, 'rm-app1').querySelector('.sh-lit')).not.toBeNull();
    expect(frame(container, 'rm-app2').querySelector('.sh-lit')).toBeNull();
    expect(frame(container, 'rm-dev-tile').textContent).toContain('Running');
    expect(frame(container, 'rm-card').textContent).toContain('Playing');
    expect(within(frame(container, 'rm-hue-power')).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(within(frame(container, 'rm-hue-mode')).getByRole('radio', { name: 'Video' }).getAttribute('aria-checked')).toBe('true');
    expect(frame(container, 'rm-hue-in').textContent).toContain('Selected');
    expect(frame(container, 'rm-kb').querySelector('input')!.getAttribute('placeholder')).toBe('Enter text');
  });

  it('moves the volume and types text in Use, and never calls a service', () => {
    const calls: string[] = [];
    const { container } = mount('page-remote', { mode: 'use', onSimulatedCall: s => calls.push(s) });
    fireEvent.click(within(frame(container, 'rm-vol')).getByRole('button', { name: 'Volume Up' }));
    expect(frame(container, 'rm-vol').textContent).toContain('37%');
    const input = frame(container, 'rm-kb').querySelector('input')!;
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input.value).toBe('abc');
    expect(calls).toEqual([]);
  });

  it('reads as unavailable when its provider config is missing', () => {
    const source = document.dataSources.find(item => item.id === 'demo-remote')!;
    const projection = projectDevice(source, new Map(), () => undefined, true);
    expect(projection?.phase).toBe('unavailable');
    const { container } = mount('page-remote', { house: houseFrom({ states: [] }) });
    expect(frame(container, 'rm-dev-tile').textContent).toContain('Unavailable');
    expect(frame(container, 'rm-vol').textContent).toContain('Unavailable');
  });
});

describe('device projections', () => {
  const sources = new Map(document.dataSources.map(source => [source.id, source]));
  const house = deviceHouse();
  const read = (id?: string) => id ? shownEntity(house, emptyOverlay, id) : undefined;
  const project = (id: string, loaded = true) => projectDevice(sources.get(id)!, sources, read, loaded)!;

  it('resolves each model from its entities', () => {
    expect(project('demo-climate-whole').fields).toMatchObject({ phase: 'ready', state: 'heat', isOn: true, hvacAction: 'heating', target: 72, low: 70, high: 76 });
    expect(project('demo-lights').fields).toMatchObject({ manualOn: true, mode: 'Holiday' });
    expect(project('demo-sprinkler').fields).toMatchObject({ batteryPercent: 82, batteryLow: false, hubConnected: true, watering: false, next: '7:00 AM' });
    expect(project('demo-vacuum').fields).toMatchObject({ state: 'docked', battery: 87, fan: 'max' });
    expect(project('demo-remote').fields).toMatchObject({ isOn: true, volume: .32 });
  });

  it('is loading before the first read and unavailable when the lead entity is missing', () => {
    expect(project('demo-vacuum', false).phase).toBe('loading');
    const empty = (id?: string) => id ? undefined : undefined;
    expect(projectDevice(sources.get('demo-sprinkler')!, sources, empty, true)!.phase).toBe('unavailable');
  });

  it('leaves other models and sources alone', () => {
    expect(projectDevice({ id: 'x', kind: 'ha-entity', entityId: { type: 'literal', value: 'light.demo' } } as never, sources, read, true)).toBeUndefined();
    expect(projectDevice(sources.get('demo-settings-household')!, sources, read, true)).toBeUndefined();
  });
});
