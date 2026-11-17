/**
 * The corpus cases of `sh.tile-swipe@1` (Swipe to Adjust): an optional `props.swipe` on `light-group-tile` and `state-tile`.
 *
 *   tsx scripts/generate-tile-swipe-corpus.ts   # rewrites contract/corpus/{accept,reject}/{pending-,}tile-swipe-*.json and their index entries
 *
 * Accepted cases are `reject/pending-tile-swipe-*` (the Studio compiles them, the shipped list refuses them first); refusals are `reject/tile-swipe-*` with the
 * Studio's first issue written here by hand. Demo ids only. The design is `build/design/tile-swipe.md`: absolute tracking (no `track`), a band that can be
 * switched off (`band`), a bubble that is always drawn (no `feedback`), at most 100 steps, a detent that is a multiple of the step with at most 25 across the range.
 */
import { at, lit, node, read, writeFamily, type J, type TileCase } from './tilecontract-lib';

const cases: TileCase[] = [];
const accept = (name: string, note: string, components: J[], tweak?: TileCase['tweak']) =>
  cases.push({ name: `pending-tile-swipe-${name}`, note, needs: ['tile-swipe'], components, reject: false, tweak });
const reject = (name: string, note: string, components: J[], expect: TileCase['expect'], tweak?: TileCase['tweak']) =>
  cases.push({ name: `tile-swipe-${name}`, note, needs: ['tile-swipe'], components, reject: true, expect, tweak });

// MARK: Builders
const control: J = { type: 'control' };
const swipeBase = (range: J, rest: J = {}): J => ({ axis: 'horizontal', range, commit: 'release', ...rest });
const percent: J = { min: 0, max: 100, step: 1 };
const light = (swipe?: J, props: J = {}): J => node('lamp', 'light-group-tile', { props: { sourceId: 'light-main', ...(swipe ? { swipe } : {}), ...props } });
const tile = (swipe?: J, entity = 'cover.demo_blinds', rest: J = {}, props: J = {}): J => node('blinds-tile', 'state-tile', {
  icon: { type: 'sf-symbol', name: 'blinds.horizontal.open', rendering: 'canonical', unavailable: 'fallback' }, binding: entity.startsWith('cover.') ? { entityId: entity, builtIn: 'blind' } : { entityId: entity, styleId: `demo-${entity.split('.')[0]}` },
  props: { ...(swipe ? { swipe } : {}), ...props }, ...rest,
});
const service = (domain: string, name: string, entity: string, field: string, value: J = control, rest: J = {}): J => ({
  type: 'call-service', domain, service: name, target: { entity_id: lit(entity) }, data: { type: 'object', fields: { [field]: value } }, ...rest,
});
const position = (rest: J = {}): J => swipeBase(percent, {
  value: read('blinds', ['attributes', 'current_position'], 'number'), action: service('cover', 'set_cover_position', 'cover.demo_blinds', 'position'), label: 'position', format: '{value}%', ...rest,
});
const swipePath = (index: number, rest: string) => at(index, `/props/swipe${rest}`);

// MARK: Accepted
accept('light-minimal', 'A light group tile with the smallest swipe: the range is the light\'s own, 0 to 100 by 1, and the source owns the call.', [light(swipeBase(percent))]);
accept('light-detent-haptic-none-band-off', 'A light group tile with its own detent, no haptic ticks and no band: the bubble still shows.', [light(swipeBase(percent, { detent: 20, haptic: 'none', band: false }))]);
accept('light-with-no-swipe-needs-no-id', 'A light group tile with no swipe needs no new id and is the tile it always was.', [light()]);
accept('cover-position', 'A cover tile that sets its position from the drag: value is the entity\'s `current_position`, the call carries `control`.', [tile(position())]);
accept('fan-percentage', 'A fan tile: the speed in percent, a step the fan reports (10) and a detent of 20.', [tile(swipeBase({ min: 0, max: 100, step: 10 }, {
  value: read('fan', ['attributes', 'percentage'], 'number'), action: service('fan', 'set_percentage', 'fan.demo_fan', 'percentage'), label: 'speed', format: '{value}%', detent: 20 }), 'fan.demo_fan')]);
accept('climate-setpoint-half-degrees', 'A setpoint from 60 to 85 by 0.5: 50 steps, a detent of 1 (a multiple of the step) and 25 ticks across the range.', [tile(swipeBase({ min: 60, max: 85, step: 0.5 }, {
  value: read('thermostat', ['attributes', 'temperature'], 'number'), action: service('climate', 'set_temperature', 'climate.demo_thermostat', 'temperature'), label: 'temperature', format: '{value}°', detent: 1 }), 'climate.demo_thermostat')]);
accept('volume-divide', 'A speaker\'s volume is a level from 0 to 1: the call divides `control` by 100, the shape a progress percentage uses.', [tile(swipeBase(percent, {
  value: { type: 'math', op: 'multiply', args: [read('speaker', ['attributes', 'volume_level'], 'number'), lit(100)] },
  action: service('media_player', 'volume_set', 'media_player.demo_speaker', 'volume_level', { type: 'math', op: 'divide', args: [control, lit(100)] }), label: 'volume', format: '{value}%' }), 'media_player.demo_speaker')]);
accept('label-and-format', 'The words VoiceOver and the bubble use: a label and a format with the value token.', [tile(position({ label: 'position', format: 'Open {value}%' }))]);
accept('together-with-progress-and-discs', 'A swipe beside the tile\'s progress and two buttons: one band, and the swipe\'s value is the one drawn.', [tile(position(), 'cover.demo_blinds', {}, {
  progress: read('blinds', ['attributes', 'current_position'], 'number'),
  discs: [{ id: 'open', icon: { type: 'sf-symbol', name: 'arrow.up', rendering: 'canonical', unavailable: 'fallback' }, label: 'Open', action: { type: 'call-service', domain: 'cover', service: 'open_cover', target: { entity_id: lit('cover.demo_blinds') } } }] })]);
accept('one-hundred-steps', 'The most steps a range holds: 100 across 0 to 100 by 1 is allowed.', [light(swipeBase(percent))]);
accept('twenty-five-detents', 'The most ticks across a range: a detent of 4 over 0 to 100 gives 25.', [light(swipeBase(percent, { detent: 4 }))]);
accept('haptic-detent-explicit', 'The default haptic written out.', [light(swipeBase(percent, { haptic: 'detent', band: true }))]);
accept('band-off-state-tile', 'A setpoint\'s share of its range means nothing to the eye: the band is off, the bubble stays.', [tile(position({ band: false }))]);

// MARK: Refused: the shape
reject('axis-vertical', 'A vertical swipe belongs to the scroll: `axis` is a list of one.', [light(swipeBase(percent, { axis: 'vertical' }))], { code: 'unknown_variant', pointer: swipePath(0, '/axis') });
reject('axis-missing', '`axis` is required.', [light((() => { const swipe = swipeBase(percent); delete swipe.axis; return swipe; })())], { code: 'missing_required', pointer: swipePath(0, '/axis') });
reject('commit-live', 'A throttled live commit is `@2`: `commit` is a list of one.', [light(swipeBase(percent, { commit: 'live' }))], { code: 'unknown_variant', pointer: swipePath(0, '/commit') });
reject('commit-missing', '`commit` is required.', [light((() => { const swipe = swipeBase(percent); delete swipe.commit; return swipe; })())], { code: 'missing_required', pointer: swipePath(0, '/commit') });
reject('track-field', 'Tracking is always absolute: there is no `track` field.', [light(swipeBase(percent, { track: 'relative' }))], { code: 'unknown_field', pointer: swipePath(0, '/track') });
reject('feedback-field', 'The band is `band` and the bubble is always drawn: there is no `feedback` field.', [light(swipeBase(percent, { feedback: { fill: 'none', bubble: false } }))], { code: 'unknown_field', pointer: swipePath(0, '/feedback') });
reject('extra-field', 'An unknown field is refused.', [light(swipeBase(percent, { sound: true }))], { code: 'unknown_field', pointer: swipePath(0, '/sound') });
reject('on-another-tile', 'Only a light group tile and a state tile take a swipe: an action tile refuses it.', [node('power', 'action-tile', {
  icon: { type: 'sf-symbol', name: 'power', rendering: 'canonical', unavailable: 'fallback' }, binding: { sourceId: 'source-power', projection: 'power-tile@1' },
  props: { family: 'neutral', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy', swipe: swipeBase(percent) }, action: { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } } })],
  { code: 'unknown_field', pointer: at(0, '/props/swipe') });
reject('capability-not-declared', 'A swipe whose manifest does not list `sh.tile-swipe@1` does not match the document.', [light(swipeBase(percent))], { code: 'capability_manifest_mismatch', pointer: '/capabilities' },
  () => undefined);
cases[cases.length - 1].finish = envelope => { envelope.capabilities = envelope.capabilities.filter((name: string) => name !== 'sh.tile-swipe@1'); };

// MARK: Refused: the range and the detent
reject('range-min-not-below-max', '`min` must be below `max`.', [tile(position({ range: { min: 50, max: 50, step: 1 } }))], { code: 'invalid_value', pointer: swipePath(0, '/range/max') });
reject('range-min-above-max', '`min` above `max` is the same fault.', [tile(position({ range: { min: 100, max: 0, step: 1 } }))], { code: 'invalid_value', pointer: swipePath(0, '/range/max') });
reject('range-step-zero', '`step` must be above zero.', [tile(position({ range: { min: 0, max: 100, step: 0 } }))], { code: 'invalid_value', pointer: swipePath(0, '/range/step') });
reject('range-step-negative', 'A negative `step` is the same fault.', [tile(position({ range: { min: 0, max: 100, step: -1 } }))], { code: 'invalid_value', pointer: swipePath(0, '/range/step') });
reject('range-over-100-steps', 'More than 100 steps is under 1.5 points of travel a step on the narrowest tile: refused.', [tile(position({ range: { min: 0, max: 100, step: 0.5 } }))], { code: 'limit_exceeded', pointer: swipePath(0, '/range/step') });
reject('range-missing', '`range` is required.', [tile((() => { const swipe = position(); delete swipe.range; return swipe; })())], { code: 'missing_required', pointer: swipePath(0, '/range') });
reject('detent-zero', '`detent` must be above zero.', [tile(position({ detent: 0 }))], { code: 'invalid_value', pointer: swipePath(0, '/detent') });
reject('detent-negative', 'A negative `detent` is refused.', [tile(position({ detent: -10 }))], { code: 'invalid_value', pointer: swipePath(0, '/detent') });
reject('detent-beyond-span', '`detent` beyond the span is refused.', [tile(position({ detent: 120 }))], { code: 'invalid_value', pointer: swipePath(0, '/detent') });
reject('detent-not-a-multiple-of-step', '`detent` must be a multiple of `step`: 7 is not a multiple of 5.', [tile(position({ range: { min: 0, max: 100, step: 5 }, detent: 7 }))], { code: 'invalid_value', pointer: swipePath(0, '/detent') });
reject('detent-over-25-ticks', 'More than 25 ticks across the range is under 6 points apart on the narrowest tile: 100 / 2 is 50.', [tile(position({ detent: 2 }))], { code: 'limit_exceeded', pointer: swipePath(0, '/detent') });
reject('format-without-value', 'The bubble must show the number: a format with no `{value}` is refused.', [tile(position({ format: 'Open' }))], { code: 'invalid_value', pointer: swipePath(0, '/format') });
reject('format-unknown-token', 'The only token is `{value}`.', [tile(position({ format: '{percent}%' }))], { code: 'invalid_value', pointer: swipePath(0, '/format') });

// MARK: Refused: a light group tile
reject('light-with-value', 'The light source owns the value: a `value` on a light group tile is refused.', [light(swipeBase(percent, { value: read('blinds', ['state'], 'number') }))], { code: 'invalid_combination', pointer: swipePath(0, '/value') });
reject('light-with-action', 'The light source owns the call (turn on with `brightness_pct`, off at 0, never toggle): an `action` is refused.', [light(swipeBase(percent, { action: service('light', 'turn_on', 'light.demo_lamp', 'brightness_pct') }))], { code: 'invalid_combination', pointer: swipePath(0, '/action') });
reject('light-with-label', 'A light group tile is fixed to "brightness": a `label` is refused.', [light(swipeBase(percent, { label: 'level' }))], { code: 'invalid_combination', pointer: swipePath(0, '/label') });
reject('light-with-format', 'The words of a light group tile are its own ("Off", "45%"): a `format` is refused.', [light(swipeBase(percent, { format: '{value}%' }))], { code: 'invalid_combination', pointer: swipePath(0, '/format') });
reject('light-range-not-percent', 'A light dims over 0 to 100 by 1: another range is refused.', [light(swipeBase({ min: 10, max: 90, step: 1 }))], { code: 'invalid_value', pointer: swipePath(0, '/range') });

// MARK: Refused: a state tile
reject('state-without-value', 'A state tile must say the number it shows now.', [tile((() => { const swipe = position(); delete swipe.value; return swipe; })())], { code: 'missing_required', pointer: swipePath(0, '/value') });
reject('state-without-action', 'A state tile must say what a release sends.', [tile((() => { const swipe = position(); delete swipe.action; return swipe; })())], { code: 'missing_required', pointer: swipePath(0, '/action') });
reject('state-without-label', 'A state tile must name what it adjusts: VoiceOver says "Swipe up or down to adjust <label>."', [tile((() => { const swipe = position(); delete swipe.label; return swipe; })())], { code: 'missing_required', pointer: swipePath(0, '/label') });
reject('state-call-never-uses-control', 'A call that never uses `control` would change nothing: refused.', [tile(position({ action: service('cover', 'set_cover_position', 'cover.demo_blinds', 'position', lit(50)) }))], { code: 'invalid_combination', pointer: swipePath(0, '/action') });
reject('state-call-asks-first', 'A drag that ends in a question is not feedback that predicts the result: a call that asks first is refused.', [tile(position({
  action: service('cover', 'set_cover_position', 'cover.demo_blinds', 'position', control, { confirmation: { type: 'additional', style: 'alert', title: 'Move the blinds?', confirmLabel: 'Move', cancelLabel: 'Cancel', destructive: false } }) }))],
  { code: 'invalid_combination', pointer: swipePath(0, '/action/confirmation') });
reject('state-value-is-text', 'The value is a number: a text read is refused.', [tile(position({ value: read('blinds', ['state'], 'string') }))], { code: 'binding_type', pointer: swipePath(0, '/value') });
reject('state-value-uses-control', '`control` is the committed number, not the number the tile shows now.', [tile(position({ value: control }))], { code: 'invalid_combination', pointer: swipePath(0, '/value') });

writeFamily('tile-swipe', cases, { 'tile-swipe': 'sh.tile-swipe@1' });
