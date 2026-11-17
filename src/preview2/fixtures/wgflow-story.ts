import type { CompositionDocument } from '../../shared/composition/schema';
import { evaluatePipeline, newFacts, requestShape, typeSteps, withoutNull, type PipelineInputs, type Shape } from '../../shared/composition/pipeline';
import type { Json } from '../../shared/types';
import type { NativeState } from '../../shared/native-state';
import { houseFrom, type House } from '../projections';
import type { RecordsAnswer, UseRecords } from '../flow-records';
import homeDomains from './home-domains.json';

/**
 * The story of the repeat and the extra flow steps (lane `wg-s2`): a row of cells over a records flow with paging, a column, a placeholder while a flow has not
 * answered, and a saved component that owns its flow, used twice. Generic parts only, over a made-up hourly feed with `demo_` ids. Open it at
 * `/?preview2=1&fixture=wgflow&surface=page:page-wf-row`.
 */
type J = Record<string, any>;
export const lit = (value: unknown): J => ({ type: 'literal', value });
export const item = (...path: string[]): J => ({ type: 'item', path });
export const index: J = { type: 'index' };
export const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
export const space = (name: string): J => ({ type: 'token', name });
export const pad = (name: string): J => ({ top: space(name), leading: space(name), bottom: space(name), trailing: space(name) });
export const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
export const text = (id: string, value: J, props: J = {}): J => node(id, 'text', { props: { value: { type: 'expr', value }, style: 'body', unavailableText: 'None', ...props } });
export const words = { loadingText: 'Loading', emptyText: 'Nothing to show', unavailableText: 'Unavailable', errorText: 'Could not update', staleText: 'Out of date' };
const step = (id: string, op: string, rest: J = {}): J => ({ id, op, ...rest });
export const pageOf = (id: string, title: string, components: J[]): J => ({
  id, title, icon: symbol('house'), parameters: {}, navigation: { type: 'stack' }, toolbar: { type: 'inherit' },
  layout: { type: 'column', padding: pad('l'), spacing: space('l'), maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host' }, components,
});

/** The flow: the first twelve hours, each as a label (Now, then the hour), a temperature, a symbol name, the amount so far and the position. */
const feed = { type: 'ha-subscription', kind: 'weather-forecast', entityId: lit('weather.demo_home'), forecastType: 'hourly' } as PipelineInputs['request'];
const label: J = {
  type: 'choose', cases: [{ when: { type: 'compare', op: 'eq', left: index, right: lit(0) }, then: lit('Now') }, { when: { type: 'exists', value: item('datetime') },
    then: { type: 'format', pattern: '{d}', args: { d: item('datetime') }, formats: { d: { date: { style: 'hour' } } } } }],
  otherwise: { type: 'format', pattern: '{n}h', args: { n: index } },
};
const STEPS = [
  step('entries', 'get', { path: ['forecast'] }), step('cut', 'limit', { count: 12 }),
  step('total', 'running-sum', { value: item('precipitation'), into: 'total', nullPropagates: false }),
  step('cells', 'map', { fields: { label, temperature: item('temperature'), condition: item('condition'), total: item('total'), position: index } }),
];
export const schemaOf = (request: PipelineInputs['request'], steps: J[]): Shape => {
  const shapes = typeSteps(steps as never, requestShape(request), new Map(), '', newFacts());
  return withoutNull(shapes[shapes.length - 1]);
};
export const flowOf = (id: string, title: string): J => ({
  id, kind: 'model', model: 'pipeline@1',
  inputs: { title, parameters: [], request: feed, steps: STEPS, output: { kind: 'records', max: 12 }, schema: schemaOf(feed, STEPS) },
});

export const cell = (id: string): J => node(id, 'stack', {
  props: { axis: 'vertical', spacing: space('xs'), align: 'center', padding: pad('s'), surface: { type: 'module', density: 'thin' } },
  children: [
    text(`${id}-label`, item('label'), { style: 'caption2', align: 'center' }),
    node(`${id}-glyph`, 'symbol', { props: { name: { type: 'bound-symbol', value: { type: 'map', of: item('condition'), cases: [{ equals: 'rainy', then: lit('cloud.rain.fill') }, { equals: 'sunny', then: lit('sun.max.fill') }], otherwise: lit('cloud.fill') }, fallback: symbol('cloud.fill') },
      size: { points: 26 }, rendering: 'multicolor' }, a11y: { element: 'hidden' } }),
    text(`${id}-temp`, { type: 'format', pattern: '{t}°', args: { t: item('temperature') }, formats: { t: { number: { maximumFractionDigits: 0 } } } }, { style: 'callout', align: 'center' }),
  ],
  a11y: { element: 'group', label: { type: 'expr', value: item('label') } },
});
const ghost = (id: string): J => node(id, 'stack', { props: { axis: 'vertical', spacing: space('xs'), align: 'center', padding: pad('s'), surface: { type: 'module', density: 'thin' } },
  children: [text(`${id}-n`, { type: 'math', op: 'add', args: [index, lit(1)] }, { style: 'caption2', align: 'center' })] });
export const repeat = (id: string, providerId: string, props: J, children: J[]): J => node(id, 'repeat', { props: { providerId, axis: 'horizontal', spacing: space('s'), ...words, ...props }, children });

const pages: [string, string, J[]][] = [
  ['row', 'Row of cells', [repeat('wf-hours', 'hourly', { paging: { compact: 5, regular: 8, scaleByTextSize: [1, 0.8, 0.6, 0.4], minimum: 2, indicator: true, buttons: 'regular-width', label: '12-hour feed' } }, [cell('wf-cell')])]],
  ['column', 'Column of cells', [repeat('wf-column', 'hourly', { axis: 'vertical', limit: 4 }, [cell('wf-col-cell')])]],
  ['loading', 'Waiting for the flow', [repeat('wf-wait', 'slow', { placeholder: { count: 6 } }, [cell('wf-wait-cell'), ghost('wf-wait-ghost')])]],
  ['template', 'Template with its own flow', [
    { id: 'wf-use-a', type: 'component-ref', componentId: 'wf-strip', layout: { span: 1 }, args: { place: 'weather.demo_home' } },
    { id: 'wf-use-b', type: 'component-ref', componentId: 'wf-strip', layout: { span: 1 }, args: { place: 'weather.demo_cabin' } },
  ]],
];

/** What the made-up feed answers: twelve hours from 6 PM, with a gap in the precipitation. */
export const wgflowFeed: Json = {
  type: 'hourly', forecast: Array.from({ length: 14 }, (_, at) => ({
    datetime: `2026-11-15T${String((18 + at) % 24).padStart(2, '0')}:00:00`, condition: at % 4 === 1 ? 'rainy' : at % 4 === 2 ? 'cloudy' : 'sunny', temperature: 70 - at,
    precipitation: at === 4 ? null : at % 4 === 1 ? 0.25 : 0,
  })),
};
/** The sources a repeat reads in the story: the first answers, `slow` never does. A copy a template owns is `<place>~<id>`, answered like the flow it is a copy of. */
export const wgflowRecords: UseRecords = (sourceId, inputs): RecordsAnswer => {
  if (sourceId === 'slow') return { state: 'loading', records: [] };
  const result = evaluatePipeline(inputs, wgflowFeed, { clock: { now: '2026-11-15T18:30:00', utcOffsetMinutes: 0 } });
  const output = result.status === 'ok' ? result.output as Json : null;
  return Array.isArray(output) ? { state: output.length ? 'ready' : 'empty', records: output } : { state: 'unavailable', records: [] };
};

/** The entities the story reads. */
export const wgflowStates: NativeState[] = [{ entityId: 'weather.demo_home', state: 'rainy', name: 'Home', temperature: '70' } as unknown as NativeState];

/** The home-domains document with the story's pages, a records flow, one that never answers, and a template that owns its flow, and the house it reads. */
export function wgflowStory(): { document: CompositionDocument; house: House } {
  const document = structuredClone(homeDomains.document) as unknown as CompositionDocument & Record<string, any>;
  document.navigation = { ...document.navigation, tabs: [], initialPageId: 'page-wf-row', initialTabId: null };
  document.pages = pages.map(([key, title, body]) => pageOf(`page-wf-${key}`, title, body)) as CompositionDocument['pages'];
  document.modals = [];
  document.dataSources = [flowOf('hourly', 'Hourly'), flowOf('slow', 'Slow')] as CompositionDocument['dataSources'];
  document.componentLibrary = [{
    id: 'wf-strip', name: 'Strip', node: repeat('wf-strip-repeat', 'own', { paging: { compact: 4, regular: 8, indicator: true } }, [cell('wf-strip-cell')]),
    params: [{ name: 'place', kind: 'entity-id', label: 'Place' }], flows: [flowOf('own', 'Own hourly')],
    bindings: [{ param: 'place', sourceId: 'own', field: 'inputs/request/entityId/value' }],
  }] as unknown as CompositionDocument['componentLibrary'];
  return { document, house: houseFrom({ states: wgflowStates }) };
}
