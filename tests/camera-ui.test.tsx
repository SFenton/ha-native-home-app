// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CameraMedia from '../src/CameraMedia';

const hls = vi.hoisted(() => ({
  supported: vi.fn(() => true),
  instances: [] as Array<{
    handlers: Record<string, (event: string, data: Record<string, unknown>) => void>;
    destroy: ReturnType<typeof vi.fn>;
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('hls.js', () => ({
  default: class {
    static isSupported = hls.supported;
    static Events = { MANIFEST_PARSED: 'manifest', BUFFER_CODECS: 'codecs', ERROR: 'error' };
    handlers: Record<string, (event: string, data: Record<string, unknown>) => void> = {};
    destroy = vi.fn();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    on(event: string, callback: (event: string, data: Record<string, unknown>) => void) { this.handlers[event] = callback; }
    constructor() { hls.instances.push(this); }
  },
}));
const observations = new Set<(entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void>();
const streamId = 'c'.repeat(32);
const camera = 'camera.front_door_camera';
const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
const streamResponse = () => new Response(JSON.stringify({ transport: 'hls', streamId }), { status: 200 });
function visible(value = true) {
  act(() => { for (const observer of observations) observer([{ isIntersecting: value, intersectionRatio: value ? 1 : 0 }]); });
}
async function connected(audio = false) {
  await waitFor(() => expect(hls.instances.length).toBeGreaterThan(0));
  const instance = hls.instances.at(-1)!;
  await act(async () => instance.handlers.manifest('manifest', { audio }));
  const video = screen.getByLabelText(`Live camera ${camera}`) as HTMLVideoElement;
  fireEvent.playing(video);
  return { instance, video };
}
beforeEach(() => {
  hls.instances.splice(0); hls.supported.mockReturnValue(true); observations.clear();
  vi.stubGlobal('fetch', vi.fn(async () => streamResponse()));
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void) {}
    observe() { observations.add(this.callback); }
    disconnect() { observations.delete(this.callback); }
  });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL {
    static createObjectURL = vi.fn(() => 'blob:synthetic-camera-frame');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
  else Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
});

describe('consent-gated browser camera media', () => {
  it('makes no private requests without consent or visibility, aborts/unloads on revocation, and uses an Ingress-relative source', async () => {
    const { rerender } = render(<CameraMedia entityId={camera} enabled={false}/>);
    visible();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Live camera reads are off/)).toBeTruthy();
    rerender(<CameraMedia entityId={camera} enabled/>);
    const { instance, video } = await connected();
    expect(fetch).toHaveBeenCalledWith(`./api/cameras/${camera}/stream`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(instance.loadSource).toHaveBeenCalledWith(`./api/cameras/streams/${streamId}/master_playlist.m3u8`);
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    rerender(<CameraMedia entityId={camera} enabled={false}/>);
    expect(signal.aborted).toBe(true);
    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(video.getAttribute('src')).toBeNull();
    expect(video.pause).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(`./api/cameras/streams/${streamId}`, expect.objectContaining({ method: 'DELETE', body: '{}', keepalive: true }));
    rerender(<CameraMedia entityId={camera} enabled/>);
    visible(false);
    await act(async () => undefined);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenLastCalledWith(`./api/cameras/streams/${streamId}`, expect.objectContaining({ method: 'DELETE', keepalive: true }));
    expect(hls.instances).toHaveLength(1);
  });

  it('stops private playback when hidden/offscreen/unmounted, and reopening always starts muted', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const { unmount } = render(<CameraMedia entityId={camera} enabled viewer controls={['sound']}/>);
    visible();
    const first = await connected(true);
    fireEvent.click(screen.getByRole('button', { name: 'Unmute camera sound' }));
    expect(first.video.muted).toBe(false);
    hidden.mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(first.instance.destroy).toHaveBeenCalledOnce();
    expect(screen.getByText('Camera paused while not visible.')).toBeTruthy();
    const count = vi.mocked(fetch).mock.calls.length;
    expect(fetch).toHaveBeenCalledTimes(count);
    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(hls.instances).toHaveLength(2));
    const second = await connected(true);
    expect(second.video.muted).toBe(true);
    visible(false);
    expect(second.instance.destroy).toHaveBeenCalledOnce();
    visible();
    await waitFor(() => expect(hls.instances).toHaveLength(3));
    unmount();
    expect(hls.instances[2].destroy).toHaveBeenCalledOnce();
    expect(observations.size).toBe(0);
  });

  it('renders only configured controls below media, with truthful pending/simulation results and unavailable audio', async () => {
    const { container, rerender } = render(<CameraMedia entityId={camera} enabled viewer aspectRatio={4 / 3} controls={['snapshot', 'sound']}/>);
    visible();
    const { video } = await connected();
    expect(screen.queryByRole('button', { name: 'Record (simulated)' })).toBeNull();
    expect(screen.getByText('Sound unavailable: no audio track detected by this browser.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unmute camera sound' }).hasAttribute('disabled')).toBe(true);
    expect(video.parentElement!.style.aspectRatio).toBe(String(4 / 3));
    expect(container.querySelector('.camera-media-stage')!.nextElementSibling!.className).toBe('camera-media-controls');
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot (simulated)' }));
    expect(screen.getByRole('button', { name: 'Snapshot (simulated)' }).getAttribute('aria-busy')).toBe('true');
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByText('Snapshot simulated. No actual photo was saved.')).toBeTruthy();
    rerender(<CameraMedia entityId={camera} enabled viewer controls={['snapshot', 'sound', 'record']}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Record (simulated)' }));
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByRole('button', { name: 'Stop (simulated)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/No actual recording is being saved or Home Assistant recording invoked/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop (simulated)' }));
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByText(/Recording simulation stopped/)).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('controls actual browser audio, never calling a Home Assistant action endpoint', async () => {
    render(<CameraMedia entityId={camera} enabled viewer controls={['sound']}/>);
    visible();
    const { video, instance } = await connected(false);
    act(() => instance.handlers.codecs('codecs', { audiovideo: { codec: 'avc1.640028,mp4a.40.2' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Unmute camera sound' }));
    expect(video.muted).toBe(false);
    expect(screen.getByText('Camera sound on.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mute camera sound' }));
    expect(video.muted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('distinguishes buffering from live video and bounds stalled playback', async () => {
    render(<CameraMedia entityId={camera} enabled/>);
    visible();
    const { video, instance } = await connected();
    vi.useFakeTimers();
    fireEvent.waiting(video);
    expect(screen.queryByText('Live HLS')).toBeNull();
    expect(screen.getByText('Connecting to live camera...')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(45_000));
    expect(screen.getByRole('alert').textContent).toContain('HLS and MJPEG could not be played');
    expect(instance.destroy).toHaveBeenCalledOnce();
    fireEvent.playing(video);
    expect(screen.queryByText('Live HLS')).toBeNull();
  });

  it('shows upstream and fatal playback errors with explicit reconnect instead of silently showing a snapshot', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Live HLS is unavailable for this camera; no snapshot is being shown' }), { status: 503 }));
    render(<CameraMedia entityId={camera} enabled viewer controls={['snapshot', 'record']}/>);
    visible();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('HLS and MJPEG could not be played'));
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    const { instance } = await connected();
    act(() => instance.handlers.error('error', { fatal: true }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('HLS and MJPEG could not be played'));
    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(document.querySelector('img')!.getAttribute('src')).toBeNull();
  });

  it('supports native HLS and attempts genuine MJPEG instead of a static image on browsers without HLS', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    const { unmount } = render(<CameraMedia entityId={camera} enabled viewer/>);
    visible();
    const video = screen.getByLabelText(`Live camera ${camera}`) as HTMLVideoElement;
    await waitFor(() => expect(video.getAttribute('src')).toBe(`./api/cameras/streams/${streamId}/master_playlist.m3u8`));
    expect(hls.instances).toHaveLength(0);
    fireEvent.playing(video);
    unmount();
    vi.mocked(fetch).mockClear();
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('');
    hls.supported.mockReturnValue(false);
    render(<CameraMedia entityId={camera} enabled/>);
    visible();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('HLS and MJPEG could not be played'));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`./api/cameras/${camera}/mjpeg`, expect.any(Object));
  });

  it.each(['startup', 'playback', 'decode-stall'])('handles HLS %s fallback, unavailable audio and frame cleanup', async failure => {
    let frames!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { frames = controller; } });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'DELETE') return new Response('{"released":true}');
      if (url.endsWith('/stream')) return failure !== 'playback' ? new Response('{"error":"HLS unavailable"}', { status: 503 }) : streamResponse();
      if (url.endsWith('/mjpeg')) return new Response(JSON.stringify({ transport: 'mjpeg', streamId }));
      init?.signal?.addEventListener('abort', () => frames.error(new DOMException('Aborted', 'AbortError')), { once: true });
      return new Response(body, { headers: { 'Content-Type': 'multipart/x-mixed-replace; boundary=studio-camera' } });
    });
    const { rerender } = render(<CameraMedia entityId={camera} enabled viewer controls={['sound', 'record']}/>);
    visible();
    if (failure === 'playback') {
      const { instance } = await connected(true);
      act(() => instance.handlers.error('error', { fatal: true }));
    }
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`./api/cameras/streams/${streamId}/live.mjpeg`, expect.any(Object)));
    let finishDecode!: () => void;
    if (failure === 'decode-stall') {
      vi.mocked(HTMLImageElement.prototype.decode).mockReturnValue(new Promise<void>(resolve => { finishDecode = resolve; }));
      vi.useFakeTimers();
    }
    const data = new TextEncoder().encode('--studio-camera\r\nContent-Type: image/jpeg\r\nContent-Length: 4\r\n\r\n');
    const jpeg = new Uint8Array([...data, 255, 216, 255, 217, 13, 10]);
    await act(async () => { frames.enqueue(jpeg.subarray(0, 9)); frames.enqueue(jpeg.subarray(9)); });
    if (failure === 'decode-stall') {
      await act(async () => vi.advanceTimersByTime(25_000));
      expect(screen.getByRole('alert').textContent).toContain('stopped receiving frames');
      await act(async () => finishDecode());
      expect(screen.getByRole('alert').textContent).toContain('stopped receiving frames');
      expect(screen.queryByText('Live MJPEG (no audio)')).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-camera-frame');
      return;
    }
    expect(screen.getByText('Live MJPEG (no audio)')).toBeTruthy();
    expect(screen.getByText('Sound unavailable: MJPEG carries video frames only, without audio.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unmute camera sound' }).hasAttribute('disabled')).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(screen.getByAltText(`Live MJPEG camera ${camera}`).getAttribute('src')).toBe('blob:synthetic-camera-frame');
    expect(screen.getByRole('button', { name: 'Record (simulated)' })).toBeTruthy();
    const count = vi.mocked(fetch).mock.calls.length;
    await act(async () => rerender(<CameraMedia entityId={camera} enabled={false} viewer controls={['sound']}/>));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-camera-frame');
    expect(screen.getByAltText(`Live MJPEG camera ${camera}`).getAttribute('src')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(count + 1);
    expect(fetch).toHaveBeenLastCalledWith(`./api/cameras/streams/${streamId}`, expect.objectContaining({ method: 'DELETE', keepalive: true }));
  });
});
