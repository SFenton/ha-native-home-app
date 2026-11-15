// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeEntityControl, NativeGuestTile, NativeLocalTabs, NativeRemoteKey, NativeRemoteVolume, NativeWeather } from '../src/NativeControls';
import NativeVacuum from '../src/NativeVacuum';
import { nativeHomeSnapshot } from '../server/native-home';
import type { Component, Json } from '../src/shared/types';

const component = (kind: string, entityId = `${kind}.example`, props: Record<string, Json> = {}): Component => ({
  id: `control-${kind}`, type: 'action-tile', title: 'Device', props: { presentation: 'control', controlKind: kind, entityId, ...props },
});
const weatherComponent: Component = { id: 'weather', type: 'weather-summary', title: 'Weather', props: {} };
const weather: Record<string, Json> = {
  state: 'rainy', temperature: 71.5, unit: '\u00b0F', humidity: 74, windSpeed: 12, windSpeedUnit: 'mph',
  pressure: 1012, pressureUnit: 'hPa', precipitationUnit: 'mm',
  dailyForecast: [
    { datetime: '2026-11-12T12:00:00Z', condition: 'rainy', temperature: 78, templow: 58, precipitationProbability: 80, precipitation: 3.2 },
    { datetime: '2026-11-13T12:00:00Z', condition: 'sunny', temperature: 68, templow: 52 },
  ],
  hourlyForecast: [
    { datetime: '2026-11-12T12:00:00Z', condition: 'rainy', temperature: 72, precipitationProbability: 80, precipitation: 1.2, windSpeed: 12 },
    { datetime: '2026-11-12T13:00:00Z', condition: 'cloudy', temperature: 70, precipitationProbability: 30, precipitation: .3, windSpeed: 8 },
  ],
};

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Controls must not make network calls'); })); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); cleanup(); vi.unstubAllGlobals(); });

describe('native weather primitives', () => {
  it('uses the UIKit card hierarchy, actual rounded values, and an accessible opening action', () => {
    const onOpen = vi.fn();
    const { container } = render(<NativeWeather component={weatherComponent} weather={weather} editing={false} onOpen={onOpen}/>);
    const header = container.querySelector('.native-weather-header')!;
    expect(header.firstElementChild!.className).toBe('native-weather-summary');
    expect(header.lastElementChild!.className).toBe('native-weather-temperature');
    expect(header.lastElementChild!.textContent).toBe('72\u00b0');
    expect(container.querySelector('.native-weather-high-low')!.textContent).toBe('H:78\u00b0  L:58\u00b0');
    expect(container.querySelector('.native-weather-brief')!.textContent).toBe('Rain, with a high of 78\u00b0 and a low of 58\u00b0.');
    expect(container.querySelectorAll('.native-weather-hour')).toHaveLength(2);
    expect(container.querySelectorAll('.native-weather-separator')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Open Weather forecast.*72\u00b0F/ }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(container.textContent).not.toMatch(/simulat|native not|live weather/i);
  });

  describe('source-backed guest, remote, and vacuum controls', () => {
    it('keeps checked Auto-Clean helper state distinct from local manual room selection', () => {
      const onAction = vi.fn();
      const props = { component: { ...component('toggle', 'input_boolean.clean_hall', {
        checkRow: true, checkedText: 'Included', uncheckedText: 'Skipped',
      }), title: 'Hall' }, editing: false, onAction, onSelect: vi.fn() };
      render(<NativeEntityControl {...props} entity={{ state: 'off' }}/>);
      fireEvent.click(screen.getByRole('button', { name: 'Hall Skipped' }));
      expect(screen.getByRole('button', { name: 'Hall Included' }).getAttribute('aria-pressed')).toBe('true');
      expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'input_boolean', service: 'turn_on', entityId: 'input_boolean.clean_hall' });
    });
    it('uses identical explicit guest setters on the body and power disc, without opening details', () => {
      const onAction = vi.fn();
      const guest = { ...component('toggle', 'input_boolean.guests'), title: 'Guests', props: { entityId: 'input_boolean.guests', presentation: 'guest-toggle' } };
      const props = { component: guest, editing: false, onAction, onSelect: vi.fn() };
      const { rerender } = render(<NativeGuestTile {...props} entity={{ state: 'on' }}/>);
      fireEvent.click(screen.getByRole('button', { name: 'Guests Guests staying' }));
      expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'input_boolean', service: 'turn_off', entityId: 'input_boolean.guests' });
      expect(screen.getByText('No guests')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Turn on Guests' }));
      expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'input_boolean', service: 'turn_on', entityId: 'input_boolean.guests' });
      rerender(<NativeGuestTile {...props} entity={{ state: 'unavailable' }}/>);
      expect(screen.getByText("Didn't Respond")).toBeTruthy();
      for (const button of screen.getAllByRole('button')) expect(button.hasAttribute('disabled')).toBe(true);
      expect(onAction).toHaveBeenCalledTimes(2);
      rerender(<NativeGuestTile {...props} component={{ ...guest, props: { ...guest.props, readOnly: true } }} entity={{ state: 'on' }}/>);
      expect(screen.getByRole('button', { name: 'Turn off Guests' }).hasAttribute('disabled')).toBe(true);
    });
    it('keeps remote power operable while off and navigation unavailable without inventing commands', () => {
      const onAction = vi.fn();
      const remote = (key: string): Component => ({
        ...component('media'), id: key, title: key,
        props: { remoteKey: key, remoteMediaEntityId: 'media_player.tv' },
        action: { type: 'service', domain: 'remote', service: 'send_command', entityId: 'remote.tv', data: { command: key } },
      });
      const states: Json = [{ entityId: 'media_player.tv', state: 'off' }];
      render(<>{['power', 'up'].map(key => <NativeRemoteKey key={key} component={remote(key)} states={states} editing={false}
        onAction={onAction} onSelect={vi.fn()}/>)}</>);
      fireEvent.click(screen.getByRole('button', { name: 'up' }));
      expect(onAction).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'power' }));
      expect(onAction).toHaveBeenCalledWith(remote('power').action);
    });
    it('keeps volume draft local until release, supports accessibility changes, and emits fractions', () => {
      const onAction = vi.fn();
      const volume: Component = { id: 'volume', type: 'section', title: 'TV Volume',
        props: { presentation: 'remote-volume', entityId: 'media_player.tv', remoteMediaEntityId: 'media_player.tv' } };
      const props = { component: volume, states: [{ entityId: 'media_player.tv', state: 'playing' }] as Json,
        entity: { state: 'playing', volumeLevel: .35, supportedFeatures: 4 }, editing: false, onAction, renderKey: () => null };
      const { rerender } = render(<NativeRemoteVolume {...props}/>);
      const slider = screen.getByRole('slider', { name: 'TV Volume' });
      fireEvent.pointerDown(slider);
      fireEvent.change(slider, { target: { value: '81' } });
      expect(screen.getByText('81%')).toBeTruthy();
      expect(onAction).not.toHaveBeenCalled();
      fireEvent.pointerUp(slider);
      expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'media_player', service: 'volume_set', entityId: 'media_player.tv', data: { volume_level: .81 } });
      fireEvent.change(slider, { target: { value: '54' } });
      expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ data: { volume_level: .54 } }));
      rerender(<NativeRemoteVolume {...props} states={[{ entityId: 'media_player.tv', state: 'off' }]}/>);
      expect(slider.hasAttribute('disabled')).toBe(true);
    });
    it('omits a single-tab remote bar and exposes a labeled accessibility menu', () => {
      const tabs = [{ id: 'remote', title: 'Remote' }];
      const onSelect = vi.fn();
      const { rerender } = render(<NativeLocalTabs tabs={tabs} active="remote" onSelect={onSelect}/>);
      expect(screen.queryByRole('tablist')).toBeNull();
      rerender(<NativeLocalTabs tabs={[...tabs, { id: 'apps', title: 'Apps' }]} active="remote" onSelect={onSelect} style="menu"/>);
      fireEvent.change(screen.getByRole('combobox', { name: 'Sheet sections' }), { target: { value: 'apps' } });
      expect(onSelect).toHaveBeenCalledWith('apps');
      rerender(<NativeLocalTabs tabs={[...tabs, { id: 'apps', title: 'Apps' }]} active="removed" onSelect={onSelect}/>);
      expect(screen.getByRole('tab', { name: 'Remote' }).getAttribute('aria-selected')).toBe('true');
    });
    it('hosts the local selector outside the scrolling content and hides inactive selectors', () => {
      const tabs = [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }];
      const { container, rerender } = render(<div className="native-modal"><div className="native-modal-scroll">
        <NativeLocalTabs tabs={tabs} active="one" onSelect={vi.fn()}/>
      </div></div>);
      expect(screen.getByRole('tablist').parentElement?.className).toBe('native-modal');
      expect(container.querySelector('.native-modal-scroll [role=tablist]')).toBeNull();
      rerender(<div className="native-modal"><div className="native-modal-scroll">
        <NativeLocalTabs tabs={tabs} active="one" onSelect={vi.fn()} surfaceActive={false}/>
      </div></div>);
      expect(screen.queryByRole('tablist')).toBeNull();
    });
    const vacuum: Component = {
      id: 'robot', type: 'section', title: 'Hall', props: { presentation: 'vacuum-sheet', entityId: 'vacuum.hall' },
      children: [
        { id: 'controls', type: 'section', title: 'Controls', props: { vacuumTab: 'controls' }, children: [
          { id: 'setting', type: 'text', title: 'Settings', props: {} },
          { id: 'clean', type: 'action-tile', title: 'Clean', props: { vacuumAction: 'clean' },
            action: { type: 'service', domain: 'script', service: 'turn_on', entityId: 'script.clean' } },
        ] },
        { id: 'zones', type: 'section', title: 'Rooms', props: { vacuumTab: 'zones' }, children: [
          { id: 'hall', type: 'action-tile', title: 'Hall', props: { nativeKind: 'vacuum-room' } },
          { id: 'study', type: 'action-tile', title: 'Study', props: { nativeKind: 'vacuum-room' } },
        ] },
        { id: 'area', type: 'section', title: 'Cleaning Area', props: { vacuumPage: 'area' } },
      ],
    };
    it('retains mounted vacuum selection/drafts when tabs disappear and refuses unrepresentable selected-room cleans', () => {
      const onAction = vi.fn(), onChrome = vi.fn();
      const props = { component: vacuum, editing: false, onAction, onSelect: vi.fn(), onChrome,
        renderComponent: (child: Component, disabled: boolean) => child.id === 'setting' ? <input aria-label="Draft setting" defaultValue="original"/>
          : child.id === 'clean' ? <button disabled={disabled} onClick={() => onAction(child.action)}>Clean</button> : null };
      const { rerender, container } = render(<NativeVacuum {...props} states={[{ entityId: 'vacuum.hall', state: 'docked', supportedFeatures: 8220 }]}/>);
      fireEvent.change(screen.getByRole('textbox', { name: 'Draft setting' }), { target: { value: 'edited' } });
      fireEvent.click(screen.getByRole('tab', { name: 'Rooms' }));
      fireEvent.click(screen.getByRole('button', { name: 'Study Not selected' }));
      expect(screen.getByRole('button', { name: 'Study 1' }).getAttribute('aria-pressed')).toBe('true');
      rerender(<NativeVacuum {...props} states={[{ entityId: 'vacuum.hall', state: 'cleaning', supportedFeatures: 8220 }]}/>);
      expect(screen.queryByRole('tab', { name: 'Rooms' })).toBeNull();
      expect(container.querySelector('#zones-panel')?.hasAttribute('hidden')).toBe(true);
      rerender(<NativeVacuum {...props} states={[{ entityId: 'vacuum.hall', state: 'docked', supportedFeatures: 8220 }]}/>);
      fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));
      expect((screen.getByRole('textbox', { name: 'Draft setting' }) as HTMLInputElement).value).toBe('edited');
      expect(screen.getByRole('button', { name: 'Clean' }).hasAttribute('disabled')).toBe(true);
      expect(screen.getByText('Room selection is preview only.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Cleaning Area' }));
      expect(onChrome).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Cleaning Area', close: false, back: expect.any(Function) }));
      expect(screen.getByText(/No map available/)).toBeTruthy();
      expect(onAction).not.toHaveBeenCalled();
    });
    it.each([['cleaning', 'return_to_base'], ['paused', 'return_to_base'], ['error', 'stop']])('uses the source Stop policy for %s and actual feature gates', (state, service) => {
      const onAction = vi.fn();
      const props = { component: vacuum, editing: false, onAction, onSelect: vi.fn(), renderComponent: () => null };
      const { rerender } = render(<NativeVacuum {...props} states={[{ entityId: 'vacuum.hall', state, supportedFeatures: 8220 }]}/>);
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
      expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'vacuum', service, entityId: 'vacuum.hall' });
      if (state === 'paused') {
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'vacuum', service: 'start', entityId: 'vacuum.hall' });
      }
      rerender(<NativeVacuum {...props} states={[{ entityId: 'vacuum.hall', state, supportedFeatures: 0 }]}/>);
      expect(screen.getByRole('button', { name: 'Stop' }).hasAttribute('disabled')).toBe(true);
    });
  });

  it('does not open when the hourly rail is clicked or a pointer gesture was dragged', () => {
    const onOpen = vi.fn();
    const { container } = render(<NativeWeather component={weatherComponent} weather={weather} editing={false} onOpen={onOpen}/>);
    fireEvent.click(screen.getByRole('region', { name: 'Hourly forecast' }).firstElementChild!);
    expect(onOpen).not.toHaveBeenCalled();
    vi.stubGlobal('PointerEvent', MouseEvent);
    const article = container.querySelector('article')!;
    fireEvent.pointerDown(article, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(article, { clientX: 60, clientY: 10 });
    fireEvent.click(screen.getByRole('button', { name: /Open Weather forecast/ }));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: /Open Weather forecast/ }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /Open Weather forecast/ }), { detail: 0 });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('pages whole groups of six hours without opening the Weather detail', () => {
    const onOpen = vi.fn();
    const { container } = render(<NativeWeather component={weatherComponent} weather={{
      ...weather, hourlyForecast: Array.from({ length: 14 }, (_, index) => ({
        datetime: `2026-11-12T${String(index).padStart(2, '0')}:00:00Z`, temperature: index, condition: 'cloudy',
      })),
    }} editing={false} onOpen={onOpen}/>);
    const pages = container.querySelectorAll('.native-weather-hour-page');
    expect([...pages].map((page) => page.children.length)).toEqual([6, 6, 2]);
    fireEvent.click(screen.getByRole('button', { name: 'Forecast page 2 of 3' }));
    expect(screen.getByRole('button', { name: 'Forecast page 2 of 3' }).getAttribute('aria-current')).toBe('page');
    expect(onOpen).not.toHaveBeenCalled();
    const rail = screen.getByRole('region', { name: 'Hourly forecast' });
    Object.defineProperty(rail, 'clientWidth', { configurable: true, value: 300 });
    fireEvent.scroll(rail, { target: { scrollLeft: 600 } });
    expect(screen.getByRole('button', { name: 'Forecast page 3 of 3' }).getAttribute('aria-current')).toBe('page');
  });

  it('changes conditions chart and hourly measurements through keyboard-operable segments', () => {
    render(<NativeWeather component={{ ...weatherComponent, props: { presentation: 'detail', conditionsLabel: 'Outlook' } }}
      weather={weather} editing={false} onOpen={vi.fn()}/>);
    expect(screen.getByRole('heading', { name: 'Outlook' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Temperature' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Temperature' }), { key: 'ArrowRight' });
    const precipitation = screen.getByRole('tab', { name: 'Precipitation' });
    expect(document.activeElement).toBe(precipitation);
    expect(precipitation.getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tabpanel')).getByText('80%')).toBeTruthy();
    expect(screen.getByRole('figure').getAttribute('aria-label')).toContain('0 to 100 %');
    fireEvent.keyDown(precipitation, { key: 'End' });
    expect(within(screen.getByRole('tabpanel')).getByText('12 mph')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Wind' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('1012 hPa')).toBeTruthy();
    expect(screen.getByText('74%')).toBeTruthy();
  });

  it('does not invent forecasts, zero readings, units, or a briefing when weather is absent', () => {
    const { container, rerender } = render(<NativeWeather component={weatherComponent} weather={undefined} editing={false} onOpen={vi.fn()}/>);
    expect(screen.getByText('Weather unavailable')).toBeTruthy();
    expect(screen.getByText('No hourly forecast available.')).toBeTruthy();
    expect(container.querySelector('.native-weather-temperature')!.textContent).toBe('--');
    expect(container.textContent).not.toContain('0\u00b0');
    rerender(<NativeWeather component={{ ...weatherComponent, props: { presentation: 'detail' } }}
      weather={{ state: 'unknown', hourlyForecastError: 'Provider has no hourly forecast', dailyForecast: [] }} editing={false} onOpen={vi.fn()}/>);
    expect(screen.getByText('Forecast unavailable: Provider has no hourly forecast')).toBeTruthy();
    expect(screen.getByText('No daily forecast available.')).toBeTruthy();
    expect(screen.getByText('No condition measurements available.')).toBeTruthy();
    expect(screen.getByText('No weather briefing available.')).toBeTruthy();
    expect(screen.queryByRole('figure')).toBeNull();
  });

  it('rounds negative halves like the native WeatherFormat and never supplies a missing temperature unit', () => {
    render(<NativeWeather component={weatherComponent} weather={{ state: 'sunny', temperature: -1.5 }} editing={false} onOpen={vi.fn()}/>);
    expect(screen.getByRole('button', { name: /-1\u00b0/ }).getAttribute('aria-label')).not.toContain('F');
  });
});

describe('native domain control intents', () => {
  it.each([
    ['number', 'number.fixture', { min: 0, max: 10, step: 0.5 }, '0', 'Value', '1.5', 'set_value', { value: 1.5 }],
    ['number', 'input_number.fixture', { min: -10, max: 10, step: 1 }, '0', 'Value', '2', 'set_value', { value: 2 }],
    ['humidifier', 'humidifier.fixture', { humidity: 0, current_humidity: 0, min_humidity: 0, max_humidity: 100 }, 'on', 'Target humidity', '55', 'set_humidity', { humidity: 55 }],
  ] as const)('uses the real safe projection for a %s control at %s', (kind, entityId, attributes, state, name, value, service, data) => {
    const snapshot = nativeHomeSnapshot({ schema: 2, hash: 'a'.repeat(64), config: { home: { entities: [entityId] } } },
      [{ entity_id: entityId, state, attributes }], []);
    const onAction = vi.fn();
    render(<NativeEntityControl component={component(kind, entityId)} entity={{ ...snapshot.states[0] }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getByRole('slider', { name }).hasAttribute('disabled')).toBe(false);
    fireEvent.change(screen.getByRole('slider', { name }), { target: { value } });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: entityId.split('.')[0], service, entityId, data });
  });

  it.each(['switch', 'input_boolean', 'timer'])('shows %s readings through read-only state controls', domain => {
    const onAction = vi.fn();
    const { container } = render(<NativeEntityControl component={component('sensor', `${domain}.fixture`)} entity={{ state: domain === 'timer' ? 'active' : 'on' }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(container.querySelector('.native-control-sensor-value')!.textContent).toBe(domain === 'timer' ? 'active' : 'on');
    expect(screen.queryByText('Unavailable')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps an unpressed input button actionable without making unknown sensors actionable', () => {
    const control = component('sensor', 'input_button.fixture');
    control.title = 'Stop Alarm'; control.action = { type: 'service', domain: 'input_button', entityId: 'input_button.fixture', service: 'press' };
    const onAction = vi.fn();
    const { rerender } = render(<NativeEntityControl component={control} entity={{ state: 'unknown' }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Stop Alarm' }));
    expect(onAction).toHaveBeenCalledWith(control.action);
    rerender(<NativeEntityControl component={control} entity={{ state: 'unavailable' }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getByRole('button', { name: 'Stop Alarm' }).hasAttribute('disabled')).toBe(true);
    rerender(<NativeEntityControl component={component('sensor')} entity={{ state: 'unknown' }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens a configured media remote separately from transport and respects component disabling', () => {
    const control = component('media', 'media_player.fixture');
    control.action = { type: 'modal', modalId: 'remote' };
    const onAction = vi.fn(), onOpen = vi.fn();
    const { rerender } = render(<NativeEntityControl component={control} entity={{ state: 'paused', supportedFeatures: 512 }} editing={false} onAction={onAction} onOpen={onOpen} onSelect={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Open Device remote' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ service: 'media_play' }));
    control.props.disabled = true;
    rerender(<NativeEntityControl component={control} entity={{ state: 'paused', supportedFeatures: 512 }} editing={false} onAction={onAction} onOpen={onOpen} onSelect={vi.fn()}/>);
    for (const button of screen.getAllByRole('button')) expect(button.hasAttribute('disabled')).toBe(true);
  });
  it('clamps a light range and emits only ordinary services, retaining drafts until the relevant live value changes', () => {
    const onAction = vi.fn();
    const control = component('light');
    const entity = { state: 'on', brightness: 128, supportedColorModes: ['brightness'] };
    const { rerender } = render(<NativeEntityControl component={control} entity={entity} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    fireEvent.change(screen.getByRole('slider', { name: 'Brightness' }), { target: { value: '150' } });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'light', service: 'turn_on', entityId: 'light.example', data: { brightness_pct: 100 } });
    rerender(<NativeEntityControl component={control} entity={{ ...entity }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect((screen.getByRole('slider', { name: 'Brightness' }) as HTMLInputElement).value).toBe('100');
    rerender(<NativeEntityControl component={control} entity={{ ...entity, brightness: 51 }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect((screen.getByRole('slider', { name: 'Brightness' }) as HTMLInputElement).value).toBe('20');
    rerender(<NativeEntityControl component={control} entity={{ ...entity }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect((screen.getByRole('slider', { name: 'Brightness' }) as HTMLInputElement).value).toBe('50');
    fireEvent.change(screen.getByRole('slider', { name: 'Brightness' }), { target: { value: '-10' } });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'light', service: 'turn_off', entityId: 'light.example' });
  });

  it('gates brightness/color capabilities, invalid bounds, unknown state and unavailable controls independently', () => {
    const onAction = vi.fn();
    const { rerender } = render(<NativeEntityControl component={component('light')} entity={{ state: 'on', brightness: 128, supportedColorModes: ['onoff'] }}
      editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getByRole('slider').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Turn off' }).hasAttribute('disabled')).toBe(false);
    rerender(<NativeEntityControl component={component('light')} entity={{ state: 'unavailable', brightness: 128, supportedColorModes: ['color_temp'], colorTempKelvin: 3000, minColorTempKelvin: 6500, maxColorTempKelvin: 2000 }}
      editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    for (const control of [...screen.getAllByRole('slider'), ...screen.getAllByRole('button')]) expect(control.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('.native-control-heading [role="status"]')!.textContent).toBe('Unavailable');
    expect(screen.getByText('Color temperature limits unavailable.')).toBeTruthy();
    rerender(<NativeEntityControl component={component('toggle', 'switch.example')} entity={{ state: 'unknown' }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('uses actual select choices and rejects forged or removed options', () => {
    const onAction = vi.fn();
    const control = component('select');
    const { rerender } = render(<NativeEntityControl component={control} entity={{ state: 'eco', options: ['eco', 'comfort'] }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getAllByRole('option').map((item) => item.getAttribute('value'))).toEqual(['eco', 'comfort']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'comfort' } });
    expect(onAction).toHaveBeenCalledWith({ type: 'service', domain: 'select', service: 'select_option', entityId: 'select.example', data: { option: 'comfort' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'forged' } });
    expect(onAction).toHaveBeenCalledTimes(1);
    rerender(<NativeEntityControl component={control} entity={{ state: 'eco', options: ['eco'] }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.queryByRole('option', { name: 'Comfort' })).toBeNull();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('eco');
    rerender(<NativeEntityControl component={control} entity={{ state: 'eco', options: ['eco', 'comfort'] }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('eco');
  });

  it('disables malformed readings and identifiers instead of normalizing them into controllable values', () => {
    const onAction = vi.fn();
    const { rerender } = render(<NativeEntityControl component={component('light')}
      entity={{ state: 'on', brightness: 255.2, supportedColorModes: ['brightness'] }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getByRole('slider').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('Unavailable');
    expect(screen.getByRole('button', { name: 'Turn off' }).hasAttribute('disabled')).toBe(false);
    rerender(<NativeEntityControl component={component('media', 'media_player.example')}
      entity={{ state: 'paused', volumeLevel: 1.004, supportedFeatures: 516 }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getByRole('slider').hasAttribute('disabled')).toBe(true);
    rerender(<NativeEntityControl component={component('light', 'light')}
      entity={{ state: 'on', brightness: 128, supportedColorModes: ['brightness'] }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getByRole('button', { name: 'Power unavailable' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Power unavailable' }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('honors thermostat min/max/step and reported HVAC modes without guessing missing constraints', () => {
    const onAction = vi.fn();
    const control = component('climate');
    const entity = { state: 'heat', temperature: 21.5, currentTemperature: 20, minTemp: 16, maxTemp: 22, targetTempStep: .5, supportedFeatures: 1, hvacModes: ['off', 'heat', 'cool'] };
    const { rerender } = render(<NativeEntityControl component={control} entity={entity} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(document.querySelector('.native-control-dial-current')!.textContent).toBe('20\u00b0');
    expect(screen.getByText('Set to 21.5\u00b0')).toBeTruthy();
    expect(document.querySelector('.native-control-dial-arc')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Increase temperature' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'climate', service: 'set_temperature', entityId: 'climate.example', data: { temperature: 22 } });
    expect(screen.getByRole('button', { name: 'Increase temperature' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Mode' }), { target: { value: 'cool' } });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'climate', service: 'set_hvac_mode', entityId: 'climate.example', data: { hvac_mode: 'cool' } });
    rerender(<NativeEntityControl component={control} entity={{ state: 'heat', temperature: 21, supportedFeatures: 1 }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getByRole('button', { name: 'Decrease temperature' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Increase temperature' }).hasAttribute('disabled')).toBe(true);
  });

  it('respects cover feature flags for position and stop', () => {
    const onAction = vi.fn();
    const control = component('cover');
    const { rerender } = render(<NativeEntityControl component={control} entity={{ state: 'open', currentPosition: 50, supportedFeatures: 7 }}
      editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getByRole('button', { name: 'Stop' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('slider', { name: 'Position' }), { target: { value: '75' } });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'cover', service: 'set_cover_position', entityId: 'cover.example', data: { position: 75 } });
    rerender(<NativeEntityControl component={control} entity={{ state: 'opening', currentPosition: 60, supportedFeatures: 15 }}
      editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'cover', service: 'stop_cover', entityId: 'cover.example' });
  });

  it('uses supported media transport/volume and reconciles playback without creating extra capabilities', () => {
    const onAction = vi.fn();
    const control = component('media', 'media_player.example');
    const { rerender } = render(<NativeEntityControl component={control} entity={{ state: 'playing', supportedFeatures: 517, volumeLevel: .4, mediaTitle: 'A track' }}
      editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'media_player', service: 'media_pause', entityId: 'media_player.example' });
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '80' } });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'media_player', service: 'volume_set', entityId: 'media_player.example', data: { volume_level: .8 } });
    rerender(<NativeEntityControl component={control} entity={{ state: 'paused', supportedFeatures: 1 }}
      editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    expect(screen.getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('slider', { name: 'Volume' }).hasAttribute('disabled')).toBe(true);
  });

  it.each([
    ['fan', 'fan.example', { state: 'on', percentage: 50, percentageStep: 25, supportedFeatures: 1 }, 'Speed', '75', 'set_percentage', { percentage: 75 }],
    ['humidifier', 'humidifier.example', { state: 'on', targetHumidity: 45, minHumidity: 30, maxHumidity: 70 }, 'Target humidity', '55', 'set_humidity', { humidity: 55 }],
    ['number', 'input_number.example', { state: '5', min: 0, max: 10, step: 2 }, 'Value', '7', 'set_value', { value: 8 }],
  ] as const)('emits a bounded %s form intent', (kind, entityId, entity, name, value, service, data) => {
    const onAction = vi.fn();
    render(<NativeEntityControl component={component(kind, entityId)} entity={{ ...entity }} editing={false} onAction={onAction} onSelect={vi.fn()}/>);
    fireEvent.change(screen.getByRole('slider', { name }), { target: { value } });
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: entityId.split('.')[0], service, entityId, data });
  });

  it('gates vacuum services and makes editing select a component instead of sending actions', () => {
    const onAction = vi.fn(), onSelect = vi.fn();
    const control = component('vacuum');
    const { rerender } = render(<NativeEntityControl component={control} entity={{ state: 'cleaning', supportedFeatures: 8212 }} editing={false} onAction={onAction} onSelect={onSelect}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'service', domain: 'vacuum', service: 'return_to_base', entityId: 'vacuum.example' });
    rerender(<NativeEntityControl component={control} entity={{ state: 'cleaning', supportedFeatures: 8212 }} editing onAction={onAction} onSelect={onSelect}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Select Device' }));
    expect(onSelect).toHaveBeenCalledOnce();
    for (const name of ['Start', 'Pause', 'Return']) expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
