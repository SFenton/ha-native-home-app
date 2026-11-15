import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CompositionStore } from './composition-store';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) { super(message); }
}

async function exists(file: string) {
  try { await access(file, constants.F_OK); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
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

/**
 * The Studio's storage: one data directory with a single-writer lock, holding the composition (2.0) draft and
 * publications in `native-v2/`. Files an earlier Studio left beside it (`draft.json`, `published.json`, `revisions/`,
 * `feedback/`) are never read, validated, migrated or removed.
 */
export class StudioStore {
  native!: CompositionStore;
  private lock?: Awaited<ReturnType<typeof open>>;
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
      store.native = await CompositionStore.open(store.directory);
      return store;
    } catch (error) {
      await store.close();
      throw new Error('Cannot load Studio storage; existing data was not replaced', { cause: error });
    }
  }

  async close() {
    await this.native?.close();
    if (this.lock) {
      await this.lock.close();
      this.lock = undefined;
      await unlink(path.join(this.directory, '.studio.lock'));
    }
  }
}
