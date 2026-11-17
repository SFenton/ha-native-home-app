// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/api';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CallService } from '../src/shared/composition/schema';
import { value } from '../src/preview2/evaluate';
import { useHouseStates } from '../src/preview2/useHouseStates';
import fixture from '../src/preview2/fixtures/home-domains.json';

vi.mock('../src/api', () => ({ request: vi.fn() }));
const document = compileCompositionDocument(structuredClone(fixture.document)).document;
const toggle = 'input_boolean.demo_entity_122';
const snapshot = (state: string) => ({
  mode: 'live', houseConfig: { schema: 2, hash: 'h', config: {} }, warnings: [],
  states: [{ entityId: toggle, state, name: 'Guest' }],
  currentUser: { id: 'user-1', name: 'Demo', isOwner: true, isAdmin: true },
});
const turnOn: CallService = { type: 'call-service', domain: 'input_boolean', service: 'turn_on', target: { entity_id: { type: 'literal', value: toggle } } };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(request).mockResolvedValue(snapshot('off')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useHouseStates', () => {
  it('reads /api/native-home once, exposes the house and viewer, and starts loading', async () => {
    const { result } = renderHook(() => useHouseStates(document));
    expect(result.current.status).toBe('loading');
    expect(result.current.environment.read('hc-guest-0', ['isOn']).status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(request).toHaveBeenCalledWith('/api/native-home', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result.current.environment.read('hc-guest-0', ['isOn'])).toEqual(value(false));
    expect(result.current.environment.viewer?.userId).toBe('user-1');
  });

  it('simulates a call in the overlay only, keeps it across a poll, and resets', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useHouseStates(document, { refreshSeconds: 1 }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let changed = false;
    act(() => { changed = result.current.simulateCall(turnOn); });
    expect(changed).toBe(true);
    expect(result.current.environment.read('hc-guest-0', ['isOn'])).toEqual(value(true));
    expect(result.current.house.states!.get(toggle)!.state).toBe('off');
    expect(vi.mocked(request).mock.calls.every(([path]) => path === '/api/native-home')).toBe(true);
    const reads = vi.mocked(request).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(vi.mocked(request).mock.calls.length).toBeGreaterThan(reads);
    expect(result.current.environment.read('hc-guest-0', ['isOn'])).toEqual(value(true));
    act(() => { changed = result.current.simulateCall(turnOn); });
    expect(changed).toBe(false);
    act(() => result.current.resetOverlay());
    expect(result.current.environment.read('hc-guest-0', ['isOn'])).toEqual(value(false));
  });

  it('holds set-local values, and keeps the last good house when a read fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useHouseStates(document, { refreshSeconds: 1 }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setLocal('rooms-tab', { type: 'string', value: 'rooms' }));
    expect(result.current.overlay.local['rooms-tab']).toEqual({ type: 'string', value: 'rooms' });
    vi.mocked(request).mockRejectedValue(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('offline');
    expect(result.current.environment.read('hc-guest-0', ['stateText'])).toEqual(value('Off'));
  });

  it('does not read while disabled and stops when unmounted', async () => {
    const disabled = renderHook(() => useHouseStates(document, { enabled: false }));
    expect(request).not.toHaveBeenCalled();
    expect(disabled.result.current.status).toBe('loading');
    disabled.unmount();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const live = renderHook(() => useHouseStates(document, { refreshSeconds: 1 }));
    await waitFor(() => expect(live.result.current.status).toBe('ready'));
    live.unmount();
    const reads = vi.mocked(request).mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(vi.mocked(request).mock.calls.length).toBe(reads);
  });

  it('refresh reads again at once', async () => {
    const { result } = renderHook(() => useHouseStates(document));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    vi.mocked(request).mockResolvedValue(snapshot('on'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.environment.read('hc-guest-0', ['isOn'])).toEqual(value(true)));
  });
});
