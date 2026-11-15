import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { parseCompositionJSON } from '../src/shared/composition/json';
import type { CompositionPublication } from '../src/shared/composition/schema';
import { atomicJson, HttpError } from './store';

function localIPv4(first: number, second: number) {
  return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168) || (first === 169 && second === 254);
}
/** Matches HassServerAddress: HTTP is permitted only for an explicitly local HA origin. */
function localHost(host: string) {
  if (host.startsWith('[')) {
    if (host === '[::1]' || /^\[(?:f[cd][a-f0-9]{2}|fe[89ab][a-f0-9]):/.test(host)) return true;
    const mapped = /^\[::ffff:([a-f0-9]{1,4}):[a-f0-9]{1,4}\]$/.exec(host);
    if (mapped) { const high = Number.parseInt(mapped[1], 16); return localIPv4(high >>> 8, high & 255); }
    return false;
  }
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')) return true;
  const octets = host.split('.').map(Number);
  return octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    && localIPv4(octets[0], octets[1]);
}
const origin = z.string().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || (url.protocol === 'http:' && localHost(url.hostname)))
      && url.origin === value && (!url.port || Number(url.port) > 0);
  } catch { return false; }
});
const publisherURL = z.string().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && (!url.port || Number(url.port) > 0) && !/[\p{Cc}\p{Cf}]/u.test(decodeURIComponent(url.pathname))
      && !/[\\\s]/.test(value) && !/%(?:2f|5c|2e|25)/i.test(value)
      && !url.pathname.includes('//') && !value.split('/').some(part => part === '.' || part === '..');
  } catch { return false; }
});
export const readerRequest = z.strictObject({
  haServer: origin, haUserID: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  publisherURL, expiresAt: z.number().int().positive(),
});
const grantSchema = readerRequest.extend({
  id: z.uuid(), tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  publisherID: z.string(), documentID: z.string(),
});
type Grant = z.infer<typeof grantSchema>;
const digest = (token: string) => createHash('sha256').update(token).digest();

/** Separate author-issued grants. Only digests persist; no grant authorizes HA or Studio editing. */
export class PublicationReaders {
  private sequence: Promise<unknown> = Promise.resolve();
  private constructor(private readonly file: string, private grants: Grant[]) {}

  static async open(directory: string) {
    const file = path.join(directory, 'publication-readers.json');
    let grants: Grant[] = [];
    try {
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 1048576) throw new Error('Invalid reader grant storage');
        const bytes = await handle.readFile();
        if (bytes.length > 1048576) throw new Error('Invalid reader grant storage');
        grants = z.array(grantSchema).max(1000).parse(parseCompositionJSON(bytes));
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return new PublicationReaders(file, grants);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.sequence.then(operation);
    this.sequence = result.catch(() => undefined);
    return result;
  }

  issue(input: unknown, publication: CompositionPublication, now = Date.now()) {
    return this.serialize(async () => {
      const request = readerRequest.parse(input);
      if (request.expiresAt <= Math.floor(now / 1000) || request.expiresAt > Math.floor(now / 1000) + 366 * 86400)
        throw new HttpError(422, 'Reader expiry must be within one year');
      const retained = this.grants.filter(grant => grant.expiresAt > now / 1000);
      if (retained.length >= 1000) throw new HttpError(409, 'Reader grant limit reached');
      const credential = `shr_${randomBytes(32).toString('hex')}`;
      const grant: Grant = { ...request, id: randomUUID(), tokenHash: digest(credential).toString('hex'),
        publisherID: publication.publisherId, documentID: publication.document.id };
      await atomicJson(this.file, [...retained, grant]);
      this.grants = [...retained, grant];
      return { version: 1, grantID: grant.id, ...request, publisherID: grant.publisherID,
        documentID: grant.documentID, credential, scope: 'publication-read@1' };
    });
  }

  revoke(id: string) {
    return this.serialize(async () => {
      const next = this.grants.filter(grant => grant.id !== id);
      await atomicJson(this.file, next);
      this.grants = next;
    });
  }

  /** Scope is rechecked against the current published identity on every GET/HEAD, including 304. */
  permits(token: string, publication: CompositionPublication, resource: string, now = Date.now()) {
    if (!/^shr_[a-f0-9]{64}$/.test(token)) return false;
    const hash = digest(token);
    const grant = this.grants.find(value => timingSafeEqual(hash, Buffer.from(value.tokenHash, 'hex')));
    if (!grant || grant.expiresAt <= now / 1000 || grant.publisherID !== publication.publisherId
      || grant.documentID !== publication.document.id) return false;
    return resource === '/native/api/published' ||
      publication.document.assets.some(asset => `/native${asset.source.path}` === resource);
  }
}
