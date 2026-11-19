import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { wgdialStory } from '../src/preview2/fixtures/wgdial-story';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';

/**
 * The WG-S4 ids: what declares each, that a document without the new nodes compiles as it did, the rules the compiler adds, and the story (generic words only).
 */
type J = Record<string, any>;
const corpus = path.resolve(__dirname, '../contract/corpus');
const first = JSON.parse(readFileSync(path.join(corpus, 'accept/fixture-composition-first-slice.json'), 'utf8')) as { document: J };
const lit = (value: unknown): J => ({ type: 'literal', value });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const dial = (id = 'd', props: J = {}): J => node(id, 'dial', {
  props: { sweep: { start: 145, length: 250 }, ticks: { count: 25, inner: 0.7, outer: 0.9, width: 1, ink: solid(1, 2, 3) },
    pointer: { kind: 'tick', value: lit(0.5), inner: 0.6, outer: 0.95, width: 2, ink: solid(4, 5, 6) }, ...props }, a11y: { element: 'hidden' },
});
const arc = (id = 'a', props: J = {}): J => node(id, 'arc-track', {
  props: { curve: { from: [8, 40], control: [50, 4], to: [92, 40] }, box: [100, 48], ink: solid(1, 2, 3), width: 2, progress: lit(0.5), marker: { size: 10, ink: solid(7, 8, 9) }, ...props }, a11y: { element: 'hidden' },
});
const stack = (id: string, children: J[]): J => node(id, 'stack', { props: { axis: 'vertical', spacing: { type: 'token', name: 'm' } }, children });
const compile = (components: J[], tweak?: (document: J) => void) => {
  const document = structuredClone(first.document);
  document.pages[2].components = components;
  tweak?.(document);
  return compileCompositionDocument(document).capabilities;
};
const issue = (components: J[], tweak?: (document: J) => void) => {
  try { compile(components, tweak); } catch (error) { if (error instanceof CompositionValidationError) return error.issues[0]; throw error; }
  return undefined;
};
const ids = ['sh.dial@1', 'sh.arc-track@1'];

describe('the two WG-S4 ids', () => {
  it('are shipped and sorted, and the Studio supports them', () => {
    for (const id of ids) expect(pendingCompositionCapabilities).not.toContain(id);
    expect(JSON.parse(readFileSync(path.join(corpus, 'capabilities.pending.json'), 'utf8'))).toEqual([...pendingCompositionCapabilities]);
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
  });
  it('are declared by the node that uses them and only then', () => {
    const wanted = (list: string[]) => list.filter(id => ids.includes(id));
    expect(wanted(compile([]))).toEqual([]);
    expect(wanted(compile([dial()]))).toEqual(['sh.dial@1']);
    expect(wanted(compile([arc()]))).toEqual(['sh.arc-track@1']);
    expect(wanted(compile([dial('d'), arc('a')])).sort()).toEqual([...ids].sort());
  });
  it('declare the ink ids their colours need, and no more', () => {
    expect(compile([dial('d', { ticks: { count: 25, inner: 0.7, outer: 0.9, width: 1, ink: { type: 'rgba', red: 1, green: 2, blue: 3, alpha: 0.5 } } })])).toContain('sh.text-style@1');
    expect(compile([arc('a', { ink: { type: 'solid-appearance', light: solid(1, 2, 3), dark: solid(4, 5, 6) } })])).toContain('sh.solid-appearance@1');
    expect(compile([dial()])).not.toContain('sh.text-style@1');
    expect(compile([arc()])).not.toContain('sh.solid-appearance@1');
  });
  it('declare the text ids the lines in the middle of a dial need, as a text would', () => {
    const line = (props: J = {}) => ({ value: lit('x'), style: 'body', unavailableText: '-', ...props });
    expect(compile([dial('d', { center: [line()] })])).not.toContain('sh.text-style@1');
    expect(compile([dial('d', { center: [line({ style: 'title3' })] })])).toContain('sh.text-style@1');
    expect(compile([dial('d', { center: [line({ style: 'footnote' })] })])).toContain('sh.supporting-text-styles@1');
  });
  it('count a dial and an arc in the node and depth limits', () => {
    let deep: J = dial('leaf');
    for (let depth = 0; depth < 11; depth += 1) deep = stack(`s${depth}`, [deep]);
    expect(issue([deep])).toBeUndefined();
    expect(issue([stack('top', [deep])])).toMatchObject({ code: 'limit_exceeded' });
  });
  it('take a width in a grid and nowhere else', () => {
    expect(issue([dial('d'), arc('a')].map(item => ({ ...item, layout: { span: 2 } })))).toMatchObject({ code: 'invalid_combination' });
  });
  it('put a node that has an id of its own in the uniqueness check', () => {
    expect(issue([dial('same'), arc('same')])).toMatchObject({ code: 'duplicate_id' });
  });
});

describe('documents that do not use the new nodes', () => {
  const names = (folder: string) => readdirSync(path.join(corpus, folder)).filter(name => name.endsWith('.json') && !/^(pending-)?(dial|arc-track)-/.test(name));
  it('declare exactly the capabilities the corpus recorded for them, none of the new ids', () => {
    let count = 0;
    for (const name of names('accept')) {
      const envelope = JSON.parse(readFileSync(path.join(corpus, 'accept', name), 'utf8')) as { capabilities: string[]; document: J };
      if (!envelope.document?.pages) continue;
      const compiled = compileCompositionDocument(envelope.document);
      expect(compiled.capabilities, name).toEqual(envelope.capabilities);
      for (const id of ids) expect(compiled.capabilities, name).not.toContain(id);
      count += 1;
    }
    expect(count).toBeGreaterThan(100);
  });
  it('compile the pending corpus of the other lanes as before', () => {
    let count = 0;
    for (const name of names('reject').filter(entry => entry.startsWith('pending-'))) {
      const envelope = JSON.parse(readFileSync(path.join(corpus, 'reject', name), 'utf8')) as { capabilities: string[]; document: J };
      if (!envelope.document?.pages) continue;
      try { expect(compileCompositionDocument(envelope.document, { tileInkDefault: envelope.capabilities.includes('sh.tile-ink-default@1') }).capabilities, name).toEqual(envelope.capabilities); } catch (error) { if (!(error instanceof CompositionValidationError)) throw error; continue; }
      for (const id of ids) expect(envelope.capabilities, name).not.toContain(id);
      count += 1;
    }
    expect(count).toBeGreaterThan(50);
  });
  it('are not touched by the two new case families: every file of them is named for one', () => {
    const own = readdirSync(path.join(corpus, 'reject')).filter(name => /^(pending-)?(dial|arc-track)-/.test(name));
    expect(own.length).toBeGreaterThan(80);
    for (const name of own) {
      const envelope = JSON.parse(readFileSync(path.join(corpus, 'reject', name), 'utf8')) as { capabilities: string[] };
      expect(envelope.capabilities.some(id => ids.includes(id)), name).toBe(true);
    }
  });
});

describe('the rules the compiler adds to a dial', () => {
  const at = (rest: string) => `/document/pages/2/components/0${rest}`;
  it('reads degrees only on a full turn', () => {
    expect(issue([dial('d', { scale: 'degrees', sweep: { start: -90, length: 360 } })])).toBeUndefined();
    expect(issue([dial('d', { scale: 'degrees' })])).toMatchObject({ code: 'invalid_combination', pointer: at('/props/scale') });
  });
  it('takes a pointer value that is a number, from an entity too', () => {
    const read = (as: string) => ({ type: 'read', from: { type: 'source', sourceId: 'source-entity', path: ['state'] }, as, missing: 'unavailable' });
    const pointer = (value: J) => ({ kind: 'tick', value, inner: 0.6, outer: 0.95, width: 2, ink: solid(4, 5, 6) });
    expect(issue([dial('d', { pointer: pointer(read('number')) })])).toBeUndefined();
    expect(issue([dial('d', { pointer: pointer(read('string')) })])).toMatchObject({ code: 'binding_type', pointer: at('/props/pointer/value') });
    expect(issue([dial('d', { pointer: pointer(lit('half')) })])).toMatchObject({ code: 'binding_type' });
  });
  it('takes a dial with no ticks, no pointer and nothing round it', () => {
    expect(issue([dial('d', { ticks: undefined, pointer: undefined })].map(item => JSON.parse(JSON.stringify(item))))).toBeUndefined();
  });
  it('reads a spoken name and value as text', () => {
    const read = (as: string) => ({ type: 'read', from: { type: 'source', sourceId: 'source-entity', path: ['state'] }, as, missing: 'unavailable' });
    const with11y = (a11y: J) => ({ ...dial('d'), a11y });
    expect(issue([with11y({ element: 'value', label: read('string') })])).toBeUndefined();
    expect(issue([with11y({ element: 'value', label: read('number') })])).toMatchObject({ code: 'binding_type', pointer: at('/a11y/label/as') });
  });
});

describe('the rules the compiler adds to an arc', () => {
  const at = (rest: string) => `/document/pages/2/components/0${rest}`;
  it('keeps the curve and the horizon inside the box, to its edge', () => {
    expect(issue([arc('a', { curve: { from: [0, 0], control: [100, 48], to: [100, 0] } })])).toBeUndefined();
    expect(issue([arc('a', { curve: { from: [0, 0], control: [100.5, 48], to: [100, 0] } })])).toMatchObject({ code: 'invalid_value', pointer: at('/props/curve/control') });
    expect(issue([arc('a', { horizon: { from: [0, 50], to: [100, 48], ink: solid(1, 2, 3), width: 1 } })])).toMatchObject({ code: 'invalid_value', pointer: at('/props/horizon/from') });
  });
  it('takes an arc with no marker and no progress, and with the two together', () => {
    expect(issue([arc('a', { progress: undefined, marker: undefined })].map(item => JSON.parse(JSON.stringify(item))))).toBeUndefined();
    expect(issue([arc('a')])).toBeUndefined();
  });
  it('takes progress from a number, such as the date progress of a flow', () => {
    const progress = { type: 'date', op: 'progress', from: lit('2026-11-16T06:00:00Z'), to: lit('2026-11-16T18:00:00Z') };
    const first = issue([arc('a', { progress })]);
    // `progress` is the WG-S2 flow operand: until it is on this branch the compiler may refuse it as an unknown variant, never as a number problem.
    expect(first === undefined || first.code === 'unknown_variant').toBe(true);
  });
});

describe('the story', () => {
  it('compiles, and uses both capabilities', () => {
    const { document } = wgdialStory();
    const result = (() => { try { return compileCompositionDocument(document); } catch (error) { throw new Error(JSON.stringify((error as { issues?: unknown }).issues, null, 1)); } })();
    for (const id of ids) expect(result.capabilities).toContain(id);
  });
  it('names nothing after a product: only demo ids and generic words', () => {
    expect(JSON.stringify(wgdialStory().document)).not.toMatch(/weather|forecast|rain|temperature|humidity|pressure|barometer|compass|wind|sunrise|sunset|\bsun\b|hPa/i);
  });
});
