import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument, legacyManifest } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { overviewWordKeys, wordProblems } from '../src/shared/composition/state-words';
import { lightLine, overviewLine } from '../src/preview2/state-words';
import { wordLine, wordRowsFor, wordsSummary } from '../src/workspace2/layout/StateWordsFold';

const corpus = path.resolve(import.meta.dirname, '../contract/corpus');
const index: { cases: { file: string; outcome: string; pending?: boolean; studioIssue?: { code: string; pointer: string }; issue?: { code: string; pointer: string } }[] } = JSON.parse(readFileSync(path.join(corpus, 'index.json'), 'utf8'));
const ours = index.cases.filter(item => /^(accept|reject)\/(pending-)?state-words-/.test(item.file));
const bytes = (file: string) => readFileSync(path.join(corpus, file));
const envelope = (file: string) => JSON.parse(bytes(file).toString('utf8'));

describe('sh.state-words@1 corpus', () => {
  it('is pending and sorted, with compile cases and refusals that each carry an expect', () => {
    expect(pendingCompositionCapabilities).toContain('sh.state-words@1');
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
    expect(ours.filter(item => item.studioIssue).length).toBe(18);
    expect(ours.filter(item => item.pending && !item.studioIssue).length).toBe(9);
    for (const item of ours.filter(entry => entry.studioIssue)) expect(item.studioIssue).toMatchObject({ code: expect.any(String), pointer: expect.any(String) });
  });
  it.each(ours.filter(item => item.pending && !item.studioIssue))('compiles $file and declares the id', item => {
    const document = envelope(item.file);
    expect(() => decodeCompositionPublication(bytes(item.file))).not.toThrow();
    expect(document.capabilities).toContain('sh.state-words@1');
    expect(legacyManifest(compileCompositionDocument(document.document).capabilities)).toEqual(legacyManifest(document.capabilities));
  });
  it.each(ours.filter(item => item.studioIssue))('refuses $file with its own code at its own pointer', item => {
    let first: { code: string; pointer: string } | undefined;
    try { decodeCompositionPublication(bytes(item.file)); } catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      first = error.issues[0];
    }
    expect({ code: first?.code, pointer: first?.pointer }).toEqual({ code: item.studioIssue!.code, pointer: item.studioIssue!.pointer });
  });
  it('declares the id only on a document that has words', () => {
    expect(envelope('accept/state-words-light-group-without-words-needs-no-id.json').capabilities).not.toContain('sh.state-words@1');
  });
});

describe('word problems', () => {
  it('refuses a key the tile cannot draw, a missing token and a stray one', () => {
    expect(wordProblems({ count: 'Some' }, ['count'])).toEqual([{ code: 'invalid_value', at: '/count' }]);
    expect(wordProblems({ count: '{count} lit' }, ['count'])).toEqual([]);
    expect(wordProblems({ on: '{count}' }, ['on'])).toEqual([{ code: 'invalid_value', at: '/on' }]);
    expect(wordProblems({ level: '{value}%' }, ['on', 'off'])).toEqual([{ code: 'invalid_combination', at: '/level' }]);
  });
  it('gives each overview projection its keys', () => {
    expect(overviewWordKeys('lights')).toEqual(['on', 'off', 'unavailable', 'count']);
    expect(overviewWordKeys('occupancy')).toEqual(['on', 'off', 'unavailable']);
    expect(overviewWordKeys('contacts')).toEqual(['unavailable']);
  });
});

describe('what the sim says', () => {
  const lit = { dead: false, on: true, percent: 45, dims: true };
  it('says production words when none are authored', () => {
    expect(lightLine(undefined, lit)).toBe('45%');
    expect(lightLine(undefined, { ...lit, on: false })).toBe('Off');
    expect(lightLine(undefined, { ...lit, dead: true })).toBe('Unavailable');
    expect(lightLine(undefined, { ...lit, dims: false })).toBe('On');
  });
  it('says each authored word', () => {
    expect(lightLine({ level: 'Glowing {value} percent' }, lit)).toBe('Glowing 45 percent');
    expect(lightLine({ off: 'Dark' }, { ...lit, on: false })).toBe('Dark');
    expect(lightLine({ unavailable: 'Gone' }, { ...lit, dead: true })).toBe('Gone');
    expect(lightLine({ on: 'Lit' }, { ...lit, dims: false })).toBe('Lit');
  });
  it('says a room overview its words, and keeps the source line where it has none', () => {
    const lights = { projection: 'lights', format: 'room' };
    expect(overviewLine(undefined, { ...lights, count: 3, total: 4 }, '3 On')).toBe('3 On');
    expect(overviewLine({ count: '{count} Lit' }, { ...lights, count: 3, total: 4 }, '3 On')).toBe('3 Lit');
    expect(overviewLine({ on: 'One Lit' }, { ...lights, count: 1, total: 1 }, 'On')).toBe('One Lit');
    expect(overviewLine({ off: 'All Dark' }, { ...lights, count: 0, total: 4 }, 'Off')).toBe('All Dark');
    expect(overviewLine({ unavailable: 'Gone' }, { ...lights, phase: 'unavailable' }, 'Unavailable')).toBe('Gone');
    expect(overviewLine({ on: 'Here' }, { projection: 'occupancy', format: 'room', count: 1 }, 'Occupied')).toBe('Here');
    expect(overviewLine({ on: 'x' }, { projection: 'lights', format: 'summary', count: 1, total: 1 }, 'Keep')).toBe('Keep');
  });
});

describe('the State Words fold', () => {
  it('lists the keys a tile can draw, in the table order', () => {
    expect(wordRowsFor('light-group-tile')).toEqual(['on', 'off', 'unavailable', 'level']);
    expect(wordRowsFor('room-overview-tile', 'lights')).toEqual(['on', 'off', 'unavailable', 'count']);
    expect(wordRowsFor('room-overview-tile', 'contacts')).toEqual(['unavailable']);
  });
  it('summarises as Default or N Changed', () => {
    expect(wordsSummary(undefined)).toBe('Default');
    expect(wordsSummary({ off: 'Dark', level: '{value} up' })).toBe('2 Changed');
  });
  it('writes the example, the range and the token checks', () => {
    expect(wordLine('count', undefined)?.text).toBe('Shows “2 On”.');
    expect(wordLine('count', '{count} Lights On')?.text).toBe('Shows “2 Lights On”.');
    expect(wordLine('count', 'Many')).toEqual({ tone: 'warn', text: 'Count Text has no {count}, so every room would read the same.' });
    expect(wordLine('level', 'Bright')).toEqual({ tone: 'warn', text: 'Level Text has no {value}.' });
    expect(wordLine('level', undefined)?.text).toBe('Shows 1% to 100% on a light that dims.');
    expect(wordLine('off', 'x')).toBeUndefined();
  });
});
