import { describe, expect, it } from 'vitest';
import { coverIsFirst, folds, turns } from '../src/preview2/duo-pose';
import { footprintOf, halfTilts, halfTransform, LAP, rigGeometry } from '../src/preview2/rig-geometry';
import { duoWindow } from '../src/preview2/windows';

describe('the rig geometry', () => {
  it('draws the open body at the window plus a 20 pt bezel, 991 x 709 sideways and 709 x 991 upright', () => {
    expect(rigGeometry(0).unit).toEqual({ width: 991, height: 709 });
    expect(rigGeometry(180).unit).toEqual({ width: 991, height: 709 });
    expect(rigGeometry(90).unit).toEqual({ width: 709, height: 991 });
    expect(rigGeometry(270).unit).toEqual({ width: 709, height: 991 });
  });

  it('splits the body in two on the hinge centre line, each half reaching one point over it so no seam shows', () => {
    for (const turn of turns) {
      const g = rigGeometry(turn), [first, second] = g.halves;
      const half = (g.vertical ? g.unit.width : g.unit.height) / 2;
      const at = (box: typeof first.box) => g.vertical ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
      expect(at(first.box)).toEqual([0, half + LAP]);
      expect(at(second.box)).toEqual([half - LAP, half * 2]);
      expect(first.first).toBe(true);
      expect(second.first).toBe(false);
      expect(first.cover).toBe(coverIsFirst(turn));
      expect(second.cover).toBe(!coverIsFirst(turn));
    }
  });

  it('hands each half the part of the window it shows, and together they cover all of it', () => {
    for (const turn of turns) {
      const g = rigGeometry(turn), win = duoWindow({ turn, fold: 'open' }), [first, second] = g.halves;
      // A half's clip starts at `host` of the window's own box: the window point at the clip's left (or top) edge is minus the host offset.
      const span = (half: typeof first) => g.vertical
        ? [-half.host.left, -half.host.left + half.clip.width] : [-half.host.top, -half.host.top + half.clip.height];
      const [a0, a1] = span(first), [b0, b1] = span(second), length = g.vertical ? win.width : win.height;
      expect(a0).toBeCloseTo(0, 5);
      expect(b1).toBeCloseTo(length, 5);
      // The two overlap by two points at the hinge, none is missing.
      expect(a1 - b0).toBeCloseTo(2 * LAP, 5);
      // Across the hinge the clip is the whole window.
      expect(g.vertical ? first.clip.height : first.clip.width).toBe(g.vertical ? win.height : win.width);
    }
  });

  it('rounds only the outer corners of each half', () => {
    const [left, right] = rigGeometry(0).halves, [top, bottom] = rigGeometry(90).halves;
    expect(left.screenRadii).toEqual([55, 0, 0, 55]);
    expect(right.screenRadii).toEqual([0, 55, 55, 0]);
    expect(top.screenRadii).toEqual([55, 55, 0, 0]);
    expect(bottom.screenRadii).toEqual([0, 0, 55, 55]);
    expect(left.bodyRadii).toEqual([75, 0, 0, 75]);
  });

  it('tilts each half toward the viewer: the left half of a vertical hinge by +, the right by -, and the reverse for a horizontal one', () => {
    const [left, right] = rigGeometry(0).halves, [top, bottom] = rigGeometry(90).halves;
    expect([halfTransform(left, 18), halfTransform(right, 18)]).toEqual(['rotateY(18deg)', 'rotateY(-18deg)']);
    expect([halfTransform(top, 18), halfTransform(bottom, 18)]).toEqual(['rotateX(-18deg)', 'rotateX(18deg)']);
  });

  it('tilts the cover by the swing and the base by nothing when closed, in the half the turn says', () => {
    expect(halfTilts(0, 'closed')).toEqual([180, 0]);
    expect(halfTilts(180, 'closed')).toEqual([0, 180]);
    expect(halfTilts(90, 'partly')).toEqual([18, 18]);
    expect(halfTilts(270, 'open')).toEqual([0, 0]);
  });

  it('draws the closed body in the cover half: the outer window centred in a face the size of a half, the strip on the hinge edge standing 9 pt outside', () => {
    const portrait = rigGeometry(0).outer;
    expect(portrait.window).toEqual({ width: 466, height: 678 });
    expect(portrait.face).toEqual({ x: 0, y: 0, width: 495.5, height: 709 });
    expect(portrait.screen.x + portrait.screen.width / 2).toBeCloseTo(portrait.face.width / 2, 5);
    expect(portrait.strip).toMatchObject({ edge: 'left', x: -9, width: 14, height: 693 });
    expect(portrait.screenRadii).toEqual([8, 59, 59, 8]);
    const turned = [90, 180, 270].map(turn => rigGeometry(turn as 90).outer);
    expect(turned.map(item => item.strip.edge)).toEqual(['top', 'right', 'bottom']);
    expect(turned.map(item => item.screenRadii)).toEqual([[8, 8, 59, 59], [59, 8, 8, 59], [59, 59, 8, 8]]);
    expect(turned[1].strip.x).toBe(495.5 + 9 - 14);
    expect(turned[0].window).toEqual({ width: 678, height: 466 });
  });

  it('centres the unit on what a pose shows: the whole body open or partly folded, the half under the cover and the strip closed', () => {
    for (const turn of turns) for (const fold of ['open', 'partly'] as const) {
      const { width, height, cx, cy } = footprintOf({ turn, fold });
      expect([width, height]).toEqual([rigGeometry(turn).unit.width, rigGeometry(turn).unit.height]);
      expect([cx, cy]).toEqual([width / 2, height / 2]);
    }
    expect(footprintOf({ turn: 0, fold: 'closed' })).toEqual({ width: 504.5, height: 709, cx: (495.5 - 9 + 991) / 2, cy: 354.5 });
    expect(footprintOf({ turn: 180, fold: 'closed' })).toEqual({ width: 504.5, height: 709, cx: 504.5 / 2, cy: 354.5 });
    expect(footprintOf({ turn: 90, fold: 'closed' })).toEqual({ width: 709, height: 504.5, cx: 354.5, cy: (495.5 - 9 + 991) / 2 });
    expect(footprintOf({ turn: 270, fold: 'closed' })).toEqual({ width: 709, height: 504.5, cx: 354.5, cy: 504.5 / 2 });
  });

  it('is cached by turn, and every fold has a footprint', () => {
    for (const turn of turns) { expect(rigGeometry(turn)).toBe(rigGeometry(turn)); for (const fold of folds) expect(footprintOf({ turn, fold }).width).toBeGreaterThan(0); }
  });
});
