// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type PreviewSurface } from '../src/preview2/Preview2';
import { withPose, type PreviewWindow } from '../src/preview2/windows';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const base = homeDomains.document as unknown as CompositionDocument;
const named = (name: string) => previewWindows.find(item => item.name === name)!;
const duoFlat = withPose(named('Duo open, sideways'), 'flat'), duoBook = withPose(named('Duo open, sideways'), 'book');

type Grid = Extract<CompositionNode, { type: 'tile-grid' }>;
type RoomSection = Extract<CompositionNode, { type: 'room-section' }>;
const find = (nodes: readonly CompositionNode[], type: string): CompositionNode | undefined => {
  for (const node of nodes) {
    if (node.type === type) return node;
    const inside = 'children' in node && node.children ? find(node.children, type) : undefined;
    if (inside) return inside;
  }
  return undefined;
};
/** A copy of the Home page's first tile grid with `count` tiles, set to `fold`, `maxColumns` and `shortRow`. */
function withGrid(count: number, props: Partial<Grid['props']> = {}) {
  const document = structuredClone(base);
  const grid = find(document.pages.find(page => page.id === 'page-home')!.components, 'tile-grid') as Grid;
  const sample = grid.children[0];
  grid.children = Array.from({ length: count }, (_, at) => ({ ...structuredClone(sample), id: `fold_tile_${at}`, layout: { span: 1 } }));
  grid.props = { ...grid.props, ...props };
  return { document, gridId: grid.id, grid };
}
/**
 * Mounts a preview in `win`. Every element measures `width` wide and sits 16 pt in (the page's padding), as the page column of a Duo
 * does: 868 pt less 16 pt each side.
 */
function mount(document: CompositionDocument, win: PreviewWindow, surface: PreviewSurface = { kind: 'page', id: 'page-home' }, width = 836) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(16);
  return render(<Preview2 document={document} mode="use" surface={surface} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={win}
    bezel={false} house={demoHouse(document)} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
}
const gridOf = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-sel="node:${id}"] .sh-grid`)!;
/** The track widths of a grid in points, read from its template (the band's own track and any `fr` part excluded where noted). */
const tracks = (grid: HTMLElement) => grid.style.gridTemplateColumns.split(' ').map(part => parseFloat(part));

describe('S1/S2: a fold: page grid in the Duo, flat and book', () => {
  it('lays four 200 pt cells flat and 2 + 2 around the band in book (214 and 172)', () => {
    const { document, gridId } = withGrid(4, { fold: 'page' });
    const flat = mount(document, duoFlat);
    const flatGrid = gridOf(flat.container, gridId);
    expect(flatGrid.getAttribute('data-columns')).toBe('4');
    expect(flatGrid.hasAttribute('data-banded')).toBe(false);
    expect(flatGrid.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    cleanup();
    const book = mount(document, duoBook);
    const bookGrid = gridOf(book.container, gridId);
    expect(bookGrid.getAttribute('data-columns')).toBe('4');
    expect(bookGrid.hasAttribute('data-banded')).toBe(true);
    expect(tracks(bookGrid).map(Math.round)).toEqual([214, 214, 16, 172, 172]);
    const columns = [0, 1, 2, 3].map(at => book.container.querySelector<HTMLElement>(`[data-sel="node:fold_tile_${at}"]`)!.style.gridColumn);
    expect(columns).toEqual(['1 / span 1', '2 / span 1', '4 / span 1', '5 / span 1']);
  });

  it('gives a 3-column grid 2 columns, flat and in book', () => {
    const { document, gridId } = withGrid(4, { fold: 'page', maxColumns: 3 });
    expect(gridOf(mount(document, duoFlat).container, gridId).getAttribute('data-columns')).toBe('2');
    cleanup();
    const book = gridOf(mount(document, duoBook).container, gridId);
    expect(book.getAttribute('data-columns')).toBe('2');
    expect(book.hasAttribute('data-banded')).toBe(true);
  });

  it('leaves a fold: container grid alone in both poses (D4)', () => {
    const { document, gridId } = withGrid(4, { fold: 'container' });
    for (const win of [duoFlat, duoBook]) {
      const grid = gridOf(mount(document, win).container, gridId);
      expect(grid.getAttribute('data-columns')).toBe('4');
      expect(grid.hasAttribute('data-banded')).toBe(false);
      expect(grid.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
      cleanup();
    }
  });

  it('does not follow the fold in a sheet (D5)', () => {
    const document = structuredClone(base);
    const grid = structuredClone(withGrid(4, { fold: 'page' }).grid);
    const modal = document.modals[0];
    modal.components = [grid];
    const { container } = mount(document, duoBook, { kind: 'modal', id: modal.id }, 420);
    const inSheet = container.querySelector<HTMLElement>(`.sh-sheet [data-sel="node:${grid.id}"] .sh-grid`)!;
    expect(inSheet).toBeTruthy();
    expect(inSheet.hasAttribute('data-banded')).toBe(false);
    expect(inSheet.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
  });
});

describe('folded Duo, iPhone and iPad keep their layouts', () => {
  it('draws the same tracks for fold: page as for fold: container where no vertical hinge exists', () => {
    for (const name of ['iPhone', 'Duo folded', 'Duo open, upright', 'iPad upright', 'iPad sideways']) {
      const win = named(name);
      const page = withGrid(4, { fold: 'page' }), container = withGrid(4, { fold: 'container' });
      const asPage = gridOf(mount(page.document, win).container, page.gridId);
      const pageColumns = [asPage.getAttribute('data-columns'), asPage.style.gridTemplateColumns, asPage.hasAttribute('data-banded')];
      cleanup();
      const asContainer = gridOf(mount(container.document, win).container, container.gridId);
      expect([asContainer.getAttribute('data-columns'), asContainer.style.gridTemplateColumns, asContainer.hasAttribute('data-banded')], name).toEqual(pageColumns);
      expect(pageColumns[2], name).toBe(false);
      cleanup();
    }
  });
});

describe('S3: the alarm mode row and room-section grids follow the fold; the Rooms navigation grid does not', () => {
  const securityPage: PreviewSurface = { kind: 'page', id: 'page-security-system' };
  it('splits the four alarm modes 2 + 2 around the band in book, and keeps four flat', () => {
    const flat = mount(base, duoFlat, securityPage, 812).container.querySelector<HTMLElement>('.sh-alarm-modes')!;
    expect(flat.getAttribute('data-columns')).toBe('4');
    expect(flat.hasAttribute('data-banded')).toBe(false);
    cleanup();
    const book = mount(base, duoBook, securityPage, 812).container.querySelector<HTMLElement>('.sh-alarm-modes')!;
    expect(book.getAttribute('data-columns')).toBe('4');
    expect(book.hasAttribute('data-banded')).toBe(true);
    expect(book.querySelectorAll('.sh-alarm-mode')).toHaveLength(4);
    expect(book.style.gridTemplateColumns.split(' ')).toHaveLength(5);
  });

  const withRoomSection = (arrangement: RoomSection['props']['arrangement'], count: number, leadJoinsAtRegularWidth = false) => {
    const document = structuredClone(base);
    const section = find(document.pages.find(page => page.id === 'page-home')!.components, 'room-section') as RoomSection;
    const sample = find(document.pages.find(page => page.id === 'page-home')!.components, 'action-tile')!;
    section.children = Array.from({ length: count }, (_, at) => ({ ...structuredClone(sample), id: `room_tile_${at}`, layout: { span: at === 0 ? 2 : 1 } }));
    section.props = { ...section.props, arrangement, leadJoinsAtRegularWidth };
    return { document, id: section.id };
  };
  const sectionGrids = (root: HTMLElement, id: string) => [...root.querySelectorAll<HTMLElement>(`[data-sel="node:${id}"] .sh-grid`)];

  it('lays a room section grid out around the band in book, and on four flat', () => {
    const { document, id } = withRoomSection('grid', 4);
    expect(sectionGrids(mount(document, duoFlat).container, id).map(grid => [grid.getAttribute('data-columns'), grid.hasAttribute('data-banded')])).toEqual([['4', false]]);
    cleanup();
    expect(sectionGrids(mount(document, duoBook).container, id).map(grid => [grid.getAttribute('data-columns'), grid.hasAttribute('data-banded')])).toEqual([['4', true]]);
  });

  it('never moves the Rooms navigation grid (UKServerUIRooms.swift:186 avoidsHinge = false)', () => {
    // No fixture carries a rooms projection, so the guard is on the node: it is its own grid and never asks for the fold.
    const source = readFileSync(join(process.cwd(), 'src/preview2/nodes/panels/rooms.tsx'), 'utf8');
    expect(source).toContain('export function RoomNavigationGridNode');
    expect(source).not.toMatch(/useFoldedGrid|useMeasuredFrame|FoldedGridBox/);
  });

  it('S4: two-column-fill is two columns; lead-row joins a two-column grid only when asked at regular width', () => {
    const two = withRoomSection('two-column-fill', 4);
    expect(sectionGrids(mount(two.document, named('iPad sideways')).container, two.id)[0].getAttribute('data-columns')).toBe('2');
    cleanup();
    const joined = withRoomSection('lead-row', 4, true);
    const grids = sectionGrids(mount(joined.document, named('iPad sideways')).container, joined.id);
    expect(grids).toHaveLength(1);
    expect(grids[0].getAttribute('data-columns')).toBe('2');
    // The joined grid drops the spans: the first tile (span 2) takes one track.
    expect(grids[0].querySelector<HTMLElement>('[data-sel="node:room_tile_0"]')!.style.gridColumn).toBe('span 1');
    cleanup();
    // On a phone (compact) the lead takes the full width above a grid of the rest: more than two rest tiles are two columns, else four.
    const notJoined = withRoomSection('lead-row', 4, true);
    const phone = mount(notJoined.document, named('iPhone')).container;
    expect(sectionGrids(phone, notJoined.id)).toHaveLength(1);
    expect(sectionGrids(phone, notJoined.id)[0].querySelectorAll(':scope > [data-sel]')).toHaveLength(3);
    expect(sectionGrids(phone, notJoined.id)[0].getAttribute('data-columns')).toBe('2');
    cleanup();
    const small = withRoomSection('lead-row', 3);
    expect(sectionGrids(mount(small.document, named('iPad sideways')).container, small.id)[0].getAttribute('data-columns')).toBe('4');
  });
});

describe('S4: shortRow', () => {
  it('shares a short row, and with shortRow: leading leaves it at the track width', () => {
    const share = withGrid(3, { shortRow: 'share' });
    const shared = gridOf(mount(share.document, named('iPad sideways')).container, share.gridId).style.gridTemplateColumns.split(' ');
    expect(shared.map(part => +parseFloat(part).toFixed(3))).toEqual([1.333, 1.333, 1.333]);
    cleanup();
    const leading = withGrid(3, { shortRow: 'leading' });
    const grid = gridOf(mount(leading.document, named('iPad sideways')).container, leading.gridId);
    expect(grid.getAttribute('data-columns')).toBe('4');
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    expect(grid.querySelector<HTMLElement>('[data-sel="node:fold_tile_2"]')!.style.gridColumn).toBe('span 1');
  });
});
