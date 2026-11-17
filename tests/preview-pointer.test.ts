// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPreviewPointer, PAN_THRESHOLD } from '../src/preview2/preview-pointer';

let root: HTMLElement, scroller: HTMLElement, tile: HTMLButtonElement, slider: HTMLInputElement, row: HTMLElement;
let detach: () => void;
let clock = 0;
let frames: ((time: number) => void)[] = [];
let pan = true;

function size(element: HTMLElement, client: number, total: number, axis: 'y' | 'x' = 'y') {
  Object.defineProperty(element, axis === 'y' ? 'clientHeight' : 'clientWidth', { configurable: true, value: client });
  Object.defineProperty(element, axis === 'y' ? 'scrollHeight' : 'scrollWidth', { configurable: true, value: total });
}
function pointer(target: Element, type: string, x: number, y: number, pointerType = 'mouse') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.assign(event, { pointerType, pointerId: 1 });
  target.dispatchEvent(event);
  return event;
}
beforeEach(() => {
  clock = 0; frames = []; pan = true;
  document.body.innerHTML = `<div id="root"><div id="scroller" style="overflow-x:auto;overflow-y:auto"><button id="tile">Tile</button><input id="slider" type="range"/><div id="row" data-no-pan-x><span>Swipe</span></div></div></div>`;
  root = document.getElementById('root')!; scroller = document.getElementById('scroller')!;
  tile = document.getElementById('tile') as HTMLButtonElement; slider = document.getElementById('slider') as HTMLInputElement; row = document.getElementById('row')!;
  size(scroller, 400, 1200); size(scroller, 300, 900, 'x');
  detach = attachPreviewPointer(root, { pan: () => pan, now: () => clock, raf: callback => frames.push(callback), caf: () => { frames = []; } });
});
afterEach(() => { detach(); document.body.innerHTML = ''; });

describe('mouse pan', () => {
  it('ignores movement under the threshold and pans past it', () => {
    scroller.scrollTop = 100;
    pointer(tile, 'pointerdown', 50, 200);
    pointer(tile, 'pointermove', 50, 200 - (PAN_THRESHOLD - 1));
    expect(scroller.scrollTop).toBe(100);
    pointer(tile, 'pointermove', 50, 150);
    expect(scroller.scrollTop).toBe(150);
    expect(root.classList.contains('preview-panning')).toBe(true);
    clock = 400; pointer(tile, 'pointerup', 50, 150);
    expect(root.classList.contains('preview-panning')).toBe(false);
  });

  it('pans horizontally when the drag is horizontal and a horizontal scroller exists', () => {
    pointer(tile, 'pointerdown', 200, 200);
    pointer(tile, 'pointermove', 120, 202);
    expect(scroller.scrollLeft).toBe(80);
  });

  it('suppresses the click that ends a drag but not the next click', () => {
    const clicks = vi.fn(); tile.addEventListener('click', clicks);
    pointer(tile, 'pointerdown', 50, 200); pointer(tile, 'pointermove', 50, 120); clock = 500; pointer(tile, 'pointerup', 50, 120);
    tile.click();
    expect(clicks).not.toHaveBeenCalled();
    tile.click();
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('keeps clicks that never crossed the threshold', () => {
    const clicks = vi.fn(); tile.addEventListener('click', clicks);
    pointer(tile, 'pointerdown', 50, 200); pointer(tile, 'pointermove', 52, 203); pointer(tile, 'pointerup', 52, 203);
    tile.click();
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('leaves sliders, touch input and disabled mode alone', () => {
    pointer(slider, 'pointerdown', 50, 200); pointer(slider, 'pointermove', 50, 100);
    expect(scroller.scrollTop).toBe(0);
    pointer(tile, 'pointerdown', 50, 200, 'touch'); pointer(tile, 'pointermove', 50, 100, 'touch');
    expect(scroller.scrollTop).toBe(0);
    pan = false;
    pointer(tile, 'pointerdown', 50, 200); pointer(tile, 'pointermove', 50, 100);
    expect(scroller.scrollTop).toBe(0);
  });

  it('leaves horizontal drags to elements that own them but pans vertically through them', () => {
    pointer(row.firstElementChild!, 'pointerdown', 200, 200); pointer(row.firstElementChild!, 'pointermove', 100, 202);
    expect(scroller.scrollLeft).toBe(0);
    pointer(row.firstElementChild!, 'pointerup', 100, 202);
    pointer(row.firstElementChild!, 'pointerdown', 200, 200); pointer(row.firstElementChild!, 'pointermove', 202, 100);
    expect(scroller.scrollTop).toBe(100);
  });

  it('keeps scrolling with momentum after a fast release', () => {
    pointer(tile, 'pointerdown', 50, 300);
    clock = 16; pointer(tile, 'pointermove', 50, 250);
    clock = 32; pointer(tile, 'pointermove', 50, 200);
    pointer(tile, 'pointerup', 50, 200);
    const released = scroller.scrollTop;
    expect(frames).toHaveLength(1);
    clock = 48; frames.shift()!(clock);
    expect(scroller.scrollTop).toBeGreaterThan(released);
  });
});

describe('wheel and touch containment', () => {
  const wheel = (target: Element, deltaY: number, deltaX = 0) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaX });
    target.dispatchEvent(event);
    return event;
  };
  it('lets a scroller with room consume the wheel and blocks the page at the ends', () => {
    scroller.scrollTop = 100;
    expect(wheel(tile, 40).defaultPrevented).toBe(false);
    scroller.scrollTop = 800;
    expect(wheel(tile, 40).defaultPrevented).toBe(true);
    scroller.scrollTop = 0;
    expect(wheel(tile, -40).defaultPrevented).toBe(true);
  });
  // H1: Shift with a vertical wheel scrolls a row sideways, in Edit and Use alike (`attachPreviewPointer` does not look at the mode).
  it('scrolls a horizontal scroller by the wheel travel when Shift is held, and keeps the page still', () => {
    const shifted = (target: Element, deltaY: number, init: WheelEventInit = {}) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, shiftKey: true, ...init });
      target.dispatchEvent(event);
      return event;
    };
    scroller.scrollTop = 100; scroller.scrollLeft = 0;
    const event = shifted(tile, 90);
    expect(scroller.scrollLeft).toBe(90);
    expect(scroller.scrollTop, 'the vertical scroller does not move').toBe(100);
    expect(event.defaultPrevented).toBe(true);
    shifted(tile, -30);
    expect(scroller.scrollLeft).toBe(60);
    shifted(tile, 2, { deltaMode: 1 });
    expect(scroller.scrollLeft, 'lines count as 16 px').toBe(92);
  });
  it('lets Shift fall back to the vertical wheel where nothing scrolls sideways', () => {
    size(scroller, 300, 300, 'x'); scroller.scrollTop = 100;
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40, shiftKey: true });
    tile.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(scroller.scrollLeft).toBe(0);
  });
  it('blocks the wheel over content that has no scroller at all', () => {
    const inert = document.createElement('div'); root.appendChild(inert);
    expect(wheel(inert, 40).defaultPrevented).toBe(true);
  });
  it('blocks touch moves that no scroller can consume', () => {
    const touch = (type: string, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { touches: [{ clientX: 10, clientY: y }] });
      tile.dispatchEvent(event);
      return event;
    };
    scroller.scrollTop = 800;
    touch('touchstart', 300);
    expect(touch('touchmove', 250).defaultPrevented).toBe(true);
    scroller.scrollTop = 100;
    touch('touchstart', 300);
    expect(touch('touchmove', 250).defaultPrevented).toBe(false);
  });
});
