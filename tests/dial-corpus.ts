import { layoutDial, dialShare, nextTurn, normalizeDegrees, shortestTurn, type DialInput, type DialScale, type DialSweep } from '../src/shared/composition/dial-math';
import {
  adjustStopper, dialControlState, moveStopper, nearestStopper, ringAngle, snapToStep, stopBounds, tickValues,
  type DialControlInput, type DialControlRange, type SnapMode,
} from '../src/shared/composition/dial-control-math';
import { arcProgress, curvePoint, layoutArc, type ArcInput } from '../src/shared/composition/arc-track-math';

/**
 * The answers the shared dial and arc arithmetic gives for an evaluation case's `dial` and `arc` subjects (`contract/corpus/evaluation/dial-*.json`,
 * `arc-track-*.json`): one `op` and its inputs. The app's own views must give the same numbers; the cases are hand-written from the native tests and the native
 * drawing code, never computed by these modules. A `layout` op names the parts it pins in `pick`, as dotted paths into the layout (`ticks.0`, `ticks.length`,
 * `lit`, `needle`, `labels`, `marker`), and answers each under its own path.
 */
type Subject = Record<string, any>;

/** The value at a dotted path of a layout: `length` of a list, an index of it, a field of an object. A part that is not there is `null`. */
function pick(layout: unknown, dotted: string): unknown {
  let current: any = layout;
  for (const key of dotted.split('.')) current = current === null || current === undefined ? current : current[key];
  return current === undefined ? null : current;
}
const picked = (layout: unknown, paths: string[]): Record<string, unknown> => Object.fromEntries(paths.map(path => [path, pick(layout, path)]));

export function answerDial(subject: Subject): Record<string, unknown> {
  switch (subject.op) {
    case 'layout': return picked(layoutDial(subject.input as DialInput), subject.pick);
    case 'share': return { share: dialShare(subject.value, (subject.scale ?? 'unit') as DialScale, subject.sweep as DialSweep) };
    case 'normalize': return { degrees: normalizeDegrees(subject.value) };
    case 'delta': return { delta: shortestTurn(subject.from, subject.to) };
    case 'next': return { angle: nextTurn(subject.previous, subject.target) };
    default: throw new Error(`unknown dial op ${subject.op}`);
  }
}

export function answerArc(subject: Subject): Record<string, unknown> {
  switch (subject.op) {
    case 'layout': return picked(layoutArc(subject.input as ArcInput), subject.pick);
    case 'progress': return { t: arcProgress(subject.value, subject.scale) };
    case 'point': { const [x, y] = curvePoint(subject.curve, subject.t); return { x: Math.round(x * 1e4) / 1e4 + 0, y: Math.round(y * 1e4) / 1e4 + 0 }; }
    default: throw new Error(`unknown arc op ${subject.op}`);
  }
}

/**
 * The answers the dial control arithmetic gives for an evaluation case's `dialctl` subject (`contract/corpus/evaluation/dialctl-*.json`): one `op` and its
 * inputs. A stopper with no value is `value: null`; a limit side or a gap that is authored and cannot be read is `null`, one that is not authored is absent.
 */
export function answerDialCtl(subject: Subject): Record<string, unknown> {
  const input = subject.input as DialControlInput;
  switch (subject.op) {
    case 'state': return { state: dialControlState(input) };
    case 'bounds': return { bounds: stopBounds(input, subject.id) };
    case 'move': return { move: moveStopper(input, subject.id, subject.raw) };
    case 'adjust': return { value: adjustStopper(input, subject.id, subject.direction) };
    case 'nearest': return { id: nearestStopper(input, subject.raw) };
    case 'snap': return { value: snapToStep(subject.range as DialControlRange, subject.value, (subject.mode ?? 'nearest') as SnapMode) };
    case 'ticks': return { values: tickValues(subject.range as DialControlRange, subject.every) };
    case 'tick-count': return { count: tickValues(subject.range as DialControlRange, subject.every).length };
    case 'angle': return { degrees: ringAngle(subject.range as DialControlRange, subject.value, Boolean(subject.mirrored)) };
    default: throw new Error(`unknown dialctl op ${subject.op}`);
  }
}
