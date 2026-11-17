// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { wgdialStates, wgdialStory } from '../src/preview2/fixtures/wgdial-story';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { tileType, paletteGroups } from '../src/workspace2/add/catalog';
import { canHold } from '../src/workspace2/add/insert';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { childSlots } from '../src/composition-editor';
import type { CompositionDocument } from '../src/shared/composition/schema';

/** What the preview draws for the gauge parts (`sh.dial@1`, `sh.arc-track@1`), and what the Add picker makes. */
afterEach(cleanup);
type J = Record<string, any>;
const home = homeDomains.document as unknown as CompositionDocument;
const lit = (value: unknown): J => ({ type: 'literal', value });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const read = (path: string[], as = 'number'): J => ({ type: 'read', from: { type: 'source', sourceId: 'level', path }, as, missing: 'unavailable' });
const dial = (props: J = {}, rest: J = {}): J => node('d', 'dial', {
  props: { sweep: { start: 145, length: 250 }, aspect: 1.4, centerY: 0.56, ticks: { count: 49, inner: 0.78, outer: 0.92, width: 1.4, ink: solid(10, 20, 30) },
    pointer: { kind: 'tick', value: lit(0.5), inner: 0.7, outer: 0.98, width: 3, ink: solid(255, 159, 10) }, ...props }, a11y: { element: 'hidden' }, ...rest,
});
const needle = (value: J = lit(90), props: J = {}, rest: J = {}): J => dial({
  sweep: { start: -90, length: 360 }, scale: 'degrees', aspect: undefined, centerY: undefined,
  ticks: { count: 48, inner: 0.8, outer: 0.92, width: 1.2, alternate: { inner: 0.85 }, skip: [0], ink: solid(10, 20, 30) },
  pointer: { kind: 'needle', value, ink: solid(255, 159, 10), tailInk: solid(1, 2, 3), dotInk: solid(4, 5, 6) },
  labels: { ink: solid(255, 255, 255), items: [{ at: 0, text: 'N' }, { at: 0.25, text: 'E', needsValue: true }, { at: 0.5, text: 'S' }, { at: 0.75, text: 'W', needsValue: true }] },
  flag: { at: 0, ink: solid(255, 255, 255) }, ...props,
}, rest);
const arc = (props: J = {}, rest: J = {}): J => node('a', 'arc-track', {
  props: { curve: { from: [8, 40], control: [50, 4], to: [92, 40] }, box: [100, 48], maxWidth: 200, ink: solid(10, 20, 30), width: 2, dash: [3, 4],
    horizon: { from: [4, 40], to: [96, 40], ink: solid(1, 1, 1), width: 1 }, progress: lit(0.5), marker: { size: 10, ink: solid(255, 217, 77) }, ...props }, a11y: { element: 'hidden' }, ...rest,
});

function draw(components: J[], states = wgdialStates) {
  const page = home.pages[0];
  const document = { ...home, dataSources: [...home.dataSources, { id: 'level', kind: 'ha-entity', entityId: lit('sensor.demo_level') }],
    navigation: { ...home.navigation, tabs: [], initialPageId: page.id, initialTabId: null },
    pages: [{ ...page, toolbar: { type: 'inherit' }, components }], modals: [] } as unknown as CompositionDocument;
  return render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: page.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
    window={previewWindows[0]} bezel={false} house={houseFrom({ states })} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>).container;
}
const el = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;
/** The test has no layout, so a dial is the 140 points the preview falls back to, and an arc the 200. */
const num = (value: string | null) => Number(value);

describe('a dial with a lit tick', () => {
  it('draws one ring of ticks and lights the tick the value says, between the radii', () => {
    const container = el(draw([dial()]), 'd');
    const path = container.querySelector('.sh-dial-ticks')!.getAttribute('d')!;
    expect(path.match(/M/g)).toHaveLength(49);
    // 140 wide and 100 tall, the centre at (70, 56): a half is straight up, 0.7 and 0.98 of 70 above it.
    expect(container.querySelector('.sh-dial-lit')!.getAttribute('d')).toBe('M70 7L70 -12.6');
    expect(container.querySelector('svg')!.getAttribute('height')).toBe('100');
  });
  it('colours the ring, the lit tick and the widths from the document\'s inks', () => {
    const container = el(draw([dial()]), 'd');
    const ticks = container.querySelector<SVGElement>('.sh-dial-ticks')!.style, lit = container.querySelector<SVGElement>('.sh-dial-lit')!.style;
    expect(ticks.stroke).toBe('rgb(10 20 30)');
    expect(ticks.strokeWidth).toBe('1.4');
    expect(lit.stroke).toBe('rgb(255 159 10)');
    expect(lit.strokeWidth).toBe('3');
  });
  it('lights none when the value is not known, and holds a value past the end', () => {
    const none = draw([dial({ pointer: { kind: 'tick', value: read(['attributes', 'nothing']), inner: 0.7, outer: 0.98, width: 3, ink: solid(1, 2, 3) } })]);
    expect(el(none, 'd').querySelector('.sh-dial-lit')).toBeNull();
    cleanup();
    const held = el(draw([dial({ pointer: { kind: 'tick', value: lit(7), inner: 0.7, outer: 0.98, width: 3, ink: solid(1, 2, 3) } })]), 'd');
    expect(held.querySelector('.sh-dial')!.getAttribute('data-share')).toBe('1');
  });
  it('reads the value from an entity', () => {
    const container = el(draw([dial({ scale: 'percent', pointer: { kind: 'tick', value: read(['attributes', 'progress']), inner: 0.7, outer: 0.98, width: 3, ink: solid(1, 2, 3) } })]), 'd');
    // progress is 0.62 on the percent scale: 0.0062 of the sweep.
    expect(num(container.querySelector('.sh-dial')!.getAttribute('data-share'))).toBeCloseTo(0.0062, 6);
  });
  it('puts the lines of text in the middle, aria-hidden, over the centre of the dial', () => {
    const container = el(draw([dial({ center: [{ value: read(['state'], 'string'), style: 'title3', unavailableText: '-' }, { value: lit('units'), style: 'caption1', unavailableText: '-' }] })]), 'd');
    const middle = container.querySelector<HTMLElement>('.sh-dial-center')!;
    expect(middle.textContent).toBe('1013units');
    expect(middle.getAttribute('aria-hidden')).toBe('true');
    expect([middle.style.left, middle.style.top]).toEqual(['70px', '56px']);
  });
});

describe('a dial with the needle', () => {
  it('turns the needle by the heading: the head down at 0, a quarter at 90', () => {
    const at = (value: J) => { const container = el(draw([needle(value)]), 'd'); const turn = container.querySelector<SVGElement>('.sh-dial-needle')!.style.transform; cleanup(); return turn; };
    expect(at(lit(0))).toContain('rotate(0deg)');
    expect(at(lit(90))).toContain('rotate(90deg)');
    expect(at(lit(-10))).toContain('rotate(350deg)');
    expect(at(lit(360))).toContain('rotate(0deg)');
  });
  it('is one closed shape: a head, a tail and a dot in three inks', () => {
    const body = el(draw([needle()]), 'd').querySelector('.sh-dial-needle')!;
    expect(body.querySelectorAll('polygon')).toHaveLength(2);
    expect(body.querySelectorAll('circle')).toHaveLength(1);
    expect(body.querySelectorAll<SVGElement>('polygon')[0].style.fill).toBe('rgb(255 159 10)');
    expect(body.querySelectorAll<SVGElement>('polygon')[1].style.fill).toBe('rgb(1 2 3)');
    expect(body.querySelector<SVGElement>('circle')!.style.fill).toBe('rgb(4 5 6)');
  });
  it('draws four letters with a heading, and N and S only without one, and the flag and the 47 ticks either way', () => {
    const letters = (container: HTMLElement) => [...container.querySelectorAll('.sh-dial-letter')].map(item => item.textContent);
    const some = el(draw([needle()]), 'd');
    expect(letters(some)).toEqual(['N', 'E', 'S', 'W']);
    cleanup();
    const none = el(draw([needle(read(['attributes', 'nothing']))]), 'd');
    expect(letters(none)).toEqual(['N', 'S']);
    expect(none.querySelector('.sh-dial-needle')).toBeNull();
    expect(none.querySelectorAll('.sh-dial-flag')).toHaveLength(1);
    expect(none.querySelector('.sh-dial-ticks')!.getAttribute('d')!.match(/M/g)).toHaveLength(47);
  });
  it('sizes the letters at a fifth of the radius, 14 points at 140 wide', () => {
    const letter = el(draw([needle()]), 'd').querySelector('.sh-dial-letter')!;
    expect(letter.getAttribute('font-size')).toBe('14');
  });
  it('turns the short way round: from 350 to 10 goes on to 370, not back 340, and from 10 to 350 goes back to -10', () => {
    const documentOf = (components: J[]) => {
      const page = home.pages[0];
      return { ...home, dataSources: [...home.dataSources, { id: 'level', kind: 'ha-entity', entityId: lit('sensor.demo_level') }],
        navigation: { ...home.navigation, tabs: [], initialPageId: page.id, initialTabId: null },
        pages: [{ ...page, toolbar: { type: 'inherit' }, components }], modals: [] } as unknown as CompositionDocument;
    };
    const tree = (heading: number) => <Preview2 document={documentOf([needle(lit(heading))])} mode="use" surface={{ kind: 'page', id: home.pages[0].id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
      window={previewWindows[0]} bezel={false} house={houseFrom({ states: wgdialStates })} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>;
    const { container, rerender } = render(tree(350));
    const turn = () => el(container, 'd').querySelector<SVGElement>('.sh-dial-needle')!.style.transform;
    expect(turn()).toContain('rotate(350deg)');
    rerender(tree(10));
    expect(turn()).toContain('rotate(370deg)');
    rerender(tree(350));
    expect(turn()).toContain('rotate(350deg)');
    rerender(tree(200));
    expect(turn()).toContain('rotate(200deg)');
  });
  it('glides unless it says it does not turn', () => {
    expect(el(draw([needle()]), 'd').querySelector('.sh-dial')!.getAttribute('data-animates')).toBe('true');
    cleanup();
    const still = needle(lit(90), { pointer: { kind: 'needle', value: lit(90), ink: solid(1, 1, 1), tailInk: solid(2, 2, 2), dotInk: solid(3, 3, 3), animates: false } });
    expect(el(draw([still]), 'd').querySelector('.sh-dial')!.getAttribute('data-animates')).toBe('false');
  });
});

describe('in a right-to-left layout', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('keeps a dial where it is, mirrors one that says so, and mirrors an arc unless it says not', () => {
    // jsdom does not cascade `direction`, so the element reports right to left as a browser would under `dir=rtl`.
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((target, pseudo) => new Proxy(original(target, pseudo), { get: (style, key) => key === 'direction' ? 'rtl' : Reflect.get(style, key) }));
    const lit0 = (components: J[]) => { const container = draw(components); return container; };
    const plain = el(lit0([dial({ pointer: { kind: 'tick', value: lit(0), inner: 0.7, outer: 0.98, width: 3, ink: solid(1, 2, 3) } })]), 'd');
    expect(plain.querySelector('.sh-dial-lit')!.getAttribute('d')).toBe('M29.8615 84.1052L13.8062 95.3473');
    cleanup();
    const flipped = el(lit0([dial({ mirrors: true, pointer: { kind: 'tick', value: lit(0), inner: 0.7, outer: 0.98, width: 3, ink: solid(1, 2, 3) } })]), 'd');
    expect(flipped.querySelector('.sh-dial-lit')!.getAttribute('d')).toBe('M110.1385 84.1052L126.1938 95.3473');
    cleanup();
    expect(el(lit0([arc({ progress: lit(0) })]), 'a').querySelector('.sh-arc-marker')!.getAttribute('cx')).toBe('184');
    cleanup();
    expect(el(lit0([arc({ progress: lit(0), mirrors: false })]), 'a').querySelector('.sh-arc-marker')!.getAttribute('cx')).toBe('16');
  });
});

describe('a dial for assistive technologies', () => {
  it('is hidden, or one meter with its name and value, the text in the middle left out', () => {
    expect(el(draw([dial()]), 'd').querySelector('.sh-dial')!.getAttribute('aria-hidden')).toBe('true');
    cleanup();
    const meter = el(draw([dial({}, { a11y: { element: 'value', label: lit('Level'), value: lit('steady') } })]), 'd').querySelector('[role=meter]')!;
    expect(meter.getAttribute('aria-label')).toBe('Level');
    expect(meter.getAttribute('aria-valuenow')).toBe('50');
    expect(meter.getAttribute('aria-valuetext')).toBe('steady');
  });
  it('speaks the percent when it has no words of its own, and nothing when it has no value', () => {
    const percent = el(draw([dial({}, { a11y: { element: 'value', label: lit('Level') } })]), 'd').querySelector('[role=meter]')!;
    expect(percent.getAttribute('aria-valuetext')).toBe('50%');
    cleanup();
    const none = el(draw([dial({ pointer: { kind: 'tick', value: read(['attributes', 'nothing']), inner: 0.7, outer: 0.98, width: 3, ink: solid(1, 2, 3) } }, { a11y: { element: 'value', label: lit('Level') } })]), 'd').querySelector('[role=meter]')!;
    expect(none.hasAttribute('aria-valuenow')).toBe(false);
  });
});

describe('an arc track', () => {
  it('draws the curve, the horizon and the marker on the curve at progress', () => {
    const container = el(draw([arc()]), 'a');
    // 200 points wide is twice the box: the curve from (16, 80) bent toward (100, 8) to (184, 80); half way is the top, (100, 44).
    expect(container.querySelector('.sh-arc-curve')!.getAttribute('d')).toBe('M16 80Q100 8 184 80');
    expect(container.querySelector('.sh-arc-horizon')!.getAttribute('d')).toBe('M8 80L192 80');
    const marker = container.querySelector('.sh-arc-marker')!;
    expect([marker.getAttribute('cx'), marker.getAttribute('cy'), marker.getAttribute('r')]).toEqual(['100', '44', '5']);
    expect(container.querySelector('svg')!.getAttribute('height')).toBe('96');
  });
  it('keeps the widths, the dashes and the marker in points whatever the width', () => {
    const style = el(draw([arc()]), 'a').querySelector<SVGElement>('.sh-arc-curve')!.style;
    expect([style.strokeWidth, style.strokeDasharray]).toEqual(['2', '3 4']);
  });
  it('moves the marker with progress and hides it with none', () => {
    const at = (value: J) => { const marker = el(draw([arc({ progress: value })]), 'a').querySelector('.sh-arc-marker'); const answer = marker ? [marker.getAttribute('cx'), marker.getAttribute('cy')] : null; cleanup(); return answer; };
    expect(at(lit(0))).toEqual(['16', '80']);
    expect(at(lit(1))).toEqual(['184', '80']);
    expect(at(lit(2))).toEqual(['184', '80']);
    expect(at(read(['attributes', 'nothing']))).toBeNull();
  });
  it('reads progress from an entity', () => {
    const marker = el(draw([arc({ progress: read(['attributes', 'progress']) })]), 'a').querySelector('.sh-arc-marker')!;
    // 0.62: x = (8 + 84 x 0.62) x 2 = 120.16, y = (40 - 72 x 0.62 x 0.38) x 2 = 46.07.
    expect(num(marker.getAttribute('cx'))).toBeCloseTo(120.16, 2);
    expect(num(marker.getAttribute('cy'))).toBeCloseTo(46.07, 2);
  });
  it('draws no horizon and a solid curve when it has none', () => {
    const container = el(draw([arc({ horizon: undefined, dash: undefined })]), 'a');
    expect(container.querySelector('.sh-arc-horizon')).toBeNull();
    expect(container.querySelector<SVGElement>('.sh-arc-curve')!.style.strokeDasharray).toBe('');
  });
  it('is hidden, or one meter that speaks its progress', () => {
    expect(el(draw([arc()]), 'a').querySelector('.sh-arc')!.getAttribute('aria-hidden')).toBe('true');
    cleanup();
    const meter = el(draw([arc({}, { a11y: { element: 'value', label: lit('Progress') } })]), 'a').querySelector('[role=meter]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('50');
    expect(meter.getAttribute('aria-valuetext')).toBe('50%');
  });
});

describe('the story', () => {
  it('draws every page, each part present', () => {
    const { document, house } = wgdialStory();
    for (const page of document.pages) {
      const { container, unmount } = render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: page.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
        window={previewWindows[0]} bezel={false} house={house} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
      expect(container.querySelectorAll('.sh-dial, .sh-arc').length).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe('the Add picker', () => {
  const made = (key: string) => tileType(key)!.make({ document: home });
  it('offers the dial and the arc in the Content group', () => {
    const content = paletteGroups.components.find(group => group.id === 'content')!;
    expect(content.keys).toEqual(expect.arrayContaining(['dial', 'arc-track']));
  });
  it('makes parts that compile as they are added, declaring only their own ids', () => {
    for (const [key, id] of [['dial', 'sh.dial@1'], ['arc-track', 'sh.arc-track@1']] as const) {
      const { node: item } = made(key);
      expect(item.type).toBe(key);
      const document = structuredClone(home) as unknown as CompositionDocument;
      document.pages[0].components = [item];
      const declared = compileCompositionDocument(document).capabilities;
      expect(declared).toContain(id);
      expect(declared).not.toContain(key === 'dial' ? 'sh.arc-track@1' : 'sh.dial@1');
    }
  });
  it('lets a stack hold a dial and an arc, and they hold nothing', () => {
    const document = structuredClone(home) as unknown as CompositionDocument;
    const stack = tileType('stack')!.make({ document: home }).node;
    document.pages[0].components = [stack];
    const key = `node:${stack.id}` as const;
    expect(canHold(document, key, 'dial')).toBe(true);
    expect(canHold(document, key, 'arc-track')).toBe(true);
    expect(childSlots(made('dial').node)).toHaveLength(0);
    expect(childSlots(made('arc-track').node)).toHaveLength(0);
  });
  it('starts in neutral inks with no weather word anywhere', () => {
    expect(JSON.stringify([made('dial').node, made('arc-track').node])).not.toMatch(/weather|forecast|rain|temperature|pressure|compass|sunrise|sunset/i);
  });
});
