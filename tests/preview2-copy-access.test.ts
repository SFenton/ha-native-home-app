// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { assignReach, clearReach, exposedCopy } from '../src/preview2/copy-access';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const place = (element: Element, box: DOMRect) => { element.getBoundingClientRect = () => box; };

/** The partly folded Duo's two copies of one page: a tile in each half and a loose control (the tab bar's), each in a clip. */
function twins() {
  const page = `<div class="column">
    <div data-sel="node:left"><button id="left-btn">Left</button></div>
    <div data-sel="node:right"><button id="right-btn">Right</button></div>
    <div data-sel="node:group"><div data-sel="node:inner"><span>x</span></div></div>
    <button id="loose">Tabs</button>
  </div>`;
  document.body.innerHTML = `<div class="sh-clip" id="c0"><div id="h0">${page}</div></div><div class="sh-clip" id="c1"><div id="h1">${page}</div></div>`;
  const q = (host: string, selector: string) => document.querySelector<HTMLElement>(`#${host} ${selector}`)!;
  place(document.getElementById('c0')!, rect(0, 0, 400, 600)); place(document.getElementById('c1')!, rect(400, 0, 400, 600));
  for (const host of ['h0', 'h1']) {
    place(q(host, '[data-sel="node:left"]'), rect(50, 100, 200, 60)); place(q(host, '#left-btn'), rect(50, 100, 100, 40));
    place(q(host, '[data-sel="node:right"]'), rect(500, 100, 200, 60)); place(q(host, '#right-btn'), rect(500, 100, 100, 40));
    place(q(host, '#loose'), rect(600, 540, 100, 40));
  }
  return { q, first: document.getElementById('h0')!, second: document.getElementById('h1')! };
}
afterEach(() => { document.body.innerHTML = ''; });

describe('exposing each node and control in the copy whose half shows it', () => {
  it('hides a leaf node\'s duplicate from a screen reader and takes its controls out of the tab order, in the copy that does not show it', () => {
    const { q, first, second } = twins();
    assignReach(first, second);
    // The left tile is shown by the first half: its copy there is reachable, its copy in the second half is not.
    expect(q('h0', '[data-sel="node:left"]').hasAttribute('aria-hidden')).toBe(false);
    expect(q('h1', '[data-sel="node:left"]').getAttribute('aria-hidden')).toBe('true');
    expect(q('h1', '#left-btn').getAttribute('tabindex')).toBe('-1');
    expect(q('h0', '#left-btn').hasAttribute('tabindex')).toBe(false);
    // And the right tile the other way round.
    expect(q('h0', '[data-sel="node:right"]').getAttribute('aria-hidden')).toBe('true');
    expect(q('h0', '#right-btn').getAttribute('tabindex')).toBe('-1');
    expect(q('h1', '#right-btn').hasAttribute('tabindex')).toBe(false);
  });

  it('gives a loose control (not in any node) one owner too, and hides the duplicate', () => {
    const { q, first, second } = twins();
    assignReach(first, second);
    expect(q('h1', '#loose').hasAttribute('aria-hidden')).toBe(false);
    expect(q('h0', '#loose').getAttribute('aria-hidden')).toBe('true');
    expect(q('h0', '#loose').getAttribute('tabindex')).toBe('-1');
  });

  it('leaves a node that holds other nodes alone: only the leaves are hidden, so a hidden container never hides a visible child', () => {
    const { q, first, second } = twins();
    assignReach(first, second);
    expect(q('h0', '[data-sel="node:group"]').hasAttribute('aria-hidden')).toBe(false);
    expect(q('h1', '[data-sel="node:group"]').hasAttribute('aria-hidden')).toBe(false);
  });

  it('exposes a selected node in the copy that draws its Edit handle', () => {
    const { q, first, second } = twins();
    // The right tile is selected; its handle is drawn in the second copy, where the half shows it.
    for (const host of ['h0', 'h1']) {
      const node = q(host, '[data-sel="node:right"]');
      node.setAttribute('data-selected', '');
      const slot = document.createElement('div'); slot.className = 'sh-handle-slot'; node.prepend(slot);
      place(slot, rect(host === 'h0' ? 650 : 650, 100, 30, 30));
    }
    assignReach(first, second);
    expect(q('h1', '[data-sel="node:right"]').hasAttribute('aria-hidden')).toBe(false);
    expect(q('h0', '[data-sel="node:right"]').getAttribute('aria-hidden')).toBe('true');
    expect(exposedCopy([q('h0', '[data-sel="node:right"]'), q('h1', '[data-sel="node:right"]')])).toBe(q('h1', '[data-sel="node:right"]'));
  });

  it('keeps a control\'s own tabindex when it is reachable again, and undoes everything on clear', () => {
    const { q, first, second } = twins();
    q('h1', '#left-btn').setAttribute('tabindex', '0'); q('h0', '#left-btn').setAttribute('tabindex', '0');
    assignReach(first, second);
    expect(q('h1', '#left-btn').getAttribute('tabindex')).toBe('-1');
    expect(q('h0', '#left-btn').getAttribute('tabindex')).toBe('0');
    clearReach(first, second);
    expect(q('h1', '#left-btn').getAttribute('tabindex')).toBe('0');
    expect(document.querySelectorAll('[aria-hidden], [data-copy-off], [data-copy-tab]')).toHaveLength(0);
  });

  it('moves ownership when the half shows the control differently, with no stale hiding', () => {
    const { q, first, second } = twins();
    assignReach(first, second);
    // The left tile moves into the second half (a reflow): the copies swap roles.
    for (const host of ['h0', 'h1']) { place(q(host, '[data-sel="node:left"]'), rect(500, 100, 200, 60)); place(q(host, '#left-btn'), rect(500, 100, 100, 40)); }
    assignReach(first, second);
    expect(q('h0', '[data-sel="node:left"]').getAttribute('aria-hidden')).toBe('true');
    expect(q('h1', '[data-sel="node:left"]').hasAttribute('aria-hidden')).toBe(false);
    expect(q('h1', '#left-btn').hasAttribute('tabindex')).toBe(false);
    expect(q('h0', '#left-btn').getAttribute('tabindex')).toBe('-1');
  });
});
