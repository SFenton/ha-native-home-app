import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { compileCompositionDocument, parseCompositionShape } from '../src/shared/composition/compiler';
import { canonicalCompositionJSON, MAX_COMPOSITION_ENVELOPE_BYTES, parseCompositionJSON, reject } from '../src/shared/composition/json';
import { compositionPublicationSchema, type CompositionDocument, type CompositionPublication } from '../src/shared/composition/schema';
import { createCompositionDocument, type CompositionDraft, type UploadedCompositionAsset } from '../src/shared/composition/workspace';
import { compositionAssetManifestHash, validateCompositionPublication } from './composition';
import { compositionAssetName, inspectCompositionImage, MAX_COMPOSITION_ASSET_BYTES } from './composition-assets';
import { atomicJson, HttpError } from './store';
import { PublicationReaders } from './publication-readers';

const stateSchema = z.strictObject({
  draft: compositionPublicationSchema.omit({ publishedAt: true }),
  publishedRevision: z.number().int().positive().nullable(),
});
async function boundedRead(file: string, maximum: number): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error('Stored native file exceeds its bounds');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw new Error('Stored native file exceeds its bounds');
    return bytes;
  } finally { await handle.close(); }
}
async function optionalRead(file: string, maximum: number) {
  try { return await boundedRead(file, maximum); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function immutableWrite(file: string, bytes: Buffer) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    await link(temporary, file);
    const directory = await open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await handle.close();
    await unlink(temporary);
  }
}

/** Owned by StudioStore's existing DATA_DIR lock; schema 1 files are never read or modified here. */
export class CompositionStore {
  readers!: PublicationReaders;
  private draft!: CompositionDraft;
  private published?: CompositionPublication;
  private sequence: Promise<unknown> = Promise.resolve();
  private constructor(private readonly directory: string) {}

  static async open(dataDirectory: string): Promise<CompositionStore> {
    const store = new CompositionStore(path.join(dataDirectory, 'native-v2'));
    await mkdir(path.join(store.directory, 'revisions'), { recursive: true, mode: 0o700 });
    await mkdir(path.join(store.directory, 'assets'), { recursive: true, mode: 0o700 });
    store.readers = await PublicationReaders.open(store.directory);
    const bytes = await optionalRead(path.join(store.directory, 'state.json'), MAX_COMPOSITION_ENVELOPE_BYTES + 1024);
    if (bytes) {
      const state = parseCompositionShape(stateSchema, parseCompositionJSON(bytes));
      store.draft = store.validateDraft(state.draft);
      if (state.publishedRevision !== null) {
        store.published = validateCompositionPublication(parseCompositionJSON(await boundedRead(
          path.join(store.directory, 'revisions', `${state.publishedRevision}.json`), MAX_COMPOSITION_ENVELOPE_BYTES)));
        if (store.published.publisherId !== store.draft.publisherId || store.published.document.id !== store.draft.document.id
          || store.published.revision !== state.publishedRevision || store.published.revision > store.draft.revision)
          throw new Error('Native publication identity or revision does not match stored state');
        if (store.published.revision === store.draft.revision
          && canonicalCompositionJSON({ ...store.published, publishedAt: store.draft.updatedAt })
            !== canonicalCompositionJSON({ ...store.draft, publishedAt: store.draft.updatedAt }))
          throw new Error('Native publication does not match its saved draft revision');
        await store.verifyAssets(store.published.document);
      }
      await store.verifyAssets(store.draft.document);
    } else {
      if ((await readdir(path.join(store.directory, 'revisions'))).length
        || (await readdir(path.join(store.directory, 'assets'))).length
        || (await readdir(store.directory)).some(name => !['revisions', 'assets', 'publication-readers.json'].includes(name)))
        throw new Error('Native state is missing but namespace artifacts exist; existing work was not reset');
      store.draft = store.makeDraft(createCompositionDocument(`document-${randomUUID()}`), 1, `publisher-${randomUUID()}`);
      await store.persist(store.draft, null);
    }
    return store;
  }
  private validateDraft(draft: CompositionDraft): CompositionDraft {
    const publication = validateCompositionPublication({ ...draft, publishedAt: draft.updatedAt });
    const { publishedAt: _publishedAt, ...validated } = publication;
    return validated;
  }
  private makeDraft(input: unknown, revision: number, publisherId: string): CompositionDraft {
    const { document, capabilities } = compileCompositionDocument(input);
    return this.validateDraft({
      envelopeVersion: '2.0', publisherId, revision, updatedAt: new Date().toISOString(),
      capabilities, assetManifestSha256: compositionAssetManifestHash(document.assets), document,
    });
  }
  private persist(draft: CompositionDraft, publishedRevision: number | null) {
    return atomicJson(path.join(this.directory, 'state.json'), { draft, publishedRevision });
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.sequence.then(operation);
    this.sequence = result.catch(() => undefined);
    return result;
  }
  private checkRevision(expected: number) {
    if (expected !== this.draft.revision) throw new HttpError(409, 'Native draft changed; local edits were retained. Reload or explicitly keep local work.', { currentRevision: this.draft.revision });
  }
  getDraft(): CompositionDraft { return structuredClone(this.draft); }
  getPublished(): CompositionPublication {
    if (!this.published) throw new HttpError(404, 'No native composition has been published');
    return structuredClone(this.published);
  }
  save(input: unknown, expected: number): Promise<CompositionDraft> {
    return this.serialize(async () => {
      this.checkRevision(expected);
      const next = this.makeDraft(input, this.draft.revision + 1, this.draft.publisherId);
      if (next.document.id !== this.draft.document.id) throw new HttpError(422, 'Document identity is stable; import content using the current workspace document ID');
      await this.verifyAssets(next.document);
      await this.persist(next, this.published?.revision ?? null);
      this.draft = next;
      return this.getDraft();
    });
  }
  publish(expected: number): Promise<CompositionPublication> {
    return this.serialize(async () => {
      this.checkRevision(expected);
      const draft = this.validateDraft(this.draft);
      await this.verifyAssets(draft.document);
      if (this.published?.revision === expected) return this.getPublished();
      const file = path.join(this.directory, 'revisions', `${expected}.json`);
      const existing = await optionalRead(file, MAX_COMPOSITION_ENVELOPE_BYTES);
      const next = existing ? validateCompositionPublication(parseCompositionJSON(existing))
        : validateCompositionPublication({ ...draft, publishedAt: new Date().toISOString() });
      if (canonicalCompositionJSON({ ...next, publishedAt: draft.updatedAt }) !== canonicalCompositionJSON({ ...draft, publishedAt: draft.updatedAt }))
        throw new Error('Immutable native publication conflicts with draft');
      if (!existing) await immutableWrite(file, Buffer.from(canonicalCompositionJSON(next)));
      await this.persist(draft, expected);
      this.published = next;
      return this.getPublished();
    });
  }
  async readAsset(name: string): Promise<{ bytes: Buffer; asset: UploadedCompositionAsset }> {
    if (!compositionAssetName.test(name)) throw new HttpError(400, 'Invalid content-addressed asset name');
    const bytes = await optionalRead(path.join(this.directory, 'assets', name), MAX_COMPOSITION_ASSET_BYTES);
    if (!bytes) throw new HttpError(404, 'Native asset is missing');
    const asset = inspectCompositionImage(bytes, name.endsWith('.png') ? 'image/png' : 'image/jpeg');
    if (asset.source.path !== `/api/assets/${name}`) reject('asset_integrity', '/assets');
    return { bytes, asset };
  }
  async verifyAssets(document: CompositionDocument) {
    for (const [index, descriptor] of document.assets.entries()) {
      let asset: UploadedCompositionAsset;
      try { asset = (await this.readAsset(descriptor.source.path.slice('/api/assets/'.length))).asset; }
      catch (error) {
        if (error instanceof HttpError && error.status === 404) reject('asset_integrity', `/document/assets/${index}`);
        throw error;
      }
      const { id: _id, role: _role, ...expected } = descriptor;
      if (canonicalCompositionJSON(asset) !== canonicalCompositionJSON(expected)) reject('asset_integrity', `/document/assets/${index}`);
    }
  }
  async listAssets(): Promise<UploadedCompositionAsset[]> {
    const names = (await readdir(path.join(this.directory, 'assets'))).filter(name => compositionAssetName.test(name)).sort();
    if (names.length > 1000) throw new HttpError(507, 'Native asset storage quota exceeded');
    const assets: UploadedCompositionAsset[] = [];
    for (const name of names) assets.push((await this.readAsset(name)).asset);
    return assets;
  }
  upload(bytes: Buffer, mimeType: string): Promise<UploadedCompositionAsset> {
    const asset = inspectCompositionImage(bytes, mimeType);
    return this.serialize(async () => {
      const name = asset.source.path.slice('/api/assets/'.length);
      const existing = await optionalRead(path.join(this.directory, 'assets', name), MAX_COMPOSITION_ASSET_BYTES);
      if (existing) {
        if (!existing.equals(bytes)) reject('asset_integrity', '/assets');
      } else {
        const assets = await this.listAssets();
        if (assets.length >= 1000 || assets.reduce((sum, item) => sum + item.byteLength, 0) + bytes.length > 512 * 1024 * 1024)
          throw new HttpError(507, 'Native asset storage quota reached; published assets are never deleted automatically');
        await immutableWrite(path.join(this.directory, 'assets', name), bytes);
      }
      return asset;
    });
  }
  async close() { await this.sequence; }
}
