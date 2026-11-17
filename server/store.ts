import { randomUUID } from 'node:crypto';
import { constants, unlinkSync } from 'node:fs';
import { access, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
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

/** The PID a lock file records, or undefined when the file is missing, empty or not ours to interpret. */
async function recordedPid(lockPath: string): Promise<number | undefined> {
  try {
    const pid = (JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: unknown }).pid;
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch { return undefined; }
}

/** Whether a process exists; EPERM means it exists under another user. */
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

/**
 * The Studio's storage: one data directory with a single-writer lock, holding the composition (2.0) draft and
 * publications in `native-v2/`. Files an earlier Studio left beside it (`draft.json`, `published.json`, `revisions/`,
 * `feedback/`) are never read, validated, migrated or removed.
 */
export class StudioStore {
  native!: CompositionStore;
  private lock?: Awaited<ReturnType<typeof open>>;
  private exitHook?: () => void;
  private constructor(private readonly directory: string) {}

  static async open(directory: string): Promise<StudioStore> {
    const store = new StudioStore(path.resolve(directory));
    await mkdir(store.directory, { recursive: true, mode: 0o700 });
    const lockPath = path.join(store.directory, '.studio.lock');
    await store.acquireLock(lockPath);
    try {
      store.native = await CompositionStore.open(store.directory);
      return store;
    } catch (error) {
      await store.close();
      throw new Error('Cannot load Studio storage; existing data was not replaced', { cause: error });
    }
  }

  /**
   * Takes the single-writer lock. A lock whose recorded PID is dead (a server killed without cleanup, such as a
   * test runner's SIGKILL) is taken over, once, with a log line; a lock whose PID is alive, or whose content cannot
   * be read, is never taken.
   */
  private async acquireLock(lockPath: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.lock = await open(lockPath, 'wx', 0o600);
        await this.lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        this.exitHook = () => { try { unlinkSync(lockPath); } catch { /* already gone */ } };
        process.once('exit', this.exitHook);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const pid = await recordedPid(lockPath);
        if (attempt === 1 || pid === undefined || isAlive(pid)) {
          throw new Error('DATA_DIR is locked by another server or an unclean shutdown; verify the recorded PID before removing .studio.lock');
        }
        console.warn(`Studio took over a stale lock in ${this.directory}: recorded PID ${pid} is not running`);
        await unlink(lockPath).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      }
    }
  }

  async close() {
    await this.native?.close();
    if (this.lock) {
      await this.lock.close();
      this.lock = undefined;
      if (this.exitHook) process.off('exit', this.exitHook);
      this.exitHook = undefined;
      await unlink(path.join(this.directory, '.studio.lock'));
    }
  }
}
