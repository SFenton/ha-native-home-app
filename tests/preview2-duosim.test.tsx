// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { foldReadout, windowFold } from '../src/preview2/fold';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import { DUO_ISLAND_AT, duoWindow, FOLDED_DUO_BODY, OPEN_DUO_BODY, PHONE_BODY, radiiCss, withPose, type PreviewWindow } from '../src/preview2/windows';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
const base = homeDomains.document as unknown as CompositionDocument;
const named = (name: string) => previewWindows.find(item => item.name === name)!;
const climate = { kind: 'page', id: 'page-climate' } as const;
const present = { type: 'present', modalId: 'hc-climate-sheet', arguments: {}, ifPresented: 'reject' };

/** The Climate page with a floating action bar added after its sections. */
function withPinned(): CompositionDocument {
  const bar = { id: 'bar', title: 'Actions', layout: { span: 1 }, type: 'pinned-actions', props: { searchPrompt: 'Search Tasks', items: [
    { id: 'add', title: 'Add Task', icon: { type: 'sf-symbol', name: 'plus', rendering: 'canonical', unavailable: 'fallback' }, prominent: true, showsTitle: true, action: present }] } };
  return { ...base, pages: base.pages.map(page => page.id === 'page-climate' ? { ...page, components: [...page.components, bar] } : page) } as unknown as CompositionDocument;
}
const mount = (document: CompositionDocument, over: Partial<Preview2Props> = {}) => render(<Preview2 document={document} mode="edit" surface={climate}
  onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={named('iPhone')} bezel house={demoHouse(document)} overlay={emptyOverlay} onOverlayChange={vi.fn()} {...over}/>);

describe('S1 the navigation tile chevron', () => {
  it('draws one chevron on a navigation tile with an action, none on an action tile or a tile with no action, and never labels it', () => {
    const { container } = mount(base);
    const tiles = container.querySelectorAll('[data-type=navigation-tile]');
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      const chevrons = tile.querySelectorAll('.sh-tile-chevron');
      expect(chevrons).toHaveLength(1);
      expect(chevrons[0].hasAttribute('aria-label')).toBe(false);
      expect(chevrons[0].getAttribute('aria-hidden')).toBe('true');
    }
    cleanup();
    // The loading skeleton has no action and so no chevron.
    const bare = { ...base, pages: base.pages.map(page => ({ ...page, components: JSON.parse(JSON.stringify(page.components), (key, value) => key === 'action' && value?.type === 'present' ? undefined : value) })) } as unknown as CompositionDocument;
    const skeleton = mount(bare);
    expect(skeleton.container.querySelectorAll('[data-type=navigation-tile]').length).toBeGreaterThan(0);
    expect(skeleton.container.querySelectorAll('[data-type=navigation-tile] .sh-tile-chevron')).toHaveLength(0);
    cleanup();
    const home = mount(base, { surface: { kind: 'page', id: 'page-home' } });
    expect(home.container.querySelectorAll('[data-type=action-tile] .sh-tile-chevron')).toHaveLength(0);
    expect(home.container.querySelectorAll('[data-type=state-tile] .sh-tile-chevron')).toHaveLength(0);
  });
});

describe('S2 the pinned action bar', () => {
  it('sits in a dock that is a child of the page, outside the scroller, and keeps its selection key', () => {
    const { container } = mount(withPinned());
    const page = container.querySelector('.sh-page[data-current]')!;
    const dock = page.querySelector('.sh-dock')!;
    expect(dock.parentElement).toBe(page);
    expect(dock.closest('.sh-scroll')).toBeNull();
    expect(dock.querySelector('[data-sel="node:bar"]')).not.toBeNull();
    expect(page.querySelector('.sh-scroll [data-sel="node:bar"]')).toBeNull();
    expect(dock.querySelector('[role=toolbar]')).not.toBeNull();
  });

  it('draws no dock on a page without one, and keeps the dock out of the scroller in a sheet', () => {
    expect(mount(base).container.querySelector('.sh-dock')).toBeNull();
    cleanup();
    const sheet = { ...base, modals: base.modals.map(modal => modal.id === 'hc-climate-sheet' ? { ...modal, components: [...modal.components, withPinned().pages.find(page => page.id === 'page-climate')!.components.at(-1)!] } : modal) } as unknown as CompositionDocument;
    const { container } = mount(sheet, { surface: { kind: 'modal', id: 'hc-climate-sheet' } });
    const dock = container.querySelector('.sh-sheet > .sh-dock')!;
    expect(dock).not.toBeNull();
    expect(dock.closest('.sh-scroll')).toBeNull();
  });
});

describe('S3 the Dynamic Island', () => {
  it('belongs to the iPhone alone, and no Duo window draws one', () => {
    expect(previewWindows.filter(item => item.island).map(item => item.name)).toEqual(['iPhone']);
    for (const win of previewWindows) {
      const { container } = mount(base, { window: win });
      expect(container.querySelectorAll('.sh-island').length, win.name).toBe(win.name === 'iPhone' ? 1 : 0);
      cleanup();
    }
    expect(DUO_ISLAND_AT).toBeUndefined();
  });
});

describe('S5 the unfolded portrait Duo', () => {
  const upright = named('Duo open, upright');
  it('is flat by default, with no band, and offers the hinge as a pose', () => {
    expect(upright.hinge).toBeUndefined();
    expect(upright.bookHinge).toEqual({ axis: 'horizontal', start: 455.3, length: 40.4 });
    expect(mount(base, { window: upright }).container.querySelector('.sh-crease[data-on]')).toBeNull();
    cleanup();
    const hinged = withPose(upright, 'book');
    // Partly folded the 3D rig draws the screen through each half, so the crease is drawn once in each; a flat preview (no bezel) draws it once.
    expect(mount(base, { window: hinged }).container.querySelectorAll('.sh-crease[data-on][data-axis=horizontal]')).toHaveLength(2);
    cleanup();
    expect(mount(base, { window: hinged, bezel: false }).container.querySelectorAll('.sh-crease[data-on][data-axis=horizontal]')).toHaveLength(1);
  });

  it('lays the page out the same flat and hinged: a horizontal hinge is not vertical', () => {
    const hinged = withPose(upright, 'book');
    expect(windowFold(hinged)).toEqual(windowFold(upright));
    expect(windowFold(hinged).vertical).toBe(false);
    expect(windowFold(hinged).band).toBeUndefined();
    cleanup();
    const columns = (win: PreviewWindow) => [...mount(base, { window: win, bezel: false }).container.querySelectorAll<HTMLElement>('.sh-grid')].map(grid => grid.getAttribute('data-columns'));
    const flat = columns(upright);
    cleanup();
    expect(columns(hinged)).toEqual(flat);
  });

  it('reads its fold: none flat, a hinge across the page with the layout unchanged when hinged', () => {
    expect(foldReadout(upright)).toBe('Fold: none');
    expect(foldReadout(withPose(upright, 'book'))).toBe('Fold: hinge across the page, layout unchanged');
  });
});

describe('S6 the body drawn around each window', () => {
  it('gives each window the frame the note records', () => {
    expect(named('iPhone').frame).toEqual({ bezel: 12, screenRadii: [55, 55, 55, 55], bodyRadii: [67, 67, 67, 67] });
    expect(named('iPad upright').frame).toBe(PHONE_BODY);
    expect(named('iPad sideways').frame).toBe(PHONE_BODY);
    expect(named('Duo folded').frame).toBe(FOLDED_DUO_BODY);
    expect(FOLDED_DUO_BODY).toMatchObject({ bezel: 14, screenRadii: [8, 59, 59, 8], bodyRadii: [1, 69, 69, 1], hingeStrip: { width: 14, height: 693, radius: 7 } });
    for (const name of ['Duo open, upright', 'Duo open, sideways']) expect(named(name).frame, name).toBe(OPEN_DUO_BODY);
    expect(OPEN_DUO_BODY).toMatchObject({ bezel: 20, screenRadii: [55, 55, 55, 55], bodyRadii: [75, 75, 75, 75] });
    expect(radiiCss([8, 59, 59, 8])).toBe('8px 59px 59px 8px');
  });

  it('keeps the Dynamic Island unset, and gives the closed Duo a camera cutout in the corner of the rail edge at every turn', () => {
    expect(DUO_ISLAND_AT).toBeUndefined();
    expect(previewWindows.map(item => item.name)).toContain('Duo folded, sideways');
    // Portrait, turn 0 (R1): the 37 x 37 occlusion region centred at (418.17, 47.83), top right. The turns carry it round the window (interim).
    const at = (turn: 0 | 90 | 180 | 270) => duoWindow({ turn, fold: 'closed' }).camera!;
    expect(at(0)).toMatchObject({ size: 37, corner: { horizontal: 'right', vertical: 'top' } });
    expect(at(0).x).toBeCloseTo(418.17, 2); expect(at(0).y).toBeCloseTo(47.83, 2);
    expect(at(90)).toMatchObject({ corner: { horizontal: 'right', vertical: 'bottom' } });
    expect(at(90).x).toBeCloseTo(678 - 47.83, 2); expect(at(90).y).toBeCloseTo(418.17, 2);
    expect(at(180)).toMatchObject({ corner: { horizontal: 'left', vertical: 'bottom' } });
    expect(at(270)).toMatchObject({ corner: { horizontal: 'left', vertical: 'top' } });
    expect(duoWindow({ turn: 0, fold: 'open' }).camera).toBeUndefined();
  });

  it('sizes the model by the frame: bezel on four sides; the Duo is the part of its body that its pose shows', () => {
    const size = (win: PreviewWindow) => { const { container } = mount(base, { window: win }); const model = container.querySelector<HTMLElement>('.sh-bezel, .sh-rig-model')!; const result = [model.style.width, model.style.height]; cleanup(); return result; };
    expect(size(named('iPhone'))).toEqual(['426px', '898px']);
    // Closed: the half the cover lies on (495.5) and the hinge strip's 9 pt overhang, the open body's full height.
    expect(size(named('Duo folded'))).toEqual(['504.5px', '709px']);
    expect(size(named('Duo open, upright'))).toEqual(['709px', '991px']);
    expect(size(named('Duo open, sideways'))).toEqual(['991px', '709px']);
    expect(size(duoWindow({ turn: 90, fold: 'closed' }))).toEqual(['709px', '504.5px']);
    expect(mount(base, { window: named('iPhone') }).container.querySelector('.sh-bezel')!.hasAttribute('data-strip')).toBe(false);
    cleanup();
    expect(mount(base, { window: named('Duo folded') }).container.querySelector('.sh-bezel')).toBeNull();
    cleanup();
    expect(mount(base, { bezel: false }).container.querySelector('.sh-bezel')).toBeNull();
  });
});
