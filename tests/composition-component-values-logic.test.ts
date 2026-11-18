import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { expandDocument } from '../src/shared/composition/components';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';

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

/** `sh.component-values@1` and the logic library (`sh.logic-library@1`) in one document: the order they expand in, and what a binding through a use becomes. */
describe('values and the logic library together', () => {
  const entry = (params: J[], bindings: J[], node: J): J => ({ id: 'vent', name: 'Vent', params, bindings, node });
  const placed = (extra: J): J => ({ id: 'vent-a', type: 'component-ref', componentId: 'vent', layout: { span: 1 }, ...extra });
  const withEntry = (item: J, place: J): J => { const document = draft([place], [countPhrase(), isHot()]); document.componentLibrary = [item]; return document; };

  it('works a logic-ref out of a place\'s value before the value is written, so the published document holds no logic-ref', () => {
    const item = entry([{ name: 'shown', kind: 'value', label: 'Shown' }], [{ param: 'shown', nodeId: 'cmp-vent', field: 'visibleWhen' }], text({}, lit('x'), 'cmp-vent'));
    const document = withEntry(item, placed({ values: { shown: use('is-hot', { src: 'temp', limit: 5 }) } }));
    const compiled = compileCompositionDocument(document);
    const expanded = compiled.expanded as J;
    expect(JSON.stringify(expanded)).not.toContain('logic-ref');
    expect(expanded.pages[2].components[0].values.shown).toEqual(handHot('temp', 5));
    const drawn = expandDocument(expanded as CompositionDocument).pages[2].components[0] as J;
    expect(drawn.visibleWhen).toEqual(handHot('temp', 5));
    expect(compiled.capabilities).toContain('sh.component-values@1');
  });

  it('refuses a logic-ref in a value that names a use the library does not hold', () => {
    const item = entry([{ name: 'shown', kind: 'value' }], [{ param: 'shown', nodeId: 'cmp-vent', field: 'visibleWhen' }], text({}, lit('x'), 'cmp-vent'));
    const found = failure(() => compileCompositionDocument(withEntry(item, placed({ values: { shown: use('no-such-use', {}) } }))));
    expect(found.length).toBeGreaterThan(0);
  });

  it('re-points a value binding through a use to every field the argument lands in, and a place\'s value fills each of them', () => {
    const item = entry([{ name: 'sensor', kind: 'value', label: 'Sensor' }], [{ param: 'sensor', nodeId: 'cmp-vent', field: 'props/value/value/args/src' }],
      text({}, expr(use('count-phrase', { src: 'temp', one: 'sensor', many: 'sensors' })), 'cmp-vent'));
    const compiled = compileCompositionDocument(withEntry(item, placed({ values: { sensor: 'temp2' } })));
    const expanded = compiled.expanded as J;
    const landings = expanded.componentLibrary[0].bindings.map((binding: J) => binding.field);
    expect(landings).toEqual([
      'props/value/value/cases/0/when/left/from/sourceId',
      'props/value/value/cases/0/then/args/n/from/sourceId',
      'props/value/value/otherwise/args/n/from/sourceId',
    ]);
    const drawn = expandDocument(expanded as CompositionDocument).pages[2].components[0] as J;
    expect(drawn.props.value.value.cases[0].when.left.from.sourceId).toBe('temp2');
    expect(drawn.props.value.value.cases[0].then.args.n.from.sourceId).toBe('temp2');
    expect(drawn.props.value.value.otherwise.args.n.from.sourceId).toBe('temp2');
  });
});
