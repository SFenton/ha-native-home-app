import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument, supportedCompositionCapabilities } from '../src/shared/composition/compiler';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { CompositionValidationError } from '../src/shared/composition/json';

/**
 * The shared publication corpus (`contract/corpus`) is copied byte for byte into the native app, which runs the same
 * files through its own compiler. Every accept file must decode, every reject file must fail with exactly its recorded
 * first issue, and the capability list must be the app's.
 *
 * The handshake: `capabilities.json` is the list the app ships; `capabilities.pending.json` is Studio-owned and holds ids the Studio compiles but the
 * app does not list yet. A case marked `pending` declares one of them: the shipped list refuses it first (`issue`, which the app's own test checks
 * too) while the Studio compiles it (`studioIssue` absent) or gives its own first issue (`studioIssue`).
 */
const directory = path.resolve(__dirname, '../contract/corpus');
interface Case {
  file: string; outcome: 'accept' | 'reject'; note: string;
  issue?: { code: string; pointer: string; capability?: string };
  pending?: boolean;
  studioIssue?: { code: string; pointer: string; capability?: string };
}
const read = (file: string) => readFileSync(path.join(directory, file));
const index: { format: number; cases: Case[] } = JSON.parse(read('index.json').toString('utf8'));
const listed = (folder: string) => readdirSync(path.join(directory, folder)).filter(name => name.endsWith('.json')).map(name => `${folder}/${name}`).sort();

/** A `capability_manifest_mismatch` that is exactly the Studio's `sh.badge-nodes@1` missing from the declared list: the compiled list minus that id equals the declared one. */
function badgeNodesOnly(item: Case): boolean {
  if (item.studioIssue?.code !== 'capability_manifest_mismatch') return false;
  const envelope = JSON.parse(read(item.file).toString('utf8'));
  const compiled = compileCompositionDocument(envelope.document, { tileInkDefault: envelope.capabilities.includes('sh.tile-ink-default@1') }).capabilities;
  return !envelope.capabilities.includes('sh.badge-nodes@1') && JSON.stringify(compiled.filter(name => name !== 'sh.badge-nodes@1')) === JSON.stringify(envelope.capabilities);
}

function firstIssue(bytes: Buffer) {
  try { decodeCompositionPublication(bytes); return undefined; }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    const [first] = error.issues;
    return { code: first.code, pointer: first.pointer, ...(first.capability ? { capability: first.capability } : {}) };
  }
}

const shipped: string[] = JSON.parse(read('capabilities.json').toString('utf8'));
const pending: string[] = JSON.parse(read('capabilities.pending.json').toString('utf8'));
/** What the shipped app does first with an envelope: refuse the first capability it does not list. */
function shippedIssue(bytes: Buffer) {
  const capabilities: string[] = JSON.parse(bytes.toString('utf8')).capabilities;
  const at = capabilities.findIndex(name => !shipped.includes(name));
  return at < 0 ? undefined : { code: 'unsupported_capability', pointer: `/capabilities/${at}`, capability: capabilities[at] };
}

describe('shared contract corpus', () => {
  it('lists every file and no file that is missing', () => {
    expect(index.cases.every(item => !item.pending || item.outcome === 'reject')).toBe(true);
    expect(index.format).toBe(1);
    expect(index.cases.map(item => item.file).sort()).toEqual([...listed('accept'), ...listed('reject')]);
    expect(new Set(index.cases.map(item => item.file)).size).toBe(index.cases.length);
    for (const item of index.cases) {
      expect(item.file.startsWith(`${item.outcome}/`)).toBe(true);
      expect(item.note.length).toBeGreaterThan(10);
      expect(Boolean(item.issue)).toBe(item.outcome === 'reject');
    }
  });

  it.each(index.cases.filter(item => item.outcome === 'accept'))('accepts $file', item => {
    expect(firstIssue(read(item.file))).toBeUndefined();
  });

  it.each(index.cases.filter(item => item.outcome === 'reject' && !item.pending))('rejects $file with its recorded first issue', item => {
    expect(firstIssue(read(item.file))).toEqual(item.issue);
  });

  it.each(index.cases.filter(item => item.pending))('holds back $file: the shipped list refuses it, the Studio gives its own answer', item => {
    expect(item.outcome).toBe('reject');
    expect(shippedIssue(read(item.file))).toEqual(item.issue);
    expect(firstIssue(read(item.file))).toEqual(item.studioIssue);
  });

  it('has the same capability list as the app, and keeps the pending set apart', () => {
    expect(new Set(shipped).size).toBe(shipped.length);
    expect(new Set(pending).size).toBe(pending.length);
    expect(pending.filter(name => shipped.includes(name))).toEqual([]);
    expect([...pending]).toEqual([...pending].sort());
    expect([...pendingCompositionCapabilities].sort()).toEqual([...pending].sort());
    expect([...supportedCompositionCapabilities].sort()).toEqual([...shipped, ...pending].sort());
  });

  it('exercises every pending capability in a case the Studio compiles', () => {
    const covered = new Set<string>();
    // A case whose only difference is `sh.badge-nodes@1` still exercises the capability: the global-chrome cases carry a header button with a drawn badge, which the
    // Studio's badge lane lists and the app's list does not yet. Any other manifest mismatch is not coverage.
    for (const item of index.cases.filter(entry => entry.pending && (!entry.studioIssue || badgeNodesOnly(entry)))) {
      for (const capability of JSON.parse(read(item.file).toString('utf8')).capabilities as string[]) covered.add(capability);
    }
    expect(pending.filter(capability => !covered.has(capability))).toEqual([]);
  });

  it('exercises every supported capability in an accepted document', () => {
    const covered = new Set<string>();
    for (const item of index.cases.filter(entry => entry.outcome === 'accept')) {
      for (const capability of JSON.parse(read(item.file).toString('utf8')).capabilities as string[]) covered.add(capability);
    }
    expect(shipped.filter(capability => !covered.has(capability))).toEqual([]);
  });

  it('keeps the drift cases the contract was built around', () => {
    const rejected = (name: string) => index.cases.find(item => item.file === `reject/${name}.json`)?.issue;
    expect(rejected('bedroom-old-bed-script-tonight')?.code).toBe('unknown_field');
    expect(rejected('bedroom-old-environment-topic')?.code).toBe('unknown_field');
    expect(rejected('remote-script-with-target')?.code).toBe('invalid_combination');
    expect(rejected('duplicate-key-nfc-composed-then-decomposed')?.code).toBe('duplicate_key');
    expect(rejected('capability-unknown')?.code).toBe('unsupported_capability');
    expect(rejected('collection-pull-to-refresh-not-boolean')?.code).toBe('invalid_value');
  });

  it('keeps the shared fixtures identical to the Studio fixtures', () => {
    for (const name of ['composition-first-slice', 'device-providers', 'home-domains', 'home-primitives', 'remote-composition']) {
      expect(read(`accept/fixture-${name}.json`).equals(readFileSync(path.resolve(__dirname, name === 'home-domains' ? '../src/preview2/fixtures/home-domains.json' : `fixtures/${name}.json`)))).toBe(true);
    }
  });
});
