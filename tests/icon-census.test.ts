import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasGlyph } from '../src/preview2/nodes/shared';
import { iconChoices } from '../src/workspace2/pickers/icons';
import { domainGlyphNames } from '../src/workspace2/pickers/EntityList';

/** Every `*.json` under a folder. */
function jsonFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap(entry => {
    const file = path.join(root, entry);
    return statSync(file).isDirectory() ? jsonFiles(file) : file.endsWith('.json') ? [file] : [];
  });
}
/** The symbol names a parsed document asks for: every `sf-symbol` object, and every plain `icon` string. */
function symbolsIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(item => symbolsIn(item, found));
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.type === 'sf-symbol' && typeof record.name === 'string') found.add(record.name);
    if (typeof record.icon === 'string') found.add(record.icon);
    Object.values(record).forEach(item => symbolsIn(item, found));
  }
  return found;
}
const census = (files: string[]) => new Set(files.flatMap(file => [...symbolsIn(JSON.parse(readFileSync(file, 'utf8')))]));
const missing = (names: Iterable<string>) => [...names].filter(name => name.trim() && !hasGlyph(name)).sort();

describe('the icon census: no requested symbol falls back to the question mark', () => {
  it('draws a glyph for every symbol in the icon catalogue', () => {
    expect(missing(iconChoices.map(choice => choice.symbol))).toEqual([]);
  });
  it('draws a glyph for the stand-in glyph of every entity domain', () => {
    expect(missing(domainGlyphNames)).toEqual([]);
  });
  it('draws a glyph for every symbol in the committed fixtures and the contract corpus', () => {
    const files = [...jsonFiles('src/preview2/fixtures'), ...jsonFiles('tests/fixtures'), ...jsonFiles('contract/corpus')];
    const names = census(files);
    expect(names.size).toBeGreaterThan(50);
    expect(missing(names)).toEqual([]);
  });
  // The owner-like copy is never committed: point STUDIO_CENSUS_DATA at a copy of a data directory to run this too.
  it.skipIf(!process.env.STUDIO_CENSUS_DATA)('draws a glyph for every symbol in the data copy', () => {
    expect(missing(census(jsonFiles(process.env.STUDIO_CENSUS_DATA!)))).toEqual([]);
  });
});
