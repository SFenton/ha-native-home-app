/**
 * Writes the publication cases of the layout families (`tab-blocks-`, `tab-bar-`, `overlay-`, `tile-parts-`, `readout-tone-`) of the shared corpus.
 * Those four ids are shipped, so a case is an `accept/` file or a plain `reject/` file, unless it declares a capability the app does not list yet: then
 * it is a `pending` reject (see `corpus-handshake.ts`). The Studio either compiles it (an accept) or gives the first issue the case
 * records by hand (`expect` in `layout-corpus.ts`, checked here: the generator fails when the Studio disagrees).
 *
 *   tsx scripts/generate-layout-corpus.ts   # rewrites contract/corpus/{accept,reject}/{pending-,}{tab-blocks,tab-bar,overlay,tile-parts,readout-tone}-*.json and their index entries
 *
 * The evaluation cases of the same families are written by `generate-expression-corpus.ts`, which owns `contract/corpus/evaluation`.
 */
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { layoutCases, layoutFamilies } from './layout-corpus';
import { placeCase, shippedCapabilities, shippedIssue } from './corpus-handshake';

type J = Record<string, any>;
const root = path.resolve(import.meta.dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(root, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const PAGE = 2;
const shipped = shippedCapabilities(root);
const own = (file: unknown) => new RegExp(`^(accept|reject)/(pending-)?(${layoutFamilies.join('|')})-`).test(String(file));
const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')) as { cases: J[] };
index.cases = index.cases.filter(entry => !own(entry.file));
for (const folder of ['accept', 'reject']) for (const name of readdirSync(path.join(root, folder))) if (own(`${folder}/${name}`)) unlinkSync(path.join(root, folder, name));

const problems: string[] = [];
for (const item of layoutCases) {
  const draft = structuredClone(base);
  draft.document.pages[PAGE].components = item.components;
  item.tweak?.(draft);
  const bytes = () => new TextEncoder().encode(JSON.stringify(draft));
  let compiled = true;
  try { draft.capabilities = compileCompositionDocument(draft.document).capabilities; }
  catch { compiled = false; draft.capabilities = [...new Set([...draft.capabilities, ...item.needs])].sort(); }
  let studioIssue: J | undefined;
  try { decodeCompositionPublication(bytes()); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    const [first] = error.issues;
    studioIssue = { code: first.code, pointer: first.pointer, ...(first.capability ? { capability: first.capability } : {}) };
  }
  if (item.reject) {
    if (!studioIssue) problems.push(`${item.name} was accepted`);
    else if (studioIssue.code !== item.expect!.code || studioIssue.pointer !== item.expect!.pointer)
      problems.push(`${item.name}: expected ${JSON.stringify(item.expect)}, the Studio gave ${JSON.stringify(studioIssue)}`);
  } else if (studioIssue || !compiled) problems.push(`${item.name} did not decode: ${JSON.stringify(studioIssue)}`);
  const { file, entry } = placeCase(item.name, item.note, item.reject ? 'reject' : 'accept', shippedIssue(shipped, draft.capabilities), item.reject ? studioIssue : undefined);
  writeFileSync(path.join(root, file), `${JSON.stringify(draft)}\n`);
  index.cases.push(entry);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${layoutCases.length} layout publication cases (${layoutCases.filter(item => !item.reject).length} compile)`);
