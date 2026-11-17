import type { CompositionDocument } from '../../shared/composition/schema';
import type { NativeState } from '../../shared/native-state';
import { houseFrom, type House } from '../projections';
import homeDomains from './home-domains.json';

/**
 * The story of the style parts (lane `wg-s1`): `text-style`, `stack`, `shape`, `symbol` and the segmented choice with symbols, one page for each, and one
 * card composed from generic parts only. Every page also exists as a light sheet (`modal-wg-<name>`, system appearance) so the parts can be seen on both
 * grounds. Synthetic `demo_` ids only. Open it at `/?preview2=1&fixture=wgstyle&surface=page:page-wg-stack`.
 */

type J = Record<string, any>;
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, path: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path }, as, missing: 'unavailable' });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const space = (name: string): J => ({ type: 'token', name });
const pad = (name: string): J => ({ top: space(name), leading: space(name), bottom: space(name), trailing: space(name) });
const rgba = (red: number, green: number, blue: number, alpha: number): J => ({ type: 'rgba', red, green, blue, alpha });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, value: unknown, props: J = {}): J => node(id, 'text', { props: { value: typeof value === 'string' ? lit(value) : value, style: 'body', unavailableText: 'None', ...props } });
const stack = (id: string, children: J[], props: J = {}, rest: J = {}): J => node(id, 'stack', { props: { axis: 'horizontal', spacing: space('m'), ...props }, children, ...rest });
const pageOf = (id: string, title: string, components: J[]): J => ({
  id, title, icon: symbol('house'), parameters: {}, navigation: { type: 'stack' }, toolbar: { type: 'inherit' },
  layout: { type: 'column', padding: pad('l'), spacing: space('l'), maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host' }, components,
});
const sheetOf = (id: string, title: string, components: J[]): J => ({
  ...(({ navigation: _navigation, ...rest }) => rest)(pageOf(id, title, components)), toolbar: { type: 'replace', groups: [] }, presentation: { type: 'sheet', width: 'page', height: { type: 'full' }, appearance: 'system', placement: 'canonical-sheet@1', grabber: 'canonical', navigation: 'local-stack@1',
    close: { type: 'close', visibility: 'all-depths', placement: 'trailing', rail: 'automatic', guard: { type: 'none' } } },
});

const white = rgba(255, 255, 255, 0.85);
const pair = (lightInk: J, darkInk: J): J => ({ type: 'solid-appearance', light: lightInk, dark: darkInk });
/** An ink that reads on both grounds: black at 70% on light, white at 85% on dark. */
const adaptive = pair(rgba(0, 0, 0, 0.7), white);
const sentence = 'Light rain this afternoon with a chance of thunder after dark.';

const textBody = (): J[] => [
  text('wg-large', '72°', { style: 'large-title', font: { weight: 'thin', digits: 'monospaced', scale: { points: 76, relativeTo: 'large-title', maxPoints: 96 } }, ink: adaptive }),
  text('wg-title', 'Title 1', { style: 'title1', ink: adaptive }), text('wg-title2', 'Title 2', { style: 'title2', ink: adaptive }), text('wg-title3', 'Title 3', { style: 'title3', ink: adaptive }),
  text('wg-callout', 'Callout', { style: 'callout', ink: adaptive }), text('wg-caption', 'Caption 2', { style: 'caption2', ink: adaptive }),
  text('wg-faint', 'An ink with opacity', { style: 'body', ink: pair(rgba(0, 0, 0, 0.35), rgba(255, 255, 255, 0.4)) }),
  text('wg-two', sentence + ' ' + sentence, { style: 'body', lines: 2, align: 'center', overflow: 'wrap', ink: adaptive }),
  text('wg-ticker', sentence, { style: 'body', lines: 1, overflow: 'ticker', ink: adaptive }),
];

/** The same body with every node id suffixed, for the sheet (ids are unique across the document). */
const renamed = <T,>(value: T, suffix: string): T => {
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' && item.startsWith('wg-') ? item + suffix : renamed(item, suffix)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'id' && typeof item === 'string' && item.startsWith('wg-') ? item + suffix : renamed(item, suffix)])) as T;
};

const header = (at = ''): J => renamed(stack('wg-header', [
  text('wg-temp', read('weather', ['attributes', 'temperature']), { style: 'large-title', font: { weight: 'thin', digits: 'monospaced' }, ink: adaptive }),
  node('wg-glyph', 'symbol', { props: { name: { type: 'bound-symbol', fallback: symbol('cloud.fill'), value: { type: 'map', of: read('weather', ['state']), cases: [{ equals: 'rainy', then: lit('cloud.rain') }], otherwise: lit('cloud.fill') } }, size: { points: 34, relativeTo: 'title1', maxScale: 1.6 }, rendering: 'multicolor' }, a11y: { element: 'hidden' } }),
  text('wg-range', 'High 74° and low 61° with light rain through the evening', { style: 'callout', overflow: 'truncate', lines: 2, ink: adaptive }),
], {
  spacing: space('m'),
  groups: [{ children: ['wg-temp', 'wg-glyph'], spacing: space('s'), align: 'center' }, { children: ['wg-range'], grow: true, align: 'end' }],
  collapse: { to: 'vertical', when: ['accessibility-size', 'overflow'], fits: ['wg-range'], spacing: space('s'), groups: [{ children: ['wg-temp', 'wg-glyph'], distribution: 'spread', align: 'center' }, { children: ['wg-range'] }] },
}), at);

const stackBody = (): J[] => [
  header(),
  stack('wg-module', [text('wg-m1', 'First', { ink: adaptive }), text('wg-m2', 'Second', { ink: adaptive }), text('wg-m3', 'Third', { ink: adaptive })],
    { axis: 'vertical', spacing: space('s'), padding: pad('m'), surface: { type: 'module', density: 'thin' }, dividers: { ink: pair(rgba(0, 0, 0, 0.14), rgba(255, 255, 255, 0.14)), width: 1 } }),
  stack('wg-pressable', [text('wg-p1', 'Forecast', { ink: adaptive }), node('wg-p2', 'symbol', { props: { name: symbol('chevron.right'), size: { points: 16 }, rendering: 'monochrome' }, a11y: { element: 'hidden' } })],
    { spacing: space('m'), padding: pad('m'), surface: { type: 'module', density: 'thin' } },
    { action: { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.demo_lamp') } }, a11y: { element: 'group', role: 'button', label: lit('Open the forecast') } }),
];

const partsBody = (): J[] => [
  stack('wg-shapes', [
    node('wg-capsule', 'shape', { props: { form: 'capsule', width: 56, height: 14, fill: pair(rgba(0, 0, 0, 0.25), rgba(255, 255, 255, 0.3)) } }),
    node('wg-circle', 'shape', { props: { form: 'circle', width: 32, height: 32, fill: pair(rgba(0, 0, 0, 0.25), rgba(255, 255, 255, 0.3)) } }),
    node('wg-rect', 'shape', { props: { form: 'rect', width: 40, height: 24, fill: pair(rgba(0, 0, 0, 0.25), rgba(255, 255, 255, 0.3)) } }),
  ], { spacing: space('l') }),
  stack('wg-symbols', [
    node('wg-sym-multi', 'symbol', { props: { name: symbol('cloud.sun'), size: { points: 44 }, rendering: 'multicolor' }, a11y: { element: 'hidden' } }),
    node('wg-sym-tint', 'symbol', { props: { name: symbol('thermometer.sun'), size: { points: 44 }, rendering: 'monochrome', tint: pair(rgba(0, 0, 0, 0.7), white) }, a11y: { element: 'hidden' } }),
    node('wg-sym-turn', 'symbol', { props: { name: symbol('arrow.up'), size: { points: 44 }, rendering: 'monochrome', tint: pair(rgba(0, 0, 0, 0.7), white), rotate: read('weather', ['attributes', 'wind_bearing'], 'number') }, a11y: { element: 'image', label: lit('Wind direction') } }),
    node('wg-sym-scaled', 'symbol', { props: { name: symbol('cloud.rain'), size: { points: 44, relativeTo: 'title1', maxScale: 1.6 }, rendering: 'monochrome', tint: pair(rgba(0, 0, 0, 0.7), white) }, a11y: { element: 'hidden' } }),
  ], { spacing: space('l') }),
];

const choiceBody = (): J[] => [
  node('wg-seg', 'local-control', { props: { stateId: 'wg-mode', kind: 'segmented-choice', placeholder: '' } }),
];

const cardBody = (): J[] => [
  stack('wg-card', [
    header('-card'),
    stack('wg-rule', [], { axis: 'vertical', spacing: space('zero'), dividers: { ink: pair(rgba(0, 0, 0, 0.14), rgba(255, 255, 255, 0.14)), width: 1 } }),
    stack('wg-days', ['Mon', 'Tue', 'Wed', 'Thu'].map((day, at) => stack(`wg-day-${at}`, [
      text(`wg-day-name-${at}`, day, { style: 'caption2', ink: adaptive, align: 'center' }),
      node(`wg-day-sym-${at}`, 'symbol', { props: { name: symbol(at % 2 ? 'cloud.rain' : 'cloud.sun'), size: { points: 26 }, rendering: 'multicolor' }, a11y: { element: 'hidden' } }),
      text(`wg-day-hi-${at}`, `${70 + at}°`, { style: 'callout', ink: adaptive, align: 'center' }),
    ], { axis: 'vertical', spacing: space('xs') })), { spacing: space('l') }),
  ], { axis: 'vertical', spacing: space('m'), padding: pad('l'), surface: { type: 'module', density: 'thin' } }),
];

const parts: [string, string, () => J[]][] = [
  ['text', 'Text style', textBody], ['stack', 'Stack', stackBody], ['parts', 'Shape and symbol', partsBody], ['choice', 'Choice icons', choiceBody], ['card', 'Composed card', cardBody],
];

/** The entities the story reads. */
export const wgstyleStates: NativeState[] = [
  { entityId: 'weather.demo_home', state: 'rainy', name: 'Home', temperature: '72', windBearing: 90 } as unknown as NativeState,
  { entityId: 'sun.demo_sun', state: 'above_horizon', name: 'Sun' },
];

/** The home-domains document with one page and one light sheet for each part, and the house they read. */
export function wgstyleStory(): { document: CompositionDocument; house: House } {
  const document = structuredClone(homeDomains.document) as unknown as CompositionDocument & Record<string, any>;
  document.navigation = { ...document.navigation, tabs: [], initialPageId: 'page-wg-text', initialTabId: null };
  document.pages = parts.map(([key, title, body]) => pageOf(`page-wg-${key}`, title, body())) as CompositionDocument['pages'];
  document.modals = parts.map(([key, title, body]) => sheetOf(`modal-wg-${key}`, title, renamed(body(), '-l'))) as CompositionDocument['modals'];
  document.dataSources = [{ id: 'weather', kind: 'ha-entity', entityId: lit('weather.demo_home') }, { id: 'sun', kind: 'ha-entity', entityId: lit('sun.demo_sun') }] as CompositionDocument['dataSources'];
  document.localState = [{ id: 'wg-mode', type: 'choice', initial: 'temperature', options: [
    { id: 'temperature', label: 'Temperature', symbol: symbol('thermometer.sun'), hint: 'Shows the temperature.' },
    { id: 'rain', label: 'Rain', symbol: symbol('cloud.rain'), hint: 'Shows the chance of rain.' },
    { id: 'wind', label: 'Wind', symbol: symbol('arrow.up'), hint: 'Shows the wind.' }] }] as CompositionDocument['localState'];
  return { document, house: houseFrom({ states: wgstyleStates }) };
}
