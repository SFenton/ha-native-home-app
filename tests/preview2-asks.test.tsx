// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planAction } from '../src/preview2/actions';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import type { CompositionActionSlot, CompositionDocument, CompositionNode } from '../src/shared/composition/schema';

afterEach(cleanup);
type J = Record<string, any>;
const home = homeDomains.document as unknown as CompositionDocument;
const icon = { type: 'sf-symbol', name: 'circle', rendering: 'canonical', unavailable: 'fallback' };
const lit = (value: unknown): J => ({ type: 'literal', value });
const temp: J = { type: 'read', from: { type: 'source', sourceId: 'temp', path: ['state'] }, as: 'number', missing: 'unavailable' };
const hot: J = { type: 'compare', op: 'above', left: temp, right: lit(75) };
const sources = [{ id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_temp') }, { id: 'color', kind: 'ha-entity', entityId: lit('sensor.demo_color') }];
const push = (pageId: string): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const call = (extra: J = {}): J => ({ type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.demo_lamp') }, ...extra });

/** Draws a one-page document and returns its container. `sensor` is the temperature state; omit it for an entity the house does not have. */
function draw(components: J[], sensor?: string, colorText?: string) {
  const base = home.pages[0];
  const document = { ...home, dataSources: [...home.dataSources, ...sources], navigation: { ...home.navigation, tabs: [], initialPageId: base.id, initialTabId: null },
    pages: [{ ...base, toolbar: { type: 'inherit' }, components }], modals: [] } as unknown as CompositionDocument;
  const states = [{ entityId: 'lock.demo_door', name: 'Door', state: 'locked' }, ...(sensor === undefined ? [] : [{ entityId: 'sensor.demo_temp', name: 'Temp', state: sensor }]), ...(colorText === undefined ? [] : [{ entityId: 'sensor.demo_color', name: 'Color', state: colorText }])];
  return render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: base.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
    window={previewWindows[0]} bezel={false} house={houseFrom({ states })} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>).container;
}
const stateTile = (rest: J = {}): CompositionNode => ({ id: 't', title: 'Door', type: 'state-tile', layout: { span: 1 }, icon, props: {}, binding: { entityId: 'lock.demo_door', builtIn: 'lock' }, ...rest }) as never;
const navTile = (rest: J = {}, presentation?: J): CompositionNode => ({ id: 'n', title: 'Nav', type: 'navigation-tile', layout: { span: 1 }, icon,
  props: { family: 'neutral', selected: 'none', subtitle: lit('x'), ...(presentation ? { presentation } : {}) }, action: push(home.pages[1].id), ...rest }) as never;
const el = (container: HTMLElement, id: string) => { const node = container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!; return node.matches('button') ? node : node.querySelector<HTMLElement>('button') ?? node; };

describe('badges in the preview', () => {
  it('draws the value, and nothing for a value of 0 or for none', () => {
    const shown = draw([navTile({ badge: { type: 'value', value: lit(3) } })]);
    expect(el(shown, 'n').querySelector('[data-testid="badge"]')?.textContent).toBe('3');
    cleanup();
    expect(el(draw([navTile({ badge: { type: 'value', value: lit(0) } })]), 'n').querySelector('[data-testid="badge"]')).toBeNull();
    cleanup();
    expect(el(draw([navTile({ badge: { type: 'none' } })]), 'n').querySelector('[data-testid="badge"]')).toBeNull();
  });
  it('draws a text value on a state tile, and none while the value is unavailable', () => {
    expect(el(draw([stateTile({ badge: { type: 'value', value: lit('New') } })]), 't').querySelector('[data-testid="badge"]')?.textContent).toBe('New');
    cleanup();
    expect(el(draw([stateTile({ badge: { type: 'value', value: { ...temp, as: 'string' } } })]), 't').querySelector('[data-testid="badge"]')).toBeNull();
  });
});

describe('enabledWhen in the preview', () => {
  it('leaves a state tile pressable when the condition holds and inert when it does not', () => {
    const rule = { condition: hot, whenUnknown: 'enabled' };
    expect(el(draw([stateTile({ enabledWhen: rule })], '80'), 't').hasAttribute('data-disabled')).toBe(false);
    cleanup();
    expect(el(draw([stateTile({ enabledWhen: rule })], '60'), 't').hasAttribute('data-disabled')).toBe(true);
  });
  it('follows the policy when the value cannot be read', () => {
    expect(el(draw([stateTile({ enabledWhen: { condition: hot, whenUnknown: 'disabled' } })]), 't').hasAttribute('data-disabled')).toBe(true);
    cleanup();
    expect(el(draw([stateTile({ enabledWhen: { condition: hot, whenUnknown: 'enabled' } })]), 't').hasAttribute('data-disabled')).toBe(false);
  });
});

describe('a bound color fill in the preview', () => {
  const fill = (text: string | undefined) => {
    const container = draw([navTile({}, { layout: 'standard', titleLines: 1, fill: { type: 'bound-color', value: { type: 'read', from: { type: 'source', sourceId: 'color', path: ['state'] }, as: 'string', missing: 'unavailable' }, fallback: { type: 'solid-rgb', red: 1, green: 2, blue: 3 } } })], undefined, text);
    return el(container, 'n').outerHTML;
  };
  it('clamps the entity color: #009688 draws as rgb(0, 110, 99), not as itself', () => {
    const html = fill('#009688');
    expect(html).toMatch(/rgb\(0 110 99\)/);
    expect(html).not.toMatch(/rgb\(0 150 136\)/);
  });
  it('draws the fallback when the text is not a color', () => {
    expect(fill('teal')).toMatch(/rgb\(1 2 3\)/);
  });
});

describe('the tile faces in the preview', () => {
  it('lights, fills and errors a tile by its conditions', () => {
    const tile = (sensor: string) => el(draw([stateTile({ activeWhen: hot, filledWhen: hot, errorWhen: hot })], sensor), 't');
    const on = tile('80');
    expect(on.className).toContain('sh-lit');
    expect(on.className).toContain('sh-filled');
    cleanup();
    expect(tile('60').className).not.toContain('sh-filled');
  });
});

describe('an action chosen by rule and a confirmation with a condition', () => {
  const input = (sensor?: string) => ({ document: { dataSources: sources, localState: [] } as never, house: houseFrom({ states: sensor === undefined ? [] : [{ entityId: 'sensor.demo_temp', name: 'Temp', state: sensor }] }), overlay: emptyOverlay });
  const rule = (otherwise: J): CompositionActionSlot => ({ type: 'conditional', cases: [{ when: hot, then: push('page-a') }], otherwise }) as never;
  it('runs the case that holds, else the otherwise', () => {
    expect(planAction(rule(push('page-b')), input('80')).nav).toMatchObject({ pageId: 'page-a' });
    expect(planAction(rule(push('page-b')), input('60')).nav).toMatchObject({ pageId: 'page-b' });
  });
  it('runs nothing when the answer is none, and when the value is still loading', () => {
    expect(planAction(rule({ type: 'none' }), input('60'))).toEqual({});
    expect(planAction(rule(push('page-b')), input())).toEqual({});
  });
  const ask = (when?: J): CompositionActionSlot => call({ confirmation: { type: 'additional', style: 'alert', title: 'Turn on?', confirmLabel: 'Turn On', cancelLabel: 'Cancel', destructive: false, ...(when ? { when } : {}) } }) as never;
  it('asks only when confirmation.when holds, and asks when it cannot be answered', () => {
    expect(planAction(ask(hot), input('80')).confirm?.title).toBe('Turn on?');
    expect(planAction(ask(hot), input('60')).confirm).toBeUndefined();
    expect(planAction(ask(hot), input('60')).call).toBeDefined();
    expect(planAction(ask(hot), input()).confirm?.title).toBe('Turn on?');
    expect(planAction(ask(), input('60')).confirm?.title).toBe('Turn on?');
  });
});
