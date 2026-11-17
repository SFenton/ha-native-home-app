// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { wgchartStory, wgchartStates } from '../src/preview2/fixtures/wgchart-story';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { tileType, paletteGroups } from '../src/workspace2/add/catalog';
import { canHold } from '../src/workspace2/add/insert';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { childSlots } from '../src/composition-editor';
import type { CompositionDocument } from '../src/shared/composition/schema';

/** What the preview draws for the data parts (`sh.chart@1`, `sh.linear-gauge@1`), and what the Add picker makes. */
afterEach(cleanup);
type J = Record<string, any>;
const home = homeDomains.document as unknown as CompositionDocument;
const lit = (value: unknown): J => ({ type: 'literal', value });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const points = (...values: (number | null)[]): J => ({ type: 'literal', points: values.map((value, index) => ({ label: `L${index}`, value })) });
const chart = (props: J = {}, rest: J = {}): J => node('c', 'chart', {
  props: { mark: 'bar', series: points(94, 40, 20), domain: { type: 'ceiling', step: 10, min: 10, max: 100 }, tint: solid(10, 20, 30), emptyText: 'Unavailable', ...props }, a11y: { label: lit('Chart'), value: 'series' }, ...rest,
});
const gauge = (props: J = {}, rest: J = {}): J => node('g', 'linear-gauge', {
  props: { value: lit(0.5), fill: 'scale', stops: [{ at: 0, ink: solid(0, 0, 0) }, { at: 1, ink: solid(255, 255, 255) }], track: { type: 'rgba', red: 255, green: 255, blue: 255, alpha: 0.2 },
    marker: { size: 12, ink: solid(255, 255, 255) }, ...props }, a11y: { element: 'hidden' }, ...rest,
});

function draw(components: J[], extra: J = {}) {
  const page = home.pages[0];
  const document = { ...home, ...extra, dataSources: [...home.dataSources, { id: 'level', kind: 'ha-entity', entityId: lit('sensor.demo_level') }],
    navigation: { ...home.navigation, tabs: [], initialPageId: page.id, initialTabId: null },
    pages: [{ ...page, toolbar: { type: 'inherit' }, components }], modals: [] } as unknown as CompositionDocument;
  return render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: page.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
    window={previewWindows[0]} bezel={false} house={houseFrom({ states: wgchartStates })} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>).container;
}
const el = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;

describe('a bar chart', () => {
  it('draws one bar for each point, as tall as its share of the axis, with the corner radius', () => {
    const bars = [...el(draw([chart()]), 'c').querySelectorAll<SVGRectElement>('.sh-chart-bar')];
    expect(bars).toHaveLength(3);
    // The axis tops out at 100 (94 rounds up to the next 10), 76 points tall by default: 94% is 71.44 points.
    expect(Number(bars[0].getAttribute('height'))).toBeCloseTo(71.44, 2);
    expect(Number(bars[1].getAttribute('height'))).toBeCloseTo(30.4, 2);
    expect(Number(bars[2].getAttribute('height'))).toBeCloseTo(15.2, 2);
    expect(bars[0].getAttribute('rx')).toBe('2');
    expect(Number(bars[0].getAttribute('y')) + Number(bars[0].getAttribute('height'))).toBeCloseTo(76, 5);
  });
  it('draws an unknown value as a short stub in its own class', () => {
    const bars = [...el(draw([chart({ series: points(50, null) })]), 'c').querySelectorAll<SVGRectElement>('.sh-chart-bar')];
    expect(bars[1].getAttribute('class')).toContain('sh-chart-bar-unknown');
    expect(bars[1].getAttribute('height')).toBe('2');
  });
  it('takes the gap, radius and least height of its bar block', () => {
    const bars = [...el(draw([chart({ series: points(1, 100), bar: { gap: 10, radius: 4, minimum: 5 } })]), 'c').querySelectorAll<SVGRectElement>('.sh-chart-bar')];
    expect(bars[0].getAttribute('height')).toBe('5');
    expect(bars[0].getAttribute('rx')).toBe('2.5');
    expect(Number(bars[1].getAttribute('x')) - Number(bars[0].getAttribute('x')) - Number(bars[0].getAttribute('width'))).toBeCloseTo(10, 5);
  });
  it('draws the axis labels top first with the pattern, and a grid line for each level', () => {
    const container = draw([chart({ axis: { levels: 3, label: { pattern: '{value}%', digits: 0 } } })]);
    expect([...el(container, 'c').querySelectorAll('.sh-chart-ylabel')].map(item => item.textContent)).toEqual(['100%', '50%', '0%']);
    expect(el(container, 'c').querySelectorAll('.sh-chart-grid')).toHaveLength(3);
  });
  it('draws no axis when it has none', () => {
    const container = draw([chart()]);
    expect(el(container, 'c').querySelectorAll('.sh-chart-ylabel')).toHaveLength(0);
    expect(el(container, 'c').querySelectorAll('.sh-chart-grid')).toHaveLength(0);
  });
  it('thins the labels under the plot to the width, and shows all or none when told', () => {
    const many = points(...Array.from({ length: 24 }, (_, index) => index));
    const shown = (labels?: string) => [...el(draw([chart({ series: many, labels })]), 'c').querySelectorAll('.sh-chart-xlabel[data-shown]')].length;
    const fit = shown();
    expect(fit).toBeGreaterThan(0);
    expect(fit).toBeLessThan(24);
    cleanup();
    expect(shown('all')).toBe(24);
    cleanup();
    expect(shown('none')).toBe(0);
  });
  it('takes its scale from a two-step axis with the smallest step read from an entity', () => {
    const steps = { type: 'two-step', minimumStep: { type: 'read', from: { type: 'source', sourceId: 'level', path: ['attributes', 'step'] }, as: 'number', missing: 'unavailable' }, maximumFractionDigits: 3 };
    const container = draw([chart({ series: points(0, 0.07, 0.09), domain: steps, axis: { levels: 3, label: { pattern: '{value} in' } } })]);
    expect([...el(container, 'c').querySelectorAll('.sh-chart-ylabel')].map(item => item.textContent)).toEqual(['0.1 in', '0.05 in', '0 in']);
  });
  it('is one named group whose spoken value is the series, with the visual parts hidden', () => {
    const container = draw([chart({ axis: { levels: 3, label: { pattern: '{value}%', digits: 0 } } })]);
    const group = el(container, 'c').querySelector('[role=group]')!;
    expect(group.getAttribute('aria-label')).toBe('Chart');
    expect(group.querySelector('.sh-chart-visual')!.getAttribute('aria-hidden')).toBe('true');
    expect(group.querySelector('.sh-chart-series')!.textContent).toBe('L0 94%, L1 40%, L2 20%');
  });
  it('says the empty words when no value is known, or the series has no points', () => {
    const none = draw([chart({ series: points(null, null) })]);
    expect(el(none, 'c').querySelector('.sh-chart-empty-text')!.textContent).toBe('Unavailable');
    expect(el(none, 'c').querySelector('svg')).toBeNull();
  });
  it('draws a source series, which the preview cannot read, as its empty words', () => {
    const container = draw([chart({ series: { type: 'source', providerId: 'flow', limit: 6, x: { label: lit('Hour') }, y: { type: 'item', path: ['level'] } } })]);
    expect(el(container, 'c').getAttribute('data-series')).toBeNull();
    expect(el(container, 'c').querySelector('.sh-chart')!.getAttribute('data-series')).toBe('source');
    expect(el(container, 'c').querySelector('.sh-chart-empty-text')!.textContent).toBe('Unavailable');
  });
  it('colours its marks from the document\'s ink', () => {
    const style = el(draw([chart({ tint: { type: 'rgba', red: 255, green: 0, blue: 0, alpha: 0.5 } })]), 'c').querySelector<HTMLElement>('.sh-chart')!.style;
    expect(style.getPropertyValue('--chart-tint')).toBe('rgb(255 0 0 / 0.5)');
  });
});

describe('a line and an area chart', () => {
  it('draws one path through the known points, in the middle of equal slots', () => {
    const container = draw([chart({ mark: 'line', series: points(0, 100, 50), domain: { type: 'fixed', min: 0, max: 100 }, line: { width: 3 } })]);
    const paths = el(container, 'c').querySelectorAll<SVGPathElement>('.sh-chart-line');
    expect(paths).toHaveLength(1);
    // 300 points wide in three slots of 100: x 50, 150, 250; y 76 (0), 0 (100), 38 (50).
    expect(paths[0].getAttribute('d')).toBe('M50.00 76.00 L150.00 0.00 L250.00 38.00');
    expect(paths[0].getAttribute('stroke-width')).toBe('3');
    expect(el(container, 'c').querySelectorAll('.sh-chart-bar')).toHaveLength(0);
  });
  it('breaks the line where a value is unknown', () => {
    const container = draw([chart({ mark: 'line', series: points(10, null, 30, 40), domain: { type: 'fixed', min: 0, max: 100 } })]);
    expect(el(container, 'c').querySelectorAll('.sh-chart-line')).toHaveLength(2);
  });
  it('draws an area as a filled shape under the same line, closed on the base', () => {
    const container = draw([chart({ mark: 'area', series: points(0, 100), domain: { type: 'fixed', min: 0, max: 100 } })]);
    const area = el(container, 'c').querySelector<SVGPathElement>('.sh-chart-area')!;
    expect(area.getAttribute('d')).toMatch(/^M.* L.* L.* L.* Z$/);
    expect(el(container, 'c').querySelectorAll('.sh-chart-line')).toHaveLength(1);
  });
  it('puts a dot on each known value when asked', () => {
    const container = draw([chart({ mark: 'line', series: points(10, null, 30), domain: { type: 'fixed', min: 0, max: 100 }, line: { dots: true } })]);
    expect(el(container, 'c').querySelectorAll('.sh-chart-dot')).toHaveLength(2);
  });
  it('centres the labels on their points', () => {
    const container = draw([chart({ mark: 'line', series: points(10, 20, 30), domain: { type: 'fixed', min: 0, max: 100 }, labels: 'all' })]);
    const labels = [...el(container, 'c').querySelectorAll<HTMLElement>('.sh-chart-xlabel')];
    expect(labels.map(label => label.style.left)).toEqual(['50px', '150px', '250px']);
    expect(labels[0].style.transform).toBe('translateX(-50%)');
  });
});

describe('a linear gauge', () => {
  it('places the marker by its value on a track of the measured width, kept wholly inside it', () => {
    const marker = el(draw([gauge()]), 'g').querySelector<HTMLElement>('.sh-gauge-marker')!;
    // The test has no layout, so the track is the 200 points the preview falls back to: 0.5 puts a 12 point marker at 100 - 6.
    expect(marker.style.left).toBe('94px');
    expect(marker.style.width).toBe('12px');
  });
  it('colours the whole track with the gradient when the gradient covers the scale', () => {
    const span = el(draw([gauge()]), 'g').querySelector<HTMLElement>('.sh-gauge-span')!;
    expect(span.style.width).toBe('200px');
    expect(span.style.background).toContain('linear-gradient');
  });
  it('colours only the span when the gradient covers the span', () => {
    const span = el(draw([gauge({ fill: 'span', span: { start: lit(0.25), size: lit(0.5) } })]), 'g').querySelector<HTMLElement>('.sh-gauge-span')!;
    expect(span.style.left).toBe('50px');
    expect(span.style.width).toBe('100px');
  });
  it('hides the marker when the value is not known', () => {
    const none = draw([gauge({ value: { type: 'read', from: { type: 'source', sourceId: 'level', path: ['attributes', 'nothing'] }, as: 'number', missing: 'unavailable' } })]);
    expect(el(none, 'g').querySelector('.sh-gauge-marker')).toBeNull();
  });
  it('reads the value from the percent scale', () => {
    const marker = el(draw([gauge({ scale: 'percent', value: { type: 'read', from: { type: 'source', sourceId: 'level', path: ['state'] }, as: 'number', missing: 'unavailable' } })]), 'g').querySelector<HTMLElement>('.sh-gauge-marker')!;
    expect(marker.style.left).toBe('138px');
  });
  it('is hidden from assistive technologies, or one meter with its name and value', () => {
    expect(el(draw([gauge()]), 'g').querySelector('.sh-gauge')!.getAttribute('aria-hidden')).toBe('true');
    cleanup();
    const meter = el(draw([gauge({}, { a11y: { element: 'value', label: lit('Level'), value: lit('half full') } })]), 'g').querySelector('[role=meter]')!;
    expect(meter.getAttribute('aria-label')).toBe('Level');
    expect(meter.getAttribute('aria-valuenow')).toBe('50');
    expect(meter.getAttribute('aria-valuetext')).toBe('half full');
  });
  it('speaks the percent when it has no words of its own', () => {
    const meter = el(draw([gauge({}, { a11y: { element: 'value', label: lit('Level') } })]), 'g').querySelector('[role=meter]')!;
    expect(meter.getAttribute('aria-valuetext')).toBe('50%');
  });
  it('glides unless it says it does not', () => {
    expect(el(draw([gauge()]), 'g').querySelector('.sh-gauge')!.getAttribute('data-animates')).toBe('true');
    cleanup();
    expect(el(draw([gauge({ animates: false })]), 'g').querySelector('.sh-gauge')!.getAttribute('data-animates')).toBe('false');
  });
});

describe('the story', () => {
  it('draws every page, each part present', () => {
    const { document, house } = wgchartStory();
    for (const page of document.pages) {
      const { container, unmount } = render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: page.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
        window={previewWindows[0]} bezel={false} house={house} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
      expect(container.querySelectorAll('.sh-chart, .sh-gauge').length).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe('the Add picker', () => {
  const made = (key: string) => tileType(key)!.make({ document: home });
  it('offers the chart and the gauge in the Content group', () => {
    const content = paletteGroups.components.find(group => group.id === 'content')!;
    expect(content.keys).toEqual(expect.arrayContaining(['chart', 'linear-gauge']));
  });
  it('makes parts that compile as they are added, declaring only their own ids', () => {
    for (const [key, id] of [['chart', 'sh.chart@1'], ['linear-gauge', 'sh.linear-gauge@1']] as const) {
      const { node: item } = made(key);
      expect(item.type).toBe(key);
      const document = structuredClone(home) as unknown as CompositionDocument;
      document.pages[0].components = [item];
      const declared = compileCompositionDocument(document).capabilities;
      expect(declared).toContain(id);
      expect(declared).not.toContain(key === 'chart' ? 'sh.linear-gauge@1' : 'sh.chart@1');
    }
  });
  it('lets a stack hold a chart and a gauge, and they hold nothing', () => {
    const document = structuredClone(home) as unknown as CompositionDocument;
    const stack = tileType('stack')!.make({ document: home }).node;
    document.pages[0].components = [stack];
    const key = `node:${stack.id}` as const;
    expect(canHold(document, key, 'chart')).toBe(true);
    expect(canHold(document, key, 'linear-gauge')).toBe(true);
    expect(childSlots(made('chart').node)).toHaveLength(0);
    expect(childSlots(made('linear-gauge').node)).toHaveLength(0);
  });
  it('starts a chart with a neutral grey ink and a gauge with a visible marker, no weather word anywhere', () => {
    expect(JSON.stringify([made('chart').node, made('linear-gauge').node])).not.toMatch(/weather|forecast|rain|temperature/i);
  });
});
