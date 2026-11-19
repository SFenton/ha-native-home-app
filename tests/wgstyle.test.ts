import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument, legacyManifest } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { inkColor } from '../src/shared/composition/ink-css';
import { layoutStack, spacePoints, stackOverflows } from '../src/shared/composition/stack-layout';

/**
 * The WG-S1 style ids: what declares each, that a document without the new fields compiles as it did, the limits the new nodes count in, and the stack's
 * arrangement beyond the evaluation corpus.
 */
type J = Record<string, any>;
const corpus = path.resolve(__dirname, '../contract/corpus');
const first = JSON.parse(readFileSync(path.join(corpus, 'accept/fixture-composition-first-slice.json'), 'utf8')) as { document: J };
const lit = (value: unknown): J => ({ type: 'literal', value });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, props: J = {}): J => node(id, 'text', { props: { value: lit('72'), style: 'body', unavailableText: 'None', ...props } });
const stack = (id: string, children: J[], props: J = {}, rest: J = {}): J => node(id, 'stack', { props: { axis: 'horizontal', spacing: { type: 'token', name: 'm' }, ...props }, children, ...rest });
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
const ids = ['sh.text-style@1', 'sh.stack@1', 'sh.symbol-part@1', 'sh.choice-icons@1'];

describe('the four WG-S1 ids', () => {
  it('are shipped and sorted, and the Studio supports them', () => {
    for (const id of ids) expect(pendingCompositionCapabilities).not.toContain(id);
    expect(JSON.parse(readFileSync(path.join(corpus, 'capabilities.pending.json'), 'utf8'))).toEqual([...pendingCompositionCapabilities]);
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
  });
  it('are declared by the part that uses them and only then', () => {
    const wanted = (list: string[]) => list.filter(id => ids.includes(id));
    expect(wanted(compile([text('t')]))).toEqual([]);
    expect(wanted(compile([text('t', { style: 'footnote' })]))).toEqual([]);
    expect(wanted(compile([text('t', { style: 'title3' })]))).toEqual(['sh.text-style@1']);
    expect(wanted(compile([text('t', { font: {} })]))).toEqual(['sh.text-style@1']);
    expect(wanted(compile([text('t', { lines: 1 })]))).toEqual(['sh.text-style@1']);
    expect(wanted(compile([text('t', { ink: { type: 'rgba', red: 1, green: 2, blue: 3, alpha: 0.5 } })]))).toEqual(['sh.text-style@1']);
    expect(wanted(compile([stack('s', [])])).sort()).toEqual(['sh.stack@1', 'sh.text-style@1']);
    expect(wanted(compile([node('sh', 'shape', { props: { form: 'rect', width: 4, height: 4, fill: { type: 'solid-rgb', red: 1, green: 2, blue: 3 } } })])).sort()).toEqual(['sh.stack@1', 'sh.text-style@1']);
    const symbol = node('sy', 'symbol', { props: { name: { type: 'sf-symbol', name: 'cloud', rendering: 'canonical', unavailable: 'fallback' }, size: { points: 20 }, rendering: 'multicolor' }, a11y: { element: 'hidden' } });
    expect(wanted(compile([symbol])).sort()).toEqual(['sh.symbol-part@1', 'sh.text-style@1']);
    const options = (extra: J) => (document: J) => { document.localState = [{ id: 'mode', type: 'choice', initial: 'a', options: [{ id: 'a', label: 'A', ...extra }, { id: 'b', label: 'B', ...extra }] }]; };
    expect(wanted(compile([], options({})))).toEqual([]);
    expect(wanted(compile([], options({ hint: 'Say it' })))).toEqual(['sh.choice-icons@1']);
  });
  it('declare the pair id with an rgba pair', () => {
    const ink = { type: 'solid-appearance', light: { type: 'rgba', red: 0, green: 0, blue: 0, alpha: 0.6 }, dark: { type: 'solid-rgb', red: 255, green: 255, blue: 255 } };
    expect(compile([text('t', { ink })])).toEqual(expect.arrayContaining(['sh.solid-appearance@1', 'sh.text-style@1']));
  });
  it('count a stack and its children in the node and depth limits', () => {
    let deep: J = text('leaf');
    for (let depth = 0; depth < 11; depth += 1) deep = stack(`s${depth}`, [deep]);
    expect(issue([deep])).toBeUndefined();
    expect(issue([stack('top', [deep])])).toMatchObject({ code: 'limit_exceeded' });
  });
  it('refuse an rgba where a slot existed before, with the first issue it always gave', () => {
    const tile = (tint: J) => node('tile', 'state-tile', { icon: { type: 'sf-symbol', name: 'lock', rendering: 'canonical', unavailable: 'fallback' }, binding: { entityId: 'lock.demo_door', builtIn: 'lock' }, props: {}, glyphTint: tint });
    expect(issue([tile({ type: 'rgba', red: 1, green: 2, blue: 3, alpha: 0.5 })])).toMatchObject({ code: 'unknown_variant', pointer: '/document/pages/2/components/0/glyphTint/type' });
  });
});

describe('documents that do not use the new fields', () => {
  const names = (folder: string) => readdirSync(path.join(corpus, folder)).filter(name => name.endsWith('.json') && !/^(pending-)?(text-style|stack|shape|symbol-part|choice-icons|rgba)-/.test(name));
  it('declare exactly the capabilities the corpus recorded for them, none of the new ids', () => {
    let count = 0;
    for (const name of names('accept')) {
      const envelope = JSON.parse(readFileSync(path.join(corpus, 'accept', name), 'utf8')) as { capabilities: string[]; document: J };
      if (!envelope.document?.pages || envelope.capabilities.some(id => ids.includes(id))) continue;
      const compiled = compileCompositionDocument(envelope.document);
      expect(legacyManifest(compiled.capabilities), name).toEqual(legacyManifest(envelope.capabilities));
      for (const id of ids) expect(compiled.capabilities, name).not.toContain(id);
      count += 1;
    }
    expect(count).toBeGreaterThan(100);
  });
});

describe('the stack arrangement', () => {
  const props = { axis: 'horizontal' as const, spacing: { type: 'token' as const, name: 'm' as const }, collapse: { to: 'vertical' as const, when: ['overflow' as const], fits: ['b'] } };
  const children = (b: number) => [{ id: 'a', width: 50 }, { id: 'b', width: b }];
  it('reads spacing as the canonical tokens or points', () => {
    expect([spacePoints({ type: 'token', name: 'zero' }), spacePoints({ type: 'token', name: 'xs' }), spacePoints({ type: 'token', name: 'm' }), spacePoints({ type: 'token', name: 'xl' }), spacePoints({ type: 'points', value: 5 })]).toEqual([0, 4, 12, 24, 5]);
    expect(spacePoints(undefined, 7)).toBe(7);
  });
  it('reads section-header as 10 points, the native SpaceToken.sectionHeader (ServerUICompositionDocument.swift:143)', () => {
    expect(spacePoints({ type: 'token', name: 'section-header' })).toBe(10);
  });
  it('overflows only past half a point, and only over the children it counts', () => {
    expect(stackOverflows(props, children(238), 300)).toBe(false);
    expect(stackOverflows(props, children(238.5), 300)).toBe(false);
    expect(stackOverflows(props, children(239), 300)).toBe(true);
    expect(stackOverflows({ ...props, collapse: { ...props.collapse, fits: ['a'] } }, [{ id: 'a', width: 50 }, { id: 'b', width: 900, shrinks: true }], 300)).toBe(false);
  });
  it('never collapses a column, and names the text size before an overflow', () => {
    expect(layoutStack({ props: { ...props, axis: 'vertical' }, children: children(900), width: 10, accessibilitySize: true }).collapsed).toBe(false);
    expect(layoutStack({ props: { ...props, collapse: { ...props.collapse, when: ['accessibility-size', 'overflow'] } }, children: children(900), width: 10, accessibilitySize: true }).reason).toBe('accessibility-size');
    expect(layoutStack({ props, children: children(900), width: 10, accessibilitySize: true }).reason).toBe('overflow');
  });
  it('skips the overflow check when the named children have no width', () => {
    expect(layoutStack({ props, children: [{ id: 'a', width: 900 }, { id: 'b', width: 0 }], width: 10, accessibilitySize: false }).collapsed).toBe(false);
  });
});

describe('ink css', () => {
  it('draws rgb, rgba and a light-dark pair', () => {
    expect(inkColor({ type: 'solid-rgb', red: 1, green: 2, blue: 3 })).toBe('rgb(1 2 3)');
    expect(inkColor({ type: 'rgba', red: 255, green: 255, blue: 255, alpha: 0.85 })).toBe('rgb(255 255 255 / 0.85)');
    expect(inkColor({ type: 'solid-appearance', light: { type: 'rgba', red: 0, green: 0, blue: 0, alpha: 0.5 }, dark: { type: 'solid-rgb', red: 9, green: 9, blue: 9 } })).toBe('light-dark(rgb(0 0 0 / 0.5), rgb(9 9 9))');
    expect(inkColor(undefined)).toBeUndefined();
    expect(inkColor({ type: 'standard' })).toBeUndefined();
  });
});
