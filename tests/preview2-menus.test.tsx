// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import deviceControls from '../src/preview2/fixtures/device-controls.json';
import { deviceHouse, deviceStates } from '../src/preview2/fixtures/device-house';
import { projectDevice } from '../src/preview2/device-state';
import { emptyOverlay, houseFrom, shownEntity } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import { settingLabel } from '../src/preview2/nodes/vacuum';
import type { CompositionDocument } from '../src/shared/composition/schema';

afterEach(cleanup);

const document = deviceControls.document as unknown as CompositionDocument;
function mount(page: string, over: Partial<Preview2Props> = {}) {
  const props: Preview2Props = { document, mode: 'use', surface: { kind: 'page', id: page }, onSurfaceChange: vi.fn(), onSelect: vi.fn(), window: previewWindows[0], bezel: false,
    house: deviceHouse(), overlay: emptyOverlay, onOverlayChange: vi.fn(), ...over };
  return { ...render(<Preview2 {...props}/>), props };
}
const frame = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;
const items = () => screen.getAllByRole('menuitemradio').map(item => item.textContent);

// H5g and H8: Mode, Fan and Water on the vacuum sheet, and the thermostat hub, were drawn as plain text with no menu behind them.
// Native: UKVacuumComponents.swift:176-206 (`showsMenuAsPrimaryAction`, a `UIMenu` of the select's `options` with the current one on),
// UKClimateParts.swift:72-115 (the hub's two menus), UKLightingModeButton.swift:62-79 (the lighting mode menu).
describe('pull-down menus in Use', () => {
  it('opens the vacuum Mode row to the select\'s options with the current one checked, and a pick shows in the row', () => {
    const calls: string[] = [], overlays = vi.fn();
    const { container } = mount('page-vacuum', { onSimulatedCall: summary => calls.push(summary), onOverlayChange: overlays });
    const row = within(frame(container, 'vac-settings')).getByRole('button', { name: 'Mode' });
    expect(row.textContent).toContain('Vacuum and Mop');
    expect(row.getAttribute('aria-haspopup')).toBe('menu');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(items()).toEqual(['Vacuum', 'Mop', 'Vacuum and Mop']);
    expect(screen.getByRole('menuitemradio', { name: 'Vacuum and Mop' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Mop' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(row.textContent).toContain('Mop');
    expect(row.textContent).not.toContain('Vacuum');
    expect(calls, 'a note for the Checks pill, never a service').toEqual(['Mode: Mop']);
    expect(overlays, 'the house is untouched').not.toHaveBeenCalled();
  });

  it('opens Fan, Water and Passes with their own options', () => {
    const { container } = mount('page-vacuum');
    const settings = frame(container, 'vac-settings');
    for (const [title, shown] of [['Fan', ['Quiet', 'Balanced', 'Turbo', 'Max']], ['Water', ['Low', 'Medium', 'High']], ['Passes', ['1x', '2x', '3x']]] as const) {
      fireEvent.click(within(settings).getByRole('button', { name: title }));
      expect(items(), title).toEqual([...shown]);
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      expect(screen.queryByRole('menu'), `${title} closes on Esc`).toBeNull();
    }
  });

  it('closes on a press outside without a pick', () => {
    const { container } = mount('page-vacuum');
    const row = within(frame(container, 'vac-settings')).getByRole('button', { name: 'Fan' });
    fireEvent.click(row);
    fireEvent.click(container.querySelector('.sh-menu-scrim')!);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(row.textContent).toContain('Max');
  });

  it('keeps a pick for every node of the same source and clears it on the way back to Edit', () => {
    const view = mount('page-vacuum');
    fireEvent.click(within(frame(view.container, 'vac-settings')).getByRole('button', { name: 'Water' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }));
    view.rerender(<Preview2 {...view.props} mode="edit"/>);
    expect(frame(view.container, 'vac-settings').textContent).toContain('Medium');
  });

  it('shows a value the select does not list first, and disables a row whose select has no options', () => {
    const odd = houseFrom({ states: deviceStates.map(state => state.entityId === 'select.demo_robot_water' ? { ...state, state: 'custom', options: ['low'] }
      : state.entityId === 'select.demo_robot_fan' ? { ...state, options: undefined } : state) });
    const { container } = mount('page-vacuum', { house: odd });
    const settings = frame(container, 'vac-settings');
    fireEvent.click(within(settings).getByRole('button', { name: 'Water' }));
    expect(items()).toEqual(['Custom', 'Low']);
    expect((within(settings).getByRole('button', { name: 'Fan' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the thermostat hub\'s Mode and Fan menus and picks into the simulated state', () => {
    const calls: string[] = [];
    const { container } = mount('page-climate', { onSimulatedCall: summary => calls.push(summary) });
    const hub = frame(container, 'cl-hub');
    fireEvent.click(within(hub).getByRole('button', { name: 'Mode' }));
    expect(screen.getByRole('menuitemradio', { name: 'Heat' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Cool' }));
    expect(hub.textContent).toContain('Cool');
    fireEvent.click(within(hub).getByRole('button', { name: 'Fan' }));
    expect(screen.getByRole('menuitemradio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('true');
    const other = screen.getAllByRole('menuitemradio').find(item => item.getAttribute('aria-checked') === 'false')!;
    fireEvent.click(other);
    expect(hub.textContent).toContain(other.textContent!);
    expect(calls.length, 'each pick is a simulated call, never a service').toBeGreaterThan(0);
  });

  it('opens the lighting mode row to the modes and picks one', () => {
    const { container } = mount('page-lights');
    const row = within(frame(container, 'lt-mode')).getByRole('button', { name: 'Lighting Mode' });
    fireEvent.click(row);
    expect(items()).toEqual(['Warm White', 'Holiday', 'Custom']);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Custom' }));
    expect(row.textContent).toContain('Custom');
  });

  it('opens nothing in Edit, where a press selects the node', () => {
    const { container } = mount('page-vacuum', { mode: 'edit' });
    fireEvent.click(within(frame(container, 'vac-settings')).getByRole('button', { name: 'Fan' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when the mode goes back to Edit', () => {
    const view = mount('page-vacuum');
    fireEvent.click(within(frame(view.container, 'vac-settings')).getByRole('button', { name: 'Fan' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    view.rerender(<Preview2 {...view.props} mode="edit"/>);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves between the options with the arrow keys', () => {
    const { container } = mount('page-vacuum');
    fireEvent.click(within(frame(container, 'vac-settings')).getByRole('button', { name: 'Fan' }));
    const menu = screen.getByRole('menu');
    const first = screen.getAllByRole('menuitemradio')[0];
    first.focus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(globalThis.document.activeElement).toBe(screen.getAllByRole('menuitemradio')[1]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(globalThis.document.activeElement).toBe(screen.getAllByRole('menuitemradio').at(-1));
  });
});

describe('the vacuum option labels', () => {
  it('spell the cleaning mode in words, passes as a count and anything else title-cased', () => {
    expect(settingLabel('mode', 'vacuum_and_mop')).toBe('Vacuum and Mop');
    expect(settingLabel('mode', 'Vacuum And Mop')).toBe('Vacuum and Mop');
    expect(settingLabel('mode', 'mop')).toBe('Mop');
    expect(settingLabel('mode', 'deep_clean')).toBe('Deep Clean');
    expect(settingLabel('passes', '2')).toBe('2x');
    expect(settingLabel('passes', 'auto')).toBe('Auto');
    expect(settingLabel('fan', 'turbo_plus')).toBe('Turbo Plus');
  });
  it('are projected from the selects\' options, and absent when a select lists none', () => {
    const sources = new Map(document.dataSources.map(item => [item.id, item]));
    const house = deviceHouse();
    const fields = projectDevice(sources.get('demo-vacuum')!, sources, id => id ? shownEntity(house, emptyOverlay, id) : undefined, true)!.fields;
    expect(fields).toMatchObject({ modeOptions: ['vacuum', 'mop', 'vacuum_and_mop'], fanOptions: ['quiet', 'balanced', 'turbo', 'max'], waterOptions: ['low', 'medium', 'high'], passesOptions: ['1', '2', '3'] });
  });
});
