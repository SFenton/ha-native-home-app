// @vitest-environment jsdom
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/api';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { LiveHouse, VIEWER_KEY } from '../src/preview2/live-house';
import { connectLiveStates, type StreamSource } from '../src/preview2/live-stream';
import { createEnvironment, emptyOverlay, shownEntity } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { RenderCtx, useRender, type RenderContext } from '../src/preview2/render-context';
import { useHouseStates } from '../src/preview2/useHouseStates';
import { deliverCall, SEND_USE_CALLS_TO_HOME_ASSISTANT } from '../src/preview2/live-calls';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import type { NativeState } from '../src/shared/native-state';

vi.mock('../src/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/api')>(), request: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const light = (entityId: string, state: string, extra: Partial<NativeState> = {}): NativeState => ({ entityId, name: entityId, state, ...extra });

describe('LiveHouse', () => {
  it('is not ready until the first snapshot, then lists its states', () => {
    const live = new LiveHouse();
    expect(live.house.states).toBeUndefined();
    live.applySnapshot([light('light.demo_a', 'on')], { userId: 'u' });
    expect(live.house.states?.get('light.demo_a')?.state).toBe('on');
    expect(live.house.viewer).toEqual({ userId: 'u' });
  });

  it('notifies only the entities that changed, and nobody for an unchanged feed', () => {
    const live = new LiveHouse();
    live.applySnapshot([light('light.demo_a', 'on'), light('light.demo_b', 'off')]);
    const heard: string[][] = [];
    live.subscribe(keys => heard.push([...keys]));
    live.applySnapshot([light('light.demo_a', 'on'), light('light.demo_b', 'off')]);
    live.applyStream([light('light.demo_b', 'off')]);
    expect(heard).toEqual([]);
    live.applyStream([light('light.demo_b', 'on')]);
    expect(heard).toEqual([['light.demo_b']]);
    expect(live.versionOf('light.demo_b')).toBeGreaterThan(live.versionOf('light.demo_a'));
  });

  it('lets the stream own an entity: a stale snapshot never wins, and list and forecast fields survive a stream update', () => {
    const live = new LiveHouse();
    live.applySnapshot([light('weather.demo_home', 'sunny', { dailyForecast: [{ datetime: '2026-01-01T00:00:00+00:00', temperature: 20 }] }), light('light.demo_a', 'on')]);
    live.applyStream([light('weather.demo_home', 'rainy'), light('light.demo_a', 'off')]);
    expect(live.states.get('weather.demo_home')?.dailyForecast).toHaveLength(1);
    // A snapshot read that was in flight before the change arrives late.
    live.applySnapshot([light('weather.demo_home', 'sunny', { dailyForecast: [{ datetime: '2026-01-02T00:00:00+00:00', temperature: 22 }] }), light('light.demo_a', 'on')]);
    expect(live.states.get('light.demo_a')?.state).toBe('off');
    expect(live.states.get('weather.demo_home')?.state).toBe('rainy');
    expect(live.states.get('weather.demo_home')?.dailyForecast?.[0].temperature).toBe(22);
  });

  it('removes what Home Assistant removes and what a snapshot no longer lists, and tells viewer readers', () => {
    const live = new LiveHouse();
    live.applySnapshot([light('light.demo_a', 'on'), light('light.demo_b', 'on')]);
    const heard: string[] = [];
    live.subscribe(keys => heard.push(...keys));
    live.applyStream([], ['light.demo_a']);
    live.applySnapshot([], { userId: 'v' });
    expect([...live.states.keys()]).toEqual([]);
    expect(heard).toContain(VIEWER_KEY);
  });
});

describe('useRender in a live house', () => {
  const renders: Record<string, number> = {};
  let pageRenders = 0;
  function Tile({ id }: { id: string }) {
    const { house, overlay } = useRender();
    renders[id] = (renders[id] ?? 0) + 1;
    return <p data-testid={id}>{shownEntity(house, overlay, id)?.state ?? 'none'}</p>;
  }
  function Page({ ids }: { ids: string[] }) {
    const { mode } = useRender();
    pageRenders += 1;
    return <section data-mode={mode}>{ids.map(id => <Tile key={id} id={id}/>)}</section>;
  }
  beforeEach(() => { for (const key of Object.keys(renders)) delete renders[key]; pageRenders = 0; });

  function mount(live: LiveHouse, ids: string[]) {
    const context: RenderContext = {
      mode: 'use', env: createEnvironment({ dataSources: [] }, live.house, emptyOverlay), house: live.house, overlay: emptyOverlay,
      field: () => undefined, local: () => undefined, run: () => undefined, store: undefined as never, previous: new Map(),
      live: { store: live, dataSources: [] },
    };
    return render(<RenderCtx.Provider value={context}><Page ids={ids}/></RenderCtx.Provider>);
  }

  it('draws again only the tile whose entity changed', () => {
    const live = new LiveHouse();
    live.applySnapshot([light('light.demo_a', 'on'), light('light.demo_b', 'off'), light('light.demo_c', 'off')]);
    const view = mount(live, ['light.demo_a', 'light.demo_b', 'light.demo_c']);
    expect(view.getByTestId('light.demo_a').textContent).toBe('on');
    expect(renders).toEqual({ 'light.demo_a': 1, 'light.demo_b': 1, 'light.demo_c': 1 });

    act(() => live.applyStream([light('light.demo_b', 'on')]));
    expect(view.getByTestId('light.demo_b').textContent).toBe('on');
    expect(renders).toEqual({ 'light.demo_a': 1, 'light.demo_b': 2, 'light.demo_c': 1 });
    expect(pageRenders).toBe(1);

    // A change nobody on the page reads draws nothing; an unchanged feed draws nothing.
    act(() => live.applyStream([light('light.demo_elsewhere', 'on')]));
    act(() => live.applySnapshot([light('light.demo_a', 'on'), light('light.demo_b', 'on'), light('light.demo_c', 'off'), light('light.demo_elsewhere', 'on')]));
    expect(renders).toEqual({ 'light.demo_a': 1, 'light.demo_b': 2, 'light.demo_c': 1 });
    expect(pageRenders).toBe(1);
  });

  it('draws a tile that reads an entity Home Assistant adds later', () => {
    const live = new LiveHouse();
    live.applySnapshot([light('light.demo_a', 'on')]);
    const view = mount(live, ['light.demo_late']);
    expect(view.getByTestId('light.demo_late').textContent).toBe('none');
    act(() => live.applyStream([light('light.demo_late', 'on')]));
    expect(view.getByTestId('light.demo_late').textContent).toBe('on');
  });

  it('catches a change that lands between a render and its commit', () => {
    const live = new LiveHouse();
    live.applySnapshot([light('light.demo_a', 'on')]);
    let once = true;
    function Racy() {
      const { house, overlay } = useRender();
      const state = shownEntity(house, overlay, 'light.demo_a')?.state;
      if (once) { once = false; live.applyStream([light('light.demo_a', 'off')]); }
      return <p data-testid="racy">{state}</p>;
    }
    const context = { mode: 'use', env: createEnvironment({ dataSources: [] }, live.house, emptyOverlay), house: live.house, overlay: emptyOverlay,
      field: () => undefined, local: () => undefined, run: () => undefined, store: undefined, previous: new Map(), live: { store: live, dataSources: [] } } as unknown as RenderContext;
    const view = render(<RenderCtx.Provider value={context}><Racy/></RenderCtx.Provider>);
    expect(view.getByTestId('racy').textContent).toBe('off');
  });
});

describe('the preview with a live house', () => {
  const home = homeDomains.document as unknown as CompositionDocument;
  const icon = { type: 'sf-symbol', name: 'circle', rendering: 'canonical', unavailable: 'fallback' } as const;
  const tile = (id: string, entityId: string): CompositionNode =>
    ({ id, title: id, type: 'state-tile', layout: { span: 1 }, icon, props: {}, binding: { entityId, builtIn: 'lock' } }) as unknown as CompositionNode;

  it('shows a change as it arrives, keeps a simulated change on top, and never fetches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const base = home.pages[0];
    const document = { ...home, navigation: { ...home.navigation, tabs: [], initialPageId: base.id, initialTabId: null },
      pages: [{ ...base, toolbar: { type: 'inherit' }, components: [tile('tile-front', 'lock.demo_front'), tile('tile-back', 'lock.demo_back')] }], modals: [] } as unknown as CompositionDocument;
    const live = new LiveHouse();
    live.applySnapshot([{ entityId: 'lock.demo_front', name: 'Front', state: 'locked' }, { entityId: 'lock.demo_back', name: 'Back', state: 'locked' }]);
    const view = render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: base.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
      window={previewWindows[0]} bezel={false} live={live} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
    const front = () => view.container.querySelector('[data-sel="node:tile-front"]')!;
    const back = () => view.container.querySelector('[data-sel="node:tile-back"]')!;
    expect(front().querySelector('.sh-lit')).toBeNull();
    const backElement = back();
    act(() => live.applyStream([{ entityId: 'lock.demo_front', name: 'Front', state: 'unlocked' }]));
    expect(front().querySelector('.sh-lit')).toBeTruthy();
    expect(back()).toBe(backElement);
    expect(back().querySelector('.sh-lit')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('the Use-mode call switch point', () => {
  it('is off and only ever simulates', () => {
    expect(SEND_USE_CALLS_TO_HOME_ASSISTANT).toBe(false);
    expect(deliverCall({ domain: 'light', service: 'turn_on', entityIds: ['light.demo_a'], data: {} })).toBe('simulated');
  });
});

/** A stream the test drives by hand. */
class FakeStream implements StreamSource {
  closed = false;
  private listeners: Record<string, ((event: { data?: string }) => void)[]> = {};
  addEventListener(type: string, listener: (event: { data?: string }) => void) { (this.listeners[type] ??= []).push(listener); }
  close() { this.closed = true; }
  send(type: string, data: unknown = {}) { for (const listener of this.listeners[type] ?? []) listener({ data: JSON.stringify(data) }); }
  fail() { for (const listener of this.listeners.error ?? []) listener({}); }
}

describe('connectLiveStates', () => {
  it('hands snapshot, update and link frames on, and reopens with backoff after an error', () => {
    vi.useFakeTimers();
    const streams: FakeStream[] = [];
    const calls: string[] = [];
    const stop = connectLiveStates({
      onSnapshot: states => calls.push(`snapshot ${states.length}`),
      onUpdate: (states, removed) => calls.push(`update ${states.length} ${removed.length}`),
      onLink: connected => calls.push(`link ${connected}`),
      onOpen: open => calls.push(`open ${open}`),
    }, { open: () => { const stream = new FakeStream(); streams.push(stream); return stream; }, backoffMs: { initial: 1000, max: 4000 } });
    streams[0].send('hello');
    streams[0].send('snapshot', { connected: true, states: [light('light.demo_a', 'on')] });
    streams[0].send('update', { states: [light('light.demo_a', 'off')], removed: ['light.demo_b'] });
    streams[0].send('status', { connected: false });
    streams[0].send('update', 'not an object');
    expect(calls).toEqual(['open true', 'open true', 'snapshot 1', 'link true', 'update 1 1', 'link false']);

    calls.length = 0;
    streams[0].fail();
    expect(streams[0].closed).toBe(true);
    expect(calls).toEqual(['open false']);
    vi.advanceTimersByTime(999);
    expect(streams).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(streams).toHaveLength(2);
    streams[1].fail();
    vi.advanceTimersByTime(1999);
    expect(streams).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(streams).toHaveLength(3);
    // A late frame from a stream already replaced is ignored.
    calls.length = 0;
    streams[0].send('update', { states: [light('light.demo_a', 'on')], removed: [] });
    expect(calls).toEqual([]);
    stop();
    expect(streams[2].closed).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(streams).toHaveLength(3);
  });
});

describe('useHouseStates with a live stream', () => {
  const snapshot = (state: string) => ({ mode: 'live', houseConfig: { schema: 2, hash: 'h', config: {} }, warnings: [], states: [light('light.demo_a', state), light('light.demo_b', 'off')] });
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(request).mockResolvedValue(snapshot('off')); });

  it('opens the stream once Home Assistant answers, applies what it sends, and keeps the states through a failure', async () => {
    const streams: FakeStream[] = [];
    const openStream = () => { const stream = new FakeStream(); streams.push(stream); return stream; };
    const { result } = renderHook(() => useHouseStates({ dataSources: [] }, { openStream }));
    expect(streams).toHaveLength(0);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(streams).toHaveLength(1));
    expect(result.current.live.states.get('light.demo_a')?.state).toBe('off');

    act(() => { streams[0].send('hello'); streams[0].send('snapshot', { connected: true, states: [light('light.demo_a', 'on')] }); });
    expect(result.current.streaming).toBe(true);
    expect(result.current.live.states.get('light.demo_a')?.state).toBe('on');
    act(() => streams[0].send('update', { states: [light('light.demo_a', 'off')], removed: [] }));
    expect(result.current.live.states.get('light.demo_a')?.state).toBe('off');

    // The stream breaks: the last good states stay and nothing blanks.
    act(() => streams[0].fail());
    expect(result.current.streaming).toBe(false);
    expect(result.current.live.states.get('light.demo_b')?.state).toBe('off');
    expect(result.current.live.house.states).toBeDefined();
  });

  it('opens no stream while Home Assistant has not answered', async () => {
    vi.mocked(request).mockRejectedValue(new Error('Home Assistant is not configured'));
    const openStream = vi.fn(() => new FakeStream());
    const { result } = renderHook(() => useHouseStates({ dataSources: [] }, { openStream }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(openStream).not.toHaveBeenCalled();
    expect(result.current.live.house.states).toBeUndefined();
  });
});
