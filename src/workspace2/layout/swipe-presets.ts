import type { Operand } from '../../shared/composition/expression';
import { defaultDetent, detentOf, MAX_SWIPE_DETENTS, MAX_SWIPE_STEPS, swipeSteps, type SwipeTile, type TileSwipe } from '../../shared/composition/tile-swipe';
import { formatSwipe, numberText } from '../../preview2/tile-swipe';

/**
 * Swipe to Adjust presets (`build/design/tile-swipe.md`, section 6). A preset is inspector sugar: the document holds the expanded fields, so a document that
 * was authored with a preset and one written by hand are the same document.
 */
export type SwipePreset = 'brightness' | 'cover-position' | 'fan-speed' | 'temperature' | 'volume' | 'custom';

/** The words of a preset in the Adjusts menu, and in the row's summary. */
export const presetWords: Record<SwipePreset, string> = {
  brightness: 'Brightness', 'cover-position': 'Cover Position', 'fan-speed': 'Fan Speed', temperature: 'Temperature', volume: 'Volume', custom: 'Custom',
};
/** The presets an entity's domain supports, then Custom. With no entity: Custom only. */
export function presetsFor(entityId: string | undefined): SwipePreset[] {
  const domain = entityId?.split('.')[0];
  const own: SwipePreset | undefined = domain === 'light' ? 'brightness' : domain === 'cover' ? 'cover-position' : domain === 'fan' ? 'fan-speed' : domain === 'climate' ? 'temperature' : domain === 'media_player' ? 'volume' : undefined;
  return own ? [own, 'custom'] : ['custom'];
}

/** What the entity reports about its own limits, when Home Assistant knows them. */
export interface SwipeFacts { minTemp?: number; maxTemp?: number; targetTempStep?: number; percentageStep?: number; deviceClass?: string }

const lit = (value: unknown): Operand => ({ type: 'literal', value } as Operand);
const attribute = (sourceId: string, name: string): Operand => ({ type: 'read', from: { type: 'source', sourceId, path: ['attributes', name] }, as: 'number', missing: 'unavailable' });
const control: Operand = { type: 'control' };
const call = (domain: string, service: string, entityId: string, field: string, value: Operand = control) => ({
  type: 'call-service' as const, domain, service, target: { entity_id: lit(entityId) }, data: { type: 'object' as const, fields: { [field]: value } },
});
const percent = { min: 0, max: 100, step: 1 };
const base = (range: TileSwipe['range'], rest: Partial<TileSwipe>): TileSwipe => ({ axis: 'horizontal', range, commit: 'release', ...rest });

/** The swipe a preset writes for a state tile over `entityId`, whose source (`ha-entity`) is `sourceId`. */
export function presetSwipe(preset: SwipePreset, entityId: string, sourceId: string, facts: SwipeFacts = {}): TileSwipe {
  switch (preset) {
    case 'brightness': return base(percent, {
      value: { type: 'math', op: 'round', args: [{ type: 'math', op: 'divide', args: [{ type: 'math', op: 'multiply', args: [attribute(sourceId, 'brightness'), lit(100)] }, lit(255)] }] } as Operand,
      action: call('light', 'turn_on', entityId, 'brightness_pct'), label: 'brightness', format: '{value}%', detent: 10,
    });
    case 'cover-position': return base(percent, { value: attribute(sourceId, 'current_position'), action: call('cover', 'set_cover_position', entityId, 'position'), label: 'position', format: '{value}%', detent: 10 });
    case 'fan-speed': {
      const step = facts.percentageStep && facts.percentageStep > 0 ? facts.percentageStep : 1;
      return base({ min: 0, max: 100, step }, { value: attribute(sourceId, 'percentage'), action: call('fan', 'set_percentage', entityId, 'percentage'), label: 'speed', format: '{value}%', detent: Math.max(10, Math.ceil(10 / step) * step) });
    }
    case 'temperature': {
      const min = facts.minTemp ?? 50, max = facts.maxTemp ?? 90, step = facts.targetTempStep ?? 1;
      const range = { min, max, step };
      return base(range, { value: attribute(sourceId, 'temperature'), action: call('climate', 'set_temperature', entityId, 'temperature'), label: 'temperature', format: '{value}°', detent: Math.max(step, Math.ceil((max - min) / MAX_SWIPE_DETENTS / step) * step) });
    }
    case 'volume': return base(percent, {
      value: { type: 'math', op: 'round', args: [{ type: 'math', op: 'multiply', args: [attribute(sourceId, 'volume_level'), lit(100)] }] } as Operand,
      action: call('media_player', 'volume_set', entityId, 'volume_level', { type: 'math', op: 'divide', args: [control, lit(100)] } as Operand), label: 'volume', format: '{value}%', detent: 10,
    });
    case 'custom': return base({ min: 0, max: 100, step: 1 }, {
      value: attribute(sourceId, 'state'), action: { type: 'call-service', domain: 'input_number', service: 'set_value', target: { entity_id: lit(entityId) }, data: { type: 'object', fields: { value: control } } }, label: 'value', format: '{value}', detent: 10,
    });
  }
}
/** The swipe a light group tile gets: the light's own range, its source owns the call. */
export const lightSwipe = (): TileSwipe => base(percent, {});

/** Which preset a state tile's swipe is: the one whose call it holds, else Custom. */
export function presetOf(swipe: TileSwipe): SwipePreset {
  const action = swipe.action;
  if (!action) return 'custom';
  const { domain, service } = action;
  const is = (d: string, s: string) => domain === d && service === s;
  return is('light', 'turn_on') ? 'brightness' : is('cover', 'set_cover_position') ? 'cover-position' : is('fan', 'set_percentage') ? 'fan-speed'
    : is('climate', 'set_temperature') ? 'temperature' : is('media_player', 'volume_set') ? 'volume' : 'custom';
}
/** The row's summary: "Off", or what the swipe adjusts. */
export function swipeSummary(swipe: TileSwipe | undefined, tile: SwipeTile): string {
  if (!swipe) return 'Off';
  return tile === 'light-group-tile' ? 'Brightness' : presetWords[presetOf(swipe)];
}
/** The sentence of the call a release sends, for the page's read-only "When You Let Go". */
export function releaseSentence(swipe: TileSwipe, tile: SwipeTile): string {
  if (tile === 'light-group-tile') return 'The light source sends the call.';
  const action = swipe.action;
  if (!action) return 'Nothing is sent.';
  const fields = action.data && 'fields' in action.data ? Object.keys(action.data.fields) : [];
  return `Calls ${action.domain}.${action.service}${fields.length ? ` with ${fields.join(' and ')} set to the value` : ''}.`;
}

// MARK: Checks

/** One line the page shows under the row it concerns. `warning` is a fault the author should fix; `note` only says something. */
export interface SwipeCheck { id: 'range' | 'tick' | 'text' | 'call' | 'asks' | 'sideways' | 'door' | 'volume' | 'progress' | 'only'; row: 'range' | 'tick' | 'text' | 'adjusts' | 'call' | 'band' | 'page'; tone: 'warning' | 'note'; text: string }
/** What the page knows beyond the swipe. */
export interface SwipeContext { tile: SwipeTile; inSidewaysRow?: boolean; deviceClass?: string; hasProgress?: boolean; hasOtherControl?: boolean }
/** The narrowest tile the grid makes, in points, and what a character of the bubble's type takes. */
const NARROWEST = 150, CHARACTER = 8.5, BUBBLE_PADDING = 24;

/** The checks section 6 lists, each a line with the row it sits under. They never hold an edit back: the compiler's refusals say the same in Checks. */
export function swipeChecks(swipe: TileSwipe, context: SwipeContext): SwipeCheck[] {
  const found: SwipeCheck[] = [];
  const { min, max, step } = swipe.range;
  if (!(min < max)) found.push({ id: 'range', row: 'range', tone: 'warning', text: 'Minimum must be below Maximum.' });
  else if (!(step > 0)) found.push({ id: 'range', row: 'range', tone: 'warning', text: 'Step must be above 0.' });
  else if (swipeSteps(swipe.range) > MAX_SWIPE_STEPS) found.push({ id: 'range', row: 'range', tone: 'warning', text: `At most ${MAX_SWIPE_STEPS} steps fit a tile. This range has ${numberText(swipeSteps(swipe.range))}.` });
  if (min < max && step > 0) {
    const detent = detentOf(swipe);
    if (swipe.detent !== undefined && (!(swipe.detent > 0) || Math.abs(swipe.detent / step - Math.round(swipe.detent / step)) > 1e-6)) found.push({ id: 'tick', row: 'tick', tone: 'warning', text: 'Tick Every must be a multiple of Step.' });
    else if ((max - min) / detent > MAX_SWIPE_DETENTS + 1e-6) found.push({ id: 'tick', row: 'tick', tone: 'warning', text: `At most ${MAX_SWIPE_DETENTS} ticks fit across the range.` });
  }
  const widest = Math.max(...[min, max].map(value => formatSwipe(swipe.format, value).length), 0);
  if (context.tile === 'state-tile' && widest * CHARACTER + BUBBLE_PADDING > NARROWEST) found.push({ id: 'text', row: 'text', tone: 'warning', text: 'Value Text does not fit the bubble on the narrowest tile.' });
  if (context.tile === 'state-tile') {
    if (swipe.action && !JSON.stringify(swipe.action).includes('"control"')) found.push({ id: 'call', row: 'call', tone: 'warning', text: 'The call never uses the value, so a swipe would change nothing.' });
    if (swipe.action?.confirmation?.type === 'additional') found.push({ id: 'asks', row: 'call', tone: 'warning', text: 'A call that asks first is not allowed. A drag that ends in a question does not predict the result.' });
    if (presetOf(swipe) === 'volume') found.push({ id: 'volume', row: 'range', tone: 'note', text: 'A swipe can set any volume in the range. Lower Maximum to cap it.' });
    if (presetOf(swipe) === 'cover-position' && ['door', 'garage', 'gate'].includes(context.deviceClass ?? '')) found.push({ id: 'door', row: 'adjusts', tone: 'warning', text: 'A swipe can open this door.' });
    if (context.hasOtherControl === false) found.push({ id: 'only', row: 'page', tone: 'warning', text: 'Swipe is the only way to set this here. Add a button or a details sheet.' });
  }
  if (context.inSidewaysRow) found.push({ id: 'sideways', row: 'page', tone: 'warning', text: 'This tile is in a row that scrolls sideways. The row scrolls and the swipe is off there. VoiceOver can still adjust it.' });
  if (context.hasProgress && swipe.band !== false) found.push({ id: 'progress', row: 'band', tone: 'note', text: 'The band shows the swipe value, not the Progress row.' });
  return found;
}
export { defaultDetent };
