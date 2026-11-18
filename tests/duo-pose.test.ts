import { describe, expect, it } from 'vitest';
import {
  BOOK_TILT, cameraCornerOf, cameraCutout, closedRailSide, coverIsFirst, DEFAULT_DUO_POSE, foldedPose, folds, hingeAxisOf, hingeEdgeOf, openRailSide, rotatedPose, samePose, tiltOf, turnDelta, turnedBy, turns,
  type DuoPose,
} from '../src/preview2/duo-pose';
import { duoWindow, poseOfWindow, railSideOf, withPose, previewWindows } from '../src/preview2/windows';
import { canPosture, canRotate, postureOf, rotated, withPosture, type Posture } from '../src/workspace2/simulator';

const everyPose: DuoPose[] = turns.flatMap(turn => folds.map(fold => ({ turn, fold })));
const postures: Posture[] = ['folded', 'partly', 'unfolded'];
const foldOfPosture = { folded: 'closed', partly: 'partly', unfolded: 'open' } as const;

describe('the Duo pose state machine', () => {
  it('turns a quarter at a time, clockwise to the right and counter-clockwise to the left, and four turns come home', () => {
    expect(turns.map(turn => turnedBy(turn, 'right'))).toEqual([90, 180, 270, 0]);
    expect(turns.map(turn => turnedBy(turn, 'left'))).toEqual([270, 0, 90, 180]);
    for (const turn of turns) expect(turnedBy(turnedBy(turnedBy(turnedBy(turn, 'right'), 'right'), 'right'), 'right')).toBe(turn);
    for (const turn of turns) expect(turnedBy(turnedBy(turn, 'right'), 'left')).toBe(turn);
  });

  it('opens flat and sideways at turn 0 by default', () => {
    expect(DEFAULT_DUO_POSE).toEqual({ turn: 0, fold: 'open' });
  });

  it('keeps the fold when it turns and the turn when it folds', () => {
    for (const pose of everyPose) {
      expect(rotatedPose(pose, 'right').fold).toBe(pose.fold);
      expect(rotatedPose(pose, 'left').fold).toBe(pose.fold);
      for (const fold of folds) expect(foldedPose(pose, fold).turn).toBe(pose.turn);
    }
  });

  it('reaches every pose from every pose: each fold is one click of its control, each turn one click of a rotate control', () => {
    for (const from of everyPose) {
      const start = duoWindow(from);
      for (const posture of postures) {
        expect(canPosture(start, posture), `${JSON.stringify(from)} ${posture}`).toBe(true);
        expect(poseOfWindow(withPosture(start, posture))).toEqual({ turn: from.turn, fold: foldOfPosture[posture] });
      }
      expect(canRotate(start)).toBe(true);
      expect(poseOfWindow(rotated(start, 'right'))).toEqual(rotatedPose(from, 'right'));
      expect(poseOfWindow(rotated(start, 'left'))).toEqual(rotatedPose(from, 'left'));
      expect(postureOf(start)).toBe(postures[folds.indexOf(from.fold)]);
    }
    // And so every target is within two clicks: a turn, then a fold.
    for (const from of everyPose) for (const to of everyPose) {
      const turnedPose = turns.reduce<DuoPose>((now, _turn) => now.turn === to.turn ? now : rotatedPose(now, 'right'), from);
      expect(samePose(foldedPose(turnedPose, to.fold), to)).toBe(true);
    }
  });

  it('takes the shorter way round: a clockwise click is +90, a counter-clockwise one -90', () => {
    expect(turnDelta(0, 90)).toBe(90);
    expect(turnDelta(90, 0)).toBe(-90);
    expect(turnDelta(0, 270)).toBe(-90);
    expect(turnDelta(270, 0)).toBe(90);
    expect(Math.abs(turnDelta(0, 180))).toBe(180);
  });

  it('puts the hinge strip left, top, right and bottom at turns 0, 90, 180 and 270, vertical for 0 and 180', () => {
    expect(turns.map(hingeEdgeOf)).toEqual(['left', 'top', 'right', 'bottom']);
    expect(turns.map(hingeAxisOf)).toEqual(['vertical', 'horizontal', 'vertical', 'horizontal']);
    expect(turns.map(coverIsFirst)).toEqual([true, true, false, false]);
  });

  it('puts the camera where R1 measured it on the portrait and carries it round with the body', () => {
    expect(turns.map(turn => cameraCornerOf(turn))).toEqual([
      { horizontal: 'right', vertical: 'top' }, { horizontal: 'right', vertical: 'bottom' }, { horizontal: 'left', vertical: 'bottom' }, { horizontal: 'left', vertical: 'top' },
    ]);
    // R1: a 37 x 37 occlusion at (399.67, 29.33) and an 84 x 170 keep-clear region at (382, 0).
    expect(cameraCutout(0)).toMatchObject({
      corner: { horizontal: 'right', vertical: 'top' }, interim: false, size: 37,
      occlusion: { x: 399.67, y: 29.33, width: 37, height: 37 }, keepClear: { x: 382, y: 0, width: 84, height: 170 },
    });
    expect(cameraCutout(0).x).toBeCloseTo(418.17, 2);
    expect(cameraCutout(0).y).toBeCloseTo(47.83, 2);
    // The other turns carry the same rectangles round the window, and say so.
    expect([90, 180, 270].map(turn => cameraCutout(turn as 90).interim)).toEqual([true, true, true]);
    // The status column is the keep-clear confined to the rail: 84 wide and as long as the region is along the rail (170 at turns 0 and 180, 84 at 90 and 270), on the camera's side, and the camera lies inside it.
    for (const turn of [0, 90, 180, 270] as const) {
      const { occlusion, corner } = cameraCutout(turn), window = turn % 180 === 0 ? { width: 466, height: 678 } : { width: 678, height: 466 };
      const reach = turn % 180 === 0 ? 170 : 84;
      const column = { x: corner.horizontal === 'right' ? window.width - 84 : 0, y: corner.vertical === 'top' ? 0 : window.height - reach, width: 84, height: reach };
      expect(cameraCutout(turn).reach, `turn ${turn}`).toBe(reach);
      expect(occlusion.x >= column.x && occlusion.x + occlusion.width <= column.x + column.width && occlusion.y >= column.y && occlusion.y + occlusion.height <= column.y + column.height, `turn ${turn}: the camera is inside`).toBe(true);
    }
    const k = (turn: 90 | 180 | 270) => cameraCutout(turn).keepClear;
    expect([k(90).width, k(90).height, k(180).width, k(180).height]).toEqual([170, 84, 84, 170]);
    expect(k(90)).toMatchObject({ x: 678 - 170, y: 466 - 84 });
    expect(k(180)).toMatchObject({ x: 0, y: 678 - 170 });
    expect(k(270)).toMatchObject({ x: 0, y: 0, width: 170, height: 84 });
  });

  it('puts the closed rail on the vertical edge that holds the camera: right (trailing) at 0 and 90, left (leading) at 180 and 270', () => {
    expect(turns.map(closedRailSide)).toEqual(['trailing', 'trailing', 'leading', 'leading']);
  });

  it('gives the open Duo a rail only while its hinge is vertical, on the same edge as the closed one', () => {
    expect(turns.map(openRailSide)).toEqual(['trailing', undefined, 'leading', undefined]);
  });

  it('tilts the halves 18 degrees each partly folded, swings the cover 180 closed and keeps both flat open', () => {
    expect(BOOK_TILT).toBe(18);
    expect(tiltOf('open')).toEqual({ cover: 0, base: 0 });
    expect(tiltOf('partly')).toEqual({ cover: 18, base: 18 });
    expect(tiltOf('closed')).toEqual({ cover: 180, base: 0 });
  });
});

describe('the window a pose gives', () => {
  it('gives the closed Duo 466 x 678 in portrait and 678 x 466 turned, each with its rail and a camera', () => {
    for (const turn of turns) {
      const win = duoWindow({ turn, fold: 'closed' });
      const portrait = turn % 180 === 0;
      expect([win.width, win.height]).toEqual(portrait ? [466, 678] : [678, 466]);
      // R1: the rail inset is 84 pt and the bar 69 pt; the bottom inset is 34.
      expect([win.rail, win.safeBottom]).toEqual([84, 34]);
      expect(win.interim).toBe(turn !== 0 ? true : undefined);
      expect(railSideOf(win)).toBe(closedRailSide(turn));
      expect(win.camera?.corner).toEqual(cameraCornerOf(turn));
      expect(win.hinge).toBeUndefined();
    }
  });

  it('gives the open Duo 951 x 669 with a vertical hinge and a rail at turns 0 and 180, and 669 x 951 with a horizontal hinge and no rail at 90 and 270', () => {
    for (const turn of turns) {
      const flat = duoWindow({ turn, fold: 'open' }), book = duoWindow({ turn, fold: 'partly' });
      const sideways = turn % 180 === 0;
      expect([flat.width, flat.height]).toEqual(sideways ? [951, 669] : [669, 951]);
      expect(flat.hinge).toBeUndefined();
      expect(flat.bookHinge?.axis).toBe(sideways ? 'vertical' : 'horizontal');
      expect(book.hinge).toEqual({ axis: sideways ? 'vertical' : 'horizontal', start: 455.3, length: 40.4 });
      expect(flat.rail !== undefined).toBe(sideways);
      expect(flat.railSide).toBe(openRailSide(turn));
      expect(flat.camera).toBeUndefined();
    }
  });

  it('returns the same object for the same pose, so a memo on the window holds', () => {
    for (const pose of everyPose) expect(duoWindow(pose)).toBe(duoWindow({ ...pose }));
  });

  it('reads the pose of the windows the preview lists, and of one the older book pose made', () => {
    expect(previewWindows.filter(win => win.name.startsWith('Duo')).map(win => poseOfWindow(win))).toEqual([
      { turn: 0, fold: 'closed' }, { turn: 90, fold: 'open' }, { turn: 0, fold: 'open' }, { turn: 90, fold: 'closed' },
    ]);
    const sideways = previewWindows.find(win => win.name === 'Duo open, sideways')!;
    expect(poseOfWindow(withPose(sideways, 'book'))).toEqual({ turn: 0, fold: 'partly' });
    expect(poseOfWindow(withPose(withPose(sideways, 'book'), 'flat'))).toEqual({ turn: 0, fold: 'open' });
    expect(poseOfWindow(previewWindows[0])).toBeUndefined();
  });
});
