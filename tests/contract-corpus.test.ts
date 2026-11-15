import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCompositionPublication } from '../server/composition';
import { supportedCompositionCapabilities } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';

/**
 * The shared publication corpus (`contract/corpus`) is copied byte for byte into the native app, which runs the same
 * files through its own compiler. Every accept file must decode, every reject file must fail with exactly its recorded
 * first issue, and the capability list must be the app's.
 */
const directory = path.resolve(__dirname, '../contract/corpus');
interface Case {
  file: string; outcome: 'accept' | 'reject'; note: string;
  issue?: { code: string; pointer: string; capability?: string };
}
const read = (file: string) => readFileSync(path.join(directory, file));
const index: { format: number; cases: Case[] } = JSON.parse(read('index.json').toString('utf8'));
const listed = (folder: string) => readdirSync(path.join(directory, folder)).filter(name => name.endsWith('.json')).map(name => `${folder}/${name}`).sort();

function firstIssue(bytes: Buffer) {
  try { decodeCompositionPublication(bytes); return undefined; }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    const [first] = error.issues;
    return { code: first.code, pointer: first.pointer, ...(first.capability ? { capability: first.capability } : {}) };
  }
}

describe('shared contract corpus', () => {
  it('lists every file and no file that is missing', () => {
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

  it.each(index.cases.filter(item => item.outcome === 'reject'))('rejects $file with its recorded first issue', item => {
    expect(firstIssue(read(item.file))).toEqual(item.issue);
  });

  it('has the same capability list as the app', () => {
    const app: string[] = JSON.parse(read('capabilities.json').toString('utf8'));
    expect(new Set(app).size).toBe(app.length);
    expect([...supportedCompositionCapabilities].sort()).toEqual([...app].sort());
  });

  it('exercises every supported capability in an accepted document', () => {
    const covered = new Set<string>();
    for (const item of index.cases.filter(entry => entry.outcome === 'accept')) {
      for (const capability of JSON.parse(read(item.file).toString('utf8')).capabilities as string[]) covered.add(capability);
    }
    expect(supportedCompositionCapabilities.filter(capability => !covered.has(capability))).toEqual([]);
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
