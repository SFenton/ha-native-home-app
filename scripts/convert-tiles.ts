/**
 * convert-tiles: makes tile templates from a document, one template at a time, and writes the converted document.
 *
 *     tsx scripts/convert-tiles.ts DOCUMENT.json SPEC.json OUT.json
 *
 * `DOCUMENT.json` is a composition document, or a draft envelope that holds one under `document`. `SPEC.json` is
 * `{ "templates": [{ "name", "type", "idPattern"?, "where"?, "labels": { "<field path>": "<label>" }, "also"?: [{ "label", "fields": [...] }] }] }`: a template converts every node of `type` whose
 * id matches the regular expression `idPattern` (default: any) and whose fields equal `where` (`{ "props/kind": "vacuum" }`); `labels` names each setting by a field it fills (`title`, `props/sourceId`). The spec is data, so
 * nothing about a house is in this file. Run it on a copy; it never touches a Studio.
 *
 * It prints one line for each template (name, tiles converted, settings) and exits 1 on the first conversion that cannot keep every tile as it was.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { childLists, readField } from '../src/shared/composition/components';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import { ConversionError, convertTiles, type TileConversion } from '../src/workspace2/repeats/convertTiles';

interface Spec { templates: { name: string; type: string; idPattern?: string; where?: Record<string, unknown>; labels: TileConversion['labels']; also?: TileConversion['also'] }[] }

/** The ids of the nodes of `type` whose id matches `pattern` and whose fields equal `where`, in document order. */
export function idsOf(document: Pick<CompositionDocument, 'pages' | 'modals'>, type: string, pattern: RegExp, where: Record<string, unknown> = {}): string[] {
  const ids: string[] = [];
  const fits = (node: CompositionNode) => Object.entries(where).every(([field, value]) => readField(node, field) === value);
  const visit = (node: CompositionNode) => { if (node.type === type && pattern.test(node.id) && fits(node)) ids.push(node.id); for (const list of childLists(node)) list.nodes.forEach(visit); };
  for (const kind of ['pages', 'modals'] as const) for (const surface of document[kind]) surface.components.forEach(visit);
  return ids;
}

/** Whether `path` is `parent` or inside it. */
const inside = (path: string, parent: string) => { const way = relative(parent, path); return way === '' || !(way.startsWith('..') || isAbsolute(way)); };
/** `path` with symbolic links in its directory resolved (the file itself may not exist yet). */
const real = (path: string) => { const full = resolve(path); try { return realpathSync(full); } catch { try { return join(realpathSync(dirname(full)), basename(full)); } catch { return full; } } };

/** Why `out` may not be written, or undefined: it is the input, inside `./data` or `DATA_DIR`, or in a directory a Studio holds (`.studio.lock`). */
export function refusalFor(input: string, out: string, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string | undefined {
  const target = real(resolve(cwd, out));
  if (target === real(resolve(cwd, input))) return 'OUT is the input file';
  const data = [resolve(cwd, 'data'), ...(env.DATA_DIR ? [resolve(cwd, env.DATA_DIR)] : [])];
  if (data.some(folder => inside(target, folder) || inside(target, real(folder)))) return 'OUT is inside a Studio data directory';
  if (existsSync(join(dirname(target), '.studio.lock'))) return 'OUT is in a directory a Studio holds (.studio.lock)';
  return undefined;
}

/** Runs the script; returns the exit code (0 done, 1 a conversion refused, 2 bad arguments or a refused output path). */
export function main(argv: string[], env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): number {
  const [documentPath, specPath, outPath] = argv;
  if (!documentPath || !specPath || !outPath) { console.error('usage: convert-tiles DOCUMENT.json SPEC.json OUT.json'); return 2; }
  const refused = refusalFor(documentPath, outPath, env, cwd);
  if (refused) { console.error(`${refused}; write the copy somewhere else`); return 2; }
  const parsed = JSON.parse(readFileSync(resolve(cwd, documentPath), 'utf8')) as { document?: CompositionDocument } & CompositionDocument;
  let document = (parsed.document ?? parsed) as CompositionDocument;
  const spec = JSON.parse(readFileSync(resolve(cwd, specPath), 'utf8')) as Spec;
  for (const template of spec.templates) {
    try {
      const nodeIds = idsOf(document, template.type, new RegExp(template.idPattern ?? '.'), template.where);
      const saved = convertTiles(document, { name: template.name, nodeIds, labels: template.labels, also: template.also });
      document = saved.document;
      const entry = document.componentLibrary!.find(item => item.id === saved.entryId)!;
      console.log(`${template.name}: ${saved.places} tiles, settings: ${(entry.params ?? []).map(param => `${param.label} (${param.kind})`).join(', ') || 'none'}`);
    } catch (error) {
      console.error(`${template.name}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof ConversionError && error.analysis) {
        for (const group of error.analysis.groups) console.error(`  group ${group.kind} x${group.distinct}: ${group.fields.map(field => field.field).join(', ')}`);
        for (const field of error.analysis.unsettable) console.error(`  unsettable: ${field.field}`);
      }
      return 1;
    }
  }
  writeFileSync(resolve(cwd, outPath), `${JSON.stringify(document)}\n`);
  return 0;
}

if (process.argv[1] && /convert-tiles\.ts$/.test(process.argv[1])) process.exit(main(process.argv.slice(2)));
