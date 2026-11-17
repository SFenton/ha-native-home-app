/**
 * The corpus cases of the two ids the weather-gen lane WG-S3 adds, all generic (nothing here is named for a card): `sh.chart@1` (the `chart` node: bar, line
 * and area marks, a literal or a source series, three kinds of domain, an axis and thinned labels, a spoken series) and `sh.linear-gauge@1` (the
 * `linear-gauge` node: a track, an optional span and marker, a gradient). Demo ids only.
 *
 * `generate-expression-corpus.ts` writes them with its own, so one generator owns `contract/corpus/evaluation`. Publication cases are `pending-<family>-*`
 * (the Studio compiles them) and `<family>-*` (the Studio refuses them); every refusal records the Studio's first issue here by hand in `expect`, and the
 * generator fails when the compiler disagrees. The evaluation cases are written by hand from the native tests' own numbers, never computed by the module
 * under test: `chart-*` from `WeatherChartMathTests.swift` and `gauge-*` from `WeatherHighlightsTests.swift` (rails), each case citing its source line.
 */
import { newFacts, requestShape, typeSteps, withoutNull } from '../src/shared/composition/pipeline';

type J = Record<string, any>;

export interface WgChartCase {
  name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean;
  /** The Studio's first issue, written by hand: a reject must give exactly this. */
  expect?: { code: string; pointer: string };
}
export interface WgChartEvaluation { name: string; note: string; subject: J; env: J; expected: J }
/** The families this module owns: `reject/pending-<family>-*` and `reject/<family>-*`. */
export const wgChartFamilies = ['chart', 'linear-gauge'];
/** Capability ids by the short names the cases use. */
export const wgChartNeeds: Record<string, string> = { repeat: 'sh.repeat@1', chart: 'sh.chart@1', 'linear-gauge': 'sh.linear-gauge@1', 'text-style': 'sh.text-style@1', 'solid-appearance': 'sh.solid-appearance@1', rules: 'sh.rules@1', bindings: 'sh.bindings@1' };

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const rgba = (red: number, green: number, blue: number, alpha: number): J => ({ type: 'rgba', red, green, blue, alpha });
const pair = (light: J, dark: J): J => ({ type: 'solid-appearance', light, dark });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const points = (...values: (number | null)[]): J => ({ type: 'literal', points: values.map((value, index) => ({ label: `P${index + 1}`, value })) });
const label = (value = 'Series'): J => ({ label: lit(value) });
const blue = solid(64, 160, 255);
/** A value with its undefined fields dropped, as the file will hold it: a field written `undefined` here is one a case leaves out. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const chartOf = (props: J = {}, rest: J = {}, id = 'c'): J => plain(node(id, 'chart', {
  props: { mark: 'bar', series: points(10, 40, 20), domain: { type: 'ceiling', step: 10, min: 10, max: 100 }, tint: blue, emptyText: 'Unavailable', ...props }, a11y: label(), ...rest,
}));
const gaugeOf = (props: J = {}, rest: J = {}, id = 'g'): J => plain(node(id, 'linear-gauge', {
  props: { value: lit(0.5), fill: 'scale', stops: [{ at: 0, ink: solid(0, 200, 120) }, { at: 1, ink: solid(240, 80, 60) }], track: rgba(255, 255, 255, 0.22),
    marker: { size: 12, ink: solid(255, 255, 255) }, ...props }, a11y: { element: 'hidden' }, ...rest,
}));
/** A rows flow: a chart does not read it, for a rows flow does not give records, so a source series naming it is refused. */
const flow: J = {
  id: 'series-flow', kind: 'model', model: 'pipeline@1',
  inputs: {
    title: 'Series', parameters: [], request: { type: 'ha-subscription', kind: 'weather-forecast', entityId: lit('weather.demo_home'), forecastType: 'hourly' },
    steps: [{ id: 'all', op: 'get', path: ['forecast'] }, { id: 'few', op: 'limit', count: 6 }, { id: 'shape', op: 'map', fields: { id: { type: 'item', path: ['datetime'] }, level: { type: 'item', path: ['temperature'] } } }],
    output: { kind: 'rows', max: 6, row: { id: { type: 'item', path: ['id'] }, title: { type: 'item', path: ['id'] } } },
    schema: { kind: 'array', of: { kind: 'object', fields: { id: { shape: { kind: 'string', format: 'date-time' } }, level: { shape: { kind: 'union', of: [{ kind: 'null' }, { kind: 'number' }] } } } } },
  },
};
const withFlow = (envelope: J) => { envelope.document.dataSources.push(structuredClone(flow)); };

export const wgChartCases: WgChartCase[] = [];
const accept = (name: string, note: string, needs: string[], components: J[], tweak?: WgChartCase['tweak']) => wgChartCases.push({ name, note, needs, components, tweak, reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], expect: WgChartCase['expect'], tweak?: WgChartCase['tweak']) =>
  wgChartCases.push({ name, note, needs, components, tweak, reject: true, expect });
const at = (index: number, rest: string) => `/document/pages/2/components/${index}${rest}`;
const sourceSeries = (rest: J = {}): J => ({ type: 'source', providerId: 'series-flow', limit: 6, x: label('Hour'), y: { type: 'item', path: ['level'] }, ...rest });


// MARK: A chart over records (`sh.chart@1` with `sh.repeat@1`, the WG-S2 seam)
/** The flow a chart reads: a records flow, the first six hours of a forecast as a text (`label`) and a number (`level`, null where unknown). */
const recordSteps: J[] = [
  { id: 'all', op: 'get', path: ['forecast'] }, { id: 'few', op: 'limit', count: 6 },
  { id: 'shape', op: 'map', fields: { label: { type: 'item', path: ['condition'] }, level: { type: 'item', path: ['temperature'] } } },
];
const recordRequest: J = { type: 'ha-subscription', kind: 'weather-forecast', entityId: lit('weather.demo_home'), forecastType: 'hourly' };
const recordsFlow: J = {
  id: 'records-flow', kind: 'model', model: 'pipeline@1',
  inputs: {
    title: 'Records', parameters: [], request: recordRequest, steps: recordSteps, output: { kind: 'records', max: 6 },
    schema: withoutNull(typeSteps(recordSteps as never, requestShape(recordRequest as never), new Map(), '', newFacts()).at(-1)!),
  },
};
const withRecords = (envelope: J) => { envelope.document.dataSources.push(structuredClone(recordsFlow)); };
const fromRecords = (rest: J = {}): J => ({ type: 'source', providerId: 'records-flow', limit: 6, x: { label: { type: 'item', path: ['label'] } }, y: { type: 'item', path: ['level'] }, ...rest });
/** A repeat over the records flow whose one child is `cell`. */
const repeatOf = (children: J[], props: J = {}): J => node('rep', 'repeat', {
  props: { providerId: 'records-flow', axis: 'vertical', spacing: { type: 'token', name: 's' }, loadingText: 'Loading', emptyText: 'Nothing here', unavailableText: 'Unavailable', errorText: 'Could not update', staleText: 'Out of date', ...props },
  children,
});
const insideOf = (cell: J, props: J = {}): J[] => [repeatOf([cell], props)];
const reps = ['chart', 'repeat'];
accept('pending-chart-source-records-flow', 'A chart over the records of a records flow: each point\'s label and value are read from the item.', reps, [chartOf({ series: fromRecords() })], withRecords);
accept('pending-chart-source-records-line', 'A line over the same flow.', reps, [chartOf({ mark: 'line', series: fromRecords() })], withRecords);
accept('pending-chart-source-records-limit', 'A series takes the first records up to its limit.', reps, [chartOf({ series: fromRecords({ limit: 3 }) })], withRecords);
accept('pending-chart-source-label-computed', 'The label is any text operand over the item: the position, written out.', reps,
  [chartOf({ series: fromRecords({ x: { label: { type: 'format', pattern: 'H{n}', args: { n: { type: 'index' } } } } }) })], withRecords);
accept('pending-chart-source-value-computed', 'The value is any number operand over the item: a record\'s level, halved.', reps,
  [chartOf({ series: fromRecords({ y: { type: 'math', op: 'divide', args: [{ type: 'item', path: ['level'] }, lit(2)] } }) })], withRecords);
accept('pending-chart-source-in-a-repeat', 'A chart in the cell of a repeat with no provider reads the list of that repeat.', reps,
  insideOf(chartOf({ series: fromRecords({ providerId: undefined }) }, {}, 'cell')), withRecords);
accept('pending-chart-source-in-a-repeat-own-flow', 'A chart in a repeat may name another flow: the repeat\'s list is then not its own.', reps,
  insideOf(chartOf({ series: fromRecords() }, {}, 'cell')), withRecords);
accept('pending-linear-gauge-in-a-repeat', 'A gauge in the cell of a repeat: the value is the record\'s level, as a share of a range.', ['linear-gauge', 'repeat'],
  insideOf(gaugeOf({ value: { type: 'math', op: 'scale', args: [{ type: 'item', path: ['level'] }, lit(50), lit(90), lit(0), lit(1)] } }, {}, 'cell')), withRecords);
accept('pending-linear-gauge-in-a-repeat-position', 'A gauge in a repeat may read the position: the share of the list so far.', ['linear-gauge', 'repeat'],
  insideOf(gaugeOf({ value: { type: 'math', op: 'divide', args: [{ type: 'index' }, lit(6)] } }, {}, 'cell')), withRecords);
reject('chart-source-records-item-path-unknown', 'The y path is not in the flow\'s records: invalid_reference at the path.', reps,
  [chartOf({ series: fromRecords({ y: { type: 'item', path: ['missing'] } }) })], { code: 'invalid_reference', pointer: at(0, '/props/series/y/path') }, withRecords);
reject('chart-source-records-label-path-unknown', 'The label path is not in the flow\'s records.', reps,
  [chartOf({ series: fromRecords({ x: { label: { type: 'item', path: ['missing'] } } }) })], { code: 'invalid_reference', pointer: at(0, '/props/series/x/label/path') }, withRecords);
reject('chart-source-records-value-is-text', 'The value is a number: a field that is text is refused.', reps,
  [chartOf({ series: fromRecords({ y: { type: 'item', path: ['label'] } }) })], { code: 'binding_type', pointer: at(0, '/props/series/y') }, withRecords);
reject('chart-source-records-label-is-number', 'The label is text: a field that is a number is refused.', reps,
  [chartOf({ series: fromRecords({ x: { label: { type: 'item', path: ['level'] } } }) })], { code: 'binding_type', pointer: at(0, '/props/series/x/label') }, withRecords);
reject('chart-source-records-value-literal-text', 'A written value that is text is refused too.', reps,
  [chartOf({ series: fromRecords({ y: lit('high') }) })], { code: 'binding_type', pointer: at(0, '/props/series/y') }, withRecords);
reject('chart-source-flow-is-not-records', 'A rows flow is not records, even with the repeat capability in the document.', reps,
  [chartOf({ series: sourceSeries() })], { code: 'binding_type', pointer: at(0, '/props/series/providerId') }, envelope => { withRecords(envelope); withFlow(envelope); });
reject('chart-source-without-provider-in-a-placeholder', 'The placeholder of a repeat has no list: a chart with no provider there is refused.', reps,
  [repeatOf([gaugeOf({}, {}, 'cell'), chartOf({ series: fromRecords({ providerId: undefined }) }, {}, 'ghost')], { placeholder: { count: 3 } })],
  { code: 'invalid_combination', pointer: at(0, '/children/1/props/series') }, withRecords);
reject('chart-source-item-outside-a-repeat', 'An item operand in a chart with no flow and no repeat has no record to read.', ['chart'],
  [chartOf({ series: fromRecords({ providerId: undefined }) })], { code: 'invalid_combination', pointer: at(0, '/props/series') }, withRecords);
reject('linear-gauge-item-outside-a-repeat', 'A gauge outside a repeat has no record to read.', ['linear-gauge', 'repeat'],
  [gaugeOf({ value: { type: 'item', path: ['level'] } })], { code: 'invalid_combination', pointer: at(0, '/props/value') }, withRecords);
reject('linear-gauge-in-a-repeat-item-path-unknown', 'A gauge in a repeat reads a field the flow does not give.', ['linear-gauge', 'repeat'],
  insideOf(gaugeOf({ value: { type: 'item', path: ['missing'] } }, {}, 'cell')), { code: 'invalid_reference', pointer: at(0, '/children/0/props/value/path') }, withRecords);

// MARK: Chart (`sh.chart@1`)
accept('pending-chart-bar', 'Three bars on a ceiling axis: the smallest chart.', ['chart'], [chartOf()]);
accept('pending-chart-line', 'The same series as a line.', ['chart'], [chartOf({ mark: 'line' })]);
accept('pending-chart-area', 'The same series as a line over a filled area.', ['chart'], [chartOf({ mark: 'area' })]);
accept('pending-chart-bar-axis', 'Bars with three axis labels ("100%", "50%", "0%") and grid lines.', ['chart'],
  [chartOf({ axis: { levels: 3, label: { pattern: '{value}%', digits: 0 }, gridInk: rgba(255, 255, 255, 0.14), labelInk: rgba(255, 255, 255, 0.6) } })], undefined);
accept('pending-chart-bar-look', 'The bar block: the gap, the corner radius, the least height of a bar and the ink of an unknown one.', ['chart'],
  [chartOf({ series: points(10, null, 20), bar: { gap: 4, radius: 3, minimum: 3, unknownInk: rgba(255, 255, 255, 0.18) } })]);
accept('pending-chart-line-look', 'The line block: a width and a dot on each known value.', ['chart'], [chartOf({ mark: 'line', line: { width: 3, dots: true } })]);
accept('pending-chart-area-look', 'An area takes the line block for its edge.', ['chart'], [chartOf({ mark: 'area', line: { width: 1.5 } })]);
accept('pending-chart-domain-fixed', 'A fixed domain from 0 to 100, as a share.', ['chart'], [chartOf({ domain: { type: 'fixed', min: 0, max: 100 } })]);
accept('pending-chart-domain-fixed-negative-base', 'A fixed domain may start below zero: a line of temperatures from -20 to 40.', ['chart'], [chartOf({ mark: 'line', series: points(-5, 12, 30), domain: { type: 'fixed', min: -20, max: 40 } })]);
accept('pending-chart-domain-two-step', 'A two-step "nice" axis with a smallest step that is a number.', ['chart'], [chartOf({ domain: { type: 'two-step', minimumStep: lit(0.01), maximumFractionDigits: 3 } })]);
accept('pending-chart-domain-two-step-by-unit', 'The smallest step follows an entity: 0.25 where the unit says millimetres, else 0.01.', ['chart', 'rules'],
  [chartOf({ domain: { type: 'two-step', minimumStep: { type: 'map', of: read('temp', ['attributes', 'unit_of_measurement']), cases: [{ equals: 'mm', then: lit(0.25) }], otherwise: lit(0.01) }, maximumFractionDigits: 2 } })]);
accept('pending-chart-domain-two-step-factors', 'Two-step with the factors written: 1, 2, 5 and 10.', ['chart'], [chartOf({ domain: { type: 'two-step', minimumStep: lit(1), factors: [1, 2, 5, 10] } })]);
accept('pending-chart-null-values', 'A series with unknown values: a bar stub or a break in the line, not a zero.', ['chart'], [chartOf({ series: points(null, 5, null) })]);
accept('pending-chart-labels-all', 'Every label under the plot, however narrow.', ['chart'], [chartOf({ labels: 'all' })]);
accept('pending-chart-labels-none', 'No label under the plot.', ['chart'], [chartOf({ labels: 'none' })]);
accept('pending-chart-height', 'A taller plot.', ['chart'], [chartOf({ height: 160 })]);
accept('pending-chart-ink-pair', 'A tint that follows light and dark: the pair id is declared too.', ['chart', 'solid-appearance'], [chartOf({ tint: pair(solid(0, 90, 200), solid(120, 190, 255)) })]);
accept('pending-chart-a11y-series', 'The spoken value is the series.', ['chart'], [chartOf({}, { a11y: { label: lit('Chance of rain'), value: 'series' } })]);
accept('pending-chart-a11y-bound-label', 'The spoken name may come from an entity.', ['chart', 'bindings'], [chartOf({}, { a11y: { label: read('temp', ['attributes', 'friendly_name']) } })]);
accept('pending-chart-series-points-100', 'A hundred points is the most a literal series holds.', ['chart'], [chartOf({ series: points(...Array.from({ length: 100 }, (_, index) => index)) })]);
accept('pending-chart-in-a-grid', 'A chart takes a width in a grid like any node.', ['chart'], [node('grid', 'tile-grid', {
  props: { minimum: 'tile@1', maxColumns: 2, spacing: { type: 'token', name: 'm' }, equalRowHeights: true, shortRow: 'share', fold: 'page' }, children: [chartOf({}, { layout: { span: 2 } })] })]);

// The source series: a rows flow is refused with the code the seam gives (see chart-source.ts); the records flows are below, with the records cases.
reject('pending-chart-source-needs-a-records-flow', 'A source series names a flow whose output is records: a rows flow is refused with binding_type at providerId.', ['chart'],
  [chartOf({ series: sourceSeries() })], { code: 'binding_type', pointer: at(0, '/props/series/providerId') }, withFlow);
reject('chart-source-without-provider-outside-a-repeat', 'A source series with no providerId reads the list of an enclosing repeat; there is none here.', ['chart'],
  [chartOf({ series: sourceSeries({ providerId: undefined }) })], { code: 'invalid_combination', pointer: at(0, '/props/series') });
reject('chart-source-provider-unknown', 'A provider that names no data source.', ['chart'], [chartOf({ series: sourceSeries({ providerId: 'nothing' }) })], { code: 'invalid_reference', pointer: at(0, '/props/series/providerId') });
reject('chart-source-provider-is-an-entity', 'A provider that is an entity, not a flow.', ['chart'], [chartOf({ series: sourceSeries({ providerId: 'temp' }) })], { code: 'binding_type', pointer: at(0, '/props/series/providerId') });
reject('chart-source-limit-zero', 'A source series takes at least one record.', ['chart'], [chartOf({ series: sourceSeries({ limit: 0 }) })], { code: 'limit_exceeded', pointer: at(0, '/props/series/limit') }, withFlow);
reject('chart-source-limit-over-100', 'A source series takes at most 100 records.', ['chart'], [chartOf({ series: sourceSeries({ limit: 101 }) })], { code: 'limit_exceeded', pointer: at(0, '/props/series/limit') }, withFlow);
reject('chart-source-x-missing', 'A source series says how to read each label.', ['chart'], [chartOf({ series: sourceSeries({ x: undefined }) })], { code: 'missing_required', pointer: at(0, '/props/series/x') }, withFlow);
reject('chart-source-y-missing', 'A source series says how to read each value.', ['chart'], [chartOf({ series: sourceSeries({ y: undefined }) })], { code: 'missing_required', pointer: at(0, '/props/series/y') }, withFlow);
reject('chart-source-x-not-a-label', 'x holds a label operand: a bare operand is refused.', ['chart'], [chartOf({ series: sourceSeries({ x: lit('Hour') }) })], { code: 'missing_required', pointer: at(0, '/props/series/x/label') }, withFlow);

const bad = (name: string, note: string, props: J, expect: WgChartCase['expect'], rest: J = {}, needs = ['chart']) => reject(name, note, needs, [chartOf(props, rest)], expect);
bad('chart-mark-unknown', 'The marks are bar, line and area.', { mark: 'pie' }, { code: 'unknown_variant', pointer: at(0, '/props/mark') });
bad('chart-mark-missing', 'A chart says its mark.', { mark: undefined }, { code: 'missing_required', pointer: at(0, '/props/mark') });
bad('chart-series-missing', 'A chart has its series.', { series: undefined }, { code: 'missing_required', pointer: at(0, '/props/series') });
bad('chart-series-type-unknown', 'A series is literal or source.', { series: { type: 'entity' } }, { code: 'unknown_variant', pointer: at(0, '/props/series/type') });
bad('chart-series-empty', 'A literal series has a point.', { series: { type: 'literal', points: [] } }, { code: 'limit_exceeded', pointer: at(0, '/props/series/points') });
bad('chart-series-over-100-points', 'A literal series has at most 100 points.', { series: points(...Array.from({ length: 101 }, () => 1)) }, { code: 'limit_exceeded', pointer: at(0, '/props/series/points') });
bad('chart-point-value-text', 'A point\'s value is a number or null.', { series: { type: 'literal', points: [{ label: 'a', value: '5' }] } }, { code: 'invalid_value', pointer: at(0, '/props/series/points/0/value') });
bad('chart-point-label-missing', 'A point has its label.', { series: { type: 'literal', points: [{ value: 5 }] } }, { code: 'missing_required', pointer: at(0, '/props/series/points/0/label') });
bad('chart-point-extra-field', 'A point has a label and a value only.', { series: { type: 'literal', points: [{ label: 'a', value: 5, tone: 'x' }] } }, { code: 'unknown_field', pointer: at(0, '/props/series/points/0/tone') });
bad('chart-domain-missing', 'A chart says its domain.', { domain: undefined }, { code: 'missing_required', pointer: at(0, '/props/domain') });
bad('chart-domain-type-unknown', 'The domains are ceiling, fixed and two-step.', { domain: { type: 'auto' } }, { code: 'unknown_variant', pointer: at(0, '/props/domain/type') });
bad('chart-domain-ceiling-min-over-max', 'A ceiling cannot be asked to be at least more than it may be.', { domain: { type: 'ceiling', step: 10, min: 100, max: 10 } }, { code: 'invalid_value', pointer: at(0, '/props/domain/max') });
bad('chart-domain-ceiling-step-zero', 'The step of a ceiling is above 0.', { domain: { type: 'ceiling', step: 0, min: 10, max: 100 } }, { code: 'limit_exceeded', pointer: at(0, '/props/domain/step') });
bad('chart-domain-ceiling-step-missing', 'A ceiling has its step.', { domain: { type: 'ceiling', min: 10, max: 100 } }, { code: 'missing_required', pointer: at(0, '/props/domain/step') });
bad('chart-domain-fixed-equal-ends', 'A fixed domain has a height.', { domain: { type: 'fixed', min: 5, max: 5 } }, { code: 'invalid_value', pointer: at(0, '/props/domain/max') });
bad('chart-domain-fixed-reversed', 'A fixed domain rises.', { domain: { type: 'fixed', min: 50, max: 10 } }, { code: 'invalid_value', pointer: at(0, '/props/domain/max') });
bad('chart-domain-two-step-minimum-zero', 'The smallest step is above 0.', { domain: { type: 'two-step', minimumStep: lit(0) } }, { code: 'invalid_value', pointer: at(0, '/props/domain/minimumStep') });
bad('chart-domain-two-step-minimum-negative', 'A negative smallest step is refused too.', { domain: { type: 'two-step', minimumStep: lit(-1) } }, { code: 'invalid_value', pointer: at(0, '/props/domain/minimumStep') });
bad('chart-domain-two-step-minimum-text', 'The smallest step is a number.', { domain: { type: 'two-step', minimumStep: read('temp', ['state'], 'string') } }, { code: 'binding_type', pointer: at(0, '/props/domain/minimumStep') }, {}, ['chart', 'bindings']);
bad('chart-domain-two-step-minimum-missing', 'A two-step domain has its smallest step.', { domain: { type: 'two-step' } }, { code: 'missing_required', pointer: at(0, '/props/domain/minimumStep') });
bad('chart-domain-two-step-factors-descending', 'The factors rise.', { domain: { type: 'two-step', minimumStep: lit(1), factors: [1, 5, 2] } }, { code: 'invalid_value', pointer: at(0, '/props/domain/factors') });
bad('chart-domain-two-step-factors-repeat', 'The factors rise strictly.', { domain: { type: 'two-step', minimumStep: lit(1), factors: [1, 2, 2, 10] } }, { code: 'invalid_value', pointer: at(0, '/props/domain/factors') });
bad('chart-domain-two-step-factors-one', 'Two factors at least.', { domain: { type: 'two-step', minimumStep: lit(1), factors: [1] } }, { code: 'limit_exceeded', pointer: at(0, '/props/domain/factors') });
bad('chart-domain-two-step-factor-over-ten', 'A factor is at most 10, one decade.', { domain: { type: 'two-step', minimumStep: lit(1), factors: [1, 20] } }, { code: 'limit_exceeded', pointer: at(0, '/props/domain/factors/1') });
bad('chart-domain-two-step-digits-over-six', 'Labels have at most six places.', { domain: { type: 'two-step', minimumStep: lit(1), maximumFractionDigits: 7 } }, { code: 'limit_exceeded', pointer: at(0, '/props/domain/maximumFractionDigits') });
bad('chart-tint-standard', 'The tint is an exact ink: the standard fill is not one.', { tint: { type: 'standard' } }, { code: 'unknown_variant', pointer: at(0, '/props/tint/type') });
bad('chart-tint-missing', 'A chart has its tint.', { tint: undefined }, { code: 'missing_required', pointer: at(0, '/props/tint') });
bad('chart-tint-bound-color', 'An ink is not chosen by an entity.', { tint: { type: 'bound-color', value: read('temp', ['state']), fallback: blue } }, { code: 'unknown_variant', pointer: at(0, '/props/tint/type') }, {}, ['chart', 'bindings']);
bad('chart-axis-levels-one', 'An axis has two levels at least.', { axis: { levels: 1 } }, { code: 'limit_exceeded', pointer: at(0, '/props/axis/levels') });
bad('chart-axis-levels-seven', 'An axis has six levels at most.', { axis: { levels: 7 } }, { code: 'limit_exceeded', pointer: at(0, '/props/axis/levels') });
bad('chart-axis-levels-fraction', 'Levels is a whole number.', { axis: { levels: 2.5 } }, { code: 'invalid_value', pointer: at(0, '/props/axis/levels') });
bad('chart-axis-pattern-without-value', 'A label pattern holds {value}.', { axis: { levels: 3, label: { pattern: '%' } } }, { code: 'invalid_value', pointer: at(0, '/props/axis/label/pattern') });
bad('chart-axis-pattern-other-brace', 'A label pattern holds no other brace.', { axis: { levels: 3, label: { pattern: '{value} {unit}' } } }, { code: 'invalid_value', pointer: at(0, '/props/axis/label/pattern') });
bad('chart-axis-pattern-blank', 'A label pattern is not blank.', { axis: { levels: 3, label: { pattern: ' ' } } }, { code: 'invalid_value', pointer: at(0, '/props/axis/label/pattern') });
bad('chart-axis-digits-over-six', 'Axis labels have at most six places.', { axis: { levels: 3, label: { pattern: '{value}', digits: 7 } } }, { code: 'limit_exceeded', pointer: at(0, '/props/axis/label/digits') });
bad('chart-axis-ink-bound-color', 'The grid ink is an exact ink.', { axis: { levels: 3, gridInk: { type: 'standard' } } }, { code: 'unknown_variant', pointer: at(0, '/props/axis/gridInk/type') });
bad('chart-axis-extra-field', 'An axis has levels, label and two inks.', { axis: { levels: 3, title: 'x' } }, { code: 'unknown_field', pointer: at(0, '/props/axis/title') });
bad('chart-bar-block-on-a-line', 'The bar block is for bars.', { mark: 'line', bar: { gap: 2 } }, { code: 'invalid_combination', pointer: at(0, '/props/bar') });
bad('chart-bar-block-on-an-area', 'And not for an area.', { mark: 'area', bar: { gap: 2 } }, { code: 'invalid_combination', pointer: at(0, '/props/bar') });
bad('chart-line-block-on-bars', 'The line block is for a line or an area.', { mark: 'bar', line: { width: 2 } }, { code: 'invalid_combination', pointer: at(0, '/props/line') });
bad('chart-bar-gap-over-16', 'A gap is at most 16 points.', { bar: { gap: 17 } }, { code: 'limit_exceeded', pointer: at(0, '/props/bar/gap') });
bad('chart-bar-radius-negative', 'A radius is not negative.', { bar: { radius: -1 } }, { code: 'limit_exceeded', pointer: at(0, '/props/bar/radius') });
bad('chart-bar-minimum-over-8', 'The least height is at most 8 points.', { bar: { minimum: 9 } }, { code: 'limit_exceeded', pointer: at(0, '/props/bar/minimum') });
bad('chart-bar-extra-field', 'A bar block has no tint of its own.', { bar: { tint: blue } }, { code: 'unknown_field', pointer: at(0, '/props/bar/tint') });
bad('chart-line-width-zero', 'A line is at least half a point wide.', { mark: 'line', line: { width: 0 } }, { code: 'limit_exceeded', pointer: at(0, '/props/line/width') });
bad('chart-line-width-over-8', 'A line is at most 8 points wide.', { mark: 'line', line: { width: 9 } }, { code: 'limit_exceeded', pointer: at(0, '/props/line/width') });
bad('chart-line-dots-text', 'dots is a yes or no.', { mark: 'line', line: { dots: 'yes' } }, { code: 'invalid_value', pointer: at(0, '/props/line/dots') });
bad('chart-height-below-40', 'A plot is at least 40 points tall.', { height: 30 }, { code: 'limit_exceeded', pointer: at(0, '/props/height') });
bad('chart-height-over-320', 'A plot is at most 320 points tall.', { height: 400 }, { code: 'limit_exceeded', pointer: at(0, '/props/height') });
bad('chart-height-fraction', 'A height is a whole number of points.', { height: 76.5 }, { code: 'invalid_value', pointer: at(0, '/props/height') });
bad('chart-labels-unknown', 'Labels are fit, all or none.', { labels: 'some' }, { code: 'unknown_variant', pointer: at(0, '/props/labels') });
bad('chart-empty-text-missing', 'A chart says what it draws with no data.', { emptyText: undefined }, { code: 'missing_required', pointer: at(0, '/props/emptyText') });
bad('chart-empty-text-blank', 'And the words are not blank.', { emptyText: ' ' }, { code: 'invalid_value', pointer: at(0, '/props/emptyText') });
bad('chart-props-extra-field', 'A chart has no title of its own: the spoken name is the label.', { title: 'x' }, { code: 'unknown_field', pointer: at(0, '/props/title') });
reject('chart-a11y-missing', 'A chart says how it is read: every chart is accessible.', ['chart'], [chartOf({}, { a11y: undefined })], { code: 'missing_required', pointer: at(0, '/a11y') });
reject('chart-a11y-label-missing', 'The spoken name is required.', ['chart'], [chartOf({}, { a11y: {} })], { code: 'missing_required', pointer: at(0, '/a11y/label') });
reject('chart-a11y-label-blank', 'The spoken name is not blank.', ['chart'], [chartOf({}, { a11y: { label: lit(' ') } })], { code: 'invalid_value', pointer: at(0, '/a11y/label/value') });
reject('chart-a11y-label-wrong-kind', 'The spoken name binds text: a number read is refused.', ['chart', 'bindings'], [chartOf({}, { a11y: { label: read('temp', ['state'], 'number') } })], { code: 'binding_type', pointer: at(0, '/a11y/label/as') });
reject('chart-a11y-value-unknown', 'The spoken value is the series.', ['chart'], [chartOf({}, { a11y: { label: lit('x'), value: 'none' } })], { code: 'unknown_variant', pointer: at(0, '/a11y/value') });
reject('chart-has-no-children', 'A chart is a leaf.', ['chart'], [chartOf({}, { children: [] })], { code: 'unknown_field', pointer: at(0, '/children') });
reject('chart-has-no-action', 'A chart is not tappable: put it in a stack that is.', ['chart'], [chartOf({}, { action: { type: 'back' } })], { code: 'unknown_field', pointer: at(0, '/action') });

// MARK: Linear gauge (`sh.linear-gauge@1`)
const spanOf = (start: unknown = 0.25, size: unknown = 0.5): J => ({ start: lit(start), size: lit(size) });
accept('pending-linear-gauge-scale', 'A rail whose gradient colours the whole track, with a marker at half.', ['linear-gauge'], [gaugeOf()]);
accept('pending-linear-gauge-span', 'A rail whose gradient colours only a span, with a marker inside it.', ['linear-gauge'], [gaugeOf({ fill: 'span', span: spanOf() })]);
accept('pending-linear-gauge-span-only', 'A span with no marker.', ['linear-gauge'], [gaugeOf({ fill: 'span', span: spanOf(), value: undefined, marker: undefined })]);
accept('pending-linear-gauge-track-only', 'A track alone is allowed: a quiet rail.', ['linear-gauge'], [gaugeOf({ value: undefined, marker: undefined })]);
accept('pending-linear-gauge-percent', 'The value is 0 to 100.', ['linear-gauge'], [gaugeOf({ scale: 'percent', value: lit(72) })]);
accept('pending-linear-gauge-unit-written', 'The default scale may be written.', ['linear-gauge'], [gaugeOf({ scale: 'unit' })]);
accept('pending-linear-gauge-marker-border', 'A marker with a border.', ['linear-gauge'], [gaugeOf({ marker: { size: 12, ink: solid(255, 255, 255), border: { ink: rgba(0, 0, 0, 0.45), width: 1.5 } } })]);
accept('pending-linear-gauge-value-from-entity', 'The value is an entity read as a number.', ['linear-gauge', 'bindings'], [gaugeOf({ value: read('temp', ['state'], 'number'), scale: 'percent' })]);
accept('pending-linear-gauge-value-computed', 'The value is the share of a range, from the grammar\'s own math: (value - low) / (high - low).', ['linear-gauge', 'bindings'],
  [gaugeOf({ value: { type: 'math', op: 'scale', args: [read('temp', ['state'], 'number'), lit(50), lit(90), lit(0), lit(1)] } })]);
accept('pending-linear-gauge-span-from-entities', 'A span whose start and size are computed.', ['linear-gauge', 'bindings'],
  [gaugeOf({ fill: 'span', span: { start: { type: 'math', op: 'scale', args: [lit(60), lit(50), lit(90), lit(0), lit(1)] }, size: read('temp', ['state'], 'number') } })]);
accept('pending-linear-gauge-six-stops', 'Six stops, like a six-band scale.', ['linear-gauge'], [gaugeOf({ stops: [0, 0.2, 0.4, 0.6, 0.8, 1].map(position => ({ at: position, ink: solid(Math.round(position * 255), 120, 60) })) })]);
accept('pending-linear-gauge-equal-stops', 'Stops at one position make a hard edge.', ['linear-gauge'], [gaugeOf({ stops: [{ at: 0, ink: solid(0, 200, 0) }, { at: 0.5, ink: solid(0, 200, 0) }, { at: 0.5, ink: solid(240, 0, 0) }, { at: 1, ink: solid(240, 0, 0) }] })]);
accept('pending-linear-gauge-ink-pairs', 'Inks that follow light and dark: the pair id is declared too.', ['linear-gauge', 'solid-appearance'],
  [gaugeOf({ track: pair(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.22)), stops: [{ at: 0, ink: pair(solid(0, 140, 80), solid(60, 220, 140)) }, { at: 1, ink: pair(solid(200, 40, 30), solid(255, 110, 90)) }] })]);
accept('pending-linear-gauge-height', 'A taller rail with a larger marker.', ['linear-gauge'], [gaugeOf({ height: 20, marker: { size: 20, ink: solid(255, 255, 255) } })]);
accept('pending-linear-gauge-no-animation', 'A rail that jumps instead of gliding.', ['linear-gauge'], [gaugeOf({ animates: false })]);
accept('pending-linear-gauge-a11y-value', 'A rail read as a value, with its spoken name and value.', ['linear-gauge'], [gaugeOf({}, { a11y: { element: 'value', label: lit('Air quality'), value: lit('72, moderate') } })]);
accept('pending-linear-gauge-a11y-label-only', 'The spoken value may be left to the app.', ['linear-gauge'], [gaugeOf({}, { a11y: { element: 'value', label: lit('Air quality') } })]);

const worse = (name: string, note: string, props: J, expect: WgChartCase['expect'], rest: J = {}, needs = ['linear-gauge']) => reject(name, note, needs, [gaugeOf(props, rest)], expect);
worse('linear-gauge-fill-unknown', 'The fills are scale and span.', { fill: 'track' }, { code: 'unknown_variant', pointer: at(0, '/props/fill') });
worse('linear-gauge-fill-missing', 'A gauge says its fill.', { fill: undefined }, { code: 'missing_required', pointer: at(0, '/props/fill') });
worse('linear-gauge-span-fill-without-span', 'A span gauge needs its span.', { fill: 'span' }, { code: 'missing_required', pointer: at(0, '/props/span') });
worse('linear-gauge-scale-fill-with-span', 'A scale gauge colours the whole track: a span means nothing.', { span: spanOf() }, { code: 'invalid_combination', pointer: at(0, '/props/span') });
worse('linear-gauge-marker-without-value', 'A marker needs its value.', { value: undefined }, { code: 'missing_required', pointer: at(0, '/props/value') });
worse('linear-gauge-value-without-marker', 'A value with no marker draws nothing.', { marker: undefined }, { code: 'invalid_combination', pointer: at(0, '/props/value') });
worse('linear-gauge-stops-missing', 'A gauge has its stops.', { stops: undefined }, { code: 'missing_required', pointer: at(0, '/props/stops') });
worse('linear-gauge-stops-none', 'Two stops at least: none.', { stops: [] }, { code: 'invalid_value', pointer: at(0, '/props/stops') });
worse('linear-gauge-stops-one', 'Two stops at least: one.', { stops: [{ at: 0, ink: solid(1, 2, 3) }] }, { code: 'invalid_value', pointer: at(0, '/props/stops') });
worse('linear-gauge-stops-descending', 'Stops do not fall back.', { stops: [{ at: 0, ink: solid(1, 2, 3) }, { at: 0.8, ink: solid(1, 2, 3) }, { at: 0.4, ink: solid(1, 2, 3) }] }, { code: 'invalid_value', pointer: at(0, '/props/stops/2/at') });
worse('linear-gauge-stops-nine', 'Eight stops at most.', { stops: Array.from({ length: 9 }, (_, index) => ({ at: index / 8, ink: solid(1, 2, 3) })) }, { code: 'limit_exceeded', pointer: at(0, '/props/stops') });
worse('linear-gauge-stop-over-one', 'A stop is at 0 to 1.', { stops: [{ at: 0, ink: solid(1, 2, 3) }, { at: 1.5, ink: solid(1, 2, 3) }] }, { code: 'limit_exceeded', pointer: at(0, '/props/stops/1/at') });
worse('linear-gauge-stop-negative', 'And not below 0.', { stops: [{ at: -0.1, ink: solid(1, 2, 3) }, { at: 1, ink: solid(1, 2, 3) }] }, { code: 'limit_exceeded', pointer: at(0, '/props/stops/0/at') });
worse('linear-gauge-stop-ink-standard', 'A stop is an exact ink.', { stops: [{ at: 0, ink: { type: 'standard' } }, { at: 1, ink: solid(1, 2, 3) }] }, { code: 'unknown_variant', pointer: at(0, '/props/stops/0/ink/type') });
worse('linear-gauge-stop-missing-ink', 'A stop has its ink.', { stops: [{ at: 0 }, { at: 1, ink: solid(1, 2, 3) }] }, { code: 'missing_required', pointer: at(0, '/props/stops/0/ink') });
worse('linear-gauge-track-missing', 'A gauge has its track ink.', { track: undefined }, { code: 'missing_required', pointer: at(0, '/props/track') });
worse('linear-gauge-value-text', 'The value is a number.', { value: read('temp', ['state'], 'string') }, { code: 'binding_type', pointer: at(0, '/props/value') }, {}, ['linear-gauge', 'bindings']);
worse('linear-gauge-value-literal-text', 'A written value is a number too.', { value: lit('half') }, { code: 'binding_type', pointer: at(0, '/props/value') });
worse('linear-gauge-span-start-text', 'The span\'s start is a number.', { fill: 'span', span: { start: lit('a'), size: lit(0.5) } }, { code: 'binding_type', pointer: at(0, '/props/span/start') });
worse('linear-gauge-span-size-text', 'The span\'s size is a number.', { fill: 'span', span: { start: lit(0), size: lit('a') } }, { code: 'binding_type', pointer: at(0, '/props/span/size') });
worse('linear-gauge-span-size-missing', 'A span has a start and a size.', { fill: 'span', span: { start: lit(0) } }, { code: 'missing_required', pointer: at(0, '/props/span/size') });
worse('linear-gauge-scale-unknown', 'The scales are unit and percent.', { scale: 'permille' }, { code: 'unknown_variant', pointer: at(0, '/props/scale') });
worse('linear-gauge-height-below-4', 'A rail is at least 4 points tall.', { height: 2 }, { code: 'limit_exceeded', pointer: at(0, '/props/height') });
worse('linear-gauge-height-over-32', 'A rail is at most 32 points tall.', { height: 40 }, { code: 'limit_exceeded', pointer: at(0, '/props/height') });
worse('linear-gauge-marker-size-below-6', 'A marker is at least 6 points.', { marker: { size: 4, ink: solid(1, 2, 3) } }, { code: 'limit_exceeded', pointer: at(0, '/props/marker/size') });
worse('linear-gauge-marker-size-over-32', 'A marker is at most 32 points.', { marker: { size: 40, ink: solid(1, 2, 3) } }, { code: 'limit_exceeded', pointer: at(0, '/props/marker/size') });
worse('linear-gauge-marker-ink-missing', 'A marker has its ink.', { marker: { size: 12 } }, { code: 'missing_required', pointer: at(0, '/props/marker/ink') });
worse('linear-gauge-marker-border-width-zero', 'A border is at least half a point.', { marker: { size: 12, ink: solid(1, 2, 3), border: { ink: solid(0, 0, 0), width: 0 } } }, { code: 'limit_exceeded', pointer: at(0, '/props/marker/border/width') });
worse('linear-gauge-marker-extra-field', 'A marker has a size, an ink and a border.', { marker: { size: 12, ink: solid(1, 2, 3), shape: 'square' } }, { code: 'unknown_field', pointer: at(0, '/props/marker/shape') });
worse('linear-gauge-animates-text', 'animates is a yes or no.', { animates: 'yes' }, { code: 'invalid_value', pointer: at(0, '/props/animates') });
worse('linear-gauge-props-extra-field', 'A gauge has no label field: its spoken name is in a11y.', { label: 'x' }, { code: 'unknown_field', pointer: at(0, '/props/label') });
reject('linear-gauge-a11y-missing', 'A gauge says whether it is read.', ['linear-gauge'], [gaugeOf({}, { a11y: undefined })], { code: 'missing_required', pointer: at(0, '/a11y') });
reject('linear-gauge-a11y-element-unknown', 'The elements are hidden and value.', ['linear-gauge'], [gaugeOf({}, { a11y: { element: 'image' } })], { code: 'unknown_variant', pointer: at(0, '/a11y/element') });
reject('linear-gauge-a11y-hidden-with-label', 'A hidden gauge has no label.', ['linear-gauge'], [gaugeOf({}, { a11y: { element: 'hidden', label: lit('x') } })], { code: 'unknown_field', pointer: at(0, '/a11y/label') });
reject('linear-gauge-a11y-value-without-label', 'A read gauge has its spoken name.', ['linear-gauge'], [gaugeOf({}, { a11y: { element: 'value' } })], { code: 'missing_required', pointer: at(0, '/a11y/label') });
reject('linear-gauge-a11y-label-wrong-kind', 'The spoken name binds text.', ['linear-gauge', 'bindings'], [gaugeOf({}, { a11y: { element: 'value', label: read('temp', ['state'], 'number') } })], { code: 'binding_type', pointer: at(0, '/a11y/label/as') });
reject('linear-gauge-has-no-children', 'A gauge is a leaf.', ['linear-gauge'], [gaugeOf({}, { children: [] })], { code: 'unknown_field', pointer: at(0, '/children') });

// MARK: Evaluation: chart arithmetic, from `WeatherChartMathTests.swift`
export const wgChartEvaluations: WgChartEvaluation[] = [];
const chartCase = (name: string, note: string, chart: J, expected: J) => wgChartEvaluations.push({ name, note, subject: { chart }, env: {}, expected: { chart: expected } });
const numberName = (value: number | null) => value === null ? 'none' : String(value).replace('.', 'p').replace('-', 'minus-');
const TESTS = 'apple/Tests/HassCoreTests/WeatherChartMathTests.swift';

// The ceiling: `chanceDomain` (WeatherChartMathTests.swift:70-76). The domain is the peak rounded up to the next 10, at least 10, at most 100.
const ceiling = { type: 'ceiling', step: 10, min: 10, max: 100 };
for (const [peak, domain] of [[null, 10], [0, 10], [1, 10], [5, 10], [9, 10], [10, 10], [11, 20], [20, 20], [21, 30], [26, 30], [41, 50], [50, 50], [51, 60], [60, 60], [75, 80], [94, 100], [100, 100]] as [number | null, number][])
  chartCase(`chart-ceiling-peak-${numberName(peak)}`, `A ceiling of step 10 from 10 to 100 with a highest value of ${peak ?? 'none known'} tops out at ${domain} (${TESTS}:70-76, \`chanceDomain\`).`, { op: 'domain', domain: ceiling, peak }, { domain });
chartCase('chart-ceiling-peak-over-max-is-held', 'A highest value above the largest top is held at it: 140 on a ceiling to 100 gives 100.', { op: 'domain', domain: ceiling, peak: 140 }, { domain: 100 });
chartCase('chart-ceiling-peak-negative-is-the-least', 'A highest value below zero counts as zero, so the least top is used.', { op: 'domain', domain: ceiling, peak: -5 }, { domain: 10 });
chartCase('chart-ceiling-step-five', 'Another step: a ceiling of step 5 from 5 to 50 with a peak of 11 tops out at 15.', { op: 'domain', domain: { type: 'ceiling', step: 5, min: 5, max: 50 }, peak: 11 }, { domain: 15 });

// The two-step axis: `amountAxis` (WeatherChartMathTests.swift:78-92). Inches take a smallest step of 0.01 and at most 3 places, millimetres 0.25 and 2.
const twoStep = (total: number | null, unit: 'in' | 'mm', domain: number, step: number, digits: number) => chartCase(
  `chart-two-step-${unit}-total-${numberName(total)}`,
  `A two-step axis for a total of ${total ?? 'none known'} ${unit} (smallest step ${unit === 'mm' ? 0.25 : 0.01}, at most ${unit === 'mm' ? 2 : 3} places) tops out at ${domain} with a middle label of ${step} (${TESTS}:78-92, \`amountAxis\`).`,
  { op: 'two-step', total, minimumStep: unit === 'mm' ? 0.25 : 0.01, maximumFractionDigits: unit === 'mm' ? 2 : 3 }, { domain, step, digits });
for (const [total, unit, domain, step, digits] of [
  [0, 'in', 0.02, 0.01, 2], [0.005, 'in', 0.02, 0.01, 2], [0.01, 'in', 0.02, 0.01, 2], [0.02, 'in', 0.02, 0.01, 2], [0.04, 'in', 0.04, 0.02, 2], [0.09, 'in', 0.1, 0.05, 2],
  [0.12, 'in', 0.12, 0.06, 2], [0.19, 'in', 0.2, 0.1, 1], [1.01, 'in', 1.2, 0.6, 1], [0, 'mm', 0.5, 0.25, 2], [0.1, 'mm', 0.5, 0.25, 2], [0.7, 'mm', 0.8, 0.4, 1],
  [2.286, 'mm', 2.5, 1.25, 2], [7.3, 'mm', 8, 4, 0], [130, 'mm', 150, 75, 0],
] as [number, 'in' | 'mm', number, number, number][]) twoStep(total, unit, domain, step, digits);
twoStep(null, 'in', 0.02, 0.01, 2);
chartCase('chart-two-step-in-total-negative', 'A negative total counts as zero (WeatherChartMathTests.swift:88-92).', { op: 'two-step', total: -5, minimumStep: 0.01, maximumFractionDigits: 3 }, { domain: 0.02, step: 0.01, digits: 2 });
chartCase('chart-two-step-mm-total-not-finite', 'A total that is not a number counts as zero: the millimetre axis falls to 0.5 (WeatherChartMathTests.swift:91). Written as null here, JSON having no infinity.', { op: 'two-step', total: null, minimumStep: 0.25, maximumFractionDigits: 2 }, { domain: 0.5, step: 0.25, digits: 2 });
chartCase('chart-two-step-own-factors', 'The factors are the document\'s: with 1, 2, 5 and 10 only, a total of 7.3 needs a step of 5 (domain 10), not the 4 of the default list.', { op: 'two-step', total: 7.3, minimumStep: 1, maximumFractionDigits: 0, factors: [1, 2, 5, 10] }, { domain: 10, step: 5, digits: 0 });
chartCase('chart-two-step-fewer-places-skips-a-factor', 'A factor whose labels need more places than allowed is skipped: a total of 0.09 with no fraction digits cannot print 0.05, so the step rises to 1 (domain 2).', { op: 'two-step', total: 0.09, minimumStep: 0.01, maximumFractionDigits: 0 }, { domain: 2, step: 1, digits: 0 });

// The value as a share of the domain: `scaledPercent` (WeatherChartMathTests.swift:94-103).
const share = (name: string, note: string, value: number | null, top: number, expected: number, base?: number) =>
  chartCase(name, `${note} (${TESTS}:94-103, \`scaledPercent\`)`, { op: 'share', value, top, ...(base === undefined ? {} : { base }) }, { percent: expected });
share('chart-share-half', '5 of 10 is 50.', 5, 10, 50);
share('chart-share-nine-of-ten', '9 of 10 is 90.', 9, 10, 90);
share('chart-share-82', '41 of 50 is 82.', 41, 50, 82);
share('chart-share-fraction-domain', '0.09 of 0.1 is 90.', 0.09, 0.1, 90);
share('chart-share-full', '100 of 100 is 100.', 100, 100, 100);
share('chart-share-over-is-held', 'A value above the axis is held at 100: 120 of 100.', 120, 100, 100);
share('chart-share-unknown-is-zero', 'An unknown value is 0.', null, 100, 0);
share('chart-share-no-height-is-zero', 'An axis with no height gives 0.', 5, 0, 0);
share('chart-share-below-base-is-held', 'A value below the base is held at 0: -5 on an axis from 0.', -5, 100, 0);
share('chart-share-from-a-base', 'An axis from -20 to 40 puts 10 at half: (10 - -20) / 60.', 10, 40, 50, -20);
share('chart-share-from-a-base-low-end', 'And its base at 0.', -20, 40, 0, -20);
share('chart-share-base-above-top-is-zero', 'An axis that falls (base 10, top 5) has no height: 0.', 7, 5, 0, 10);

// Thinned labels: `labelCadence` and `labelIndices` (WeatherChartMathTests.swift:59-68). Gap is 6 points.
const cadence = (name: string, note: string, count: number, plotWidth: number, widest: number, expectedCadence: number, indices: number[]) =>
  chartCase(name, `${note} (${TESTS}:59-68)`, { op: 'labels', count, plotWidth, widestLabelWidth: widest }, { cadence: expectedCadence, indices });
cadence('chart-labels-24-in-153', '24 labels 32 points wide in a plot of 153: 4 fit, so every 6th shows.', 24, 153, 32, 6, [0, 6, 12, 18]);
cadence('chart-labels-24-in-326', '24 labels 32 points wide in a plot of 326: 8 fit, so every 3rd shows.', 24, 326, 32, 3, [0, 3, 6, 9, 12, 15, 18, 21]);
cadence('chart-labels-none-is-one', 'No labels: cadence 1 and no index.', 0, 100, 10, 1, []);
cadence('chart-labels-no-width-shows-a-quarter', 'With no width to go by, a quarter of 24 labels show: every 6th.', 24, 0, 10, 6, [0, 6, 12, 18]);
cadence('chart-labels-no-label-width-shows-a-quarter', 'With no label width to go by, the same.', 24, 300, 0, 6, [0, 6, 12, 18]);
cadence('chart-labels-all-fit', '6 labels 20 points wide in 300: all fit, every one shows.', 6, 300, 20, 1, [0, 1, 2, 3, 4, 5]);
cadence('chart-labels-one-fits', 'Only one label fits in a narrow plot: a wide label of 50 in 40 shows the first only of 6.', 6, 40, 50, 6, [0]);
cadence('chart-labels-gap-is-six', 'The gap counts: 3 labels of 44 need 3 x 50 = 150 and fit 150 exactly, so all show; at 149 only 2 fit and every 2nd shows.', 3, 150, 44, 1, [0, 1, 2]);
cadence('chart-labels-gap-is-six-just-short', 'One point short of the case before.', 3, 149, 44, 2, [0, 2]);
chartCase('chart-label-indices-cadence-zero-shows-all', 'A cadence below 1 shows every label (WeatherChartMathTests.swift:67).', { op: 'indices', count: 3, cadence: 0 }, { indices: [0, 1, 2] });
chartCase('chart-label-indices-none', 'No labels, no index (WeatherChartMathTests.swift:66).', { op: 'indices', count: 0, cadence: 3 }, { indices: [] });

// The axis labels: the levels and their text.
const levels = (name: string, note: string, input: J, expected: J) => chartCase(name, note, { op: 'levels', ...input }, expected);
levels('chart-levels-three-of-100', 'Three levels of an axis to 100 are 100, 50 and 0, top first (UKWeatherViews.swift:262-269: high, middle, low).', { levels: 3, top: 100, pattern: '{value}%', digits: 0 }, { values: [100, 50, 0], labels: ['100%', '50%', '0%'] });
levels('chart-levels-two-step-inches', 'The levels of a two-step axis to 0.1 with 2 places: 0.1, 0.05 and 0 (UKWeatherSheet.swift:646-651: domain, step, 0).', { levels: 3, top: 0.1, pattern: '{value} in', digits: 2 }, { values: [0.1, 0.05, 0], labels: ['0.1 in', '0.05 in', '0 in'] });
levels('chart-levels-five', 'Five levels of an axis to 100: every 25.', { levels: 5, top: 100, pattern: '{value}', digits: 0 }, { values: [100, 75, 50, 25, 0], labels: ['100', '75', '50', '25', '0'] });
levels('chart-levels-from-a-base', 'Levels of an axis from -20 to 40: 40, 10 and -20.', { levels: 3, top: 40, base: -20, pattern: '{value}°', digits: 0 }, { values: [40, 10, -20], labels: ['40°', '10°', '-20°'] });
levels('chart-levels-digits-trim-zeros', 'A label has up to the digits it is given and no trailing zeros: 12.5 with 2 places is 12.5.', { levels: 2, top: 12.5, pattern: '{value}', digits: 2 }, { values: [12.5, 0], labels: ['12.5', '0'] });
levels('chart-levels-digits-round-half-up', 'A tie rounds up: 0.125 with 2 places is 0.13.', { levels: 2, top: 0.125, pattern: '{value}', digits: 2 }, { values: [0.125, 0], labels: ['0.13', '0'] });
levels('chart-levels-grouping', 'Thousands are grouped, en-US: 1250 is 1,250.', { levels: 2, top: 1250, pattern: '{value} W', digits: 0 }, { values: [1250, 0], labels: ['1,250 W', '0 W'] });

// The bars: columns, heights and the unknown stub (UKWeatherViews.swift:262-275). A plot 100 wide and 76 tall, 6 bars, gap 2, least height 2.
chartCase('chart-bars-heights-and-columns', 'Six bars of 94, 40, 20, 0, 100 and 1 on an axis to 100 in a plot 100 wide and 76 tall: columns (100 - 5 x 2) / 6 = 15 wide, 2 apart; heights 71.44, 30.4, 15.2, 0 (zero draws nothing), 76 and 2 (above zero, never below the least).',
  { op: 'bars', values: [94, 40, 20, 0, 100, 1], top: 100, width: 100, height: 76, gap: 2, minimum: 2 },
  { bars: [{ x: 0, width: 15, height: 71.44, unknown: false }, { x: 17, width: 15, height: 30.4, unknown: false }, { x: 34, width: 15, height: 15.2, unknown: false }, { x: 51, width: 15, height: 0, unknown: false }, { x: 68, width: 15, height: 76, unknown: false }, { x: 85, width: 15, height: 2, unknown: false }] });
chartCase('chart-bars-unknown-is-a-stub', 'An unknown value is a bar of the least height, not zero: [null, 50] in 62 wide: columns 30 wide, the first 2 tall.',
  { op: 'bars', values: [null, 50], top: 100, width: 62, height: 76, gap: 2, minimum: 2 }, { bars: [{ x: 0, width: 30, height: 2, unknown: true }, { x: 32, width: 30, height: 38, unknown: false }] });
chartCase('chart-bars-gap-and-least-height-are-the-document\'s', 'A gap of 4 and a least height of 5: [1, 0] in 24 wide: columns 10 wide, the first 5 tall, the zero bar 0.',
  { op: 'bars', values: [1, 0], top: 100, width: 24, height: 76, gap: 4, minimum: 5 }, { bars: [{ x: 0, width: 10, height: 5, unknown: false }, { x: 14, width: 10, height: 0, unknown: false }] });
chartCase('chart-bars-one-bar-fills-the-plot', 'One bar takes the whole width.', { op: 'bars', values: [50], top: 100, width: 80, height: 76, gap: 2, minimum: 2 }, { bars: [{ x: 0, width: 80, height: 38, unknown: false }] });
chartCase('chart-bars-over-the-axis-is-held', 'A bar above the axis is as tall as the plot.', { op: 'bars', values: [250], top: 100, width: 80, height: 76, gap: 2, minimum: 2 }, { bars: [{ x: 0, width: 80, height: 76, unknown: false }] });
chartCase('chart-bars-from-a-base', 'On an axis from -20 to 40, 10 stands at half the plot.', { op: 'bars', values: [10], top: 40, base: -20, width: 80, height: 76, gap: 2, minimum: 2 }, { bars: [{ x: 0, width: 80, height: 38, unknown: false }] });
chartCase('chart-points-line', 'The points of a line sit in the middle of equal slots: [0, 50, null, 100] in 80 wide and 76 tall: x 10, 30, 50, 70; y 76, 38, a break, 0.',
  { op: 'points', values: [0, 50, null, 100], top: 100, width: 80, height: 76 }, { points: [{ x: 10, y: 76 }, { x: 30, y: 38 }, { x: 50, y: null }, { x: 70, y: 0 }] });
chartCase('chart-points-one-is-centred', 'One point is in the middle of the plot.', { op: 'points', values: [100], top: 100, width: 80, height: 76 }, { points: [{ x: 40, y: 0 }] });

// What a screen reader says: `series = zip(labels, points).map { "\($0) \(percent($1.probability))" }.joined(", ")` (UKWeatherSheet.swift:622-657).
chartCase('chart-spoken-series', 'Each label and its value, joined by a comma and a space, the value as an axis label.', { op: 'spoken', points: [{ label: 'Now', value: 94 }, { label: '7 PM', value: 40 }, { label: '8 PM', value: 20 }], pattern: '{value}%', digits: 0, unknownText: 'Unavailable' },
  { spoken: 'Now 94%, 7 PM 40%, 8 PM 20%' });
chartCase('chart-spoken-unknown-value', 'A value that is unknown says the chart\'s own words.', { op: 'spoken', points: [{ label: 'Now', value: 94 }, { label: '7 PM', value: null }], pattern: '{value}%', digits: 0, unknownText: 'Unavailable' }, { spoken: 'Now 94%, 7 PM Unavailable' });
chartCase('chart-spoken-amounts', 'Amounts with two places and a unit.', { op: 'spoken', points: [{ label: 'Now', value: 0 }, { label: '7 PM', value: 0.07 }, { label: '8 PM', value: 0.09 }], pattern: '{value} in', digits: 2, unknownText: 'Unavailable' },
  { spoken: 'Now 0 in, 7 PM 0.07 in, 8 PM 0.09 in' });
chartCase('chart-spoken-empty', 'No points say nothing.', { op: 'spoken', points: [], pattern: '{value}', digits: 0, unknownText: 'Unavailable' }, { spoken: '' });

// The points of a chart over records (`sh.chart@1` with `sh.repeat@1`): `x.label` and `y` read with `item` and `index` set to each record in turn, the first
// `limit` records only. Written by hand from the rule alone: a label is text (a number is written as it is, anything else is empty), a value is a number,
// text that is a number, or null (a stub in a bar chart, a break in a line).
const sourceSeriesOf = (limit: number, rest: J = {}): J => ({ type: 'source', providerId: 'records-flow', limit, x: { label: { type: 'item', path: ['label'] } }, y: { type: 'item', path: ['level'] }, ...rest });
const pointsCase = (name: string, note: string, series: J, records: J[], expected: J[]) =>
  chartCase(name, note, { op: 'source-points', series, records }, { sourcePoints: expected });
pointsCase('chart-source-points-label-and-value', 'Each record gives a label and a value, in order.', sourceSeriesOf(3),
  [{ label: 'Now', level: 70 }, { label: '7 PM', level: 68.5 }, { label: '8 PM', level: 66 }],
  [{ label: 'Now', value: 70 }, { label: '7 PM', value: 68.5 }, { label: '8 PM', value: 66 }]);
pointsCase('chart-source-points-limit', 'Only the first `limit` records are drawn: 2 of 3.', sourceSeriesOf(2),
  [{ label: 'a', level: 1 }, { label: 'b', level: 2 }, { label: 'c', level: 3 }], [{ label: 'a', value: 1 }, { label: 'b', value: 2 }]);
pointsCase('chart-source-points-fewer-than-limit', 'A flow with fewer records than the limit gives all of them.', sourceSeriesOf(10), [{ label: 'a', level: 1 }], [{ label: 'a', value: 1 }]);
pointsCase('chart-source-points-no-records', 'A flow with no records gives no points: the chart draws its empty text.', sourceSeriesOf(5), [], []);
pointsCase('chart-source-points-null-value', 'A null value is an unknown point, not a zero.', sourceSeriesOf(3),
  [{ label: 'a', level: 5 }, { label: 'b', level: null }, { label: 'c', level: 7 }], [{ label: 'a', value: 5 }, { label: 'b', value: null }, { label: 'c', value: 7 }]);
pointsCase('chart-source-points-missing-value', 'A record with no such field is an unknown point.', sourceSeriesOf(2), [{ label: 'a' }, { label: 'b', level: 4 }], [{ label: 'a', value: null }, { label: 'b', value: 4 }]);
pointsCase('chart-source-points-text-value', 'A value written as text that is a number is that number; other text is unknown.', sourceSeriesOf(3),
  [{ label: 'a', level: '12.5' }, { label: 'b', level: 'high' }, { label: 'c', level: ' ' }], [{ label: 'a', value: 12.5 }, { label: 'b', value: null }, { label: 'c', value: null }]);
pointsCase('chart-source-points-zero-is-known', 'A zero is a known value.', sourceSeriesOf(1), [{ label: 'a', level: 0 }], [{ label: 'a', value: 0 }]);
pointsCase('chart-source-points-number-label', 'A label that is a number is written as it is.', sourceSeriesOf(2), [{ label: 5, level: 1 }, { label: 6.5, level: 2 }],
  [{ label: '5', value: 1 }, { label: '6.5', value: 2 }]);
pointsCase('chart-source-points-missing-label', 'A record with no label gives an empty one.', sourceSeriesOf(1), [{ level: 1 }], [{ label: '', value: 1 }]);
pointsCase('chart-source-points-index-label', 'The label may be built from the position: "H" then the 0-based index.',
  sourceSeriesOf(3, { x: { label: { type: 'format', pattern: 'H{n}', args: { n: { type: 'index' } } } } }),
  [{ level: 1 }, { level: 2 }, { level: 3 }], [{ label: 'H0', value: 1 }, { label: 'H1', value: 2 }, { label: 'H2', value: 3 }]);
pointsCase('chart-source-points-computed-value', 'The value may be computed from the record: half the level.',
  sourceSeriesOf(2, { y: { type: 'math', op: 'divide', args: [{ type: 'item', path: ['level'] }, { type: 'literal', value: 2 }] } }),
  [{ label: 'a', level: 70 }, { label: 'b', level: 5 }], [{ label: 'a', value: 35 }, { label: 'b', value: 2.5 }]);
pointsCase('chart-source-points-nested-path', 'The path may go into a record: the field `wind.speed`.',
  sourceSeriesOf(2, { y: { type: 'item', path: ['wind', 'speed'] } }), [{ label: 'a', wind: { speed: 9 } }, { label: 'b', wind: null }], [{ label: 'a', value: 9 }, { label: 'b', value: null }]);

// A gauge in the cell of a repeat reads its value from the record with the grammar's own operands: the share of a range, 50 to 90, of a record's level.
const cellShare = (name: string, note: string, level: number | null, expected: J) => wgChartEvaluations.push({
  name, note, subject: { operand: { type: 'math', op: 'scale', args: [{ type: 'item', path: ['level'] }, { type: 'literal', value: 50 }, { type: 'literal', value: 90 }, { type: 'literal', value: 0 }, { type: 'literal', value: 1 }] } },
  env: { item: { level }, index: 2 }, expected });
cellShare('gauge-cell-share-low', 'A record at the bottom of the range puts the marker at 0.', 50, { status: 'value', value: 0 });
cellShare('gauge-cell-share-middle', 'A record in the middle of the range puts the marker at half: 70 of 50 to 90.', 70, { status: 'value', value: 0.5 });
cellShare('gauge-cell-share-high', 'A record at the top of the range puts the marker at 1.', 90, { status: 'value', value: 1 });
wgChartEvaluations.push({
  name: 'gauge-cell-position-is-the-index', note: 'The position of the cell is its 0-based index: the third cell is 2, whatever its record.', subject: { operand: { type: 'index' } },
  env: { item: { level: 70 }, index: 2 }, expected: { status: 'value', value: 2 },
});

// MARK: Evaluation: gauge placement and the rail math, from `WeatherRails.swift` and `WeatherHighlightsTests.swift`
const gaugeCase = (name: string, note: string, gauge: J, expected: J) => wgChartEvaluations.push({ name, note, subject: { gauge }, env: {}, expected: { gauge: expected } });
const TRACK = { width: 200, markerSize: 12 };
const full = { startPercent: 0, sizePercent: 100, left: 0, width: 200 };
gaugeCase('gauge-scale-marker-at-half', 'A scale gauge on a track of 200 points with a marker of 12: a value of 0.5 puts the marker\'s left edge at 100 - 6 = 94, and the span covers the track (UKWeatherRailView.applyFrames, UKWeatherViews.swift:190-205).', { fill: 'scale', value: 0.5, ...TRACK }, { span: full, marker: { percent: 50, left: 94 } });
gaugeCase('gauge-scale-marker-at-start-is-held-inside', 'A value of 0 would put the marker half outside: it is held at the left edge (offset max(0, -6) = 0).', { fill: 'scale', value: 0, ...TRACK }, { span: full, marker: { percent: 0, left: 0 } });
gaugeCase('gauge-scale-marker-at-end-is-held-inside', 'A value of 1 is held so the marker ends at the right edge: 188.', { fill: 'scale', value: 1, ...TRACK }, { span: full, marker: { percent: 100, left: 188 } });
gaugeCase('gauge-scale-value-over-one-is-held', 'A value of 1.5 is held at the end (clamp, UKWeatherViews.swift:190).', { fill: 'scale', value: 1.5, ...TRACK }, { span: full, marker: { percent: 100, left: 188 } });
gaugeCase('gauge-scale-value-below-zero-is-held', 'A value below 0 is held at the start.', { fill: 'scale', value: -0.2, ...TRACK }, { span: full, marker: { percent: 0, left: 0 } });
gaugeCase('gauge-scale-no-value-hides-the-marker', 'With no value there is no marker (marker.alpha = 0, UKWeatherViews.swift:204).', { fill: 'scale', value: null, ...TRACK }, { span: full, marker: null });
gaugeCase('gauge-scale-value-missing-hides-the-marker', 'A gauge that gives no value says the same.', { fill: 'scale', ...TRACK }, { span: full, marker: null });
gaugeCase('gauge-scale-percent', 'On the percent scale 72 is 72: the marker at 144 - 6 = 138.', { fill: 'scale', scale: 'percent', value: 72, ...TRACK }, { span: full, marker: { percent: 72, left: 138 } });
gaugeCase('gauge-scale-percent-over-100-is-held', 'And 120 is held at 100.', { fill: 'scale', scale: 'percent', value: 120, ...TRACK }, { span: full, marker: { percent: 100, left: 188 } });
gaugeCase('gauge-scale-unit-fraction-is-exact', 'A unit value of 0.07 is 7 percent, not 7.000000000000001 (the shares are rounded to six places like the chart axis).', { fill: 'scale', value: 0.07, ...TRACK }, { span: full, marker: { percent: 7, left: 8 } });
gaugeCase('gauge-scale-ignores-a-span', 'A scale gauge colours the whole track whatever span it is given.', { fill: 'scale', value: 0.5, span: { start: 0.25, size: 0.5 }, ...TRACK }, { span: full, marker: { percent: 50, left: 94 } });
gaugeCase('gauge-track-narrower-than-the-marker', 'A track narrower than the marker keeps it at the left edge: min(width - size, ...) is below 0, held at 0.', { fill: 'scale', value: 0.5, width: 10, markerSize: 12 }, { span: { startPercent: 0, sizePercent: 100, left: 0, width: 10 }, marker: { percent: 50, left: 0 } });
gaugeCase('gauge-marker-size-moves-the-edge', 'A marker of 20 at a value of 0.5 sits at 100 - 10 = 90.', { fill: 'scale', value: 0.5, width: 200, markerSize: 20 }, { span: full, marker: { percent: 50, left: 90 } });
gaugeCase('gauge-right-to-left-mirrors-the-marker', 'In a right-to-left layout the marker mirrors: a value of 0.25 is at offset 44, so its left edge is 200 - 44 - 12 = 144.', { fill: 'scale', value: 0.25, rtl: true, ...TRACK }, { span: full, marker: { percent: 25, left: 144 } });

// The week rail: `WeatherRails.week` (WeatherRails.swift:7-25), `WeatherHighlightsTests.swift:146-162`. The week spans 50 to 90; today is 60 to 80 with 70 now.
gaugeCase('gauge-span-today-in-the-week', 'Today (low 60, high 80) in a week of 50 to 90: the span starts at 25 percent and is 50 percent long (WeatherHighlightsTests.swift:151-153), the marker at 50 (:154): span left 50, width 100, marker 94.',
  { fill: 'span', span: { start: 0.25, size: 0.5 }, value: 0.5, ...TRACK }, { span: { startPercent: 25, sizePercent: 50, left: 50, width: 100 }, marker: { percent: 50, left: 94 } });
gaugeCase('gauge-span-tomorrow-has-no-marker', 'Tomorrow (low 50, high 70): the span starts at 0 and is 50 long; no marker (WeatherHighlightsTests.swift:155-158).', { fill: 'span', span: { start: 0, size: 0.5 }, value: null, ...TRACK }, { span: { startPercent: 0, sizePercent: 50, left: 0, width: 100 }, marker: null });
gaugeCase('gauge-span-held-inside-the-track', 'A span that would run past the end is cut to fit: start 0.8, size 0.5 gives 20 percent (min(size, 100 - start), UKWeatherViews.swift:192).', { fill: 'span', span: { start: 0.8, size: 0.5 }, ...TRACK }, { span: { startPercent: 80, sizePercent: 20, left: 160, width: 40 }, marker: null });
gaugeCase('gauge-span-empty-is-not-drawn', 'A span of size 0 is not drawn (span.alpha = 0, UKWeatherViews.swift:197).', { fill: 'span', span: { start: 0.5, size: 0 }, ...TRACK }, { span: null, marker: null });
gaugeCase('gauge-span-start-below-zero-is-held', 'A span that starts below 0 starts at 0.', { fill: 'span', span: { start: -0.5, size: 0.4 }, ...TRACK }, { span: { startPercent: 0, sizePercent: 40, left: 0, width: 80 }, marker: null });
gaugeCase('gauge-span-no-numbers-is-empty', 'A span whose start and size are not known is empty.', { fill: 'span', span: { start: null, size: null }, ...TRACK }, { span: null, marker: null });
gaugeCase('gauge-span-percent-scale', 'On the percent scale the span is in percent: start 25, size 50.', { fill: 'span', scale: 'percent', span: { start: 25, size: 50 }, ...TRACK }, { span: { startPercent: 25, sizePercent: 50, left: 50, width: 100 }, marker: null });
gaugeCase('gauge-span-right-to-left-mirrors', 'Mirrored, a span from 10 to 40 percent sits at 200 - 20 - 60 = 120.', { fill: 'span', span: { start: 0.1, size: 0.3 }, rtl: true, ...TRACK }, { span: { startPercent: 10, sizePercent: 30, left: 120, width: 60 }, marker: null });
// The hero rail: `WeatherRails.hero` (WeatherRails.swift:28-38), `WeatherHighlightsTests.swift:164-170`: the span is the whole track, the marker the current value in the day's range.
gaugeCase('gauge-hero-marker-in-the-day', 'Today 60 to 80 with 75 now: the span is the whole track and the marker at 75 percent (WeatherHighlightsTests.swift:174-175).', { fill: 'span', span: { start: 0, size: 1 }, value: 0.75, ...TRACK }, { span: full, marker: { percent: 75, left: 144 } });
gaugeCase('gauge-hero-marker-past-the-top-is-held', '100 now in a day of 60 to 80 is held at the end (WeatherHighlightsTests.swift:176).', { fill: 'span', span: { start: 0, size: 1 }, value: 1, ...TRACK }, { span: full, marker: { percent: 100, left: 188 } });

// The same shares built by the grammar, from the forecast numbers (the rails' inputs are operands: `math` `scale` and `clamp`, and a rule for the flat case).
const scaleOf = (value: J, low: J, high: J, to = 100): J => ({ type: 'math', op: 'clamp', args: [{ type: 'math', op: 'scale', args: [value, low, high, lit(0), lit(to)] }, lit(0), lit(to)] });
const forecastEnv = (reads: Record<string, number>): J => ({ reads: Object.fromEntries(Object.entries(reads).map(([key, value]) => [`day/${key}`, { status: 'value', value }])) });
const operandCase = (name: string, note: string, operand: J, expected: number, env: J) => wgChartEvaluations.push({ name, note, subject: { operand }, env, expected: { status: 'value', value: expected } });
const day = (key: string): J => read('day', [key], 'number');
const week = { minLow: lit(50), maxHigh: lit(90) };
operandCase('gauge-rail-week-start-percent', 'The week rail\'s span starts at (low - weekLow) / (weekHigh - weekLow) x 100: (60 - 50) / 40 = 25 (WeatherRails.swift:23, WeatherHighlightsTests.swift:151).', scaleOf(day('low'), week.minLow, week.maxHigh), 25, forecastEnv({ low: 60, high: 80, now: 70 }));
operandCase('gauge-rail-week-size-percent', 'Its size is (high - low) / spread x 100: (80 - 60) / 40 = 50 (WeatherRails.swift:22, WeatherHighlightsTests.swift:152).', scaleOf({ type: 'math', op: 'subtract', args: [day('high'), day('low')] }, lit(0), { type: 'math', op: 'subtract', args: [week.maxHigh, week.minLow] }), 50, forecastEnv({ low: 60, high: 80, now: 70 }));
operandCase('gauge-rail-week-marker-percent', 'Its marker is (now - weekLow) / spread x 100: (70 - 50) / 40 = 50 (WeatherRails.swift:21, WeatherHighlightsTests.swift:153).', scaleOf(day('now'), week.minLow, week.maxHigh), 50, forecastEnv({ low: 60, high: 80, now: 70 }));
operandCase('gauge-rail-week-marker-past-the-top-is-clamped', 'A marker above the week\'s highest high is held at 100 (clampPercent).', scaleOf(day('now'), week.minLow, week.maxHigh), 100, forecastEnv({ now: 120 }));
operandCase('gauge-rail-week-marker-below-the-bottom-is-clamped', 'And below the lowest low at 0.', scaleOf(day('now'), week.minLow, week.maxHigh), 0, forecastEnv({ now: 20 }));
operandCase('gauge-rail-hero-marker-percent', 'The hero rail\'s marker is (now - low) / (high - low) x 100: (75 - 60) / 20 = 75 (WeatherRails.swift:35, WeatherHighlightsTests.swift:174).', scaleOf(day('now'), day('low'), day('high')), 75, forecastEnv({ low: 60, high: 80, now: 75 }));
operandCase('gauge-rail-hero-marker-clamped', '100 now in a day of 60 to 80 is held at 100 (WeatherHighlightsTests.swift:175).', scaleOf(day('now'), day('low'), day('high')), 100, forecastEnv({ low: 60, high: 80, now: 100 }));
/** The flat day (WeatherRails.swift:17-19, :31-33): when the high equals the low the marker is 0 below it, 100 above it and 50 on it. */
const flat: J = {
  type: 'choose', cases: [
    { when: { type: 'compare', op: 'below', left: day('now'), right: day('low') }, then: lit(0) },
    { when: { type: 'compare', op: 'above', left: day('now'), right: day('low') }, then: lit(100) },
  ], otherwise: lit(50),
};
operandCase('gauge-rail-flat-below-is-zero', 'A flat week with 60 now below 70: the marker is 0 (WeatherHighlightsTests.swift:165-166).', flat, 0, forecastEnv({ low: 70, now: 60 }));
operandCase('gauge-rail-flat-above-is-hundred', 'With 80 now: 100 (WeatherHighlightsTests.swift:167).', flat, 100, forecastEnv({ low: 70, now: 80 }));
operandCase('gauge-rail-flat-on-is-fifty', 'With 70 now: 50 (WeatherHighlightsTests.swift:168).', flat, 50, forecastEnv({ low: 70, now: 70 }));
