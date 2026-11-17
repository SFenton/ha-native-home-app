import { describe, expect, it } from 'vitest';
import type { NativeState } from '../src/shared/native-state';
import {
  airMetric, airQualityChipSummary, airQualityColor, airSummary, cardState, cardSubtitle, climateSubtitle, climateText, colorFromCss, compact, contact, contactChipState,
  contactSummary, contactTileSubtitle, detailSubtitle, isActive, normalizedRange, occupancy, overviewActive, titleCase, ventSubtitle, withUnit, type Group, type Read,
} from '../src/preview2/room-overview';

const e = (entityId: string, state: string, rest: Partial<NativeState> = {}): NativeState => ({ entityId, state, name: entityId, ...rest });
const reader = (...states: NativeState[]): Read => id => states.find(item => item.entityId === id && !['unavailable', 'unknown'].includes(item.state));
const item = (entityId: string, title = '', contactCount = 1, contactKind?: 'door' | 'window') => ({ entityId, title, contactCount, contactKind });

/** Each function mirrors one of `RoomOverview`, `RoomFormat`, `ClimateLogic` and `ChipWebColor` in HassCore. */
describe('RoomFormat', () => {
  it('words a state by its domain', () => {
    expect(compact(undefined)).toBe('Unavailable');
    expect(compact(e('light.demo_a', 'on'))).toBe('On');
    expect(compact(e('light.demo_a', 'off'))).toBe('Off');
    expect(compact(e('binary_sensor.contact_demo_a', 'on'))).toBe('Open');
    expect(compact(e('binary_sensor.contact_demo_a', 'off'))).toBe('Closed');
    expect(compact(e('binary_sensor.demo_motion', 'on'))).toBe('Active');
    expect(compact(e('binary_sensor.demo_motion', 'off'))).toBe('Clear');
    expect(compact(e('cover.demo_vent', 'unavailable'))).toBe('Unavailable');
    expect(compact(e('select.demo_mode', 'not_home'))).toBe('Not Home');
    expect(titleCase('heat_cool')).toBe('Heat Cool');
  });
  it('words occupancy and contacts, and leaves Open and Closed off a contact tile', () => {
    expect(occupancy(e('binary_sensor.demo_a', 'on'))).toBe('Detected');
    expect(occupancy(e('binary_sensor.demo_a', 'not_occupied'))).toBe('Clear');
    expect(occupancy(e('binary_sensor.demo_a', 'unknown'))).toBe('Unknown');
    expect(contact(e('binary_sensor.demo_a', 'open'))).toBe('Open');
    expect(contact(e('binary_sensor.demo_a', 'off'))).toBe('Closed');
    expect(contactTileSubtitle(e('binary_sensor.demo_a', 'on'))).toBe('');
    expect(contactTileSubtitle(e('binary_sensor.demo_a', 'off'))).toBe('');
    expect(contactTileSubtitle(e('binary_sensor.demo_a', 'unavailable'))).toBe('Unavailable');
    expect(contactTileSubtitle(e('binary_sensor.demo_a', 'unknown'))).toBe('Unknown');
    expect(contactTileSubtitle(undefined)).toBe('Unavailable');
  });
  it('knows an active state, an alarm panel being active unless disarmed', () => {
    expect(isActive(e('light.demo_a', 'on'))).toBe(true);
    expect(isActive(e('climate.demo_a', 'heat'))).toBe(true);
    expect(isActive(e('light.demo_a', 'off'))).toBe(false);
    expect(isActive(e('alarm_control_panel.demo_a', 'armed_away'))).toBe(true);
    expect(isActive(e('alarm_control_panel.demo_a', 'disarmed'))).toBe(false);
    expect(isActive(undefined)).toBe(false);
  });
  it('adds a unit once, and takes a configured label before the compact state', () => {
    expect(withUnit(e('sensor.demo_humidity', '45', { unit: '%' }))).toBe('45%');
    expect(withUnit(e('sensor.demo_humidity', '45%', { unit: '%' }))).toBe('45%');
    expect(withUnit(e('sensor.demo_humidity', 'unavailable', { unit: '%' }))).toBe('Unavailable');
    expect(cardState([{ state: 'on', label: 'Running' }], e('switch.demo_a', 'on'))).toBe('Running');
    expect(cardState([], e('light.demo_a', 'on'))).toBe('On');
    expect(cardState([], undefined)).toBe('Unavailable');
  });
  it('words a vent with its position while it is open', () => {
    expect(ventSubtitle(e('cover.demo_v', 'open', { currentPosition: 60 }))).toBe('Open · 60%');
    expect(ventSubtitle(e('cover.demo_v', 'opening', { currentPosition: 59.6 }))).toBe('Opening · 60%');
    expect(ventSubtitle(e('cover.demo_v', 'open'))).toBe('Open');
    expect(ventSubtitle(e('cover.demo_v', 'closed', { currentPosition: 0 }))).toBe('Closed');
    expect(ventSubtitle(undefined)).toBe('Unavailable');
  });
});

describe('air quality', () => {
  const aqi = e('sensor.demo_aqi', '42'), pm = e('sensor.demo_pm25', '9.5', { unit: 'µg/m³' });
  it('words a metric with its unit, and the pair as "AQI • PM2.5"', () => {
    expect(airMetric(pm)).toBe('9.5 µg/m³');
    expect(airMetric(e('sensor.demo_x', '12.0'))).toBe('12');
    expect(airMetric(e('sensor.demo_x', '7', { unit: '%' }))).toBe('7 %');
    expect(airSummary(aqi, pm)).toBe('42 • 9.5 µg/m³');
    expect(airSummary(undefined, e('sensor.demo_pm25', 'unavailable'))).toBe('Unavailable');
    expect(airSummary(aqi, undefined)).toBe('42 • Unavailable');
  });
  it('words the chip summary as "AQI 12 · PM2.5 3.1"', () => {
    expect(airQualityChipSummary(e('sensor.demo_aqi', '12'), e('sensor.demo_pm25', '3.1'))).toBe('AQI 12 · PM2.5 3.1');
  });
  it('reads the helper colour in its three spellings and falls back to the web teal', () => {
    expect(colorFromCss('rgb(220, 120, 30)')).toEqual({ red: 220, green: 120, blue: 30 });
    expect(colorFromCss('rgba(1, 2, 3, 0.5)')).toEqual({ red: 1, green: 2, blue: 3 });
    expect(colorFromCss('#FF8000')).toEqual({ red: 255, green: 128, blue: 0 });
    expect(colorFromCss('teal')).toBeUndefined();
    expect(airQualityColor(undefined)).toEqual({ red: 0, green: 150, blue: 136 });
    expect(airQualityColor('#102030')).toEqual({ red: 16, green: 32, blue: 48 });
  });
});

describe('lights overview', () => {
  const lights = (...ids: string[]): Group => ({ items: ids.map(id => item(id)) });
  it('says "On" for one light, "N On" for several, else the group light or "Off"', () => {
    const read = reader(e('light.demo_a', 'on'), e('light.demo_b', 'on'), e('light.demo_c', 'off'));
    expect(cardSubtitle('lights', lights('light.demo_a'), read)).toBe('On');
    expect(cardSubtitle('lights', lights('light.demo_a', 'light.demo_b', 'light.demo_c'), read)).toBe('2 On');
    expect(cardSubtitle('lights', lights('light.demo_c'), read)).toBe('Off');
    expect(cardSubtitle('lights', { entityId: 'light.demo_group', items: [item('light.demo_c')] }, reader(e('light.demo_c', 'off'), e('light.demo_group', 'off')))).toBe('Off');
    expect(cardSubtitle('lights', { entityId: 'light.demo_group', items: [item('light.demo_c')] }, reader(e('light.demo_c', 'off')))).toBe('Off');
  });
  it('is active while its group light is on or any of its lights is', () => {
    expect(overviewActive('lights', { entityId: 'light.demo_group', items: [item('light.demo_c')] }, reader(e('light.demo_group', 'on'), e('light.demo_c', 'off')))).toBe(true);
    expect(overviewActive('lights', lights('light.demo_c'), reader(e('light.demo_c', 'off')))).toBe(false);
    expect(overviewActive('lights', lights('light.demo_a'), reader(e('light.demo_a', 'on')))).toBe(true);
  });
});

describe('occupancy and contact overviews', () => {
  const sensors: Group = { items: [item('binary_sensor.demo_a'), item('binary_sensor.demo_b')] };
  it('says Occupied or Not Occupied, and counts the occupied sensors on the detail page', () => {
    const busy = reader(e('binary_sensor.demo_a', 'on'), e('binary_sensor.demo_b', 'off')), quiet = reader(e('binary_sensor.demo_a', 'off'), e('binary_sensor.demo_b', 'off'));
    expect(cardSubtitle('occupancy', sensors, busy)).toBe('Occupied');
    expect(cardSubtitle('occupancy', sensors, quiet)).toBe('Not Occupied');
    expect(detailSubtitle('occupancy', sensors, busy)).toBe('1 sensor occupied');
    expect(detailSubtitle('occupancy', sensors, quiet)).toBe('0 sensors occupied');
    expect(detailSubtitle('lights', { items: [item('light.demo_a')] }, reader(e('light.demo_a', 'on')))).toBe('On');
    expect(overviewActive('occupancy', sensors, busy)).toBe(true);
    expect(overviewActive('occupancy', sensors, quiet)).toBe(false);
  });
  it('summarises doors and windows the way the app does', () => {
    const one: Group = { items: [item('binary_sensor.demo_d', 'Front Door', 1, 'door')] };
    expect(contactSummary(one, reader(e('binary_sensor.demo_d', 'on')))).toBe('Door Open');
    expect(contactSummary(one, reader(e('binary_sensor.demo_d', 'off')))).toBe('Door Closed');
    const doors: Group = { items: [item('binary_sensor.demo_d1', 'A', 1, 'door'), item('binary_sensor.demo_d2', 'B', 1, 'door'), item('binary_sensor.demo_d3', 'C', 1, 'door')] };
    expect(contactSummary(doors, reader(e('binary_sensor.demo_d1', 'off'), e('binary_sensor.demo_d2', 'off'), e('binary_sensor.demo_d3', 'off')))).toBe('All Doors Closed');
    expect(contactSummary(doors, reader(e('binary_sensor.demo_d1', 'on'), e('binary_sensor.demo_d2', 'off'), e('binary_sensor.demo_d3', 'off')))).toBe('1 Door Open');
    expect(contactSummary(doors, reader(e('binary_sensor.demo_d1', 'on'), e('binary_sensor.demo_d2', 'on'), e('binary_sensor.demo_d3', 'on')))).toBe('All Doors Open');
    const mixed: Group = { items: [item('binary_sensor.demo_w', 'Study', 2, 'window'), item('binary_sensor.demo_d', 'Hall', 1, 'door')] };
    expect(contactSummary(mixed, reader(e('binary_sensor.demo_w', 'on'), e('binary_sensor.demo_d', 'on')))).toBe('1 Window Open, Door Open');
    expect(contactSummary(mixed, reader(e('binary_sensor.demo_w', 'off'), e('binary_sensor.demo_d', 'off')))).toBe('All Closed');
    // A kind that is not authored comes from the title and the entity id.
    expect(contactSummary({ items: [item('binary_sensor.demo_window_a', 'Study')] }, reader(e('binary_sensor.demo_window_a', 'on')))).toBe('Window Open');
  });
  it('says which of the four contact chip states the house is in, the alarm first', () => {
    expect(contactChipState(false, 'armed_away', true)).toBe('idle');
    expect(contactChipState(true, 'armed_home', false)).toBe('open-armed');
    expect(contactChipState(true, 'triggered', false)).toBe('open-armed');
    expect(contactChipState(true, 'disarmed', true)).toBe('open-away');
    expect(contactChipState(true, 'arming', false)).toBe('open-home');
    expect(contactChipState(true, undefined, false)).toBe('open-home');
  });
});

describe('climate overview', () => {
  it('cuts each number of a range to one decimal, never rounding up', () => {
    expect(normalizedRange('70.04°F - 72.99°F')).toBe('70.0°F - 72.9°F');
    expect(normalizedRange('68 - 74')).toBe('68.0 - 74.0');
    expect(normalizedRange('unavailable')).toBeUndefined();
    expect(normalizedRange('')).toBeUndefined();
    expect(normalizedRange(undefined)).toBeUndefined();
  });
  it('says the range helper, else the least and greatest sensor, else the sensor count', () => {
    const a = e('sensor.demo_a', '70.24', { unit: '°F' }), b = e('sensor.demo_b', '72.18', { unit: '°F' });
    const group: Group = { items: [item('sensor.demo_a'), item('sensor.demo_b')] };
    expect(climateSubtitle(group, reader(a, b))).toBe('70.2°F - 72.1°F');
    expect(climateSubtitle({ ...group, entityId: 'input_text.demo_range' }, reader(a, b, e('input_text.demo_range', '69.55°F - 73.5°F')))).toBe('69.5°F - 73.5°F');
    expect(climateSubtitle({ ...group, entityId: 'input_text.demo_range' }, reader(a, b, e('input_text.demo_range', 'unknown')))).toBe('70.2°F - 72.1°F');
    expect(climateSubtitle({ items: [item('sensor.demo_a')] }, reader(a))).toBe('70.2°F');
    expect(climateSubtitle(group, reader())).toBe('2 sensors');
    expect(climateSubtitle({ items: [item('sensor.demo_a')] }, reader())).toBe('1 sensor');
  });
  it('words a tile by what it is: a vent with its position, a sensor to one decimal, else the compact state', () => {
    expect(climateText(e('cover.demo_v', 'open', { currentPosition: 50 }))).toBe('Open · 50%');
    expect(climateText(e('sensor.demo_a', '71.26', { unit: '°F' }))).toBe('71.2°F');
    expect(climateText(e('light.demo_a', 'on'))).toBe('On');
    expect(climateText(undefined)).toBe('Unavailable');
  });
});
