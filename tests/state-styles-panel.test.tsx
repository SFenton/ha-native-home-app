// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import StateStyles from '../src/StateStyles';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument } from '../src/shared/composition/schema';

function fixture(): CompositionDocument {
  const document = JSON.parse(readFileSync(resolve('tests/fixtures/composition-first-slice.json'), 'utf8')).document as CompositionDocument;
  document.pages[2].components = [{
    id: 'demo-tile', title: 'Vacuum', type: 'state-tile', layout: { span: 1 },
    icon: { type: 'sf-symbol', name: 'fan', rendering: 'canonical', unavailable: 'fallback' }, props: {},
    binding: { entityId: 'vacuum.demo_robot', builtIn: 'robot' },
  }];
  return document;
}
const entities = [
  { entityId: 'lock.demo_front', name: 'Front door', state: 'locked' },
  { entityId: 'vacuum.demo_robot', name: 'Robot', state: 'docked' },
  { entityId: 'binary_sensor.demo_smoke', name: 'Hall smoke', state: 'off' },
  { entityId: 'sensor.demo_level', name: 'Level', state: '21' },
];
function stubFetch(extra: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = {
    '/native/api/ha/entities': entities,
    '/native/api/ha/entity-states?entityId=lock.demo_front': { entityId: 'lock.demo_front', states: [{ state: 'locked', name: 'Locked' }, { state: 'open', name: 'Open' }], history: ['jammed'], openEnded: false },
    '/native/api/ha/entity-states?entityId=binary_sensor.demo_smoke': { entityId: 'binary_sensor.demo_smoke', deviceClass: 'smoke', states: [], history: [], openEnded: true },
    '/native/api/ha/entity-states?entityId=vacuum.demo_robot': { entityId: 'vacuum.demo_robot', states: [], history: [], openEnded: false },
    '/native/api/ha/entity-states?entityId=sensor.demo_level': { entityId: 'sensor.demo_level', states: [], history: [], openEnded: true },
    '/native/api/ha/exists?id=script.demo_known': { exists: true },
    '/native/api/ha/exists?id=timer.demo_gone': { exists: false },
    ...extra,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const key = String(input).replace(/^\./, '');
    if (!(key in answers)) return new Response(JSON.stringify({ error: 'nope' }), { status: 404 });
    return new Response(JSON.stringify(answers[key]), { status: 200 });
  }));
}
/** Hosts the panel with real state so edits flow back through `onChange`. */
function Host({ start, onDocument }: { start: CompositionDocument; onDocument: (next: CompositionDocument) => void }) {
  const [document, setDocument] = useState(start);
  return <StateStyles document={document} onChange={next => { setDocument(next); onDocument(next); }}/>;
}
let latest: CompositionDocument;
const mount = (start = fixture()) => { latest = start; return render(<Host start={start} onDocument={next => { latest = next; }}/>); };
beforeEach(() => stubFetch());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Styles section', () => {
  it('lists the eight built-ins as read-only with Duplicate only', () => {
    mount();
    const library = screen.getByRole('region', { name: 'Style library' });
    expect(within(library).getAllByRole('listitem')).toHaveLength(8);
    expect(within(library).queryByText(/^Delete /)).toBeNull();
    expect(screen.getAllByText(/Built-in styles are read-only/).length).toBeGreaterThan(0);
    const classes = screen.getAllByLabelText(/^Class for /) as HTMLSelectElement[];
    expect(classes.length).toBeGreaterThan(2);
    expect(classes.every(select => select.disabled)).toBe(true);
  });
  it('duplicates a built-in into a saved style that compiles, with its base remembered', () => {
    mount();
    fireEvent.click(screen.getByText('Duplicate Robot'));
    expect(latest.stateStyles?.styles).toHaveLength(1);
    expect(latest.stateStyles?.styles[0]).toMatchObject({ name: 'Robot copy', base: 'robot', domain: 'vacuum' });
    expect(() => compileCompositionDocument(latest)).not.toThrow();
    expect(screen.getByText('Saved')).toBeTruthy();
  });
  it('edits a saved style: class, indicator, and the arc menu refuses a state with an action', () => {
    mount();
    fireEvent.click(screen.getByText('Duplicate Lock'));
    const menu = screen.getByLabelText('Indicator for locked') as HTMLSelectElement;
    const arc = [...menu.options].find(option => option.value === 'arc-spinner')!;
    expect(arc.disabled).toBe(true);
    expect(arc.textContent).toContain('No arc while this state has an action');
    const breathe = [...menu.options].find(option => option.value === 'breathe')!;
    expect(breathe.textContent).toContain('iOS 17 plays Pulse');
    expect([...menu.options].find(option => option.value === 'wiggle')!.textContent).toContain('iOS 17 plays Bounce');
    fireEvent.change(menu, { target: { value: 'pulse' } });
    expect(latest.stateStyles?.styles[0].rules[0].indicator).toBe('pulse');
    // A state with no action offers the arc.
    fireEvent.click(screen.getByText('Duplicate Robot'));
    expect(([...(screen.getByLabelText('Indicator for returning') as HTMLSelectElement).options].find(option => option.value === 'arc-spinner'))!.disabled).toBe(false);
  });
  it('offers Unlit and Lit for a colour, and disables the menu on a warning, error or unknown state', () => {
    mount();
    fireEvent.click(screen.getByText('Duplicate Robot'));
    const returning = screen.getByLabelText('Colour for returning') as HTMLSelectElement;
    expect([...returning.options].map(option => option.textContent)).toEqual(['The class face', 'Unlit', 'Lit']);
    expect(returning.disabled).toBe(false);
    fireEvent.change(returning, { target: { value: 'lit' } });
    expect(latest.stateStyles?.styles[0].rules.find(rule => rule.states.includes('returning'))?.colour).toBe('lit');
    for (const state of ['paused', 'error']) expect((screen.getByLabelText(`Colour for ${state}`) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getAllByText('Colour follows the class').length).toBeGreaterThan(0);
  });
  it('renames a saved style when the field is left, keeping its label stable while typing', () => {
    mount();
    fireEvent.click(screen.getByText('Duplicate Switch'));
    fireEvent.click(screen.getByText('Rename Switch copy'));
    const field = screen.getByLabelText('New name for Switch copy');
    fireEvent.change(field, { target: { value: 'Plug' } });
    expect(screen.getByLabelText('New name for Switch copy')).toBe(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(latest.stateStyles?.styles[0].name).toBe('Plug');
    expect(screen.getByText('Delete Plug')).toBeTruthy();
  });
  it('fixes the unavailable rule at the unknown class', () => {
    mount();
    fireEvent.click(screen.getByText('Duplicate Switch'));
    expect((screen.getByLabelText('Class for unavailable, unknown') as HTMLSelectElement).disabled).toBe(true);
  });
  it('blocks Delete while a tile uses the style and shows Used by N tiles', () => {
    const start = fixture();
    mount(start);
    fireEvent.click(screen.getByText('Duplicate Robot'));
    const id = latest.stateStyles!.styles[0].id;
    // Point the tile at the saved style through its own binding editor.
    fireEvent.change(screen.getByLabelText('Style for demo-tile'), { target: { value: `saved:${id}` } });
    expect(screen.getByText('Used by 1 tile')).toBeTruthy();
    expect(screen.getByText(/This changes 1 tile\./)).toBeTruthy();
    const remove = screen.getByText('Delete Robot copy');
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(remove);
    expect(latest.stateStyles?.styles).toHaveLength(1);
    expect(screen.getAllByText(/Used by 1 tile\. Point them at another style first\./).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Style for demo-tile'), { target: { value: 'built:robot' } });
    fireEvent.click(screen.getByText('Delete Robot copy'));
    expect(latest.stateStyles?.styles).toHaveLength(0);
  });
  it('overrides a layer on a tile, resets it, and saves a new style', () => {
    mount();
    fireEvent.change(screen.getByLabelText('State to override on demo-tile'), { target: { value: 'cleaning' } });
    fireEvent.change(screen.getByLabelText('Words override for cleaning'), { target: { value: 'Vacuuming' } });
    const tile = () => (latest.pages[2].components[0] as Extract<CompositionDocument['pages'][number]['components'][number], { type: 'state-tile' }>);
    expect(tile().binding.overrides).toEqual([{ state: 'cleaning', text: 'Vacuuming' }]);
    expect(screen.getByLabelText(/Words override for cleaning \(overridden\)/)).toBeTruthy();
    fireEvent.click(screen.getByText('Reset cleaning to the style'));
    expect(tile().binding.overrides).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Words override for cleaning'), { target: { value: 'Vacuuming' } });
    fireEvent.change(screen.getByLabelText('Name for a new style from demo-tile'), { target: { value: 'My robot' } });
    fireEvent.click(screen.getByText('Save as New Style'));
    expect(latest.stateStyles?.styles[0]).toMatchObject({ name: 'My robot', base: 'robot' });
    expect(tile().binding).toMatchObject({ styleId: latest.stateStyles!.styles[0].id });
    expect(tile().binding.overrides).toBeUndefined();
    expect(() => compileCompositionDocument(latest)).not.toThrow();
  });
  it('shows the request phase, and warns when the script or timer is missing, installing nothing', async () => {
    mount();
    fireEvent.click(screen.getByText('Duplicate Robot'));
    fireEvent.click(screen.getByText('Add a request phase'));
    fireEvent.change(screen.getByLabelText('Script'), { target: { value: 'script.demo_known' } });
    expect(screen.getByRole('alert').textContent).toContain('together, or neither');
    fireEvent.change(screen.getByLabelText('Error timer'), { target: { value: 'timer.demo_gone' } });
    fireEvent.click(screen.getByText('Check script.demo_known'));
    expect((await screen.findByText(/script.demo_known exists in Home Assistant/))).toBeTruthy();
    fireEvent.click(screen.getByText('Check timer.demo_gone'));
    expect((await screen.findByText(/timer.demo_gone does not exist in Home Assistant/)).textContent).toContain('installs nothing');
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(([, init]) => !init || (init as RequestInit).method === undefined || (init as RequestInit).method === 'GET')).toBe(true);
  });
  it('picks a live entity, fills the map from its states and lists history states as unclassified', async () => {
    mount();
    fireEvent.click(await screen.findByText('Front door'));
    expect(await screen.findByText(/Filled a state map from Front door/)).toBeTruthy();
    const style = latest.stateStyles!.styles.at(-1)!;
    expect(style.domain).toBe('lock');
    expect(style.rules.map(rule => rule.states[0])).toEqual(['locked', 'open', 'jammed', 'unavailable']);
    expect(style.rules.find(rule => rule.states.includes('open'))!.class).toBe('warning');
    expect(style.fallback.class).toBe('unknown');
    expect(await screen.findByText(/Unclassified: jammed/)).toBeTruthy();
    expect(() => compileCompositionDocument(latest)).not.toThrow();
  });
  it('previews at iPhone, Duo and iPad widths and speaks dimmed while the arc shows', () => {
    mount();
    fireEvent.click(screen.getByText('Duplicate Robot'));
    fireEvent.change(screen.getAllByLabelText('Preview state')[0], { target: { value: 'returning' } });
    const preview = screen.getAllByRole('region', { name: 'Tile preview' })[0];
    expect(within(preview).getAllByRole('figure').map(item => item.getAttribute('data-preview-width'))).toEqual(['iphone', 'duo', 'ipad']);
    expect(within(preview).getAllByTestId('preview-voiceover').map(item => item.textContent)).toEqual(Array(3).fill('Returning, in progress, dimmed'));
    expect((within(preview).getAllByTestId('preview-arc')[0] as HTMLElement).style.opacity).toBe('1');
    expect((within(preview).getAllByTestId('preview-disc')[0] as HTMLElement).style.transition).toContain('0.2s');
  });
  it('adds a state tile from the entity picker with the built-in style its domain and device class suggest', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a state tile' }));
    fireEvent.change(screen.getByLabelText('Page for the new tile'), { target: { value: 'page-lattice' } });
    fireEvent.click(await within(await screen.findByRole('region', { name: 'New tile entity' })).findByText('Hall smoke'));
    expect(await screen.findByText(/Added a state tile for Hall smoke to Shelf, with the Detector built-in style/)).toBeTruthy();
    const added = latest.pages[1].components.at(-1)!;
    expect(added).toMatchObject({ type: 'state-tile', title: 'Hall smoke', binding: { entityId: 'binary_sensor.demo_smoke', builtIn: 'detector' } });
    expect(latest.pages[2].components).toHaveLength(1);
    expect(screen.getByRole('article', { name: `Tile ${added.id}` })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'New tile entity' })).toBeNull();
    expect(() => compileCompositionDocument(latest)).not.toThrow();
  });
  it('adds no tile for an entity no style fits, and says so', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a state tile' }));
    fireEvent.click(await within(await screen.findByRole('region', { name: 'New tile entity' })).findByText('Level'));
    expect(await screen.findByText(/No built-in style fits Level/)).toBeTruthy();
    expect(latest.pages[0].components).toEqual(fixture().pages[0].components);
  });
});
