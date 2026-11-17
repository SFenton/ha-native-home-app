// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const base = homeDomains.document as unknown as CompositionDocument;

/** The first tile-grid anywhere on the home page. */
function findGrid(nodes: readonly CompositionNode[]): CompositionNode | undefined {
  for (const node of nodes) {
    if (node.type === 'tile-grid') return node;
    const inside = 'children' in node && node.children ? findGrid(node.children) : undefined;
    if (inside) return inside;
  }
  return undefined;
}
const withSpans = (spans: number[]): { document: CompositionDocument; gridId: string } => {
  const document = structuredClone(base);
  const home = document.pages.find(page => page.id === 'page-home')!;
  const grid = findGrid(home.components)! as Extract<CompositionNode, { type: 'tile-grid' }>;
  const sample = grid.children[0];
  grid.children = spans.map((span, at) => ({ ...structuredClone(sample), id: `demo_tile_${at}`, layout: { span } }));
  return { document, gridId: grid.id };
};
const mountAt = (document: CompositionDocument, clientWidth: number) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
  return render(<Preview2 document={document} mode="use" surface={{ kind: 'page', id: 'page-home' }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={previewWindows[0]}
    bezel={false} house={demoHouse(document)} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
};

describe('tile grid fill', () => {
  it('lets a lone span-2 tile fill all three columns of its row, as the app does', () => {
    const { document, gridId } = withSpans([2]);
    const { container } = mountAt(document, 500);
    const grid = container.querySelector<HTMLElement>(`[data-sel="node:${gridId}"] .sh-grid`)!;
    expect(grid.getAttribute('data-columns')).toBe('3');
    expect(grid.style.gridTemplateColumns).toBe('3fr');
    expect(container.querySelector<HTMLElement>('[data-sel="node:demo_tile_0"]')!.style.gridColumn).toBe('span 1');
  });

  it('fills the short last row of a taller grid in whole tracks', () => {
    const { document, gridId } = withSpans([1, 1, 1, 1, 1]);
    const { container } = mountAt(document, 500);
    expect(container.querySelector(`[data-sel="node:${gridId}"] .sh-grid`)!.getAttribute('data-columns')).toBe('3');
    const spans = [0, 1, 2, 3, 4].map(at => container.querySelector<HTMLElement>(`[data-sel="node:demo_tile_${at}"]`)!.style.gridColumn);
    expect(spans).toEqual(['span 1', 'span 1', 'span 1', 'span 1', 'span 2']);
  });

  it('never makes more than four tile columns', () => {
    const { document, gridId } = withSpans([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const { container } = mountAt(document, 3000);
    expect(container.querySelector(`[data-sel="node:${gridId}"] .sh-grid`)!.getAttribute('data-columns')).toBe('4');
  });
});
