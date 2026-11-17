/**
 * The corpus cases of the four style ids the weather-gen lane WG-S1 adds, all generic (nothing here is named for a card): `sh.text-style@1` (the `rgba`
 * colour, eleven text styles, `font`, `ink`, `lines`, `align`, `overflow`), `sh.stack@1` (the `stack` and `shape` nodes), `sh.symbol-part@1` (the `symbol`
 * node) and `sh.choice-icons@1` (a symbol and a hint on a choice's option). Demo ids only: `weather.demo_home` and `sun.demo_sun`.
 *
 * `generate-expression-corpus.ts` writes them with its own, so one generator owns `contract/corpus/evaluation`. Publication cases are `pending-<family>-*`
 * (the Studio compiles them) and `<family>-*` (the Studio refuses them); every refusal records the Studio's first issue here by hand in `expect`, and the
 * generator fails when the compiler disagrees. The evaluation cases pin the stack's two arrangements with the numbers of the app's hand-laid weather card
 * header (`UKWeatherCard.layout`): they are written by hand, never computed by the module under test.
 */
type J = Record<string, any>;

export interface WgStyleCase {
  name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean;
  /** The Studio's first issue, written by hand: a reject must give exactly this. */
  expect?: { code: string; pointer: string };
}
export interface WgStyleEvaluation { name: string; note: string; subject: J; env: J; expected: J }
/** The families this module owns: `reject/pending-<family>-*` and `reject/<family>-*`. */
export const wgStyleFamilies = ['text-style', 'stack', 'shape', 'symbol-part', 'choice-icons', 'rgba'];
/** Capability ids by the short names the cases use. */
export const wgStyleNeeds: Record<string, string> = {
  'text-style': 'sh.text-style@1', stack: 'sh.stack@1', 'symbol-part': 'sh.symbol-part@1', 'choice-icons': 'sh.choice-icons@1',
  'local-controls': 'sh.local-controls@1', 'local-state': 'sh.local-state@1', 'visible-when': 'sh.visible-when@1', grid: 'sh.grid@1',
};

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const symbolOf = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const rgba = (red: number, green: number, blue: number, alpha: number): J => ({ type: 'rgba', red, green, blue, alpha });
const pair = (light: J, dark: J): J => ({ type: 'solid-appearance', light, dark });
const token = (name: string): J => ({ type: 'token', name });
const points = (value: number): J => ({ type: 'points', value });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const textOf = (props: J = {}, id = 't', rest: J = {}): J => node(id, 'text', { props: { value: lit('72°'), style: 'body', unavailableText: 'None', ...props }, ...rest });
const stackOf = (props: J = {}, children: J[] = [], rest: J = {}, id = 's'): J => node(id, 'stack', { props: { axis: 'horizontal', spacing: token('m'), ...props }, children, ...rest });
const shapeOf = (props: J = {}, id = 'sh'): J => node(id, 'shape', { props: { form: 'capsule', width: 28, height: 8, fill: rgba(255, 255, 255, 0.18), ...props } });
const symbolPartOf = (props: J = {}, rest: J = {}, id = 'sy'): J => node(id, 'symbol', {
  props: { name: symbolOf('cloud.fill'), size: { points: 40 }, rendering: 'multicolor', ...props }, a11y: { element: 'hidden' }, ...rest });
const open: J = { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' };
const call: J = { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.demo_lamp') } };
const demoSources = (envelope: J) => {
  envelope.document.dataSources.push({ id: 'weather', kind: 'ha-entity', entityId: lit('weather.demo_home') }, { id: 'sun', kind: 'ha-entity', entityId: lit('sun.demo_sun') });
};
/** The state a segmented choice reads: two options, each with a symbol and a hint unless `bare`. */
const modeState = (options: J[]) => (envelope: J) => {
  envelope.document.localState = [{ id: 'mode', type: 'choice', initial: 'condition', options }];
};
const optionOf = (id: string, rest: J = {}): J => ({ id, label: id[0].toUpperCase() + id.slice(1), ...rest });
const segmented = (kind = 'segmented-choice'): J[] => [node('seg', 'local-control', { props: { stateId: 'mode', kind, placeholder: '' } })];
/** A symbol chosen by the weather entity's state, with the fallback every state not listed draws. */
const bySymbol: J = {
  type: 'bound-symbol', fallback: symbolOf('cloud.fill'),
  value: { type: 'map', of: read('weather', ['state']), cases: [{ equals: 'rainy', then: lit('cloud.rain.fill') }, { equals: 'sunny', then: lit('sun.max.fill') }], otherwise: lit('cloud.fill') },
};

export const wgStyleCases: WgStyleCase[] = [];
const accept = (name: string, note: string, needs: string[], components: J[], tweak?: WgStyleCase['tweak']) => wgStyleCases.push({ name, note, needs, components, tweak: both(tweak), reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], expect: WgStyleCase['expect'], tweak?: WgStyleCase['tweak']) =>
  wgStyleCases.push({ name, note, needs, components, tweak: both(tweak), reject: true, expect });
/** Every case reads the demo entities; a case's own tweak runs after. */
function both(tweak?: WgStyleCase['tweak']): WgStyleCase['tweak'] { return envelope => { demoSources(envelope); tweak?.(envelope); }; }
const at = (index: number, rest: string) => `/document/pages/2/components/${index}${rest}`;

// MARK: Text style (`sh.text-style@1`): the rgba colour, eleven styles, font, ink, lines, align and overflow
for (const style of ['large-title', 'title1', 'title2', 'title3', 'callout', 'caption2'])
  accept(`pending-text-style-style-${style}`, `The style ${style}, one of the five the text could not name before (large-title, title1, title2, title3, callout, caption2).`, ['text-style'], [textOf({ style })]);
accept('pending-text-style-old-styles-need-no-id', 'A text that uses only the older styles and none of the new fields needs no new id: it is still the plain text part.', [], [textOf({ style: 'footnote' })]);
accept('pending-text-style-font-weight', 'A bold title: the weight changes the style\'s own.', ['text-style'], [textOf({ style: 'title3', font: { weight: 'bold' } })]);
accept('pending-text-style-font-monospaced-digits', 'Digits of equal width, so a changing number does not shift its neighbours.', ['text-style'], [textOf({ font: { digits: 'monospaced' } })]);
accept('pending-text-style-font-scaled-numeral', 'A large thin numeral: 76 points at the default size, scaling like a large title and never more than 96.', ['text-style'],
  [textOf({ style: 'large-title', font: { weight: 'thin', digits: 'monospaced', scale: { points: 76, relativeTo: 'large-title', maxPoints: 96 } }, lines: 1 })]);
accept('pending-text-style-font-scale-without-cap', 'The cap is optional: a scaled size with no maximum follows Dynamic Type without a limit.', ['text-style'], [textOf({ font: { scale: { points: 64, relativeTo: 'large-title' } } })]);
accept('pending-text-style-font-empty', 'An empty font changes nothing and is allowed.', ['text-style'], [textOf({ font: {} })]);
accept('pending-text-style-ink-rgba', 'Words in white at 85%.', ['text-style'], [textOf({ ink: rgba(255, 255, 255, 0.85) })]);
accept('pending-text-style-ink-solid-rgb', 'Words in an opaque exact colour: a solid-rgb is an ink too.', ['text-style'], [textOf({ ink: solid(255, 209, 77) })]);
accept('pending-text-style-ink-alpha-zero', 'Alpha 0 is clear and allowed.', ['text-style'], [textOf({ ink: rgba(0, 0, 0, 0) })]);
accept('pending-text-style-ink-alpha-one', 'Alpha 1 is opaque and allowed.', ['text-style'], [textOf({ ink: rgba(10, 20, 30, 1) })]);
accept('pending-text-style-ink-pair-of-rgba', 'A pair whose sides are both rgba: it declares the pair id too.', ['text-style', 'solid-appearance'], [textOf({ ink: pair(rgba(0, 0, 0, 0.6), rgba(255, 255, 255, 0.85)) })]);
accept('pending-text-style-ink-pair-mixed', 'One side opaque, the other with an opacity.', ['text-style', 'solid-appearance'], [textOf({ ink: pair(solid(60, 60, 67), rgba(255, 255, 255, 0.6)) })]);
accept('pending-text-style-lines-one-truncate', 'One line, cut with an ellipsis when it does not fit.', ['text-style'], [textOf({ lines: 1, overflow: 'truncate' })]);
accept('pending-text-style-lines-unlimited', 'Lines 0 is as many as the text needs.', ['text-style'], [textOf({ lines: 0, overflow: 'wrap' })]);
accept('pending-text-style-lines-three', 'At most three lines.', ['text-style'], [textOf({ lines: 3 })]);
accept('pending-text-style-align-center', 'Centered words.', ['text-style'], [textOf({ align: 'center' })]);
accept('pending-text-style-align-end', 'Words at the trailing edge, which mirrors in a right-to-left language.', ['text-style'], [textOf({ align: 'end' })]);
accept('pending-text-style-overflow-ticker', 'A line that slides when it does not fit: one line only.', ['text-style'], [textOf({ lines: 1, overflow: 'ticker' })]);
accept('pending-text-style-on-an-entity-value', 'The look applies to a value read from an entity: the demo weather temperature as a numeral.', ['text-style'],
  [textOf({ value: { type: 'read', from: { type: 'source', sourceId: 'weather', path: ['attributes', 'temperature'] }, as: 'string', missing: 'unavailable' }, style: 'title1', font: { weight: 'bold' }, ink: rgba(255, 255, 255, 0.85) })]);
const badInk = (name: string, note: string, ink: J, expect: WgStyleCase['expect'], needs = ['text-style']) =>
  reject(name, note, needs, [textOf({ ink })], expect);
const inkAt = (rest: string) => at(0, `/props/ink${rest}`);
badInk('rgba-alpha-over-one', 'Alpha is 0 to 1: 1.5 is refused.', rgba(1, 2, 3, 1.5), { code: 'limit_exceeded', pointer: inkAt('/alpha') });
badInk('rgba-alpha-percent', 'Alpha is a fraction, never a percentage: 50 is refused.', rgba(1, 2, 3, 50), { code: 'limit_exceeded', pointer: inkAt('/alpha') });
badInk('rgba-alpha-negative', 'Alpha is not negative.', rgba(1, 2, 3, -0.1), { code: 'limit_exceeded', pointer: inkAt('/alpha') });
badInk('rgba-alpha-missing', 'An rgba has its alpha: opaque colours are the solid-rgb.', { type: 'rgba', red: 1, green: 2, blue: 3 }, { code: 'missing_required', pointer: inkAt('/alpha') });
badInk('rgba-alpha-text', 'Alpha is a number, never text.', { ...rgba(1, 2, 3, 0), alpha: '0.5' }, { code: 'invalid_value', pointer: inkAt('/alpha') });
badInk('rgba-channel-over-255', 'A channel is 0 to 255.', rgba(1, 256, 3, 0.5), { code: 'limit_exceeded', pointer: inkAt('/green') });
badInk('rgba-channel-fraction', 'A channel is a whole number.', rgba(1.5, 2, 3, 0.5), { code: 'invalid_value', pointer: inkAt('/red') });
badInk('rgba-missing-blue', 'An rgba has red, green, blue and alpha.', { type: 'rgba', red: 1, green: 2, alpha: 0.5 }, { code: 'missing_required', pointer: inkAt('/blue') });
badInk('rgba-extra-field', 'An rgba has only the four numbers: a name is refused.', { ...rgba(1, 2, 3, 0.5), family: 'white' }, { code: 'unknown_field', pointer: inkAt('/family') });
badInk('rgba-as-hex-string', 'A colour is an object, never a string.', '#FFFFFF80', { code: 'invalid_value', pointer: inkAt('') });
badInk('rgba-nested-pair', 'A pair does not nest.', pair(pair(solid(1, 2, 3), solid(4, 5, 6)), solid(7, 8, 9)), { code: 'unknown_variant', pointer: inkAt('/light/type') }, ['text-style', 'solid-appearance']);
badInk('rgba-pair-standard-inside', 'A pair holds exact colours: the standard fill is not one of them.', pair({ type: 'standard' }, solid(1, 2, 3)), { code: 'unknown_variant', pointer: inkAt('/light/type') }, ['text-style', 'solid-appearance']);
badInk('rgba-pair-missing-dark', 'A pair has both colours.', { type: 'solid-appearance', light: rgba(1, 2, 3, 0.5) }, { code: 'missing_required', pointer: inkAt('/dark') }, ['text-style', 'solid-appearance']);
badInk('rgba-ink-bound-color', 'An ink is an exact colour or a pair: an entity\'s colour is not one.', { type: 'bound-color', value: read('weather', ['state']), fallback: solid(1, 2, 3) }, { code: 'unknown_variant', pointer: inkAt('/type') });
badInk('rgba-ink-conditional', 'An ink is not chosen by a rule.', { type: 'conditional', cases: [{ when: { type: 'compare', op: 'eq', left: lit(1), right: lit(1) }, then: solid(1, 2, 3) }], otherwise: solid(4, 5, 6) }, { code: 'unknown_variant', pointer: inkAt('/type') });
badInk('rgba-ink-standard', 'The text has no standard ink: leave the field out for the style\'s own.', { type: 'standard' }, { code: 'unknown_variant', pointer: inkAt('/type') });
reject('rgba-in-a-slot-that-has-no-opacity', 'Slots that existed before keep exact colours without opacity: a state tile\'s icon colour refuses an rgba.', ['tile-ink'],
  [node('tile', 'state-tile', { icon: symbolOf('fan'), binding: { entityId: 'lock.demo_door', builtIn: 'lock' }, props: {}, glyphTint: rgba(1, 2, 3, 0.5) })], { code: 'unknown_variant', pointer: at(0, '/glyphTint/type') });
reject('rgba-in-an-old-pair', 'The pair of a slot that existed before takes solid-rgb only: an rgba side is refused.', ['solid-appearance'],
  [node('tile', 'state-tile', { icon: symbolOf('fan'), binding: { entityId: 'lock.demo_door', builtIn: 'lock' }, props: {}, glyphTint: pair(rgba(1, 2, 3, 0.5), solid(4, 5, 6)) })], { code: 'unknown_field', pointer: at(0, '/glyphTint/light/alpha') });
reject('text-style-style-unknown', 'The styles are the eleven names: a point size is not one.', ['text-style'], [textOf({ style: 'large' })], { code: 'unknown_variant', pointer: at(0, '/props/style') });
reject('text-style-style-camel-case', 'Styles are spelled with a hyphen where they have two words: largeTitle is refused.', ['text-style'], [textOf({ style: 'largeTitle' })], { code: 'unknown_variant', pointer: at(0, '/props/style') });
reject('text-style-font-weight-unknown', 'The weights are a closed list.', ['text-style'], [textOf({ font: { weight: 'extra-bold' } })], { code: 'unknown_variant', pointer: at(0, '/props/font/weight') });
reject('text-style-font-digits-unknown', 'Digits are proportional or monospaced.', ['text-style'], [textOf({ font: { digits: 'tabular' } })], { code: 'unknown_variant', pointer: at(0, '/props/font/digits') });
reject('text-style-font-scale-below-eight', 'A scaled size is at least 8 points.', ['text-style'], [textOf({ font: { scale: { points: 4, relativeTo: 'body' } } })], { code: 'limit_exceeded', pointer: at(0, '/props/font/scale/points') });
reject('text-style-font-scale-relative-to-unknown', 'A scaled size follows one of the eleven styles.', ['text-style'], [textOf({ font: { scale: { points: 20, relativeTo: 'huge' } } })], { code: 'unknown_variant', pointer: at(0, '/props/font/scale/relativeTo') });
reject('text-style-font-scale-cap-below-size', 'The cap cannot be smaller than the size.', ['text-style'], [textOf({ font: { scale: { points: 76, relativeTo: 'large-title', maxPoints: 60 } } })], { code: 'invalid_value', pointer: at(0, '/props/font/scale/maxPoints') });
reject('text-style-font-scale-missing-relative-to', 'A scaled size says which style it follows.', ['text-style'], [textOf({ font: { scale: { points: 20 } } })], { code: 'missing_required', pointer: at(0, '/props/font/scale/relativeTo') });
reject('text-style-font-extra-field', 'The font has weight, digits and scale only.', ['text-style'], [textOf({ font: { italic: true } })], { code: 'unknown_field', pointer: at(0, '/props/font/italic') });
reject('text-style-lines-negative', 'Lines is 0 or more.', ['text-style'], [textOf({ lines: -1 })], { code: 'limit_exceeded', pointer: at(0, '/props/lines') });
reject('text-style-lines-fraction', 'Lines is a whole number.', ['text-style'], [textOf({ lines: 1.5 })], { code: 'invalid_value', pointer: at(0, '/props/lines') });
reject('text-style-lines-over-twelve', 'At most twelve lines: use 0 for as many as it needs.', ['text-style'], [textOf({ lines: 13 })], { code: 'limit_exceeded', pointer: at(0, '/props/lines') });
reject('text-style-align-unknown', 'Align is start, center or end: left is refused, since the edge follows the language.', ['text-style'], [textOf({ align: 'left' })], { code: 'unknown_variant', pointer: at(0, '/props/align') });
reject('text-style-overflow-unknown', 'Overflow is wrap, truncate or ticker.', ['text-style'], [textOf({ overflow: 'clip' })], { code: 'unknown_variant', pointer: at(0, '/props/overflow') });
reject('text-style-ticker-with-two-lines', 'A ticker slides one line: two lines is refused.', ['text-style'], [textOf({ lines: 2, overflow: 'ticker' })], { code: 'invalid_combination', pointer: at(0, '/props/overflow') });
reject('text-style-ticker-without-lines', 'A ticker says it is one line: without lines it is refused.', ['text-style'], [textOf({ overflow: 'ticker' })], { code: 'invalid_combination', pointer: at(0, '/props/overflow') });
reject('text-style-ticker-with-unlimited-lines', 'Lines 0 is unlimited, which a ticker is not.', ['text-style'], [textOf({ lines: 0, overflow: 'ticker' })], { code: 'invalid_combination', pointer: at(0, '/props/overflow') });

// MARK: Stack and shape (`sh.stack@1`)
const label = (text: string, id: string, props: J = {}): J => textOf({ value: lit(text), ...props }, id);
accept('pending-stack-row', 'Two texts side by side with the medium space between them.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a'), label('B', 'b')])]);
accept('pending-stack-column', 'Two texts one above the other.', ['stack', 'text-style'], [stackOf({ axis: 'vertical', spacing: token('xs') }, [label('A', 'a'), label('B', 'b')])]);
accept('pending-stack-spacing-points', 'The space may be written in points.', ['stack', 'text-style'], [stackOf({ spacing: points(6) }, [label('A', 'a')])]);
accept('pending-stack-padding', 'Space inside the stack, a different amount on each side.', ['stack', 'text-style'],
  [stackOf({ padding: { top: token('s'), leading: token('l'), bottom: token('s'), trailing: token('l') } }, [label('A', 'a')])]);
accept('pending-stack-align-center', 'Children centered across the axis.', ['stack', 'text-style'], [stackOf({ align: 'center' }, [label('A', 'a')])]);
accept('pending-stack-distribution-spread', 'First child at one end, last at the other.', ['stack', 'text-style'], [stackOf({ distribution: 'spread' }, [label('A', 'a'), label('B', 'b')])]);
accept('pending-stack-empty', 'A stack with no children is allowed: it draws nothing but its surface.', ['stack', 'text-style'], [stackOf({ surface: { type: 'module', density: 'thin' } }, [])]);
accept('pending-stack-groups', 'Children partitioned into groups: the first three stacked, the last on its own, the first group taking the room.', ['stack', 'text-style'],
  [stackOf({ groups: [{ children: ['a', 'b'], spacing: token('xs'), grow: true }, { children: ['c'] }] }, [label('A', 'a'), label('B', 'b'), label('C', 'c')])]);
accept('pending-stack-groups-any-order', 'A group may list children in another order than the stack does.', ['stack', 'text-style'],
  [stackOf({ groups: [{ children: ['c', 'a'] }, { children: ['b'] }] }, [label('A', 'a'), label('B', 'b'), label('C', 'c')])]);
accept('pending-stack-collapse-accessibility-size', 'A row that becomes a column at an accessibility text size.', ['stack', 'text-style'],
  [stackOf({ collapse: { to: 'vertical', when: ['accessibility-size'] } }, [label('A', 'a'), label('B', 'b')])]);
accept('pending-stack-collapse-overflow', 'A row that becomes a column when the child named in fits is wider than the room beside the others.', ['stack', 'text-style'],
  [stackOf({ collapse: { to: 'vertical', when: ['overflow'], fits: ['b'] } }, [label('A', 'a'), label('B', 'b', { lines: 1, overflow: 'truncate' })])]);
accept('pending-stack-collapse-both-with-regrouping', 'The hand-laid header: a condition glyph, a condition ticker and a range on the left and a numeral on the right; it stacks with the glyph beside the numeral.', ['stack', 'text-style'],
  [stackOf({
    spacing: token('m'), align: 'center',
    groups: [{ children: ['glyph', 'condition', 'range'], spacing: token('xs'), grow: true }, { children: ['numeral'] }],
    collapse: { to: 'vertical', when: ['accessibility-size', 'overflow'], fits: ['range'], spacing: token('s'),
      groups: [{ children: ['glyph', 'numeral'], distribution: 'spread', align: 'center' }, { children: ['condition'] }, { children: ['range'] }] },
  }, [
    symbolPartOf({}, {}, 'glyph'), label('Rainy', 'condition', { style: 'headline', lines: 1, overflow: 'ticker' }),
    label('H:72° L:55°', 'range', { lines: 1 }), label('72°', 'numeral', { style: 'large-title', font: { weight: 'thin', digits: 'monospaced', scale: { points: 64, relativeTo: 'large-title', maxPoints: 96 } } }),
  ])]);
accept('pending-stack-collapse-spacing-only', 'A collapse that changes only the space and keeps the groups.', ['stack', 'text-style'],
  [stackOf({ groups: [{ children: ['a'] }, { children: ['b'] }], collapse: { to: 'vertical', when: ['accessibility-size'], spacing: token('s') } }, [label('A', 'a'), label('B', 'b')])]);
accept('pending-stack-dividers', 'A hairline between neighbours, in white at 14%.', ['stack', 'text-style'],
  [stackOf({ axis: 'vertical', dividers: { ink: rgba(255, 255, 255, 0.14), width: 1 } }, [label('A', 'a'), label('B', 'b')])]);
accept('pending-stack-dividers-pair', 'A divider that is one colour in Light Mode and another in Dark Mode.', ['stack', 'text-style', 'solid-appearance'],
  [stackOf({ axis: 'vertical', dividers: { ink: pair(rgba(60, 60, 67, 0.29), rgba(255, 255, 255, 0.14)), width: 1 } }, [label('A', 'a'), label('B', 'b')])]);
accept('pending-stack-surface-module', 'The module surface the app draws under a card.', ['stack', 'text-style'], [stackOf({ surface: { type: 'module', density: 'thin' } }, [label('A', 'a')])]);
accept('pending-stack-surface-fill', 'Its own fill with a hairline border and the tile radius.', ['stack', 'text-style'],
  [stackOf({ surface: { type: 'fill', fill: rgba(0, 0, 0, 0.28), border: { ink: rgba(255, 255, 255, 0.14), width: 1 }, radius: token('tile') } }, [label('A', 'a')])]);
accept('pending-stack-surface-fill-points-radius', 'The radius may be points; the border is optional.', ['stack', 'text-style'],
  [stackOf({ surface: { type: 'fill', fill: solid(20, 20, 20), radius: points(12) } }, [label('A', 'a')])]);
accept('pending-stack-action-opens-a-sheet', 'A stack that is one button opening a sheet: one accessibility element with a label.', ['stack', 'text-style'],
  [stackOf({}, [label('Rainy', 'a'), label('72°', 'b')], { action: open, a11y: { element: 'group', role: 'button', label: lit('Open forecast'), hint: 'Shows the seven-day forecast.' } })],
  );
accept('pending-stack-a11y-group-with-value', 'One element with a label and a value read from an entity.', ['stack', 'text-style'],
  [stackOf({}, [label('A', 'a')], { a11y: { element: 'group', label: lit('Temperature'), value: { type: 'read', from: { type: 'source', sourceId: 'weather', path: ['attributes', 'temperature'] }, as: 'string', missing: 'unavailable' } } })]);
accept('pending-stack-a11y-header-role', 'A group that VoiceOver treats as a heading.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { a11y: { element: 'group', role: 'header', label: lit('Today') } })]);
accept('pending-stack-a11y-hidden', 'A stack removed from assistive technologies with its children.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { a11y: { element: 'hidden' } })]);
accept('pending-stack-a11y-children', 'Leaving the children as they are is written as children.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { a11y: { element: 'children' } })]);
accept('pending-stack-nested', 'A stack in a stack.', ['stack', 'text-style'], [stackOf({ axis: 'vertical' }, [stackOf({}, [label('A', 'a')], {}, 'inner'), label('B', 'b')])]);
accept('pending-stack-skeleton-cell', 'Placeholder shapes: a capsule, a circle and a capsule, as a loading cell.', ['stack', 'text-style'],
  [stackOf({ axis: 'vertical', align: 'center', spacing: token('xs') }, [shapeOf({ width: 28, height: 8 }, 'bar'), shapeOf({ form: 'circle', width: 22, height: 22 }, 'dot'), shapeOf({ width: 24, height: 8 }, 'bar2')])]);
accept('pending-stack-child-hidden-by-rule', 'A child may have a visibleWhen: the group keeps its place in the list and the child simply does not draw.', ['stack', 'text-style', 'visible-when'],
  [stackOf({ groups: [{ children: ['a', 'b'] }] }, [label('A', 'a'), textOf({ value: lit('B') }, 'b', { visibleWhen: { type: 'state', sourceId: 'sun', path: ['state'], in: ['above_horizon'] } })])]);
accept('pending-stack-in-a-grid-span', 'A stack is a node like any other: it may span two columns of a grid.', ['stack', 'text-style', 'grid'],
  [node('grid', 'tile-grid', { props: { minimum: 'tile@1', maxColumns: 2, spacing: token('m'), equalRowHeights: true, shortRow: 'share', fold: 'page' }, children: [stackOf({}, [label('A', 'a')], { layout: { span: 2 } })] })]);
accept('pending-shape-capsule', 'A capsule of one colour.', ['stack', 'text-style'], [shapeOf({ form: 'capsule' })]);
accept('pending-shape-rect', 'A rectangle.', ['stack', 'text-style'], [shapeOf({ form: 'rect', width: 120, height: 2, fill: solid(255, 255, 255) })]);
accept('pending-shape-circle-pair', 'A circle whose colour differs by appearance.', ['stack', 'text-style', 'solid-appearance'], [shapeOf({ form: 'circle', width: 10, height: 10, fill: pair(rgba(0, 0, 0, 0.5), rgba(255, 255, 255, 0.5)) })]);
const stackProp = (name: string, note: string, props: J, expect: WgStyleCase['expect'], children: J[] = [label('A', 'a'), label('B', 'b')], needs = ['stack', 'text-style']) =>
  reject(name, note, needs, [stackOf(props, children)], expect);
const sp = (rest: string) => at(0, `/props${rest}`);
stackProp('stack-axis-unknown', 'The axis is horizontal or vertical.', { axis: 'diagonal' }, { code: 'unknown_variant', pointer: sp('/axis') });
reject('stack-spacing-missing', 'A stack says its spacing: there is no default.', ['stack', 'text-style'], [node('s', 'stack', { props: { axis: 'horizontal' }, children: [] })], { code: 'missing_required', pointer: sp('/spacing') });
stackProp('stack-spacing-negative', 'Space in points is 0 or more.', { spacing: points(-1) }, { code: 'limit_exceeded', pointer: sp('/spacing/value') });
stackProp('stack-spacing-token-unknown', 'The space tokens are a closed list.', { spacing: token('huge') }, { code: 'unknown_variant', pointer: sp('/spacing/name') });
stackProp('stack-padding-missing-a-side', 'Padding names all four sides.', { padding: { top: token('s'), leading: token('s'), bottom: token('s') } }, { code: 'missing_required', pointer: sp('/padding/trailing') });
stackProp('stack-align-unknown', 'Align is start, center or end.', { align: 'baseline' }, { code: 'unknown_variant', pointer: sp('/align') });
stackProp('stack-distribution-unknown', 'Distribution is natural or spread.', { distribution: 'equal' }, { code: 'unknown_variant', pointer: sp('/distribution') });
stackProp('stack-extra-prop', 'A stack has only its own settings: a wrap flag is refused.', { wrap: true }, { code: 'unknown_field', pointer: sp('/wrap') });
stackProp('stack-groups-unknown-child', 'A group names a child the stack does not have.', { groups: [{ children: ['a', 'zzz'] }, { children: ['b'] }] }, { code: 'invalid_reference', pointer: sp('/groups/0/children/1') });
stackProp('stack-groups-duplicate-child', 'A child is in one group only.', { groups: [{ children: ['a', 'b'] }, { children: ['b'] }] }, { code: 'duplicate_id', pointer: sp('/groups/1/children/0') });
stackProp('stack-groups-missing-child', 'Every child is in a group: b is left out.', { groups: [{ children: ['a'] }] }, { code: 'missing_required', pointer: sp('/groups') });
stackProp('stack-groups-empty-group', 'A group has at least one child.', { groups: [{ children: [] }, { children: ['a', 'b'] }] }, { code: 'limit_exceeded', pointer: sp('/groups/0/children') });
stackProp('stack-groups-extra-field', 'A group has its children and four settings: a wrap is refused.', { groups: [{ children: ['a', 'b'], wrap: true }] }, { code: 'unknown_field', pointer: sp('/groups/0/wrap') });
stackProp('stack-collapse-on-a-column', 'Only a row collapses: a column has nowhere to go.', { axis: 'vertical', collapse: { to: 'vertical', when: ['accessibility-size'] } }, { code: 'invalid_combination', pointer: sp('/collapse') });
stackProp('stack-collapse-to-horizontal', 'A row collapses to a column; there is no other direction.', { collapse: { to: 'horizontal', when: ['accessibility-size'] } }, { code: 'unknown_variant', pointer: sp('/collapse/to') });
stackProp('stack-collapse-when-empty', 'A collapse says when.', { collapse: { to: 'vertical', when: [] } }, { code: 'limit_exceeded', pointer: sp('/collapse/when') });
stackProp('stack-collapse-when-unknown', 'The triggers are accessibility-size and overflow.', { collapse: { to: 'vertical', when: ['narrow'] } }, { code: 'unknown_variant', pointer: sp('/collapse/when/0') });
stackProp('stack-collapse-when-twice', 'A trigger is named once.', { collapse: { to: 'vertical', when: ['overflow', 'overflow'] } }, { code: 'invalid_value', pointer: sp('/collapse/when') });
stackProp('stack-collapse-fits-unknown-child', 'The fits list names children the stack has.', { collapse: { to: 'vertical', when: ['overflow'], fits: ['zzz'] } }, { code: 'invalid_reference', pointer: sp('/collapse/fits/0') });
stackProp('stack-collapse-fits-without-overflow', 'Fits is measured only for the overflow trigger.', { collapse: { to: 'vertical', when: ['accessibility-size'], fits: ['a'] } }, { code: 'invalid_combination', pointer: sp('/collapse/fits') });
stackProp('stack-collapse-groups-missing-child', 'The collapsed groups hold every child too.', { collapse: { to: 'vertical', when: ['overflow'], groups: [{ children: ['a'] }] } }, { code: 'missing_required', pointer: sp('/collapse/groups') });
stackProp('stack-collapse-extra-field', 'A collapse has its own fields only.', { collapse: { to: 'vertical', when: ['overflow'], breakpoint: 320 } }, { code: 'unknown_field', pointer: sp('/collapse/breakpoint') });
stackProp('stack-dividers-width-zero', 'A line is at least half a point.', { dividers: { ink: rgba(1, 2, 3, 0.5), width: 0 } }, { code: 'limit_exceeded', pointer: sp('/dividers/width') });
stackProp('stack-dividers-ink-missing', 'A divider has its ink.', { dividers: { width: 1 } }, { code: 'missing_required', pointer: sp('/dividers/ink') });
stackProp('stack-dividers-ink-bound-color', 'A divider is an exact colour, not an entity\'s.', { dividers: { width: 1, ink: { type: 'bound-color', value: lit('red'), fallback: solid(1, 2, 3) } } }, { code: 'unknown_variant', pointer: sp('/dividers/ink/type') });
stackProp('stack-surface-style-unknown', 'The surfaces are module and fill.', { surface: { type: 'glass' } }, { code: 'unknown_variant', pointer: sp('/surface/type') });
stackProp('stack-surface-density-unknown', 'The module surface is thin or dense.', { surface: { type: 'module', density: 'heavy' } }, { code: 'unknown_variant', pointer: sp('/surface/density') });
stackProp('stack-surface-fill-missing', 'A fill surface has its fill.', { surface: { type: 'fill' } }, { code: 'missing_required', pointer: sp('/surface/fill') });
stackProp('stack-surface-radius-unknown-token', 'The radius token is tile.', { surface: { type: 'fill', fill: solid(1, 2, 3), radius: token('card') } }, { code: 'unknown_variant', pointer: sp('/surface/radius/name') });
stackProp('stack-surface-border-width-zero', 'A border is at least half a point.', { surface: { type: 'fill', fill: solid(1, 2, 3), border: { ink: solid(4, 5, 6), width: 0 } } }, { code: 'limit_exceeded', pointer: sp('/surface/border/width') });
stackProp('stack-surface-module-with-fill', 'The module surface has no fill of its own.', { surface: { type: 'module', density: 'thin', fill: solid(1, 2, 3) } }, { code: 'unknown_field', pointer: sp('/surface/fill') });
reject('stack-action-without-a11y', 'A tappable stack is one button and names itself: without a11y it is refused.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { action: call })], { code: 'missing_required', pointer: at(0, '/a11y') });
reject('stack-action-with-children-a11y', 'A tappable stack is one element: children is refused.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { action: call, a11y: { element: 'children' } })], { code: 'invalid_combination', pointer: at(0, '/a11y/element') });
reject('stack-action-with-hidden-a11y', 'A tappable stack cannot be hidden from assistive technologies.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { action: call, a11y: { element: 'hidden' } })], { code: 'invalid_combination', pointer: at(0, '/a11y/element') });
reject('stack-action-with-header-role', 'A tappable stack is a button: a header role is refused.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { action: call, a11y: { element: 'group', role: 'header' } })], { code: 'invalid_combination', pointer: at(0, '/a11y/role') });
reject('stack-button-role-without-action', 'A button role needs an action.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { a11y: { element: 'group', role: 'button', label: lit('Go') } })], { code: 'invalid_combination', pointer: at(0, '/a11y/role') });
reject('stack-action-over-a-button', 'A tappable stack holds nothing that takes a tap of its own.', ['stack', 'text-style'],
  [stackOf({}, [node('b', 'primary-button', { props: {}, icon: symbolOf('plus'), action: { type: 'back' } })], { action: call, a11y: { element: 'group', label: lit('Go') } })], { code: 'invalid_combination', pointer: at(0, '/children/0/type') });
reject('stack-action-over-an-action-stack', 'Tappable stacks do not nest.', ['stack', 'text-style'],
  [stackOf({}, [stackOf({}, [label('A', 'a')], { action: call, a11y: { element: 'group', label: lit('Inner') } }, 'inner')], { action: call, a11y: { element: 'group', label: lit('Outer') } })], { code: 'invalid_combination', pointer: at(0, '/children/0/type') });
reject('stack-a11y-label-on-children', 'A label belongs to a group: with children it is refused.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { a11y: { element: 'children', label: lit('x') } })], { code: 'invalid_combination', pointer: at(0, '/a11y/label') });
reject('stack-a11y-hint-on-hidden', 'A hidden stack has nothing to hint.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { a11y: { element: 'hidden', hint: 'x' } })], { code: 'invalid_combination', pointer: at(0, '/a11y/hint') });
reject('stack-a11y-element-unknown', 'The elements are group, children and hidden.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { a11y: { element: 'image' } })], { code: 'unknown_variant', pointer: at(0, '/a11y/element') });
reject('stack-a11y-label-is-a-structure', 'A label gives text: a list is not text.', ['stack', 'text-style'],
  [stackOf({}, [label('A', 'a')], { a11y: { element: 'group', label: { type: 'expr', value: { type: 'list', items: [lit('x')] } } } })], { code: 'binding_type', pointer: at(0, '/a11y/label/value') });
reject('stack-a11y-role-unknown', 'The roles are button, header and text.', ['stack', 'text-style'], [stackOf({}, [label('A', 'a')], { a11y: { element: 'group', role: 'link' } })], { code: 'unknown_variant', pointer: at(0, '/a11y/role') });
reject('stack-child-id-repeats-a-sibling', 'Ids are unique across the document, children included.', ['stack', 'text-style'], [stackOf({}, [label('A', 'dup'), label('B', 'dup')])], { code: 'duplicate_id', pointer: at(0, '/children/0/id') });
reject('stack-children-not-a-list', 'The children are a list of nodes.', ['stack', 'text-style'], [node('s', 'stack', { props: { axis: 'horizontal', spacing: token('m') }, children: 'a' })], { code: 'invalid_value', pointer: at(0, '/children') });
reject('stack-has-no-title-text', 'A stack has no value of its own: text belongs in a child.', ['stack', 'text-style'], [stackOf({ value: lit('x') }, [])], { code: 'unknown_field', pointer: sp('/value') });
reject('shape-form-unknown', 'The forms are capsule, rect and circle.', ['stack', 'text-style'], [shapeOf({ form: 'star' })], { code: 'unknown_variant', pointer: at(0, '/props/form') });
reject('shape-width-zero', 'A shape is at least one point wide.', ['stack', 'text-style'], [shapeOf({ width: 0 })], { code: 'limit_exceeded', pointer: at(0, '/props/width') });
reject('shape-height-over-1024', 'A shape is at most 1024 points.', ['stack', 'text-style'], [shapeOf({ height: 2000 })], { code: 'limit_exceeded', pointer: at(0, '/props/height') });
reject('shape-fill-missing', 'A shape has its fill.', ['stack', 'text-style'], [node('sh', 'shape', { props: { form: 'capsule', width: 10, height: 10 } })], { code: 'missing_required', pointer: at(0, '/props/fill') });
reject('shape-fill-bound-color', 'A shape is an exact colour: an entity\'s colour is not one.', ['stack', 'text-style'], [shapeOf({ fill: { type: 'bound-color', value: lit('red'), fallback: solid(1, 2, 3) } })], { code: 'unknown_variant', pointer: at(0, '/props/fill/type') });
reject('shape-has-no-children', 'A shape holds nothing.', ['stack', 'text-style'], [{ ...shapeOf(), children: [] }], { code: 'unknown_field', pointer: at(0, '/children') });
reject('shape-has-no-a11y', 'A shape is decoration and has no accessibility settings.', ['stack', 'text-style'], [{ ...shapeOf(), a11y: { element: 'hidden' } }], { code: 'unknown_field', pointer: at(0, '/a11y') });

// MARK: Symbol part (`sh.symbol-part@1`)
accept('pending-symbol-part-plain', 'A multicolor symbol at a fixed size, hidden from assistive technologies.', ['symbol-part', 'text-style'], [symbolPartOf()]);
accept('pending-symbol-part-by-state', 'A symbol chosen by the weather entity\'s state: rainy and sunny have their own, any other state draws the cloud.', ['symbol-part', 'text-style', 'rules'], [symbolPartOf({ name: bySymbol })]);
accept('pending-symbol-part-by-rule', 'A symbol chosen by a condition: the sun above the horizon draws the sun, otherwise the moon.', ['symbol-part', 'text-style', 'rules', 'conditions'],
  [symbolPartOf({ name: { type: 'conditional', cases: [{ when: { type: 'state', sourceId: 'sun', path: ['state'], in: ['above_horizon'] }, then: symbolOf('sun.max.fill') }], otherwise: symbolOf('moon.stars.fill') } })]);
accept('pending-symbol-part-scaled', 'A symbol whose size grows with Dynamic Type like a title, up to twice its size.', ['symbol-part', 'text-style'], [symbolPartOf({ size: { points: 40, relativeTo: 'title1', maxScale: 2 } })]);
accept('pending-symbol-part-monochrome-tint', 'A monochrome symbol in white at 85%.', ['symbol-part', 'text-style'], [symbolPartOf({ rendering: 'monochrome', tint: rgba(255, 255, 255, 0.85) })]);
accept('pending-symbol-part-tint-pair', 'A tint that differs by appearance.', ['symbol-part', 'text-style', 'solid-appearance'], [symbolPartOf({ rendering: 'monochrome', tint: pair(solid(60, 60, 67), solid(235, 235, 245)) })]);
accept('pending-symbol-part-trim-leading', 'The ink the glyph does not fill at its leading edge is trimmed, so the glyph lines up with the text under it.', ['symbol-part', 'text-style'], [symbolPartOf({ trim: 'leading' })]);
accept('pending-symbol-part-trim-none', 'None is the default and may be written.', ['symbol-part', 'text-style'], [symbolPartOf({ trim: 'none' })]);
accept('pending-symbol-part-rotate-by-value', 'An arrow turned by the wind bearing: a number of degrees read from an entity.', ['symbol-part', 'text-style'],
  [symbolPartOf({ name: symbolOf('location.north.fill'), rendering: 'monochrome', rotate: read('weather', ['attributes', 'wind_bearing'], 'number') })]);
accept('pending-symbol-part-rotate-fixed', 'A fixed turn.', ['symbol-part', 'text-style'], [symbolPartOf({ rotate: lit(90) })]);
accept('pending-symbol-part-image-label', 'A symbol that carries meaning is an image with a label.', ['symbol-part', 'text-style'], [symbolPartOf({}, { a11y: { element: 'image', label: lit('Rain') } })]);
const symbolProp = (name: string, note: string, props: J, expect: WgStyleCase['expect'], rest: J = {}) => reject(name, note, ['symbol-part', 'text-style'], [symbolPartOf(props, rest)], expect);
const yp = (rest: string) => at(0, `/props${rest}`);
symbolProp('symbol-part-bound-symbol-without-fallback', 'A symbol chosen by state names the symbol that draws for any other state.', { name: { type: 'bound-symbol', value: lit('cloud') } }, { code: 'missing_required', pointer: yp('/name/fallback') });
symbolProp('symbol-part-bound-symbol-over-a-number', 'A symbol name is text: a number read is refused.', { name: { type: 'bound-symbol', value: read('weather', ['attributes', 'temperature'], 'number'), fallback: symbolOf('cloud.fill') } }, { code: 'binding_type', pointer: yp('/name/value') });
symbolProp('symbol-part-name-missing', 'A symbol has its name.', { name: undefined }, { code: 'missing_required', pointer: yp('/name') });
symbolProp('symbol-part-name-is-text', 'The name is a symbol reference, never a bare string.', { name: 'cloud.fill' }, { code: 'invalid_value', pointer: yp('/name') });
symbolProp('symbol-part-rendering-unknown', 'The renderings are multicolor and monochrome.', { rendering: 'hierarchical' }, { code: 'unknown_variant', pointer: yp('/rendering') });
symbolProp('symbol-part-rendering-missing', 'A symbol says how it renders.', { rendering: undefined }, { code: 'missing_required', pointer: yp('/rendering') });
symbolProp('symbol-part-tint-on-multicolor', 'A multicolor symbol draws its own colors: a tint is for a monochrome one.', { tint: rgba(1, 2, 3, 0.5) }, { code: 'invalid_combination', pointer: yp('/tint') });
symbolProp('symbol-part-size-below-eight', 'A symbol is at least 8 points.', { size: { points: 4 } }, { code: 'limit_exceeded', pointer: yp('/size/points') });
symbolProp('symbol-part-size-missing', 'A symbol has its size.', { size: undefined }, { code: 'missing_required', pointer: yp('/size') });
symbolProp('symbol-part-max-scale-without-relative-to', 'A maximum scale needs the style the size follows.', { size: { points: 40, maxScale: 2 } }, { code: 'invalid_combination', pointer: yp('/size/maxScale') });
symbolProp('symbol-part-max-scale-below-one', 'A scale cap is at least 1.', { size: { points: 40, relativeTo: 'title1', maxScale: 0.5 } }, { code: 'limit_exceeded', pointer: yp('/size/maxScale') });
symbolProp('symbol-part-trim-unknown', 'The trims are none and leading.', { trim: 'trailing' }, { code: 'unknown_variant', pointer: yp('/trim') });
symbolProp('symbol-part-rotate-is-text', 'A turn is a number of degrees: text is refused.', { rotate: read('weather', ['state']) }, { code: 'binding_type', pointer: yp('/rotate') });
symbolProp('symbol-part-rotate-is-a-structure', 'A turn is a number: a list is not one.', { rotate: { type: 'list', items: [lit(1)] } }, { code: 'binding_type', pointer: yp('/rotate') });
symbolProp('symbol-part-extra-prop', 'A symbol has only its own settings.', { weight: 'bold' }, { code: 'unknown_field', pointer: yp('/weight') });
symbolProp('symbol-part-a11y-missing', 'A symbol says whether assistive technologies skip it.', {}, { code: 'missing_required', pointer: at(0, '/a11y') }, { a11y: undefined });
symbolProp('symbol-part-a11y-image-without-label', 'An image has its label.', {}, { code: 'missing_required', pointer: at(0, '/a11y/label') }, { a11y: { element: 'image' } });
symbolProp('symbol-part-a11y-hidden-with-label', 'A hidden symbol has no label.', {}, { code: 'unknown_field', pointer: at(0, '/a11y/label') }, { a11y: { element: 'hidden', label: lit('x') } });
symbolProp('symbol-part-a11y-element-unknown', 'The elements are hidden and image.', {}, { code: 'unknown_variant', pointer: at(0, '/a11y/element') }, { a11y: { element: 'group' } });
symbolProp('symbol-part-has-no-action', 'A symbol is not tappable: put it in a stack that is.', {}, { code: 'unknown_field', pointer: at(0, '/action') }, { action: call });

// MARK: Choice icons (`sh.choice-icons@1`)
const iconOptions = (extra: J = {}): J[] => [
  optionOf('condition', { symbol: symbolOf('cloud.sun.fill'), hint: 'Shows the temperature by hour.', ...extra }),
  optionOf('precipitation', { symbol: symbolOf('drop.fill'), hint: 'Shows the chance of rain.' }),
  optionOf('wind', { symbol: symbolOf('wind'), hint: 'Shows the wind speed and gusts.' }),
];
accept('pending-choice-icons-symbols-and-hints', 'A segmented choice of three symbols; each has the label VoiceOver says and a hint it says after.', ['choice-icons', 'local-controls', 'local-state'], segmented(), modeState(iconOptions()));
accept('pending-choice-icons-symbols-only', 'Symbols without hints.', ['choice-icons', 'local-controls', 'local-state'], segmented(),
  modeState(iconOptions().map(({ hint, ...rest }) => (void hint, rest))));
accept('pending-choice-icons-hints-only', 'Hints on a choice that draws words.', ['choice-icons', 'local-controls', 'local-state'], segmented(),
  modeState([optionOf('condition', { hint: 'Shows the temperature.' }), optionOf('wind', { hint: 'Shows the wind.' })]));
accept('pending-choice-icons-four-symbols', 'Four is the most a segmented choice holds.', ['choice-icons', 'local-controls', 'local-state'], segmented(),
  modeState([...iconOptions(), optionOf('uv', { symbol: symbolOf('sun.max.fill') })]));
accept('pending-choice-icons-on-a-field-no-control-reads', 'A field with symbols that no control reads yet is allowed: tabs and rules may use its options.', ['choice-icons', 'local-state'], [], modeState(iconOptions()));
reject('choice-icons-symbol-on-some-options', 'A segment is all symbols or all words: the option without a symbol is refused.', ['choice-icons', 'local-state'], [],
  { code: 'invalid_combination', pointer: '/document/localState/0/options/1' }, modeState([optionOf('condition', { symbol: symbolOf('cloud.fill') }), optionOf('wind')]));
reject('choice-icons-on-a-picker', 'Symbols and hints are for a segmented choice: a picker refuses a field that has them.', ['choice-icons', 'local-controls', 'local-state'], segmented('choice'),
  { code: 'invalid_combination', pointer: at(0, '/props/stateId') }, modeState(iconOptions()));
reject('choice-icons-hint-on-a-picker', 'The same holds for a hint alone.', ['choice-icons', 'local-controls', 'local-state'], segmented('choice'),
  { code: 'invalid_combination', pointer: at(0, '/props/stateId') }, modeState([optionOf('condition', { hint: 'x' }), optionOf('wind')]));
reject('choice-icons-symbol-missing-name', 'An option\'s symbol has its name.', ['choice-icons', 'local-state'], [],
  { code: 'missing_required', pointer: '/document/localState/0/options/0/symbol/name' }, modeState([optionOf('condition', { symbol: { type: 'sf-symbol', rendering: 'canonical', unavailable: 'fallback' } }), optionOf('wind')]));
reject('choice-icons-symbol-not-a-symbol', 'An option\'s symbol is a symbol reference, never a bare name.', ['choice-icons', 'local-state'], [],
  { code: 'invalid_value', pointer: '/document/localState/0/options/0/symbol' }, modeState([optionOf('condition', { symbol: 'cloud.fill' }), optionOf('wind')]));
reject('choice-icons-hint-too-long', 'A hint is at most 240 characters.', ['choice-icons', 'local-state'], [],
  { code: 'limit_exceeded', pointer: '/document/localState/0/options/0/hint' }, modeState([optionOf('condition', { hint: 'x'.repeat(241) }), optionOf('wind')]));
reject('choice-icons-hint-is-a-number', 'A hint is text.', ['choice-icons', 'local-state'], [],
  { code: 'invalid_value', pointer: '/document/localState/0/options/0/hint' }, modeState([optionOf('condition', { hint: 7 }), optionOf('wind')]));
reject('choice-icons-option-extra-field', 'An option has an id, a label, a symbol and a hint: a tint is refused.', ['choice-icons', 'local-state'], [],
  { code: 'unknown_field', pointer: '/document/localState/0/options/0/tint' }, modeState([optionOf('condition', { symbol: symbolOf('cloud.fill'), tint: solid(1, 2, 3) }), optionOf('wind', { symbol: symbolOf('wind') })]));
reject('choice-icons-more-than-four-segments', 'A segmented choice holds at most four options, with symbols too.', ['choice-icons', 'local-controls', 'local-state'], segmented(),
  { code: 'invalid_combination', pointer: at(0, '/props/stateId') }, modeState([...iconOptions(), optionOf('uv', { symbol: symbolOf('sun.max.fill') }), optionOf('aqi', { symbol: symbolOf('aqi.medium') })]));

// MARK: Evaluation: the stack's two arrangements, with the numbers of the app's hand-laid header
export const wgStyleEvaluations: WgStyleEvaluation[] = [];
const measure = (id: string, width: number, shrinks = false): J => ({ id, width, ...(shrinks ? { shrinks: true } : {}) });
/** The weather card header's stack: a glyph, a condition that slides when long, a range that must fit beside the numeral, and the numeral. */
const header: J = {
  axis: 'horizontal', spacing: token('m'), align: 'center',
  groups: [{ children: ['glyph', 'condition', 'range'], spacing: token('xs'), grow: true }, { children: ['numeral'] }],
  collapse: { to: 'vertical', when: ['accessibility-size', 'overflow'], fits: ['range'], spacing: token('s'),
    groups: [{ children: ['glyph', 'numeral'], distribution: 'spread', align: 'center' }, { children: ['condition'] }, { children: ['range'] }] },
};
const wide = (range: number, numeral = 88): J[] => [measure('glyph', 40), measure('condition', 320, true), measure('range', range), measure('numeral', numeral)];
/** One group of an expected arrangement: its children, the points between them, and the group's own settings (natural, start and not growing unless said). */
const g = (children: string[], spacing: number, more: J = {}): J => ({ children, spacing, distribution: 'natural', align: 'start', grow: false, ...more });
const WIDE_GROUPS = [g(['glyph', 'condition', 'range'], 4, { grow: true }), g(['numeral'], 12)];
const COLLAPSED_GROUPS = [g(['glyph', 'numeral'], 8, { distribution: 'spread', align: 'center' }), g(['condition'], 8), g(['range'], 8)];
const stackCase = (name: string, note: string, props: J, children: J[], width: number, accessibilitySize: boolean, expected: J) =>
  wgStyleEvaluations.push({ name, note, subject: { stack: { props, children, width, accessibilitySize } }, env: {}, expected: { stack: expected } });
const wideOut = { collapsed: false, reason: null, axis: 'horizontal', spacing: 12, groups: WIDE_GROUPS };
const collapsedOut = (reason: string) => ({ collapsed: true, reason, axis: 'vertical', spacing: 8, groups: COLLAPSED_GROUPS });
stackCase('stack-reflow-header-fits-beside-numeral', 'A range of 110 points beside an 88 point numeral in 343 points: 110 + 88 + 12 = 210 fits, so the header stays in its two columns.', header, wide(110), 343, false, wideOut);
stackCase('stack-reflow-header-range-too-wide', 'A range of 260 points beside an 88 point numeral in 343 points: 260 + 88 + 12 = 360 does not fit, so the header stacks and puts the glyph beside the numeral.', header, wide(260), 343, false, collapsedOut('overflow'));
stackCase('stack-reflow-header-exact-fit', 'The need is 300 points in 300: it fits.', header, wide(200), 300, false, wideOut);
stackCase('stack-reflow-header-half-point-tolerance', 'The need is 300 points in 299.5: half a point of tolerance keeps it in two columns.', header, wide(200), 299.5, false, wideOut);
stackCase('stack-reflow-header-over-the-tolerance', 'The need is 300 points in 299.4: more than half a point over, so it stacks.', header, wide(200), 299.4, false, collapsedOut('overflow'));
stackCase('stack-reflow-header-accessibility-size', 'At an accessibility text size the header stacks however much room there is: the text size is the reason.', header, wide(110), 343, true, collapsedOut('accessibility-size'));
stackCase('stack-reflow-header-accessibility-size-and-overflow', 'When both hold, the text size is named first.', header, wide(260), 343, true, collapsedOut('accessibility-size'));
stackCase('stack-reflow-header-long-condition-does-not-stack', 'A condition that slides gives room: 320 points of condition text never makes the header stack, only the range does.', header, [measure('glyph', 40), measure('condition', 900, true), measure('range', 110), measure('numeral', 88)], 343, false, wideOut);
stackCase('stack-reflow-header-no-range', 'With no range text (width 0) there is nothing to fit, so even a numeral wider than the card does not stack it.', header, wide(0, 500), 343, false, wideOut);
stackCase('stack-reflow-header-wide-numeral-counts', 'The group with the numeral needs the numeral\'s width: 110 + 240 + 12 = 362 in 343 stacks.', header, wide(110, 240), 343, false, collapsedOut('overflow'));
stackCase('stack-reflow-accessibility-only-ignores-overflow', 'A collapse that names only the text size does not stack for overflow.', { ...header, collapse: { ...header.collapse, when: ['accessibility-size'], fits: undefined } },
  wide(260), 343, false, wideOut);
stackCase('stack-reflow-overflow-only-ignores-the-text-size', 'A collapse that names only overflow does not stack at an accessibility size that fits.', { ...header, collapse: { ...header.collapse, when: ['overflow'] } },
  wide(110), 343, true, wideOut);
stackCase('stack-reflow-column-never-collapses', 'A column has no collapse to apply: it stays as it is, at any text size.', { axis: 'vertical', spacing: token('s') }, [measure('a', 400), measure('b', 10)], 100, true,
  { collapsed: false, reason: null, axis: 'vertical', spacing: 8, groups: [g(['a'], 8), g(['b'], 8)] });
stackCase('stack-reflow-without-fits-counts-what-cannot-shrink', 'With no fits list, a group counts the widest child that cannot shrink: the ticker gives room, so 140 + 120 + 12 = 272 fits in 300.',
  { axis: 'horizontal', spacing: token('m'), collapse: { to: 'vertical', when: ['overflow'] } }, [measure('a', 700, true), measure('b', 140), measure('c', 120)], 300, false,
  { collapsed: false, reason: null, axis: 'horizontal', spacing: 12, groups: [g(['a'], 12), g(['b'], 12), g(['c'], 12)] });
stackCase('stack-reflow-without-fits-stacks-when-rigid-children-do-not-fit', 'The same stack with a rigid third child of 200 points: 140 + 200 + 12 + 12 = 364 in 300 stacks, and with no groups each child is its own.',
  { axis: 'horizontal', spacing: token('m'), collapse: { to: 'vertical', when: ['overflow'], spacing: token('xs') } }, [measure('a', 700, true), measure('b', 140), measure('c', 200)], 300, false,
  { collapsed: true, reason: 'overflow', axis: 'vertical', spacing: 4, groups: [g(['a'], 4), g(['b'], 4), g(['c'], 4)] });
stackCase('stack-reflow-collapse-keeps-the-groups-it-does-not-replace', 'A collapse with its own space but no groups keeps the stack\'s groups and uses the new space between them.',
  { axis: 'horizontal', spacing: token('l'), groups: [{ children: ['a', 'b'] }, { children: ['c'] }], collapse: { to: 'vertical', when: ['accessibility-size'], spacing: token('s') } },
  [measure('a', 10), measure('b', 10), measure('c', 10)], 300, true,
  { collapsed: true, reason: 'accessibility-size', axis: 'vertical', spacing: 8, groups: [g(['a', 'b'], 8), g(['c'], 8)] });
stackCase('stack-reflow-points-spacing', 'Spacing in points is used as written: 100 + 100 + 30 = 230 in 229 stacks.',
  { axis: 'horizontal', spacing: points(30), collapse: { to: 'vertical', when: ['overflow'], fits: ['a', 'b'], spacing: points(2) } }, [measure('a', 100), measure('b', 100)], 229, false,
  { collapsed: true, reason: 'overflow', axis: 'vertical', spacing: 2, groups: [g(['a'], 2), g(['b'], 2)] });
const sectionHeaderStack = { axis: 'horizontal', spacing: token('section-header'), collapse: { to: 'vertical', when: ['overflow'], fits: ['a', 'b'], spacing: token('section-header') } };
stackCase('stack-reflow-section-header-token-is-ten-points', 'The section-header spacing token is 10 points, as native SpaceToken.sectionHeader (ServerUICompositionDocument.swift:143): 100 + 100 + 10 = 210 fits in 210.',
  sectionHeaderStack, [measure('a', 100), measure('b', 100)], 210, false,
  { collapsed: false, reason: null, axis: 'horizontal', spacing: 10, groups: [g(['a'], 10), g(['b'], 10)] });
stackCase('stack-reflow-section-header-token-stacks-past-the-tolerance', 'The same stack in 209.4 points is more than half a point short of 100 + 100 + 10 = 210, so it stacks with 10 points between the two.',
  sectionHeaderStack, [measure('a', 100), measure('b', 100)], 209.4, false,
  { collapsed: true, reason: 'overflow', axis: 'vertical', spacing: 10, groups: [g(['a'], 10), g(['b'], 10)] });
