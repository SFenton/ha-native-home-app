// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { endOf } from '../src/workspace2/add/insert';
import AddPicker from '../src/workspace2/add/AddPicker';
import { WorkspaceDataProvider } from '../src/workspace2/pickers/WorkspaceData';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request }));

afterEach(cleanup);
beforeEach(() => {
  request.mockReset(); window.localStorage.clear();
  // jsdom lays nothing out; the virtual list needs a viewport to draw rows in.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 320 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 360 });
});
const home = homeDomains.document as unknown as CompositionDocument;
const house = { states: new Map([
  ['lock.demo_front', { entityId: 'lock.demo_front', name: 'Front door', state: 'locked' }],
  ['binary_sensor.demo_motion', { entityId: 'binary_sensor.demo_motion', name: 'Motion', state: 'off' }],
]) } as never;

/** The picker, drawn against a house, with the choices it reports. */
function mount() {
  const chosen: { type: string; made: { node: { binding: Record<string, unknown> }; stateStyles?: { name: string }[] } }[] = [];
  render(<WorkspaceDataProvider document={home} house={house}>
    <AddPicker document={home} destination={endOf(home, 'page:page-home')!} onChoose={choice => chosen.push(choice as never)} onClose={() => {}}/></WorkspaceDataProvider>);
  return chosen;
}
const toEntities = async () => {
  fireEvent.click(window.document.querySelector('[data-type="tile"]')!);
  fireEvent.click(await screen.findByText('Show a Device’s State'));
};

describe('Add picker: Show a Device’s State', () => {
  it('sits in "What should this tile do?" with its sentence, and is found by searching for a lock', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tiles and entities' }), { target: { value: 'sensor' } });
    expect(window.document.querySelector('[data-type="tile"]')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tiles and entities' }), { target: { value: 'zzz' } });
    expect(window.document.querySelector('[data-type="tile"]')).toBeNull();
  });

  it('picks an entity of a styled domain and adds the tile with its built-in style', async () => {
    const chosen = mount();
    await toEntities();
    expect(await screen.findByText('Choose an entity for the State tile.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('option', { name: /Front door/ }));
    expect(chosen).toHaveLength(1);
    expect(chosen[0].made.node.binding).toMatchObject({ entityId: 'lock.demo_front', builtIn: 'lock' });
  });

  it('says no style fits a sensor with no device class, and makes one from the entity’s states', async () => {
    request.mockResolvedValue({ entityId: 'binary_sensor.demo_motion', states: [{ state: 'on' }, { state: 'off' }], history: ['on', 'off', 'detected'], openEnded: false });
    const chosen = mount();
    await toEntities();
    fireEvent.click(await screen.findByRole('option', { name: /Motion/ }));
    expect(await screen.findByText('No style fits this entity yet.')).toBeTruthy();
    expect(chosen).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New Style From This Entity…' })); });
    await waitFor(() => expect(chosen).toHaveLength(1));
    expect(request).toHaveBeenCalledWith('/native/api/ha/entity-states?entityId=binary_sensor.demo_motion');
    expect(chosen[0].made.stateStyles?.[0].name).toBe('Motion states');
    expect(chosen[0].made.node.binding.styleId).toBeTruthy();
  });
});
