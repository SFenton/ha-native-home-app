// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { guardFocus, useCopyReach } from '../src/preview2/copy-access';
import { playReflow } from '../src/preview2/reflow';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const frames = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });

/** Two copies of one tile, each in its own half's clip; a tile's box follows its inline `left` and its text, so a style or text change moves it. */
function Twins() {
  const a = useRef<HTMLDivElement>(null), b = useRef<HTMLDivElement>(null);
  useCopyReach(a, b, true, 'partly');
  const copy = (id: string, ref: typeof a) => <div className="sh-clip" id={`clip-${id}`}><div ref={ref} id={id}>
    <div data-sel="node:tile" style={{ left: 50 }}><button id={`${id}-btn`}>Tile</button></div>
  </div></div>;
  return <>{copy('h0', a)}{copy('h1', b)}</>;
}
function mountTwins() {
  const view = render(<Twins/>);
  const q = (host: string, selector: string) => document.querySelector<HTMLElement>(`#${host} ${selector}`)!;
  document.getElementById('clip-h0')!.getBoundingClientRect = () => rect(0, 0, 400, 600);
  document.getElementById('clip-h1')!.getBoundingClientRect = () => rect(400, 0, 400, 600);
  for (const host of ['h0', 'h1']) {
    const tile = q(host, '[data-sel="node:tile"]');
    tile.getBoundingClientRect = () => rect(Number.parseFloat(tile.style.left || '0'), 100, tile.textContent!.length * 40, 60);
  }
  return { view, q };
}
afterEach(cleanup);

describe('the reachable copy follows what moves a control', () => {
  it('reassigns after a style-only move (no node is added or removed)', async () => {
    const { q } = mountTwins();
    await frames();
    expect(q('h1', '[data-sel="node:tile"]').getAttribute('aria-hidden')).toBe('true');
    for (const host of ['h0', 'h1']) q(host, '[data-sel="node:tile"]').style.left = '520px';
    await frames();
    expect(q('h0', '[data-sel="node:tile"]').getAttribute('aria-hidden')).toBe('true');
    expect(q('h1', '[data-sel="node:tile"]').hasAttribute('aria-hidden')).toBe(false);
    expect(q('h0', '#h0-btn').getAttribute('tabindex')).toBe('-1');
  });

  it('reassigns after a text-only change that widens a node across the hinge', async () => {
    const { q } = mountTwins();
    await frames();
    expect(q('h1', '[data-sel="node:tile"]').getAttribute('aria-hidden')).toBe('true');
    // At left 300 a four-character tile is 160 wide, centre 380: the first half. With 13 characters it is 520 wide, centre 560: the second.
    for (const host of ['h0', 'h1']) q(host, '[data-sel="node:tile"]').style.left = '300px';
    await frames();
    expect(q('h0', '[data-sel="node:tile"]').hasAttribute('aria-hidden')).toBe(false);
    await act(async () => { for (const host of ['h0', 'h1']) q(host, 'button').firstChild!.nodeValue = 'Tile and more'; });
    await frames();
    expect(q('h1', '[data-sel="node:tile"]').hasAttribute('aria-hidden')).toBe(false);
    expect(q('h0', '[data-sel="node:tile"]').getAttribute('aria-hidden')).toBe('true');
  });

  it('moves focus from a hidden copy to the matching control in the visible one', async () => {
    const { q } = mountTwins();
    await frames();
    // The tile is shown by the first half; the second copy's button is hidden. Focusing it lands in the first.
    const hidden = q('h1', '#h1-btn');
    hidden.focus();
    await frames();
    guardFocus(document.getElementById('h0')!, document.getElementById('h1')!, hidden);
    expect(document.activeElement).toBe(q('h0', '#h0-btn'));
  });

  it('lets go of focus when the twin is hidden too', () => {
    const { q } = mountTwins();
    const hidden = q('h1', '#h1-btn');
    hidden.setAttribute('data-copy-tab', ''); hidden.setAttribute('tabindex', '-1');
    const twin = q('h0', '#h0-btn'); twin.setAttribute('data-copy-tab', ''); twin.setAttribute('tabindex', '-1');
    hidden.focus();
    guardFocus(document.getElementById('h0')!, document.getElementById('h1')!, hidden);
    expect(document.activeElement).not.toBe(hidden);
  });

  it('waits while a reflow move plays and looks again when it ends', async () => {
    const { q } = mountTwins();
    await frames();
    const tile = q('h0', '[data-sel="node:tile"]');
    tile.dispatchEvent(new Event('sh-reflow-start', { bubbles: true }));
    for (const host of ['h0', 'h1']) q(host, '[data-sel="node:tile"]').style.left = '520px';
    await frames();
    // Mid-move the rects include the travelling translate: nothing flips yet.
    expect(q('h0', '[data-sel="node:tile"]').hasAttribute('aria-hidden')).toBe(false);
    expect(q('h1', '[data-sel="node:tile"]').getAttribute('aria-hidden')).toBe('true');
    tile.dispatchEvent(new Event('sh-reflow-end', { bubbles: true }));
    await frames();
    expect(q('h0', '[data-sel="node:tile"]').getAttribute('aria-hidden')).toBe('true');
    expect(q('h1', '[data-sel="node:tile"]').hasAttribute('aria-hidden')).toBe(false);
  });

  it('does not wait on a move whose node left the page', async () => {
    const { q } = mountTwins();
    await frames();
    const gone = document.createElement('div');
    document.body.append(gone);
    q('h0', '#h0-btn').dispatchEvent(new Event('sh-reflow-start', { bubbles: true }));
    gone.remove();
    for (const host of ['h0', 'h1']) q(host, '[data-sel="node:tile"]').style.left = '520px';
    q('h0', '#h0-btn').remove();
    await frames();
    expect(q('h1', '[data-sel="node:tile"]').hasAttribute('aria-hidden')).toBe(false);
  });

  it('reassigns on any focus, so a control just moved out of sight does not keep focus', async () => {
    const { q } = mountTwins();
    await frames();
    expect(q('h0', '#h0-btn').getAttribute('tabindex')).toBeNull();
    // The tile moves into the second half, and the observers have not run yet: the first copy's button is still marked reachable.
    for (const host of ['h0', 'h1']) q(host, '[data-sel="node:tile"]').style.left = '520px';
    q('h0', '#h0-btn').focus();
    expect(document.activeElement).toBe(q('h1', '#h1-btn'));
    expect(q('h0', '#h0-btn').getAttribute('tabindex')).toBe('-1');
  });

  it('resumes after a move that is cancelled, with no end sent by hand', async () => {
    const { q } = mountTwins();
    await frames();
    const tile = q('h0', '[data-sel="node:tile"]');
    let cancel!: (reason: unknown) => void;
    (tile as unknown as { animate: unknown }).animate = () => ({ finished: new Promise<void>((_, reject) => { cancel = reject; }) });
    playReflow([{ id: 't', dx: 40, dy: 0 }], new Map([['t', tile]]), { ms: 300, ease: 'ease' });
    for (const host of ['h0', 'h1']) q(host, '[data-sel="node:tile"]').style.left = '520px';
    await frames();
    expect(q('h0', '[data-sel="node:tile"]').hasAttribute('aria-hidden')).toBe(false);
    cancel(new DOMException('cancelled', 'AbortError'));
    await frames();
    expect(q('h0', '[data-sel="node:tile"]').getAttribute('aria-hidden')).toBe('true');
    expect(q('h1', '[data-sel="node:tile"]').hasAttribute('aria-hidden')).toBe(false);
  });
});
