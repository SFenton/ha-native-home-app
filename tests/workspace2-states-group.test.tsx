// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { StatePreview } from '../src/preview2/render-context';
import { addStateTile, newStateTile, type StateTileNode } from '../src/shared/composition/state-style-library';
import { builtInStyle } from '../src/shared/composition/state-styles';
import { buildDocumentIndex } from '../src/preview2/model';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';
import { Project } from './support/workspace2-surfaces';

afterEach(cleanup);
const home = homeDomains.document as unknown as CompositionDocument;

/** A document with one state tile on its first page: a garage door, with the built-in style that fits. */
function withTile(binding?: Partial<StateTileNode['binding']>, library?: CompositionDocument['stateStyles']): { document: CompositionDocument; id: string } {
  const tile = newStateTile('cover.demo_garage', 'Garage', 'garage', undefined)!;
  const next = { ...tile, binding: { ...tile.binding, ...binding } } as StateTileNode;
  return { document: { ...addStateTile(home, home.pages[0].id, next), ...(library ? { stateStyles: library } : {}) }, id: tile.id };
}
const tileOf = (document: CompositionDocument, id: string) => [...buildDocumentIndex(document).entries.values()].find(entry => entry.node?.id === id)!;

/** The tile's properties, live: edits show in the next render, and "Show state" is held the way the workspace holds it. */
function mount(start: CompositionDocument, id: string) {
  const seen = { document: start, preview: undefined as StatePreview | undefined };
  function Harness() {
    const [preview, setPreview] = useState<StatePreview>();
    seen.preview = preview;
    return <Project.Live document={start} seen={next => { seen.document = next; }}>{ws => {
      const entry = tileOf(ws.document!, id);
      return <PropertiesPanel ws={{ ...ws, target: { kind: 'node', key: entry.key, path: entry.path }, statePreview: preview, setStatePreview: setPreview } as Workspace2}
        onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>;
    }}</Project.Live>;
  }
  render(<Harness/>);
  return { seen, binding: () => (tileOf(seen.document, id).node as StateTileNode).binding };
}

/** Opens a Studio menu field by its name and returns its options. */
async function open(name: string) {
  const trigger = screen.getByRole('combobox', { name });
  await act(async () => { fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' }); fireEvent.mouseDown(trigger); fireEvent.click(trigger); });
  return screen.findAllByRole('option');
}
const choose = async (name: string, option: string | RegExp) => {
  const options = await open(name);
  const item = options.find(entry => typeof option === 'string' ? entry.textContent?.startsWith(option) : option.test(entry.textContent ?? ''));
  if (!item) throw new Error(`No option ${option} in ${options.map(entry => entry.textContent).join(' | ')}`);
  await act(async () => { fireEvent.pointerDown(item, { pointerType: 'mouse' }); fireEvent.click(item); });
};

describe('pick 7: the States group of a state tile', () => {
  it('draws the group between the look rows and Behavior, with no generated style or override rows', () => {
    const { document, id } = withTile();
    mount(document, id);
    const headings = screen.getAllByRole('heading', { level: 3 }).map(item => item.textContent);
    expect(headings.indexOf('States')).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf('States')).toBeLessThan(headings.indexOf('Behavior'));
    expect(screen.queryByText('Saved style')).toBeNull();
    expect(screen.queryByText('Built-in style')).toBeNull();
    expect(screen.queryByText('Overrides')).toBeNull();
    expect(screen.getByText('Set by the style')).toBeTruthy();
  });

  it('lists only the styles of the entity’s domain, then Manage Styles…', async () => {
    const saved = { ...builtInStyle('garage-door')!, id: 'house-garage', name: 'House garage', base: 'garage-door' as const };
    const other = { ...builtInStyle('lock')!, id: 'house-lock', name: 'House lock', base: 'lock' as const };
    const { document, id } = withTile(undefined, { type: 'state-styles@1', styles: [saved, other] });
    mount(document, id);
    const names = (await open('Style')).map(item => item.textContent);
    expect(names).toContain('Garage door');
    expect(names).toContain('House garage');
    expect(names).not.toContain('Lock');
    expect(names).not.toContain('House lock');
    expect(names.at(-1)).toBe('Manage Styles…');
  });

  it('writes the chosen saved style and keeps the built-in one as the fallback', async () => {
    const saved = { ...builtInStyle('garage-door')!, id: 'house-garage', name: 'House garage', base: 'garage-door' as const };
    const { document, id } = withTile(undefined, { type: 'state-styles@1', styles: [saved] });
    const view = mount(document, id);
    await choose('Style', 'House garage');
    expect(view.binding()).toMatchObject({ styleId: 'house-garage', builtIn: 'garage-door' });
    await choose('Style', 'Garage door');
    expect(view.binding().styleId).toBeUndefined();
    expect(view.binding().builtIn).toBe('garage-door');
  });

  it('starts "Show state" on the first state when Home Assistant is not connected, and writes nothing for it', async () => {
    const { document, id } = withTile();
    const view = mount(document, id);
    await waitFor(() => expect(view.seen.preview).toMatchObject({ nodeId: id, state: 'closed' }));
    await choose('Show state', 'Opening');
    expect(view.seen.preview).toMatchObject({ nodeId: id, state: 'opening' });
    expect(view.seen.document).toBe(document);
  });

  it('says the class and what a tap does under the menu', async () => {
    const { document, id } = withTile();
    const view = mount(document, id);
    await choose('Show state', 'Opening');
    expect(screen.getByTestId('state-note').textContent).toBe('In progress. A tap says Stop.');
    expect(view.seen.document).toBe(document);
  });

  it('writes and resets each layer as an override of the shown state, marking what is edited', async () => {
    const { document, id } = withTile();
    const view = mount(document, id);
    fireEvent.change(screen.getByRole('textbox', { name: 'Words' }), { target: { value: 'Shut' } });
    expect(view.binding().overrides).toEqual([{ state: 'closed', text: 'Shut' }]);
    await choose('Indicator', 'Pulse');
    await choose('Color', 'Lit');
    expect(view.binding().overrides).toEqual([{ state: 'closed', text: 'Shut', indicator: 'pulse', colour: 'lit' }]);
    // An overridden row has a Reset button; the menu marks the state as Edited.
    expect(document).not.toBe(view.seen.document);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Words to the style' }));
    expect(view.binding().overrides).toEqual([{ state: 'closed', indicator: 'pulse', colour: 'lit' }]);
    const options = await open('Show state');
    expect(options.find(item => item.textContent?.startsWith('Closed'))?.textContent).toContain('Edited');
    expect(options.find(item => item.textContent?.startsWith('Open'))?.textContent).not.toContain('Edited');
    await act(async () => { fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' }); });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Closed' }));
    expect(view.binding().overrides).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Reset Closed' })).toBeNull();
  });

  it('disables Arc Spinner, with its reason, on a state that has an action', async () => {
    const { document, id } = withTile();
    mount(document, id);
    await choose('Show state', 'Opening');
    expect(screen.getByText('No arc while this state has an action.', { selector: '.w2-caption' })).toBeTruthy();
    const options = await open('Indicator');
    const arc = options.find(item => item.textContent?.startsWith('Arc Spinner'))!;
    expect(arc.getAttribute('aria-disabled')).toBe('true');
    expect(options.find(item => item.textContent?.startsWith('Breathe'))?.textContent).toContain('iOS 17 plays Pulse.');
    expect(options.find(item => item.textContent?.startsWith('Wiggle'))?.textContent).toContain('iOS 17 plays Bounce.');
  });

  it('disables Color on a warning, an error and an unavailable state, with the reason', async () => {
    const { document, id } = withTile({ builtIn: 'lock', entityId: 'lock.demo_front' });
    mount(document, id);
    for (const state of ['Open', 'Jammed', 'Unavailable']) {
      await choose('Show state', state);
      expect(screen.getByRole('combobox', { name: 'Color' }).hasAttribute('disabled') || screen.getByRole('combobox', { name: 'Color' }).getAttribute('aria-disabled') === 'true').toBe(true);
      expect(screen.getByText('Color follows the class.')).toBeTruthy();
    }
    await choose('Show state', 'Locked');
    expect(screen.queryByText('Color follows the class.')).toBeNull();
  });

  it('gives way to "Set by the style." and a Request Settings row for Sending and Didn’t Respond', async () => {
    const { document, id } = withTile({ builtIn: 'lock', entityId: 'lock.demo_front' });
    const view = mount(document, id);
    await choose('Show state', 'Sending');
    expect(view.seen.preview).toMatchObject({ nodeId: id, phase: 'sending' });
    expect(screen.queryByRole('textbox', { name: 'Words' })).toBeNull();
    expect(screen.getByTestId('state-note').textContent).toContain('Set by the style.');
    fireEvent.click(screen.getByRole('button', { name: /Request Settings/ }));
    expect(await screen.findByText('Ignore taps for')).toBeTruthy();
    // A style with no tap offers neither phase.
  });

  it('offers After a Tap only when the style has a tap', async () => {
    const { document, id } = withTile({ builtIn: 'detector', entityId: 'binary_sensor.demo_door' });
    mount(document, id);
    const options = await open('Show state');
    expect(options.map(item => item.textContent).join('|')).not.toContain('Sending');
  });

  it('saves the overrides as a new style, and the tile points at it with none left', async () => {
    const { document, id } = withTile();
    const view = mount(document, id);
    expect(screen.queryByRole('button', { name: 'Save as New Style…' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Words' }), { target: { value: 'Shut' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as New Style…' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name for the new style' }), { target: { value: 'Quiet garage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Style' }));
    const created = view.seen.document.stateStyles!.styles.at(-1)!;
    expect(created.name).toBe('Quiet garage');
    expect(created.rules.find(rule => rule.states.includes('closed'))?.text).toBe('Shut');
    expect(view.binding().styleId).toBe(created.id);
    expect(view.binding().overrides).toBeUndefined();
  });

  it('warns when the saved style is no longer in the project, and says what the tile shows', () => {
    const { document, id } = withTile({ styleId: 'gone-style' });
    mount(document, id);
    expect(screen.getByText('This style is no longer in the project. The tile shows its built-in style.')).toBeTruthy();
    expect(within(window.document.body).getByText('Missing')).toBeTruthy();
  });

  it('opens State Styles from Manage Styles… and from the When tapped row, inside the inspector', async () => {
    const { document, id } = withTile();
    mount(document, id);
    fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));
    expect(await screen.findByText('Built-in styles can’t be changed.')).toBeTruthy();
    expect(window.document.querySelector('.w2-pushed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Duplicate to Edit' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Garage door');
  });

  it('opens the style list from Manage Styles… as a pushed page, with Back to the tile', async () => {
    const { document: doc, id } = withTile();
    mount(doc, id);
    await choose('Style', 'Manage Styles…');
    expect(await screen.findByRole('heading', { name: 'Built-In' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Saved' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Garage door/ })).toBeTruthy();
    fireEvent.click(document.querySelector<HTMLElement>('.w2-back')!);
    expect(screen.getByRole('combobox', { name: 'Style' })).toBeTruthy();
  });
});
