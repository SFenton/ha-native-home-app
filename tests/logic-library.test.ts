import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { expandDocument } from '../src/shared/composition/components';
import { COMPONENT_ENTRY_LIMITS, compositionDocumentSchema, type CompositionDocument } from '../src/shared/composition/schema';
import { CompositionValidationError, canonicalCompositionJSON, type CompositionIssue } from '../src/shared/composition/json';
import {
  assertNoLogic, expandLogic, logicEntrySchema, logicLibrarySchema, MAX_COMPONENT_BINDINGS, MAX_LOGIC_DEPTH, publishedDocument, usesLogic,
} from '../src/shared/composition/logic-library';
import { decodeCompositionPublication, validateCompositionPublication } from '../server/composition';

type J = Record<string, any>;
const base: J = JSON.parse(readFileSync(path.resolve(__dirname, '../contract/corpus/accept/fixture-composition-first-slice.json'), 'utf8'));
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: unknown, as = 'number'): J => ({ type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as, missing: 'unavailable' });
const hole = (name: string): J => ({ type: 'hole', name });
const use = (logicId: string, args: J): J => ({ type: 'logic-ref', logicId, args });
const sources: J[] = [
  { id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') },
  { id: 'temp2', kind: 'ha-entity', entityId: lit('sensor.demo_attic_temperature') },
];
const text = (extra: J, value: J = lit('Shown'), id = 't'): J => ({ id, title: id, type: 'text', layout: { span: 1 }, props: { value, style: 'body', unavailableText: 'None' }, ...extra });
const expr = (value: J): J => ({ type: 'expr', value });

/** A count phrase: "1 sensor" or "3 sensors" from the number a source reads. */
const countPhrase = (extra: J = {}): J => ({
  id: 'count-phrase', name: 'Count phrase', kind: 'operand',
  params: [{ name: 'src', kind: 'source-id' }, { name: 'one', kind: 'text' }, { name: 'many', kind: 'text' }],
  body: {
    type: 'choose',
    cases: [{ when: { type: 'compare', op: 'eq', left: read(hole('src')), right: lit(1) }, then: { type: 'format', pattern: '{n} {w}', args: { n: read(hole('src')), w: lit(hole('one')) } } }],
    otherwise: { type: 'format', pattern: '{n} {w}', args: { n: read(hole('src')), w: lit(hole('many')) } },
  },
  ...extra,
});
const isHot = (): J => ({
  id: 'is-hot', name: 'Is hot', kind: 'condition',
  params: [{ name: 'src', kind: 'source-id' }, { name: 'limit', kind: 'number' }],
  body: { type: 'compare', op: 'above', left: read(hole('src')), right: lit(hole('limit')) },
});
const handCount = (src: string, one: string, many: string): J => ({
  type: 'choose',
  cases: [{ when: { type: 'compare', op: 'eq', left: read(src), right: lit(1) }, then: { type: 'format', pattern: '{n} {w}', args: { n: read(src), w: lit(one) } } }],
  otherwise: { type: 'format', pattern: '{n} {w}', args: { n: read(src), w: lit(many) } },
});
const handHot = (src: string, limit: number): J => ({ type: 'compare', op: 'above', left: read(src), right: lit(limit) });

function draft(components: J[], library: J[] | undefined, more: J[] = sources): J {
  const document = structuredClone(base.document);
  document.pages[2].components = components;
  document.dataSources.push(...more);
  if (library) document.logicLibrary = library;
  return document;
}
const plain = (components: J[]): J => draft(components, undefined);
const failure = (run: () => unknown): CompositionIssue[] => {
  try { run(); } catch (error) { if (error instanceof CompositionValidationError) return error.issues; throw error; }
  throw new Error('expected a validation failure');
};
const at = '/document/pages/2/components/0';
const firstOf = (compiled: { expanded: unknown } | { document: unknown }): J => ((compiled as J).expanded ?? (compiled as J).document).pages[2].components[0];

describe('the logic library schema', () => {
  it('takes an entry of each kind, and parameters of every kind', () => {
    const entry = { id: 'e', name: 'E', kind: 'operand', params: ['source-id', 'text', 'number', 'operand', 'condition'].map(kind => ({ name: `p_${kind.replace('-', '_')}`, kind })), body: lit(1) };
    expect(logicEntrySchema.safeParse(entry).success).toBe(true);
    expect(logicLibrarySchema.safeParse([countPhrase(), isHot()]).success).toBe(true);
    expect(compositionDocumentSchema.safeParse({ ...plain([]), logicLibrary: [countPhrase()] }).success).toBe(true);
  });
  it('refuses a bad kind, an unknown field, more than eight parameters, a bad parameter name and more than a hundred entries', () => {
    const params = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `p${index}`, kind: 'text' }));
    expect(logicEntrySchema.safeParse({ ...countPhrase(), kind: 'value' }).success).toBe(false);
    expect(logicEntrySchema.safeParse({ ...countPhrase(), extra: 1 }).success).toBe(false);
    expect(logicEntrySchema.safeParse({ ...countPhrase(), params: params(9) }).success).toBe(false);
    expect(logicEntrySchema.safeParse({ ...countPhrase(), params: params(8) }).success).toBe(true);
    expect(logicEntrySchema.safeParse({ ...countPhrase(), params: [{ name: '1x', kind: 'text' }] }).success).toBe(false);
    expect(logicLibrarySchema.safeParse(Array.from({ length: 101 }, (_, index) => countPhrase({ id: `e${index}` }))).success).toBe(false);
  });
  it('keeps the component binding limit the schema holds', () => { expect(MAX_COMPONENT_BINDINGS).toBe(COMPONENT_ENTRY_LIMITS.bindings); });
});

describe('expansion equals the hand-written logic', () => {
  it('works a source-id and a text out in an expr slot', () => {
    const value = expr(use('count-phrase', { src: 'temp', one: 'sensor', many: 'sensors' }));
    const compiled = compileCompositionDocument(draft([text({}, value)], [countPhrase()]));
    expect(firstOf(compiled)).toEqual(firstOf(compileCompositionDocument(plain([text({}, expr(handCount('temp', 'sensor', 'sensors')))]))));
    expect(compiled.expanded.logicLibrary).toBeUndefined();
  });
  it('works a condition entry with a number out in visibleWhen', () => {
    const compiled = compileCompositionDocument(draft([text({ visibleWhen: use('is-hot', { src: 'temp2', limit: 75 }) })], [isHot()]));
    expect(firstOf(compiled)).toEqual(firstOf(compileCompositionDocument(plain([text({ visibleWhen: handHot('temp2', 75) })]))));
  });
  it('works an operand argument and a condition argument out', () => {
    const library = [
      { id: 'shown-if', name: 'Shown if', kind: 'operand', params: [{ name: 'when', kind: 'condition' }, { name: 'then', kind: 'operand' }],
        body: { type: 'choose', cases: [{ when: hole('when'), then: hole('then') }], otherwise: lit('') } },
    ];
    const value = expr(use('shown-if', { when: handHot('temp', 5), then: lit('Hot') }));
    const compiled = compileCompositionDocument(draft([text({}, value)], library));
    const expected = expr({ type: 'choose', cases: [{ when: handHot('temp', 5), then: lit('Hot') }], otherwise: lit('') });
    expect(firstOf(compiled).props.value).toEqual(expected);
  });
  it('works a use inside another entry out, and a use inside an argument', () => {
    const library = [
      isHot(),
      { id: 'hot-word', name: 'Hot word', kind: 'operand', params: [{ name: 'src', kind: 'source-id' }],
        body: { type: 'choose', cases: [{ when: use('is-hot', { src: hole('src'), limit: 30 }), then: lit('Hot') }], otherwise: lit('Fine') } },
    ];
    const compiled = compileCompositionDocument(draft([text({}, expr(use('hot-word', { src: 'temp' })))], library));
    expect(firstOf(compiled).props.value).toEqual(expr({ type: 'choose', cases: [{ when: handHot('temp', 30), then: lit('Hot') }], otherwise: lit('Fine') }));
    const nested = [{ id: 'wrap', name: 'Wrap', kind: 'operand', params: [{ name: 'when', kind: 'condition' }], body: { type: 'choose', cases: [{ when: hole('when'), then: lit('x') }], otherwise: lit('y') } }, isHot()];
    const argument = compileCompositionDocument(draft([text({}, expr(use('wrap', { when: use('is-hot', { src: 'temp', limit: 1 }) })))], nested));
    expect(firstOf(argument).props.value.value.cases[0].when).toEqual(handHot('temp', 1));
  });
  it('accepts a use in a rule case, a confirmation and enabledWhen as it does in visibleWhen and a text', () => {
    const rule = expr({ type: 'choose', cases: [{ when: use('is-hot', { src: 'temp', limit: 9 }), then: lit('a') }], otherwise: lit('b') });
    const compiled = compileCompositionDocument(draft([text({}, rule)], [isHot()]));
    expect(firstOf(compiled).props.value.value.cases[0].when).toEqual(handHot('temp', 9));
    const button = (extra: J, action: J = {}): J => ({
      id: 'b', title: 'b', type: 'primary-button', layout: { span: 1 }, props: {},
      action: { type: 'call-service', domain: 'fan', service: 'turn_on', target: { entity_id: lit('fan.example_fan') }, ...action }, ...extra,
    });
    const ask = { confirmation: { type: 'additional', style: 'alert', title: 'Sure?', confirmLabel: 'Go', cancelLabel: 'Cancel', destructive: false, when: use('is-hot', { src: 'temp', limit: 2 }) } };
    const both = compileCompositionDocument(draft([button({ enabledWhen: { condition: use('is-hot', { src: 'temp', limit: 3 }), whenUnknown: 'enabled' } }, ask)], [isHot()]));
    const node = firstOf(both);
    expect(node.enabledWhen.condition).toEqual(handHot('temp', 3));
    expect(node.action.confirmation.when).toEqual(handHot('temp', 2));
  });
  it('works a use out wherever it stands in the draft: conditional cases, flow where and step operands', () => {
    const document = {
      logicLibrary: [isHot(), countPhrase()],
      pages: [{ children: [{ type: 'conditional', cases: [{ when: use('is-hot', { src: 'temp', limit: 4 }), children: [] }] }] }],
      dataSources: [{ id: 'flow', kind: 'flow', where: use('is-hot', { src: 'temp', limit: 5 }), steps: [{ op: 'set', value: use('count-phrase', { src: 'temp', one: 'a', many: 'b' }) }] }],
    };
    const out = expandLogic(document).document as J;
    expect(out.pages[0].children[0].cases[0].when).toEqual(handHot('temp', 4));
    expect(out.dataSources[0].where).toEqual(handHot('temp', 5));
    expect(out.dataSources[0].steps[0].value).toEqual(handCount('temp', 'a', 'b'));
    expect(out.logicLibrary).toBeUndefined();
    expect(expandLogic(document).origins.map(origin => origin.pointer)).toEqual(['/pages/0/children/0/cases/0/when', '/dataSources/0/where', '/dataSources/0/steps/0/value']);
  });
  it('leaves the input unchanged, and a document without logic as the same object', () => {
    const document = draft([text({}, expr(use('count-phrase', { src: 'temp', one: 'a', many: 'b' })))], [countPhrase()]);
    const before = JSON.stringify(document);
    expandLogic(document);
    expect(JSON.stringify(document)).toBe(before);
    const plainDocument = plain([text({})]);
    expect(expandLogic(plainDocument).document).toBe(plainDocument);
    expect(usesLogic(plainDocument)).toBe(false);
    expect(usesLogic(document)).toBe(true);
  });
});

describe('capabilities', () => {
  it('are the same for the draft and the hand-written document, and name no logic id', () => {
    const used = draft([text({}, expr(use('count-phrase', { src: 'temp', one: 'sensor', many: 'sensors' }))), text({ visibleWhen: use('is-hot', { src: 'temp2', limit: 1 }) }, lit('x'), 't2')], [countPhrase(), isHot()]);
    const hand = plain([text({}, expr(handCount('temp', 'sensor', 'sensors'))), text({ visibleWhen: handHot('temp2', 1) }, lit('x'), 't2')]);
    const capabilities = compileCompositionDocument(used).capabilities;
    expect(capabilities).toEqual(compileCompositionDocument(hand).capabilities);
    expect(capabilities).toContain('sh.rules@1');
    expect(capabilities.some(name => /logic|hole/.test(name))).toBe(false);
  });
});

describe('refusals', () => {
  const issues = (components: J[], library: J[] = [countPhrase(), isHot()]) => failure(() => compileCompositionDocument(draft(components, library)));
  const phrase = (args: J) => [text({}, expr(use('count-phrase', args)))];
  it('refuses an unknown id at the use', () => {
    expect(issues([text({}, expr(use('nope', {})))])).toEqual([{ code: 'invalid_reference', pointer: `${at}/props/value/value/logicId` }]);
  });
  it('refuses a missing, an extra and a wrong-kind argument at the argument', () => {
    const slot = `${at}/props/value/value/args`;
    expect(issues(phrase({ src: 'temp', one: 'a' }))).toEqual([{ code: 'missing_required', pointer: `${slot}/many` }]);
    expect(issues(phrase({ src: 'temp', one: 'a', many: 'b', more: 'c' }))).toEqual([{ code: 'unknown_field', pointer: `${slot}/more` }]);
    expect(issues(phrase({ src: 'not an id', one: 'a', many: 'b' }))).toEqual([{ code: 'invalid_value', pointer: `${slot}/src` }]);
    expect(issues(phrase({ src: 'temp', one: 3, many: 'b' }))).toEqual([{ code: 'invalid_value', pointer: `${slot}/one` }]);
    expect(failure(() => compileCompositionDocument(draft([text({ visibleWhen: use('is-hot', { src: 'temp', limit: 'high' }) })], [isHot()])))
      .map(issue => issue.code)).toEqual(['invalid_value']);
    expect(issues(phrase({ src: lit(1), one: 'a', many: 'b' }))[0].code).toBe('invalid_value');
  });
  it('refuses an operand where a condition is wanted and a condition where an operand is wanted', () => {
    const wrong = failure(() => compileCompositionDocument(draft([text({ visibleWhen: use('count-phrase', { src: 'temp', one: 'a', many: 'b' }) })], [countPhrase()])));
    expect(wrong.length).toBeGreaterThan(0);
    expect(wrong.every(issue => issue.pointer.startsWith(`${at}/visibleWhen`))).toBe(true);
    expect(failure(() => compileCompositionDocument(draft([text({}, expr(use('is-hot', { src: 'temp', limit: 1 })))], [isHot()]))).length).toBeGreaterThan(0);
  });
  it('refuses a recursive entry, direct and through another, at the entry', () => {
    const self = { id: 'loop', name: 'Loop', kind: 'operand', params: [], body: use('loop', {}) };
    expect(failure(() => compileCompositionDocument(draft([], [self])))).toEqual([{ code: 'invalid_combination', pointer: '/document/logicLibrary/0/body' }]);
    const a = { id: 'a', name: 'A', kind: 'operand', params: [], body: use('b', {}) }, b = { id: 'b', name: 'B', kind: 'operand', params: [], body: use('a', {}) };
    expect(failure(() => compileCompositionDocument(draft([], [a, b]))).map(issue => issue.code)).toEqual(['invalid_combination', 'invalid_combination']);
  });
  it('caps how deep entries use entries', () => {
    const chain = Array.from({ length: MAX_LOGIC_DEPTH + 1 }, (_, index): J => ({
      id: `n${index}`, name: `N${index}`, kind: 'operand', params: [], body: index === MAX_LOGIC_DEPTH ? lit(1) : use(`n${index + 1}`, {}),
    }));
    expect(failure(() => compileCompositionDocument(draft([], chain))).map(issue => issue.code)).toContain('limit_exceeded');
    expect(() => compileCompositionDocument(draft([], chain.slice(1)))).not.toThrow();
  });
  it('refuses a hole the entry does not declare, a duplicate id, a duplicate parameter and a body that is not an operand', () => {
    const stray = countPhrase({ params: [{ name: 'src', kind: 'source-id' }, { name: 'one', kind: 'text' }] });
    expect(failure(() => compileCompositionDocument(draft([], [stray]))).map(issue => issue.code)).toContain('invalid_reference');
    expect(failure(() => compileCompositionDocument(draft([], [isHot(), isHot()])))).toEqual([{ code: 'duplicate_id', pointer: '/document/logicLibrary/1/id' }]);
    const twice = isHot(); twice.params = [{ name: 'src', kind: 'source-id' }, { name: 'src', kind: 'number' }];
    expect(failure(() => compileCompositionDocument(draft([], [twice])))).toEqual([{ code: 'duplicate_id', pointer: '/document/logicLibrary/0/params/1/name' }]);
    expect(failure(() => compileCompositionDocument(draft([], [{ ...isHot(), kind: 'operand' }])))).toEqual([{ code: 'invalid_value', pointer: '/document/logicLibrary/0/body' }]);
  });
  it('refuses a hole outside an entry', () => {
    expect(failure(() => compileCompositionDocument(draft([text({}, expr(hole('x')))], [])))).toEqual([{ code: 'invalid_reference', pointer: `${at}/props/value/value` }]);
  });
  it('runs the expression budgets on the worked-out text and reports them at the use args', () => {
    // Nine nested nots stay inside the library's own check but a use inside rules of depth 6 is over the condition depth.
    const deep = (levels: number): J => { let leaf: J = { type: 'compare', op: 'eq', left: lit(1), right: lit(1) }; for (let i = 1; i < levels; i++) leaf = { type: 'not', of: leaf }; return leaf; };
    const big = { id: 'deep', name: 'Deep', kind: 'condition', params: [], body: deep(7) };
    const rule = expr({ type: 'choose', cases: [{ when: use('deep', {}), then: lit('a') }], otherwise: lit('b') });
    const found = failure(() => compileCompositionDocument(draft([text({}, rule)], [big])));
    expect(found.map(issue => issue.code)).toEqual(['limit_exceeded']);
    expect(found[0].pointer).toBe(`${at}/props/value/value/cases/0/when/args`);
    // The node budget: a count phrase used as the argument of itself nine levels over 64 nodes.
    const wide = { id: 'wide', name: 'Wide', kind: 'operand', params: [{ name: 'v', kind: 'operand' }], body: { type: 'list', items: Array.from({ length: 40 }, () => hole('v')) } };
    const heavy = expr({ type: 'list', items: [use('wide', { v: { type: 'math', op: 'add', args: [lit(1), lit(2), lit(3)] } })] });
    const nodes = failure(() => compileCompositionDocument(draft([text({}, heavy)], [wide])));
    expect(nodes.map(issue => issue.code)).toContain('limit_exceeded');
    expect(nodes.filter(issue => issue.code === 'limit_exceeded').every(issue => issue.pointer === `${at}/props/value/value/items/0/args`)).toBe(true);
  });
  it('refuses a document that grows past the value cap when the uses are worked out', () => {
    const library = [{ id: 'fat', name: 'Fat', kind: 'operand', params: [{ name: 'v', kind: 'operand' }], body: { type: 'list', items: Array.from({ length: 60 }, () => hole('v')) } }];
    const components = Array.from({ length: 30 }, (_, index) => text({}, expr(use('fat', { v: lit('x'.repeat(10)) })), `t${index}`));
    expect(() => compileCompositionDocument(draft(components, library))).toThrow(CompositionValidationError);
  });
});

describe('the publication', () => {
  const used = () => draft([text({}, expr(use('count-phrase', { src: 'temp', one: 'sensor', many: 'sensors' })))], [countPhrase()]);
  it('refuses a library, a use or a hole left in its document', () => {
    expect(() => assertNoLogic(used())).toThrow(CompositionValidationError);
    expect(failure(() => assertNoLogic({ logicLibrary: [] }))).toEqual([{ code: 'unknown_field', pointer: '/document/logicLibrary' }]);
    expect(failure(() => assertNoLogic({ a: [{ b: hole('x') }] }))).toEqual([{ code: 'unknown_variant', pointer: '/document/a/0/b' }]);
    expect(failure(() => assertNoLogic({ a: use('x', {}) }))).toEqual([{ code: 'unknown_variant', pointer: '/document/a' }]);
    const envelope = (document: J) => ({ envelopeVersion: '2.0', publisherId: 'p', revision: 1, updatedAt: '2026-01-01T00:00:00Z', publishedAt: '2026-01-01T00:00:00Z', capabilities: [], assetManifestSha256: '0'.repeat(64), document });
    expect(() => validateCompositionPublication(envelope(used()))).toThrow(CompositionValidationError);
    expect(publishedDocument(used())).not.toHaveProperty('logicLibrary');
    expect(() => assertNoLogic(publishedDocument(used()))).not.toThrow();
  });
  it('round-trips: the draft compiles, the published form decodes, and its capabilities match the compile', () => {
    const compiled = compileCompositionDocument(used());
    expect(compiled.document.logicLibrary).toHaveLength(1);
    const envelope = {
      envelopeVersion: '2.0', publisherId: 'p', revision: 1, updatedAt: '2026-01-01T00:00:00Z', publishedAt: '2026-01-01T00:00:00Z',
      capabilities: compiled.capabilities, assetManifestSha256: base.assetManifestSha256, document: compiled.expanded,
    };
    const decoded = decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(envelope)));
    expect(canonicalCompositionJSON(decoded.document)).toBe(canonicalCompositionJSON(compileCompositionDocument(plain([text({}, expr(handCount('temp', 'sensor', 'sensors')))])).document));
  });
});

describe('a saved component whose binding fills a use', () => {
  const ventEntry = (extra: J = {}): J => ({
    id: 'vent', name: 'Vent',
    params: [{ name: 'sensor', kind: 'source-id' }],
    bindings: [{ param: 'sensor', nodeId: 'cmp-vent', field: 'props/value/value/args/src' }],
    node: text({}, expr(use('count-phrase', { src: 'temp', one: 'sensor', many: 'sensors' })), 'cmp-vent'),
    ...extra,
  });
  const handEntry = (): J => ({
    id: 'vent', name: 'Vent', params: [{ name: 'sensor', kind: 'source-id' }],
    bindings: [
      { param: 'sensor', nodeId: 'cmp-vent', field: 'props/value/value/cases/0/when/left/from/sourceId' },
      { param: 'sensor', nodeId: 'cmp-vent', field: 'props/value/value/cases/0/then/args/n/from/sourceId' },
      { param: 'sensor', nodeId: 'cmp-vent', field: 'props/value/value/otherwise/args/n/from/sourceId' },
    ],
    node: text({}, expr(handCount('temp', 'sensor', 'sensors')), 'cmp-vent'),
  });
  const place = (id: string, sensor: string): J => ({ id, type: 'component-ref', componentId: 'vent', layout: { span: 1 }, args: { sensor } });
  const withLibrary = (entry: J, library?: J[]): J => {
    const document = draft([place('vent-a', 'temp2')], library);
    document.componentLibrary = [entry];
    return document;
  };
  it('is re-pointed to every field the argument lands in, so the published document draws the same', () => {
    const compiled = compileCompositionDocument(withLibrary(ventEntry(), [countPhrase()]));
    const expanded = compiled.expanded as J;
    expect(expanded.logicLibrary).toBeUndefined();
    expect(expanded.componentLibrary[0].bindings).toEqual([
      { param: 'sensor', nodeId: 'cmp-vent', field: 'props/value/value/cases/0/when/left/from/sourceId' },
      { param: 'sensor', nodeId: 'cmp-vent', field: 'props/value/value/cases/0/then/args/n/from/sourceId' },
      { param: 'sensor', nodeId: 'cmp-vent', field: 'props/value/value/otherwise/args/n/from/sourceId' },
    ]);
    const hand = compileCompositionDocument(withLibrary(handEntry())).document;
    expect(expandDocument(expanded as CompositionDocument).pages[2].components[0]).toEqual(expandDocument(hand).pages[2].components[0]);
    const placed = expandDocument(expanded as CompositionDocument).pages[2].components[0] as J;
    expect(placed.props.value.value.cases[0].when.left.from.sourceId).toBe('temp2');
    expect(placed.props.value.value.otherwise.args.n.from.sourceId).toBe('temp2');
    expect(placed.props.value.value.otherwise.args.w).toEqual(lit('sensors'));
  });
  it('keeps the capabilities of the hand-written component', () => {
    expect(compileCompositionDocument(withLibrary(ventEntry(), [countPhrase()])).capabilities).toEqual(compileCompositionDocument(withLibrary(handEntry())).capabilities);
  });
  it('drops a binding whose argument lands nowhere, and refuses more than 128 bindings', () => {
    const unused = countPhrase({ params: [{ name: 'src', kind: 'source-id' }, { name: 'one', kind: 'text' }, { name: 'many', kind: 'text' }], body: lit('fixed') });
    expect(expandLogic(withLibrary(ventEntry(), [unused])).document).toMatchObject({ componentLibrary: [{ bindings: [] }] });
    const spread = { id: 'spread', name: 'Spread', kind: 'operand', params: [{ name: 'src', kind: 'source-id' }], body: { type: 'list', items: Array.from({ length: 64 }, () => read(hole('src'))) } };
    const entry = ventEntry({ node: text({}, expr(use('spread', { src: 'temp' })), 'cmp-vent') });
    const plainBindings = Array.from({ length: 65 }, () => ({ param: 'sensor', nodeId: 'cmp-vent', field: 'props/value/value/args/src' }));
    const document = withLibrary({ ...entry, bindings: plainBindings.slice(0, 1) }, [spread]);
    expect((expandLogic(document).document as J).componentLibrary[0].bindings).toHaveLength(64);
    const three = withLibrary({ ...entry, bindings: [entry.bindings[0], entry.bindings[0], entry.bindings[0]] }, [spread]);
    expect(failure(() => expandLogic(three))).toEqual([{ code: 'limit_exceeded', pointer: '/componentLibrary/0/bindings' }]);
  });
});

describe('the expansion budget', () => {
  const holes = (count: number) => ({ type: 'list', items: Array.from({ length: count }, () => hole('v')) });
  const big = { id: 'big', name: 'Big', kind: 'operand', params: [{ name: 'v', kind: 'operand' }], body: holes(64) };
  const nest = (depth: number): J => depth === 0 ? lit(1) : use('big', { v: nest(depth - 1) });
  it('counts what a hole copies, so nested arguments cannot blow a document up: the cap fires as limit_exceeded at the use args', () => {
    const found = failure(() => compileCompositionDocument(draft([text({}, expr(nest(3)))], [big])));
    expect(found.map(issue => issue.code)).toEqual(['limit_exceeded']);
    expect(found[0].pointer).toMatch(/^\/document\/pages\/2\/components\/0\/props\/value\/value(\/args\/v)*\/args$/);
  });
  it('bounds the library check the same way: an entry that nests uses in arguments is refused at the entry', () => {
    const bomb = { id: 'bomb', name: 'Bomb', kind: 'operand', params: [], body: nest(3) };
    const found = failure(() => compileCompositionDocument(draft([], [big, bomb])));
    expect(found.map(issue => issue.code)).toEqual(['limit_exceeded']);
    expect(found[0].pointer).toMatch(/^\/document\/logicLibrary\/1\/body$/);
  });
  it('still lets a document of ordinary size through', () => {
    expect(() => expandLogic(draft([text({}, expr(use('big', { v: lit(1) })))], [big]))).not.toThrow();
    expect(() => expandLogic(draft([text({}, expr(use('big', { v: use('big', { v: lit(1) }) })))], [big]))).not.toThrow();
  });
});

describe('a binding that fills a non-string argument', () => {
  const showIf = { id: 'show-if', name: 'Show if', kind: 'operand', params: [{ name: 'src', kind: 'source-id' }, { name: 'then', kind: 'operand' }],
    body: { type: 'choose', cases: [{ when: { type: 'compare', op: 'above', left: read(hole('src')), right: lit(5) }, then: hole('then') }], otherwise: lit('') } };
  const vent = (field: string, argument: J = lit('Hot')): J => ({
    id: 'vent', name: 'Vent', params: [{ name: 'word', kind: 'text' }],
    bindings: [{ param: 'word', nodeId: 'cmp-vent', field }],
    node: text({}, expr(use('show-if', { src: 'temp', then: argument })), 'cmp-vent'),
  });
  const document = (entry: J): J => { const d = draft([{ id: 'vent-a', type: 'component-ref', componentId: 'vent', layout: { span: 1 }, args: { word: 'Cold' } }], [showIf]); d.componentLibrary = [entry]; return d; };
  it('is re-pointed to the string inside an operand argument', () => {
    const compiled = compileCompositionDocument(document(vent('props/value/value/args/then/value')));
    const entry = (compiled.expanded as J).componentLibrary[0];
    expect(entry.bindings).toEqual([{ param: 'word', nodeId: 'cmp-vent', field: 'props/value/value/cases/0/then/value' }]);
    const placed = expandDocument(compiled.expanded as CompositionDocument).pages[2].components[0] as J;
    expect(placed.props.value.value.cases[0].then).toEqual(lit('Cold'));
  });
  it('is refused at the binding when the argument holds no string there', () => {
    for (const field of ['props/value/value/args/then/nowhere', 'props/value/value/args/then/type/deeper', 'props/value/value/args/src/x']) {
      const found = failure(() => compileCompositionDocument(document(vent(field))));
      expect(found).toContainEqual({ code: 'binding_type', pointer: '/document/componentLibrary/0/bindings/0/field' });
    }
  });
  it('is refused when a number argument is bound as text', () => {
    const counted = { id: 'at-least', name: 'At least', kind: 'condition', params: [{ name: 'src', kind: 'source-id' }, { name: 'limit', kind: 'number' }],
      body: { type: 'compare', op: 'above', left: read(hole('src')), right: lit(hole('limit')) } };
    const entry = { id: 'vent', name: 'Vent', params: [{ name: 'word', kind: 'text' }], bindings: [{ param: 'word', nodeId: 'cmp-vent', field: 'visibleWhen/args/limit' }],
      node: text({ visibleWhen: use('at-least', { src: 'temp', limit: 5 }) }, lit('x'), 'cmp-vent') };
    const d = draft([{ id: 'vent-a', type: 'component-ref', componentId: 'vent', layout: { span: 1 }, args: { word: 'x' } }], [counted]);
    d.componentLibrary = [entry];
    expect(failure(() => compileCompositionDocument(d))).toContainEqual({ code: 'binding_type', pointer: '/document/componentLibrary/0/bindings/0/field' });
  });
  it('reports a later binding issue at the binding the author wrote, though re-pointing moved its index', () => {
    const entry = vent('props/value/value/args/src');
    entry.params.push({ name: 'other', kind: 'page-id' });
    entry.bindings = [
      { param: 'word', nodeId: 'cmp-vent', field: 'props/value/value/args/then/value' },
      { param: 'other', nodeId: 'cmp-vent', field: 'props/nowhere' },
    ];
    const found = failure(() => compileCompositionDocument(document(entry)));
    expect(found.map(issue => issue.pointer)).toContain('/document/componentLibrary/0/bindings/1/field');
  });
});

describe('entity-driven phrases', () => {
  // The owner's case: a count read from more than one entity, said one way for none, another for one and another for several.
  const total = (a: unknown, b: unknown): J => ({ type: 'math', op: 'add', args: [read(a), read(b)] });
  const phrase3 = { id: 'count-words', name: 'Count words', kind: 'operand',
    params: [{ name: 'first', kind: 'source-id' }, { name: 'second', kind: 'source-id' }, { name: 'none', kind: 'text' }, { name: 'one', kind: 'text' }, { name: 'many', kind: 'text' }],
    body: { type: 'choose', cases: [
      { when: { type: 'compare', op: 'eq', left: total(hole('first'), hole('second')), right: lit(0) }, then: lit(hole('none')) },
      { when: { type: 'compare', op: 'eq', left: total(hole('first'), hole('second')), right: lit(1) }, then: lit(hole('one')) },
    ], otherwise: { type: 'format', pattern: '{n} {w}', args: { n: total(hole('first'), hole('second')), w: lit(hole('many')) } } } };
  const hand: J = { type: 'choose', cases: [
    { when: { type: 'compare', op: 'eq', left: total('temp', 'temp2'), right: lit(0) }, then: lit('Nothing open') },
    { when: { type: 'compare', op: 'eq', left: total('temp', 'temp2'), right: lit(1) }, then: lit('One open') },
  ], otherwise: { type: 'format', pattern: '{n} {w}', args: { n: total('temp', 'temp2'), w: lit('open') } } };
  it('works a three-case phrase over two source-id parameters out as the hand-written rule', () => {
    const value = expr(use('count-words', { first: 'temp', second: 'temp2', none: 'Nothing open', one: 'One open', many: 'open' }));
    const compiled = compileCompositionDocument(draft([text({}, value)], [phrase3]));
    expect(firstOf(compiled)).toEqual(firstOf(compileCompositionDocument(plain([text({}, expr(hand))]))));
    expect(compiled.capabilities).toEqual(compileCompositionDocument(plain([text({}, expr(hand))])).capabilities);
  });
  it('takes any number of entity parameters up to eight, and a different pair at each use', () => {
    const value = (a: string, b: string) => expr(use('count-words', { first: a, second: b, none: 'n', one: 'o', many: 'm' }));
    const compiled = compileCompositionDocument(draft([text({}, value('temp', 'temp2')), text({}, value('temp2', 'temp'), 't2')], [phrase3]));
    const nodes = (compiled.expanded as J).pages[2].components;
    expect(nodes[0].props.value.value.cases[0].when.left.args[0].from.sourceId).toBe('temp');
    expect(nodes[1].props.value.value.cases[0].when.left.args[0].from.sourceId).toBe('temp2');
  });
});

describe('what a use costs in a published document', () => {
  const published = (uses: number) => {
    const components = Array.from({ length: uses }, (_, index) => text({}, expr(use('count-phrase', { src: 'temp', one: 'sensor', many: 'sensors' })), `row-${index}`));
    return (compileCompositionDocument(draft(components, uses ? [countPhrase()] : undefined)).expanded);
  };
  const values = (value: unknown): number => value !== null && typeof value === 'object' ? 1 + Object.values(value).reduce<number>((total, item) => total + values(item), 0) : 1;
  const bytes = (value: unknown) => new TextEncoder().encode(canonicalCompositionJSON(value)).byteLength;
  it('is the same for every use: about 62 values and 790 bytes, node included, for a one-case count phrase', () => {
    const perUseValues = (values(published(10)) - values(published(0))) / 10;
    const perUseBytes = (bytes(published(10)) - bytes(published(0))) / 10;
    expect(perUseValues).toBe(62);
    expect(perUseBytes).toBeGreaterThan(700);
    expect(perUseBytes).toBeLessThan(900);
    expect(values(published(20)) - values(published(10))).toBe(620);
  });
});

describe('the budget covers samples and the whole library', () => {
  const copies = (count: number): J => ({ type: 'literal', value: Array.from({ length: count }, () => hole('v')) });
  const timed = (run: () => unknown): { issues: CompositionIssue[]; ms: number } => {
    const start = performance.now();
    const issues = failure(run);
    return { issues, ms: performance.now() - start };
  };
  it('charges a large sample in full: 900 holes over a 60,000-value sample is limit_exceeded, quickly', () => {
    const entry = { id: 'big', name: 'Big', kind: 'operand', params: [{ name: 'v', kind: 'operand', sample: lit(Array.from({ length: 60 }, () => Array.from({ length: 1000 }, () => 0))) }], body: copies(900) };
    const { issues, ms } = timed(() => compileCompositionDocument(draft([], [entry])));
    expect(issues).toEqual([{ code: 'limit_exceeded', pointer: '/document/logicLibrary/0/body' }]);
    expect(ms).toBeLessThan(1000);
  });
  it('shares one budget across the entries: 99 entries that each stay under the cap are limit_exceeded together, quickly', () => {
    const entries = Array.from({ length: 99 }, (_, index) => ({
      id: `e${index}`, name: `E${index}`, kind: 'operand',
      params: [{ name: 'v', kind: 'operand', sample: lit(Array.from({ length: 300 }, () => 0)) }],
      body: { type: 'list', items: Array.from({ length: 64 }, () => hole('v')) },
    }));
    const { issues, ms } = timed(() => compileCompositionDocument(draft([], entries)));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('limit_exceeded');
    expect(issues[0].pointer).toMatch(/^\/document\/logicLibrary\/\d+\/body$/);
    expect(ms).toBeLessThan(1000);
  });
  it('spends the same budget on the document after the check, and refuses a sample that does not fit its kind', () => {
    const entry = { id: 'e', name: 'E', kind: 'operand', params: [{ name: 'v', kind: 'operand', sample: lit(1) }], body: { type: 'list', items: [hole('v')] } };
    expect(() => compileCompositionDocument(draft([], [entry]))).not.toThrow();
    const wrong = { ...entry, params: [{ name: 'v', kind: 'number', sample: 'x' }] };
    expect(failure(() => compileCompositionDocument(draft([], [wrong])))).toEqual([{ code: 'invalid_value', pointer: '/document/logicLibrary/0/params/0/sample' }]);
  });
});
