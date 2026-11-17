// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureBefore, playSettle, settleGhost } from '../src/workspace2/dnd/settle';

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

/** A node whose place the test controls, standing in for what layout would say. */
function node(attribute: string, key: string, box: { left: number; top: number }, parent: HTMLElement | ShadowRoot | Document = document) {
  const element = document.createElement('div');
  element.setAttribute(attribute, key);
  Object.defineProperty(element, 'offsetWidth', { value: 100 });
  const place = { ...box };
  element.getBoundingClientRect = () => ({ left: place.left, top: place.top, width: 100, height: 40, right: place.left + 100, bottom: place.top + 40, x: place.left, y: place.top, toJSON() {} });
  (parent === document ? document.body : parent as HTMLElement).append(element);
  return { element, place };
}

describe('the drop settle', () => {
  it('glides what moved from where it was, and leaves what stayed', () => {
    const animate = vi.fn(() => ({}));
    HTMLElement.prototype.animate = animate as never;
    const a = node('data-sel', 'node:a', { left: 0, top: 0 }), b = node('data-sel', 'node:b', { left: 0, top: 50 });
    const before = measureBefore([document.body]);
    a.place.top = 50; b.place.top = 0; // a swap
    expect(playSettle([document.body], before)).toBe(2);
    const frames = (animate.mock.calls as unknown as [{ transform: string }[]][]).map(call => call[0][0].transform);
    expect(frames).toEqual(['translate(0px, -50px)', 'translate(0px, 50px)']);
    animate.mockClear();
    expect(playSettle([document.body], measureBefore([document.body]))).toBe(0);
    expect(animate).not.toHaveBeenCalled();
  });
  it('plays nothing when the person asked for less motion', () => {
    const animate = vi.fn(() => ({}));
    HTMLElement.prototype.animate = animate as never;
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const a = node('data-row', 'node:a', { left: 0, top: 0 });
    const before = measureBefore([document.body]);
    a.place.top = 80;
    expect(before.size).toBe(0);
    expect(playSettle([document.body], before)).toBe(0);
    const image = document.createElement('div'); document.body.append(image);
    settleGhost(image, a.element);
    expect(image.isConnected).toBe(false);
  });
  it('lands the drag image on its node, then removes it', () => {
    let finish = () => {};
    HTMLElement.prototype.animate = (() => { const run: { onfinish?: () => void } = {}; Object.defineProperty(run, 'onfinish', { set: (fn: () => void) => { finish = fn; } }); return run; }) as never;
    const target = node('data-sel', 'node:a', { left: 40, top: 60 });
    const image = document.createElement('div'); document.body.append(image);
    settleGhost(image, target.element);
    expect(image.isConnected).toBe(true);
    finish();
    expect(image.isConnected).toBe(false);
  });
});
