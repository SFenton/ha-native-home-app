/**
 * The corpus cases of the two ids lane SD1/SD2 adds, both generic (nothing here is named for a room or a device): `sh.dial-control@1` (the `dial-control` node:
 * one or two stoppers on the thermostat's ring, the rule between them, limits, and one call for the dial or one per stopper, with `control` naming a stopper)
 * and `sh.dial-text-place@1` (a display `dial`'s `textAt`: where the block of lines in the middle stands). Demo ids only.
 *
 * `generate-expression-corpus.ts` writes them with its own, so one generator owns `contract/corpus/evaluation`. Publication cases are `pending-dialctl-*` and
 * `pending-dial-text-place-*` (the Studio compiles them) and `dialctl-*` and `dial-text-place-*` (the Studio refuses them); every refusal records the Studio's
 * first issue here by hand in `expect`, and the generator fails when the compiler disagrees. The family is `dialctl`, not `dial-control`, so the older `dial-`
 * family (`sh.dial@1`) does not claim its files by prefix. The evaluation cases are written by hand from the rules in `dial-control-math.ts`'s header, never
 * computed by the module under test: the thermostat's own rule (the low handle at or below the high one, `ThermostatTargets.setting`) and plain arithmetic.
 */
type J = Record<string, any>;

export interface DialCtlCase {
  name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean;
  /** The Studio's first issue, written by hand: a reject must give exactly this. */
  expect?: { code: string; pointer: string };
}
export interface DialCtlEvaluation { name: string; note: string; subject: J; env: J; expected: J }
/** The families this module owns: `reject/pending-<family>-*` and `reject/<family>-*`. `dial-text-place` files also match the older `dial` family's prefix, which is the same generator. */
export const dialCtlFamilies = ['dialctl', 'dial-text-place'];
/** Capability ids by the short names the cases use. */
export const dialCtlNeeds: Record<string, string> = {
  dialctl: 'sh.dial-control@1', 'dial-text-place': 'sh.dial-text-place@1', dial: 'sh.dial@1', bindings: 'sh.bindings@1', rules: 'sh.rules@1', conditions: 'sh.conditions@1',
  'call-service': 'sh.call-service@1', 'enabled-when': 'sh.enabled-when@1',
};

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const rgba = (red: number, green: number, blue: number, alpha: number): J => ({ type: 'rgba', red, green, blue, alpha });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const orange = solid(205, 84, 1), teal = solid(44, 142, 152), white = rgba(255, 255, 255, 0.55);
/** A value with its undefined fields dropped, as the file will hold it: a field written `undefined` here is one a case leaves out. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const control = (stopper?: string): J => (stopper === undefined ? { type: 'control' } : { type: 'control', stopper });
/** A `climate.set_temperature` call with the fields given (demo entity id). */
const call = (fields: J, rest: J = {}): J => ({ type: 'call-service', domain: 'climate', service: 'set_temperature', target: { entity_id: lit('climate.demo_hall') }, data: { type: 'object', fields }, ...rest });
const stopperOf = (id: string, label: string, value: J, rest: J = {}): J => ({ id, value, label: lit(label), ink: id === 'high' ? teal : orange, ...rest });
const lowStopper = (rest: J = {}) => stopperOf('low', 'Heat to', lit(68), { trail: 'from-start', trailInk: orange, ...rest });
const highStopper = (rest: J = {}) => stopperOf('high', 'Cool to', lit(75), { trail: 'to-end', trailInk: teal, ...rest });

/** A heat and cool range: two stoppers that stop at each other, one call for the dial, the reading in the middle. */
const rangeOf = (props: J = {}, rest: J = {}, id = 'c'): J => plain(node(id, 'dial-control', {
  props: {
    range: { min: 60, max: 80, step: 0.5 }, size: 'page', stoppers: [lowStopper(), highStopper()], between: { rule: 'stop' },
    reading: { value: lit(71), ink: white },
    center: { top: lit('Heating'), value: { shows: 'reading', fractionDigits: 0, unit: '°' }, caption: 'stoppers' },
    unavailableText: 'Unavailable', failureText: 'Could not set {value}', ...props,
  },
  action: call({ target_temp_low: control('low'), target_temp_high: control('high') }),
  a11y: { label: lit('Hall thermostat') }, ...rest,
}));
/** One stopper: a target, its own value shown in the middle. */
const oneOf = (props: J = {}, rest: J = {}): J => rangeOf({
  stoppers: [stopperOf('target', 'Target', lit(70), { trail: 'from-start', trailInk: orange })], between: undefined, reading: undefined,
  center: { value: { shows: 'target', fractionDigits: 1, unit: '°' } }, ...props,
}, { action: call({ temperature: control('target') }), ...rest });
/** Two stoppers, each with its own call: a bare `control` is that stopper's value. */
const perStopperOf = (props: J = {}, rest: J = {}): J => rangeOf({
  stoppers: [lowStopper({ action: call({ target_temp_low: control() }) }), highStopper({ action: call({ target_temp_high: control() }) })], between: { rule: 'free' }, ...props,
}, { action: undefined, ...rest });
/** A display dial with a pointer and two lines in the middle: the barometer's shape, for the text place. */
const dialOf = (props: J = {}, rest: J = {}): J => plain(node('d', 'dial', {
  props: {
    sweep: { start: 145, length: 250 }, aspect: 1.4, centerY: 0.56, ticks: { count: 25, inner: 0.78, outer: 0.92, width: 1.4, ink: white },
    pointer: { kind: 'tick', value: lit(0.5), inner: 0.7, outer: 0.98, width: 3, ink: orange },
    center: [{ value: lit('1013'), style: 'title3', unavailableText: '-' }, { value: lit('hPa'), style: 'caption1', unavailableText: '-' }], ...props,
  }, a11y: { element: 'hidden' }, ...rest,
}));
/** The generator adds the app-state sources to a case that is not one of its own; these cases use none, so they are dropped (keeps the first refusal the case's own). */
const noAppState: DialCtlCase['tweak'] = envelope => { envelope.document.dataSources = envelope.document.dataSources.filter((entry: J) => entry.model !== 'app-state@1'); };

export const dialCtlCases: DialCtlCase[] = [];
const accept = (name: string, note: string, needs: string[], components: J[]) => dialCtlCases.push({ name, note, needs, components, tweak: noAppState, reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], expect: DialCtlCase['expect']) =>
  dialCtlCases.push({ name, note, needs, components, tweak: noAppState, reject: true, expect });
const at = (index: number, rest: string) => `/document/pages/2/components/${index}${rest}`;

// MARK: Dial control, accepted (`sh.dial-control@1`)
accept('pending-dialctl-one-stopper', 'One stopper, one call: the smallest dial control. The call reads the stopper as `control` with its id.', ['dialctl'], [oneOf()]);
accept('pending-dialctl-range-one-call', 'A heat and cool range: two stoppers that stop at each other, and one call that reads each by its id.', ['dialctl'], [rangeOf()]);
accept('pending-dialctl-per-stopper-calls', 'Two free stoppers, one call each: inside a stopper\'s own call a bare `control` is its value.', ['dialctl'], [perStopperOf()]);
accept('pending-dialctl-gap-number', 'Two stoppers that stay at least 2 apart.', ['dialctl'], [rangeOf({ between: { rule: 'stop', gap: lit(2) } })]);
accept('pending-dialctl-gap-read', 'The least difference comes from an entity: a number read from its state.', ['dialctl', 'bindings'],
  [rangeOf({ between: { rule: 'stop', gap: read('temp', ['state'], 'number') } })]);
accept('pending-dialctl-limit-number', 'A stopper with a lowest and a highest, as numbers.', ['dialctl'], [oneOf({ stoppers: [stopperOf('target', 'Target', lit(70), { limit: { min: lit(62), max: lit(78) } })] })]);
accept('pending-dialctl-limit-read', 'A highest that another entity holds.', ['dialctl', 'bindings'],
  [oneOf({ stoppers: [stopperOf('target', 'Target', lit(70), { limit: { max: read('temp', ['state'], 'number') } })] })]);
accept('pending-dialctl-value-read', 'A stopper that follows an entity: its value is a number read from its state.', ['dialctl', 'bindings'],
  [oneOf({ stoppers: [stopperOf('target', 'Target', read('temp', ['state'], 'number'))] })]);
accept('pending-dialctl-ruled-ink', 'A rim that follows a rule: orange while a read is above 75, else teal. The rules id and the conditions id are declared too.', ['dialctl', 'rules', 'conditions', 'bindings'],
  [oneOf({ stoppers: [stopperOf('target', 'Target', lit(70), { ink: { type: 'conditional', cases: [{ when: { type: 'compare', op: 'above', left: read('temp', ['state'], 'number'), right: lit(75) }, then: orange }], otherwise: teal } })] })]);
accept('pending-dialctl-bands-and-ticks', 'A coloured stretch of the range and dots every 5.', ['dialctl'], [rangeOf({ bands: [{ from: 66, to: 74, ink: teal }], ticks: { every: 5 } })]);
accept('pending-dialctl-dimmed-and-enabled', 'Dimmed while a read is below 60, and enabled by a rule.', ['dialctl', 'conditions', 'enabled-when', 'bindings'],
  [rangeOf({ dimmedWhen: { type: 'compare', op: 'below', left: read('temp', ['state'], 'number'), right: lit(60) } },
    { enabledWhen: { condition: { type: 'compare', op: 'above', left: read('temp', ['state'], 'number'), right: lit(0) }, whenUnknown: 'disabled' } })]);
accept('pending-dialctl-range-2000-steps', 'A range of exactly 2,000 steps is allowed: 0 to 580 by 0.29 (580 / 0.29 is 2000.0000000000002 in floating point).', ['dialctl'], [rangeOf({ range: { min: 0, max: 580, step: 0.29 }, stoppers: [lowStopper({ value: lit(100) }), highStopper({ value: lit(300) })] })]);
accept('pending-dialctl-sizes-and-mirrors', 'The compact size, flipped in a right-to-left layout.', ['dialctl'], [rangeOf({ size: 'compact', mirrors: true })]);
accept('pending-dialctl-center-text-bound', 'The top line and the caption are authored text; the spoken name and value come from an entity.', ['dialctl', 'bindings'],
  [rangeOf({ center: { top: read('temp', ['attributes', 'friendly_name']), value: { shows: 'low', fractionDigits: 1, unit: '' }, caption: lit('Set by schedule') } },
    { a11y: { label: read('temp', ['attributes', 'friendly_name']), value: read('temp', ['state']) } })]);
accept('pending-dialctl-spoken-value', 'A stopper says its value in words: `{value}` is the number.', ['dialctl'],
  [oneOf({ stoppers: [stopperOf('target', 'Target', lit(70), { spokenValue: '{value} degrees' })] })]);
accept('pending-dialctl-in-a-grid', 'A dial control takes a width in a grid like any node.', ['dialctl'], [node('grid', 'tile-grid', {
  props: { minimum: 'tile@1', maxColumns: 2, spacing: { type: 'token', name: 'm' }, equalRowHeights: true, shortRow: 'share', fold: 'page' }, children: [rangeOf({}, { layout: { span: 2 } })] })]);

// MARK: Dial control, refused
const bad = (name: string, note: string, props: J, expectation: DialCtlCase['expect'], rest: J = {}, needs = ['dialctl']) => reject(name, note, needs, [rangeOf(props, rest)], expectation);
const badOne = (name: string, note: string, props: J, expectation: DialCtlCase['expect'], rest: J = {}, needs = ['dialctl']) => reject(name, note, needs, [oneOf(props, rest)], expectation);
bad('dialctl-call-form-mixed', 'One call for the dial or one per stopper, never both: a stopper that has its own call beside the dial\'s refuses.', { stoppers: [lowStopper({ action: call({ target_temp_low: control() }) }), highStopper()] },
  { code: 'invalid_combination', pointer: at(0, '/props/stoppers/0/action') });
bad('dialctl-call-form-none', 'A dial control sends something: no call at all is refused.', {}, { code: 'missing_required', pointer: at(0, '/action') }, { action: undefined });
bad('dialctl-call-form-partial', 'Calls per stopper cover every stopper: the second has none.', { stoppers: [lowStopper({ action: call({ target_temp_low: control() }) }), highStopper()] },
  { code: 'missing_required', pointer: at(0, '/props/stoppers/1/action') }, { action: undefined });
bad('dialctl-call-never-reads-control', 'A call that never reads the value changes nothing.', {}, { code: 'invalid_combination', pointer: at(0, '/action') }, { action: call({ target_temp_low: lit(70) }) });
bad('dialctl-stopper-call-never-reads-control', 'A stopper\'s own call reads its value too.', { stoppers: [lowStopper({ action: call({ target_temp_low: lit(70) }) }), highStopper({ action: call({ target_temp_high: control() }) })], between: { rule: 'free' } },
  { code: 'invalid_combination', pointer: at(0, '/props/stoppers/0/action') }, { action: undefined });
bad('dialctl-control-without-stopper', 'In the dial\'s one call every `control` names its stopper: a bare one is ambiguous.', {}, { code: 'invalid_combination', pointer: at(0, '/action/data/fields/target_temp_high') },
  { action: call({ target_temp_low: control('low'), target_temp_high: control() }) });
bad('dialctl-control-unknown-stopper', 'The stopper a `control` names is one of the dial\'s.', {}, { code: 'invalid_reference', pointer: at(0, '/action/data/fields/target_temp_high/stopper') },
  { action: call({ target_temp_low: control('low'), target_temp_high: control('top') }) });
bad('dialctl-control-stopper-in-stopper-call', 'A stopper\'s own call reads a bare `control`; naming a stopper there is refused.', { stoppers: [lowStopper({ action: call({ target_temp_low: control('low') }) }), highStopper({ action: call({ target_temp_high: control() }) })], between: { rule: 'free' } },
  { code: 'invalid_combination', pointer: at(0, '/props/stoppers/0/action/data/fields/target_temp_low/stopper') }, { action: undefined });
reject('dialctl-control-stopper-outside-dial', 'A `control` names a stopper only inside a dial control: a bound slider\'s call that does is refused at the `stopper` field.', ['dialctl'],
  [node('s', 'bound-control', { props: { unavailableText: 'Unavailable', kind: 'slider', value: read('temp', ['state'], 'number') },
    action: { type: 'call-service', domain: 'fan', service: 'set_percentage', target: { entity_id: lit('fan.demo_bath_fan') }, data: { type: 'object', fields: { percentage: control('low') } } } })],
  { code: 'invalid_combination', pointer: at(0, '/action/data/fields/percentage/stopper') });
bad('dialctl-control-in-value', 'A stopper\'s value is read from Home Assistant, not from the control itself.', { stoppers: [stopperOf('low', 'Heat to', control('low')), highStopper()] },
  { code: 'invalid_combination', pointer: at(0, '/props/stoppers/0/value') });
bad('dialctl-stoppers-empty', 'A dial control has one stopper at least.', { stoppers: [], between: undefined }, { code: 'limit_exceeded', pointer: at(0, '/props/stoppers') });
bad('dialctl-stoppers-over-2', 'And two at most.', { stoppers: [lowStopper(), highStopper(), stopperOf('third', 'Third', lit(72))] }, { code: 'limit_exceeded', pointer: at(0, '/props/stoppers') });
bad('dialctl-stopper-id-duplicate', 'A stopper\'s id is its own.', { stoppers: [lowStopper(), highStopper({ id: 'low' })] }, { code: 'duplicate_id', pointer: at(0, '/props/stoppers/1/id') },
  { action: call({ target_temp_low: control('low') }) });
bad('dialctl-stopper-id-reading', '`reading` names the reading in the middle: it is not a stopper\'s id.', { stoppers: [lowStopper({ id: 'reading' }), highStopper()] }, { code: 'invalid_value', pointer: at(0, '/props/stoppers/0/id') },
  { action: call({ target_temp_low: control('reading'), target_temp_high: control('high') }) });
bad('dialctl-stopper-value-missing', 'A stopper says where its value comes from.', { stoppers: [{ id: 'low', label: lit('Heat to'), ink: orange }, highStopper()] }, { code: 'missing_required', pointer: at(0, '/props/stoppers/0/value') });
bad('dialctl-stopper-value-text', 'A stopper\'s value is a number.', { stoppers: [stopperOf('low', 'Heat to', read('temp', ['state'], 'string')), highStopper()] },
  { code: 'binding_type', pointer: at(0, '/props/stoppers/0/value') }, {}, ['dialctl', 'bindings']);
bad('dialctl-stopper-label-missing', 'A stopper has a name for VoiceOver.', { stoppers: [{ id: 'low', value: lit(68), ink: orange }, highStopper()] }, { code: 'missing_required', pointer: at(0, '/props/stoppers/0/label') });
bad('dialctl-stopper-ink-missing', 'A stopper says its rim\'s colour.', { stoppers: [{ id: 'low', value: lit(68), label: lit('Heat to') }, highStopper()] }, { code: 'missing_required', pointer: at(0, '/props/stoppers/0/ink') });
bad('dialctl-stopper-trail-ink-without-trail', 'A trail colour with no trail has nothing to colour.', { stoppers: [lowStopper({ trail: undefined }), highStopper()] }, { code: 'invalid_combination', pointer: at(0, '/props/stoppers/0/trailInk') });
bad('dialctl-stopper-trail-unknown', 'The trails are none, from the start and to the end.', { stoppers: [lowStopper({ trail: 'both' }), highStopper()] }, { code: 'unknown_variant', pointer: at(0, '/props/stoppers/0/trail') });
bad('dialctl-spoken-value-unknown-token', 'A stopper\'s spoken value holds `{value}` and no other token.', { stoppers: [lowStopper({ spokenValue: '{degrees} degrees' }), highStopper()] }, { code: 'invalid_reference', pointer: at(0, '/props/stoppers/0/spokenValue') });
bad('dialctl-failure-text-unclosed-token', 'The failure line closes its token.', { failureText: 'Could not set {value' }, { code: 'invalid_value', pointer: at(0, '/props/failureText') });
bad('dialctl-limit-empty', 'A limit says a side.', { stoppers: [lowStopper({ limit: {} }), highStopper()] }, { code: 'invalid_value', pointer: at(0, '/props/stoppers/0/limit') });
bad('dialctl-limit-min-not-below-max', 'A literal lowest is below the highest.', { stoppers: [lowStopper({ limit: { min: lit(70), max: lit(65) } }), highStopper()] }, { code: 'invalid_value', pointer: at(0, '/props/stoppers/0/limit/max') });
bad('dialctl-limit-text', 'A limit is a number.', { stoppers: [lowStopper({ limit: { max: read('temp', ['state'], 'string') } }), highStopper()] }, { code: 'binding_type', pointer: at(0, '/props/stoppers/0/limit/max') }, {}, ['dialctl', 'bindings']);
bad('dialctl-between-missing', 'Two stoppers say the rule between them.', { between: undefined }, { code: 'missing_required', pointer: at(0, '/props/between') });
badOne('dialctl-between-with-one-stopper', 'One stopper has nothing between.', { between: { rule: 'stop' } }, { code: 'invalid_combination', pointer: at(0, '/props/between') });
bad('dialctl-between-rule-unknown', 'The rules are free and stop: pushing the other along is not one.', { between: { rule: 'push' } }, { code: 'unknown_variant', pointer: at(0, '/props/between/rule') });
bad('dialctl-gap-with-free', 'A gap is for stoppers that stop at each other.', { between: { rule: 'free', gap: lit(2) } }, { code: 'invalid_combination', pointer: at(0, '/props/between/gap') });
bad('dialctl-gap-negative', 'A gap is 0 or more.', { between: { rule: 'stop', gap: lit(-1) } }, { code: 'invalid_value', pointer: at(0, '/props/between/gap') });
bad('dialctl-gap-as-large-as-the-range', 'A literal gap is under the range: 20 on a range of 20 leaves no room.', { between: { rule: 'stop', gap: lit(20) } }, { code: 'invalid_value', pointer: at(0, '/props/between/gap') });
bad('dialctl-gap-text', 'A gap is a number.', { between: { rule: 'stop', gap: read('temp', ['state'], 'string') } }, { code: 'binding_type', pointer: at(0, '/props/between/gap') }, {}, ['dialctl', 'bindings']);
bad('dialctl-range-max-not-above-min', 'A range goes up.', { range: { min: 80, max: 80, step: 0.5 } }, { code: 'invalid_value', pointer: at(0, '/props/range/max') });
bad('dialctl-range-over-2000-steps', 'At most 2,000 steps: 0 to 100 by 0.04 is 2,500.', { range: { min: 0, max: 100, step: 0.04 } }, { code: 'limit_exceeded', pointer: at(0, '/props/range/step') });
bad('dialctl-range-just-over-2000-steps', 'The limit is exact, not rounded: 0 to 100.02 by 0.05 is 2,000.4 steps and is refused.', { range: { min: 0, max: 100.02, step: 0.05 } }, { code: 'limit_exceeded', pointer: at(0, '/props/range/step') });
bad('dialctl-range-step-below-0.01', 'A step is at least 0.01.', { range: { min: 0, max: 1, step: 0.001 } }, { code: 'limit_exceeded', pointer: at(0, '/props/range/step') });
bad('dialctl-range-step-missing', 'A range says its step.', { range: { min: 60, max: 80 } }, { code: 'missing_required', pointer: at(0, '/props/range/step') });
bad('dialctl-sweep-authored', 'The ring is fixed: 270 degrees from 135. It has no sweep to author.', { sweep: { start: 90, length: 180 } }, { code: 'unknown_field', pointer: at(0, '/props/sweep') });
bad('dialctl-size-unknown', 'The sizes are page, modal and compact.', { size: 'large' }, { code: 'unknown_variant', pointer: at(0, '/props/size') });
bad('dialctl-ticks-61-dots', 'A ring draws at most 60 dots: 0 to 60 by 1 is 61.', { range: { min: 0, max: 60, step: 1 }, ticks: { every: 1 } }, { code: 'limit_exceeded', pointer: at(0, '/props/ticks/every') });
bad('dialctl-ticks-every-zero', 'A tick has a distance.', { ticks: { every: 0 } }, { code: 'limit_exceeded', pointer: at(0, '/props/ticks/every') });
bad('dialctl-bands-over-4', 'At most four bands.', { bands: Array.from({ length: 5 }, (_, index) => ({ from: 61 + index * 3, to: 63 + index * 3, ink: teal })) }, { code: 'limit_exceeded', pointer: at(0, '/props/bands') });
bad('dialctl-band-not-forward', 'A band runs forward.', { bands: [{ from: 74, to: 66, ink: teal }] }, { code: 'invalid_value', pointer: at(0, '/props/bands/0/to') });
bad('dialctl-band-outside-range', 'A band lies in the range.', { bands: [{ from: 70, to: 90, ink: teal }] }, { code: 'invalid_value', pointer: at(0, '/props/bands/0/to') });
bad('dialctl-center-missing', 'The middle says what it shows.', { center: undefined }, { code: 'missing_required', pointer: at(0, '/props/center') });
bad('dialctl-center-shows-unknown', 'The large value shows the reading or one of the dial\'s stoppers.', { center: { value: { shows: 'middle', fractionDigits: 0, unit: '' } } }, { code: 'invalid_reference', pointer: at(0, '/props/center/value/shows') });
bad('dialctl-center-shows-reading-without-one', 'The reading is shown only when there is one.', { reading: undefined }, { code: 'invalid_combination', pointer: at(0, '/props/center/value/shows') });
bad('dialctl-center-fraction-digits-over-2', 'The value has at most two decimals.', { center: { value: { shows: 'reading', fractionDigits: 3, unit: '' } } }, { code: 'limit_exceeded', pointer: at(0, '/props/center/value/fractionDigits') });
bad('dialctl-unavailable-text-missing', 'A dial control says its unavailable words.', { unavailableText: undefined }, { code: 'missing_required', pointer: at(0, '/props/unavailableText') });
bad('dialctl-a11y-missing', 'The readout is one element: it has a name.', {}, { code: 'missing_required', pointer: at(0, '/a11y') }, { a11y: undefined });
bad('dialctl-props-extra-field', 'A dial control has its own fields only.', { glow: true }, { code: 'unknown_field', pointer: at(0, '/props/glow') });
bad('dialctl-has-no-children', 'A dial control holds no nodes.', {}, { code: 'unknown_field', pointer: at(0, '/children') }, { children: [] });
bad('dialctl-mirrors-text', 'Flipping is a yes or no.', { mirrors: 'yes' }, { code: 'invalid_value', pointer: at(0, '/props/mirrors') });
bad('dialctl-reading-ink-missing', 'The reading says its colour.', { reading: { value: lit(71) } }, { code: 'missing_required', pointer: at(0, '/props/reading/ink') });
bad('dialctl-dimmed-when-bad-condition', 'A condition is a known kind.', { dimmedWhen: { type: 'between', value: lit(1) } }, { code: 'unknown_variant', pointer: at(0, '/props/dimmedWhen/type') });

// MARK: Dial text place (`sh.dial-text-place@1`)
accept('pending-dial-text-place-share-and-offset', 'The barometer\'s place: the block\'s centre half way down the height, then 4 points lower.', ['dial', 'dial-text-place'], [dialOf({ textAt: { share: 0.5, offset: 4 } })]);
accept('pending-dial-text-place-offset-only', 'An offset alone: the ring\'s centre, then 4 points lower.', ['dial', 'dial-text-place'], [dialOf({ textAt: { offset: 4 } })]);
accept('pending-dial-text-place-share-only', 'A share alone: half way down, no offset.', ['dial', 'dial-text-place'], [dialOf({ textAt: { share: 0.5 } })]);
accept('pending-dial-text-place-negative-offset', 'An offset may go up.', ['dial', 'dial-text-place'], [dialOf({ textAt: { share: 0.5, offset: -6 } })]);
const badText = (name: string, note: string, props: J, expectation: DialCtlCase['expect']) => reject(name, note, ['dial', 'dial-text-place'], [dialOf(props)], expectation);
badText('dial-text-place-states-neither', 'A place states a share or an offset: an empty one says nothing.', { textAt: {} }, { code: 'invalid_value', pointer: at(0, '/props/textAt') });
badText('dial-text-place-share-over-1', 'A share of the height is 0 to 1.', { textAt: { share: 1.5 } }, { code: 'limit_exceeded', pointer: at(0, '/props/textAt/share') });
badText('dial-text-place-offset-over-64', 'An offset is at most 64 points either way.', { textAt: { offset: 80 } }, { code: 'limit_exceeded', pointer: at(0, '/props/textAt/offset') });
badText('dial-text-place-without-center-text', 'A place needs lines to place.', { textAt: { share: 0.5 }, center: undefined }, { code: 'invalid_combination', pointer: at(0, '/props/textAt') });
badText('dial-text-place-extra-field', 'A place has its own fields only.', { textAt: { share: 0.5, align: 'left' } }, { code: 'unknown_field', pointer: at(0, '/props/textAt/align') });
badText('dial-text-place-offset-text', 'An offset is a number.', { textAt: { offset: '4' } }, { code: 'invalid_value', pointer: at(0, '/props/textAt/offset') });

// MARK: Evaluation
export const dialCtlEvaluations: DialCtlEvaluation[] = [];
const ctlCase = (name: string, note: string, subject: J, expected: J) => dialCtlEvaluations.push({ name, note, subject: { dialctl: subject }, env: {}, expected: { dialctl: expected } });
const operandCase = (name: string, note: string, subject: J, expected: J, env: J) => dialCtlEvaluations.push({ name, note, subject: { operand: subject }, env, expected });
const dialTextCase = (name: string, note: string, subject: J, expected: J) => dialCtlEvaluations.push({ name, note, subject: { dial: subject }, env: {}, expected: { dial: expected } });

// The thermostat: 60 to 80 by 0.5, heat to 68 and cool to 75, the low handle at or below the high one (`ThermostatTargets.setting`).
const TH = { min: 60, max: 80, step: 0.5 };
const therm = (rest: J = {}): J => ({ range: TH, stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: 75 }], between: { rule: 'stop' }, ...rest });
const wide = { min: 0, max: 100, step: 1 };

// Operands: `control` reads the value being sent.
operandCase('dialctl-control-stopper-low', '`control` with a stopper reads that stopper\'s new value.', { type: 'control', stopper: 'low' }, { status: 'value', value: 68 }, { controlValues: { low: 68, high: 75 } });
operandCase('dialctl-control-stopper-high', 'And the other\'s.', { type: 'control', stopper: 'high' }, { status: 'value', value: 75 }, { controlValues: { low: 68, high: 75 } });
operandCase('dialctl-control-stopper-not-sent', 'A stopper that sent nothing is unavailable.', { type: 'control', stopper: 'high' }, { status: 'unavailable' }, { controlValues: { low: 68 } });
operandCase('dialctl-control-bare-in-stopper-call', 'Inside a stopper\'s own call a bare `control` is that stopper\'s value.', { type: 'control' }, { status: 'value', value: 72 }, { controlValue: 72 });
operandCase('dialctl-control-stopper-ignores-bare-value', 'A named stopper is read from the stoppers\' values, not from the bare control value.', { type: 'control', stopper: 'low' }, { status: 'unavailable' }, { controlValue: 72 });

// State.
ctlCase('dialctl-state-editable', 'Both stoppers have a value: editable.', { op: 'state', input: therm() }, { state: 'editable' });
ctlCase('dialctl-state-one-drawn', 'One stopper with no value is not drawn; the other is still editable.', { op: 'state', input: therm({ stoppers: [{ id: 'low', value: null }, { id: 'high', value: 75 }] }) }, { state: 'editable' });
ctlCase('dialctl-state-none-drawn', 'With no stopper drawn the dial is unavailable.', { op: 'state', input: therm({ stoppers: [{ id: 'low', value: null }, { id: 'high', value: null }] }) }, { state: 'unavailable' });
ctlCase('dialctl-state-gap-unreadable', 'A gap that cannot be read makes the dial read-only.', { op: 'state', input: therm({ between: { rule: 'stop', gap: null } }) }, { state: 'read-only' });
ctlCase('dialctl-state-gap-negative', 'A gap read below 0 cannot be used: read-only.', { op: 'state', input: therm({ between: { rule: 'stop', gap: -1 } }) }, { state: 'read-only' });
ctlCase('dialctl-state-limit-unreadable', 'A limit that cannot be read makes the whole dial read-only, whichever stopper has it.', { op: 'state', input: therm({ stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: 75, limit: { max: null } }] }) }, { state: 'read-only' });
ctlCase('dialctl-state-unavailable-before-read-only', 'No drawn stopper is unavailable even when a limit is unreadable.', { op: 'state', input: therm({ stoppers: [{ id: 'low', value: null, limit: { max: null } }], between: undefined }) }, { state: 'unavailable' });

// Bounds.
ctlCase('dialctl-bounds-thermostat-low', 'The low handle stops at the high one (75) and has no stop mark: gap 0 is the thermostat\'s own rule.', { op: 'bounds', input: therm(), id: 'low' }, { bounds: { lower: 60, upper: 75, lowerMark: null, upperMark: null } });
ctlCase('dialctl-bounds-thermostat-high', 'The high handle stops at the low one (68).', { op: 'bounds', input: therm(), id: 'high' }, { bounds: { lower: 68, upper: 80, lowerMark: null, upperMark: null } });
ctlCase('dialctl-bounds-free', 'Free stoppers pass each other: each may go anywhere on the ring.', { op: 'bounds', input: therm({ between: { rule: 'free' } }), id: 'low' }, { bounds: { lower: 60, upper: 80, lowerMark: null, upperMark: null } });
ctlCase('dialctl-bounds-gap-low', 'A gap of 5 holds the low handle at 65, 5 short of the high one (70), and a stop mark stands there.',
  { op: 'bounds', input: { range: wide, stoppers: [{ id: 'low', value: 30 }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'low' }, { bounds: { lower: 0, upper: 65, lowerMark: null, upperMark: 65 } });
ctlCase('dialctl-bounds-gap-high', 'The high handle stays 5 above the low one (30): 35, with its mark.',
  { op: 'bounds', input: { range: wide, stoppers: [{ id: 'low', value: 30 }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'high' }, { bounds: { lower: 35, upper: 100, lowerMark: 35, upperMark: null } });
ctlCase('dialctl-bounds-limit-both-sides', 'A limit of 10 to 80 on a stopper on a range of 0 to 100: both stops have marks.',
  { op: 'bounds', input: { range: wide, stoppers: [{ id: 'target', value: 50, limit: { min: 10, max: 80 } }] }, id: 'target' }, { bounds: { lower: 10, upper: 80, lowerMark: 10, upperMark: 80 } });
ctlCase('dialctl-bounds-limit-at-the-ring-end', 'A limit at the ring\'s own end holds nothing more and has no mark.',
  { op: 'bounds', input: { range: wide, stoppers: [{ id: 'target', value: 50, limit: { min: 0, max: 100 } }] }, id: 'target' }, { bounds: { lower: 0, upper: 100, lowerMark: null, upperMark: null } });
ctlCase('dialctl-bounds-tightest-wins-limit', 'A highest of 60 is tighter than the gap\'s stop at 65: 60, marked.',
  { op: 'bounds', input: { range: wide, stoppers: [{ id: 'low', value: 30, limit: { max: 60 } }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'low' }, { bounds: { lower: 0, upper: 60, lowerMark: null, upperMark: 60 } });
ctlCase('dialctl-bounds-tightest-wins-gap', 'A highest of 70 is looser than the gap\'s stop at 65: 65, marked.',
  { op: 'bounds', input: { range: wide, stoppers: [{ id: 'low', value: 30, limit: { max: 70 } }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'low' }, { bounds: { lower: 0, upper: 65, lowerMark: null, upperMark: 65 } });
ctlCase('dialctl-bounds-other-not-drawn', 'A stopper with no value holds nothing against the other: the low handle may go to the ring\'s end.',
  { op: 'bounds', input: therm({ stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: null }] }), id: 'low' }, { bounds: { lower: 60, upper: 80, lowerMark: null, upperMark: null } });
ctlCase('dialctl-bounds-away-never-forced-low', 'Reported 68 and 70 with a gap of 5 are closer than the gap: they are drawn as they are. The low handle may stay at 68 or go down, never up.',
  { op: 'bounds', input: { range: wide, stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'low' }, { bounds: { lower: 0, upper: 68, lowerMark: null, upperMark: 68 } });
ctlCase('dialctl-bounds-away-never-forced-high', 'And the high handle may stay at 70 or go up, never down.',
  { op: 'bounds', input: { range: wide, stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'high' }, { bounds: { lower: 70, upper: 100, lowerMark: 70, upperMark: null } });
ctlCase('dialctl-bounds-past-its-limit', 'A value reported past its highest (90 on 80) may stay or come back, never go further.',
  { op: 'bounds', input: { range: wide, stoppers: [{ id: 'target', value: 90, limit: { max: 80 } }] }, id: 'target' }, { bounds: { lower: 0, upper: 90, lowerMark: null, upperMark: 90 } });
ctlCase('dialctl-bounds-read-only', 'A dial that is not editable has no bounds.', { op: 'bounds', input: therm({ between: { rule: 'stop', gap: null } }), id: 'low' }, { bounds: null });
ctlCase('dialctl-bounds-not-drawn', 'A stopper with no value has no bounds.', { op: 'bounds', input: therm({ stoppers: [{ id: 'low', value: null }, { id: 'high', value: 75 }] }), id: 'low' }, { bounds: null });
ctlCase('dialctl-bounds-unknown-stopper', 'A stopper that is not there has none.', { op: 'bounds', input: therm(), id: 'middle' }, { bounds: null });

// A stopper reported outside the ring: the ring's own ends are absolute, so they override "never forced".
const OUT_ABOVE = { range: TH, stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: 90 }], between: { rule: 'free' } };
const OUT_BELOW = { range: TH, stoppers: [{ id: 'low', value: 50 }, { id: 'high', value: 75 }], between: { rule: 'free' } };
ctlCase('dialctl-bounds-reported-above-the-ring', 'A stopper reported at 90 on a ring of 60 to 80 has its upper bound at the ring\'s end, 80: no mark, whatever "never forced" says elsewhere.', { op: 'bounds', input: OUT_ABOVE, id: 'high' }, { bounds: { lower: 60, upper: 80, lowerMark: null, upperMark: null } });
ctlCase('dialctl-bounds-reported-below-the-ring', 'And one reported at 50 has its lower bound at 60.', { op: 'bounds', input: OUT_BELOW, id: 'low' }, { bounds: { lower: 60, upper: 80, lowerMark: null, upperMark: null } });
ctlCase('dialctl-move-reported-above-the-ring', 'Any move of a stopper reported above the ring brings it inside: dragged to 79 it is 79; dragged to 95 it is 80, and the ring\'s end is not a stop.', { op: 'move', input: OUT_ABOVE, id: 'high', raw: 95 }, { move: { value: 80, stopped: false } });
ctlCase('dialctl-move-reported-below-the-ring', 'A stopper reported at 50 dragged to 55 is 60.', { op: 'move', input: OUT_BELOW, id: 'low', raw: 55 }, { move: { value: 60, stopped: false } });
ctlCase('dialctl-adjust-reported-above-the-ring', 'Adjust down from 90 goes to the ring\'s last grid value below 90, which is 80 (a step from outside the ring lands inside it).', { op: 'adjust', input: OUT_ABOVE, id: 'high', direction: -1 }, { value: 80 });
ctlCase('dialctl-adjust-reported-above-the-ring-up', 'Adjust up from 90 stays at 90: nothing above it is on the ring.', { op: 'adjust', input: OUT_ABOVE, id: 'high', direction: 1 }, { value: 90 });
ctlCase('dialctl-adjust-reported-below-the-ring', 'Adjust up from 50 goes to 60, the ring\'s first value.', { op: 'adjust', input: OUT_BELOW, id: 'low', direction: 1 }, { value: 60 });
ctlCase('dialctl-adjust-reported-below-the-ring-down', 'Adjust down from 50 stays at 50.', { op: 'adjust', input: OUT_BELOW, id: 'low', direction: -1 }, { value: 50 });

// Moves.
ctlCase('dialctl-move-inside', 'Dragged to 70, inside its bounds: 70.', { op: 'move', input: therm(), id: 'low', raw: 70 }, { move: { value: 70, stopped: false } });
ctlCase('dialctl-move-snaps-down', '70.2 on a grid of 0.5 from 60 is 70.', { op: 'move', input: therm(), id: 'low', raw: 70.2 }, { move: { value: 70, stopped: false } });
ctlCase('dialctl-move-snaps-up', '70.3 is 70.5.', { op: 'move', input: therm(), id: 'low', raw: 70.3 }, { move: { value: 70.5, stopped: false } });
ctlCase('dialctl-move-half-goes-up', 'Half way between two values goes up: 70.25 is 70.5.', { op: 'move', input: therm(), id: 'low', raw: 70.25 }, { move: { value: 70.5, stopped: false } });
ctlCase('dialctl-move-stops-at-the-other', 'The low handle dragged to 78 stops at the high one, 75, and says it stopped.', { op: 'move', input: therm(), id: 'low', raw: 78 }, { move: { value: 75, stopped: true } });
ctlCase('dialctl-move-high-stops-at-the-other', 'The high handle dragged to 62 stops at 68.', { op: 'move', input: therm(), id: 'high', raw: 62 }, { move: { value: 68, stopped: true } });
ctlCase('dialctl-move-held-by-the-ring', 'The ring\'s own end is not a stop: 55 is 60 and it did not stop.', { op: 'move', input: therm(), id: 'low', raw: 55 }, { move: { value: 60, stopped: false } });
ctlCase('dialctl-move-free-passes', 'Free stoppers pass: the low handle goes to 78.', { op: 'move', input: therm({ between: { rule: 'free' } }), id: 'low', raw: 78 }, { move: { value: 78, stopped: false } });
ctlCase('dialctl-move-gap', 'With a gap of 5 the low handle dragged to 90 stops at 65.', { op: 'move', input: { range: wide, stoppers: [{ id: 'low', value: 30 }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'low', raw: 90 }, { move: { value: 65, stopped: true } });
ctlCase('dialctl-move-gap-off-the-grid', 'A stop that falls between grid values gives the one inside it: a gap of 3 on a grid of 5 holds the low handle at 47, so 45.',
  { op: 'move', input: { range: { min: 0, max: 100, step: 5 }, stoppers: [{ id: 'low', value: 10 }, { id: 'high', value: 50 }], between: { rule: 'stop', gap: 3 } }, id: 'low', raw: 100 }, { move: { value: 45, stopped: true } });
ctlCase('dialctl-move-gap-off-the-grid-high', 'And the high handle, held at 13, takes 15.',
  { op: 'move', input: { range: { min: 0, max: 100, step: 5 }, stoppers: [{ id: 'low', value: 10 }, { id: 'high', value: 50 }], between: { rule: 'stop', gap: 3 } }, id: 'high', raw: 0 }, { move: { value: 15, stopped: true } });
ctlCase('dialctl-move-limit', 'A highest of 80: dragged to 95 the stopper stops at 80.', { op: 'move', input: { range: wide, stoppers: [{ id: 'target', value: 50, limit: { min: 10, max: 80 } }] }, id: 'target', raw: 95 }, { move: { value: 80, stopped: true } });
ctlCase('dialctl-move-limit-lowest', 'A lowest of 10: dragged to 2 it stops at 10.', { op: 'move', input: { range: wide, stoppers: [{ id: 'target', value: 50, limit: { min: 10, max: 80 } }] }, id: 'target', raw: 2 }, { move: { value: 10, stopped: true } });
ctlCase('dialctl-move-no-grid-value-inside', 'A limit of 21 to 29 on a grid of 10 holds no grid value: the stopper keeps its 25.',
  { op: 'move', input: { range: { min: 0, max: 100, step: 10 }, stoppers: [{ id: 'target', value: 25, limit: { min: 21, max: 29 } }] }, id: 'target', raw: 50 }, { move: { value: 25, stopped: true } });
ctlCase('dialctl-move-away-from-the-other', 'Two values closer than the gap: the low handle at 68 may go down to 60 but not up.',
  { op: 'move', input: { range: wide, stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'low', raw: 69 }, { move: { value: 68, stopped: true } });
ctlCase('dialctl-move-away-from-the-other-down', 'And down is free.',
  { op: 'move', input: { range: wide, stoppers: [{ id: 'low', value: 68 }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'low', raw: 40 }, { move: { value: 40, stopped: false } });
ctlCase('dialctl-move-read-only', 'A read-only dial moves nothing.', { op: 'move', input: therm({ between: { rule: 'stop', gap: null } }), id: 'low', raw: 70 }, { move: null });
ctlCase('dialctl-move-not-a-number', 'A raw value that is not a number keeps the stopper where it is.', { op: 'move', input: therm(), id: 'low', raw: null }, { move: { value: 68, stopped: true } });

// Adjust (VoiceOver adjust, Raise and Lower).
ctlCase('dialctl-adjust-up', 'One step up from 68 is 68.5.', { op: 'adjust', input: therm(), id: 'low', direction: 1 }, { value: 68.5 });
ctlCase('dialctl-adjust-down', 'One step down is 67.5.', { op: 'adjust', input: therm(), id: 'low', direction: -1 }, { value: 67.5 });
ctlCase('dialctl-adjust-stops-at-the-other', 'The low handle at 75 beside the high one at 75 does not go up.', { op: 'adjust', input: therm({ stoppers: [{ id: 'low', value: 75 }, { id: 'high', value: 75 }] }), id: 'low', direction: 1 }, { value: 75 });
ctlCase('dialctl-adjust-ring-end', 'At the ring\'s end it does not go on.', { op: 'adjust', input: therm({ stoppers: [{ id: 'low', value: 60 }, { id: 'high', value: 75 }] }), id: 'low', direction: -1 }, { value: 60 });
ctlCase('dialctl-adjust-off-the-grid-up', 'A value off the grid (68.3) goes to the grid value above: 68.5.', { op: 'adjust', input: therm({ stoppers: [{ id: 'low', value: 68.3 }, { id: 'high', value: 75 }] }), id: 'low', direction: 1 }, { value: 68.5 });
ctlCase('dialctl-adjust-off-the-grid-down', 'And the one below: 68.', { op: 'adjust', input: therm({ stoppers: [{ id: 'low', value: 68.3 }, { id: 'high', value: 75 }] }), id: 'low', direction: -1 }, { value: 68 });
ctlCase('dialctl-adjust-gap', 'With a gap of 5 the low handle at 64.5 goes up one step to 65 and no further.', { op: 'adjust', input: { range: { min: 0, max: 100, step: 0.5 }, stoppers: [{ id: 'low', value: 64.5 }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'low', direction: 1 }, { value: 65 });
ctlCase('dialctl-adjust-gap-held', 'At 65 it holds.', { op: 'adjust', input: { range: { min: 0, max: 100, step: 0.5 }, stoppers: [{ id: 'low', value: 65 }, { id: 'high', value: 70 }], between: { rule: 'stop', gap: 5 } }, id: 'low', direction: 1 }, { value: 65 });
ctlCase('dialctl-adjust-read-only', 'A read-only dial adjusts nothing: there is no answer.', { op: 'adjust', input: therm({ between: { rule: 'stop', gap: null } }), id: 'low', direction: 1 }, { value: null });

// Nearest stopper for a tap.
ctlCase('dialctl-nearest-low', 'A tap at 70 is nearer 68 than 75: the low one.', { op: 'nearest', input: therm(), raw: 70 }, { id: 'low' });
ctlCase('dialctl-nearest-high', 'A tap at 73 is nearer 75.', { op: 'nearest', input: therm(), raw: 73 }, { id: 'high' });
ctlCase('dialctl-nearest-tie-goes-first', 'A tap at 71.5 is 3.5 from each: the first stopper.', { op: 'nearest', input: therm(), raw: 71.5 }, { id: 'low' });
ctlCase('dialctl-nearest-stacked-below', 'Two stoppers at 70 and a tap below: the first.', { op: 'nearest', input: therm({ stoppers: [{ id: 'low', value: 70 }, { id: 'high', value: 70 }] }), raw: 65 }, { id: 'low' });
ctlCase('dialctl-nearest-stacked-above', 'And a tap above them: the second.', { op: 'nearest', input: therm({ stoppers: [{ id: 'low', value: 70 }, { id: 'high', value: 70 }] }), raw: 75 }, { id: 'high' });
ctlCase('dialctl-nearest-only-drawn', 'A stopper with no value is never the nearest.', { op: 'nearest', input: therm({ stoppers: [{ id: 'low', value: null }, { id: 'high', value: 75 }] }), raw: 60 }, { id: 'high' });
ctlCase('dialctl-nearest-read-only', 'A read-only dial has none.', { op: 'nearest', input: therm({ between: { rule: 'stop', gap: null } }), raw: 70 }, { id: null });

// The ring: grid, ticks, angles.
ctlCase('dialctl-snap-nearest-clamped', 'On a grid of 3 from 0 (the last value is 9), 10 is held at 9.', { op: 'snap', range: { min: 0, max: 10, step: 3 }, value: 10 }, { value: 9 });
ctlCase('dialctl-snap-down', 'Down from 7.9 is 6.', { op: 'snap', range: { min: 0, max: 10, step: 3 }, value: 7.9, mode: 'down' }, { value: 6 });
ctlCase('dialctl-snap-up', 'Up from 6.1 is 9.', { op: 'snap', range: { min: 0, max: 10, step: 3 }, value: 6.1, mode: 'up' }, { value: 9 });
ctlCase('dialctl-snap-noise', 'A step of 0.1 gives 0.3, not 0.30000000000000004.', { op: 'snap', range: { min: 0, max: 1, step: 0.1 }, value: 0.29 }, { value: 0.3 });
ctlCase('dialctl-ticks-every-5', 'Dots every 5 on 60 to 80: five.', { op: 'ticks', range: TH, every: 5 }, { values: [60, 65, 70, 75, 80] });
ctlCase('dialctl-ticks-fraction', 'Dots every 0.25 on 0 to 1.', { op: 'ticks', range: { min: 0, max: 1, step: 0.05 }, every: 0.25 }, { values: [0, 0.25, 0.5, 0.75, 1] });
ctlCase('dialctl-ticks-end-not-reached', 'Dots every 7 on 60 to 80 stop at 74: the next would pass the end.', { op: 'ticks', range: TH, every: 7 }, { values: [60, 67, 74] });
ctlCase('dialctl-ticks-60-dots', '60 dots: 0 to 59 by 1 is the most a ring draws.', { op: 'tick-count', range: { min: 0, max: 59, step: 1 }, every: 1 }, { count: 60 });
ctlCase('dialctl-angle-start', 'The ring starts at 135 degrees (lower left): the lowest value.', { op: 'angle', range: TH, value: 60 }, { degrees: 135 });
ctlCase('dialctl-angle-middle', 'The middle value is straight up, 270.', { op: 'angle', range: TH, value: 70 }, { degrees: 270 });
ctlCase('dialctl-angle-end', 'The highest is 135 + 270 = 405 (45 degrees, lower right).', { op: 'angle', range: TH, value: 80 }, { degrees: 405 });
ctlCase('dialctl-angle-held-at-the-ends', 'A value past the end is held at it.', { op: 'angle', range: TH, value: 90 }, { degrees: 405 });
ctlCase('dialctl-angle-mirrored-start', 'Mirrored for right-to-left, the lowest is 180 - 135 = 45.', { op: 'angle', range: TH, value: 60, mirrored: true }, { degrees: 45 });
ctlCase('dialctl-angle-mirrored-middle', 'And the middle is 180 - 270 = -90.', { op: 'angle', range: TH, value: 70, mirrored: true }, { degrees: -90 });

// The text place of a display dial.
const PRESSURE_BOX = { width: 140, aspect: 1.4, centerY: 0.56, sweep: { start: 145, length: 250 } };
dialTextCase('dial-text-place-absent', 'A dial that states no place centres its text on the ring: 0.56 of 100 is 56.', { op: 'layout', input: PRESSURE_BOX, pick: ['textCenterY'] }, { textCenterY: 56 });
dialTextCase('dial-text-place-barometer', 'The barometer\'s place: 0.5 of 100 plus 4 is 54, two points above the ring\'s centre (production\'s `(height - total) / 2 + 4`).',
  { op: 'layout', input: { ...PRESSURE_BOX, textAt: { share: 0.5, offset: 4 } }, pick: ['textCenterY', 'cy'] }, { textCenterY: 54, cy: 56 });
dialTextCase('dial-text-place-level-near-93', 'At about 93 wide the two places meet: the dial is 66.4286 tall, 0.5 of it plus 4 is 37.2143 and 0.56 of it is 37.2 (the decision\'s "level at about 93 pt wide").',
  { op: 'layout', input: { ...PRESSURE_BOX, width: 93, textAt: { share: 0.5, offset: 4 } }, pick: ['textCenterY', 'cy'] }, { textCenterY: 37.2143, cy: 37.2 });
dialTextCase('dial-text-place-offset-only', 'An offset alone is from the ring\'s centre: 56 + 4 is 60.', { op: 'layout', input: { ...PRESSURE_BOX, textAt: { offset: 4 } }, pick: ['textCenterY'] }, { textCenterY: 60 });
dialTextCase('dial-text-place-share-only', 'A share alone has no offset: 0.5 of 100 is 50.', { op: 'layout', input: { ...PRESSURE_BOX, textAt: { share: 0.5 } }, pick: ['textCenterY'] }, { textCenterY: 50 });
dialTextCase('dial-text-place-negative-offset', 'An offset may go up: 50 - 6 is 44.', { op: 'layout', input: { ...PRESSURE_BOX, textAt: { share: 0.5, offset: -6 } }, pick: ['textCenterY'] }, { textCenterY: 44 });
dialTextCase('dial-text-place-share-zero', 'A share of 0 is the top of the dial: the centre of the block stands at 0.', { op: 'layout', input: { ...PRESSURE_BOX, textAt: { share: 0 } }, pick: ['textCenterY'] }, { textCenterY: 0 });
dialTextCase('dial-text-place-empty-is-absent', 'A place that states neither draws as no place.', { op: 'layout', input: { ...PRESSURE_BOX, textAt: {} }, pick: ['textCenterY'] }, { textCenterY: 56 });
