// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatePreview } from '../src/preview2/render-context';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import { previewTile } from '../src/shared/composition/state-style-preview';
import { builtInStyle, type StateStyleLibrary } from '../src/shared/composition/state-styles';

afterEach(cleanup);
const home = homeDomains.document as unknown as CompositionDocument;
const icon = { type: 'sf-symbol', name: 'circle', rendering: 'canonical', unavailable: 'fallback' } as const;
const tile = (binding: Record<string, unknown>): CompositionNode =>
  ({ id: 'tile-lock', title: 'Front lock', type: 'state-tile', layout: { span: 1 }, icon, props: {}, binding }) as unknown as CompositionNode;

/** Draws one state tile in a one-page document and returns the tile's element. */
function draw(binding: Record<string, unknown>, state: string, stateStyles?: StateStyleLibrary) {
  const base = home.pages[0];
  const document = { ...home, stateStyles, navigation: { ...home.navigation, tabs: [], initialPageId: base.id, initialTabId: null },
    pages: [{ ...base, toolbar: { type: 'inherit' }, components: [tile(binding)] }], modals: [] } as unknown as CompositionDocument;
  const house = houseFrom({ states: [{ entityId: 'lock.demo_front', name: 'Front', state }] });
  const view = render(<Preview2 document={document} mode="edit" surface={{ kind: 'page', id: base.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
    window={previewWindows[0]} bezel={false} house={house} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
  return view.container.querySelector<HTMLElement>('[data-sel="node:tile-lock"]')!;
}

describe('the state tile in the preview', () => {
  it('draws the words and class of the built-in style for the entity state', () => {
    const lock = draw({ entityId: 'lock.demo_front', builtIn: 'lock' }, 'jammed');
    expect(lock.textContent).toContain(previewTile(builtInStyle('lock')!, 'jammed').text);
    expect(lock.querySelector('.sh-class-error')).toBeTruthy();
  });
  it('lights a resting unlocked tile and leaves a locked one unlit', () => {
    expect(draw({ entityId: 'lock.demo_front', builtIn: 'lock' }, 'unlocked').querySelector('.sh-lit')).toBeTruthy();
    cleanup();
    expect(draw({ entityId: 'lock.demo_front', builtIn: 'lock' }, 'locked').querySelector('.sh-lit')).toBeNull();
  });
  it('puts an arc in the disc place for an in-progress state with no tap', () => {
    const lock = draw({ entityId: 'lock.demo_front', builtIn: 'lock' }, 'locking');
    expect(lock.querySelector('[data-testid="state-arc"]')).toBeTruthy();
    expect(lock.querySelector('.sh-effect-arc-spinner')).toBeTruthy();
  });
  it('honours a per-state text override', () => {
    const lock = draw({ entityId: 'lock.demo_front', builtIn: 'lock', overrides: [{ state: 'locked', text: 'Secured' }] }, 'locked');
    expect(lock.textContent).toContain('Secured');
  });
  it('prefers the library style by id over the built-in one', () => {
    const style = { ...builtInStyle('lock')!, id: 'house-lock', name: 'House lock', base: 'lock', rules: builtInStyle('lock')!.rules.map(rule => rule.states?.includes('locked') ? { ...rule, text: 'Bolted' } : rule) };
    const lock = draw({ entityId: 'lock.demo_front', styleId: 'house-lock', builtIn: 'lock' }, 'locked', { styles: [style] } as unknown as StateStyleLibrary);
    expect(lock.textContent).toContain('Bolted');
  });
  it('falls back to the plain state when no style resolves', () => {
    expect(draw({ entityId: 'lock.demo_front', styleId: 'missing' }, 'locked').textContent).toContain('locked');
  });
});

/** The tile in Edit with a state forced on it, or in Use with the house's own state. */
function drawForced(binding: Record<string, unknown>, house: string, options: { forced?: StatePreview; mode?: 'edit' | 'use'; onCall?: (summary: string) => void } = {}) {
  const base = home.pages[0];
  const document = { ...home, navigation: { ...home.navigation, tabs: [], initialPageId: base.id, initialTabId: null },
    pages: [{ ...base, toolbar: { type: 'inherit' }, components: [tile(binding)] }], modals: [] } as unknown as CompositionDocument;
  const states = houseFrom({ states: [{ entityId: 'lock.demo_front', name: 'Front', state: house }] });
  const element = (forced?: StatePreview) => <Preview2 document={document} mode={options.mode ?? 'edit'} surface={{ kind: 'page', id: base.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
    window={previewWindows[0]} bezel={false} house={states} overlay={emptyOverlay} onOverlayChange={vi.fn()} onSimulatedCall={options.onCall} statePreview={forced}/>;
  const view = render(element(options.forced));
  return { ...view, again: () => view.rerender(element()), tile: () => view.container.querySelector<HTMLElement>('[data-sel="node:tile-lock"]')!, press: () => view.container.querySelector<HTMLElement>('[data-sel="node:tile-lock"] button, button[data-sel="node:tile-lock"]')! };
}

describe('the state tile in a state Show state forces', () => {
  const lock = { entityId: 'lock.demo_front', builtIn: 'lock' };
  const forced = (state: string, phase?: 'sending' | 'failed'): StatePreview => ({ nodeId: 'tile-lock', state, ...(phase ? { phase } : {}) });

  it.each([
    ['locked', undefined, 'a resting tile'], ['open', undefined, 'a warning'], ['jammed', undefined, 'an error'], ['locking', undefined, 'an in-progress state with a tap'],
    ['unlocking', undefined, 'an in-progress state with a tap'], ['unavailable', undefined, 'an unavailable state'],
    ['locked', 'sending', 'sending'], ['locked', 'failed', 'a request that did not answer'],
  ] as const)('draws what previewTile returns for %s (%s: %s)', (state, phase, _words) => {
    const look = previewTile(builtInStyle('lock')!, state, [], { inFlight: phase === 'sending', failed: phase === 'failed' }, 'circle');
    const drawn = drawForced(lock, 'unlocked', { forced: forced(state, phase) }).tile();
    expect(drawn.textContent).toContain(look.text);
    expect(drawn.querySelector(`.sh-class-${look.colour.class}`)).toBeTruthy();
    expect(drawn.querySelector(`.sh-effect-${look.indicator}`)).toBeTruthy();
    expect(Boolean(drawn.querySelector('[data-testid="state-arc"]'))).toBe(look.showsArc);
    expect(drawn.querySelector('[data-testid="state-voiceover"]')?.textContent).toBe(look.voiceOver);
  });

  it('draws an arc for an in-progress state with no tap, and not while it has one', () => {
    const arcStyle = { ...builtInStyle('lock')!, rules: builtInStyle('lock')!.rules.map(rule => rule.class === 'in-progress' ? { ...rule, action: undefined } : rule) };
    const library = { type: 'state-styles@1', styles: [{ ...arcStyle, id: 'no-tap', base: 'lock' }] } as unknown as StateStyleLibrary;
    const view = drawWithLibrary({ ...lock, styleId: 'no-tap' }, library, forced('locking'));
    expect(view.querySelector('[data-testid="state-arc"]')).toBeTruthy();
    cleanup();
    // A garage door that is opening can be stopped, so its disc stays and no arc stands in.
    expect(drawForced({ entityId: 'cover.demo_garage', builtIn: 'garage-door' }, 'closed', { forced: forced('opening') }).tile().querySelector('[data-testid="state-arc"]')).toBeNull();
  });

  it('applies the tile’s own override to the forced state', () => {
    const drawn = drawForced({ ...lock, overrides: [{ state: 'jammed', text: 'Stuck' }] }, 'locked', { forced: forced('jammed') }).tile();
    expect(drawn.textContent).toContain('Stuck');
  });

  it('ignores a state forced on another tile, and in Use', () => {
    const other = drawForced(lock, 'locked', { forced: { nodeId: 'someone-else', state: 'jammed' } }).tile();
    expect(other.querySelector('.sh-class-error')).toBeNull();
    cleanup();
    const use = drawForced(lock, 'locked', { forced: forced('jammed'), mode: 'use' }).tile();
    expect(use.querySelector('.sh-class-error')).toBeNull();
  });

  it('returns to the entity’s own state when nothing is forced', () => {
    const view = drawForced(lock, 'locked', { forced: forced('jammed') });
    expect(view.tile().querySelector('.sh-class-error')).toBeTruthy();
    view.again();
    expect(view.tile().querySelector('.sh-class-error')).toBeNull();
    expect(view.tile().querySelector('.sh-class-resting')).toBeTruthy();
  });
});

function drawWithLibrary(binding: Record<string, unknown>, library: StateStyleLibrary, forced: StatePreview) {
  const base = home.pages[0];
  const document = { ...home, stateStyles: library, navigation: { ...home.navigation, tabs: [], initialPageId: base.id, initialTabId: null },
    pages: [{ ...base, toolbar: { type: 'inherit' }, components: [tile(binding)] }], modals: [] } as unknown as CompositionDocument;
  const view = render(<Preview2 document={document} mode="edit" surface={{ kind: 'page', id: base.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
    window={previewWindows[0]} bezel={false} house={houseFrom({ states: [{ entityId: 'lock.demo_front', name: 'Front', state: 'locked' }] })} overlay={emptyOverlay} onOverlayChange={vi.fn()} statePreview={forced}/>);
  return view.container.querySelector<HTMLElement>('[data-sel="node:tile-lock"]')!;
}

describe('a tap on a state tile in Use', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const lock = { entityId: 'lock.demo_front', builtIn: 'lock' };

  it('shows the in-progress look for a second, then the entity’s state again, and notes the simulated call', () => {
    const calls: string[] = [];
    const view = drawForced(lock, 'locked', { mode: 'use', onCall: summary => calls.push(summary) });
    expect(view.tile().querySelector('.sh-class-in-progress')).toBeNull();
    act(() => { fireEvent.click(view.press()); });
    expect(calls).toEqual(['Front lock: Unlock']);
    expect(view.tile().querySelector('.sh-class-in-progress')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(900); });
    expect(view.tile().querySelector('.sh-class-in-progress')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(200); });
    expect(view.tile().querySelector('.sh-class-in-progress')).toBeNull();
    expect(view.tile().querySelector('.sh-class-resting')).toBeTruthy();
  });

  it('asks first when the state’s tap asks, and plays only after Confirm', () => {
    const asking = { ...builtInStyle('lock')!, id: 'asks', base: 'lock', rules: builtInStyle('lock')!.rules.map(rule => rule.states.includes('locked') ? { ...rule, action: { ...rule.action!, confirmation: { title: 'Unlock the door?', message: 'It will stay unlocked.', confirmVerb: 'Unlock' } } } : rule) };
    const library = { type: 'state-styles@1', styles: [asking] } as unknown as StateStyleLibrary;
    const calls: string[] = [];
    const base = home.pages[0];
    const document = { ...home, stateStyles: library, navigation: { ...home.navigation, tabs: [], initialPageId: base.id, initialTabId: null }, pages: [{ ...base, toolbar: { type: 'inherit' }, components: [tile({ entityId: 'lock.demo_front', styleId: 'asks' })] }], modals: [] } as unknown as CompositionDocument;
    const view = render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: base.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={previewWindows[0]} bezel={false}
      house={houseFrom({ states: [{ entityId: 'lock.demo_front', name: 'Front', state: 'locked' }] })} overlay={emptyOverlay} onOverlayChange={vi.fn()} onSimulatedCall={summary => calls.push(summary)}/>);
    act(() => { fireEvent.click(view.container.querySelector('[data-sel="node:tile-lock"] button, button[data-sel="node:tile-lock"]')!); });
    expect(view.container.querySelector('.sh-alert-box')?.textContent).toContain('Unlock the door?');
    expect(calls).toEqual([]);
    act(() => { fireEvent.click([...view.container.querySelectorAll('.sh-alert-box button')].find(button => button.textContent === 'Unlock')!); });
    expect(calls).toEqual(['Front lock: Unlock']);
  });

  it('does nothing on a tap in Edit, and nothing on an unavailable state', () => {
    const calls: string[] = [];
    const edit = drawForced(lock, 'locked', { mode: 'edit', onCall: summary => calls.push(summary) });
    act(() => { fireEvent.click(edit.press() ?? edit.tile()); });
    cleanup();
    const gone = drawForced(lock, 'unavailable', { mode: 'use', onCall: summary => calls.push(summary) });
    act(() => { fireEvent.click(gone.press() ?? gone.tile()); });
    expect(calls).toEqual([]);
  });
});
