import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CompositionStore } from '../server/composition-store';
import { migrateComposition } from '../src/shared/composition/migrate';
import corpus from '../contract/corpus/accept/device-bedroom-config.json';
import oldFields from './fixtures/bedroom-config-old-fields.json';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const removed = ['tonightScript', 'outsideScheduleScript', 'scheduleSetTopic', 'hotFlashBrokerScript', 'householdAwayScript'];

describe('migrateComposition', () => {
  it('removes the five fields the app dropped and lists each rewrite', () => {
    const { document, changes } = migrateComposition(oldFields.document);
    expect(changes).toEqual([
      '/dataSources/0/inputs/beds/0/configuration/tonightScript', '/dataSources/0/inputs/beds/0/configuration/outsideScheduleScript',
      '/dataSources/0/inputs/beds/1/configuration/tonightScript', '/dataSources/0/inputs/beds/1/configuration/outsideScheduleScript',
      '/dataSources/0/inputs/environment/scheduleSetTopic', '/dataSources/0/inputs/environment/hotFlashBrokerScript',
      '/dataSources/0/inputs/environment/householdAwayScript',
    ].map(pointer => `remove ${pointer}`));
    for (const field of removed) expect(JSON.stringify(document)).not.toContain(field);
    expect(document).toEqual(corpus.document);
  });

  it('is idempotent, leaves other documents alone and does not mutate its input', () => {
    const before = JSON.stringify(oldFields.document);
    const once = migrateComposition(oldFields.document);
    expect(JSON.stringify(oldFields.document)).toBe(before);
    expect(migrateComposition(once.document)).toEqual({ document: once.document, changes: [] });
    expect(migrateComposition(corpus.document).changes).toEqual([]);
    expect(migrateComposition(null)).toEqual({ document: null, changes: [] });
    expect(migrateComposition({ dataSources: [null, { model: 'bedroom-config@1', inputs: { beds: 'x', environment: [] } }] }).changes).toEqual([]);
  });
});

describe('CompositionStore.migrateDraft', () => {
  async function directoryWithOldDraft() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'native-migrate-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const store = await CompositionStore.open(directory);
    const draft = store.getDraft();
    await store.close();
    const statePath = path.join(directory, 'native-v2', 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.draft = { ...state.draft, document: { ...draft.document, dataSources: oldFields.document.dataSources },
      capabilities: oldFields.capabilities, updatedAt: draft.updatedAt };
    await writeFile(statePath, JSON.stringify(state));
    return { directory, statePath, draft };
  }

  it('opens nothing the current rules refuse, then rewrites that draft as the next revision', async () => {
    const { directory, draft } = await directoryWithOldDraft();
    await expect(CompositionStore.open(directory)).rejects.toThrow();
    expect(await CompositionStore.migrateDraft(directory, document => migrateComposition(document).document)).toEqual({ from: draft.revision, to: draft.revision + 1 });
    const reopened = await CompositionStore.open(directory);
    cleanup.push(() => reopened.close());
    const saved = reopened.getDraft();
    expect(saved.revision).toBe(draft.revision + 1);
    expect(saved.publisherId).toBe(draft.publisherId);
    expect(saved.document.dataSources).toEqual(corpus.document.dataSources);
    expect(saved.capabilities).toContain('sh.bedroom-config@1');
  });

  it('writes nothing when the draft already compiles', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'native-migrate-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const store = await CompositionStore.open(directory);
    const before = store.getDraft();
    await store.close();
    const statePath = path.join(directory, 'native-v2', 'state.json');
    const bytes = await readFile(statePath);
    expect(await CompositionStore.migrateDraft(directory, document => migrateComposition(document).document)).toBeNull();
    expect(await readFile(statePath)).toEqual(bytes);
    const reopened = await CompositionStore.open(directory);
    cleanup.push(() => reopened.close());
    expect(reopened.getDraft()).toEqual(before);
  });
});
