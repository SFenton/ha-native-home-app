/**
 * The corpus cases of the two ids the weather-gen lane WG-S2 adds, both generic (nothing here is named for a card or a forecast part): `sh.repeat@1` (a flow
 * output `records`, the node `repeat`, the `item` operand in node slots, the `index` operand, and Data Flows a saved component owns) and `sh.flow-extras@1`
 * (the steps `min`, `max`, `running-sum` and `annotate`, the date styles `hour` and `weekday`, and the `progress` operation of a `date` operand). Demo ids only:
 * `weather.demo_home` is the one entity a flow reads, because a live forecast is the only list feed that gives records.
 *
 * `generate-expression-corpus.ts` writes the publication cases and the operand cases; `generate-pipeline-corpus.ts` writes the flow cases (`pipelines/`), so each
 * generator keeps owning the folders it clears. Publication cases are `pending-<family>-*` (the Studio compiles them) and `<family>-*` (the Studio refuses them);
 * every refusal records the Studio's first issue here by hand in `expect`, and the generator fails when the compiler disagrees. The evaluation cases are written
 * by hand from the behaviour of the app's hand-coded weather views (`apple/Sources/HassCore/Weather`), cited per case, never computed by the module under test.
 */
import { arrayOf, inferShapeFromSamples, newFacts, objectOf, requestShape, typeSteps, withoutNull, type Shape } from '../src/shared/composition/pipeline';

type J = Record<string, any>;

export interface WgFlowCase {
  name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean;
  finish?: (envelope: J) => void;
  /** The Studio's first issue, written by hand: a reject must give exactly this. */
  expect?: { code: string; pointer: string };
}
export interface WgFlowEvaluation { name: string; note: string; subject: J; env: J; expected: J }
/** A flow case for `contract/corpus/pipelines`, in the shape `generate-pipeline-corpus.ts` writes. */
export interface WgFlowPipeline { name: string; note: string; inputs: J; response: unknown; context?: J; budget?: number; expected: J; compiles: boolean }
/** The families this module owns: `reject/pending-<family>-*` and `reject/<family>-*`. */
export const wgFlowFamilies = ['repeat', 'flow-extras', 'flow-average', 'owned-flow', 'records'];
/** Capability ids by the short names the cases use. */
export const wgFlowNeeds: Record<string, string> = {
  repeat: 'sh.repeat@1', 'flow-extras': 'sh.flow-extras@1', pipeline: 'sh.pipeline@1', 'component-ref': 'sh.component-ref@1', 'text-style': 'sh.text-style@1',
  stack: 'sh.stack@1', 'symbol-part': 'sh.symbol-part@1', 'visible-when': 'sh.visible-when@1', 'list-parts': 'sh.list-parts@1', 'call-service': 'sh.call-service@1', 'flow-average': 'sh.flow-average@1',
};

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const item = (...segments: string[]): J => ({ type: 'item', path: segments });
const index: J = { type: 'index' };
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const fmt = (pattern: string, args: J, formats?: J): J => ({ type: 'format', pattern, args, ...(formats ? { formats } : {}) });
const cmp = (op: string, left: J, right: J): J => ({ type: 'compare', op, left, right });
const choose = (cases: [J, J][], otherwise: J): J => ({ type: 'choose', cases: cases.map(([when, then]) => ({ when, then })), otherwise });
const math = (op: string, ...args: J[]): J => ({ type: 'math', op, args });
const symbolOf = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const token = (name: string): J => ({ type: 'token', name });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const step = (id: string, op: string, rest: J = {}): J => ({ id, op, ...rest });
const exprText = (id: string, operand: J, props: J = {}, rest: J = {}): J => node(id, 'text', { props: { value: { type: 'expr', value: operand }, style: 'body', unavailableText: 'None', ...props }, ...rest });
const stackOf = (id: string, children: J[], props: J = {}, rest: J = {}): J => node(id, 'stack', { props: { axis: 'vertical', spacing: token('xs'), ...props }, children, ...rest });
const source = (id: string, inputs: J): J => ({ id, kind: 'model', model: 'pipeline@1', inputs });
const forecast = (forecastType = 'hourly'): J => ({ type: 'ha-subscription', kind: 'weather-forecast', entityId: lit('weather.demo_home'), forecastType });
const WORDS = { loadingText: 'Loading', emptyText: 'Nothing here', unavailableText: 'Unavailable', errorText: 'Could not update', staleText: 'Out of date' };

/** The shape the steps give, so a flow's authored `schema` is the compiler's own typing of its steps (the cases hand-write the answers, not the shapes). */
function schemaOf(request: J, steps: J[], params: J[] = []): Shape {
  const input = request.type === 'ha-subscription' ? requestShape(request as any) : inferShapeFromSamples([request.sample]);
  // A case that breaks the step on purpose cannot be typed: its schema is then a placeholder, and the schema check of the step reports the fault first.
  try {
    const shapes = typeSteps(steps as any, input, new Map(params.map(entry => [entry.name, entry.type])), '', newFacts());
    return withoutNull(shapes.length ? shapes[shapes.length - 1] : input);
  } catch { return { kind: 'any' }; }
}
/** A flow that gives one record per forecast entry: its time, a value, a text and its position. */
const GET_STEP: J = step('entries', 'get', { path: ['forecast'] });
const SERIES_STEPS: J[] = [
  step('entries', 'get', { path: ['forecast'] }), step('cut', 'limit', { count: 24 }),
  step('cells', 'map', { fields: { at: item('datetime'), value: item('temperature'), label: item('condition'), position: index } }),
];
function seriesInputs(over: J = {}): J {
  const request = over.request ?? forecast(), steps = over.steps ?? SERIES_STEPS;
  return { title: 'Series', parameters: [], request, steps, output: { kind: 'records', max: 24 }, schema: over.schema ?? schemaOf(request, steps), ...over };
}
const series = (id = 'series', over: J = {}): J => source(id, seriesInputs(over));
/** A repeat over the flow `providerId`: its first child is the cell, its second (when `placeholder` is set) the placeholder. */
const repeatOf = (children: J[], props: J = {}, rest: J = {}, id = 'items'): J => node(id, 'repeat', {
  props: { providerId: 'series', axis: 'horizontal', spacing: token('s'), ...WORDS, ...props }, children, ...rest,
});
/** The cell a repeat draws: a stack of the record's text and its value. */
const cell = (id = 'cell', rest: J = {}): J => stackOf(id, [
  exprText(`${id}-label`, item('label')),
  exprText(`${id}-value`, fmt('{v}°', { v: item('value') }, { v: { number: { maximumFractionDigits: 0 } } })),
], {}, rest);
const placeholderCell = (id = 'ghost'): J => stackOf(id, [exprText(`${id}-label`, fmt('{n}', { n: math('add', index, lit(1)) }))]);
const withSeries = (tweak?: (envelope: J) => void) => (envelope: J) => { envelope.document.dataSources.push(series()); tweak?.(envelope); };
const at = (indexOfNode: number, rest: string) => `/document/pages/2/components/${indexOfNode}${rest}`;

export const wgFlowCases: WgFlowCase[] = [];
const accept = (name: string, note: string, needs: string[], components: J[], tweak?: (envelope: J) => void) =>
  wgFlowCases.push({ name, note, needs, components, tweak, reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], expect: WgFlowCase['expect'], tweak?: (envelope: J) => void) =>
  wgFlowCases.push({ name, note, needs, components, tweak, reject: true, expect });
/** Cases that need the records flow `series` in the document. */
const acceptSeries = (name: string, note: string, needs: string[], components: J[], tweak?: (envelope: J) => void) => accept(name, note, needs, components, withSeries(tweak));
const rejectSeries = (name: string, note: string, needs: string[], components: J[], expect: WgFlowCase['expect'], tweak?: (envelope: J) => void) =>
  reject(name, note, needs, components, expect, withSeries(tweak));
const REPEAT = ['repeat', 'pipeline'];

// MARK: Repeat (`sh.repeat@1`): the node, its paging and its placeholder
acceptSeries('pending-repeat-horizontal', 'A row of cells, one for each record of a records flow: the smallest repeat, with the five words and no paging.', REPEAT, [repeatOf([cell()])]);
acceptSeries('pending-repeat-vertical', 'A column of cells: a vertical repeat is not paged.', REPEAT, [repeatOf([cell()], { axis: 'vertical' })]);
acceptSeries('pending-repeat-limit', 'At most 6 records are drawn, whatever the flow gives.', REPEAT, [repeatOf([cell()], { limit: 6 })]);
acceptSeries('pending-repeat-limit-hundred', 'The limit may be the 100 a records flow gives at most.', REPEAT, [repeatOf([cell()], { limit: 100 })]);
acceptSeries('pending-repeat-paging-counts-only', 'Paging with the two counts: 6 cells to a page in a compact window, 9 in a regular one.', REPEAT, [repeatOf([cell()], { paging: { compact: 6, regular: 9 } })]);
acceptSeries('pending-repeat-paging-full', 'Every paging field: the count scales down with the text size to at least 2, with a page indicator, buttons at regular width and a name for VoiceOver.', REPEAT,
  [repeatOf([cell()], { paging: { compact: 6, regular: 9, scaleByTextSize: [1, 0.8, 0.5, 0.34], minimum: 2, indicator: true, buttons: 'regular-width', label: '24-hour forecast' } })]);
acceptSeries('pending-repeat-paging-twelve', 'A page holds at most 12.', REPEAT, [repeatOf([cell()], { paging: { compact: 12, regular: 12 } })]);
acceptSeries('pending-repeat-paging-one', 'A page may hold one cell.', REPEAT, [repeatOf([cell()], { paging: { compact: 1, regular: 1, minimum: 1 } })]);
acceptSeries('pending-repeat-paging-scale-flat', 'A scale that never changes is not growing: [1, 1, 1, 1] is allowed.', REPEAT, [repeatOf([cell()], { paging: { compact: 6, regular: 9, scaleByTextSize: [1, 1, 1, 1] } })]);
acceptSeries('pending-repeat-paging-buttons-never', 'Previous and next buttons can be turned off while the indicator stays.', REPEAT, [repeatOf([cell()], { paging: { compact: 6, regular: 9, indicator: true, buttons: 'never' } })]);
acceptSeries('pending-repeat-paging-minimum-equals-compact', 'The fewest a page shrinks to may equal the compact count.', REPEAT, [repeatOf([cell()], { paging: { compact: 4, regular: 8, minimum: 4 } })]);
acceptSeries('pending-repeat-placeholder', 'While the flow has not answered, 6 placeholder cells are drawn from the second child, which has no record.', REPEAT, [repeatOf([cell(), placeholderCell()], { placeholder: { count: 6 } })]);
acceptSeries('pending-repeat-placeholder-max', 'The placeholder count is at most 24.', REPEAT, [repeatOf([cell(), placeholderCell()], { placeholder: { count: 24 } })]);
acceptSeries('pending-repeat-placeholder-index-only', 'The placeholder reads the position (index) but no record: it numbers its cells.', REPEAT, [repeatOf([cell(), placeholderCell()], { placeholder: { count: 3 } })]);
acceptSeries('pending-repeat-in-a-stack', 'A repeat is a part like any other: it sits inside a stack beside a title.', ['repeat', 'pipeline', 'stack'],
  [stackOf('card', [exprText('title', lit('Next hours')), repeatOf([cell()])])]);
acceptSeries('pending-repeat-with-a-rule', 'A repeat may be shown by a rule of its own, which reads no record.', ['repeat', 'pipeline', 'visible-when'],
  [repeatOf([cell()], {}, { visibleWhen: cmp('eq', read('guest-fan', ['state']), lit('on')) })]);
acceptSeries('pending-repeat-two-in-a-page', 'Two repeats of one page read the same flow (the flow runs once).', REPEAT, [repeatOf([cell()], {}, {}, 'first'), repeatOf([cell('other')], { axis: 'vertical' }, {}, 'second')]);
acceptSeries('pending-repeat-body-a-single-text', 'The cell is any node: a lone text will do.', REPEAT, [repeatOf([exprText('only', item('label'))])]);
accept('pending-repeat-rows-flow-needs-no-id', 'A rows flow and the list that shows it need neither new id: the older documents stay as they are.', ['pipeline'],
  [node('list', 'row-collection', { props: { providerId: 'rows', ...WORDS } })], envelope => {
    envelope.document.dataSources.push(source('rows', {
      title: 'Rows', parameters: [], request: forecast(), steps: [step('entries', 'get', { path: ['forecast'] }), step('cells', 'map', { fields: { id: item('datetime'), title: item('condition') } })],
      output: { kind: 'rows', max: 10, row: { id: item('id'), title: item('title') } },
      schema: schemaOf(forecast(), [step('entries', 'get', { path: ['forecast'] }), step('cells', 'map', { fields: { id: item('datetime'), title: item('condition') } })]),
    }));
  });

// MARK: `item` and `index` in the slots of a cell
const textOf = (id: string, operand: J) => exprText(id, operand);
acceptSeries('pending-repeat-item-text', 'item reads a field of the record: the cell text is the record\'s label.', REPEAT, [repeatOf([textOf('t', item('label'))])]);
acceptSeries('pending-repeat-item-number-format', 'A number of the record in a format, with no fraction digits.', REPEAT,
  [repeatOf([textOf('t', fmt('{v}°', { v: item('value') }, { v: { number: { maximumFractionDigits: 0 } } }))])]);
acceptSeries('pending-repeat-index-text', 'index is the cell\'s position, from 0: the text numbers its cells from 1.', REPEAT, [repeatOf([textOf('t', fmt('{n}', { n: math('add', index, lit(1)) }))])]);
acceptSeries('pending-repeat-index-and-item', 'A rule on the position: the first cell says Now, the others their label.', REPEAT,
  [repeatOf([textOf('t', choose([[cmp('eq', index, lit(0)), lit('Now')]], item('label')))])]);
acceptSeries('pending-repeat-item-in-visible-when', 'A cell part hidden by a rule on the record: the rule reads item.', ['repeat', 'pipeline', 'visible-when', 'stack'],
  [repeatOf([stackOf('cell', [exprText('a', item('label')), exprText('b', lit('Hot'), {}, { visibleWhen: cmp('above', item('value'), lit(80)) })])])]);
acceptSeries('pending-repeat-item-in-symbol', 'A symbol that follows the record: its name is a rule over the label.', ['repeat', 'pipeline', 'symbol-part'], [repeatOf([node('glyph', 'symbol', {
  props: { name: { type: 'bound-symbol', value: { type: 'map', of: item('label'), cases: [{ equals: 'rainy', then: lit('cloud.rain.fill') }], otherwise: lit('cloud.fill') }, fallback: symbolOf('cloud.fill') },
    size: { points: 28 }, rendering: 'monochrome' }, a11y: { element: 'hidden' } })])]);
acceptSeries('pending-repeat-item-in-rotation', 'A symbol turned by a number of the record, in degrees.', ['repeat', 'pipeline', 'symbol-part'], [repeatOf([node('arrow', 'symbol', {
  props: { name: symbolOf('location.north.fill'), size: { points: 20 }, rendering: 'monochrome', rotate: item('value') }, a11y: { element: 'hidden' } })])]);
acceptSeries('pending-repeat-item-in-a-label', 'A stack that is one accessibility element named by the record.', ['repeat', 'pipeline', 'stack'],
  [repeatOf([stackOf('cell', [exprText('a', item('label'))], {}, { a11y: { element: 'group', label: { type: 'expr', value: item('label') } } })])]);
acceptSeries('pending-repeat-item-in-an-action', 'A tap that calls a service with a value of the record.', ['repeat', 'pipeline', 'stack', 'call-service'],
  [repeatOf([stackOf('cell', [exprText('a', item('label'))], {}, {
    a11y: { element: 'group', label: { type: 'literal', value: 'Set' }, role: 'button' },
    action: { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.demo_lamp') }, data: { type: 'object', fields: { brightness_pct: item('value') } } },
  })])]);
acceptSeries('pending-repeat-item-whole-record-path', 'A path of one field that is optional in the flow still exists: the value is a gap, not an error.', REPEAT, [repeatOf([textOf('t', item('value'))])]);
acceptSeries('pending-repeat-reads-a-document-source', 'A cell may read a document source as well as its record: the same fan state in every cell.', REPEAT,
  [repeatOf([textOf('t', fmt('{a} {b}', { a: item('label'), b: read('guest-fan', ['state']) }))])]);

// MARK: Repeat refusals
const rpt = (rest: string) => at(0, rest);
reject('repeat-provider-missing', 'The provider names no source: invalid_reference at providerId.', REPEAT, [repeatOf([cell()], { providerId: 'nowhere' })], { code: 'invalid_reference', pointer: rpt('/props/providerId') });
rejectSeries('repeat-provider-not-a-flow', 'The provider is an entity source, not a flow: binding_type.', REPEAT, [repeatOf([cell()], { providerId: 'guest-fan' })], { code: 'binding_type', pointer: rpt('/props/providerId') });
reject('repeat-provider-is-a-rows-flow', 'A rows flow feeds a list of rows, not a repeat: binding_type at the provider.', REPEAT, [repeatOf([cell()], { providerId: 'rows' })],
  { code: 'binding_type', pointer: rpt('/props/providerId') }, envelope => {
    const steps = [step('entries', 'get', { path: ['forecast'] }), step('cells', 'map', { fields: { id: item('datetime'), title: item('condition') } })];
    envelope.document.dataSources.push(source('rows', { title: 'Rows', parameters: [], request: forecast(), steps, output: { kind: 'rows', max: 10, row: { id: item('id'), title: item('title') } }, schema: schemaOf(forecast(), steps) }));
  });
reject('repeat-provider-is-a-record-flow', 'A one-record flow is not a list: binding_type at the provider.', REPEAT, [repeatOf([cell()], { providerId: 'one' })],
  { code: 'binding_type', pointer: rpt('/props/providerId') }, envelope => {
    const steps = [step('now', 'first'), step('fields', 'map', { fields: { label: item('condition') } })];
    const request = { type: 'ha-subscription', kind: 'weather-forecast', entityId: lit('weather.demo_home'), forecastType: 'hourly' };
    const all = [step('entries', 'get', { path: ['forecast'] }), ...steps];
    envelope.document.dataSources.push(source('one', { title: 'One', parameters: [], request, steps: all, output: { kind: 'record' }, schema: schemaOf(request, all) }));
  });
rejectSeries('repeat-item-path-missing', 'A path the flow\'s schema does not have: invalid_reference at the path.', REPEAT, [repeatOf([textOf('t', item('nowhere'))])],
  { code: 'invalid_reference', pointer: rpt('/children/0/props/value/value/path') });
rejectSeries('repeat-item-path-reserved', 'A reserved segment is never a path: invalid_reference.', REPEAT, [repeatOf([textOf('t', item('__proto__'))])],
  { code: 'invalid_reference', pointer: rpt('/children/0/props/value/value/path') });
rejectSeries('repeat-item-in-an-action-missing-field', 'A record field an action reads must exist too.', ['repeat', 'pipeline', 'stack', 'call-service'],
  [repeatOf([stackOf('cell', [exprText('a', item('label'))], {}, {
    a11y: { element: 'group', label: { type: 'literal', value: 'Set' }, role: 'button' },
    action: { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.demo_lamp') }, data: { type: 'object', fields: { brightness_pct: item('nowhere') } } },
  })])], { code: 'invalid_reference', pointer: rpt('/children/0/action/data/fields/brightness_pct/path') });
rejectSeries('repeat-item-outside-a-repeat', 'item outside a repeat has no record: invalid_combination.', ['repeat', 'pipeline'], [exprText('t', item('label'))],
  { code: 'invalid_combination', pointer: at(0, '/props/value/value') });
rejectSeries('repeat-item-in-the-repeats-own-rule', 'The repeat itself is outside its records: a rule on the repeat that reads item is refused.', ['repeat', 'pipeline', 'visible-when'],
  [repeatOf([cell()], {}, { visibleWhen: cmp('eq', item('label'), lit('x')) })], { code: 'invalid_combination', pointer: rpt('/visibleWhen/left') });
rejectSeries('repeat-index-outside-a-repeat', 'index outside a repeat or a flow step has no position: invalid_combination.', ['repeat', 'pipeline'], [exprText('t', fmt('{n}', { n: index }))],
  { code: 'invalid_combination', pointer: at(0, '/props/value/value/args/n') });
rejectSeries('repeat-index-in-a-sibling', 'A node beside the repeat is outside it: index is refused there too.', ['repeat', 'pipeline'],
  [repeatOf([cell()]), exprText('beside', fmt('{n}', { n: index }))], { code: 'invalid_combination', pointer: at(1, '/props/value/value/args/n') });
rejectSeries('repeat-nested', 'A repeat does not hold a repeat: invalid_combination at the inner node.', REPEAT,
  [repeatOf([repeatOf([cell()], {}, {}, 'inner')])], { code: 'invalid_combination', pointer: rpt('/children/0/type') });
rejectSeries('repeat-item-in-the-placeholder', 'The placeholder has no record: item is refused there.', REPEAT,
  [repeatOf([cell(), stackOf('ghost', [exprText('g', item('label'))])], { placeholder: { count: 3 } })], { code: 'invalid_combination', pointer: rpt('/children/1/children/0/props/value/value') });
rejectSeries('repeat-component-ref-inside', 'A saved component inside a repeat could hold a repeat: it is refused.', ['repeat', 'pipeline', 'component-ref'],
  [repeatOf([{ id: 'use', type: 'component-ref', componentId: 'tile', layout: { span: 1 } }])], { code: 'invalid_combination', pointer: rpt('/children/0/type') }, envelope => {
    envelope.document.componentLibrary = [{ id: 'tile', name: 'Tile', node: exprText('body', lit('x')) }];
  });
rejectSeries('repeat-paging-compact-over-twelve', 'A compact page holds at most 12.', REPEAT, [repeatOf([cell()], { paging: { compact: 13, regular: 9 } })], { code: 'limit_exceeded', pointer: rpt('/props/paging/compact') });
rejectSeries('repeat-paging-regular-over-twelve', 'A regular page holds at most 12.', REPEAT, [repeatOf([cell()], { paging: { compact: 6, regular: 13 } })], { code: 'limit_exceeded', pointer: rpt('/props/paging/regular') });
rejectSeries('repeat-paging-compact-zero', 'A page holds at least one cell.', REPEAT, [repeatOf([cell()], { paging: { compact: 0, regular: 9 } })], { code: 'limit_exceeded', pointer: rpt('/props/paging/compact') });
rejectSeries('repeat-paging-compact-fraction', 'A count is a whole number.', REPEAT, [repeatOf([cell()], { paging: { compact: 5.5, regular: 9 } })], { code: 'invalid_value', pointer: rpt('/props/paging/compact') });
rejectSeries('repeat-paging-on-a-vertical-repeat', 'A column is not paged: paging needs a horizontal repeat.', REPEAT, [repeatOf([cell()], { axis: 'vertical', paging: { compact: 6, regular: 9 } })], { code: 'invalid_combination', pointer: rpt('/props/paging') });
rejectSeries('repeat-paging-minimum-over-compact', 'The fewest a page shrinks to is at most the compact count.', REPEAT, [repeatOf([cell()], { paging: { compact: 4, regular: 9, minimum: 5 } })], { code: 'invalid_value', pointer: rpt('/props/paging/minimum') });
rejectSeries('repeat-paging-minimum-over-regular', 'And at most the regular count.', REPEAT, [repeatOf([cell()], { paging: { compact: 9, regular: 4, minimum: 5 } })], { code: 'invalid_value', pointer: rpt('/props/paging/minimum') });
rejectSeries('repeat-paging-scale-grows', 'The count never grows with the text size: 0.5 then 0.8 is refused.', REPEAT, [repeatOf([cell()], { paging: { compact: 6, regular: 9, scaleByTextSize: [1, 0.5, 0.8, 0.3] } })], { code: 'invalid_value', pointer: rpt('/props/paging/scaleByTextSize') });
rejectSeries('repeat-paging-scale-over-one', 'A factor is at most 1.', REPEAT, [repeatOf([cell()], { paging: { compact: 6, regular: 9, scaleByTextSize: [1.2, 1, 1, 1] } })], { code: 'limit_exceeded', pointer: rpt('/props/paging/scaleByTextSize/0') });
rejectSeries('repeat-paging-scale-zero', 'A factor is above 0.', REPEAT, [repeatOf([cell()], { paging: { compact: 6, regular: 9, scaleByTextSize: [1, 1, 1, 0] } })], { code: 'limit_exceeded', pointer: rpt('/props/paging/scaleByTextSize/3') });
rejectSeries('repeat-paging-scale-three-steps', 'There are four text-size steps: three factors are refused.', REPEAT, [repeatOf([cell()], { paging: { compact: 6, regular: 9, scaleByTextSize: [1, 0.8, 0.5] } })], { code: 'limit_exceeded', pointer: rpt('/props/paging/scaleByTextSize') });
rejectSeries('repeat-paging-buttons-unknown', 'The buttons are never or regular-width.', REPEAT, [repeatOf([cell()], { paging: { compact: 6, regular: 9, buttons: 'always' } })], { code: 'unknown_variant', pointer: rpt('/props/paging/buttons') });
rejectSeries('repeat-paging-unknown-field', 'Paging has its own fields only.', REPEAT, [repeatOf([cell()], { paging: { compact: 6, regular: 9, loop: true } })], { code: 'unknown_field', pointer: rpt('/props/paging/loop') });
rejectSeries('repeat-placeholder-over-24', 'At most 24 placeholder cells.', REPEAT, [repeatOf([cell(), placeholderCell()], { placeholder: { count: 25 } })], { code: 'limit_exceeded', pointer: rpt('/props/placeholder/count') });
rejectSeries('repeat-placeholder-zero', 'At least one placeholder cell.', REPEAT, [repeatOf([cell(), placeholderCell()], { placeholder: { count: 0 } })], { code: 'limit_exceeded', pointer: rpt('/props/placeholder/count') });
rejectSeries('repeat-placeholder-without-a-child', 'A placeholder count needs the second child that is drawn.', REPEAT, [repeatOf([cell()], { placeholder: { count: 3 } })], { code: 'missing_required', pointer: rpt('/children') });
rejectSeries('repeat-second-child-without-a-placeholder', 'A second child with no placeholder count is not drawn: refused.', REPEAT, [repeatOf([cell(), placeholderCell()])], { code: 'invalid_combination', pointer: rpt('/children/1') });
rejectSeries('repeat-no-child', 'A repeat draws one thing: it needs a first child.', REPEAT, [repeatOf([])], { code: 'limit_exceeded', pointer: rpt('/children') });
rejectSeries('repeat-three-children', 'And at most two: the cell and the placeholder.', REPEAT, [repeatOf([cell(), placeholderCell(), cell('third')], { placeholder: { count: 3 } })], { code: 'limit_exceeded', pointer: rpt('/children') });
rejectSeries('repeat-limit-over-hundred', 'A records flow gives at most 100: the limit may not ask for more.', REPEAT, [repeatOf([cell()], { limit: 101 })], { code: 'limit_exceeded', pointer: rpt('/props/limit') });
rejectSeries('repeat-limit-zero', 'The limit is at least 1.', REPEAT, [repeatOf([cell()], { limit: 0 })], { code: 'limit_exceeded', pointer: rpt('/props/limit') });
rejectSeries('repeat-limit-fraction', 'The limit is a whole number.', REPEAT, [repeatOf([cell()], { limit: 2.5 })], { code: 'invalid_value', pointer: rpt('/props/limit') });
rejectSeries('repeat-axis-unknown', 'The axis is horizontal or vertical.', REPEAT, [repeatOf([cell()], { axis: 'diagonal' })], { code: 'unknown_variant', pointer: rpt('/props/axis') });
rejectSeries('repeat-spacing-missing', 'The space between cells is always authored, never implicit.', REPEAT, [repeatOf([cell()], { spacing: undefined })], { code: 'missing_required', pointer: rpt('/props/spacing') });
rejectSeries('repeat-word-missing', 'All five words are authored: loadingText is missing.', REPEAT, [repeatOf([cell()], { loadingText: undefined })], { code: 'missing_required', pointer: rpt('/props/loadingText') });
rejectSeries('repeat-word-blank', 'A word is never blank.', REPEAT, [repeatOf([cell()], { staleText: '  ' })], { code: 'invalid_value', pointer: rpt('/props/staleText') });
rejectSeries('repeat-unknown-prop', 'A repeat has its own props only.', REPEAT, [repeatOf([cell()], { template: 'rows' })], { code: 'unknown_field', pointer: rpt('/props/template') });
rejectSeries('repeat-provider-read-by-a-node', 'A records flow is read through a repeat, never field by field: a read of it is invalid_reference.', ['repeat', 'pipeline'],
  [exprText('t', read('series', ['label']))], { code: 'invalid_reference', pointer: at(0, '/props/value/value/from/path') });
rejectSeries('repeat-rows-list-over-a-records-flow', 'A list of rows cannot show a records flow: binding_type at the provider.', ['repeat', 'pipeline', 'list-parts'],
  [node('list', 'row-collection', { props: { providerId: 'series', ...WORDS } })], { code: 'binding_type', pointer: at(0, '/props/providerId') });

// MARK: Records output (`sh.repeat@1`)
const recordsFlow = (over: J): J => series('series', over);
const recordsAt = (rest: string) => `/document/dataSources/${6}/inputs${rest}`;
const withOnly = (flow: J) => (envelope: J) => { envelope.document.dataSources.push(flow); };
const recordsSteps = SERIES_STEPS;
accept('pending-records-flow-alone', 'A records flow no node draws is still a flow: the output declares the id.', ['repeat', 'pipeline'], [], withOnly(series()));
accept('pending-records-max-hundred', 'A records output holds at most 100.', ['repeat', 'pipeline'], [], withOnly(recordsFlow({ output: { kind: 'records', max: 100 } })));
accept('pending-records-from-a-service', 'Records from a service answer: the steps give a list of objects whatever the request.', ['repeat', 'pipeline'], [], envelope => {
  const request = { type: 'service-response', domain: 'weather', service: 'get_forecasts', target: { entity_id: lit('weather.demo_home') }, data: { type: 'object', fields: { type: lit('hourly') } }, timeoutSeconds: 10,
    responseShape: objectOf({ forecast: arrayOf(objectOf({ datetime: { kind: 'string', format: 'date-time' }, temperature: { kind: 'number' } })) }) };
  const steps = [step('entries', 'get', { path: ['forecast'] }), step('cells', 'map', { fields: { at: item('datetime'), value: item('temperature') } })];
  envelope.document.dataSources.push(source('series', { title: 'Series', parameters: [], request, steps, output: { kind: 'records', max: 24 }, schema: { kind: 'array', of: { kind: 'object', fields: { at: { shape: { kind: 'string', format: 'date-time' } }, value: { shape: { kind: 'number' } } } } }, refresh: { on: ['open'], staleAfterSeconds: 300 } }));
});
accept('pending-records-of-whole-entries', 'The records may be the entries as they come: no map step is needed when the schema is the forecast entry itself.', ['repeat', 'pipeline'], [], withOnly(recordsFlow({
  steps: [step('entries', 'get', { path: ['forecast'] })], schema: schemaOf(forecast(), [step('entries', 'get', { path: ['forecast'] })]),
})));
accept('pending-records-index-in-a-step', 'index in a step is the position of the item in the list the step is looking at.', ['repeat', 'pipeline'], [], withOnly(series()));
reject('records-max-over-hundred', 'A records output holds at most 100.', ['repeat', 'pipeline'], [], { code: 'limit_exceeded', pointer: '/document/dataSources/5/inputs/output/max' }, withOnly(recordsFlow({ output: { kind: 'records', max: 101 } })));
reject('records-max-zero', 'And at least 1.', ['repeat', 'pipeline'], [], { code: 'limit_exceeded', pointer: '/document/dataSources/5/inputs/output/max' }, withOnly(recordsFlow({ output: { kind: 'records', max: 0 } })));
reject('records-max-missing', 'A records output says how many it gives.', ['repeat', 'pipeline'], [], { code: 'missing_required', pointer: '/document/dataSources/5/inputs/output/max' }, withOnly(recordsFlow({ output: { kind: 'records' } })));
reject('records-over-a-record', 'The steps give one record, not a list: binding_type at the output.', ['repeat', 'pipeline'], [], { code: 'binding_type', pointer: '/document/dataSources/5/inputs/output/kind' }, envelope => {
  const steps = [step('entries', 'get', { path: ['forecast'] }), step('now', 'first')];
  envelope.document.dataSources.push(source('series', { title: 'Series', parameters: [], request: forecast(), steps, output: { kind: 'records', max: 24 }, schema: schemaOf(forecast(), steps) }));
});
reject('records-of-numbers', 'A list of numbers is not a list of objects: binding_type at the output.', ['repeat', 'pipeline'], [], { code: 'binding_type', pointer: '/document/dataSources/5/inputs/output/kind' }, envelope => {
  const steps = [step('entries', 'get', { path: ['forecast'] }), step('values', 'map', { fields: { v: item('temperature') } })];
  const request = forecast();
  envelope.document.dataSources.push(source('series', { title: 'Series', parameters: [], request, steps: [...steps, step('one', 'first')], output: { kind: 'records', max: 24 }, schema: { kind: 'array', of: { kind: 'number' } } }));
});
reject('records-schema-is-not-a-list', 'The authored schema of a records flow is a list of objects: an object is invalid_combination.', ['repeat', 'pipeline'], [], { code: 'invalid_combination', pointer: '/document/dataSources/5/inputs/schema' },
  withOnly(recordsFlow({ schema: { kind: 'object', fields: { label: { shape: { kind: 'string' } } } } })));
reject('records-schema-of-text', 'A list of text is not a list of objects.', ['repeat', 'pipeline'], [], { code: 'invalid_combination', pointer: '/document/dataSources/5/inputs/schema' },
  withOnly(recordsFlow({ schema: { kind: 'array', of: { kind: 'string' } } })));
reject('records-schema-of-any', 'A list of anything says nothing the nodes can check against.', ['repeat', 'pipeline'], [], { code: 'invalid_combination', pointer: '/document/dataSources/5/inputs/schema' },
  withOnly(recordsFlow({ schema: { kind: 'array', of: { kind: 'any' } } })));
reject('records-schema-not-given', 'The steps do not give what the schema says: binding_type at the schema.', ['repeat', 'pipeline'], [], { code: 'binding_type', pointer: '/document/dataSources/5/inputs/schema' },
  withOnly(recordsFlow({ schema: { kind: 'array', of: { kind: 'object', fields: { label: { shape: { kind: 'string' } }, extra: { shape: { kind: 'string' } } } } } })));
reject('records-index-in-a-parameter', 'A parameter has no item: index there is invalid_combination.', ['repeat', 'pipeline'], [], { code: 'invalid_combination', pointer: '/document/dataSources/5/inputs/parameters/0/value' },
  withOnly(recordsFlow({ parameters: [{ name: 'p', type: 'number', value: index }] })));
reject('records-index-in-the-request', 'The request has no item either.', ['repeat', 'pipeline'], [], { code: 'invalid_combination', pointer: '/document/dataSources/5/inputs/request/value' },
  withOnly(recordsFlow({ request: { type: 'none', value: index }, steps: [], schema: { kind: 'number' }, output: { kind: 'scalar' } })));
void recordsAt; void recordsSteps;

// MARK: Template-owned flows (D2): a saved component carries the Data Flows its body reads
const OWNED = ['repeat', 'pipeline', 'component-ref'];
const LIB_AT = '/document/componentLibrary/0';
/** A saved component whose body is a repeat over its own flow `series`, with the entity of the flow a parameter `place`. */
const seriesEntry = (rest: J = {}, body: J = repeatOf([cell('cmp-cell')], { providerId: 'series' }, {}, 'cmp-items')): J => ({
  id: 'forecast-strip', name: 'Strip', node: body, params: [{ name: 'place', kind: 'entity-id', label: 'Place' }], flows: [seriesInputsSource('series')],
  bindings: [{ param: 'place', sourceId: 'series', field: 'inputs/request/entityId/value' }], ...rest,
});
function seriesInputsSource(id: string): J { return series(id); }
const use = (id: string, args: J = { place: 'weather.demo_home' }): J => ({ id, type: 'component-ref', componentId: 'forecast-strip', layout: { span: 1 }, args });
const withLibrary = (library: J[]) => (envelope: J) => { envelope.document.componentLibrary = library; };
accept('pending-owned-flow-one-use', 'A saved component owns the flow its repeat reads: each use gets its own copy, named <reference id>~series, and the repeat inside follows.', OWNED, [use('strip-a')], withLibrary([seriesEntry()]));
accept('pending-owned-flow-two-uses', 'Two uses own two flows (strip-a~series and strip-b~series), each filled by its own entity argument.', OWNED,
  [use('strip-a'), use('strip-b', { place: 'weather.demo_cabin' })], withLibrary([seriesEntry()]));
accept('pending-owned-flow-no-params', 'A saved component may own a flow with no parameter: every use reads the same entity through its own copy.', OWNED, [use('strip-a', {}), use('strip-b', {})],
  withLibrary([seriesEntry({ params: [], bindings: [] })]));
accept('pending-owned-flow-beside-a-document-flow', 'A flow of the document and the saved component\'s own flow of the same id do not clash: inside the body the owned one wins.', OWNED, [use('strip-a'), repeatOf([cell()], { providerId: 'series' }, {}, 'outside')],
  envelope => { envelope.document.dataSources.push(series()); envelope.document.componentLibrary = [seriesEntry()]; });
accept('pending-owned-flow-with-extras', 'The owned flow may use the extra steps: running-sum over its list.', [...OWNED, 'flow-extras'], [use('strip-a')], withLibrary([seriesEntry({
  flows: [series('series', { steps: [...SERIES_STEPS, step('total', 'running-sum', { value: item('value'), into: 'total', nullPropagates: true })],
    schema: schemaOf(forecast(), [...SERIES_STEPS, step('total', 'running-sum', { value: item('value'), into: 'total', nullPropagates: true })]) })],
})]));
reject('owned-flow-provider-missing', 'The repeat in the body names a flow the component does not own and the document does not have: invalid_reference.', OWNED, [use('strip-a')],
  { code: 'invalid_reference', pointer: `${LIB_AT}/node/props/providerId` }, withLibrary([seriesEntry({}, repeatOf([cell('cmp-cell')], { providerId: 'nowhere' }, {}, 'cmp-items'))]));
reject('owned-flow-not-a-flow', 'An item of flows is a flow: an entity source there is refused.', OWNED, [use('strip-a')],
  { code: 'unknown_field', pointer: `${LIB_AT}/flows/0/entityId` }, withLibrary([seriesEntry({ flows: [{ id: 'series', kind: 'entity', entityId: 'weather.demo_home' }] })]));
reject('owned-flow-duplicate-id', 'A component names each flow once.', OWNED, [use('strip-a')],
  { code: 'duplicate_id', pointer: `${LIB_AT}/flows/0/id` }, withLibrary([seriesEntry({ flows: [series('series'), series('series')] })]));
reject('owned-flow-over-eight', 'A component owns at most 8 flows.', OWNED, [use('strip-a')],
  { code: 'limit_exceeded', pointer: `${LIB_AT}/flows` }, withLibrary([seriesEntry({ flows: Array.from({ length: 9 }, (_, n) => series(`series-${n}`)) })]));
reject('owned-flow-binding-field-missing', 'A binding names a field the flow has.', OWNED, [use('strip-a')],
  { code: 'invalid_reference', pointer: `${LIB_AT}/bindings/0/field` }, withLibrary([seriesEntry({ bindings: [{ param: 'place', sourceId: 'series', field: 'request/nowhere' }] })]));
reject('owned-flow-binding-kind-mismatch', 'A text parameter cannot fill a flow\'s entity id.', OWNED, [use('strip-a', { place: 'x' })],
  { code: 'binding_type', pointer: `${LIB_AT}/bindings/0/field` }, withLibrary([seriesEntry({ params: [{ name: 'place', kind: 'text' }] })]));
reject('owned-flow-step-error', 'A fault inside an owned flow is reported at the flow of the component: an unknown step.', OWNED, [use('strip-a')],
  { code: 'unknown_variant', pointer: `${LIB_AT}/flows/0/inputs/steps/2/op` }, withLibrary([seriesEntry({ flows: [series('series', { steps: [GET_STEP, SERIES_STEPS[1], step('bad', 'sprout')], schema: { kind: 'array', of: { kind: 'object', fields: {} } } })] })]));
reject('owned-flow-item-outside-its-repeat', 'item in the body of a component, outside its repeat, is refused as anywhere else.', OWNED, [use('strip-a')],
  { code: 'invalid_combination', pointer: `${LIB_AT}/node/props/value/value` }, withLibrary([seriesEntry({}, exprText('cmp-text', item('label')))]));

// MARK: Flow extras (`sh.flow-extras@1`): the steps, the date styles and `progress`
const EXTRAS = ['flow-extras', 'pipeline'];
const GET: J = step('entries', 'get', { path: ['forecast'] });
/** A flow with the extra steps after `get`, a scalar or records output, and the schema the compiler's own typing gives. */
const extrasFlow = (steps: J[], output: J, over: J = {}): J => {
  const all = [GET, ...steps];
  return source('extras', { title: 'Extras', parameters: [], request: forecast(), steps: all, output, schema: schemaOf(forecast(), all), ...over });
};
const addFlow = (flow: J) => (envelope: J) => { envelope.document.dataSources.push(flow); };
const FLOW_AT = '/document/dataSources/5/inputs';
const ofRecords: J = { kind: 'records', max: 24 }, ofScalar: J = { kind: 'scalar' };
const temperature = item('temperature');
const AVERAGE = ['flow-average', 'pipeline'];
accept('flow-average-numbers', 'average takes the mean of the finite numbers in a list; gaps are skipped.', AVERAGE, [],
  addFlow(extrasFlow([step('mean', 'average', { value: temperature })], ofScalar)));
reject('flow-average-typed-text', 'average refuses a value typed as text, exactly as min and max do.', AVERAGE, [],
  { code: 'binding_type', pointer: `${FLOW_AT}/steps/1/value` },
  addFlow(extrasFlow([step('mean', 'average', { value: item('condition') })], ofScalar)));
reject('flow-average-missing-value', 'average requires its value operand.', AVERAGE, [],
  { code: 'missing_required', pointer: `${FLOW_AT}/steps/1/value` },
  addFlow(extrasFlow([step('mean', 'average')], ofScalar, { schema: { kind: 'number' } })));
reject('flow-average-extra-field', 'average has only id, op and value; it cannot round the answer.', AVERAGE, [],
  { code: 'unknown_field', pointer: `${FLOW_AT}/steps/1/round` },
  addFlow(extrasFlow([step('mean', 'average', { value: temperature, round: 2 })], ofScalar, { schema: { kind: 'number' } })));
wgFlowCases.push({
  name: 'flow-average-missing-capability', note: 'An average step requires sh.flow-average@1 in the publication manifest.',
  needs: AVERAGE, components: [], reject: true, tweak: addFlow(extrasFlow([step('mean', 'average', { value: temperature })], ofScalar)),
  finish: envelope => { envelope.capabilities = envelope.capabilities.filter((id: string) => id !== 'sh.flow-average@1'); },
  expect: { code: 'capability_manifest_mismatch', pointer: '/capabilities' },
});
accept('pending-flow-extras-min', 'min is the smallest number over the list: a number or null.', EXTRAS, [], addFlow(extrasFlow([step('low', 'min', { value: temperature })], ofScalar)));
accept('pending-flow-extras-max', 'max is the largest number over the list.', EXTRAS, [], addFlow(extrasFlow([step('high', 'max', { value: temperature })], ofScalar)));
accept('pending-flow-extras-min-of-a-computation', 'The value is any operand of the item: the smallest of a sum.', EXTRAS, [], addFlow(extrasFlow([step('low', 'min', { value: math('add', temperature, lit(1)) })], ofScalar)));
accept('pending-flow-extras-running-sum', 'running-sum writes the total so far into a field of each object, a gap making every later total null.', [...EXTRAS, 'repeat'], [], addFlow(extrasFlow(
  [step('total', 'running-sum', { value: item('precipitation'), into: 'total', nullPropagates: true })], ofRecords)));
accept('pending-flow-extras-running-sum-skips-gaps', 'With nullPropagates off a gap adds nothing.', [...EXTRAS, 'repeat'], [], addFlow(extrasFlow(
  [step('total', 'running-sum', { value: item('precipitation'), into: 'total', nullPropagates: false })], ofRecords)));
accept('pending-flow-extras-annotate', 'annotate writes list-wide minimum and maximum onto every item, so a map after it can share each item\'s range of the whole list.', [...EXTRAS, 'repeat'], [], addFlow(extrasFlow([
  step('range', 'annotate', { fields: { lowest: { aggregate: 'min', value: item('temperature') }, highest: { aggregate: 'max', value: item('temperature') } } }),
  step('rails', 'map', { fields: { start: math('subtract', item('temperature'), item('lowest')), span: math('subtract', item('highest'), item('lowest')) } }),
], ofRecords)));
accept('pending-flow-extras-index-label', 'index in a step makes the first item read Now: a rule over the position.', ['flow-extras', 'pipeline', 'repeat'], [], addFlow(extrasFlow([
  step('labels', 'map', { fields: { label: choose([[cmp('eq', index, lit(0)), lit('Now')]], fmt('{n}h', { n: index })) } }),
], ofRecords)));
const dateText = (id: string, style: string): J => exprText(id, fmt('{d}', { d: lit('2026-11-12T19:05:00') }, { d: { date: { style } } }));
accept('pending-flow-extras-date-hour', 'The date style hour: the 12-hour clock\'s hour, 7 PM.', ['flow-extras'], [dateText('t', 'hour')]);
accept('pending-flow-extras-date-weekday', 'The date style weekday: the short name, Thu.', ['flow-extras'], [dateText('t', 'weekday')]);
accept('pending-flow-extras-date-progress', 'progress is how far the clock has come between two moments, 0 to 1: the daylight of a sunrise and a sunset.', ['flow-extras'],
  [exprText('t', { type: 'date', op: 'progress', from: lit('2026-11-15T06:00:00'), to: lit('2026-11-15T16:00:00') })]);
accept('pending-flow-extras-progress-of-reads', 'A moment may be read from a source as well as written.', ['flow-extras'],
  [exprText('t', { type: 'date', op: 'progress', from: read('guest-fan', ['state']), to: lit('2026-11-15T16:00:00') })]);
const stepOf = (extra: J) => (envelope: J) => addFlow(extrasFlow([extra], ofScalar, { schema: { kind: 'number' } }))(envelope);
const badStep = (name: string, note: string, extra: J, expect: WgFlowCase['expect'], output: J = ofScalar, over: J = {}) =>
  reject(name, note, EXTRAS, [], expect, addFlow(extrasFlow([extra], output, over)));
badStep('flow-extras-min-of-text', 'min over text is not a number: binding_type at the value.', step('low', 'min', { value: item('condition') }), { code: 'binding_type', pointer: `${FLOW_AT}/steps/1/value` });
badStep('flow-extras-min-without-a-value', 'min needs a value.', step('low', 'min'), { code: 'missing_required', pointer: `${FLOW_AT}/steps/1/value` });
badStep('flow-extras-min-extra-field', 'min has a value and nothing else.', step('low', 'min', { value: temperature, into: 'x' }), { code: 'unknown_field', pointer: `${FLOW_AT}/steps/1/into` });
reject('flow-extras-max-of-a-record', 'max reads a list: the steps before give one record.', EXTRAS, [], { code: 'binding_type', pointer: `${FLOW_AT}/steps/2/op` },
  addFlow(extrasFlow([step('now', 'first'), step('high', 'max', { value: temperature })], ofScalar, { schema: { kind: 'number' } })));
badStep('flow-extras-running-sum-without-null-propagates', 'Whether a gap ends the total is always authored.', step('total', 'running-sum', { value: item('precipitation'), into: 'total' }),
  { code: 'missing_required', pointer: `${FLOW_AT}/steps/1/nullPropagates` }, ofRecords);
badStep('flow-extras-running-sum-bad-into', 'The field written is a plain name.', step('total', 'running-sum', { value: item('precipitation'), into: 'bad name', nullPropagates: true }),
  { code: 'invalid_value', pointer: `${FLOW_AT}/steps/1/into` }, ofRecords, { schema: { kind: 'array', of: { kind: 'object', fields: {} } } });
badStep('flow-extras-running-sum-of-text', 'The value to add up is a number: text is binding_type.', step('total', 'running-sum', { value: item('condition'), into: 'total', nullPropagates: true }),
  { code: 'binding_type', pointer: `${FLOW_AT}/steps/1/value` }, ofRecords);
reject('flow-extras-running-sum-of-scalars', 'running-sum writes a field onto objects: a list of numbers is binding_type.', EXTRAS, [], { code: 'binding_type', pointer: `${FLOW_AT}/steps/0/op` },
  addFlow(source('extras', { title: 'Extras', parameters: [], request: { type: 'entity-attribute', entityId: lit('sensor.demo_case'), path: ['values'], responseShape: arrayOf({ kind: 'number' }) },
    steps: [step('total', 'running-sum', { value: lit(1), into: 'total', nullPropagates: true })], output: ofRecords, schema: { kind: 'array', of: { kind: 'object', fields: {} } }, refresh: { on: ['open'], staleAfterSeconds: 300 } })));
badStep('flow-extras-annotate-empty', 'annotate writes at least one field.', step('range', 'annotate', { fields: {} }), { code: 'limit_exceeded', pointer: `${FLOW_AT}/steps/1/fields` }, ofRecords);
badStep('flow-extras-annotate-unknown-aggregate', 'The aggregates are min and max.', step('range', 'annotate', { fields: { lowest: { aggregate: 'mean', value: temperature } } }),
  { code: 'unknown_variant', pointer: `${FLOW_AT}/steps/1/fields/lowest/aggregate` }, ofRecords);
badStep('flow-extras-annotate-bad-name', 'The name of a field is a plain name.', step('range', 'annotate', { fields: { 'bad name': { aggregate: 'min', value: temperature } } }),
  { code: 'invalid_value', pointer: `${FLOW_AT}/steps/1/fields/bad name` }, ofRecords);
badStep('flow-extras-annotate-extra-key', 'An annotated field has an aggregate and a value only.', step('range', 'annotate', { fields: { lowest: { aggregate: 'min', value: temperature, of: 'x' } } }),
  { code: 'unknown_field', pointer: `${FLOW_AT}/steps/1/fields/lowest/of` }, ofRecords);
reject('flow-extras-date-hour-over-a-number', 'The hour style needs a date: a number is binding_type.', EXTRAS, [], { code: 'binding_type', pointer: at(0, '/props/value/value/formats/d') },
  envelope => { envelope.document.pages[2].components = [exprText('t', fmt('{d}', { d: lit(7) }, { d: { date: { style: 'hour' } } }))]; });
reject('flow-extras-date-unknown-style', 'The date styles are a fixed set.', EXTRAS, [], { code: 'unknown_variant', pointer: at(0, '/props/value/value/formats/d') },
  envelope => { envelope.document.pages[2].components = [exprText('t', fmt('{d}', { d: lit('2026-11-12') }, { d: { date: { style: 'fortnight' } } }))]; });
reject('flow-extras-progress-without-to', 'progress needs both moments.', EXTRAS, [], { code: 'missing_required', pointer: at(0, '/props/value/value/to') },
  envelope => { envelope.document.pages[2].components = [exprText('t', { type: 'date', op: 'progress', from: lit('2026-11-15T06:00:00') })]; });
reject('flow-extras-date-unknown-operation', 'The operations of a date operand are days-between and progress.', EXTRAS, [], { code: 'unknown_variant', pointer: at(0, '/props/value/value/op') },
  envelope => { envelope.document.pages[2].components = [exprText('t', { type: 'date', op: 'regress', from: lit('2026-11-15'), to: lit('2026-11-16') })]; });

// MARK: Evaluation: `index`, the `hour` and `weekday` date styles and the `progress` operation
export const wgFlowEvaluations: WgFlowEvaluation[] = [];
const value = (v: unknown): J => ({ status: 'value', value: v });
const UNAVAILABLE: J = { status: 'unavailable' };
const operand = (name: string, note: string, subject: J, expected: J, env: J = {}) => wgFlowEvaluations.push({ name, note, subject: { operand: subject }, env, expected });
const dateAt = (text: unknown, style: string): J => fmt('{d}', { d: lit(text) }, { d: { date: { style } } });
/** The clock the date cases share: 9:30 AM on Sunday 15 November 2026 at -08:00 (the weekday of that date is Sunday). */
const CLOCK = { now: '2026-11-15T09:30:00', utcOffsetMinutes: -480 };
const dated = { locale: 'en_US', clock: CLOCK };
const hourCase = (name: string, note: string, text: unknown, expected: J) => operand(name, note, dateAt(text, 'hour'), expected, dated);
// `WeatherDates.hour` (`apple/Sources/HassCore/Weather/WeatherDates.swift:55-59`): the 12-hour clock's hour and AM or PM, no minutes.
hourCase('date-hour-evening', 'Seven in the evening is 7 PM, and the minutes are not shown (WeatherDates.swift:55-59).', '2026-11-12T19:05:00', value('7 PM'));
hourCase('date-hour-morning', 'Seven in the morning is 7 AM.', '2026-11-12T07:00:00', value('7 AM'));
hourCase('date-hour-midnight', 'Hour 0 is 12 AM (WeatherDates.swift:68, hour % 12 == 0 gives 12).', '2026-11-12T00:00:00', value('12 AM'));
hourCase('date-hour-noon', 'Hour 12 is 12 PM.', '2026-11-12T12:30:00', value('12 PM'));
hourCase('date-hour-last-of-the-day', 'Hour 23 is 11 PM.', '2026-11-12T23:59:00', value('11 PM'));
hourCase('date-hour-moved-to-clock-zone', 'A time with an offset is moved to the clock\'s zone: 03:41 UTC is 7:41 PM at -08:00, shown 7 PM.', '2026-11-13T03:41:00Z', value('7 PM'));
hourCase('date-hour-of-a-date', 'A date with no time is the start of its day: 12 AM.', '2026-11-12', value('12 AM'));
hourCase('date-hour-invalid', 'Text that is not a date is unavailable.', 'later', UNAVAILABLE);
operand('date-hour-number-argument', 'A number is not a date: unavailable.', fmt('{d}', { d: lit(7) }, { d: { date: { style: 'hour' } } }), UNAVAILABLE, dated);
operand('date-hour-without-clock', 'A time with no offset needs no clock: the hour is read as written.', dateAt('2026-11-12T19:05:00', 'hour'), value('7 PM'), { locale: 'en_US' });
// `WeatherDates.weekday` (`WeatherDates.swift:61-66`): the short name, Sun first.
const weekdayCase = (name: string, note: string, text: unknown, expected: J) => operand(name, note, dateAt(text, 'weekday'), expected, dated);
weekdayCase('date-weekday-sunday', '15 November 2026 is a Sunday (WeatherDates.swift:61-66, names start at Sun).', '2026-11-15T10:00:00', value('Sun'));
weekdayCase('date-weekday-monday', 'The next day is Mon.', '2026-11-16T10:00:00', value('Mon'));
weekdayCase('date-weekday-saturday-of-a-date', 'A date with no time: 14 November is Sat.', '2026-11-14', value('Sat'));
weekdayCase('date-weekday-thursday', '12 November is Thu.', '2026-11-12T12:00:00', value('Thu'));
weekdayCase('date-weekday-moved-to-clock-zone', 'The weekday is the clock zone\'s: 03:41 UTC on Friday 13 is still Thu at -08:00.', '2026-11-13T03:41:00Z', value('Thu'));
weekdayCase('date-weekday-invalid', 'Text that is not a date is unavailable.', 'soon', UNAVAILABLE);
operand('date-weekday-number-argument', 'A number is not a date: unavailable.', fmt('{d}', { d: lit(3) }, { d: { date: { style: 'weekday' } } }), UNAVAILABLE, dated);
// `progress` follows `WeatherPresentation.sun` (`WeatherPresentation.swift:255-263`): the clock's place between two moments, from 0 to 1.
const progress = (from: unknown, to: unknown): J => ({ type: 'date', op: 'progress', from: lit(from), to: lit(to) });
const at0830 = { clock: { now: '2026-11-15T08:30:00', utcOffsetMinutes: -480 } };
operand('date-progress-quarter', 'At 8:30 AM, a quarter of the way from 6 AM to 4 PM (2.5 of 10 hours).', progress('2026-11-15T06:00:00', '2026-11-15T16:00:00'), value(0.25), at0830);
operand('date-progress-before-the-start', 'Before the first moment it is 0, never negative (clampPercent).', progress('2026-11-15T09:00:00', '2026-11-15T16:00:00'), value(0), at0830);
operand('date-progress-after-the-end', 'After the last moment it is 1.', progress('2026-11-14T06:00:00', '2026-11-15T08:00:00'), value(1), at0830);
operand('date-progress-offsets-moved-to-clock-zone', 'Moments with offsets are moved to the clock\'s zone: 14:00 UTC to 00:00 UTC is 6 AM to 4 PM at -08:00.', progress('2026-11-15T14:00:00Z', '2026-11-16T00:00:00Z'), value(0.25), at0830);
operand('date-progress-across-a-day', 'The sun case: from the last sunrise to the next sunset, 34 hours; the clock at 11:30 PM is 17 hours in, half way.', progress('2026-11-14T06:30:00', '2026-11-15T16:30:00'), value(0.5), { clock: { now: '2026-11-14T23:30:00', utcOffsetMinutes: -480 } });
operand('date-progress-of-dates', 'Two dates with no time are each the start of their day: noon is half way through the day.', progress('2026-11-15', '2026-11-16'), value(0.5), { clock: { now: '2026-11-15T12:00:00', utcOffsetMinutes: -480 } });
operand('date-progress-equal-moments', 'No span to measure (duration is not above 0): unavailable (WeatherPresentation.swift:259).', progress('2026-11-15T06:00:00', '2026-11-15T06:00:00'), UNAVAILABLE, at0830);
operand('date-progress-reversed-moments', 'The end before the start: unavailable.', progress('2026-11-15T16:00:00', '2026-11-15T06:00:00'), UNAVAILABLE, at0830);
operand('date-progress-invalid-date', 'A moment that is not a date: unavailable.', progress('later', '2026-11-15T16:00:00'), UNAVAILABLE, at0830);
operand('date-progress-without-clock', 'Without a clock there is no now: unavailable.', progress('2026-11-15T06:00:00', '2026-11-15T16:00:00'), UNAVAILABLE);
operand('date-progress-number-argument', 'A number is not a moment: unavailable.', { type: 'date', op: 'progress', from: lit(1), to: lit('2026-11-15T16:00:00') }, UNAVAILABLE, at0830);
// `index` is the position of the item, from 0 (`WeatherFormat.hourLabel`'s `index == 0` is the first cell).
operand('index-in-a-cell', 'index is the position of the cell, counted from 0.', index, value(3), { item: { a: 1 }, index: 3 });
operand('index-first', 'The first cell is 0.', index, value(0), { item: { a: 1 }, index: 0 });
operand('index-add-one', 'A cell numbered from 1.', math('add', index, lit(1)), value(4), { item: { a: 1 }, index: 3 });
operand('index-without-position', 'Outside a repeat or a step there is no position: unavailable.', index, UNAVAILABLE);
operand('index-with-item', 'index and item together: the position plus a field of the record.', math('add', index, item('v')), value(5), { item: { v: 2 }, index: 3 });
operand('index-in-a-rule', 'The first cell says Now (WeatherFormat.hourLabel, `if index == 0 { return "Now" }`, WeatherFormat.swift:89).', choose([[cmp('eq', index, lit(0)), lit('Now')]], lit('Later')), value('Now'), { item: {}, index: 0 });
operand('index-in-a-rule-later', 'Any other cell takes the rule\'s otherwise.', choose([[cmp('eq', index, lit(0)), lit('Now')]], lit('Later')), value('Later'), { item: {}, index: 5 });

// MARK: Evaluation: the steps of `sh.flow-extras@1` and the `records` output, over data and expected answers worked out by hand
export const wgFlowPipelines: WgFlowPipeline[] = [];
const entityRequest = (response: unknown): J => ({ type: 'entity-attribute', entityId: lit('sensor.demo_case'), path: ['value'], responseShape: inferShapeFromSamples([response as any]) });
const pipe = (name: string, note: string, response: unknown, steps: J[], output: J, expected: unknown, parameters: J[] = [], sample: unknown = response) => {
  const request = entityRequest(sample);
  const shapes = typeSteps(steps as any, (request as any).responseShape, new Map(parameters.map(entry => [entry.name, entry.type])), '', newFacts());
  const final = shapes.length ? shapes[shapes.length - 1] : (request as any).responseShape;
  wgFlowPipelines.push({
    name, note, response, compiles: true, context: { clock: { now: '2026-11-15T09:30:00', utcOffsetMinutes: -480 } },
    inputs: { title: 'Case', parameters, request, steps, output, schema: final.kind === 'any' ? final : withoutNull(final), refresh: { on: ['open'], staleAfterSeconds: 300 } },
    expected: { status: 'ok', output: expected },
  });
};
const scalarOut: J = { kind: 'scalar' };
const recordsOut = (max = 24): J => ({ kind: 'records', max });
const temps = [{ t: 3 }, { t: null }, { t: -2 }, { t: 9 }];
const averageStep = [step('mean', 'average', { value: item('t') })];
pipe('flow-average-mixed', 'Only numbers count: 2 and 6 give 4; null, numeric text, booleans and records are skipped.',
  [{ t: 2 }, { t: null }, { t: '10' }, { t: 6 }, { t: true }, { t: {} }], averageStep, scalarOut, 4);
pipe('flow-average-all-non-numbers', 'No numeric parts means null, not zero; numeric text is not a number.',
  [{ t: null }, { t: '10' }, { t: false }, { t: [] }], averageStep, scalarOut, null, [], temps);
pipe('flow-average-empty', 'An empty list has no mean.', [], averageStep, scalarOut, null, [], temps);
pipe('flow-average-unrounded', 'The mean is not rounded: 1, 2 and 2 give 1.6666666666666667.', [{ t: 1 }, { t: 2 }, { t: 2 }], averageStep, scalarOut, 1.6666666666666667);
pipe('flow-average-negative', 'Negative and positive values share the same mean: -4 and 1 give -1.5.', [{ t: -4 }, { t: 1 }], averageStep, scalarOut, -1.5);
// `peakChance` (`WeatherPrecipitationTimeline.swift:30-32`): the highest known chance, nil when none is known; the same shape as min and max.
pipe('min-of-a-list', 'min is the smallest number over the list; a null is skipped.', temps, [step('low', 'min', { value: item('t') })], scalarOut, -2);
pipe('max-of-a-list', 'max is the largest number over the list; a null is skipped.', temps, [step('high', 'max', { value: item('t') })], scalarOut, 9);
pipe('max-peak-chance', 'The peak chance of an hourly window: the highest known value, 80 (WeatherPrecipitationTimeline.swift:30-32).', [{ p: 10 }, { p: null }, { p: 80 }, { p: 35 }],
  [step('peak', 'max', { value: item('p') })], scalarOut, 80);
pipe('max-peak-chance-none-known', 'When no chance is known the peak is null, not 0 (compactMap().max() is nil, WeatherPrecipitationTimeline.swift:31).', [{ p: null }, { p: null }],
  [step('peak', 'max', { value: item('p') })], scalarOut, null);
pipe('min-of-an-empty-list', 'The smallest of nothing is null.', [] as unknown[], [step('low', 'min', { value: item('t') })], scalarOut, null, [], temps);
pipe('min-of-a-single-value', 'One value is its own smallest.', [{ t: 4.5 }], [step('low', 'min', { value: item('t') })], scalarOut, 4.5);
pipe('min-negative-zero', 'A zero is zero, never -0.', [{ t: 0 }, { t: 2 }], [step('low', 'min', { value: item('t') })], scalarOut, 0);
pipe('min-of-a-computed-value', 'The value is any operand of the item: the smallest of high minus low.', [{ lo: 10, hi: 14 }, { lo: 5, hi: 6 }], [step('span', 'min', { value: math('subtract', item('hi'), item('lo')) })], scalarOut, 1);
// `WeatherPrecipitationTimeline.points` (`WeatherPrecipitationTimeline.swift:14-19`): the running total goes nil for good once an hour is nil; negatives clamp to 0.
const amounts = [{ a: 0.5 }, { a: 0.25 }, { a: null }, { a: 1 }];
const total = (propagates: boolean, value: J = item('a')): J => step('total', 'running-sum', { value, into: 'total', nullPropagates: propagates });
pipe('running-sum-propagates-a-gap', 'Hours of 0.5, 0.25, unknown, 1: the total is 0.5, 0.75, then unknown for the rest of the window (WeatherPrecipitationTimeline.swift:18, `cumulative = nil`).', amounts,
  [total(true)], recordsOut(), [{ a: 0.5, total: 0.5 }, { a: 0.25, total: 0.75 }, { a: null, total: null }, { a: 1, total: null }]);
pipe('running-sum-skips-a-gap', 'With nullPropagates off, an unknown hour adds nothing and the total goes on: 0.5, 0.75, 0.75, 1.75.', amounts,
  [total(false)], recordsOut(), [{ a: 0.5, total: 0.5 }, { a: 0.25, total: 0.75 }, { a: null, total: 0.75 }, { a: 1, total: 1.75 }]);
pipe('running-sum-negative-clamped', 'A negative amount counts as 0 when the value is written max(0, amount) (WeatherPrecipitationTimeline.swift:17).', [{ a: -1 }, { a: 2 }, { a: -0.5 }],
  [total(true, math('max', lit(0), item('a')))], recordsOut(), [{ a: -1, total: 0 }, { a: 2, total: 2 }, { a: -0.5, total: 2 }]);
pipe('running-sum-of-an-empty-list', 'No hours, no records.', [] as unknown[], [total(true)], recordsOut(), [], [], amounts);
pipe('running-sum-first-hour-unknown', 'A window whose first hour is unknown never has a total.', [{ a: null }, { a: 1 }], [total(true)], recordsOut(), [{ a: null, total: null }, { a: 1, total: null }]);
pipe('running-sum-of-a-text-amount', 'An amount that is text is not a number: it is a gap.', [{ a: 1 }, { a: 'x' }, { a: 2 }], [total(false)], recordsOut(),
  [{ a: 1, total: 1 }, { a: 'x', total: 1 }, { a: 2, total: 3 }]);
// `WeatherRails.week` (`WeatherRails.swift:7-25`): each day's span as a share of the week's, from the lowest low to the highest high.
const week = [{ lo: 50, hi: 70 }, { lo: 40, hi: 60 }, { lo: 60, hi: 80 }, { lo: null, hi: null }, { lo: 45, hi: 70 }];
const weekSteps = (fields: J): J[] => [
  step('range', 'annotate', { fields: { minLow: { aggregate: 'min', value: item('lo') }, maxHigh: { aggregate: 'max', value: item('hi') } } }),
  step('rails', 'map', { fields }),
];
const spanOf = (): J => math('subtract', item('maxHigh'), item('minLow'));
const percent = (numerator: J): J => math('clamp', math('multiply', math('divide', numerator, spanOf()), lit(100)), lit(0), lit(100));
pipe('annotate-week-rail', 'The week spans 40 to 80. Each day is its low and its length as a share of those 40 degrees: 25 and 50, 0 and 50, 50 and 50, no day, 12.5 and 62.5 (WeatherRails.swift:19-23).', week,
  weekSteps({ start: percent(math('subtract', item('lo'), item('minLow'))), size: percent(math('subtract', item('hi'), item('lo'))) }), recordsOut(7),
  [{ start: 25, size: 50 }, { start: 0, size: 50 }, { start: 50, size: 50 }, { start: null, size: null }, { start: 12.5, size: 62.5 }]);
pipe('annotate-writes-the-same-value-on-every-item', 'annotate writes one list-wide value on every item: the lowest low and highest high, read back by a later map.', week,
  weekSteps({ minLow: item('minLow'), maxHigh: item('maxHigh') }), recordsOut(7),
  Array.from({ length: 5 }, () => ({ minLow: 40, maxHigh: 80 })));
pipe('annotate-keeps-the-item-fields', 'Without a map the item keeps its own fields and gains the annotated ones.', [{ lo: 1, hi: 5 }, { lo: 3, hi: 9 }],
  [step('range', 'annotate', { fields: { top: { aggregate: 'max', value: item('hi') } } })], recordsOut(), [{ lo: 1, hi: 5, top: 9 }, { lo: 3, hi: 9, top: 9 }]);
pipe('annotate-two-aggregates', 'More than one field: the lowest low and the highest high.', [{ lo: 1, hi: 5 }, { lo: 3, hi: 9 }],
  [step('range', 'annotate', { fields: { bottom: { aggregate: 'min', value: item('lo') }, top: { aggregate: 'max', value: item('hi') } } })], recordsOut(),
  [{ lo: 1, hi: 5, bottom: 1, top: 9 }, { lo: 3, hi: 9, bottom: 1, top: 9 }]);
pipe('annotate-no-numbers', 'When no day has a number the aggregate is null on every item.', [{ lo: null }, { lo: null }],
  [step('range', 'annotate', { fields: { bottom: { aggregate: 'min', value: item('lo') } } })], recordsOut(), [{ lo: null, bottom: null }, { lo: null, bottom: null }]);
pipe('annotate-flat-week', 'A week with no spread (every day 60 to 60): the share is the rule\'s own, start 50 and size 0 (WeatherRails.swift:15-17).', [{ lo: 60, hi: 60 }, { lo: 60, hi: 60 }],
  weekSteps({ start: choose([[cmp('eq', spanOf(), lit(0)), lit(50)]], percent(math('subtract', item('lo'), item('minLow')))), size: choose([[cmp('eq', spanOf(), lit(0)), lit(0)]], percent(math('subtract', item('hi'), item('lo')))) }),
  recordsOut(7), [{ start: 50, size: 0 }, { start: 50, size: 0 }]);
// `index` in a step: the hour and day labels of the hand-coded forecast (`WeatherFormat.swift:81-92`).
const hourLabel: J = choose([[cmp('eq', index, lit(0)), lit('Now')], [{ type: 'exists', value: item('at') }, fmt('{d}', { d: item('at') }, { d: { date: { style: 'hour' } } })]], fmt('{n}h', { n: index }));
const dayLabel: J = choose([[cmp('eq', index, lit(0)), lit('Today')], [{ type: 'exists', value: item('at') }, fmt('{d}', { d: item('at') }, { d: { date: { style: 'weekday' } } })]], fmt('Day {n}', { n: math('add', index, lit(1)) }));
const hours = [{ at: '2026-11-12T18:00:00' }, { at: '2026-11-12T20:00:00' }, { at: null }, { at: '2026-11-13T00:00:00' }, { at: '2026-11-13T12:00:00' }];
pipe('index-hour-label', 'The first hour reads Now; the others their hour, 8 PM and 12 AM and 12 PM; one with no time reads its position and h (WeatherFormat.swift:88-92).', hours,
  [step('labels', 'map', { fields: { label: hourLabel } })], recordsOut(), [{ label: 'Now' }, { label: '8 PM' }, { label: '2h' }, { label: '12 AM' }, { label: '12 PM' }]);
pipe('index-day-label', 'The first day reads Today, the others their weekday; a day with no date reads Day and its number (WeatherFormat.swift:81-85).',
  [{ at: '2026-11-15T00:00:00' }, { at: '2026-11-16T00:00:00' }, { at: null }, { at: '2026-11-18T00:00:00' }],
  [step('labels', 'map', { fields: { label: dayLabel } })], recordsOut(7), [{ label: 'Today' }, { label: 'Mon' }, { label: 'Day 3' }, { label: 'Wed' }]);
pipe('index-in-a-filter', 'index in a filter is the position in the list the filter is looking at: the first two items are kept.', [{ v: 'a' }, { v: 'b' }, { v: 'c' }],
  [step('first', 'filter', { where: cmp('below', index, lit(2)) })], recordsOut(), [{ v: 'a' }, { v: 'b' }]);
pipe('index-after-a-filter', 'Positions are those of the list a step looks at: after a filter drops the first item, the next map counts the kept items from 0.', [{ v: 'a' }, { v: 'b' }, { v: 'c' }],
  [step('later', 'filter', { where: cmp('above', index, lit(0)) }), step('pos', 'map', { fields: { v: item('v'), at: index } })], recordsOut(), [{ v: 'b', at: 0 }, { v: 'c', at: 1 }]);
// The records output: the objects of the final list, at most `max`, in order.
pipe('records-limited-by-max', 'A records output keeps the first max items.', [{ v: 1 }, { v: 2 }, { v: 3 }], [], recordsOut(2), [{ v: 1 }, { v: 2 }]);
pipe('records-in-order', 'The records are in the order of the list.', [{ v: 3 }, { v: 1 }, { v: 2 }], [], recordsOut(), [{ v: 3 }, { v: 1 }, { v: 2 }]);
pipe('records-empty', 'An empty list gives no records, not an error.', [] as unknown[], [], recordsOut(), [], [], [{ v: 1 }]);
pipe('records-nulls-kept', 'A field that is null stays null in the record: the nodes draw a gap.', [{ v: null, w: 1 }], [], recordsOut(), [{ v: null, w: 1 }]);
