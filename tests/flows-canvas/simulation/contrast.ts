import type { Rgb } from '../../../src/workspace2/theme';

/** Runs in the browser: capture rendered text colours, including mixed/transparent ancestor grounds. */
export function simulationTextPairs() {
  const context = document.createElement('canvas').getContext('2d')!;
  const colors = new Map<string, Rgb>();
  const color = (css: string): Rgb => {
    const cached = colors.get(css);
    if (cached) return cached;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
    const value = { r, g, b, a: alpha / 255 };
    colors.set(css, value);
    return value;
  };
  const pairs: { text: string; foreground: Rgb; backgrounds: Rgb[]; opacity: number; classes: string }[] = [];
  const add = (element: Element, text: string, foreground = getComputedStyle(element).color) => {
    if (!text.trim() || !element.closest('.w2-simulation-surface, .w2-menu')
      || element.closest('[inert], .w2-sr, svg, style, script') || !element.getClientRects().length
      || element.closest('[aria-hidden=true]') && !element.closest('.w2-sim-clock-ticks')) return;
    const backgrounds: Rgb[] = [];
    let opacity = 1;
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.visibility !== 'visible' || style.display === 'none') return;
      opacity *= Number(style.opacity);
      backgrounds.push(color(style.backgroundColor));
    }
    if (!opacity) return;
    pairs.push({ text: text.trim().slice(0, 90), foreground: color(foreground), backgrounds: backgrounds.reverse(), opacity, classes: element.className });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement) add(node.parentElement, node.textContent ?? '');
  }
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=radio]):not([type=range]), textarea')) {
    if (input.value) add(input, input.value);
    else if (input.placeholder) add(input, input.placeholder, getComputedStyle(input, '::placeholder').color);
  }
  return pairs;
}

/** Samples the actual keyboard outline and its adjacent painted grounds, not a token proxy. */
export function simulationFocusPair() {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) throw new Error('No focused HTML control.');
  const style = getComputedStyle(element);
  const context = document.createElement('canvas').getContext('2d')!;
  const color = (css: string): Rgb => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: alpha / 255 };
  };
  const backgrounds: Rgb[] = [];
  let opacity = 1;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const computed = getComputedStyle(parent);
    opacity *= Number(computed.opacity);
    backgrounds.push(color(computed.backgroundColor));
  }
  return {
    focusVisible: element.matches(':focus-visible'), outline: style.outlineStyle, width: Number.parseFloat(style.outlineWidth),
    offset: Number.parseFloat(style.outlineOffset), foreground: color(style.outlineColor), backgrounds: backgrounds.reverse(),
    controlBackground: color(style.backgroundColor), opacity: opacity * Number(style.opacity),
  };
}
