import { previewWindows, type PreviewWindow } from '../preview2';

/**
 * What the simulator controls around the device do to the window (Studio spec, Rule 3). The device menu picks a device; the
 * rail turns it, folds it and sizes its text. Everything here is a pure move between the windows the preview already draws.
 */

/** The devices the menu lists: names only. */
export type DeviceName = 'iPhone' | 'iPhone Duo' | 'iPad';
/** The Duo's three postures: folded (the outer display), partly folded (opened with its hinge across the window, either way up) and unfolded (flat). */
export type Posture = 'folded' | 'partly' | 'unfolded';

const byName = (name: string): PreviewWindow => previewWindows.find(item => item.name === name) ?? previewWindows[0];

/** The devices, each with the window a person gets on choosing it. */
export const devices: readonly { name: DeviceName; window: PreviewWindow }[] = [
  { name: 'iPhone', window: byName('iPhone') },
  { name: 'iPhone Duo', window: byName('Duo open, upright') },
  { name: 'iPad', window: byName('iPad upright') },
];

/** The device a window belongs to. */
export const deviceOf = (win: PreviewWindow): DeviceName => win.name.startsWith('Duo') ? 'iPhone Duo' : win.name.startsWith('iPad') ? 'iPad' : 'iPhone';

/** The window a device menu choice opens. */
export const windowOfDevice = (device: DeviceName): PreviewWindow => devices.find(item => item.name === device)?.window ?? previewWindows[0];

const turned: Record<string, string> = {
  'Duo open, upright': 'Duo open, sideways', 'Duo open, sideways': 'Duo open, upright', 'iPad upright': 'iPad sideways', 'iPad sideways': 'iPad upright',
};
/** Whether the device can be turned: the iPhone is portrait-locked and a folded Duo has one posture. */
export const canRotate = (win: PreviewWindow) => win.name in turned;
/** The window turned a quarter. A partly folded Duo stays partly folded (its band turns with it); a flat one stays flat. */
export function rotated(win: PreviewWindow): PreviewWindow {
  if (!canRotate(win)) return win;
  const next = byName(turned[win.name]);
  return win.hinge && next.bookHinge ? { ...next, hinge: next.bookHinge } : next;
}

/** The Duo's posture, or undefined for a device that does not fold. */
export function postureOf(win: PreviewWindow): Posture | undefined {
  if (deviceOf(win) !== 'iPhone Duo') return undefined;
  return win.name === 'Duo folded' ? 'folded' : win.bookHinge && win.hinge ? 'partly' : 'unfolded';
}
/** Whether a posture can be taken now: partly folded needs the Duo opened, in either orientation. */
export const canPosture = (win: PreviewWindow, posture: Posture) => posture !== 'partly' || win.bookHinge !== undefined;
/** The window in a posture. Unfolding a folded Duo opens it upright; unfolding a half-open one lays it flat. */
export function withPosture(win: PreviewWindow, posture: Posture): PreviewWindow {
  if (deviceOf(win) !== 'iPhone Duo' || !canPosture(win, posture)) return win;
  if (posture === 'folded') return byName('Duo folded');
  if (posture === 'partly') { const base = byName(win.name); return { ...base, hinge: base.bookHinge }; }
  return win.name === 'Duo folded' ? byName('Duo open, upright') : byName(win.name);
}

/** Text scales, smallest to largest, as fractions of the app's default size (Dynamic Type from small to accessibility large). */
export const textScales: readonly number[] = [0.82, 0.9, 1, 1.12, 1.26, 1.42];
/** The step that is the default size. */
export const defaultTextStep = 2;
/** A text step moved one step, kept inside the scale. */
export const stepText = (step: number, direction: -1 | 1) => Math.min(textScales.length - 1, Math.max(0, step + direction));

/** Whether the simulator controls show under the preview rather than beside it: only on a phone, and only when the device is not the iPhone. */
export const railUnderPreview = (narrow: boolean, win: PreviewWindow) => narrow && deviceOf(win) !== 'iPhone';
