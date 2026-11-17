import { z } from 'zod/v4';
import { identifierSchema as id } from '../validation';
import { callServiceSchema, enabledWhenSchema, visibilityFields } from './expression';
import { label, navigationAction, symbolSlot, text, textValue } from './slots';

/**
 * Orientation and corner button groups for any surface that draws a picture: a vacuum's map today, an image or camera surface later.
 * The shapes are shared on purpose (`sh.surface-orientation@1`, `sh.surface-controls@1`); `vacuum.ts` only says where they sit and
 * which commands its source supports. Design: `build/design/vacuum-map-ctl.md`.
 */
const object = z.strictObject;

// MARK: Orientation

/**
 * How a picture is mirrored (`sh.surface-orientation@1`), after any rotation, in screen space. Both on is the owner's "invert". It lives with the
 * picture's source, so every drawing of that picture (map, area editor, report) agrees about left and right.
 */
export const surfaceOrientationSchema = object({ flipHorizontal: z.boolean(), flipVertical: z.boolean() });
export type SurfaceOrientation = z.infer<typeof surfaceOrientationSchema>;
/** Whether an orientation changes anything: no object, or both flips off, draws the picture as before. */
export const flips = (orientation: SurfaceOrientation | undefined): boolean => Boolean(orientation?.flipHorizontal || orientation?.flipVertical);

// MARK: Controls

/** The four corners, in the order the app reads them. They are leading and trailing, so a right-to-left language swaps sides. */
export const surfaceCorners = ['top-leading', 'top-trailing', 'bottom-leading', 'bottom-trailing'] as const;
export type SurfaceCorner = typeof surfaceCorners[number];
export type SurfaceAxis = 'row' | 'column';
/** The most buttons in a group; the fit rule, not this limit, decides how many show. */
export const MAX_GROUP_BUTTONS = 8;

/** The surface's own action (a vacuum's Locate): it hides while the source cannot run it. */
const mapAction = object({ type: z.literal('map'), command: z.enum(['locate']) });
/**
 * A command of the source (a vacuum's Dock or Pause). It shares the state rules of the source's own command tile: shown only when the command is
 * offered, dimmed while it is blocked, the reason spoken as its VoiceOver value.
 */
const sourceCommandAction = object({ type: z.literal('source-command'), command: z.string().regex(/^[a-zA-Z]{2,24}$/) });
/** What a button does: a map action, a source command, a plain service call, or navigation. */
const buttonAction = z.union([mapAction, sourceCommandAction, callServiceSchema, navigationAction]);

/**
 * One button. The symbol and the label may follow a rule or an entity as a tile's buttons do (`sh.tile-disc-rules@1`); the label is what VoiceOver
 * and Voice Control read. `visibleWhen` and `enabledWhen` belong to a service call or navigation: a map action and a source command have state rules of their own.
 */
export const surfaceButtonSchema = object({
  id, icon: symbolSlot, label: z.union([label, textValue(80, false)]), hint: text(160).optional(),
  action: buttonAction, ...visibilityFields, enabledWhen: enabledWhenSchema.optional(),
});
export const surfaceGroupSchema = object({
  corner: z.enum(surfaceCorners), axis: z.enum(['row', 'column']),
  buttons: z.array(surfaceButtonSchema).min(1).max(MAX_GROUP_BUTTONS),
});
/** At most one group per corner. */
export const surfaceControlsSchema = z.array(surfaceGroupSchema).max(4);
export type SurfaceButton = z.infer<typeof surfaceButtonSchema>;
export type SurfaceGroup = z.infer<typeof surfaceGroupSchema>;
export type SurfaceControls = z.infer<typeof surfaceControlsSchema>;

// MARK: Defaults

/** The Locate button an unauthored map has today: a `scope` glyph, "Locate", the robot plays a sound. */
export const locateButton: SurfaceButton = {
  id: 'locate', icon: { type: 'sf-symbol', name: 'scope', rendering: 'canonical', unavailable: 'fallback' },
  label: 'Locate', hint: 'Asks the robot to play a sound.', action: { type: 'map', command: 'locate' },
};
/** What a surface without `controls` draws: one group, top leading, one column, holding Locate when `locate` is true. */
export const defaultControls = (locate: boolean): SurfaceControls => locate ? [{ corner: 'top-leading', axis: 'column', buttons: [locateButton] }] : [];
/** The groups a map draws: the authored ones, or the default derived from `locate`. */
export const effectiveControls = (map: { locate: boolean; controls?: SurfaceControls }): SurfaceControls => map.controls ?? defaultControls(map.locate);
/** Whether any button is Locate: the truth `locate` must state when `controls` is authored. */
export const hasLocate = (controls: SurfaceControls): boolean => controls.some(group => group.buttons.some(button => button.action.type === 'map' && button.action.command === 'locate'));
/**
 * The map with `controls` written back in its canonical form: `locate` states whether a Locate button exists, and `controls` is dropped when it
 * holds nothing or exactly the default (so a map that looks as before declares nothing new).
 */
export function withControls<T extends { locate: boolean; controls?: SurfaceControls }>(map: T, controls: SurfaceControls): T {
  const { controls: _old, ...rest } = map; void _old;
  const locate = hasLocate(controls);
  const plain = controls.length === 0 || JSON.stringify(controls) === JSON.stringify(defaultControls(true));
  return { ...rest, locate, ...(plain ? {} : { controls }) } as T;
}

// MARK: Validation

type Add = (code: 'invalid_value' | 'invalid_combination' | 'duplicate_id', pointer: string) => void;
/** What a source supports: the surface's own commands, the commands of the source, and which navigation. */
export interface ControlsSupport { map: readonly string[]; commands: readonly string[]; navigation: readonly string[] }

/**
 * The checks the shape cannot hold: one group per corner, unique ids, each command known to the source, Locate once, and that a map action or a
 * source command carries no `visibleWhen` or `enabledWhen` (their state rules are the app's). `locate` must equal whether Locate is authored.
 */
export function validateSurfaceControls(controls: SurfaceControls, locate: boolean, support: ControlsSupport, p: string, add: Add) {
  const corners = new Set<string>(), ids = new Set<string>();
  let locates = 0;
  controls.forEach((group, i) => {
    if (corners.has(group.corner)) add('duplicate_id', `${p}/controls/${i}/corner`);
    corners.add(group.corner);
    group.buttons.forEach((button, j) => {
      const at = `${p}/controls/${i}/buttons/${j}`, action = button.action;
      if (ids.has(button.id)) add('duplicate_id', `${at}/id`);
      ids.add(button.id);
      if (action.type === 'map') {
        if (!support.map.includes(action.command)) add('invalid_combination', `${at}/action/command`);
        else if (action.command === 'locate' && ++locates > 1) add('invalid_combination', `${at}/action`);
      } else if (action.type === 'source-command') {
        if (!support.commands.includes(action.command)) add('invalid_combination', `${at}/action/command`);
      } else if (action.type !== 'call-service') {
        if (!support.navigation.includes(action.type) || (action.type === 'present' && action.ifPresented !== 'reject')) add('invalid_combination', `${at}/action`);
      }
      if (action.type === 'map' || action.type === 'source-command') {
        if (button.visibleWhen !== undefined) add('invalid_combination', `${at}/visibleWhen`);
        if (button.enabledWhen !== undefined) add('invalid_combination', `${at}/enabledWhen`);
      }
    });
  });
  if (locate !== hasLocate(controls)) add('invalid_combination', `${p}/locate`);
}
