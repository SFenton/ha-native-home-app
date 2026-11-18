/**
 * The writer the TC6 and TC7 corpus generators share (`sh.tile-swipe@1`, `sh.state-words@1`, `sh.tile-ink-default@1`, `sh.grid-state-groups@1`). Each generator owns
 * one family: its `accept` cases are written as `reject/pending-<family>-*` (the Studio compiles them, the shipped list refuses them with
 * `unsupported_capability`) and its refusals as `reject/<family>-*` with the Studio's first issue. A refusal records its issue by hand in `expect`, and the
 * generator fails when the compiler disagrees. Demo ids only. Nothing outside the family's own files is touched, so no other case of the corpus changes.
 */
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { placeCase, shippedCapabilities, shippedIssue } from './corpus-handshake';

export type J = Record<string, any>;
export interface TileCase {
  name: string; note: string; components: J[]; needs: string[]; reject: boolean;
  /** Edits the envelope after the sources are added and before the capabilities are computed. */
  tweak?: (envelope: J) => void;
  /** Edits the envelope after the capabilities are computed (a manifest that does not match). */
  finish?: (envelope: J) => void;
  /** The Studio's first issue, written by hand: a refusal must give exactly this. */
  expect?: { code: string; pointer: string };
}

export const root = path.resolve(import.meta.dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(root, 'accept/fixture-composition-first-slice.json'), 'utf8'));
/** The page the cases fill: the third page of the first-slice fixture. */
export const PAGE = 2;

// MARK: Builders
export const lit = (value: unknown): J => ({ type: 'literal', value });
export const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
export const symbolOf = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
export const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
export const at = (index: number, rest: string) => `/document/pages/${PAGE}/components/${index}${rest}`;
/** The demo sources every case carries. */
export const demoSources: J[] = [
  { id: 'light-main', kind: 'model', model: 'home-light@1', inputs: { entityId: lit('light.demo_lamp') } },
  { id: 'blinds', kind: 'ha-entity', entityId: lit('cover.demo_blinds') },
  { id: 'fan', kind: 'ha-entity', entityId: lit('fan.demo_fan') },
  { id: 'thermostat', kind: 'ha-entity', entityId: lit('climate.demo_thermostat') },
  { id: 'speaker', kind: 'ha-entity', entityId: lit('media_player.demo_speaker') },
];

/** A state style the demo entities of a domain use, so a `state-tile` over a fan, a thermostat or a speaker has a style of its own domain. */
export const demoStyle = (domain: string): J => ({
  id: `demo-${domain}`, name: `Demo ${domain}`, domain,
  rules: [{ states: ['unavailable', 'unknown'], class: 'unknown', active: false }], fallback: { class: 'resting', active: false },
});
/** Adds the demo styles the state tiles among `components` need (a cover uses the built-in blind style). */
export function withDemoStyles(envelope: J): void {
  const domains = new Set<string>();
  const walk = (list: J[]) => list.forEach(item => {
    if (item.type === 'state-tile' && item.binding.styleId?.startsWith('demo-')) domains.add(item.binding.styleId.slice(5));
    if (Array.isArray(item.children)) walk(item.children);
  });
  walk(envelope.document.pages[PAGE].components);
  if (domains.size) envelope.document.stateStyles = { type: 'state-styles@1', styles: [...domains].sort().map(demoStyle) };
}

/** Writes one family: removes its files and index entries, then writes every case. Exits with the problems when a case does not give what it says. */
export function writeFamily(family: string, cases: TileCase[], needsIds: Record<string, string>, extraSources: J[] = demoSources): void {
  const shipped = shippedCapabilities(root);
  const own = (file: unknown) => new RegExp(`^(accept|reject)/(pending-)?${family}-`).test(String(file));
  const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')) as { cases: J[] };
  index.cases = index.cases.filter(entry => !own(entry.file));
  for (const folder of ['accept', 'reject']) for (const name of readdirSync(path.join(root, folder))) if (own(`${folder}/${name}`)) unlinkSync(path.join(root, folder, name));
  const problems: string[] = [];
  for (const item of cases) {
    const draft = structuredClone(base);
    draft.document.pages[PAGE].components = item.components;
    draft.document.dataSources.push(...structuredClone(extraSources));
    item.tweak?.(draft);
    withDemoStyles(draft);
    let studioIssue: J | undefined;
    // Only the ink family's own cases declare the ink id; the Studio's gate (`tile-ink-gate.ts`) keeps it out of every other.
    try { draft.capabilities = compileCompositionDocument(draft.document, { tileInkDefault: family === 'tile-ink-default' }).capabilities; }
    catch { draft.capabilities = [...new Set([...draft.capabilities, ...item.needs.map(name => needsIds[name])])].sort(); }
    item.finish?.(draft);
    try { decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(draft))); if (item.reject) problems.push(`${item.name} was accepted`); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      const [first] = error.issues;
      studioIssue = { code: first.code, pointer: first.pointer, ...(first.capability ? { capability: first.capability } : {}) };
      if (!item.reject) problems.push(`${item.name} did not decode: ${JSON.stringify(error.issues)}`);
    }
    if (item.expect && JSON.stringify([studioIssue?.code, studioIssue?.pointer]) !== JSON.stringify([item.expect.code, item.expect.pointer]))
      problems.push(`${item.name}: expected ${item.expect.code} at ${item.expect.pointer}, got ${JSON.stringify(studioIssue)}`);
    if (item.reject && !item.expect) problems.push(`${item.name} has no expect`);
    const { file, entry } = placeCase(item.name, item.note, item.reject ? 'reject' : 'accept', shippedIssue(shipped, draft.capabilities), item.reject ? studioIssue : undefined);
    writeFileSync(path.join(root, file), `${JSON.stringify(draft)}\n`);
    index.cases.push(entry);
  }
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`${family}: wrote ${cases.length} cases (${cases.filter(item => !item.reject).length} compile)`);
}
