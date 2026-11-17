import { layoutDial, dialShare, nextTurn, normalizeDegrees, shortestTurn, type DialInput, type DialScale, type DialSweep } from '../src/shared/composition/dial-math';
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
