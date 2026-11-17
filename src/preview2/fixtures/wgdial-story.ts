import type { CompositionDocument } from '../../shared/composition/schema';
import type { NativeState } from '../../shared/native-state';
import { houseFrom, type House } from '../projections';
import homeDomains from './home-domains.json';

/**
 * The story of the gauge parts (lane `wg-s4`): `dial` with a lit tick at several values and with the closed needle at several headings (letters, a flag,
 * text in the middle), and `arc-track` with its marker at several progress values. One page for each, and one card composed of generic parts only. Every page
 * also exists as a light sheet (`modal-wd-<name>`, system appearance) so the parts can be seen on both grounds. Synthetic `demo_` ids only and nothing named for
 * a product. Open it at `/?preview2=1&fixture=wgdial&surface=page:page-wd-needle`.
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
const amber = pair(solid(214, 120, 0), solid(255, 159, 10)), gold = pair(solid(196, 140, 0), solid(255, 217, 77));
const title = (id: string, value: string): J => text(id, value, { style: 'footnote', ink: ink(0.6, 0.6) });

/** A dial of 49 ticks over 250 degrees, one lit, wider than tall, with a value and a unit in the middle. */
const ticksDial = (id: string, value: unknown, label: string, extra: J = {}): J => node(id, 'dial', {
  props: {
    sweep: { start: 145, length: 250 }, aspect: 1.4, centerY: 0.56, maxWidth: 180, ticks: { count: 49, inner: 0.78, outer: 0.92, width: 1.4, ink: ink(0.5, 0.5) },
    pointer: { kind: 'tick', value, inner: 0.7, outer: 0.98, width: 3, ink: amber },
    center: [
      { value: read('level', ['state']), style: 'title3', unavailableText: '-', font: { weight: 'bold', digits: 'monospaced' }, lines: 1, align: 'center', ink: ink(0.85, 0.85) },
      { value: lit('units'), style: 'caption1', unavailableText: '-', lines: 1, align: 'center', ink: ink(0.6, 0.6) },
    ], ...extra,
  }, a11y: { element: 'value', label: lit(label) },
});
/** A full turn of 48 ticks, a flag, four letters and the closed needle, at a heading in degrees. */
const needleDial = (id: string, heading: unknown, label: string, extra: J = {}): J => node(id, 'dial', {
  props: {
    sweep: { start: -90, length: 360 }, scale: 'degrees', size: { points: 104, relativeTo: 'footnote', maxPoints: 160 },
    ticks: { count: 48, inner: 0.8, outer: 0.92, width: 1.2, alternate: { inner: 0.85 }, skip: [0], ink: ink(0.55, 0.55) },
    pointer: { kind: 'needle', value: heading, ink: amber, tailInk: ink(0.55, 0.55), dotInk: ink(0.9, 1) },
    labels: { ink: ink(0.9, 1), items: [{ at: 0, text: 'N' }, { at: 0.25, text: 'E', needsValue: true }, { at: 0.5, text: 'S' }, { at: 0.75, text: 'W', needsValue: true }] },
    flag: { at: 0, ink: ink(0.9, 1) }, ...extra,
  }, a11y: { element: 'value', label: lit(label) },
});
const arc = (id: string, progress: unknown, label: string, extra: J = {}): J => node(id, 'arc-track', {
  props: {
    curve: { from: [8, 40], control: [50, 4], to: [92, 40] }, box: [100, 48], maxWidth: 200, ink: ink(0.6, 0.6), width: 2, dash: [3, 4],
    horizon: { from: [4, 40], to: [96, 40], ink: ink(0.35, 0.35), width: 1 }, progress, marker: { size: 10, ink: gold }, ...extra,
  }, a11y: { element: 'value', label: lit(label) },
});

const ticksBody = (): J[] => [
  title('wd-t-ticks', 'A lit tick at 0, a quarter, half, three quarters and the end'),
  ...[0, 0.25, 0.5, 0.75, 1].map(value => ticksDial(`wd-tick-${Math.round(value * 100)}`, lit(value), `Reading at ${Math.round(value * 100)} percent`)),
  title('wd-t-held', 'A value past the end is held at the last tick; no value lights none'),
  ticksDial('wd-tick-held', lit(1.6), 'Reading past the end'),
  ticksDial('wd-tick-none', read('missing', ['state'], 'number'), 'Reading unknown'),
];
const headings: [string, number][] = [['0', 0], ['90', 90], ['200', 200], ['350', 350]];
const needleBody = (): J[] => [
  title('wd-t-needle', 'The closed needle at headings of 0, 90, 200 and 350 degrees'),
  ...headings.map(([name, degrees]) => needleDial(`wd-needle-${name}`, lit(degrees), `Heading ${degrees} degrees`)),
  title('wd-t-needle-state', 'A heading read from an entity; with none the needle and the side letters are not drawn'),
  needleDial('wd-needle-read', read('level', ['attributes', 'heading'], 'number'), 'Heading'),
  needleDial('wd-needle-none', read('missing', ['attributes', 'heading'], 'number'), 'Heading unknown'),
];
const arcBody = (): J[] => [
  title('wd-t-arc', 'A marker at 0, a quarter, half, three quarters and the end of the arc'),
  ...[0, 0.25, 0.5, 0.75, 1].map(value => arc(`wd-arc-${Math.round(value * 100)}`, lit(value), `Progress ${Math.round(value * 100)} percent`)),
  title('wd-t-arc-state', 'Progress read from an entity, and with none the marker is hidden'),
  arc('wd-arc-read', read('level', ['attributes', 'progress'], 'number'), 'Progress'),
  arc('wd-arc-none', read('missing', ['attributes', 'progress'], 'number'), 'Progress unknown'),
];
const cardBody = (): J[] => [
  stack('wd-card', [
    stack('wd-head', [text('wd-name', 'Cellar', { style: 'headline', ink: ink(0.85, 0.85) }), text('wd-value', read('level', ['state']), { style: 'title2', font: { weight: 'bold', digits: 'monospaced' }, ink: ink(0.85, 0.85) })], { axis: 'horizontal', distribution: 'spread', align: 'center' }),
    stack('wd-row', [
      node('wd-card-dial', 'dial', { props: {
        sweep: { start: -90, length: 360 }, scale: 'degrees', size: { points: 96, relativeTo: 'footnote', maxPoints: 144 },
        ticks: { count: 48, inner: 0.8, outer: 0.92, width: 1.2, alternate: { inner: 0.85 }, skip: [0], ink: ink(0.55, 0.55) },
        pointer: { kind: 'needle', value: read('level', ['attributes', 'heading'], 'number'), ink: amber, tailInk: ink(0.55, 0.55), dotInk: ink(0.9, 1) },
        labels: { ink: ink(0.9, 1), items: [{ at: 0, text: 'N' }, { at: 0.5, text: 'S' }] }, flag: { at: 0, ink: ink(0.9, 1) },
      }, a11y: { element: 'hidden' } }),
      stack('wd-copy', [text('wd-heading', 'Heading', { style: 'footnote', ink: ink(0.6, 0.6) }), text('wd-degrees', read('level', ['attributes', 'heading']), { style: 'headline', font: { digits: 'monospaced' }, ink: ink(0.85, 0.85) })], { spacing: space('xs') }),
    ], { axis: 'horizontal', spacing: space('m'), align: 'center' }),
    arc('wd-card-arc', read('level', ['attributes', 'progress'], 'number'), 'Progress through the day'),
  ], { spacing: space('m'), padding: pad('l'), surface: { type: 'module', density: 'thin' } }),
];

const parts: [string, string, () => J[]][] = [['ticks', 'Lit tick dials', ticksBody], ['needle', 'Needle dials', needleBody], ['arc', 'Arc tracks', arcBody], ['card', 'Composed card', cardBody]];

/** The same body with every node id suffixed, for the sheet (ids are unique across the document). */
const renamed = <T,>(value: T, suffix: string): T => {
  if (Array.isArray(value)) return value.map(item => renamed(item, suffix)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'id' && typeof item === 'string' && item.startsWith('wd-') ? item + suffix : renamed(item, suffix)])) as T;
};

/** The entity the story reads: a level, a heading in degrees and a share of progress. */
export const wgdialStates: NativeState[] = [
  { entityId: 'sensor.demo_level', state: '1013', name: 'Level', heading: 245, progress: 0.62 } as unknown as NativeState,
];

/** The home-domains document with one page and one light sheet for each part, and the house they read. */
export function wgdialStory(): { document: CompositionDocument; house: House } {
  const document = structuredClone(homeDomains.document) as unknown as CompositionDocument & Record<string, any>;
  document.navigation = { ...document.navigation, tabs: [], initialPageId: 'page-wd-ticks', initialTabId: null };
  document.pages = parts.map(([key, label, body]) => pageOf(`page-wd-${key}`, label, body())) as CompositionDocument['pages'];
  document.modals = parts.map(([key, label, body]) => sheetOf(`modal-wd-${key}`, label, renamed(body(), '-l'))) as CompositionDocument['modals'];
  document.dataSources = [{ id: 'level', kind: 'ha-entity', entityId: lit('sensor.demo_level') }, { id: 'missing', kind: 'ha-entity', entityId: lit('sensor.demo_missing') }] as CompositionDocument['dataSources'];
  document.localState = [] as unknown as CompositionDocument['localState'];
  return { document, house: houseFrom({ states: wgdialStates }) };
}
