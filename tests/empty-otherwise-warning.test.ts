import { describe, expect, it } from 'vitest';
import { compositionWarnings, emptyOtherwiseWarnings } from '../src/shared/composition/lints';
import { runChecks } from '../src/workspace2/checks';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { addEntry, countCases } from '../src/workspace2/data/logic/logicModel';
import { followCheck } from '../src/workspace2/checks';
import firstSlice from './fixtures/composition-first-slice.json';

type J = Record<string, any>;
const lit = (value: unknown) => ({ type: 'literal', value });
const when = { type: 'compare', op: 'eq', left: lit(1), right: lit(1) };
const choose = (otherwise: unknown): J => ({ type: 'choose', cases: [{ when, then: lit('One') }], otherwise });
const map = (otherwise: unknown): J => ({ type: 'map', of: lit('a'), cases: [{ equals: 'a', then: lit('One') }], otherwise });

describe('an empty Otherwise text is a warning', () => {
  it('warns for a choose and a map whose Otherwise is empty text, at the Otherwise', () => {
    for (const make of [choose, map]) {
      expect(emptyOtherwiseWarnings(make(lit('')), '/x')).toEqual([{ pointer: '/x/otherwise', message: 'Otherwise has no text, so nothing shows when no case holds. Add the text for Otherwise.' }]);
      expect(emptyOtherwiseWarnings(make(lit('   ')), '/x')).toHaveLength(1);
    }
  });
  it('is quiet when Otherwise has text, is a number, or reads something', () => {
    for (const make of [choose, map]) {
      expect(emptyOtherwiseWarnings(make(lit('Many')))).toEqual([]);
      expect(emptyOtherwiseWarnings(make(lit(0)))).toEqual([]);
      expect(emptyOtherwiseWarnings(make({ type: 'format', pattern: '{a}', args: { a: lit(2) } }))).toEqual([]);
    }
    expect(emptyOtherwiseWarnings({ type: 'literal', value: '' })).toEqual([]);
    expect(emptyOtherwiseWarnings(undefined)).toEqual([]);
  });
  it('is found anywhere in a document, and shows in the Checks as a suggestion at that place', () => {
    const document = structuredClone((firstSlice as unknown as { document: CompositionDocument }).document) as unknown as J;
    expect(compositionWarnings(document).filter(item => item.pointer.endsWith('/otherwise'))).toEqual([]);
    const tile = document.pages[2].components.find((node: J) => node.props?.subtitle) ?? document.pages[2].components[0];
    tile.props.subtitle = { type: 'expr', value: choose(lit('')) };
    const found = compositionWarnings(document).filter(item => item.pointer.endsWith('/otherwise'));
    expect(found).toHaveLength(1);
    const row = runChecks(document as CompositionDocument).suggestions.find(item => item.sentence.includes('Otherwise has no text'));
    expect(row?.sentence).toContain(`${row?.place}: Otherwise has no text`);
  });

  it('names the page and goes to the item for a case in a page', () => {
    const document = structuredClone((firstSlice as unknown as { document: CompositionDocument }).document) as unknown as J;
    const tile = document.pages[2].components[0];
    tile.props.subtitle = { type: 'expr', value: choose(lit('')) };
    const row = runChecks(document as CompositionDocument).suggestions.find(item => item.sentence.includes('Otherwise has no text'))!;
    expect(row.place).not.toMatch(/Logic Template|^Project$/);
    expect(row.go).toEqual({ select: expect.stringMatching(/^node:/) });
  });

  it('names the Logic Template and opens its editor at the body for a template\'s count cases', () => {
    const base = structuredClone((firstSlice as unknown as { document: CompositionDocument }).document);
    const added = addEntry(base, 'value', 'Open Doors Line');
    const document = structuredClone(added.document) as unknown as J;
    const count = { type: 'count', of: [{ test: { type: 'state', sourceId: 'a', path: ['state'], in: ['on'] } }] };
    document.logicLibrary[0].body = { type: 'choose', ...countCases(count) };
    const row = runChecks(document as CompositionDocument).suggestions.find(item => item.sentence.includes('Otherwise has no text'))!;
    expect(row.sentence).toBe('In the Logic Template Open Doors Line: Otherwise has no text, so nothing shows when no case holds. Add the text for Otherwise.');
    expect(row.go).toEqual({ logic: added.id });
    expect(row.fieldPath).toBe('logic-body');
    const opened: string[] = [], focused: string[] = [];
    followCheck(row, { select: () => {}, panel: () => {}, dialog: () => {}, logic: id => opened.push(id), focus: path => focused.push(path) });
    expect(opened).toEqual([added.id]);
    expect(focused).toEqual(['logic-body']);
  });
});
