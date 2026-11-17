import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { evaluateOperand, resolveFill, unavailable, value, type Environment } from '../src/shared/composition/evaluator';
import { operandSchema, type Operand } from '../src/shared/composition/expression';
import { solidColor } from '../src/shared/composition/fill-css';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { newFacts } from '../src/shared/composition/pipeline';
import { typeOperand } from '../src/shared/composition/pipeline/typing';
import { titleCase, wordsCase } from '../src/shared/composition/pipeline/text';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { stateStyleSchema } from '../src/shared/composition/state-styles';
import { rgb as previewRgb } from '../src/preview2/nodes/shared';
import { solidCss } from '../src/preview2/room-face';
import type { Json } from '../src/shared/types';

/**
 * TC4 and TC4c: the `words` text case (`sh.text-case-words@1`) and the light and dark colour pair (`sh.solid-appearance@1`). The corpora pin the
 * answers byte for byte; these tests pin the helper, the capability each needs, the places a pair is allowed, and how the preview paints it.
 */
type J = Record<string, any>;
const corpus = path.resolve(__dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(corpus, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const lit = (v: unknown): J => ({ type: 'literal', value: v });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const fmt = (pattern: string, args: J, formats?: J): J => ({ type: 'format', pattern, args, ...(formats ? { formats } : {}) });
const words: J = { text: { case: 'words' } }, title: J = { text: { case: 'title' } };
const sources: J[] = [
  { id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') },
  { id: 'robot', kind: 'ha-entity', entityId: lit('vacuum.demo_robot') },
  { id: 'lights', kind: 'model', model: 'home-status@1', inputs: { projection: 'lights', format: 'summary', entityIds: [lit('light.demo_study')], awayEntityIds: [] },
    labels: { idle: 'All Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'No lights', hidden: 'Hidden' } },
];
type Outcome = { capabilities: string[]; issues: CompositionIssue[] };
function compileComponents(components: J[], tweak?: (document: J) => void): Outcome {
  const document = structuredClone(base.document);
  document.pages[2].components = components;
  document.dataSources.push(...structuredClone(sources));
  tweak?.(document);
  try { return { capabilities: compileCompositionDocument(document).capabilities, issues: [] }; }
  catch (error) { if (!(error instanceof CompositionValidationError)) throw error; return { capabilities: [], issues: error.issues }; }
}
const exprText = (operand: J): J[] => [{ id: 't', title: 't', type: 'text', layout: { span: 1 }, props: { value: { type: 'expr', value: operand }, style: 'body', unavailableText: 'None' } }];
const chip = (appearance: J): J[] => [{ id: 'chip', title: 'chip', type: 'status-chip', layout: { span: 1 },
  props: { sourceId: 'lights', states: [{ state: 'active', appearance }], fallback: { icon: symbol('lightbulb'), fill: { type: 'standard' } }, announcement: 'none' } }];
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const first = (outcome: Outcome) => outcome.issues.map(issue => `${issue.code} ${issue.pointer.replace('/document/pages/2/components/0/props/states/0/appearance', '~')}`);
const env = (reads: Record<string, Json>): Environment => ({
  read: (sourceId, segments) => { const found = reads[`${sourceId}/${segments.join('/')}`]; return found === undefined ? unavailable : value(found); },
});
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const pair = (light: J, dark: J): J => ({ type: 'solid-appearance', light, dark });
const purple = pair(solid(0x9C, 0x6D, 0xC3), solid(0xC8, 0x8C, 0xFA));

describe('TC4: the words case', () => {
  it('capitalizes the first ASCII letter after an underscore or a space and joins with one space', () => {
    expect(wordsCase('Wheel stuck')).toBe('Wheel Stuck');
    expect(wordsCase('main brush jammed')).toBe('Main Brush Jammed');
    expect(wordsCase('heat_cool')).toBe('Heat Cool');
    expect(wordsCase('side_brush stuck')).toBe('Side Brush Stuck');
    expect(wordsCase('AUTO mode')).toBe('AUTO Mode');
    expect(wordsCase('2nd floor')).toBe('2nd Floor');
  });
  it('keeps empty parts and empty text, and only a space and an underscore separate', () => {
    expect(wordsCase('')).toBe('');
    expect(wordsCase('a  b')).toBe('A  B');
    expect(wordsCase('_x')).toBe(' X');
    expect(wordsCase('x ')).toBe('X ');
    expect(wordsCase('a\tb\nc d')).toBe('A\tb\nc D');
  });
  it('changes an ASCII letter only, so JavaScript and Swift cannot disagree on a case mapping', () => {
    expect(wordsCase('élan vital')).toBe('élan Vital');
    expect(wordsCase('ßeta')).toBe('ßeta');
    expect(wordsCase('ǆungla')).toBe('ǆungla');
  });
  it('differs from title only at a space', () => {
    expect(titleCase('wheel stuck')).toBe('Wheel stuck');
    expect(wordsCase('wheel stuck')).toBe('Wheel Stuck');
    expect(titleCase('heat_cool')).toBe(wordsCase('heat_cool'));
  });
  it('evaluates in a format, total like every spec', () => {
    const e = env({ 'robot/attributes/issue': 'Wheel stuck' });
    expect(evaluateOperand(fmt('{m}', { m: read('robot', ['attributes', 'issue']) }, { m: words }) as Operand, e)).toEqual(value('Wheel Stuck'));
    expect(evaluateOperand(fmt('{m}', { m: lit(72) }, { m: words }) as Operand, e)).toEqual(value('72'));
    expect(evaluateOperand(fmt('{m}', { m: lit(null) }, { m: words }) as Operand, e)).toEqual(unavailable);
    expect(evaluateOperand(fmt('{m}', { m: read('robot', ['attributes', 'nothing']) }, { m: words }) as Operand, e)).toEqual(unavailable);
  });
  it('takes the case enum only: title and words', () => {
    expect(operandSchema.safeParse(fmt('{m}', { m: lit('a') }, { m: words })).success).toBe(true);
    expect(operandSchema.safeParse(fmt('{m}', { m: lit('a') }, { m: { text: { case: 'Words' } } })).success).toBe(false);
    expect(operandSchema.safeParse(fmt('{m}', { m: lit('a') }, { m: { text: { case: 'words', locale: 'en' } } })).success).toBe(false);
  });

  it('is its own id: words needs sh.text-case-words@1 alone, title keeps sh.pipeline-operands@1', () => {
    const onlyWords = compileComponents(exprText(fmt('{m}', { m: read('robot', ['attributes', 'issue']) }, { m: words })));
    expect(onlyWords.issues).toEqual([]);
    expect(onlyWords.capabilities).toContain('sh.text-case-words@1');
    expect(onlyWords.capabilities).not.toContain('sh.pipeline-operands@1');
    const onlyTitle = compileComponents(exprText(fmt('{m}', { m: read('robot', ['state']) }, { m: title })));
    expect(onlyTitle.capabilities).toContain('sh.pipeline-operands@1');
    expect(onlyTitle.capabilities).not.toContain('sh.text-case-words@1');
    const both = compileComponents(exprText(fmt('{a} {b}', { a: lit('x'), b: lit('y') }, { a: title, b: words })));
    expect(both.capabilities).toEqual(expect.arrayContaining(['sh.text-case-words@1', 'sh.pipeline-operands@1']));
    expect(pendingCompositionCapabilities).not.toContain('sh.text-case-words@1');
    expect(pendingCompositionCapabilities).not.toContain('sh.solid-appearance@1');
  });
  it('refuses a number argument', () => {
    const result = compileComponents(exprText(fmt('{t}', { t: read('temp', ['state'], 'number') }, { t: words })));
    expect(result.issues.map(issue => issue.code)).toEqual(['binding_type']);
  });
  it('marks a flow that uses it, apart from the pipeline operands', () => {
    const facts = newFacts();
    typeOperand(fmt('{m}', { m: lit('a b') }, { m: words }) as never, { params: new Map(), allowRead: true, allowViewer: false }, '/o', facts);
    expect(facts.issues).toEqual([]);
    expect(facts.wordsCase).toBe(true);
    expect(facts.newOperands).toBe(false);
    const titled = newFacts();
    typeOperand(fmt('{m}', { m: lit('a b') }, { m: title }) as never, { params: new Map(), allowRead: true, allowViewer: false }, '/o', titled);
    expect(titled.wordsCase).toBe(false);
    expect(titled.newOperands).toBe(true);
  });
});

describe('TC4c: the light and dark colour pair', () => {
  it('is a glyph, a fill, a rule case and a bound colour fallback, and needs sh.solid-appearance@1 alone', () => {
    const hot = { type: 'compare', op: 'above', left: read('temp', ['state'], 'number'), right: lit(75) };
    for (const appearance of [
      { icon: symbol('house'), glyph: purple, fill: { type: 'standard' } },
      { icon: symbol('house'), fill: pair(solid(1, 2, 3), solid(4, 5, 6)) },
      { icon: symbol('house'), glyph: { type: 'conditional', cases: [{ when: hot, then: purple }], otherwise: solid(1, 2, 3) }, fill: { type: 'standard' } },
      { icon: symbol('house'), glyph: { type: 'bound-color', value: read('temp', ['state']), fallback: purple }, fill: { type: 'standard' } },
      { icon: symbol('house'), fill: { type: 'conditional', cases: [{ when: hot, then: { type: 'standard' } }], otherwise: purple } },
    ]) {
      const result = compileComponents(chip(appearance));
      expect(first(result)).toEqual([]);
      expect(result.capabilities).toContain('sh.solid-appearance@1');
    }
    const plain = compileComponents(chip({ icon: symbol('house'), glyph: solid(1, 2, 3), fill: { type: 'standard' } }));
    expect(plain.capabilities).not.toContain('sh.solid-appearance@1');
  });
  it('is a navigation tile fill and a room card state colour', () => {
    const tile = [{ id: 'nav', title: 'nav', type: 'navigation-tile', layout: { span: 1 }, icon: symbol('house'),
      props: { family: 'neutral', selected: 'none', subtitle: lit('x'), presentation: { layout: 'standard', titleLines: 1, fill: purple } },
      action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } }];
    expect(compileComponents(tile, document => { document.dataSources.push({ id: 'guest-fan', kind: 'ha-entity', entityId: lit('fan.demo_fan') }); }).capabilities).toContain('sh.solid-appearance@1');
  });
  it('is a state style fill and then needs both fills and appearance', () => {
    const document = structuredClone(JSON.parse(readFileSync(path.join(corpus, 'accept/state-style-authored-vacuum.json'), 'utf8')).document);
    document.stateStyles.styles[0].rules[0].fill = purple;
    const capabilities = compileCompositionDocument(document).capabilities;
    expect(capabilities).toEqual(expect.arrayContaining(['sh.solid-appearance@1', 'sh.state-style-fills@1', 'sh.state-style@1']));
    document.stateStyles.styles[0].rules[0].fill = solid(1, 2, 3);
    expect(compileCompositionDocument(document).capabilities).not.toContain('sh.solid-appearance@1');
  });
  it('refuses a half pair, a channel out of range, a standard colour, a nested pair, a family and a pair on an icon', () => {
    const glyph = (look: J) => first(compileComponents(chip({ icon: symbol('house'), glyph: look, fill: { type: 'standard' } })));
    expect(glyph({ type: 'solid-appearance', light: solid(1, 2, 3) })).toEqual(['missing_required ~/glyph/dark']);
    expect(glyph(pair(solid(1, 2, 3), solid(256, 0, 0)))).toEqual(['limit_exceeded ~/glyph/dark/red']);
    expect(glyph(pair(solid(1, 2, 3), { type: 'standard' }))[0]).toMatch(/^missing_required ~\/glyph\/dark\//);
    expect(glyph(pair(pair(solid(1, 2, 3), solid(4, 5, 6)), solid(7, 8, 9)))[0]).toMatch(/^missing_required ~\/glyph\/light\//);
    expect(glyph({ ...purple, family: 'purple' })).toEqual(['unknown_field ~/glyph/family']);
    expect(first(compileComponents(chip({ icon: purple, fill: { type: 'standard' } })))).toEqual(['unknown_variant ~/icon/type']);
  });
  it('does not count a record held by a literal as a pair', () => {
    const result = compileComponents([{ id: 't', title: 't', type: 'text', layout: { span: 1 }, props: { value: lit('x'), style: 'body', unavailableText: 'None' } }],
      document => { document.dataSources.push({ id: 'k', kind: 'ha-entity', entityId: lit('sensor.demo_k') }); });
    expect(result.capabilities).not.toContain('sh.solid-appearance@1');
    const literal = compileComponents(exprText({ type: 'object', fields: { look: lit({ type: 'solid-appearance' }) } }));
    expect(literal.capabilities).not.toContain('sh.solid-appearance@1');
  });
  it('parses in a state style as a pair of exact colours only', () => {
    const style = (fill: J) => stateStyleSchema.safeParse({ id: 'a', name: 'A', domain: 'vacuum', rules: [{ states: ['on'], class: 'resting', active: false, fill }], fallback: { class: 'unknown', active: false } });
    expect(style(purple).success).toBe(true);
    expect(style({ type: 'solid-appearance', light: solid(1, 2, 3) }).success).toBe(false);
    expect(style(pair({ type: 'standard' }, solid(1, 2, 3))).success).toBe(false);
  });
  it('passes through the evaluator whole', () => {
    const slot = { type: 'conditional', cases: [], otherwise: purple };
    expect(resolveFill(slot as never, env({}))).toEqual({ status: 'value', look: purple });
    expect(resolveFill(purple as never, env({}))).toEqual({ status: 'value', look: purple });
  });
  it('paints as light-dark(), which the element\'s color-scheme decides, and an exact colour as before', () => {
    expect(solidColor(purple)).toBe('light-dark(rgb(156 109 195), rgb(200 140 250))');
    expect(solidColor(solid(1, 2, 3))).toBe('rgb(1 2 3)');
    expect(solidColor({ type: 'standard' })).toBeUndefined();
    expect(solidColor({ type: 'solid-appearance', light: solid(1, 2, 3) })).toBeUndefined();
    expect(solidColor(undefined)).toBeUndefined();
    expect(previewRgb(purple as never)).toBe('light-dark(rgb(156 109 195), rgb(200 140 250))');
    expect(solidCss(purple)).toBe('light-dark(rgb(156 109 195), rgb(200 140 250))');
  });
});
