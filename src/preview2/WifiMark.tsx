import type { CSSProperties } from 'react';
import { WIFI } from './rail-constants';

const SIZE = WIFI.ring, CENTRE = SIZE / 2, RADIUS = (WIFI.ring - WIFI.stroke) / 2;
/** A point on the ring at a clock angle in degrees (SVG's: 0 at 3 o'clock, growing clockwise). */
const at = (degrees: number, radius = RADIUS, pivot = { x: CENTRE, y: CENTRE }) => ({ x: pivot.x + radius * Math.cos(degrees * Math.PI / 180), y: pivot.y + radius * Math.sin(degrees * Math.PI / 180) });
const arc = (from: number, to: number, radius = RADIUS, pivot?: { x: number; y: number }) => {
  const a = at(from, radius, pivot), b = at(to, radius, pivot);
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)}A${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
};
/** The SVG angle of a clock hour (12 at the top). */
const hour = (value: number) => value * 30 - 90;

/**
 * The connection mark the native rail shows at turns 0 and 180 (A2): a fixed picture, not a state. A three-arc wifi glyph inside a ring open
 * at the bottom, the arc from 7 to 11 o'clock white and the rest at 35%, and four dots in the opening, the first two white. It has no meaning,
 * no animation and no accessible name.
 */
export function WifiMark({ style }: { style?: CSSProperties }) {
  const half = WIFI.opening / 2, start = 90 + half, end = 90 - half + 360;
  const bright = hour(WIFI.bright.to), pivot = { x: CENTRE, y: CENTRE + WIFI.pivot };
  const dots = WIFI.dotAngles.slice(0, WIFI.dots);
  return <svg className="sh-wifi" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" style={style} fill="none" strokeLinecap="round">
    <path d={arc(start, bright)} stroke="#fff" strokeWidth={WIFI.stroke}/>
    <path d={arc(bright, end)} stroke="#fff" strokeOpacity={WIFI.dim} strokeWidth={WIFI.stroke}/>
    {WIFI.arcs.map(radius => <path key={radius} d={arc(-135, -45, radius, pivot)} stroke="#fff" strokeWidth={WIFI.arcStroke}/>)}
    <circle cx={pivot.x} cy={pivot.y} r={1.6} fill="#fff" stroke="none"/>
    {dots.map((degrees, place) => { const point = at(degrees); return <circle key={degrees} cx={point.x} cy={point.y} r={WIFI.dot / 2} fill="#fff" fillOpacity={place < WIFI.brightDots ? 1 : WIFI.dim} stroke="none"/>; })}
  </svg>;
}
