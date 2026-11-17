// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { addStateTile, newStateTile, type StateTileNode } from '../src/shared/composition/state-style-library';
import { builtInStyle, type StateStyleDefinition } from '../src/shared/composition/state-styles';
import { PushStack } from '../src/workspace2/kit';
import { RowsProvider } from '../src/workspace2/rows';
import { StylesPanel } from '../src/workspace2/styles/StylesPanel';
import { WorkspaceDataProvider } from '../src/workspace2/pickers/WorkspaceData';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request }));

beforeEach(() => {
  request.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 320 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 360 });
});
afterEach(cleanup);
const home = homeDomains.document as unknown as CompositionDocument;
const saved = (patch: Partial<StateStyleDefinition> = {}): StateStyleDefinition => ({ ...structuredClone(builtInStyle('lock')!), id: 'house-lock', name: 'House lock', base: 'lock', ...patch });

/** A document with a saved style and `uses` tiles that use it. */
function withStyle(uses = 0, style = saved()) {
  let document: CompositionDocument = { ...home, stateStyles: { type: 'state-styles@1', styles: [style] } };
  for (let at = 0; at < uses; at++) {
    const tile = { ...newStateTile('lock.demo_front', `Front ${at}`, undefined, undefined)!, id: `front-${at}` } as StateTileNode;
    document = addStateTile(document, document.pages[0].id, { ...tile, binding: { ...tile.binding, styleId: style.id } } as StateTileNode);
  }
  return document;
}

/** The panel at its root, live: edits show in the next render. */
function mount(start: CompositionDocument, body: ReactNode = <StylesPanel/>, connected = false) {
  const seen = { document: start, errors: [] as string[] };
  function Harness() {
    const [document, setDocument] = useState(start);
    const onChange = (next: CompositionDocument) => { seen.document = next; setDocument(next); };
    return <WorkspaceDataProvider document={document} house={connected ? { states: new Map([['lock.demo_front', { entityId: 'lock.demo_front', name: 'Front door', state: 'locked' }]]) } as never : {}}>
      <RowsProvider value={{ document, onChange, onError: message => seen.errors.push(message) }}><PushStack rootTitle="State Styles" root={body}/></RowsProvider></WorkspaceDataProvider>;
  }
  render(<Harness/>);
  return seen;
}
const style = (seen: { document: CompositionDocument }, id = 'house-lock') => seen.document.stateStyles!.styles.find(item => item.id === id)!;
const row = (name: RegExp | string) => screen.getByRole('button', { name });

describe('pick 7: State Styles', () => {
  it('lists the saved styles with their uses, and the eight built-ins with a lock', () => {
    mount(withStyle(2));
    const savedList = within(screen.getByRole('region', { name: 'Saved' }));
    expect(savedList.getByText('House lock')).toBeTruthy();
    expect(savedList.getByText('Used by 2 tiles')).toBeTruthy();
    const built = within(screen.getByRole('region', { name: 'Built-In' }));
    expect(built.getAllByRole('button')).toHaveLength(8);
    expect(window.document.querySelectorAll('.w2-lock')).toHaveLength(8);
    expect(screen.getByRole('button', { name: /New Style From an Entity…/ })).toBeTruthy();
  });

  it('shows a built-in style read-only, with Duplicate to Edit', async () => {
    const seen = mount(withStyle());
    fireEvent.click(row(/^Lock/));
    expect(await screen.findByText('Built-in styles can’t be changed.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Add State' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate to Edit' }));
    expect(seen.document.stateStyles!.styles).toHaveLength(2);
    const copy = seen.document.stateStyles!.styles[1];
    expect(copy.base).toBe('lock');
    expect(await screen.findByText('Copied from')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Lock copy');
  });

  it('renames a saved style from its page, and from its More menu', async () => {
    const seen = mount(withStyle());
    fireEvent.click(screen.getByRole('button', { name: 'More for House lock' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of House lock' }), { target: { value: 'Back door lock' } });
    expect(style(seen).name).toBe('Back door lock');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(row(/^Back door lock/));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Side lock' } });
    expect(style(seen).name).toBe('Side lock');
  });

  it('duplicates from the More menu', async () => {
    const seen = mount(withStyle());
    fireEvent.click(screen.getByRole('button', { name: 'More for House lock' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(seen.document.stateStyles!.styles.map(item => item.name)).toEqual(['House lock', 'House lock copy']);
  });

  it('blocks Delete while tiles use the style, with the reason, and deletes it once none do', async () => {
    const used = mount(withStyle(1));
    fireEvent.click(screen.getByRole('button', { name: 'More for House lock' }));
    const blocked = await screen.findByRole('menuitem', { name: /Delete/ });
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    expect(blocked.textContent).toContain('Used by 1 tile. Point them at another style first.');
    fireEvent.click(blocked);
    expect(style(used)).toBeTruthy();
    cleanup();
    const free = mount(withStyle(0));
    fireEvent.click(screen.getByRole('button', { name: 'More for House lock' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(free.document.stateStyles!.styles).toEqual([]);
  });

  it('says how many tiles a change reaches, and nothing when none use the style', async () => {
    mount(withStyle(2));
    fireEvent.click(row(/^House lock/));
    expect((await screen.findByTestId('changes-apply')).textContent).toBe('Changes apply to 2 tiles.');
    cleanup();
    mount(withStyle(0));
    fireEvent.click(row(/^House lock/));
    await screen.findByRole('textbox', { name: 'Name' });
    expect(screen.queryByTestId('changes-apply')).toBeNull();
  });

  it('adds a state, reorders states (the first match wins), and removes one', async () => {
    const seen = mount(withStyle());
    fireEvent.click(row(/^House lock/));
    await screen.findByRole('textbox', { name: 'Name' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the new state' }), { target: { value: 'charging' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add State' }));
    const states = () => style(seen).rules.map(rule => rule.states.join());
    expect(states()).toContain('charging');
    // New states land before the unavailable rule, which stays last.
    expect(states().at(-1)).toBe('unavailable,unknown');
    const before = states();
    fireEvent.click(screen.getByRole('button', { name: 'Move Open down' }));
    expect(states()).not.toEqual(before);
    expect(states().indexOf('open')).toBe(before.indexOf('open') + 1);
    expect(screen.getByRole('button', { name: 'Move Locked up' }).hasAttribute('disabled')).toBe(true);
    // The fallback does not move: it has no grips.
    expect(screen.queryByRole('button', { name: 'Move Anything Else up' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Charging/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Charging' }));
    expect(states()).not.toContain('charging');
  });

  it('fixes the class of the unavailable state and explains why', async () => {
    mount(withStyle());
    fireEvent.click(row(/^House lock/));
    fireEvent.click(await screen.findByRole('button', { name: /^Unavailable, Unknown/ }));
    expect(await screen.findByText('Unavailable and unknown always mean Unavailable.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Means' }).hasAttribute('disabled') || screen.getByRole('combobox', { name: 'Means' }).getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('edits a state: its states, the lit face, the words and the tap in words (read-only)', async () => {
    const seen = mount(withStyle());
    fireEvent.click(row(/^House lock/));
    fireEvent.click(await screen.findByRole('button', { name: /^Locked/ }));
    const list = await screen.findByRole('textbox', { name: 'States' });
    fireEvent.change(list, { target: { value: 'locked, secured' } });
    fireEvent.blur(list);
    expect(style(seen).rules[0].states).toEqual(['locked', 'secured']);
    fireEvent.click(screen.getByRole('switch', { name: 'Lit' }));
    expect(style(seen).rules[0].active).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Words' }), { target: { value: 'Secure' } });
    expect(style(seen).rules[0].text).toBe('Secure');
    expect(screen.getByTestId('rule-tap').textContent).toBe('Unlock');
    expect(screen.getByRole('button', { name: 'Remove Locked' }).hasAttribute('disabled')).toBe(false);
  });

  it('keeps the last state: Remove is disabled for it', async () => {
    const one = saved({ rules: [saved().rules[0]] });
    mount(withStyle(0, one));
    fireEvent.click(row(/^House lock/));
    fireEvent.click(await screen.findByRole('button', { name: /^Locked/ }));
    expect((await screen.findByRole('button', { name: 'Remove Locked' })).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('A style keeps at least one state.')).toBeTruthy();
  });

  it('edits the request, and checks that the script and the error timer exist', async () => {
    const seen = mount(withStyle());
    fireEvent.click(row(/^House lock/));
    fireEvent.click(await screen.findByRole('button', { name: /^Request/ }));
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Ignore taps for' }), { target: { value: '3' } });
    expect(style(seen).request?.lockoutSeconds).toBe(3);
    // A number out of range is written too, so the next edit is never held up; the caption says what to use, and Checks holds Save back.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Wait for an answer' }), { target: { value: '500' } });
    expect(style(seen).request?.ackTimeoutSeconds).toBe(500);
    expect(document.querySelector('[data-field-problem="Wait for an answer"]')?.textContent).toBe('Seconds, 1 to 120.');
    // Half a number is not a value: it waits.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Wait for an answer' }), { target: { value: '' } });
    expect(style(seen).request?.ackTimeoutSeconds).toBe(500);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Wait for an answer' }), { target: { value: '10' } });
    expect(style(seen).request?.ackTimeoutSeconds).toBe(10);
    fireEvent.change(screen.getByRole('textbox', { name: 'Error words' }), { target: { value: 'No answer' } });
    expect(style(seen).request?.errorWords).toBe('No answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Script' }), { target: { value: 'script.demo_lock_front' } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Name the script and the error timer together, or neither.')).toBeTruthy();
    request.mockResolvedValueOnce({ exists: false });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })); });
    expect(await screen.findByText('script.demo_lock_front does not exist in Home Assistant. Create it there; the Studio installs nothing.')).toBeTruthy();
    request.mockResolvedValueOnce({ exists: true });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })); });
    expect(await screen.findByText('script.demo_lock_front exists in Home Assistant.')).toBeTruthy();
    request.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })); });
    expect(await screen.findByText('Home Assistant could not be asked whether script.demo_lock_front exists.')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('/native/api/ha/exists?id=script.demo_lock_front');
  });

  it('adds a request phase to a style that has none, and shows the sending words read-only', async () => {
    const { request: _gone, ...bare } = saved();
    const seen = mount(withStyle(0, bare as StateStyleDefinition));
    fireEvent.click(row(/^House lock/));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a Request Phase' }));
    expect(style(seen).request).toMatchObject({ lockoutSeconds: 2, onTimeout: 'error' });
    fireEvent.click(await screen.findByRole('button', { name: /^Request/ }));
    expect(await screen.findByText('Sending words')).toBeTruthy();
  });

  describe('New Style From an Entity…', () => {
    it('says the states cannot be read when Home Assistant is not connected, and points at duplicating', async () => {
      mount(withStyle());
      fireEvent.click(row(/New Style From an Entity…/));
      expect(await screen.findByText('Home Assistant isn’t connected, so the entity’s states can’t be read.')).toBeTruthy();
      expect(screen.getByText('Duplicate a built-in style instead.')).toBeTruthy();
    });

    it('fills a state map from the entity’s states, lists the unclassified ones with a warning, and creates the style', async () => {
      request.mockResolvedValue({ entityId: 'lock.demo_front', states: [{ state: 'locked' }, { state: 'unlocked' }], history: ['locked', 'unlocked', 'tamper'], openEnded: false });
      const seen = mount(withStyle(), <StylesPanel/>, true);
      fireEvent.click(row(/New Style From an Entity…/));
      fireEvent.click(await screen.findByRole('option', { name: /Front door/ }));
      expect(await screen.findByText('Not Classified')).toBeTruthy();
      expect(within(screen.getByRole('region', { name: 'Not Classified' })).getByText(/Tamper/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Create Style' }));
      const created = seen.document.stateStyles!.styles.at(-1)!;
      expect(created.name).toBe('Front door states');
      expect(created.domain).toBe('lock');
      expect(created.rules.length).toBeGreaterThan(1);
      // The new style's own page opens.
      expect((await screen.findByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Front door states');
      await waitFor(() => expect(request).toHaveBeenCalledWith('/native/api/ha/entity-states?entityId=lock.demo_front'));
    });
  });

  it('draws the style at iPhone, Duo and iPad widths, with the VoiceOver line', async () => {
    mount(withStyle(1));
    fireEvent.click(row(/^House lock/));
    const widths = () => (window.document.querySelector('.w2-style-frame') as HTMLElement).style.width;
    await screen.findByTestId('style-tile');
    const phone = widths();
    fireEvent.click(screen.getByRole('button', { name: 'Duo' }));
    const duo = widths();
    fireEvent.click(screen.getByRole('button', { name: 'iPad' }));
    expect(parseInt(phone)).toBeLessThan(parseInt(duo));
    expect(parseInt(duo)).toBeLessThan(parseInt(widths()));
    expect(screen.getByTestId('style-voiceover').textContent).toBe('VoiceOver: “Front 0, Locked”');
  });
});
