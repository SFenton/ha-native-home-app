import { randomBytes } from 'node:crypto';
import { entityIdSchema } from '../src/shared/schema';
import type { NativeHouseConfig } from './native-home';
import { HttpError } from './store';

const idleLifetime = 60_000;
const authorizationLifetime = 5000;
const maxManifestBytes = 64 * 1024;
const maxMediaBytes = 8 * 1024 * 1024;
const mediaFile = /^(?:master_playlist\.m3u8|playlist\.m3u8|init\.mp4|segment\/[0-9]{1,12}\.m4s)$/;

interface CameraConnection {
  base?: string;
  token?: string;
  websocketUrl?: string;
  credentials: string[];
  resolveIds: (signal: AbortSignal) => Promise<ReadonlySet<string>>;
}
interface Lease {
  entityId: string;
  transport: 'hls' | 'mjpeg';
  upstream: string;
  touched: number;
  requests: number;
  bytes: number;
  window: number;
  active: number;
  cancelled: AbortController;
}

function failure() { return new HttpError(502, 'Camera stream is unavailable or returned an unsupported response'); }

function isCameraId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('camera.') && entityIdSchema.safeParse(value).success;
}

export function nativeCameraIds(house: NativeHouseConfig): ReadonlySet<string> {
  const home = house.config.home;
  if (!home || typeof home !== 'object' || Array.isArray(home)) throw new HttpError(502, 'Invalid native camera configuration');
  if (home.cameras === undefined) return new Set();
  if (!Array.isArray(home.cameras) || home.cameras.length > 1000) throw new HttpError(502, 'Invalid native camera configuration');
  const ids = new Set<string>();
  for (const camera of home.cameras) {
    if (!camera || typeof camera !== 'object' || Array.isArray(camera) || !isCameraId(camera.entityId)) {
      throw new HttpError(502, 'Invalid native camera entity ID');
    }
    ids.add(camera.entityId);
  }
  return ids;
}

class MjpegFrames {
  private buffer: Buffer = Buffer.alloc(0);
  private delimiter?: string;
  private length?: number;
  private body = false;
  constructor(private readonly boundary: string) {}

  *push(chunk: Uint8Array): Generator<Buffer> {
    if (chunk.byteLength > maxMediaBytes + 4096) throw failure();
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (!this.body) {
        if (this.buffer.subarray(0, 2).toString() === '\r\n') this.buffer = this.buffer.subarray(2);
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) { if (this.buffer.length > 4096) throw failure(); return; }
        if (end > 4096) throw failure();
        const lines = this.buffer.toString('ascii', 0, end).split('\r\n');
        const first = lines.shift();
        // Core's still-stream implementation also uses an already-prefixed boundary.
        if (!this.delimiter && (first === `--${this.boundary}` || (this.boundary.startsWith('--') && first === this.boundary))) this.delimiter = first;
        if (!this.delimiter || first !== this.delimiter || lines.some(line => !/^[A-Za-z0-9-]+:[\t\x20-\x7e]*$/.test(line))) throw failure();
        const types = lines.filter(line => /^content-type:/i.test(line));
        const lengths = lines.filter(line => /^content-length:/i.test(line));
        if (types.length !== 1 || !/^content-type:[ \t]*image\/jpeg[ \t]*$/i.test(types[0]) || lengths.length > 1 ||
            lengths.some(line => !/^content-length:[ \t]*[0-9]{1,8}[ \t]*$/i.test(line))) throw failure();
        this.length = lengths.length ? Number(lengths[0].slice(lengths[0].indexOf(':') + 1).trim()) : undefined;
        if (this.length !== undefined && (!Number.isSafeInteger(this.length) || this.length < 4 || this.length > maxMediaBytes)) throw failure();
        this.buffer = this.buffer.subarray(end + 4);
        this.body = true;
      }
      const length = this.length ?? this.buffer.indexOf(`\r\n${this.delimiter}`);
      if (length < 0 || this.buffer.length < length + 2) {
        if (this.buffer.length > maxMediaBytes + 256) throw failure();
        return;
      }
      const frame = this.buffer.subarray(0, length);
      if (length > maxMediaBytes || frame[0] !== 255 || frame[1] !== 216 || frame.at(-2) !== 255 || frame.at(-1) !== 217 ||
          this.buffer.toString('ascii', length, length + 2) !== '\r\n') throw failure();
      this.buffer = this.buffer.subarray(length + 2);
      this.body = false; this.length = undefined;
      yield frame;
    }
  }
}
function cancelled(signal: AbortSignal) {
  return new HttpError(signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 504 : 503,
    signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'Camera stream timed out' : 'Camera stream was cancelled');
}

// Core camera/stream returns /api/hls/{token}/master_playlist.m3u8.
// The token-bearing path is kept only in the server lease, never in the browser.
export function readCameraStream(url: string, token: string, entityId: string, signal: AbortSignal): Promise<string> {
  if (!isCameraId(entityId)) return Promise.reject(new HttpError(404, 'Unknown native camera'));
  if (signal.aborted) return Promise.reject(cancelled(signal));
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try { socket = new WebSocket(url); }
    catch { reject(failure()); return; }
    let finished = false;
    let phase: 'challenge' | 'auth' | 'result' = 'challenge';
    const finish = (error?: HttpError, path?: string) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      socket.removeEventListener('message', message);
      socket.removeEventListener('error', failed);
      socket.removeEventListener('close', closed);
      socket.close();
      if (error) reject(error);
      else resolve(path!);
    };
    const abort = () => finish(cancelled(signal));
    const failed = () => finish(failure());
    const closed = () => finish(failure());
    const message = (event: MessageEvent) => {
      if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > 4096) { finish(failure()); return; }
      let payload: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(event.data);
        if (!value || typeof value !== 'object' || Array.isArray(value)) { finish(failure()); return; }
        payload = value as Record<string, unknown>;
      } catch { finish(failure()); return; }
      if (phase === 'challenge' && payload.type === 'auth_required') {
        phase = 'auth';
        socket.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (phase === 'auth' && payload.type === 'auth_ok') {
        phase = 'result';
        socket.send(JSON.stringify({ id: 1, type: 'camera/stream', entity_id: entityId, format: 'hls' }));
      } else if (phase === 'result' && payload.type === 'result' && payload.id === 1) {
        if (payload.success !== true) { finish(new HttpError(503, 'Live HLS is unavailable for this camera; no snapshot is being shown')); return; }
        const result = payload.result;
        const path = result && typeof result === 'object' && 'url' in result ? result.url : undefined;
        if (typeof path !== 'string' || !/^\/api\/hls\/[a-f0-9]{16,128}\/master_playlist\.m3u8$/.test(path)) { finish(failure()); return; }
        finish(undefined, path);
      } else { finish(failure()); }
    };
    socket.addEventListener('message', message);
    socket.addEventListener('error', failed);
    socket.addEventListener('close', closed);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Reconstruct only Core's standard HLS vocabulary; never forward arbitrary tags/URLs. */
export function rewriteCameraManifest(text: string): string {
  if (Buffer.byteLength(text) > maxManifestBytes || !text.startsWith('#EXTM3U\n')) throw failure();
  const result: string[] = [];
  let references = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '#EXTM3U' || line === '#EXT-X-INDEPENDENT-SEGMENTS' || line === '#EXT-X-DISCONTINUITY' || line === '#EXT-X-ENDLIST' ||
        /^#EXT-X-(?:VERSION|TARGETDURATION|MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE):[0-9]{1,12}$/.test(line) ||
        /^#EXTINF:[0-9]{1,6}(?:\.[0-9]{1,6})?,$/.test(line) ||
        /^#EXT-X-PROGRAM-DATE-TIME:[0-9T:Z.+-]{20,35}$/.test(line) ||
        /^#EXT-X-STREAM-INF:BANDWIDTH=[0-9]{1,12},CODECS="[A-Za-z0-9., -]{1,160}"$/.test(line)) {
      result.push(line);
    } else if (line === '#EXT-X-MAP:URI="init.mp4"') {
      result.push(line); references++;
    } else if (/^(?:\.\/)?(?:playlist\.m3u8|segment\/[0-9]{1,12}\.m4s)$/.test(line)) {
      result.push(line.replace(/^\.\//, '')); references++;
    } else if (/^#EXT-X-(?:PART-INF:PART-TARGET=[0-9.]+|SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=[0-9.]+|START:TIME-OFFSET=-[0-9.]+,PRECISE=YES)$/.test(line) ||
        /^#EXT-X-PART:DURATION=[0-9.]+,URI="\.\/segment\/[0-9]{1,12}\.[0-9]{1,12}\.m4s"(?:,INDEPENDENT=YES)?$/.test(line) ||
        /^#EXT-X-PRELOAD-HINT:TYPE=PART,URI="\.\/segment\/[0-9]{1,12}\.[0-9]{1,12}\.m4s"$/.test(line)) {
      // Serve completed segments as standard HLS, not blocking LL-HLS requests.
    } else { throw failure(); }
  }
  if (!references || result.length > 512) throw failure();
  return `${result.join('\n')}\n`;
}

export class CameraTransport {
  private readonly shutdown = new AbortController();
  private readonly leases = new Map<string, Lease>();
  private pending = 0;
  private active = 0;
  private starts = 0;
  private startWindow = Date.now();
  private authorized: ReadonlySet<string> = new Set();
  private authorizationExpires = 0;
  private readonly sweep = setInterval(() => this.expire(), 15_000);
  constructor(private readonly connection: CameraConnection) { this.sweep.unref(); }
  get signal() { return this.shutdown.signal; }

  private async authorize(entityId: string, signal: AbortSignal, refresh = false) {
    if (signal.aborted) throw cancelled(signal);
    if (refresh || Date.now() >= this.authorizationExpires) {
      const ids = await this.connection.resolveIds(signal);
      if (signal.aborted) throw cancelled(signal);
      this.authorized = ids;
      this.authorizationExpires = Date.now() + authorizationLifetime;
      for (const [id, lease] of this.leases) {
        if (!ids.has(lease.entityId)) { lease.cancelled.abort(); this.leases.delete(id); }
      }
    }
    if (!this.authorized.has(entityId)) throw new HttpError(404, 'Unknown native camera');
  }

  private expire() {
    for (const [id, lease] of this.leases) {
      if (lease.touched + idleLifetime <= Date.now()) {
        lease.cancelled.abort();
        this.leases.delete(id);
      }
    }
  }
  release(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(404, 'Unknown camera media');
    const lease = this.leases.get(id);
    if (!lease) return false;
    lease.cancelled.abort();
    this.leases.delete(id);
    return true;
  }
  async open(entityId: string, caller: AbortSignal, transport: 'hls' | 'mjpeg' = 'hls') {
    if (!isCameraId(entityId)) throw new HttpError(404, 'Unknown native camera');
    const { base, token, websocketUrl } = this.connection;
    if (!base || !token || !websocketUrl) throw new HttpError(503, 'Home Assistant is not configured');
    this.expire();
    if (Date.now() - this.startWindow >= 60_000) { this.starts = 0; this.startWindow = Date.now(); }
    if (++this.starts > 30 || this.pending >= 4 || this.leases.size + this.pending >= 16) throw new HttpError(429, 'Camera stream limit reached; wait one minute and retry');
    this.pending++;
    const signal = AbortSignal.any([caller, this.shutdown.signal, AbortSignal.timeout(20_000)]);
    try {
      await this.authorize(entityId, signal, true);
      const path = transport === 'hls' ? await readCameraStream(websocketUrl, token, entityId, signal) : `/api/camera_proxy_stream/${entityId}`;
      if (signal.aborted) throw cancelled(signal);
      const id = randomBytes(16).toString('hex');
      this.leases.set(id, {
        entityId, transport, upstream: transport === 'hls' ? path.slice(0, path.lastIndexOf('/') + 1) : path, touched: Date.now(),
        requests: 0, bytes: 0, window: Date.now(), active: 0, cancelled: new AbortController(),
      });
      return { transport, streamId: id, url: `api/cameras/streams/${id}/${transport === 'hls' ? 'master_playlist.m3u8' : 'live.mjpeg'}`, idleSeconds: idleLifetime / 1000 };
    } finally { this.pending--; }
  }

  async read(id: string, file: string, caller: AbortSignal): Promise<{ body: Buffer; type: string }> {
    if (!/^[a-f0-9]{32}$/.test(id) || !mediaFile.test(file)) throw new HttpError(404, 'Unknown camera media');
    this.expire();
    const lease = this.leases.get(id);
    if (!lease) throw new HttpError(410, 'Camera stream expired; reconnect to resume');
    if (lease.transport !== 'hls') throw new HttpError(404, 'Unknown camera media');
    if (Date.now() - lease.window >= 60_000) { lease.requests = 0; lease.bytes = 0; lease.window = Date.now(); }
    if (++lease.requests > 240 || lease.bytes >= 64 * 1024 * 1024 || lease.active >= 4 || this.active >= 16) {
      throw new HttpError(429, 'Camera media limit reached; wait one minute and retry');
    }

    const signal = AbortSignal.any([caller, this.shutdown.signal, lease.cancelled.signal, AbortSignal.timeout(20_000)]);
    lease.touched = Date.now(); lease.active++; this.active++;
    const manifest = file.endsWith('.m3u8');
    const maxBytes = manifest ? maxManifestBytes : maxMediaBytes;
    try {
      await this.authorize(lease.entityId, signal);
      const response = await fetch(`${this.connection.base}${lease.upstream}${file}`, {
        headers: { Authorization: `Bearer ${this.connection.token}` }, redirect: 'error', signal,
      });
      const type = response.headers.get('content-type')?.split(';')[0].toLowerCase();
      const validType = manifest ? ['application/vnd.apple.mpegurl', 'application/x-mpegurl'].includes(type ?? '')
        : ['video/mp4', 'video/iso.segment', 'application/octet-stream'].includes(type ?? '');
      if (!response.ok || !validType || Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel(); throw failure();
      }
      const reader = response.body?.getReader();
      if (!reader) throw failure();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength; lease.bytes += value.byteLength;
          if (bytes > maxBytes || lease.bytes > 64 * 1024 * 1024) { await reader.cancel(); throw failure(); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const body = Buffer.concat(chunks);
      const privateValues = [...this.connection.credentials, lease.upstream.split('/')[3], this.connection.base];
      if (privateValues.some(secret => secret && body.includes(secret))) throw failure();
      if (manifest) return { body: Buffer.from(rewriteCameraManifest(body.toString('utf8'))), type: 'application/vnd.apple.mpegurl' };
      const box = body.toString('ascii', 4, 8);
      if (body.length < 8 || !(file === 'init.mp4' ? ['ftyp', 'moov'] : ['styp', 'moof']).includes(box)) throw failure();
      return { body, type: file === 'init.mp4' ? 'video/mp4' : 'video/iso.segment' };
    } catch (error) {
      if (signal.aborted) throw cancelled(signal);
      if (error instanceof HttpError) throw error;
      throw failure();
    } finally { lease.active--; this.active--; }
  }
  async *mjpeg(id: string, caller: AbortSignal): AsyncGenerator<Buffer> {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(404, 'Unknown camera media');
    this.expire();
    const lease = this.leases.get(id);
    if (!lease) throw new HttpError(410, 'Camera stream expired; reconnect to resume');
    if (lease.transport !== 'mjpeg') throw new HttpError(404, 'Unknown camera media');
    if (Date.now() - lease.window >= 60_000) { lease.requests = 0; lease.bytes = 0; lease.window = Date.now(); }
    if (++lease.requests > 240 || lease.bytes >= 64 * 1024 * 1024 || lease.active || this.active >= 16) throw new HttpError(429, 'Camera media limit reached; wait one minute and retry');
    const stopped = new AbortController();
    const timeout = () => stopped.abort(new DOMException('MJPEG camera timed out', 'TimeoutError'));
    let timer = setTimeout(timeout, 20_000);
    const signal = AbortSignal.any([caller, this.shutdown.signal, lease.cancelled.signal, stopped.signal]);
    lease.touched = Date.now(); lease.active++; this.active++;
    try {
      await this.authorize(lease.entityId, signal);
      const response = await fetch(`${this.connection.base}${lease.upstream}`, {
        headers: { Authorization: `Bearer ${this.connection.token}` }, redirect: 'error', signal,
      });
      const type = response.headers.get('content-type');
      const boundary = type?.match(/^multipart\/x-mixed-replace\s*;\s*boundary=(?:"([A-Za-z0-9_-]{1,70})"|([A-Za-z0-9_-]{1,70}))\s*$/i);
      if (!response.ok || !boundary || !response.body) throw failure();
      const decoder = new MjpegFrames(boundary[1] ?? boundary[2]);
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) throw new HttpError(503, 'Live MJPEG stream ended; reconnect to resume');
          if (Date.now() - lease.window >= 60_000) { lease.requests = 0; lease.bytes = 0; lease.window = Date.now(); }
          lease.bytes += value.byteLength;
          if (lease.bytes > 64 * 1024 * 1024) throw new HttpError(429, 'Camera media bandwidth limit reached; wait one minute and retry');
          for (const frame of decoder.push(value)) {
            await this.authorize(lease.entityId, signal);
            if ([...this.connection.credentials, this.connection.base].some(secret => secret && frame.includes(secret))) throw failure();
            clearTimeout(timer); timer = setTimeout(timeout, 20_000);
            lease.touched = Date.now();
            yield Buffer.concat([Buffer.from(`--studio-camera\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`), frame, Buffer.from('\r\n')]);
          }
        }
      } finally { reader.releaseLock(); }
    } catch (error) {
      if (signal.aborted) throw cancelled(signal);
      if (error instanceof HttpError) throw error;
      throw failure();
    } finally { clearTimeout(timer); stopped.abort(); lease.active--; this.active--; }
  }
  close() {
    clearInterval(this.sweep);
    this.shutdown.abort();
    this.leases.clear();
  }
}
