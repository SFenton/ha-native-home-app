// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/api';
import { createSampleDocument } from '../src/shared/sample';
import type { DataSource, Primitive } from '../src/shared/types';
import { usePreviewData } from '../src/usePreviewData';

vi.mock('../src/api', () => ({ request: vi.fn() }));
const notify = vi.fn();
const native: DataSource = { id: 'native-states', name: 'Native Home', kind: 'native-home', endpoint: 'house-states', sample: [], refreshSeconds: 5 };
const reading = [{ entityId: 'sensor.test', state: '0', name: 'Test' }];
const nativeResponse = { mode: 'live', states: reading };
const makeDocument = (source = native) => ({ ...createSampleDocument(), dataSources: [structuredClone(source)] });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(request).mockResolvedValue(nativeResponse); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('preview live data lifecycle', () => {
  it('debounces encoded endpoint queries, cancels stale requests and preserves unrelated native readings', async () => {
    vi.useFakeTimers();
    const document = makeDocument();
    document.variables.query = '';
    document.dataSources.push({ id: 'search', name: 'Search', kind: 'endpoint', endpoint: 'recipes', queryVariable: 'query', refreshSeconds: 30, sample: [] });
    let finish!: (value: unknown) => void;
    vi.mocked(request).mockImplementation(url => url === '/api/native-home' ? Promise.resolve(nativeResponse) : new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ query }) => usePreviewData(document, document.dataSources, 'live', notify, { query }, ['search']), { initialProps: { query: 'first' } });
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
    act(() => result.current.enableQueryReads());
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(request).toHaveBeenLastCalledWith('/api/data/search?q=first', expect.anything());
    const firstSignal = vi.mocked(request).mock.calls[1][1]!.signal!;
    const stale = finish;
    rerender({ query: 'second' });
    expect(firstSignal.aborted).toBe(true);
    expect(result.current.dataResults['native-states']).toEqual(reading);
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(request).toHaveBeenCalledTimes(2);
    rerender({ query: 'rice & beans/?' });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(request).toHaveBeenLastCalledWith('/api/data/search?q=rice+%26+beans%2F%3F', expect.anything());
    await act(async () => { finish({ mode: 'live', data: [{ title: 'Current result' }] }); });
    await act(async () => { stale({ mode: 'live', data: [{ title: 'Stale result' }] }); });
    expect(result.current.dataResults.search).toEqual([{ title: 'Current result' }]);
    expect(result.current.dataResults['native-states']).toEqual(reading);
    expect(vi.mocked(request).mock.calls.filter(([url]) => url === '/api/native-home')).toHaveLength(1);
    expect(document.variables.query).toBe('');
  });

  it('requires separate endpoint consent even after ordinary live-data toggles and rejects invalid query values', async () => {
    vi.useFakeTimers();
    const source: DataSource = { id: 'search', name: 'Search', kind: 'endpoint', endpoint: 'recipes', queryVariable: 'query', refreshSeconds: 30, sample: [] };
    const document = makeDocument(source);
    document.variables.query = '';
    const initialProps: { query: Primitive } = { query: 'first' };
    const { result, rerender } = renderHook(({ query }) => usePreviewData(document, document.dataSources, 'live', notify, { query }, ['search']), { initialProps });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(request).not.toHaveBeenCalled();
    act(() => result.current.changeLive(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(result.current.liveEnabled).toBe(true);
    expect(result.current.queryLiveEnabled).toBe(false);
    await act(async () => { await result.current.fetchData('search'); });
    expect(request).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Turn on endpoint search'), 'info');
    act(() => result.current.enableQueryReads());
    rerender({ query: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(request).not.toHaveBeenCalled();
    expect(result.current.dataErrors.search).toContain('must be strings');
    act(() => result.current.changeLive(false));
    rerender({ query: 'valid again' });
    act(() => result.current.changeLive(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(result.current.queryLiveEnabled).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not poll searches or reuse earlier results when a cleared query is entered again', async () => {
    vi.useFakeTimers();
    const source: DataSource = { id: 'search', name: 'Search', kind: 'endpoint', endpoint: 'recipes', queryVariable: 'query', refreshSeconds: 5, sample: ['Example'] };
    const document = makeDocument(source);
    document.variables.query = '';
    vi.mocked(request).mockResolvedValue({ mode: 'live', data: ['First response'] });
    const { result, rerender } = renderHook(({ query }) => usePreviewData(document, document.dataSources, 'live', notify, { query }, ['search']), { initialProps: { query: 'rice' } });
    act(() => result.current.enableQueryReads());
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.dataResults.search).toEqual(['First response']);
    await act(async () => { await vi.advanceTimersByTimeAsync(35000); });
    expect(request).toHaveBeenCalledTimes(1);
    rerender({ query: ' ' });
    expect(result.current.dataModes.search).toBe('idle');
    expect(result.current.dataResults.search).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(request).toHaveBeenCalledTimes(1);
    rerender({ query: 'rice' });
    expect(result.current.dataModes.search).toBe('loading');
    expect(result.current.dataResults.search).toBeNull();
    vi.mocked(request).mockResolvedValue({ mode: 'live', data: ['Fresh response'] });
    await act(async () => { await result.current.fetchData('search'); });
    expect(result.current.dataResults.search).toEqual(['Fresh response']);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('cancels obscured or cleared searches and rejects late replies even after reopening the same query', async () => {
    vi.useFakeTimers();
    const source: DataSource = { id: 'search', name: 'Search', kind: 'endpoint', endpoint: 'recipes', queryVariable: 'query', refreshSeconds: 5, sample: [] };
    const document = makeDocument(source);
    document.variables.query = '';
    const finishes: ((value: unknown) => void)[] = [];
    vi.mocked(request).mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
    const { result, rerender } = renderHook(({ query, active }) => usePreviewData(document, document.dataSources, 'live', notify, { query }, active ? ['search'] : []), { initialProps: { query: 'rice', active: true } });
    act(() => result.current.enableQueryReads());
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const firstSignal = vi.mocked(request).mock.calls[0][1]!.signal!;
    rerender({ query: 'rice', active: false });
    expect(firstSignal.aborted).toBe(true);
    expect(result.current.dataModes.search).toBe('sample');
    await act(async () => { await result.current.fetchData('search'); });
    expect(request).toHaveBeenCalledTimes(1);
    rerender({ query: 'rice', active: true });
    await act(async () => { finishes[0]({ mode: 'live', data: ['Stale result'] }); });
    expect(result.current.dataResults.search).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const secondSignal = vi.mocked(request).mock.calls[1][1]!.signal!;
    rerender({ query: '', active: true });
    expect(secondSignal.aborted).toBe(true);
    await act(async () => { finishes[1]({ mode: 'live', data: ['Obsolete result'] }); });
    expect(result.current.dataModes.search).toBe('idle');
    expect(result.current.dataResults.search).toBeNull();
  });

  it('revokes search consent when native identity changes without disabling native readings', async () => {
    vi.useFakeTimers();
    const document = makeDocument();
    document.variables.query = '';
    document.dataSources.push({ id: 'search', name: 'Search', kind: 'endpoint', endpoint: 'recipes', queryVariable: 'query', refreshSeconds: 5, sample: [] });
    let userId = 'viewer-one';
    vi.mocked(request).mockImplementation(url => Promise.resolve(url === '/api/native-home'
      ? { ...nativeResponse, currentUser: { id: userId, name: userId, isOwner: false, isAdmin: false } }
      : { mode: 'live', data: ['A result'] }));
    const { result } = renderHook(() => usePreviewData(document, document.dataSources, 'live', notify, { query: 'rice' }, ['search']));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.liveEnabled).toBe(true);
    expect(result.current.queryLiveEnabled).toBe(false);
    act(() => result.current.enableQueryReads());
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.dataModes.search).toBe('live');
    userId = 'viewer-two';
    await act(async () => { await result.current.fetchData(native.id); });
    expect(result.current.queryLiveEnabled).toBe(false);
    expect(result.current.liveEnabled).toBe(true);
    expect(result.current.dataResults[native.id]).toEqual(reading);
    expect(result.current.dataResults.search).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(vi.mocked(request).mock.calls.filter(([url]) => url.startsWith('/api/data/'))).toHaveLength(1);
  });

  it('reports optional native read warnings once without discarding working entity data', async () => {
    const document = makeDocument();
    vi.mocked(request).mockResolvedValue({ ...nativeResponse, warnings: ['Forecast temporarily unavailable.'] });
    const { result } = renderHook(() => usePreviewData(document, [], 'live', notify));
    await waitFor(() => expect(result.current.dataModes[native.id]).toBe('live'));
    expect(result.current.dataResults[native.id]).toEqual(reading);
    expect(notify).toHaveBeenCalledWith('Import notes: Forecast temporarily unavailable.', 'info');
    await act(async () => result.current.fetchData(native.id));
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('shares a fixed native snapshot for states and authenticated profile without persisting identity', async () => {
    const document = makeDocument();
    document.dataSources.push({ id: 'native-profile', name: 'Profile', kind: 'native-home', endpoint: 'house-profile', sample: null, refreshSeconds: 30 });
    const currentUser = { id: 'user-id', name: 'Token User', isOwner: false, isAdmin: false };
    vi.mocked(request).mockResolvedValue({ ...nativeResponse, currentUser });
    const { result } = renderHook(() => usePreviewData(document, [], 'live', notify));
    await waitFor(() => expect(result.current.dataModes['native-profile']).toBe('live'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.dataResults['native-profile']).toEqual(currentUser);
    expect(result.current.dataResults[native.id]).toEqual(reading);
    expect(JSON.stringify(document)).not.toContain('Token User');
    const nextUser = { ...currentUser, id: 'second-user', name: 'Another token user' };
    const nextReading = [{ ...reading[0], state: '1' }];
    vi.mocked(request).mockResolvedValue({ ...nativeResponse, currentUser: nextUser, states: nextReading });
    await act(async () => result.current.fetchData(native.id));
    expect(result.current.dataResults['native-profile']).toEqual(nextUser);
    expect(result.current.dataResults[native.id]).toEqual(nextReading);
    vi.mocked(request).mockResolvedValue(nativeResponse);
    await act(async () => result.current.fetchData(native.id));
    expect(result.current.dataModes['native-profile']).toBe('error');
    expect(result.current.dataResults['native-profile']).toBeNull();
    expect(result.current.dataModes[native.id]).toBe('live');
    expect(result.current.dataResults[native.id]).toEqual(reading);
    expect(notify).toHaveBeenCalledWith('Profile: Home Assistant did not provide the authenticated profile.', 'error');
    vi.mocked(request).mockResolvedValue({ ...nativeResponse, currentUser: nextUser });
    await act(async () => result.current.fetchData('native-profile'));
    vi.mocked(request).mockRejectedValue(new Error('Native snapshot unavailable'));
    await act(async () => result.current.fetchData(native.id));
    expect(result.current.dataModes['native-profile']).toBe('error');
    expect(result.current.dataResults['native-profile']).toBeNull();
    expect(result.current.dataModes[native.id]).toBe('error');
  });
  it('immediately reads native imports without saving, and keeps reading during layout edits', async () => {
    const document = makeDocument();
    const { result, rerender } = renderHook(({ draft }) => usePreviewData(draft, [], 'live', notify), { initialProps: { draft: document } });
    await waitFor(() => expect(result.current.dataModes[native.id]).toBe('live'));
    expect(request).toHaveBeenCalledWith('/api/native-home', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result.current.dataResults[native.id]).toEqual(reading);
    rerender({ draft: { ...document, name: 'Unsaved layout change' } });
    await act(async () => { await result.current.fetchData(native.id); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(document.dataSources[0].sample).toEqual([]);
    expect(JSON.stringify(document)).not.toContain('sensor.test');
  });

  it('does not fetch an ordinary sample draft until enabled and fetches immediately on opt-in', async () => {
    const source: DataSource = { id: 'temperature', name: 'Temperature', kind: 'ha-state', entityId: 'sensor.test', sample: 'Sample', refreshSeconds: 5 };
    const document = makeDocument(source);
    vi.mocked(request).mockResolvedValue({ mode: 'live', data: 0 });
    const { result, rerender } = renderHook(({ draft }) => usePreviewData(draft, document.dataSources, 'live', notify), { initialProps: { draft: document } });
    expect(result.current.liveEnabled).toBe(false);
    expect(request).not.toHaveBeenCalled();
    act(() => result.current.changeLive(true));
    await waitFor(() => expect(result.current.dataResults.temperature).toBe(0));
    rerender({ draft: { ...document, name: 'Unsaved title' } });
    await act(async () => { await result.current.fetchData('temperature'); });
    expect(request).toHaveBeenCalledTimes(2);
    rerender({ draft: makeDocument({ ...source, entityId: 'sensor.changed' }) });
    await waitFor(() => expect(result.current.dataModes.temperature).toBe('unsaved'));
    expect(result.current.dataErrors.temperature).toContain('Save this data source');
    expect(result.current.dataResults).toEqual({});
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('aborts on opt-out and ignores a late result even after re-enabling the same source', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const document = makeDocument();
    const { result } = renderHook(() => usePreviewData(document, [], 'live', notify));
    const signal = vi.mocked(request).mock.calls[0][1]!.signal!;
    act(() => result.current.changeLive(false));
    expect(signal.aborted).toBe(true);
    expect(result.current.dataResults).toEqual({});
    act(() => result.current.changeLive(true));
    await waitFor(() => expect(result.current.dataResults[native.id]).toEqual(reading));
    await act(async () => { finish({ mode: 'live', states: [{ entityId: 'sensor.test', state: 'stale' }] }); });
    expect(result.current.dataResults[native.id]).toEqual(reading);
  });

  it('discards late readings across documents sharing an identical source definition', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const document = makeDocument();
    const { result, rerender } = renderHook(({ draft }) => usePreviewData(draft, [], 'live', notify), { initialProps: { draft: document } });
    const signal = vi.mocked(request).mock.calls[0][1]!.signal!;
    rerender({ draft: { ...document, id: 'new-document' } });
    await waitFor(() => expect(result.current.dataResults[native.id]).toEqual(reading));
    await act(async () => { finish({ mode: 'live', states: [{ entityId: 'sensor.test', state: 'old document' }] }); });
    expect(signal.aborted).toBe(true);
    expect(result.current.dataResults[native.id]).toEqual(reading);
  });

  it('keeps already-loaded components steady while a refresh is pending', async () => {
    const document = makeDocument();
    const { result } = renderHook(() => usePreviewData(document, [], 'live', notify));
    await waitFor(() => expect(result.current.dataModes[native.id]).toBe('live'));
    let finish!: (value: unknown) => void;
    vi.mocked(request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.fetchData(native.id); });
    expect(result.current.dataModes[native.id]).toBe('live');
    expect(result.current.dataResults[native.id]).toEqual(reading);
    await act(async () => { finish({ ...nativeResponse, states: [] }); await refresh; });
    expect(result.current.dataResults[native.id]).toEqual([]);
  });

  it('polls without overlap and keeps the last value visibly stale on a failed refresh', async () => {
    vi.useFakeTimers();
    const document = makeDocument();
    const { result, unmount } = renderHook(() => usePreviewData(document, [], 'live', notify));
    await act(async () => {});
    vi.mocked(request).mockRejectedValueOnce(new Error('Home Assistant unavailable'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.dataModes[native.id]).toBe('error');
    expect(result.current.dataErrors[native.id]).toBe('Home Assistant unavailable');
    expect(result.current.dataResults[native.id]).toEqual(reading);
    expect(notify).toHaveBeenCalledWith('Native Home: Home Assistant unavailable', 'error');
    vi.mocked(request).mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(request).toHaveBeenCalledTimes(3);
    const signal = vi.mocked(request).mock.calls[2][1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(request).toHaveBeenCalledTimes(3);
  });
});
