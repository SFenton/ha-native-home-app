import type { CompositionDocument } from '../../shared/composition/schema';
import { houseFrom, type House } from '../projections';
import homeDomains from './home-domains.json';
import { item, lit, node, pad, pageOf, repeat, space, text, flowOf, wgflowStates } from './wgflow-story';

/**
 * The story of the seam between the data parts and the repeat (lane `integ10`): a chart fed by the records of a records flow, a chart that reads the list of the
 * repeat it sits in, and a linear gauge in each cell of a repeat. The feed and the flow are the repeat story's, made up (`demo_` ids). Open it at
 * `/?preview2=1&fixture=wgchartflow&surface=page:page-wx-chart`.
 */
type J = Record<string, any>;
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const rgba = (red: number, green: number, blue: number, alpha: number): J => ({ type: 'rgba', red, green, blue, alpha });
const pair = (light: J, dark: J): J => ({ type: 'solid-appearance', light, dark });
const ink = (lightAlpha: number, darkAlpha: number): J => pair(rgba(0, 0, 0, lightAlpha), rgba(255, 255, 255, darkAlpha));
const tint = pair(solid(0, 112, 235), solid(100, 190, 255));
const axis: J = { levels: 3, label: { pattern: '{value}°', digits: 0 }, gridInk: ink(0.14, 0.14), labelInk: ink(0.6, 0.6) };
const caption = (id: string, value: string): J => text(id, lit(value), { style: 'footnote', ink: ink(0.6, 0.6) });

/** A series over the first twelve hours: the label under each bar and the temperature as its value. */
const source = (providerId?: string): J => ({ type: 'source', ...(providerId ? { providerId } : {}), limit: 12, x: { label: item('label') }, y: item('temperature') });
const chart = (id: string, mark: string, series: J, extra: J = {}): J => node(id, 'chart', {
  props: { mark, series, domain: { type: 'fixed', min: 50, max: 80 }, tint, axis, height: 96, emptyText: 'Unavailable', ...extra },
  a11y: { label: lit('Temperature by hour'), value: 'series' },
});
/** The share of the 50 to 80 range a temperature is at, for a gauge. */
const share: J = { type: 'math', op: 'scale', args: [item('temperature'), lit(50), lit(80), lit(0), lit(1)] };
const gauge = (id: string): J => node(id, 'linear-gauge', {
  props: {
    value: share, fill: 'scale', track: ink(0.12, 0.22), height: 8,
    stops: [{ at: 0, ink: solid(90, 200, 255) }, { at: 0.5, ink: solid(255, 217, 77) }, { at: 1, ink: solid(255, 140, 51) }],
    marker: { size: 14, ink: solid(255, 255, 255), border: { ink: rgba(0, 0, 0, 0.45), width: 1 } },
  },
  a11y: { element: 'value', label: { type: 'expr', value: item('label') }, value: { type: 'expr', value: { type: 'format', pattern: '{t}°', args: { t: item('temperature') }, formats: { t: { number: { maximumFractionDigits: 0 } } } } } },
});
const row = (id: string): J => node(id, 'stack', {
  props: { axis: 'vertical', spacing: space('xs'), padding: pad('s'), surface: { type: 'module', density: 'thin' } },
  children: [
    text(`${id}-label`, item('label'), { style: 'caption1' }),
    gauge(`${id}-gauge`),
  ],
  a11y: { element: 'children' },
});
const cellsOf = (id: string): J => repeat(id, 'hourly', { axis: 'vertical', limit: 4, spacing: space('s') }, [row(`${id}-cell`)]);

const pages: [string, string, J[]][] = [
  ['chart', 'Chart from a flow', [
    caption('wx-t-bars', 'Bars: the records of the flow "hourly", 12 hours'),
    chart('wx-bars', 'bar', source('hourly'), { domain: { type: 'ceiling', step: 10, min: 10, max: 100 } }),
    caption('wx-t-area', 'Area: the same flow, first 12 records'),
    chart('wx-area', 'area', source('hourly'), { line: { width: 2, dots: true } }),
    caption('wx-t-slow', 'A flow that has not answered: the chart says so'),
    chart('wx-slow', 'bar', source('slow'), { domain: { type: 'ceiling', step: 10, min: 10, max: 100 } }),
  ]],
  ['gauge', 'Gauge in a repeat', [
    caption('wx-t-gauge', 'Each cell of a repeat has a gauge: its value is read from the cell\'s record'),
    cellsOf('wx-cells'),
  ]],
  ['inside', 'Chart in a repeat', [
    caption('wx-t-inside', 'A chart with no flow of its own reads the list of the repeat it sits in (3 records)'),
    repeat('wx-list', 'hourly', { axis: 'vertical', limit: 3, spacing: space('s') }, [node('wx-list-cell', 'stack', {
      props: { axis: 'vertical', spacing: space('xs'), padding: pad('s'), surface: { type: 'module', density: 'thin' } },
      children: [text('wx-list-label', item('label'), { style: 'caption1' }), chart('wx-list-chart', 'bar', { ...source(), limit: 3 }, { height: 56, axis: undefined })],
      a11y: { element: 'children' },
    })]),
  ]],
];

/** The home-domains document with the story's pages and two flows (one that answers, one that never does), and the house they read. */
export function wgchartflowStory(): { document: CompositionDocument; house: House } {
  const document = structuredClone(homeDomains.document) as unknown as CompositionDocument & Record<string, any>;
  document.navigation = { ...document.navigation, tabs: [], initialPageId: 'page-wx-chart', initialTabId: null };
  document.pages = pages.map(([key, title, body]) => pageOf(`page-wx-${key}`, title, JSON.parse(JSON.stringify(body)))) as CompositionDocument['pages'];
  document.modals = [];
  document.dataSources = [flowOf('hourly', 'Hourly'), flowOf('slow', 'Slow')] as CompositionDocument['dataSources'];
  return { document, house: houseFrom({ states: wgflowStates }) };
}
