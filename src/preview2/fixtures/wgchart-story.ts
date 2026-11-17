import type { CompositionDocument } from '../../shared/composition/schema';
import type { NativeState } from '../../shared/native-state';
import { houseFrom, type House } from '../projections';
import homeDomains from './home-domains.json';

/**
 * The story of the data parts (lane `wg-s3`): `chart` as bars, a line and an area on each kind of scale, with thinned labels, unknown values and no data; and
 * `linear-gauge` with a scale gradient, a span and a marker. One page for each, and one card composed of generic parts only. Every page also exists as a light
 * sheet (`modal-wc-<name>`, system appearance) so the parts can be seen on both grounds. Synthetic `demo_` ids only and nothing named for a product. Open it at
 * `/?preview2=1&fixture=wgchart&surface=page:page-wc-bars`.
 */

type J = Record<string, any>;
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, path: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path }, as, missing: 'unavailable' });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const space = (name: string): J => ({ type: 'token', name });
const pad = (name: string): J => ({ top: space(name), leading: space(name), bottom: space(name), trailing: space(name) });
const rgba = (red: number, green: number, blue: number, alpha: number): J => ({ type: 'rgba', red, green, blue, alpha });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const pair = (lightInk: J, darkInk: J): J => ({ type: 'solid-appearance', light: lightInk, dark: darkInk });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, value: unknown, props: J = {}): J => node(id, 'text', { props: { value: typeof value === 'string' ? lit(value) : value, style: 'body', unavailableText: 'None', ...props } });
const stack = (id: string, children: J[], props: J = {}, rest: J = {}): J => node(id, 'stack', { props: { axis: 'vertical', spacing: space('s'), ...props }, children, ...rest });
const pageOf = (id: string, title: string, components: J[]): J => ({
  id, title, icon: symbol('house'), parameters: {}, navigation: { type: 'stack' }, toolbar: { type: 'inherit' },
  layout: { type: 'column', padding: pad('l'), spacing: space('l'), maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host' }, components,
});
const sheetOf = (id: string, title: string, components: J[]): J => ({
  ...(({ navigation: _navigation, ...rest }) => rest)(pageOf(id, title, components)), toolbar: { type: 'replace', groups: [] }, presentation: { type: 'sheet', width: 'page', height: { type: 'full' }, appearance: 'system', placement: 'canonical-sheet@1', grabber: 'canonical', navigation: 'local-stack@1',
    close: { type: 'close', visibility: 'all-depths', placement: 'trailing', rail: 'automatic', guard: { type: 'none' } } },
});

/** Inks that read on both grounds: white on the dark one, black on the light one. */
const ink = (lightAlpha: number, darkAlpha: number): J => pair(rgba(0, 0, 0, lightAlpha), rgba(255, 255, 255, darkAlpha));
const blue = pair(solid(0, 112, 235), solid(100, 190, 255)), teal = pair(solid(0, 140, 130), solid(90, 220, 200)), amber = pair(solid(210, 120, 0), solid(255, 190, 70));
const axisOf = (pattern: string, digits = 0): J => ({ levels: 3, label: { pattern, digits }, gridInk: ink(0.14, 0.14), labelInk: ink(0.6, 0.6) });
const spoken = (label: string): J => ({ label: lit(label), value: 'series' });
const points = (labels: string[], values: (number | null)[]): J => ({ type: 'literal', points: values.map((value, index) => ({ label: labels[index] ?? String(index), value })) });
const hours = Array.from({ length: 24 }, (_, index) => index === 0 ? 'Now' : `${index % 12 === 0 ? 12 : index % 12} ${index < 12 ? 'AM' : 'PM'}`);
const share = [94, 40, 20, 10, 0, 5, 60, 80, 70, 35, 15, 8, 30, 55, 65, 40, 20, 12, 6, 3, 18, 44, 51, 28];
const reading = [14, 13, 12, 11, 11, 12, 15, 19, 23, 27, 30, 32, 33, 32, 30, 27, 24, 21, 19, 17, 16, 15, 14, 14];
const amounts = [0, 0, 0.01, 0.03, 0.03, 0.05, 0.07, 0.09];
const title = (id: string, value: string): J => text(id, value, { style: 'footnote', ink: ink(0.6, 0.6) });

const barsBody = (): J[] => [
  title('wc-t-bars', 'Bars, 6 values on a round-up scale'),
  node('wc-bars', 'chart', { props: { mark: 'bar', series: points(hours, share.slice(0, 6)), domain: { type: 'ceiling', step: 10, min: 10, max: 100 }, tint: blue, axis: axisOf('{value}%'), emptyText: 'Unavailable' }, a11y: spoken('Share of capacity') }),
  title('wc-t-bars24', 'Bars, 24 values: the labels thin to fit'),
  node('wc-bars24', 'chart', { props: { mark: 'bar', series: points(hours, share), domain: { type: 'ceiling', step: 10, min: 10, max: 100 }, tint: teal, axis: axisOf('{value}%'), bar: { gap: 2, radius: 2, minimum: 2 }, emptyText: 'Unavailable' }, a11y: spoken('Fill level') }),
  title('wc-t-steps', 'Two steps: a round axis for a running total'),
  node('wc-steps', 'chart', { props: { mark: 'bar', series: points(hours.slice(0, 8), amounts), domain: { type: 'two-step', minimumStep: read('level', ['attributes', 'step'], 'number'), maximumFractionDigits: 3 }, tint: teal, axis: { levels: 3, label: { pattern: '{value} in' }, gridInk: ink(0.14, 0.14), labelInk: ink(0.6, 0.6) }, labels: 'all', emptyText: 'Unavailable' }, a11y: spoken('Total so far') }),
  title('wc-t-unknown', 'Unknown values draw a short stub, never a zero'),
  node('wc-unknown', 'chart', { props: { mark: 'bar', series: points(hours, [60, null, 40, null, 20, 10]), domain: { type: 'fixed', min: 0, max: 100 }, tint: blue, axis: axisOf('{value}%'), bar: { unknownInk: ink(0.18, 0.28) }, emptyText: 'Unavailable' }, a11y: spoken('Share of capacity, some unknown') }),
];
const linesBody = (): J[] => [
  title('wc-t-line', 'Line, on a fixed scale from 0 to 40'),
  node('wc-line', 'chart', { props: { mark: 'line', series: points(hours, reading), domain: { type: 'fixed', min: 0, max: 40 }, tint: amber, axis: axisOf('{value} u'), line: { width: 2, dots: false }, height: 96, emptyText: 'Unavailable' }, a11y: spoken('Reading') }),
  title('wc-t-area', 'Area, with dots, a gap where a value is unknown'),
  node('wc-area', 'chart', { props: { mark: 'area', series: points(hours.slice(0, 8), [14, 13, null, 11, 12, 15, 19, 23]), domain: { type: 'fixed', min: 0, max: 40 }, tint: blue, axis: axisOf('{value} u'), line: { width: 2, dots: true }, height: 96, labels: 'all', emptyText: 'Unavailable' }, a11y: spoken('Reading, with a gap') }),
  title('wc-t-empty', 'With no value known, the chart says so'),
  node('wc-empty', 'chart', { props: { mark: 'bar', series: points(hours, [null, null, null]), domain: { type: 'ceiling', step: 10, min: 10, max: 100 }, tint: blue, axis: axisOf('{value}%'), emptyText: 'Unavailable' }, a11y: spoken('Share of capacity') }),
];

const aqiStops = [[0.30, 0.85, 0.45], [1, 0.85, 0.25], [1, 0.55, 0.2], [0.95, 0.3, 0.3], [0.7, 0.4, 0.95], [0.65, 0.2, 0.3]].map(([r, g, b], index, all) =>
  ({ at: index / (all.length - 1), ink: solid(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)) }));
const gaugeBody = (): J[] => [
  title('wc-g-scale', 'A gradient over the whole track, a marker at the reading'),
  node('wc-scale', 'linear-gauge', { props: { value: read('level', ['state'], 'number'), scale: 'percent', fill: 'scale', stops: aqiStops, track: ink(0.12, 0.22), marker: { size: 12, ink: solid(255, 255, 255), border: { ink: rgba(0, 0, 0, 0.45), width: 1.5 } } }, a11y: { element: 'value', label: lit('Level'), value: lit('72, moderate') } }),
  title('wc-g-span', 'A gradient over a span, with a marker inside it'),
  node('wc-span', 'linear-gauge', { props: { value: lit(0.5), fill: 'span', span: { start: lit(0.25), size: lit(0.5) }, stops: [{ at: 0, ink: solid(90, 200, 255) }, { at: 0.5, ink: solid(255, 217, 77) }, { at: 1, ink: solid(255, 140, 51) }], track: ink(0.12, 0.22), marker: { size: 12, ink: solid(255, 255, 255), border: { ink: rgba(0, 0, 0, 0.45), width: 1.5 } } }, a11y: { element: 'hidden' } }),
  title('wc-g-computed', 'The span and the marker computed from numbers, with the grammar'),
  node('wc-computed', 'linear-gauge', { props: {
    value: { type: 'math', op: 'clamp', args: [{ type: 'math', op: 'scale', args: [read('level', ['attributes', 'now'], 'number'), read('level', ['attributes', 'low'], 'number'), read('level', ['attributes', 'high'], 'number'), lit(0), lit(1)] }, lit(0), lit(1)] },
    fill: 'span', span: { start: lit(0.1), size: lit(0.6) }, stops: [{ at: 0, ink: solid(90, 200, 255) }, { at: 1, ink: solid(255, 140, 51) }], track: ink(0.12, 0.22), marker: { size: 12, ink: solid(255, 255, 255), border: { ink: rgba(0, 0, 0, 0.45), width: 1.5 } },
  }, a11y: { element: 'value', label: lit('Today so far') } }),
  title('wc-g-nomarker', 'No value: the marker is hidden'),
  node('wc-nomarker', 'linear-gauge', { props: { value: read('missing', ['state'], 'number'), fill: 'scale', stops: aqiStops.slice(0, 3), track: ink(0.12, 0.22), marker: { size: 12, ink: solid(255, 255, 255) } }, a11y: { element: 'hidden' } }),
  title('wc-g-tall', 'A taller rail, a larger marker'),
  node('wc-tall', 'linear-gauge', { props: { value: lit(0.85), fill: 'scale', stops: [{ at: 0, ink: pair(solid(0, 140, 80), solid(60, 220, 140)) }, { at: 1, ink: pair(solid(200, 40, 30), solid(255, 110, 90)) }], track: ink(0.12, 0.22), height: 20, marker: { size: 20, ink: solid(255, 255, 255), border: { ink: rgba(0, 0, 0, 0.45), width: 2 } } }, a11y: { element: 'hidden' } }),
];

const cardBody = (): J[] => [
  stack('wc-card', [
    stack('wc-head', [text('wc-name', 'Cellar', { style: 'headline', ink: ink(0.85, 0.85) }), text('wc-value', read('level', ['state']), { style: 'title2', font: { weight: 'bold', digits: 'monospaced' }, ink: ink(0.85, 0.85) })], { axis: 'horizontal', distribution: 'spread', align: 'center' }),
    node('wc-card-gauge', 'linear-gauge', { props: { value: read('level', ['state'], 'number'), scale: 'percent', fill: 'scale', stops: aqiStops.slice(0, 4), track: ink(0.12, 0.22), marker: { size: 12, ink: solid(255, 255, 255), border: { ink: rgba(0, 0, 0, 0.45), width: 1.5 } } }, a11y: { element: 'value', label: lit('Level') } }),
    node('wc-card-chart', 'chart', { props: { mark: 'area', series: points(hours.slice(0, 6), [20, 35, 30, 55, 70, 72]), domain: { type: 'ceiling', step: 10, min: 10, max: 100 }, tint: teal, axis: axisOf('{value}%'), height: 64, labels: 'all', emptyText: 'Unavailable' }, a11y: spoken('Level over the last hours') }),
  ], { spacing: space('m'), padding: pad('l'), surface: { type: 'module', density: 'thin' } }),
];

const parts: [string, string, () => J[]][] = [['bars', 'Bar charts', barsBody], ['lines', 'Line and area charts', linesBody], ['gauge', 'Gauges', gaugeBody], ['card', 'Composed card', cardBody]];

/** The same body with every node id suffixed, for the sheet (ids are unique across the document). */
const renamed = <T,>(value: T, suffix: string): T => {
  if (Array.isArray(value)) return value.map(item => renamed(item, suffix)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'id' && typeof item === 'string' && item.startsWith('wc-') ? item + suffix : renamed(item, suffix)])) as T;
};

/** The entity the story reads: a level in percent, a smallest step for the running total, and the numbers of a day. */
export const wgchartStates: NativeState[] = [
  { entityId: 'sensor.demo_level', state: '72', name: 'Level', step: 0.01, now: 70, low: 60, high: 80 } as unknown as NativeState,
];

/** The home-domains document with one page and one light sheet for each part, and the house they read. */
export function wgchartStory(): { document: CompositionDocument; house: House } {
  const document = structuredClone(homeDomains.document) as unknown as CompositionDocument & Record<string, any>;
  document.navigation = { ...document.navigation, tabs: [], initialPageId: 'page-wc-bars', initialTabId: null };
  document.pages = parts.map(([key, label, body]) => pageOf(`page-wc-${key}`, label, body())) as CompositionDocument['pages'];
  document.modals = parts.map(([key, label, body]) => sheetOf(`modal-wc-${key}`, label, renamed(body(), '-l'))) as CompositionDocument['modals'];
  document.dataSources = [{ id: 'level', kind: 'ha-entity', entityId: lit('sensor.demo_level') }, { id: 'missing', kind: 'ha-entity', entityId: lit('sensor.demo_missing') }] as CompositionDocument['dataSources'];
  document.localState = [] as unknown as CompositionDocument['localState'];
  return { document, house: houseFrom({ states: wgchartStates }) };
}
