import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { CompositionStore } from '../server/composition-store';
import corpus from '../contract/corpus/accept/device-remote-house-script.json';

const run = promisify(execFile);
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const tsx = (script: string, ...args: string[]) => run(process.execPath, ['--import', 'tsx', script, ...args], { cwd: process.cwd() });

async function workspace() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-layout-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await CompositionStore.open(directory);
  const id = store.getDraft().document.id;
  await store.close();
  return { directory, id };
}

describe('native layout scripts', () => {
  it('imports a layout as the next draft', async () => {
    const { directory, id } = await workspace();
    const layout = path.join(directory, 'layout.json');
    await writeFile(layout, JSON.stringify({ ...corpus.document, id }));
    expect((await tsx('scripts/import-native-layout.ts', directory, layout)).stdout).toMatch(/Draft revision 1 -> 2/);
    const store = await CompositionStore.open(directory);
    cleanup.push(() => store.close());
    expect(JSON.stringify(store.getDraft().document)).toContain('demo_power');
  });

  it('refuses a layout whose document identity is not the workspace document', async () => {
    const { directory } = await workspace();
    const layout = path.join(directory, 'layout.json');
    await writeFile(layout, JSON.stringify(corpus.document));
    await expect(tsx('scripts/import-native-layout.ts', directory, layout)).rejects.toThrow();
  });
});
