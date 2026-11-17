import { surfaceCorners, type SurfaceAxis, type SurfaceButton, type SurfaceControls, type SurfaceCorner } from './surface-controls';

/**
 * The edits an author makes to a surface's corner groups, as pure functions over the list (the inspector's add, reorder, move to corner and remove).
 * Each returns a new list; a corner never holds an empty group, and a new group is a column.
 */
export interface Place { corner: SurfaceCorner; index: number; count: number }

/** Where a button is: its corner, its position in the group and the group's size. */
export function placeOf(controls: SurfaceControls, id: string): Place | undefined {
  for (const group of controls) {
    const index = group.buttons.findIndex(button => button.id === id);
    if (index >= 0) return { corner: group.corner, index, count: group.buttons.length };
  }
  return undefined;
}
/** The button with this id. */
export const buttonOf = (controls: SurfaceControls, id: string): SurfaceButton | undefined => controls.flatMap(group => group.buttons).find(button => button.id === id);
/** The groups in screen order (top leading, top trailing, bottom leading, bottom trailing). */
const ordered = (controls: SurfaceControls): SurfaceControls => [...controls].sort((a, b) => surfaceCorners.indexOf(a.corner) - surfaceCorners.indexOf(b.corner));
const tidy = (controls: SurfaceControls): SurfaceControls => ordered(controls.filter(group => group.buttons.length > 0));

/** A button's id that no button of the list has: `base`, then `base-2`, `base-3`. */
export function freshId(controls: SurfaceControls, base: string): string {
  const taken = new Set(controls.flatMap(group => group.buttons.map(button => button.id)));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Adds a button last in a corner, starting a column when the corner is empty. */
export function addButton(controls: SurfaceControls, corner: SurfaceCorner, button: SurfaceButton): SurfaceControls {
  const has = controls.some(group => group.corner === corner);
  return tidy(has ? controls.map(group => group.corner === corner ? { ...group, buttons: [...group.buttons, button] } : group)
    : [...controls, { corner, axis: 'column', buttons: [button] }]);
}
/** Removes a button; an emptied corner goes with it. */
export const removeButton = (controls: SurfaceControls, id: string): SurfaceControls =>
  tidy(controls.map(group => ({ ...group, buttons: group.buttons.filter(button => button.id !== id) })));
/** Moves a button to `index` of its own group (clamped). */
export function moveWithin(controls: SurfaceControls, id: string, index: number): SurfaceControls {
  return controls.map(group => {
    const from = group.buttons.findIndex(button => button.id === id);
    if (from < 0) return group;
    const buttons = [...group.buttons], [button] = buttons.splice(from, 1);
    buttons.splice(Math.max(0, Math.min(buttons.length, index)), 0, button);
    return { ...group, buttons };
  });
}
/** Moves a button one place up (-1) or down (+1) in its group. */
export function nudge(controls: SurfaceControls, id: string, delta: -1 | 1): SurfaceControls {
  const place = placeOf(controls, id);
  return place ? moveWithin(controls, id, place.index + delta) : controls;
}
/** Moves a button to another corner, last in its group. */
export function moveToCorner(controls: SurfaceControls, id: string, corner: SurfaceCorner): SurfaceControls {
  const button = buttonOf(controls, id), place = placeOf(controls, id);
  if (!button || !place || place.corner === corner) return controls;
  return addButton(removeButton(controls, id), corner, button);
}
/** Changes a group's axis. */
export const setAxis = (controls: SurfaceControls, corner: SurfaceCorner, axis: SurfaceAxis): SurfaceControls =>
  controls.map(group => group.corner === corner ? { ...group, axis } : group);
/** Changes one button. */
export const updateButton = (controls: SurfaceControls, id: string, patch: Partial<SurfaceButton>): SurfaceControls =>
  controls.map(group => ({ ...group, buttons: group.buttons.map(button => button.id === id ? { ...button, ...patch } : button) }));
