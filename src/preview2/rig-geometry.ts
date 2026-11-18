import { coverIsFirst, hingeAxisOf, hingeEdgeOf, tiltOf, type DuoPose, type Fold, type Turn } from './duo-pose';
import { duoWindow, FOLDED_DUO_BODY, OPEN_DUO_BODY, type HingeStrip, type Radii } from './windows';

/**
 * The numbers of the Duo's 3D rig, as pure functions of the turn. The rig draws the open Duo as two halves that meet on the hinge's
 * centre line; the closed Duo is the same rig with the cover half swung 180 degrees, its back face carrying the outer display. Every
 * length is in points of the unit: the open Duo's body, its bezel included (`OPEN_DUO_BODY`).
 */

/** A rectangle in points. */
export interface Box { x: number; y: number; width: number; height: number }

/** Pixels each half reaches over the hinge's centre line, so no seam shows between two antialiased edges. */
export const LAP = 1;
/** How far in front of the base the cover's outer face is lifted, in px, so the two never fight for depth. */
export const OUTER_LIFT = 2;
/** Perspective of the stage, in px of the unit. Measured to keep backdrop blur and hit-testing at 18 degrees a half (`studio-duo-sim` D4). */
export const PERSPECTIVE = 1800;

/** One half of the open Duo. */
export interface HalfGeometry {
  /** Whether it is the left or top half. */
  first: boolean;
  /** Whether it is the half that swings over the other when the Duo closes. */
  cover: boolean;
  /** Its box in the unit. Each half reaches {@link LAP} past the hinge's centre line. */
  box: Box;
  /** `transform-origin` in the half's own box: the hinge's centre line. */
  origin: string;
  /** The rotation axis, and the sign that tilts this half toward the viewer. */
  axis: 'X' | 'Y';
  sign: 1 | -1;
  /** The part of its box the screen shows through, and where the window's own box sits inside it (a negative offset for the second half). */
  clip: Box;
  host: { left: number; top: number };
  /** Corner radii: the screen's and the body's, rounded only on the outer corners. */
  screenRadii: Radii;
  bodyRadii: Radii;
}

/** The cover's outer face: the closed Duo's body, drawn in the cover half's own box (it turns with it). */
export interface OuterGeometry {
  /** The face's box in the half. */
  face: Box;
  /** The outer display's box in the face. */
  screen: Box;
  /** The outer display's size, in points. */
  window: { width: number; height: number };
  screenRadii: Radii;
  bodyRadii: Radii;
  /** The hinge strip proud of the hinge edge, in the face's own box. */
  strip: Box & { radius: number; edge: 'left' | 'top' | 'right' | 'bottom' };
  /** How far the strip stands outside the body. */
  outside: number;
}

/** Everything the rig needs at one turn. */
export interface RigGeometry {
  turn: Turn;
  vertical: boolean;
  /** The open Duo's body in points. */
  unit: { width: number; height: number };
  bezel: number;
  halves: [HalfGeometry, HalfGeometry];
  outer: OuterGeometry;
}

const rotateRadii = (radii: Radii, quarters: number): Radii => {
  let out = radii;
  for (let step = 0; step < quarters; step += 1) out = [out[3], out[0], out[1], out[2]];
  return out;
};

const cache = new Map<Turn, RigGeometry>();

/** The rig's numbers at a turn. Cached: the same turn returns the same object. */
export function rigGeometry(turn: Turn): RigGeometry {
  const held = cache.get(turn);
  if (held) return held;
  const vertical = hingeAxisOf(turn) === 'vertical', open = duoWindow({ turn, fold: 'open' }), closed = duoWindow({ turn, fold: 'closed' });
  const bezel = OPEN_DUO_BODY.bezel, [screenRadius] = OPEN_DUO_BODY.screenRadii, [bodyRadius] = OPEN_DUO_BODY.bodyRadii;
  const width = open.width + 2 * bezel, height = open.height + 2 * bezel;
  const half = vertical ? width / 2 : height / 2;
  const cover = coverIsFirst(turn);
  const make = (first: boolean): HalfGeometry => {
    const s = screenRadius, b = bodyRadius;
    if (vertical) return {
      first, cover: first === cover,
      box: { x: first ? 0 : half - LAP, y: 0, width: half + LAP, height },
      origin: first ? `${half}px 50%` : `${LAP}px 50%`, axis: 'Y', sign: first ? 1 : -1,
      clip: first ? { x: bezel, y: bezel, width: half - bezel + LAP, height: open.height } : { x: 0, y: bezel, width: half - bezel + LAP, height: open.height },
      host: { left: first ? 0 : -(half - bezel - LAP), top: 0 },
      screenRadii: first ? [s, 0, 0, s] : [0, s, s, 0], bodyRadii: first ? [b, 0, 0, b] : [0, b, b, 0],
    };
    return {
      first, cover: first === cover,
      box: { x: 0, y: first ? 0 : half - LAP, width, height: half + LAP },
      origin: first ? `50% ${half}px` : `50% ${LAP}px`, axis: 'X', sign: first ? -1 : 1,
      clip: first ? { x: bezel, y: bezel, width: open.width, height: half - bezel + LAP } : { x: bezel, y: 0, width: open.width, height: half - bezel + LAP },
      host: { left: 0, top: first ? 0 : -(half - bezel - LAP) },
      screenRadii: first ? [s, s, 0, 0] : [0, 0, s, s], bodyRadii: first ? [b, b, 0, 0] : [0, 0, b, b],
    };
  };
  const faceWidth = vertical ? half : width, faceHeight = vertical ? height : half;
  const strip = FOLDED_DUO_BODY.hingeStrip as HingeStrip, edge = hingeEdgeOf(turn), quarters = turn / 90;
  const along = edge === 'left' || edge === 'right';
  const stripBox: Box = along
    ? { x: edge === 'left' ? -strip.outside : faceWidth + strip.outside - strip.width, y: (faceHeight - strip.height) / 2, width: strip.width, height: strip.height }
    : { x: (faceWidth - strip.height) / 2, y: edge === 'top' ? -strip.outside : faceHeight + strip.outside - strip.width, width: strip.height, height: strip.width };
  const made: RigGeometry = {
    turn, vertical, unit: { width, height }, bezel, halves: [make(true), make(false)],
    outer: {
      face: { x: 0, y: 0, width: faceWidth, height: faceHeight },
      screen: { x: (faceWidth - closed.width) / 2, y: (faceHeight - closed.height) / 2, width: closed.width, height: closed.height },
      window: { width: closed.width, height: closed.height },
      screenRadii: rotateRadii(FOLDED_DUO_BODY.screenRadii, quarters), bodyRadii: rotateRadii(FOLDED_DUO_BODY.bodyRadii, quarters),
      strip: { ...stripBox, radius: strip.radius, edge }, outside: strip.outside,
    },
  };
  cache.set(turn, made);
  return made;
}

/** The rotation of a half, in degrees, toward the viewer by `magnitude`: `rotateY(18deg)` for the left half of a vertical hinge. */
export const halfTransform = (half: HalfGeometry, magnitude: number): string => `rotate${half.axis}(${half.sign * magnitude}deg)`;

/** The tilt of each half at a fold, as the rig draws it: cover and base. The first half is the cover when the turn says so. */
export function halfTilts(turn: Turn, fold: Fold): [number, number] {
  const tilt = tiltOf(fold);
  return coverIsFirst(turn) ? [tilt.cover, tilt.base] : [tilt.base, tilt.cover];
}

/**
 * The part of the unit a pose shows, in the unit's own points: the whole body open or partly folded, and closed the half the cover lies on
 * with the hinge strip's overhang. Its centre is where the rig places the unit, so every pose is centred and the hinge line moves straight.
 */
export function footprintOf(pose: DuoPose): { width: number; height: number; cx: number; cy: number } {
  const g = rigGeometry(pose.turn), { width, height } = g.unit;
  if (pose.fold !== 'closed') return { width, height, cx: width / 2, cy: height / 2 };
  const out = g.outer.outside;
  if (g.vertical) {
    const half = width / 2, w = half + out;
    return { width: w, height, cx: coverIsFirst(pose.turn) ? (half - out + width) / 2 : w / 2, cy: height / 2 };
  }
  const half = height / 2, h = half + out;
  return { width, height: h, cx: width / 2, cy: coverIsFirst(pose.turn) ? (half - out + height) / 2 : h / 2 };
}
