/**
 * Imports a layout file as the native draft of a Studio data directory, through the store's own save path.
 *
 *   tsx scripts/import-native-layout.ts <data-dir> <layout.json>
 *
 * `<layout.json>` is either a bare composition document or a publication envelope (its `document` is used). The
 * document is first passed through `migrateComposition` (each rewrite is printed) and must carry the workspace's document id (identity is stable) and every asset it references must already be
 * in `<data-dir>/native-v2/assets`. The draft is saved as the next revision with the draft's current revision as the
 * expected one, so a stale directory fails rather than overwrites. The published revision is untouched; publishing
 * stays an explicit Studio action. The script refuses a directory whose `.studio.lock` names a live process.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CompositionStore } from '../server/composition-store';
import { migrateComposition } from '../src/shared/composition/migrate';

const [directory, file] = process.argv.slice(2);
if (!directory || !file) { console.error('usage: import-native-layout.ts <data-dir> <layout.json>'); process.exit(2); }
const root = path.resolve(directory);

const lock = await readFile(path.join(root, '.studio.lock'), 'utf8').catch(() => '');
const pid = Number((/"pid":(\d+)/.exec(lock) ?? [])[1]);
if (pid) {
  try { process.kill(pid, 0); console.error(`Process ${pid} owns ${root}; stop it first.`); process.exit(3); } catch { /* stale lock */ }
}

const parsed = JSON.parse(await readFile(path.resolve(file), 'utf8')) as Record<string, unknown>;
const incoming = 'envelopeVersion' in parsed ? parsed.document : parsed;
// A layout authored against an older contract is brought current first, with every rewrite listed.
const { document, changes } = migrateComposition(incoming);
for (const change of changes) console.log(`migrate: ${change}`);
const store = await CompositionStore.open(root);
const before = store.getDraft();
const saved = await store.save(document, before.revision);
await store.close();
const d = saved.document;
console.log(`Draft revision ${before.revision} -> ${saved.revision}: ${d.pages.length} pages, ${d.modals.length} modals, ${saved.capabilities.length} capabilities, ${d.assets.length} assets`);
