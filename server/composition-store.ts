import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { compileCompositionDocument, parseCompositionShape } from '../src/shared/composition/compiler';
import { canonicalCompositionJSON, MAX_COMPOSITION_ENVELOPE_BYTES, parseCompositionJSON, reject } from '../src/shared/composition/json';
import { compositionPublicationSchema, type CompositionDocument, type CompositionPublication } from '../src/shared/composition/schema';
import { publishedDocument } from '../src/shared/composition/logic-library';
import { createCompositionDocument, type CompositionDraft, type UploadedCompositionAsset } from '../src/shared/composition/workspace';
import { compositionAssetManifestHash, validateCompositionPublication } from './composition';
import { compositionAssetName, inspectCompositionImage, MAX_COMPOSITION_ASSET_BYTES } from './composition-assets';
import { atomicJson, HttpError } from './store';

const stateSchema = z.strictObject({
  // The draft's document may hold a logic library and uses; `validateDraft` checks it by working it out.
  draft: compositionPublicationSchema.omit({ publishedAt: true, document: true }).extend({ document: z.unknown() }),
  publishedRevision: z.number().int().positive().nullable(),
});
const migrationStateSchema = z.object({
  draft: z.looseObject({ publisherId: z.string(), revision: z.number().int().positive(), document: z.unknown() }),
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

/** Row icons are chosen per selection key (`node:<id>`, `page:<id>`, ...) and named like a symbol (`house`, `bed.double`). */
const noteKey = /^(node|page|modal|tab|local-tab):[A-Za-z0-9_./:-]{1,200}$/;
const noteIcon = /^[A-Za-z0-9_.-]{1,80}$/;
/** What the Studio keeps for its own use: never part of the document, so Publish, Export and the app cannot see it. */
export const studioNotesSchema = z.strictObject({ listIcons: z.record(z.string().regex(noteKey), z.string().regex(noteIcon)).refine(map => Object.keys(map).length <= 2000, 'Too many list icons') });
export type StudioNotes = z.infer<typeof studioNotesSchema>;

/** Owned by StudioStore's existing DATA_DIR lock; schema 1 files are never read or modified here. */
export class CompositionStore {
  private draft!: CompositionDraft;
  private published?: CompositionPublication;
  private sequence: Promise<unknown> = Promise.resolve();
  private constructor(private readonly directory: string) {}

  static async open(dataDirectory: string): Promise<CompositionStore> {
    const store = new CompositionStore(path.join(dataDirectory, 'native-v2'));
    await mkdir(path.join(store.directory, 'revisions'), { recursive: true, mode: 0o700 });
    await mkdir(path.join(store.directory, 'assets'), { recursive: true, mode: 0o700 });
    const bytes = await optionalRead(path.join(store.directory, 'state.json'), MAX_COMPOSITION_ENVELOPE_BYTES + 1024);
    if (bytes) {
      const state = parseCompositionShape(stateSchema, parseCompositionJSON(bytes));
      store.draft = store.validateDraft(state.draft as CompositionDraft);
      if (state.publishedRevision !== null) {
        store.published = validateCompositionPublication(parseCompositionJSON(await boundedRead(
          path.join(store.directory, 'revisions', `${state.publishedRevision}.json`), MAX_COMPOSITION_ENVELOPE_BYTES)));
        if (store.published.publisherId !== store.draft.publisherId || store.published.document.id !== store.draft.document.id
          || store.published.revision !== state.publishedRevision || store.published.revision > store.draft.revision)
          throw new Error('Native publication identity or revision does not match stored state');
        if (store.published.revision === store.draft.revision
          && canonicalCompositionJSON({ ...store.published, publishedAt: store.draft.updatedAt })
            !== canonicalCompositionJSON({ ...store.draft, document: publishedDocument(store.draft.document), publishedAt: store.draft.updatedAt }))
          throw new Error('Native publication does not match its saved draft revision');
        await store.verifyAssets(store.published.document);
      }
      await store.verifyAssets(store.draft.document);
    } else {
      if ((await readdir(path.join(store.directory, 'revisions'))).length
        || (await readdir(path.join(store.directory, 'assets'))).length
        || (await readdir(store.directory)).some(name => !['revisions', 'assets', 'publication-readers.json' /* retired reader grants: tolerated, never read */].includes(name)))
        throw new Error('Native state is missing but namespace artifacts exist; existing work was not reset');
      store.draft = store.makeDraft(createCompositionDocument(`document-${randomUUID()}`), 1, `publisher-${randomUUID()}`);
      await store.persist(store.draft, null);
    }
    return store;
  }
  /**
   * Rewrites the saved draft through the store's own draft path, for a draft the current rules no longer accept (so
   * {@link open} would refuse it). The transform runs on the stored document; the result is compiled, its assets are
   * verified and it is saved as the next draft revision. The published revision is immutable and must still validate.
   * Returns `null`, writing nothing, when the transform changes nothing. Never call this while a server owns the directory.
   */
  static async migrateDraft(dataDirectory: string, transform: (document: unknown) => unknown): Promise<{ from: number; to: number } | null> {
    const store = new CompositionStore(path.join(dataDirectory, 'native-v2'));
    const bytes = await boundedRead(path.join(store.directory, 'state.json'), MAX_COMPOSITION_ENVELOPE_BYTES + 1024);
    // The draft's own shape is what changed, so only its identity is read strictly here.
    const state = parseCompositionShape(migrationStateSchema, parseCompositionJSON(bytes));
    if (state.publishedRevision !== null) {
      validateCompositionPublication(parseCompositionJSON(await boundedRead(
        path.join(store.directory, 'revisions', `${state.publishedRevision}.json`), MAX_COMPOSITION_ENVELOPE_BYTES)));
    }
    const rewritten = transform(structuredClone(state.draft.document));
    if (canonicalCompositionJSON(rewritten) === canonicalCompositionJSON(state.draft.document)) return null;
    const next = store.makeDraft(rewritten, state.draft.revision + 1, state.draft.publisherId);
    await store.verifyAssets(next.document);
    await store.persist(next, state.publishedRevision);
    return { from: state.draft.revision, to: next.revision };
  }
  /**
   * Checks the draft as it would be published: its logic worked out, the capabilities those texts need. The result keeps the draft's own document
   * (library and uses included); {@link published} is the published form.
   */
  private validateDraft(draft: CompositionDraft): CompositionDraft {
    const publication = validateCompositionPublication({ ...draft, document: publishedDocument(draft.document), publishedAt: draft.updatedAt });
    const { publishedAt: _publishedAt, document: _document, ...validated } = publication;
    return { ...validated, document: draft.document };
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
  /** The draft without a copy, for a read that only inspects it. Never mutate the result. */
  peekDraft(): Readonly<CompositionDraft> { return this.draft; }
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
  /** `studio-notes.json`, beside the draft: the Studio's own metadata (row icons). An absent or unreadable file reads as empty. */
  private get notesFile() { return path.join(this.directory, 'studio-notes.json'); }
  async getNotes(): Promise<StudioNotes> {
    try {
      const bytes = await optionalRead(this.notesFile, 1024 * 1024);
      return bytes ? studioNotesSchema.parse(JSON.parse(bytes.toString('utf8'))) : { listIcons: {} };
    } catch { return { listIcons: {} }; }
  }
  /** Replaces the notes. Only the notes file is written: the draft, its revision and the publications are untouched. */
  putNotes(input: unknown): Promise<StudioNotes> {
    const notes = studioNotesSchema.parse(input);
    return this.serialize(async () => { await atomicJson(this.notesFile, notes); return notes; });
  }
  /** Where the drafts a replacement kept are, newest last by name. Inside `native-v2/`, so it follows the data directory. */
  private get backupDirectory() { return path.join(this.directory, 'backups'); }
  private async backupNames(): Promise<string[]> {
    try { return (await readdir(this.backupDirectory)).filter(name => /^draft-[0-9TZ-]+-r\d+\.json$/.test(name)).sort(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  /** Keeps the current draft as a restorable file, and no more than five of them. */
  private async writeBackup(draft: CompositionDraft) {
    await mkdir(this.backupDirectory, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await atomicJson(path.join(this.backupDirectory, `draft-${stamp}-r${draft.revision}.json`), draft);
    for (const name of (await this.backupNames()).slice(0, -5)) await unlink(path.join(this.backupDirectory, name)).catch(() => undefined);
  }
  /** The newest kept draft, if any: when it was saved and the revision it had. */
  async latestBackup(): Promise<{ createdAt: string; revision: number } | undefined> {
    const name = (await this.backupNames()).pop();
    const match = name && /^draft-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d)-(\d+)Z-r(\d+)\.json$/.exec(name);
    return match ? { createdAt: `${match[1].replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3')}.${match[2]}Z`, revision: Number(match[3]) } : undefined;
  }
  /**
   * Replaces the draft with another document (identity kept: the workspace's own document id), as the next revision. The document
   * is compiled and its assets verified first, so an invalid one leaves the draft untouched. The draft being replaced is kept
   * under `backups/` before anything changes. Never publishes.
   */
  replaceDraft(input: unknown, expected: number): Promise<CompositionDraft> {
    return this.serialize(async () => {
      this.checkRevision(expected);
      const incoming = input !== null && typeof input === 'object' ? { ...(input as Record<string, unknown>), id: this.draft.document.id } : input;
      const next = this.makeDraft(incoming, this.draft.revision + 1, this.draft.publisherId);
      await this.verifyAssets(next.document);
      await this.writeBackup(this.draft);
      await this.persist(next, this.published?.revision ?? null);
      this.draft = next;
      return this.getDraft();
    });
  }
  /** Puts the newest kept draft back. The draft it replaces becomes the newest kept one, so the command can be undone. */
  restoreBackup(expected: number): Promise<CompositionDraft> {
    return this.serialize(async () => {
      this.checkRevision(expected);
      const name = (await this.backupNames()).pop();
      if (!name) throw new HttpError(404, 'There is no previous draft to restore');
      const kept = parseCompositionJSON(await boundedRead(path.join(this.backupDirectory, name), MAX_COMPOSITION_ENVELOPE_BYTES)) as { document?: unknown };
      const document = kept.document !== null && typeof kept.document === 'object' ? { ...(kept.document as Record<string, unknown>), id: this.draft.document.id } : kept.document;
      const next = this.makeDraft(document, this.draft.revision + 1, this.draft.publisherId);
      await this.verifyAssets(next.document);
      await this.writeBackup(this.draft);
      await unlink(path.join(this.backupDirectory, name));
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
      // What is published is the draft with its logic worked out.
      const worked: CompositionDraft = { ...draft, document: publishedDocument(draft.document) };
      const file = path.join(this.directory, 'revisions', `${expected}.json`);
      const existing = await optionalRead(file, MAX_COMPOSITION_ENVELOPE_BYTES);
      const next = existing ? validateCompositionPublication(parseCompositionJSON(existing))
        : validateCompositionPublication({ ...worked, publishedAt: new Date().toISOString() });
      if (canonicalCompositionJSON({ ...next, publishedAt: draft.updatedAt }) !== canonicalCompositionJSON({ ...worked, publishedAt: draft.updatedAt }))
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
  async close() { await this.sequence; }
}
