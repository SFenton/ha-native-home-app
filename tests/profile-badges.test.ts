import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { cappedText, expandBadgeSettings, initialsOf, initialsReadable, publishedBadges, usesBadgeSettings } from '../src/shared/composition/profile-badges';
import { cappedValue, spokenValue } from '../scripts/profile-badges-corpus';
import { resolveBadge, type Environment } from '../src/shared/composition/evaluator';

type J = Record<string, any>;
const root = path.resolve(import.meta.dirname, '../contract/corpus');
const envelope = (file: string): J => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const count: J = { type: 'read', from: { type: 'source', sourceId: 'temp', path: ['state'] }, as: 'number', missing: 'unavailable' };
const NEW_IDS = ['sh.avatar@1', 'sh.badge-nodes@1', 'sh.badge-spoken@1', 'sh.shell-profile@1'];
/** The corpus's first-slice tab case with the first tab's badge replaced. */
const withTabBadge = (badge: J): J => { const base = envelope('reject/pending-profile-badges-spoken-tab.json'); base.document.navigation.tabs[0].badge = badge; return base.document; };
const issuesOf = (document: unknown) => { try { compileCompositionDocument(document); return []; } catch (error) { if (error instanceof CompositionValidationError) return error.issues; throw error; } };
const first = (document: unknown) => issuesOf(document)[0];

describe('Show at Most and Spoken As', () => {
  it('works cap 9 and "{Count} overdue" out into the published form of the Chores tab', () => {
    const published = envelope('reject/pending-profile-badges-cap-9-expanded.json').document;
    const authored = withTabBadge({ type: 'value', value: count, cap: 9, spokenOther: '{Count} overdue' });
    expect(publishedBadges(authored)).toEqual(published);
    expect(compileCompositionDocument(authored).capabilities).toEqual(compileCompositionDocument(published).capabilities);
  });
  it('writes the first case of the spoken words on a count equal to 1, then the Otherwise line', () => {
    const authored = withTabBadge({ type: 'value', value: count, spokenOne: '1 item needs attention', spokenOther: '{Count} items need attention' });
    const out = (publishedBadges(authored) as J).navigation.tabs[0].badge;
    expect(out).toEqual({ type: 'value', value: count, spoken: spokenValue(count, '1 item needs attention', '{Count} items need attention') });
    expect(out.spoken.cases[0].when).toEqual({ type: 'compare', op: 'eq', left: count, right: { type: 'literal', value: 1 } });
    expect(out.spoken.otherwise).toEqual({ type: 'format', pattern: '{count} items need attention', args: { count } });
  });
  it('keeps a line without the token as plain words', () => {
    const out = (publishedBadges(withTabBadge({ type: 'value', value: count, spokenOther: 'Needs attention' })) as J).navigation.tabs[0].badge;
    expect(out.spoken).toEqual({ type: 'literal', value: 'Needs attention' });
  });
  it('returns the very same document when no badge holds a setting', () => {
    const document = envelope('accept/badge-tab.json').document;
    expect(expandBadgeSettings(document).document).toBe(document);
    expect(usesBadgeSettings(document)).toBe(false);
    expect(usesBadgeSettings(withTabBadge({ type: 'value', value: count, cap: 9 }))).toBe(true);
  });
  it('works settings out wherever a badge stands, and leaves a literal record alone', () => {
    const document = withTabBadge({ type: 'none' });
    document.pages[2].components = [{ id: 'rec', title: 'x', layout: { span: 1 }, type: 'text', props: { value: { type: 'literal', value: { type: 'value', value: { type: 'literal', value: 1 }, cap: 9 } }, style: 'body', unavailableText: 'x' } }];
    expect(expandBadgeSettings(document).badges).toEqual([]);
    document.navigation.chrome.groups[0].items[1].badge = { type: 'value', value: count, cap: 99 };
    expect(expandBadgeSettings(document).badges).toEqual(['/document/navigation/chrome/groups/0/items/1/badge']);
  });
  it('declares what the worked-out operands need, and the badge ids only once they are used', () => {
    const caps = compileCompositionDocument(withTabBadge({ type: 'value', value: count, cap: 9 })).capabilities;
    expect(caps).toEqual(expect.arrayContaining(['sh.badges@1', 'sh.conditions@1', 'sh.rules@1']));
    expect(caps).not.toContain('sh.badge-spoken@1');
    expect(compileCompositionDocument(withTabBadge({ type: 'value', value: count, spokenOther: '{Count} x' })).capabilities).toContain('sh.badge-spoken@1');
  });
  it('compiles to the authored document, not the worked-out one', () => {
    const authored = withTabBadge({ type: 'value', value: count, cap: 9 });
    expect(compileCompositionDocument(authored).document).toBe(authored);
  });

  const at = '/document/navigation/tabs/0/badge';
  it.each([
    ['a cap of 0', { cap: 0 }, 'invalid_value', '/cap'],
    ['a cap of 1000', { cap: 1000 }, 'invalid_value', '/cap'],
    ['a fractional cap', { cap: 9.5 }, 'invalid_value', '/cap'],
    ['a text cap', { cap: '9' }, 'invalid_value', '/cap'],
    ['a blank line', { spokenOther: '  ' }, 'invalid_value', '/spokenOther'],
    ['a line over 240 characters', { spokenOther: 'x'.repeat(241) }, 'invalid_value', '/spokenOther'],
    ['a brace that is not the token', { spokenOther: '{count} x' }, 'invalid_value', '/spokenOther'],
    ['an unclosed brace', { spokenOne: 'one {', spokenOther: 'x' }, 'invalid_value', '/spokenOne'],
    ['For 1 with no Otherwise', { spokenOne: '1 item' }, 'missing_required', '/spokenOther'],
    ['both the lines and a spoken operand', { spokenOther: 'x', spoken: { type: 'literal', value: 'y' } }, 'invalid_combination', '/spoken'],
  ])('refuses %s at the setting', (_name, settings, code, pointer) => {
    expect(first(withTabBadge({ type: 'value', value: count, ...settings }))).toMatchObject({ code, pointer: `${at}${pointer}` });
  });
  it('accepts the whole range of a cap, 1 to 999', () => {
    for (const cap of [1, 9, 99, 999]) expect(() => compileCompositionDocument(withTabBadge({ type: 'value', value: count, cap }))).not.toThrow();
    expect(cappedText(99)).toBe('99+');
  });
  it('reports a fault in the count once, where the author wrote it', () => {
    // A text read cannot be compared with `above`: the fault is in the value, not in the rule the cap wrote.
    const text: J = { ...count, as: 'string' };
    expect(issuesOf(withTabBadge({ type: 'value', value: text, cap: 9 }))).toEqual([{ code: 'binding_type', pointer: `${at}/value` }]);
    expect(issuesOf(withTabBadge({ type: 'value', value: text, spokenOne: 'a', spokenOther: 'b' })).map(issue => issue.pointer)).toEqual([`${at}/value`]);
    // A source that does not exist is named once too, inside the count.
    const missing = withTabBadge({ type: 'value', value: { ...count, from: { type: 'source', sourceId: 'missing', path: ['state'] } }, cap: 9, spokenOther: '{Count} x' });
    expect(issuesOf(missing)).toEqual([{ code: 'invalid_reference', pointer: `${at}/value/from/sourceId` }]);
  });
  it('reports a count too large for the expression budget at the cap', () => {
    // Every use of the count is a copy: a count of 20 nodes written three times passes 64.
    let sum: J = count;
    for (let i = 0; i < 12; i += 1) sum = { type: 'math', op: 'add', args: [sum, count] };
    const found = issuesOf(withTabBadge({ type: 'value', value: sum, cap: 9 }));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(issue => issue.pointer.startsWith(at))).toBe(true);
  });
  it('is refused in a publication as an unknown field, so nothing unworked reaches the app', () => {
    const published = envelope('reject/pending-profile-badges-spoken-tab.json');
    published.document.navigation.tabs[0].badge = { type: 'value', value: count, cap: 9 };
    expect(() => decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(published)))).toThrowError(CompositionValidationError);
    try { decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(published))); } catch (error) { expect((error as CompositionValidationError).issues[0]).toMatchObject({ code: 'unknown_field', pointer: `${at}/cap` }); }
  });
});

describe('what the worked-out badge says (the evaluation corpus holds the same)', () => {
  const env = (n?: number): Environment => ({ read: (id: string) => id === 'temp' && n !== undefined ? { status: 'value', value: n } : { status: 'unavailable' } }) as unknown as Environment;
  const badge = { type: 'value' as const, value: cappedValue(count, 9), spoken: spokenValue(count, '1 chore', '{Count} overdue') };
  it.each([[0, null, null], [1, '1', '1 chore'], [9, '9', '9 overdue'], [10, '9+', '10 overdue'], [250, '9+', '250 overdue']])('a count of %i draws %s and says %s', (n, text, spoken) => {
    expect(resolveBadge(badge as never, env(n))).toEqual({ status: 'value', text, spoken });
  });
  it('draws nothing when the count cannot be read, and keeps what it showed while it loads', () => {
    expect(resolveBadge(badge as never, env())).toEqual({ status: 'value', text: null, spoken: null });
    const loading = { read: () => ({ status: 'loading' }) } as unknown as Environment;
    expect(resolveBadge(badge as never, loading)).toEqual({ status: 'loading' });
    expect(resolveBadge({ type: 'value', value: cappedValue(count, 9) } as never, env())).toEqual({ status: 'value', text: null });
  });
  it('keeps what it showed while a raw read is loading, and draws nothing when one is unavailable', () => {
    const raw = { type: 'choose', cases: [{ when: { type: 'in', value: { type: 'raw-state', sourceId: 'door' }, in: [{ type: 'literal', value: 'open' }] }, then: { type: 'literal', value: '!' } }], otherwise: { type: 'literal', value: '1' } };
    const environment = (status: string) => ({ read: () => ({ status: 'unavailable' }), readRaw: () => ({ status }) }) as unknown as Environment;
    expect(resolveBadge({ type: 'value', value: raw } as never, environment('loading'))).toEqual({ status: 'loading' });
    expect(resolveBadge({ type: 'value', value: raw } as never, environment('unavailable'))).toEqual({ status: 'value', text: null });
  });
  it('adds no spoken key to a badge that has no spoken words', () => { expect(resolveBadge({ type: 'value', value: count } as never, env(3))).toEqual({ status: 'value', text: '3' }); });
});

describe('the initials of a person', () => {
  it.each([
    ['Alex Demo', 'AD'], ['alex demo', 'AD'], ['Alex', 'A'], ['  alex   demo   third ', 'AD'], ['Éloïse Ñandú', 'ÉÑ'], ['Mary-Jane Watson', 'MW'], ['(Guest) Room', 'GR'], ['王 小明', '王小'],
  ])('is the first letter of the first two words of %s: %s', (name, initials) => { expect(initialsOf(name)).toBe(initials); });
  it.each([[undefined], [null], [''], ['   '], ['123 456'], ['— —']])('has none for %j, where the app draws the person symbol', name => { expect(initialsOf(name as never)).toBeUndefined(); });
  it('holds white initials to 4.5 to 1: the standard blue passes, a pale yellow does not', () => {
    expect(initialsReadable({ red: 0, green: 102, blue: 204 })).toBe(true);
    expect(initialsReadable({ red: 255, green: 235, blue: 59 })).toBe(false);
    expect(initialsReadable({ red: 118, green: 118, blue: 118 })).toBe(true);
    expect(initialsReadable({ red: 119, green: 119, blue: 119 })).toBe(false);
  });
});

describe('the four ids over the whole corpus', () => {
  const files = ['accept', 'reject'].flatMap(folder => readdirSync(path.join(root, folder)).map(name => `${folder}/${name}`));
  const mine = /profile-badges-|badge-chrome-button/;
  it('are declared only by a document that uses them, so every other case compiles byte for byte as before', () => {
    let compiled = 0;
    for (const file of files) {
      let document: unknown;
      try { document = JSON.parse(readFileSync(path.join(root, file), 'utf8')).document; } catch { continue; }
      let result;
      try { result = compileCompositionDocument(document, { tileInkDefault: false }); } catch { continue; }
      compiled += 1;
      const used = result.capabilities.filter(name => NEW_IDS.includes(name));
      if (!mine.test(file)) expect(used, file).toEqual([]);
      // Nothing is worked out in a document that holds no setting: the compile hands back the document it was given.
      if (!mine.test(file)) expect(result.document, file).toEqual(document);
    }
    expect(compiled).toBeGreaterThan(500);
  });
  it('are each exercised by a case the Studio compiles', () => {
    for (const id of NEW_IDS) {
      const hit = files.filter(file => { try { return JSON.parse(readFileSync(path.join(root, file), 'utf8')).capabilities.includes(id); } catch { return false; } });
      expect(hit.length, id).toBeGreaterThan(0);
    }
  });
  it('are declared by exactly the case that needs them: the header, the node, the spoken words and the added kinds', () => {
    const declared = (file: string) => envelope(file).capabilities.filter((name: string) => NEW_IDS.includes(name));
    expect(declared('reject/pending-profile-badges-header-profile-photo.json')).toEqual(['sh.shell-profile@1']);
    expect(declared('reject/pending-profile-badges-avatar-viewer.json')).toEqual(['sh.avatar@1']);
    expect(declared('reject/pending-profile-badges-spoken-tab.json')).toEqual(['sh.badge-spoken@1']);
    expect(declared('reject/pending-profile-badges-badge-chrome-button.json')).toEqual(['sh.badge-nodes@1']);
    expect(declared('reject/pending-profile-badges-badge-door-tile.json')).toEqual(['sh.badge-nodes@1', 'sh.badge-spoken@1']);
    expect(declared('reject/pending-profile-badges-avatar-badge.json')).toEqual(NEW_IDS.filter(id => id !== 'sh.shell-profile@1'));
    expect(declared('accept/profile-badges-header-without-profile-needs-no-id.json')).toEqual([]);
    expect(declared('accept/profile-badges-badge-chrome-button-none-needs-no-id.json')).toEqual([]);
  });
});
