import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Camera, Circle, LoaderCircle, Volume2, VolumeX } from 'lucide-react';
import { apiUrl, request } from './api';
import './CameraMedia.css';

export interface CameraMediaProps {
  entityId: string;
  enabled: boolean;
  viewer?: boolean;
  aspectRatio?: number;
  controls?: Array<'snapshot' | 'sound' | 'record'>;
  onFeedback?: (message: string) => void;
}

type Playback = 'loading' | 'playing' | 'paused' | 'error';
type Audio = 'unknown' | 'available' | 'unavailable';

function nativeAudio(video: HTMLVideoElement): Audio {
  if ('audioTracks' in video && video.audioTracks && typeof video.audioTracks === 'object' && 'length' in video.audioTracks) {
    return typeof video.audioTracks.length === 'number' && video.audioTracks.length > 0 ? 'available' : 'unavailable';
  }
  return 'unavailable';
}

export default function CameraMedia({ entityId, enabled, viewer = false, aspectRatio = 16 / 9, controls = [], onFeedback }: CameraMediaProps) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(() => !document.hidden);
  const [attempt, setAttempt] = useState(0);
  const [playback, setPlayback] = useState<Playback>('loading');
  const [error, setError] = useState('');
  const [audio, setAudio] = useState<Audio>('unknown');
  const [muted, setMuted] = useState(true);
  const [transport, setTransport] = useState<'hls' | 'mjpeg'>('hls');
  const [pending, setPending] = useState<'snapshot' | 'record'>();
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState('');
  const simulation = useRef<ReturnType<typeof setTimeout>>(undefined);
  const active = enabled && visible && foreground;

  useEffect(() => {
    const changed = () => setForeground(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    // Fail closed on old browsers without visibility observation.
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0));
    });
    if (root.current) observer?.observe(root.current);
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', changed); };
  }, []);

  useEffect(() => {
    const media = video.current;
    if (!active || !media) return;
    const cancelled = new AbortController();
    let hls: Hls | undefined;
    let loading: ReturnType<typeof setTimeout> | undefined;
    let failedPlayback = false;
    let fallbackStarted = false;
    let terminal = false;
    let mjpegAbort: AbortController | undefined;
    let imageUrl: string | undefined;
    let hlsLease: string | undefined;
    let mjpegLease: string | undefined;
    const release = (id: string | undefined) => {
      if (!id) return;
      void request(`api/cameras/streams/${id}`, { method: 'DELETE', body: '{}', keepalive: true }).catch(() => {
        console.warn('Camera session cleanup failed; the server will release it after its idle timeout.');
      });
    };
    const stopHls = () => {
      failedPlayback = true;
      const previous = hls; hls = undefined; previous?.destroy();
      media.pause(); media.removeAttribute('src'); media.load();
      release(hlsLease); hlsLease = undefined;
    };
    const failFinal = (message: string) => {
      if (cancelled.signal.aborted || terminal) return;
      terminal = true;
      clearTimeout(loading);
      mjpegAbort?.abort();
      setError(message); setPlayback('error'); setAudio('unavailable');
      stopHls();
      release(mjpegLease); mjpegLease = undefined;
      image.current?.removeAttribute('src');
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = undefined;
    };
    const fallback = async () => {
      if (fallbackStarted || cancelled.signal.aborted) return;
      fallbackStarted = true;
      clearTimeout(loading); stopHls();
      setTransport('mjpeg'); setAudio('unavailable'); setPlayback('loading'); setError('');
      mjpegAbort = new AbortController();
      const signal = AbortSignal.any([cancelled.signal, mjpegAbort.signal]);
      const deadline = () => {
        clearTimeout(loading);
        loading = setTimeout(() => failFinal('Live MJPEG stopped receiving frames. Reconnect to retry.'), 25_000);
      };
      deadline();
      try {
        const stream = await request<{ transport: string; streamId: string }>(`api/cameras/${encodeURIComponent(entityId)}/mjpeg`, { signal });
        if (stream.transport !== 'mjpeg' || !/^[a-f0-9]{32}$/.test(stream.streamId)) throw new Error('Invalid local MJPEG stream response.');
        if (signal.aborted || terminal) { release(stream.streamId); return; }
        mjpegLease = stream.streamId;
        const response = await fetch(apiUrl(`api/cameras/streams/${stream.streamId}/live.mjpeg`), { signal });
        if (!response.ok || response.headers.get('content-type') !== 'multipart/x-mixed-replace; boundary=studio-camera' || !response.body) {
          throw new Error('Live MJPEG is unavailable for this camera. Reconnect to retry.');
        }
        const reader = response.body.getReader();
        let buffer: Uint8Array<ArrayBuffer> = new Uint8Array();
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) throw new Error('Live MJPEG stream ended. Reconnect to resume.');
            if (value.byteLength + buffer.length > 8 * 1024 * 1024 + 4096) throw new Error('MJPEG frame exceeds the browser limit.');
            const combined = new Uint8Array(buffer.length + value.byteLength);
            combined.set(buffer); combined.set(value, buffer.length); buffer = combined;
            for (;;) {
              const end = buffer.findIndex((byte, index) => byte === 13 && buffer[index + 1] === 10 && buffer[index + 2] === 13 && buffer[index + 3] === 10);
              if (end < 0) { if (buffer.length > 4096) throw new Error('Invalid local MJPEG frame.'); break; }
              const header = decoder.decode(buffer.subarray(0, end));
              const match = header.match(/^--studio-camera\r\nContent-Type: image\/jpeg\r\nContent-Length: ([0-9]{1,8})$/);
              const length = match ? Number(match[1]) : 0;
              if (!length || length > 8 * 1024 * 1024) throw new Error('Invalid local MJPEG frame.');
              if (buffer.length < end + 4 + length + 2) break;
              if (buffer[end + 4 + length] !== 13 || buffer[end + 5 + length] !== 10) throw new Error('Invalid local MJPEG boundary.');
              const frame = buffer.slice(end + 4, end + 4 + length);
              buffer = buffer.slice(end + 6 + length);
              const next = URL.createObjectURL(new Blob([frame], { type: 'image/jpeg' }));
              const previous = imageUrl;
              imageUrl = next;
              if (cancelled.signal.aborted || !image.current) { URL.revokeObjectURL(next); return; }
              deadline();
              image.current.src = next;
              try { await image.current.decode(); }
              finally { if (previous) URL.revokeObjectURL(previous); }
              if (signal.aborted || terminal) return;
              deadline();
              setPlayback('playing');
            }
          }
        } finally {
          try { await reader.cancel(); }
          finally { reader.releaseLock(); }
        }
      } catch {
        failFinal('Live camera playback is unavailable: HLS and MJPEG could not be played. Reconnect to retry.');
      }
    };
    const fail = (_message: string) => {
      if (!cancelled.signal.aborted) void fallback();
    };
    const play = async () => {
      try { await media.play(); }
      catch {
        if (!cancelled.signal.aborted && !failedPlayback) {
          setPlayback('paused');
          setError('Playback was blocked by the browser. Use Play to resume live video.');
        }
      }
    };
    const playing = () => {
      if (failedPlayback || cancelled.signal.aborted) return;
      clearTimeout(loading); setPlayback('playing'); setError('');
    };
    const paused = () => { if (!cancelled.signal.aborted && !failedPlayback) setPlayback('paused'); };
    const waiting = () => {
      if (failedPlayback) return;
      setPlayback('loading');
      clearTimeout(loading);
      loading = setTimeout(() => fail('Camera playback stopped receiving video. Reconnect to try again.'), 45_000);
    };
    const volume = () => setMuted(media.muted);
    const failed = () => fail('Camera playback failed. The camera may be offline or its codec unsupported in this browser.');
    const metadata = () => { if (!hls && !failedPlayback) setAudio(nativeAudio(media)); };
    media.addEventListener('playing', playing);
    media.addEventListener('pause', paused);
    media.addEventListener('waiting', waiting);
    media.addEventListener('volumechange', volume);
    media.addEventListener('error', failed);
    media.addEventListener('loadedmetadata', metadata);
    setTransport('hls'); setPlayback('loading'); setError(''); setAudio('unknown'); setMuted(true);
    media.muted = true;
    const start = async () => {
      const nativeHls = Boolean(media.canPlayType('application/vnd.apple.mpegurl'));
      if (!nativeHls && !Hls.isSupported()) {
        fail('Live video is unavailable in this browser.');
        return;
      }
      try {
        const stream = await request<{ transport: string; streamId: string }>(`api/cameras/${encodeURIComponent(entityId)}/stream`, { signal: cancelled.signal });
        if (stream.transport !== 'hls' || !/^[a-f0-9]{32}$/.test(stream.streamId)) throw new Error('Invalid local camera stream response.');
        if (cancelled.signal.aborted || failedPlayback) { release(stream.streamId); return; }
        hlsLease = stream.streamId;
        const url = apiUrl(`api/cameras/streams/${stream.streamId}/master_playlist.m3u8`);
        loading = setTimeout(() => fail('Camera playback did not start. Reconnect to try again.'), 45_000);
        if (nativeHls) {
          media.src = url;
          await play();
        } else {
          hls = new Hls({ lowLatencyMode: false, maxBufferLength: 15, backBufferLength: 0, maxMaxBufferLength: 30 });
          hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
            if (failedPlayback || cancelled.signal.aborted) return;
            setAudio(data.audio ? 'available' : 'unavailable');
            void play();
          });
          hls.on(Hls.Events.BUFFER_CODECS, (_event, data) => {
            if (failedPlayback || cancelled.signal.aborted) return;
            const muxedAudio = data.audiovideo && /(?:mp4a|opus|ac-3|ec-3|alac|flac)/i.test(data.audiovideo.codec ?? '');
            setAudio(data.audio || muxedAudio ? 'available' : 'unavailable');
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) fail('Live camera playback failed. Reconnect to retry; the camera or codec may be unavailable.');
          });
          hls.loadSource(url);
          hls.attachMedia(media);
        }
      } catch (reason) {
        if (!cancelled.signal.aborted) fail(reason instanceof Error ? reason.message : 'Camera stream could not be opened.');
      }
    };
    void start();
    return () => {
      cancelled.abort();
      mjpegAbort?.abort();
      clearTimeout(loading);
      media.removeEventListener('playing', playing);
      media.removeEventListener('pause', paused);
      media.removeEventListener('waiting', waiting);
      media.removeEventListener('volumechange', volume);
      media.removeEventListener('error', failed);
      media.removeEventListener('loadedmetadata', metadata);
      hls?.destroy();
      media.pause(); media.removeAttribute('src'); media.load();
      release(hlsLease); hlsLease = undefined;
      release(mjpegLease); mjpegLease = undefined;
      image.current?.removeAttribute('src');
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [active, entityId, attempt]);

  useEffect(() => {
    setRecording(false); setPending(undefined); setResult('');
    clearTimeout(simulation.current);
    return () => clearTimeout(simulation.current);
  }, [entityId, enabled, active]);

  const simulate = (control: 'snapshot' | 'record') => {
    if (pending) return;
    setPending(control);
    setResult(`${control === 'snapshot' ? 'Snapshot' : 'Recording'} simulation pending...`);
    simulation.current = setTimeout(() => {
      setPending(undefined);
      if (control === 'snapshot') {
        setResult('Snapshot simulated.');
        onFeedback?.('Snapshot simulated.');
      }
      else {
        setRecording(!recording);
        const message = recording ? 'Recording stopped (simulated).'
          : 'Recording started (simulated).';
        setResult(message);
        onFeedback?.(message);
      }
    }, 350);
  };
  const sound = () => {
    if (!video.current || audio !== 'available' || !active) return;
    const next = !video.current.muted;
    video.current.muted = next;
    setMuted(next);
    setResult(next ? 'Camera sound muted.' : 'Camera sound on.');
  };
  const status = !enabled ? 'Live camera reads are off. Enable live data to connect.'
    : !foreground || !visible ? 'Camera paused while not visible.'
      : playback === 'error' ? error
        : playback === 'loading' ? transport === 'mjpeg' ? 'Connecting to live MJPEG camera...' : 'Connecting to live camera...'
          : playback === 'paused' ? error || 'Live camera paused.' : transport === 'mjpeg' ? 'Live MJPEG (no audio)' : 'Live HLS';
  const configured = [...new Set(controls)];

  return <div ref={root} className={`camera-media ${viewer ? 'camera-media-viewer' : 'camera-media-card'}`}>
    <div className="camera-media-stage" style={{ aspectRatio: viewer && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1 / .78 }}>
      <video ref={video} hidden={transport === 'mjpeg'} aria-label={`Live camera ${entityId}`} muted={muted} autoPlay playsInline preload="none" disablePictureInPicture/>
      <img ref={image} hidden={transport !== 'mjpeg'} alt={`Live MJPEG camera ${entityId}`}/>
      {(!active || playback !== 'playing') && <div className="camera-media-placeholder">
        {active && playback === 'loading' ? <LoaderCircle aria-hidden="true" className="camera-media-spinner"/> : <Camera aria-hidden="true"/>}
        <span role={playback === 'error' && active ? 'alert' : 'status'}>{status}</span>
        {active && playback === 'error' && <button type="button" onClick={event => { event.stopPropagation(); setAttempt(value => value + 1); }}>Reconnect</button>}
        {active && playback === 'paused' && <button type="button" onClick={async event => {
          event.stopPropagation();
          try { await video.current?.play(); }
          catch { setError('The browser could not resume camera playback. Open the viewer or reconnect to try again.'); }
        }}>Play</button>}
      </div>}
      {active && playback === 'playing' && <span className="camera-media-diagnostic" role="status">{transport === 'mjpeg' ? 'Live MJPEG (no audio)' : 'Live HLS'}</span>}
    </div>
    {viewer && configured.length > 0 && <div className="camera-media-controls" onClick={event => event.stopPropagation()}>
      {configured.map(control => {
        const Icon = control === 'snapshot' ? Camera : control === 'record' ? Circle : muted ? VolumeX : Volume2;
        const label = control === 'snapshot' ? 'Snapshot' : control === 'record' ? recording ? 'Stop' : 'Record' : 'Sound';
        const unavailable = control === 'sound' && (!active || transport === 'mjpeg' || audio !== 'available' || playback === 'error');
        return <button key={control} type="button" className="camera-media-control" disabled={unavailable || Boolean(pending)}
          aria-label={control === 'sound' ? muted ? 'Unmute camera sound' : 'Mute camera sound' : `${label} (simulated)`}
          aria-pressed={control === 'record' ? recording : control === 'sound' ? !muted : undefined}
          aria-busy={pending === control}
          onClick={() => control === 'sound' ? sound() : simulate(control)}>
          <span className="camera-media-control-circle">{pending === control ? <LoaderCircle aria-hidden="true" className="camera-media-spinner"/> : <Icon aria-hidden="true"/>}</span>
          <span>{label}</span>
        </button>;
      })}
      <div className="camera-media-control-status">
        {configured.includes('sound') && <p>{!active ? 'Sound unavailable until live playback starts.' : playback === 'error' ? 'Sound unavailable while playback is disconnected.' : transport === 'mjpeg' ? 'Sound unavailable: MJPEG carries video frames only, without audio.' : audio === 'available' ? muted ? 'Sound muted' : 'Sound on' : audio === 'unknown' ? 'Checking camera audio...' : 'Sound unavailable: no audio track detected by this browser.'}</p>}
        {(configured.includes('snapshot') || configured.includes('record')) && <p>Snapshot and Record are simulated.</p>}
        <p role="status" aria-live="polite">{result}</p>
      </div>
    </div>}
  </div>;
}
