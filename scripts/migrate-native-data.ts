/**
 * Brings a Studio data directory up to the app's current contract.
 *
 *   tsx scripts/migrate-native-data.ts <data-dir>          report only
 *   tsx scripts/migrate-native-data.ts <data-dir> --apply  back up, rewrite and verify (does nothing when there is nothing to rewrite)
 *
 * The directory is first copied to a sibling `<data-dir>.bak-<timestamp>`. The saved draft is rewritten through the
 * store's own save path (`CompositionStore.migrateDraft`) and then re-opened and re-validated. Published revisions are
 * immutable and are only checked. A live server keeps its draft in memory, so the script refuses a directory whose
 * `.studio.lock` names a running process unless `--allow-running` is given; restart the server afterwards.
 */
import { cp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CompositionStore } from '../server/composition-store';
import { decodeCompositionPublication } from '../server/composition';
import { migrateComposition } from '../src/shared/composition/migrate';

const [directory, ...flags] = process.argv.slice(2);
if (!directory) { console.error('usage: migrate-native-data.ts <data-dir> [--apply] [--allow-running]'); process.exit(2); }
const apply = flags.includes('--apply');
const root = path.resolve(directory);
const native = path.join(root, 'native-v2');

async function report(label: string) {
  const state = JSON.parse(await readFile(path.join(native, 'state.json'), 'utf8')) as { draft: { updatedAt: string; document: unknown }; publishedRevision: number | null };
  const results: string[] = [];
  const check = (name: string, bytes: Buffer) => {
    try { decodeCompositionPublication(bytes); results.push(`${name}: accepted`); }
    catch (error) { results.push(`${name}: REJECTED ${JSON.stringify((error as { issues?: unknown }).issues ?? String(error))}`); }
  };
  check('draft', Buffer.from(JSON.stringify({ ...state.draft, publishedAt: state.draft.updatedAt })));
  for (const name of (await readdir(path.join(native, 'revisions'))).sort()) check(`revision ${name}`, await readFile(path.join(native, 'revisions', name)));
  console.log(`${label}\n  ${results.join('\n  ')}\n  published revision: ${state.publishedRevision ?? 'none'}`);
  return state;
}

const before = await report('Before');
const plan = migrateComposition(before.draft.document);
console.log(plan.changes.length ? `Rewrites:\n  ${plan.changes.join('\n  ')}` : 'Rewrites: none needed');
if (!apply || !plan.changes.length) process.exit(0); // nothing to rewrite: no backup, no write

if (!flags.includes('--allow-running')) {
  const lock = await readFile(path.join(root, '.studio.lock'), 'utf8').catch(() => '');
  const pid = Number((/"pid":(\d+)/.exec(lock) ?? [])[1]);
  let running = false;
  if (pid) { try { process.kill(pid, 0); running = true; } catch { running = false; } }
  if (running) { console.error(`Process ${pid} owns ${root}; stop it first or pass --allow-running (it keeps the old draft in memory).`); process.exit(3); }
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const backup = `${root}.bak-${stamp}`;
await cp(root, backup, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
console.log(`Backed up to ${backup}`);
const moved = await CompositionStore.migrateDraft(root, document => migrateComposition(document).document);
console.log(moved ? `Saved draft revision ${moved.from} as revision ${moved.to}` : 'Nothing to save; the draft already compiles under the current rules');
const store = await CompositionStore.open(root);
let published: number | string = 'none';
try { published = store.getPublished().revision; } catch { /* nothing published yet */ }
console.log(`Re-opened: draft revision ${store.getDraft().revision}, published ${published}`);
await store.close();
await report('After');
