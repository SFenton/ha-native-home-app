// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { tileType } from '../src/workspace2/add/catalog';
import { canHold } from '../src/workspace2/add/insert';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { childSlots } from '../src/composition-editor';
import type { CompositionDocument } from '../src/shared/composition/schema';

/** What the preview draws for the WG-S1 parts (`sh.text-style@1`, `sh.stack@1`, `sh.symbol-part@1`, `sh.choice-icons@1`), and what the Add picker makes. */
afterEach(cleanup);
type J = Record<string, any>;
const home = homeDomains.document as unknown as CompositionDocument;
const lit = (value: unknown): J => ({ type: 'literal', value });
const token = (name: string): J => ({ type: 'token', name });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, props: J = {}, value = '72°'): J => node(id, 'text', { props: { value: lit(value), style: 'body', unavailableText: 'None', ...props } });
const stack = (id: string, children: J[], props: J = {}, rest: J = {}): J => node(id, 'stack', { props: { axis: 'horizontal', spacing: token('m'), ...props }, children, ...rest });
const weather = { entityId: 'weather.demo_home', name: 'Home', state: 'rainy', temperature: 72, windBearing: 90 } as never;

function draw(components: J[], extra: J = {}, large = false) {
  const page = home.pages[0];
  const document = { ...home, ...extra, dataSources: [...home.dataSources, { id: 'weather', kind: 'ha-entity', entityId: lit('weather.demo_home') }],
    navigation: { ...home.navigation, tabs: [], initialPageId: page.id, initialTabId: null },
    pages: [{ ...page, toolbar: { type: 'inherit' }, components }], modals: [] } as unknown as CompositionDocument;
  return render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: page.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} textScale={large ? 1.5 : 1}
    window={previewWindows[0]} bezel={false} house={houseFrom({ states: [weather] })} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>).container;
}
const el = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;

describe('a styled text', () => {
  it('is drawn exactly as before when it uses none of the new fields', () => {
    const plain = draw([text('t')]);
    expect(el(plain, 't').innerHTML).toBe('<p class="sh-text sh-text-body" data-state="ready">72°</p>');
  });
  it('draws weight, same-width digits, a scaled size, an ink with opacity, a line limit and alignment', () => {
    const p = el(draw([text('t', { style: 'large-title', font: { weight: 'thin', digits: 'monospaced', scale: { points: 76, relativeTo: 'large-title', maxPoints: 96 } }, ink: { type: 'rgba', red: 255, green: 255, blue: 255, alpha: 0.85 }, lines: 2, align: 'center' })]), 't').querySelector('p')!;
    expect(p.className).toContain('sh-text-large-title');
    expect(p.style.fontWeight).toBe('200');
    expect(p.style.fontVariantNumeric).toBe('tabular-nums');
    expect(p.style.fontSize).toBe('min(96px, calc(76px * var(--sh-text-scale, 1)))');
    expect(p.style.color).toBe('rgba(255, 255, 255, 0.85)');
    expect(p.style.textAlign).toBe('center');
    expect(p.style.webkitLineClamp || p.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
  });
  it('draws a ticker as one line that slides inside its place', () => {
    const p = el(draw([text('t', { lines: 1, overflow: 'ticker' }, 'Light rain with a chance of thunder')]), 't').querySelector('p')!;
    expect(p.getAttribute('data-overflow')).toBe('ticker');
    expect(p.querySelector('.sh-ticker-line')!.textContent).toBe('Light rain with a chance of thunder');
  });
});

describe('a stack', () => {
  it('lays children in a row or a column with its spacing, padding and a hairline between', () => {
    const container = draw([stack('s', [text('a', {}, 'A'), text('b', {}, 'B')], {
      axis: 'vertical', spacing: token('s'), padding: { top: token('m'), leading: token('l'), bottom: token('m'), trailing: token('l') },
      dividers: { ink: { type: 'rgba', red: 255, green: 255, blue: 255, alpha: 0.14 }, width: 1 }, surface: { type: 'module', density: 'thin' },
    })]);
    const outer = el(container, 's').querySelector<HTMLElement>('.sh-stack')!;
    const body = outer.querySelector<HTMLElement>('.sh-stack-body')!;
    expect(outer.className).toContain('sh-stack-module');
    expect(outer.style.padding).toBe('12px 16px');
    expect(body.getAttribute('data-axis')).toBe('vertical');
    expect(body.style.gap).toBe('8px');
    const line = body.querySelector<HTMLElement>('.sh-stack-divider')!;
    expect(line.style.height).toBe('1px');
    expect(line.style.background).toBe('rgba(255, 255, 255, 0.14)');
  });
  it('draws groups as columns of a row, the first growing', () => {
    const container = draw([stack('s', [text('a', {}, 'A'), text('b', {}, 'B'), text('c', {}, 'C')], { groups: [{ children: ['a', 'b'], spacing: token('xs'), grow: true }, { children: ['c'] }] })]);
    const groups = [...el(container, 's').querySelectorAll<HTMLElement>('.sh-stack-group')];
    expect(groups).toHaveLength(2);
    expect(groups[0].hasAttribute('data-grow')).toBe(true);
    expect(groups[0].style.flexDirection).toBe('column');
    expect(groups[0].style.gap).toBe('4px');
    expect(groups[0].querySelectorAll('[data-sel]')).toHaveLength(2);
  });
  it('collapses to a column with its other groups at an accessibility text size', () => {
    const props = { groups: [{ children: ['a', 'b'], grow: true }, { children: ['c'] }],
      collapse: { to: 'vertical', when: ['accessibility-size'], spacing: token('s'), groups: [{ children: ['a', 'c'], distribution: 'spread', align: 'center' }, { children: ['b'] }] } };
    const kids = [text('a', {}, 'A'), text('b', {}, 'B'), text('c', {}, 'C')];
    const wide = el(draw([stack('s', kids, props)]), 's').querySelector<HTMLElement>('.sh-stack-body')!;
    expect(wide.getAttribute('data-axis')).toBe('horizontal');
    cleanup();
    const stacked = el(draw([stack('s', kids, props)], {}, true), 's').querySelector<HTMLElement>('.sh-stack-body')!;
    expect(stacked.getAttribute('data-axis')).toBe('vertical');
    expect(stacked.getAttribute('data-collapsed')).toBe('accessibility-size');
    expect(stacked.style.gap).toBe('8px');
    const groups = [...stacked.querySelectorAll<HTMLElement>('.sh-stack-group')];
    expect(groups.map(group => [...group.querySelectorAll('[data-sel]')].map(item => item.getAttribute('data-sel')))).toEqual([['node:a', 'node:c'], ['node:b']]);
    expect(groups[0].style.justifyContent).toBe('space-between');
    expect(groups[0].style.flexDirection).toBe('row');
  });
  it('is one named button when it has an action, running it in Use', () => {
    const run = vi.fn(), overlay = vi.fn();
    const page = home.pages[0];
    const document = { ...home, navigation: { ...home.navigation, tabs: [], initialPageId: page.id, initialTabId: null },
      pages: [{ ...page, toolbar: { type: 'inherit' }, components: [stack('s', [text('a', {}, 'Rainy')], {}, { action: { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.demo_lamp') } }, a11y: { element: 'group', role: 'button', label: lit('Open forecast') } })] }], modals: [] } as unknown as CompositionDocument;
    const { container, getByRole } = render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: page.id }} onSurfaceChange={run} onSelect={vi.fn()}
      window={previewWindows[0]} bezel={false} house={houseFrom({ states: [weather] })} overlay={emptyOverlay} onOverlayChange={overlay} onSimulatedCall={run}/>);
    const button = getByRole('button', { name: 'Open forecast' });
    expect(container.contains(button)).toBe(true);
    fireEvent.click(button);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('hides a stack from assistive technologies when it says so', () => {
    const container = draw([stack('s', [text('a')], {}, { a11y: { element: 'hidden' } })]);
    expect(el(container, 's').querySelector('.sh-stack')!.getAttribute('aria-hidden')).toBe('true');
  });
  it('draws a shape of its form and colour, skipped by assistive technologies', () => {
    const shape = el(draw([node('sh', 'shape', { props: { form: 'capsule', width: 28, height: 8, fill: { type: 'rgba', red: 255, green: 255, blue: 255, alpha: 0.18 } } })]), 'sh').querySelector<HTMLElement>('.sh-shape')!;
    expect(shape.style.width).toBe('28px');
    expect(shape.style.borderRadius).toBe('4px');
    expect(shape.style.background).toBe('rgba(255, 255, 255, 0.18)');
    expect(shape.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('a symbol part', () => {
  const rainy = { type: 'bound-symbol', fallback: { type: 'sf-symbol', name: 'cloud.fill', rendering: 'canonical', unavailable: 'fallback' },
    value: { type: 'map', of: { type: 'read', from: { type: 'source', sourceId: 'weather', path: ['state'] }, as: 'string', missing: 'unavailable' }, cases: [{ equals: 'rainy', then: lit('cloud.rain') }], otherwise: lit('cloud.fill') } };
  const symbol = (props: J, rest: J = {}) => node('sy', 'symbol', { props: { name: rainy, size: { points: 40 }, rendering: 'multicolor', ...props }, a11y: { element: 'hidden' }, ...rest });
  it('follows the entity state, at its size, hidden from assistive technologies', () => {
    const part = el(draw([symbol({})]), 'sy').querySelector<HTMLElement>('.sh-symbol')!;
    expect(part.getAttribute('data-symbol')).toBe('cloud.rain');
    expect(part.style.width).toBe('40px');
    expect(part.getAttribute('aria-hidden')).toBe('true');
  });
  it('scales with the text size up to its cap, and turns by an operand', () => {
    const part = el(draw([symbol({ size: { points: 40, relativeTo: 'title1', maxScale: 2 }, rendering: 'monochrome', rotate: { type: 'read', from: { type: 'source', sourceId: 'weather', path: ['attributes', 'wind_bearing'] }, as: 'number', missing: 'unavailable' } })]), 'sy').querySelector<HTMLElement>('.sh-symbol')!;
    expect(part.style.width).toBe('min(80px, calc(40px * var(--sh-text-scale, 1)))');
    expect(part.style.transform).toBe('rotate(90deg)');
  });
  it('is an image with a label when it carries meaning', () => {
    const part = el(draw([symbol({}, { a11y: { element: 'image', label: lit('Rain') } })]), 'sy').querySelector<HTMLElement>('.sh-symbol')!;
    expect(part.getAttribute('role')).toBe('img');
    expect(part.getAttribute('aria-label')).toBe('Rain');
  });
});

describe('a segmented choice with symbols', () => {
  it('draws a symbol for each segment, named by its label, with the hint on hover', () => {
    const options = [{ id: 'a', label: 'Temperature', symbol: { type: 'sf-symbol', name: 'thermometer', rendering: 'canonical', unavailable: 'fallback' }, hint: 'Shows the temperature.' },
      { id: 'b', label: 'Rain', symbol: { type: 'sf-symbol', name: 'drop', rendering: 'canonical', unavailable: 'fallback' } }];
    const container = draw([node('seg', 'local-control', { props: { stateId: 'mode', kind: 'segmented-choice', placeholder: '' } })], { localState: [{ id: 'mode', type: 'choice', initial: 'a', options }] });
    const buttons = [...container.querySelectorAll<HTMLElement>('.sh-segments button')];
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['Temperature', 'Rain']);
    expect(buttons[0].querySelector('svg')).not.toBeNull();
    expect(buttons[0].getAttribute('title')).toBe('Shows the temperature.');
    expect(buttons[0].getAttribute('aria-checked')).toBe('true');
    expect(buttons[0].textContent).toBe('');
  });
});

describe('the Add picker', () => {
  const made = (key: string) => tileType(key)!.make({ document: home });
  it('offers the generic parts, each of which compiles as it is added', () => {
    for (const key of ['stack', 'shape', 'symbol']) {
      const { node: item } = made(key);
      expect(item.type).toBe(key);
      const document = structuredClone(home) as unknown as CompositionDocument;
      document.pages[0].components = [item];
      expect(compileCompositionDocument(document).capabilities).toEqual(expect.arrayContaining(['sh.text-style@1']));
    }
  });
  it('lets a stack hold what a grid holds, but not a form', () => {
    const document = structuredClone(home) as unknown as CompositionDocument;
    document.pages[0].components = [made('stack').node];
    const key = `node:${document.pages[0].components[0].id}` as const;
    expect(canHold(document, key, 'text')).toBe(true);
    expect(canHold(document, key, 'stack')).toBe(true);
    expect(canHold(document, key, 'form')).toBe(false);
    expect(childSlots(document.pages[0].components[0])).toHaveLength(1);
  });
});
