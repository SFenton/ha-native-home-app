import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { createSampleDocument } from '../src/shared/sample';
import { validateDocument } from '../src/shared/schema';
import type { DraftEnvelope, PublishedEnvelope, StudioDocument } from '../src/shared/types';
import { CompositionStore } from './composition-store';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) { super(message); }
}

const envelopeSchema = z.object({
  document: z.unknown(),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
}).strict();
const publishedSchema = envelopeSchema.extend({
  publishedAt: z.string().datetime(),
  capabilities: z.array(z.string()),
}).strict();
export const publishCapabilities = ['document-v1', 'tabs', 'modals', 'conditions', 'bindings', 'live-activity-layouts'];

async function exists(file: string) {
  try { await access(file, constants.F_OK); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function readJson(file: string): Promise<unknown> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if ((await handle.stat()).size > 2 * 1024 * 1024) throw new Error('Stored document exceeds the storage size limit');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}

export async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary);
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, file);
    const directory = await open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if (await exists(temporary)) await unlink(temporary);
    throw error;
  }
}

function draftFromDisk(raw: unknown): DraftEnvelope {
  const envelope = envelopeSchema.parse(raw);
  return { ...envelope, document: validateDocument(envelope.document) };
}
function publishedFromDisk(raw: unknown): PublishedEnvelope {
  const envelope = publishedSchema.parse(raw);
  return { ...envelope, document: validateDocument(envelope.document) };
}

export class StudioStore {
  native!: CompositionStore;
  private draft!: DraftEnvelope;
  private published?: PublishedEnvelope;
  private sequence: Promise<unknown> = Promise.resolve();
  private lock?: Awaited<ReturnType<typeof open>>;
  private readonly subscribers = new Set<(published: PublishedEnvelope) => void>();
  private constructor(private readonly directory: string) {}

  static async open(directory: string): Promise<StudioStore> {
    const store = new StudioStore(path.resolve(directory));
    await mkdir(store.directory, { recursive: true, mode: 0o700 });
    const lockPath = path.join(store.directory, '.studio.lock');
    try {
      store.lock = await open(lockPath, 'wx', 0o600);
      await store.lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('DATA_DIR is locked by another server or an unclean shutdown; verify the recorded PID before removing .studio.lock');
      throw error;
    }
    try {
      await mkdir(path.join(store.directory, 'revisions'), { recursive: true, mode: 0o700 });
      await mkdir(path.join(store.directory, 'feedback'), { recursive: true, mode: 0o700 });
      const draftPath = path.join(store.directory, 'draft.json');
      if (await exists(draftPath)) store.draft = draftFromDisk(await readJson(draftPath));
      else {
        store.draft = { document: validateDocument(createSampleDocument()), revision: 1, updatedAt: new Date().toISOString() };
        await atomicJson(draftPath, store.draft);
      }
      const publishedPath = path.join(store.directory, 'published.json');
      if (await exists(publishedPath)) {
        store.published = publishedFromDisk(await readJson(publishedPath));
        if (store.published.revision > store.draft.revision) throw new Error('Published revision is ahead of the stored draft');
        const snapshot = publishedFromDisk(await readJson(path.join(store.directory, 'revisions', `${store.published.revision}.json`)));
        if (JSON.stringify(snapshot) !== JSON.stringify(store.published)) throw new Error('Published pointer does not match its immutable revision snapshot');
      }
      store.native = await CompositionStore.open(store.directory);
      return store;
    } catch (error) {
      await store.close();
      throw new Error('Cannot load Studio storage; existing data was not replaced', { cause: error });
    }
  }

  getDraft(): DraftEnvelope { return structuredClone(this.draft); }
  getPublished(): PublishedEnvelope {
    if (!this.published) throw new HttpError(404, 'No configuration has been published');
    return structuredClone(this.published);
  }
  publishedRevision(): number | null { return this.published?.revision ?? null; }
  subscribe(listener: (published: PublishedEnvelope) => void) {
    this.subscribers.add(listener);
    return () => { this.subscribers.delete(listener); };
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.sequence.then(operation);
    this.sequence = result.catch(() => undefined);
    return result;
  }
  private checkRevision(expected: number) {
    if (expected !== this.draft.revision) throw new HttpError(409, 'Draft changed; reload before saving or publishing', { currentRevision: this.draft.revision });
  }
  save(document: StudioDocument, expectedRevision: number): Promise<DraftEnvelope> {
    const validated = validateDocument(document);
    return this.serialize(async () => {
      this.checkRevision(expectedRevision);
      const next = { document: validated, revision: this.draft.revision + 1, updatedAt: new Date().toISOString() };
      await atomicJson(path.join(this.directory, 'draft.json'), next);
      this.draft = next;
      return this.getDraft();
    });
  }
  publish(expectedRevision: number): Promise<PublishedEnvelope> {
    return this.serialize(async () => {
      this.checkRevision(expectedRevision);
      if (this.published?.revision === expectedRevision) return this.getPublished();
      const snapshotPath = path.join(this.directory, 'revisions', `${this.draft.revision}.json`);
      let next: PublishedEnvelope;
      if (await exists(snapshotPath)) {
        next = publishedFromDisk(await readJson(snapshotPath));
        if (JSON.stringify(next.document) !== JSON.stringify(this.draft.document) || next.updatedAt !== this.draft.updatedAt) throw new Error('Immutable snapshot conflicts with draft');
      } else {
        next = { ...this.getDraft(), publishedAt: new Date().toISOString(), capabilities: [...publishCapabilities] };
        await atomicJson(snapshotPath, next);
      }
      await atomicJson(path.join(this.directory, 'published.json'), next);
      this.published = next;
      for (const listener of this.subscribers) listener(this.getPublished());
      return this.getPublished();
    });
  }
  queueFeedback(feedback: { kind: 'report-issue' | 'request-feature'; title: string; description: string }) {
    return this.serialize(async () => {
      const directory = path.join(this.directory, 'feedback');
      if ((await readdir(directory)).filter((name) => name.endsWith('.json')).length >= 1000) throw new HttpError(507, 'Local feedback queue is full; an administrator must archive it');
      const record = { ...feedback, id: randomUUID(), status: 'queued' as const, createdAt: new Date().toISOString() };
      await atomicJson(path.join(directory, `${record.id}.json`), record);
      return record;
    });
  }
  async close() {
    await this.sequence;
    await this.native?.close();
    this.subscribers.clear();
    if (this.lock) {
      await this.lock.close();
      this.lock = undefined;
      await unlink(path.join(this.directory, '.studio.lock'));
    }
  }
}
