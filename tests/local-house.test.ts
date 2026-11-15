import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLocalHouse, localHouseDirectory, parseRestoredCardActions } from '../scripts/local-house';

describe('local house files', () => {
  it('reads the file from the folder STUDIO_LOCAL_DIR names', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'studio-local-'));
    writeFileSync(path.join(directory, 'sample.json'), JSON.stringify({ actions: [] }));
    expect(localHouseDirectory({ STUDIO_LOCAL_DIR: directory })).toBe(directory);
    expect(loadLocalHouse('sample', { STUDIO_LOCAL_DIR: directory })).toEqual({ actions: [] });
  });

  it('defaults to the git-ignored .local folder at the repository root', () => {
    expect(localHouseDirectory({})).toMatch(/\.local$/);
    expect(readFileSync(path.resolve(import.meta.dirname, '../.gitignore'), 'utf8').split('\n')).toContain('.local/');
  });

  it('names the missing file and its example, and rejects unreadable JSON', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'studio-local-'));
    expect(() => loadLocalHouse('absent', { STUDIO_LOCAL_DIR: directory })).toThrow(/scripts\/examples\/absent\.example\.json/);
    writeFileSync(path.join(directory, 'broken.json'), '{');
    expect(() => loadLocalHouse('broken', { STUDIO_LOCAL_DIR: directory })).toThrow(/not valid JSON/);
  });

  it('accepts the shipped synthetic example for the card-action restore', () => {
    const example = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../scripts/examples/restore-theater-actions.example.json'), 'utf8'));
    expect(parseRestoredCardActions(example)).toHaveLength(4);
  });

  it('rejects an empty list, a bad service name and a repeated card', () => {
    expect(() => parseRestoredCardActions({ actions: [] })).toThrow(/non-empty/);
    expect(() => parseRestoredCardActions(null)).toThrow(/non-empty/);
    expect(() => parseRestoredCardActions({ actions: [{ cardKey: 'a', scriptService: 'Not A Service' }] })).toThrow(/scriptService/);
    expect(() => parseRestoredCardActions({ actions: [{ cardKey: '', scriptService: 'run' }] })).toThrow(/cardKey/);
    expect(() => parseRestoredCardActions({ actions: [{ cardKey: 'a', scriptService: 'run' }, { cardKey: 'a', scriptService: 'run' }] })).toThrow(/repeats/);
  });
});
