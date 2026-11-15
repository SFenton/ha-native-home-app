import { createHash } from 'node:crypto';
import type { CompositionPublication } from '../src/shared/composition/schema';
import { HttpError } from './store';

/** Contract: `fenton_home` integration 1.4.0+, `custom_components/fenton_home/ui_publication.py`. */
export const MAX_HA_MESSAGE_BYTES = 8 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const ASSET_TIMEOUT_MS = 60_000;
const shaPattern = /^[a-f0-9]{64}$/;

/** One stored publication as `fenton_home/ui_publication/get` reports it, never with the envelope. */
export interface HaPublicationEntry {
  revision: number;
  publishedAt: string;
  publishedBy: string | null;
  envelopeSha256: string;
  capabilities: string[];
}
export interface HaPublicationSummary {
  epoch: string;
  current: HaPublicationEntry | null;
  history: HaPublicationEntry[];
  storedAssets: number;
}
export interface HaPublishResult {
  epoch: string;
  revision: number;
  envelopeSha256: string;
  uploadedAssets: number;
  skippedAssets: number;
}
/** Reads published asset bytes by their content-addressed Studio name (`<sha256>.png|jpg`). */
export type AssetSource = (name: string) => Promise<{ bytes: Buffer }>;

interface Transport {
  base?: string;
  token?: string;
  websocketUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reasons `ui_publication/publish` reports through `invalid_format`, in the Studio's words. */
const publishReasons: Record<string, [number, string]> = {
  too_large: [422, 'The publication is larger than Home Assistant accepts (2 MiB plus 64 KiB of envelope).'],
  not_json: [422, 'The publication is not plain JSON that Home Assistant can store.'],
  too_deep: [422, 'The publication is nested too deeply for Home Assistant.'],
  bad_capabilities: [422, 'The publication capability list is malformed.'],
  bad_asset_manifest_hash: [422, 'The asset manifest hash is malformed. Save the draft again and retry.'],
  bad_document_hash: [422, 'The document hash is malformed. Save the draft again and retry.'],
  bad_document: [422, 'The publication document is malformed.'],
  bad_assets: [422, 'The publication asset list is malformed.'],
  missing_asset: [409, 'Home Assistant does not hold every image this publication references. Publish again.'],
};
const assetReasons: Record<string, [number, string]> = {
  hash_mismatch: [422, 'Home Assistant received different image bytes than the Studio hash expects. Re-upload the image.'],
  bad_hash: [422, 'An image hash is malformed.'],
  empty: [422, 'An image is empty.'],
  too_large: [413, 'An image is larger than Home Assistant accepts (15 MiB each, 64 MiB in total).'],
  unsupported_type: [415, 'Home Assistant accepts only JPEG, PNG, HEIC and WebP images.'],
  store_full: [507, 'Home Assistant has no room for more published images (64 MiB in total). Remove unused images and retry.'],
};
const unavailable = 'Home Assistant does not know the fenton_home UI publication commands. Install fenton_home 1.4.0 or newer and restart Home Assistant.';
const adminOnly = 'Home Assistant refused the request: publishing needs an administrator.';

/** Maps one websocket error to a Studio error. Home Assistant's own message text is never forwarded. */
export function mapCommandError(command: string, code: unknown, message: unknown): HttpError {
  if (code === 'unauthorized') return new HttpError(502, adminOnly);
  if (code === 'unknown_command') return new HttpError(502, unavailable);
  if (command === 'publish' && code === 'invalid_format' && typeof message === 'string') {
    const known = publishReasons[message];
    if (known) return new HttpError(known[0], known[1], { reason: message });
  }
  if (command === 'rollback' && code === 'not_found') {
    return new HttpError(404, 'That revision is no longer in the Home Assistant history. Reload the history.', { reason: 'unknown_revision' });
  }
  return new HttpError(502, `Home Assistant rejected the ${command} request${typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? ` (${code})` : ''}.`);
}

/** One authenticated websocket request, then the socket closes. */
async function command(transport: Transport, name: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  if (!transport.websocketUrl || !transport.token) throw new HttpError(503, 'Home Assistant is not configured');
  const token = transport.token, type = `fenton_home/ui_publication/${name}`;
  const socket = (() => {
    try { return new WebSocket(transport.websocketUrl); }
    catch { throw new HttpError(502, 'Home Assistant WebSocket connection failed'); }
  })();
  return new Promise<unknown>((resolve, reject) => {
    let settled = false, authenticated = false;
    const timer = setTimeout(() => finish(new HttpError(504, 'Home Assistant did not answer in time')), COMMAND_TIMEOUT_MS);
    const finish = (error?: HttpError, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      try { socket.close(); } catch { /* already closed */ }
      if (error) reject(error); else resolve(value);
    };
    const aborted = () => finish(new HttpError(503, 'The Home Assistant request was cancelled'));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    socket.addEventListener('error', () => finish(new HttpError(502, 'Home Assistant WebSocket connection failed')));
    socket.addEventListener('close', () => finish(new HttpError(502, 'Home Assistant WebSocket closed before answering')));
    socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > MAX_HA_MESSAGE_BYTES) {
        finish(new HttpError(502, 'Home Assistant sent an invalid or oversized message')); return;
      }
      let message: unknown;
      try { message = JSON.parse(event.data); } catch { finish(new HttpError(502, 'Home Assistant returned invalid JSON')); return; }
      if (!isRecord(message)) { finish(new HttpError(502, 'Invalid Home Assistant message')); return; }
      if (message.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (message.type === 'auth_ok' && !authenticated) {
        authenticated = true;
        socket.send(JSON.stringify({ ...payload, id: 1, type }));
      } else if (message.type === 'auth_invalid') finish(new HttpError(502, 'Home Assistant refused the Studio credentials'));
      else if (message.type === 'result' && message.id === 1) {
        if (message.success === true) finish(undefined, message.result);
        else {
          const error = isRecord(message.error) ? message.error : {};
          finish(mapCommandError(name, error.code, error.message));
        }
      }
    });
  });
}

function entry(value: unknown): HaPublicationEntry {
  if (!isRecord(value) || typeof value.revision !== 'number' || typeof value.publishedAt !== 'string'
    || typeof value.envelopeSha256 !== 'string' || !Array.isArray(value.capabilities))
    throw new HttpError(502, 'Home Assistant returned an unreadable publication entry');
  return {
    revision: value.revision, publishedAt: value.publishedAt, envelopeSha256: value.envelopeSha256,
    publishedBy: typeof value.publishedBy === 'string' ? value.publishedBy : null,
    capabilities: value.capabilities.filter((item): item is string => typeof item === 'string'),
  };
}

/** Studio side of the `fenton_home` UI publication contract. The Studio is the only writer. */
export class HaPublicationClient {
  private readonly shutdown = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly transport: Transport) {}

  get configured() { return Boolean(this.transport.base && this.transport.token && this.transport.websocketUrl); }
  close() { this.shutdown.abort(); }

  /** Publishes and rollbacks never interleave, so an upload is always followed by its own publish. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async rawGet(): Promise<{ summary: HaPublicationSummary; assets: Set<string> }> {
    const raw = await command(this.transport, 'get', {}, this.shutdown.signal);
    if (!isRecord(raw) || typeof raw.epoch !== 'string' || !Array.isArray(raw.history))
      throw new HttpError(502, 'Home Assistant returned an unreadable publication summary');
    const assets = new Set(isRecord(raw.assets) ? Object.keys(raw.assets).filter(sha => shaPattern.test(sha)) : []);
    return {
      assets,
      summary: {
        epoch: raw.epoch, current: raw.current ? entry(raw.current) : null,
        history: raw.history.map(entry), storedAssets: assets.size,
      },
    };
  }
  /** Current entry and history, without any envelope. */
  async get(): Promise<HaPublicationSummary> { return (await this.rawGet()).summary; }

  private async upload(sha: string, mimeType: string, bytes: Buffer) {
    if (createHash('sha256').update(bytes).digest('hex') !== sha) throw new HttpError(500, 'A stored Studio image no longer matches its hash');
    let response: Response;
    try {
      response = await fetch(`${this.transport.base}/api/fenton_home/ui_assets/${sha}`, {
        method: 'POST', redirect: 'error',
        signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(ASSET_TIMEOUT_MS)]),
        headers: { Authorization: `Bearer ${this.transport.token}`, 'Content-Type': mimeType },
        body: new Uint8Array(bytes),
      });
    } catch { throw new HttpError(502, 'Uploading an image to Home Assistant failed or timed out'); }
    if (response.ok) { await response.body?.cancel(); return; }
    let reason = '';
    try {
      const body: unknown = JSON.parse((await response.text()).slice(0, 512));
      if (isRecord(body) && typeof body.error === 'string') reason = body.error;
    } catch { /* not the integration's JSON */ }
    if (response.status === 401 || response.status === 403) throw new HttpError(502, adminOnly);
    if (response.status === 404) throw new HttpError(502, unavailable);
    const known = assetReasons[reason];
    if (known) throw new HttpError(known[0], known[1], { reason });
    throw new HttpError(502, `Home Assistant refused an image upload (HTTP ${response.status}).`);
  }

  /**
   * Uploads every image the document references that Home Assistant lacks, then publishes the envelope
   * immediately, because Home Assistant prunes stored images no publication references.
   */
  publish(publication: CompositionPublication, readAsset: AssetSource): Promise<HaPublishResult> {
    return this.serialize(async () => {
      if (!this.configured) throw new HttpError(503, 'Home Assistant is not configured');
      const { assets: stored } = await this.rawGet();
      const wanted = new Map<string, { name: string; mimeType: string }>();
      for (const asset of publication.document.assets) {
        wanted.set(asset.sha256, { name: asset.source.path.slice('/api/assets/'.length), mimeType: asset.mimeType });
      }
      let uploaded = 0;
      for (const [sha, { name, mimeType }] of wanted) {
        if (stored.has(sha)) continue;
        await this.upload(sha, mimeType, (await readAsset(name)).bytes);
        uploaded += 1;
      }
      const result = await command(this.transport, 'publish', { envelope: publication }, this.shutdown.signal);
      if (!isRecord(result) || typeof result.epoch !== 'string' || typeof result.revision !== 'number' || typeof result.envelopeSha256 !== 'string')
        throw new HttpError(502, 'Home Assistant returned an unreadable publish result');
      return {
        epoch: result.epoch, revision: result.revision, envelopeSha256: result.envelopeSha256,
        uploadedAssets: uploaded, skippedAssets: wanted.size - uploaded,
      };
    });
  }

  /** Makes a history entry current under a new revision. */
  rollback(revision: number): Promise<{ epoch: string; revision: number; envelopeSha256: string }> {
    return this.serialize(async () => {
      if (!this.configured) throw new HttpError(503, 'Home Assistant is not configured');
      const result = await command(this.transport, 'rollback', { revision }, this.shutdown.signal);
      if (!isRecord(result) || typeof result.epoch !== 'string' || typeof result.revision !== 'number' || typeof result.envelopeSha256 !== 'string')
        throw new HttpError(502, 'Home Assistant returned an unreadable rollback result');
      return { epoch: result.epoch, revision: result.revision, envelopeSha256: result.envelopeSha256 };
    });
  }
}
