import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCompositionPublication, validateCompositionPublication } from '../server/composition';
import { compileCompositionDocument, INK_DEFAULT_CAPABILITY, legacyManifest } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';

const ON = { tileInkDefault: true }, OFF = { tileInkDefault: false };

const corpus = path.resolve(import.meta.dirname, '../contract/corpus');
const index: { cases: { file: string; outcome: string; pending?: boolean; issue?: { code: string } }[] } = JSON.parse(readFileSync(path.join(corpus, 'index.json'), 'utf8'));
const ours = index.cases.filter(item => item.file.startsWith('accept/tile-ink-default-'));
const envelope = (file: string) => JSON.parse(readFileSync(path.join(corpus, file), 'utf8'));

describe('sh.tile-ink-default@1', () => {
  it('is shipped and has one accepted case for each tile that draws a glyph and a state line', () => {
    expect(pendingCompositionCapabilities).not.toContain(INK_DEFAULT_CAPABILITY);
    expect(ours.map(item => item.file.replace(/^.*ink-default-|\.json$/g, '')).sort()).toEqual(['action-tile', 'light-group-tile', 'room-overview-tile', 'state-tile']);
    for (const item of ours) {
      expect(item.outcome).toBe('accept');
      expect(item.pending).toBeUndefined();
      expect(item.issue).toBeUndefined();
    }
  });
  it.each(ours)('compiles $file with the id and nothing else new', item => {
    const published = envelope(item.file);
    expect(published.capabilities).toContain(INK_DEFAULT_CAPABILITY);
    expect(compileCompositionDocument(published.document, ON).capabilities).toEqual(published.capabilities);
    expect(() => decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(published)))).not.toThrow();
  });
  it('declares the shipped id by default, while an authored capabilities field remains invalid', () => {
    const plain = envelope('accept/fixture-composition-first-slice.json');
    const compiled = compileCompositionDocument(plain.document).capabilities;
    expect(compiled).toEqual([...plain.capabilities, INK_DEFAULT_CAPABILITY].sort());
    expect(compileCompositionDocument(plain.document, OFF).capabilities).toEqual(plain.capabilities);
    // There is no field to opt in with: a document that names the id in its own text is refused as an unknown field.
    expect(() => compileCompositionDocument({ ...plain.document, capabilities: [INK_DEFAULT_CAPABILITY] })).toThrow(CompositionValidationError);
  });
  it('can explicitly request primary ink, adding only that id', () => {
    const plain = envelope('accept/fixture-composition-first-slice.json');
    const compiled = compileCompositionDocument(plain.document, ON).capabilities;
    expect(compiled).toContain(INK_DEFAULT_CAPABILITY);
    expect(legacyManifest(compiled)).toEqual(plain.capabilities);
    expect(compiled).toEqual([...compiled].sort());
  });
  it('accepts a manifest made before the id and a manifest that holds it, and refuses any other', () => {
    const plain = envelope('accept/fixture-composition-first-slice.json');
    expect(() => validateCompositionPublication(plain)).not.toThrow();
    const now = { ...plain, capabilities: [...plain.capabilities, INK_DEFAULT_CAPABILITY].sort() };
    expect(() => validateCompositionPublication(now)).not.toThrow();
    const wrong = { ...plain, capabilities: plain.capabilities.slice(1) };
    try { validateCompositionPublication(wrong); expect.unreachable(); }
    catch (error) { expect(error).toBeInstanceOf(CompositionValidationError); expect((error as CompositionValidationError).issues[0]).toMatchObject({ code: 'capability_manifest_mismatch', pointer: '/capabilities' }); }
  });
  it('changes nothing over the corpus with the gate off: a compiled manifest is exactly what was recorded, for every case that compiles and records one without it', () => {
    let checked = 0;
    for (const item of index.cases.filter(entry => entry.outcome === 'accept' || (entry.pending && !(entry as { studioIssue?: unknown }).studioIssue))) {
      const published = envelope(item.file);
      if (published.capabilities.includes(INK_DEFAULT_CAPABILITY)) continue;
      expect(compileCompositionDocument(published.document, OFF).capabilities, item.file).toEqual(published.capabilities);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });
  it('by default, the same corpus compiles to the recorded manifest plus the id and nothing else', () => {
    let checked = 0;
    for (const item of index.cases.filter(entry => entry.outcome === 'accept' || (entry.pending && !(entry as { studioIssue?: unknown }).studioIssue))) {
      const published = envelope(item.file);
      if (published.capabilities.includes(INK_DEFAULT_CAPABILITY)) continue;
      expect(compileCompositionDocument(published.document).capabilities, item.file).toEqual([...published.capabilities, INK_DEFAULT_CAPABILITY].sort());
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });
});
