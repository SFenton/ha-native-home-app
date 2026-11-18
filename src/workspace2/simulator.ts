import { duoWindow, foldedPose, poseOfWindow, previewWindows, rotatedPose, DEFAULT_DUO_POSE, type Fold, type PreviewWindow } from '../preview2';

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
  { name: 'iPhone Duo', window: duoWindow(DEFAULT_DUO_POSE) },
  { name: 'iPad', window: byName('iPad upright') },
];

/** The device a window belongs to. */
export const deviceOf = (win: PreviewWindow): DeviceName => win.name.startsWith('Duo') ? 'iPhone Duo' : win.name.startsWith('iPad') ? 'iPad' : 'iPhone';

/** The window a device menu choice opens. */
export const windowOfDevice = (device: DeviceName): PreviewWindow => devices.find(item => item.name === device)?.window ?? previewWindows[0];

const turned: Record<string, string> = { 'iPad upright': 'iPad sideways', 'iPad sideways': 'iPad upright' };
/** Whether the device can be turned: the iPhone is portrait-locked; the Duo turns four ways in every pose (folded, partly folded, unfolded) and the iPad two. */
export const canRotate = (win: PreviewWindow) => deviceOf(win) === 'iPhone Duo' || win.name in turned;
/**
 * The window turned a quarter, `right` clockwise and `left` counter-clockwise. The Duo keeps its fold (a partly folded Duo stays partly
 * folded, its hinge turning with it); the iPad has two orientations, so either direction swaps them.
 */
export function rotated(win: PreviewWindow, direction: 'left' | 'right' = 'right'): PreviewWindow {
  const pose = poseOfWindow(win);
  if (pose) return duoWindow(rotatedPose(pose, direction));
  return win.name in turned ? byName(turned[win.name]) : win;
}

/** The Duo's posture, or undefined for a device that does not fold. */
export function postureOf(win: PreviewWindow): Posture | undefined {
  const pose = poseOfWindow(win);
  return pose ? (pose.fold === 'closed' ? 'folded' : pose.fold === 'partly' ? 'partly' : 'unfolded') : undefined;
}
/** Whether a posture can be taken now: every Duo posture is open to every pose, from the folded Duo to partly folded included. */
export const canPosture = (win: PreviewWindow, _posture: Posture) => deviceOf(win) === 'iPhone Duo';
const foldOf: Record<Posture, Fold> = { folded: 'closed', partly: 'partly', unfolded: 'open' };
/** The window in a posture. The turn is kept: a Duo closed in portrait opens sideways and one closed in landscape opens upright, because the cover swings about the hinge. */
export function withPosture(win: PreviewWindow, posture: Posture): PreviewWindow {
  const pose = poseOfWindow(win);
  return pose && canPosture(win, posture) ? duoWindow(foldedPose(pose, foldOf[posture])) : win;
}

/** Text scales, smallest to largest, as fractions of the app's default size (Dynamic Type from small to accessibility large). */
export const textScales: readonly number[] = [0.82, 0.9, 1, 1.12, 1.26, 1.42];
/** The step that is the default size. */
export const defaultTextStep = 2;
/** A text step moved one step, kept inside the scale. */
export const stepText = (step: number, direction: -1 | 1) => Math.min(textScales.length - 1, Math.max(0, step + direction));

/** Whether the simulator controls show under the preview rather than beside it: only on a phone, and only when the device is not the iPhone. */
export const railUnderPreview = (narrow: boolean, win: PreviewWindow) => narrow && deviceOf(win) !== 'iPhone';
