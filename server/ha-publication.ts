import { servedCapabilities, servedDocument, shippedCompositionCapabilities, unloweredWords } from '../src/shared/composition/publish-target';
import type { CompositionPublication } from '../src/shared/composition/schema';
import { canonicalCompositionJSON, CompositionValidationError } from '../src/shared/composition/json';
import { INK_DEFAULT_CAPABILITY, legacyManifest } from '../src/shared/composition/compiler';
import { SHEET_LEVELS_CAPABILITY } from '../src/shared/composition/global-chrome';
import { HttpError } from './store';
import { validateCompositionPublication } from './composition';

/** Contract: `fenton_home` integration 1.4.0+, `custom_components/fenton_home/ui_publication.py`. */
export const MAX_HA_MESSAGE_BYTES = 8 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
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
  /**
   * Whether the document Home Assistant serves now is the draft's document: `null` when it cannot be told (no live entry, or
   * Home Assistant did not return its envelope). Added by {@link HaPublicationClient.get}; the status tag reads it after a reload.
   */
  draftIsLive?: boolean | null;
  /** The saved draft revision `draftIsLive` was worked out against; a client that holds a newer one ignores it. */
  draftRevision?: number;
}
export interface HaPublishResult {
  epoch: string;
  revision: number;
  envelopeSha256: string;
}

export interface Transport {
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
export async function command(transport: Transport, name: string, payload: Record<string, unknown>, signal: AbortSignal, fullType?: string): Promise<unknown> {
  if (!transport.websocketUrl || !transport.token) throw new HttpError(503, 'Home Assistant is not configured');
  const token = transport.token, type = fullType ?? `fenton_home/ui_publication/${name}`;
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
  /** `target`: the capability ids of the app build served; the shipped list unless a test says otherwise. */
  constructor(private readonly transport: Transport, private readonly target: readonly string[] = shippedCompositionCapabilities) {}

  /**
   * The served form of a draft's document, or the 422 a saved component that cannot be lowered earns (the lint's words). Called by the route before the Studio records a
   * publication of its own, so a refusal leaves everything as it was.
   */
  refuse<T>(document: T): { document: T } {
    const served = servedDocument(document, this.target);
    if (served.unlowered.length) throw new HttpError(422, unloweredWords, { pointers: served.unlowered });
    return { document: served.document };
  }

  /** The manifest of a lowered copy: what the copy needs, with the ink id only if the draft's own manifest declared it. */
  private loweredManifest(declared: readonly string[], document: unknown): string[] {
    const worked = servedCapabilities(document as never);
    return declared.includes(INK_DEFAULT_CAPABILITY) ? worked : legacyManifest(worked);
  }

  /** What the app is served for a draft's document: logic worked out and, for a build without `sh.sheet-levels@1`, levels lowered. */
  served<T>(document: T): T { return servedDocument(document, this.target).document; }

  get configured() { return Boolean(this.transport.base && this.transport.token && this.transport.websocketUrl); }
  close() { this.shutdown.abort(); }

  /** Publishes and rollbacks never interleave. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async rawGet(): Promise<{ summary: HaPublicationSummary; assets: Set<string>; liveDocument?: unknown }> {
    const raw = await command(this.transport, 'get', {}, this.shutdown.signal);
    if (!isRecord(raw) || typeof raw.epoch !== 'string' || !Array.isArray(raw.history))
      throw new HttpError(502, 'Home Assistant returned an unreadable publication summary');
    const assets = new Set(isRecord(raw.assets) ? Object.keys(raw.assets).filter(sha => shaPattern.test(sha)) : []);
    const liveDocument = isRecord(raw.current) && isRecord(raw.current.envelope) ? raw.current.envelope.document : undefined;
    return {
      assets, liveDocument,
      summary: {
        epoch: raw.epoch, current: raw.current ? entry(raw.current) : null,
        history: raw.history.map(entry), storedAssets: assets.size,
      },
    };
  }
  /**
   * Current entry and history, without any envelope. Pass the draft to learn whether it is what the app serves now
   * (`draftIsLive`); the document itself is compared here and never returned.
   */
  async get(draft?: { document: unknown; revision: number }): Promise<HaPublicationSummary> {
    const { summary, liveDocument } = await this.rawGet();
    if (draft === undefined) return summary;
    // The app serves the draft's logic worked out, so that is what is compared; a draft whose logic does not work out is not comparable.
    let served: unknown;
    try { served = this.served(draft.document); }
    catch (error) { if (!(error instanceof CompositionValidationError)) throw error; served = undefined; }
    const comparable = summary.current !== null && liveDocument !== undefined && served !== undefined;
    return { ...summary, draftRevision: draft.revision, draftIsLive: comparable ? canonicalCompositionJSON(liveDocument) === canonicalCompositionJSON(served) : null };
  }

  /**
   * The layout Home Assistant serves now, for starting a draft from it: `current.envelope.document`. Read only. A 404 when nothing
   * has been published; a 502 when Home Assistant answers without the document.
   */
  async liveDocument(): Promise<{ revision: number; document: unknown }> {
    const { summary, liveDocument } = await this.rawGet();
    if (summary.current === null) throw new HttpError(404, 'Nothing has been published to Home Assistant yet');
    if (liveDocument === undefined) throw new HttpError(502, 'Home Assistant did not return the published layout');
    return { revision: summary.current.revision, document: liveDocument };
  }

  /** Publishes the envelope. Home Assistant answers `missing_asset` when the document references an image it does not hold. */
  publish(publication: CompositionPublication): Promise<HaPublishResult> {
    return this.serialize(async () => {
      if (!this.configured) throw new HttpError(503, 'Home Assistant is not configured');
      const { document } = this.refuse(publication.document);
      // Lowering changes what the text needs (`sh.sheet-levels@1` goes), so the manifest is worked out again for the copy that is sent. It declares nothing the draft did not:
      // a draft saved with the older manifest (no `sh.tile-ink-default@1`) keeps its muted ink.
      const lowered = (publication.document as { levels?: unknown }).levels !== undefined && !this.target.includes(SHEET_LEVELS_CAPABILITY);
      const prepared = validateCompositionPublication({ ...publication, document, ...(lowered ? { capabilities: this.loweredManifest(publication.capabilities, document) } : {}) });
      const result = await command(this.transport, 'publish', { envelope: prepared }, this.shutdown.signal);
      if (!isRecord(result) || typeof result.epoch !== 'string' || typeof result.revision !== 'number' || typeof result.envelopeSha256 !== 'string')
        throw new HttpError(502, 'Home Assistant returned an unreadable publish result');
      return { epoch: result.epoch, revision: result.revision, envelopeSha256: result.envelopeSha256 };
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
