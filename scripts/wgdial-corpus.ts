/**
 * The corpus cases of the two ids the weather-gen lane WG-S4 adds, all generic (nothing here is named for a card): `sh.dial@1` (the `dial` node: ticks on a
 * sweep, letters, a flag, a pointer that is a lit tick or the closed needle, text in the middle) and `sh.arc-track@1` (the `arc-track` node: a curve, a
 * horizon and a marker at progress). Demo ids only.
 *
 * `generate-expression-corpus.ts` writes them with its own, so one generator owns `contract/corpus/evaluation`. Publication cases are `pending-<family>-*`
 * (the Studio compiles them) and `<family>-*` (the Studio refuses them); every refusal records the Studio's first issue here by hand in `expect`, and the
 * generator fails when the compiler disagrees. The evaluation cases are written by hand from the native tests' own numbers and the native drawing code, never
 * computed by the modules under test: `dial-*` from `UKWeatherViews.swift` (the barometer and the compass) and `WeatherPresentationTests.swift` (bearings),
 * `arc-track-*` from `UKWeatherSunArcView` and `WeatherPresentationTests.swift:148-153` (the marker on the arc), each case citing its source line.
 */
type J = Record<string, any>;

export interface WgDialCase {
  name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean;
  /** The Studio's first issue, written by hand: a reject must give exactly this. */
  expect?: { code: string; pointer: string };
}
export interface WgDialEvaluation { name: string; note: string; subject: J; env: J; expected: J }
/** The families this module owns: `reject/pending-<family>-*` and `reject/<family>-*`. */
export const wgDialFamilies = ['dial', 'arc-track'];
/** Capability ids by the short names the cases use. */
export const wgDialNeeds: Record<string, string> = { dial: 'sh.dial@1', 'arc-track': 'sh.arc-track@1', 'text-style': 'sh.text-style@1', 'solid-appearance': 'sh.solid-appearance@1', rules: 'sh.rules@1', bindings: 'sh.bindings@1' };

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const rgba = (red: number, green: number, blue: number, alpha: number): J => ({ type: 'rgba', red, green, blue, alpha });
const pair = (light: J, darkInk: J): J => ({ type: 'solid-appearance', light, dark: darkInk });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const amber = solid(255, 159, 10), white = rgba(255, 255, 255, 0.55);
/** A value with its undefined fields dropped, as the file will hold it: a field written `undefined` here is one a case leaves out. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
/** A dial of 25 ticks over 250 degrees with a lit tick at 0.5: the smallest useful one. */
const dialOf = (props: J = {}, rest: J = {}, id = 'd'): J => plain(node(id, 'dial', {
  props: { sweep: { start: 145, length: 250 }, ticks: { count: 25, inner: 0.78, outer: 0.92, width: 1.4, ink: white },
    pointer: { kind: 'tick', value: lit(0.5), inner: 0.7, outer: 0.98, width: 3, ink: amber }, ...props }, a11y: { element: 'hidden' }, ...rest,
}));
/** A full-turn dial with the closed needle at a bearing in degrees, four letters and a flag. */
const needleOf = (props: J = {}, rest: J = {}): J => dialOf({
  sweep: { start: -90, length: 360 }, scale: 'degrees', ticks: { count: 48, inner: 0.8, outer: 0.92, width: 1.2, alternate: { inner: 0.85 }, skip: [0], ink: white },
  pointer: { kind: 'needle', value: lit(200), ink: amber, tailInk: rgba(255, 255, 255, 0.55), dotInk: solid(255, 255, 255) },
  labels: { ink: solid(255, 255, 255), items: [{ at: 0, text: 'N' }, { at: 0.25, text: 'E', needsValue: true }, { at: 0.5, text: 'S' }, { at: 0.75, text: 'W', needsValue: true }] },
  flag: { at: 0, ink: solid(255, 255, 255) }, ...props,
}, rest);
const line = (value: unknown, props: J = {}): J => ({ value: typeof value === 'string' ? lit(value) : value, style: 'title3', unavailableText: '-', ...props });
const arcOf = (props: J = {}, rest: J = {}, id = 'a'): J => plain(node(id, 'arc-track', {
  props: { curve: { from: [8, 40], control: [50, 4], to: [92, 40] }, box: [100, 48], maxWidth: 200, ink: rgba(255, 255, 255, 0.6), width: 2, dash: [3, 4],
    horizon: { from: [4, 40], to: [96, 40], ink: rgba(255, 255, 255, 0.35), width: 1 }, progress: lit(0.5), marker: { size: 10, ink: solid(255, 217, 77) }, ...props }, a11y: { element: 'hidden' }, ...rest,
}));
/** The generator adds the app-state sources to a case that is not one of its own; these cases use none, so they are dropped (keeps the first refusal the case's own). */
const noAppState: WgDialCase['tweak'] = envelope => { envelope.document.dataSources = envelope.document.dataSources.filter((entry: J) => entry.model !== 'app-state@1'); };

export const wgDialCases: WgDialCase[] = [];
const accept = (name: string, note: string, needs: string[], components: J[]) => wgDialCases.push({ name, note, needs, components, tweak: noAppState, reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], expect: WgDialCase['expect']) =>
  wgDialCases.push({ name, note, needs, components, tweak: noAppState, reject: true, expect });
const at = (index: number, rest: string) => `/document/pages/2/components/${index}${rest}`;

// MARK: Dial (`sh.dial@1`)
accept('pending-dial-tick', 'A ring of ticks over 250 degrees with one lit: the smallest dial.', ['dial'], [dialOf()]);
accept('pending-dial-needle', 'A full turn with the closed needle, read in degrees, with letters and a flag.', ['dial'], [needleOf()]);
accept('pending-dial-percent-scale', 'A value from 0 to 100.', ['dial'], [dialOf({ scale: 'percent', pointer: { kind: 'tick', value: lit(72), inner: 0.7, outer: 0.98, width: 3, ink: amber } })]);
accept('pending-dial-no-pointer', 'A dial with ticks and no pointer: decoration.', ['dial'], [dialOf({ pointer: undefined })]);
accept('pending-dial-no-ticks', 'A dial with a needle and letters and no ticks.', ['dial'], [needleOf({ ticks: undefined, flag: undefined })]);
accept('pending-dial-aspect-and-centre', 'A dial drawn wide, its centre lower than the middle: 1.4 wide to 1 tall, centre 0.56 down.', ['dial'], [dialOf({ aspect: 1.4, centerY: 0.56 })]);
accept('pending-dial-size-scaled', 'A size that scales with the text size and grows to at most 160 points.', ['dial'], [dialOf({ size: { points: 104, relativeTo: 'footnote', maxPoints: 160 }, maxWidth: 200 })]);
accept('pending-dial-center-text', 'Two lines of text in the middle: a value and a unit.', ['dial', 'bindings'], [dialOf({ center: [line(read('temp', ['state']), { font: { weight: 'bold', digits: 'monospaced' }, lines: 1 }), line('unit', { style: 'caption1' })] })]);
accept('pending-dial-pointer-bound', 'The pointer follows an entity: a number read from its state.', ['dial', 'bindings'], [dialOf({ pointer: { kind: 'tick', value: read('temp', ['state'], 'number'), inner: 0.7, outer: 0.98, width: 3, ink: amber } })]);
accept('pending-dial-ink-pair', 'A pointer that follows light and dark: the pair id is declared too.', ['dial', 'solid-appearance'], [dialOf({ pointer: { kind: 'tick', value: lit(0.5), inner: 0.7, outer: 0.98, width: 3, ink: pair(solid(200, 100, 0), amber) } })]);
accept('pending-dial-mirrors', 'A dial that flips in a right-to-left layout.', ['dial'], [dialOf({ mirrors: true })]);
accept('pending-dial-needle-still', 'A needle that does not turn when its value changes.', ['dial'], [needleOf({ pointer: { kind: 'needle', value: lit(200), ink: amber, tailInk: white, dotInk: solid(255, 255, 255), animates: false } })]);
accept('pending-dial-a11y-value', 'Read as a meter: a name and a spoken value.', ['dial'], [dialOf({}, { a11y: { element: 'value', label: lit('Level'), value: lit('Steady') } })]);
accept('pending-dial-a11y-bound-label', 'The spoken name may come from an entity.', ['dial', 'bindings'], [dialOf({}, { a11y: { element: 'value', label: read('temp', ['attributes', 'friendly_name']) } })]);
accept('pending-dial-full-turn-wraps', 'A full turn in unit scale.', ['dial'], [dialOf({ sweep: { start: -90, length: 360 }, pointer: { kind: 'needle', value: lit(0.25), ink: amber, tailInk: white, dotInk: white } })]);
accept('pending-dial-in-a-grid', 'A dial takes a width in a grid like any node.', ['dial'], [node('grid', 'tile-grid', {
  props: { minimum: 'tile@1', maxColumns: 2, spacing: { type: 'token', name: 'm' }, equalRowHeights: true, shortRow: 'share', fold: 'page' }, children: [dialOf({}, { layout: { span: 2 } })] })]);

const bad = (name: string, note: string, props: J, expect: WgDialCase['expect'], rest: J = {}, needs = ['dial']) => reject(name, note, needs, [dialOf(props, rest)], expect);
bad('dial-sweep-missing', 'A dial says its sweep.', { sweep: undefined }, { code: 'missing_required', pointer: at(0, '/props/sweep') });
bad('dial-sweep-length-over-360', 'A sweep goes round once at most.', { sweep: { start: 0, length: 361 } }, { code: 'limit_exceeded', pointer: at(0, '/props/sweep/length') });
bad('dial-sweep-length-zero', 'A sweep goes somewhere.', { sweep: { start: 0, length: 0 } }, { code: 'limit_exceeded', pointer: at(0, '/props/sweep/length') });
bad('dial-sweep-start-over-360', 'A sweep starts within a turn either way.', { sweep: { start: 400, length: 90 } }, { code: 'limit_exceeded', pointer: at(0, '/props/sweep/start') });
bad('dial-scale-unknown', 'The scales are unit, percent and degrees.', { scale: 'radians' }, { code: 'unknown_variant', pointer: at(0, '/props/scale') });
bad('dial-scale-degrees-needs-a-full-turn', 'Degrees are of a full turn: a sweep of 250 cannot read them.', { scale: 'degrees' }, { code: 'invalid_combination', pointer: at(0, '/props/scale') });
bad('dial-aspect-over-2', 'A dial is at most twice as wide as tall.', { aspect: 2.5 }, { code: 'limit_exceeded', pointer: at(0, '/props/aspect') });
bad('dial-centre-over-1', 'The centre is within the dial.', { centerY: 1.5 }, { code: 'limit_exceeded', pointer: at(0, '/props/centerY') });
bad('dial-size-max-below-points', 'A size never grows to less than itself.', { size: { points: 104, relativeTo: 'footnote', maxPoints: 80 } }, { code: 'invalid_value', pointer: at(0, '/props/size/maxPoints') });
bad('dial-ticks-count-over-120', 'A ring has at most 120 ticks.', { ticks: { count: 121, inner: 0.78, outer: 0.92, width: 1.4, ink: white } }, { code: 'limit_exceeded', pointer: at(0, '/props/ticks/count') });
bad('dial-ticks-count-one', 'A ring has two ticks at least.', { ticks: { count: 1, inner: 0.78, outer: 0.92, width: 1.4, ink: white } }, { code: 'limit_exceeded', pointer: at(0, '/props/ticks/count') });
bad('dial-ticks-count-fraction', 'The number of ticks is whole.', { ticks: { count: 12.5, inner: 0.78, outer: 0.92, width: 1.4, ink: white } }, { code: 'invalid_value', pointer: at(0, '/props/ticks/count') });
bad('dial-ticks-outer-below-inner', 'A tick runs outward: its outer end lies beyond its inner end.', { ticks: { count: 25, inner: 0.9, outer: 0.8, width: 1.4, ink: white } }, { code: 'invalid_value', pointer: at(0, '/props/ticks/outer') });
bad('dial-ticks-ends-over-1', 'The ends are shares of the radius, up to 1.', { ticks: { count: 25, inner: 0.78, outer: 1.2, width: 1.4, ink: white } }, { code: 'limit_exceeded', pointer: at(0, '/props/ticks/outer') });
bad('dial-ticks-alternate-past-outer', 'The inner end of the second ticks lies short of the outer end.', { ticks: { count: 25, inner: 0.78, outer: 0.92, width: 1.4, ink: white, alternate: { inner: 0.95 } } }, { code: 'invalid_value', pointer: at(0, '/props/ticks/alternate/inner') });
bad('dial-ticks-skip-past-count', 'A skipped tick is one the ring has.', { ticks: { count: 25, inner: 0.78, outer: 0.92, width: 1.4, ink: white, skip: [25] } }, { code: 'invalid_value', pointer: at(0, '/props/ticks/skip/0') });
bad('dial-ticks-ink-missing', 'A ring says its colour.', { ticks: { count: 25, inner: 0.78, outer: 0.92, width: 1.4 } }, { code: 'missing_required', pointer: at(0, '/props/ticks/ink') });
bad('dial-ticks-width-zero', 'A tick has a width.', { ticks: { count: 25, inner: 0.78, outer: 0.92, width: 0, ink: white } }, { code: 'limit_exceeded', pointer: at(0, '/props/ticks/width') });
bad('dial-ticks-extra-field', 'A ring has its own fields only.', { ticks: { count: 25, inner: 0.78, outer: 0.92, width: 1.4, ink: white, dash: 3 } }, { code: 'unknown_field', pointer: at(0, '/props/ticks/dash') });
bad('dial-pointer-kind-unknown', 'The pointers are tick and needle.', { pointer: { kind: 'hand', value: lit(0.5), ink: amber } }, { code: 'unknown_variant', pointer: at(0, '/props/pointer/kind') });
bad('dial-pointer-value-missing', 'A pointer says its value.', { pointer: { kind: 'tick', inner: 0.7, outer: 0.98, width: 3, ink: amber } }, { code: 'missing_required', pointer: at(0, '/props/pointer/value') });
bad('dial-pointer-value-text', 'A pointer\'s value is a number.', { pointer: { kind: 'tick', value: read('temp', ['state'], 'string'), inner: 0.7, outer: 0.98, width: 3, ink: amber } }, { code: 'binding_type', pointer: at(0, '/props/pointer/value') }, {}, ['dial', 'bindings']);
bad('dial-pointer-tick-outer-below-inner', 'A lit tick runs outward.', { pointer: { kind: 'tick', value: lit(0.5), inner: 0.9, outer: 0.7, width: 3, ink: amber } }, { code: 'invalid_value', pointer: at(0, '/props/pointer/outer') });
bad('dial-pointer-tick-ink-missing', 'A lit tick says its colour.', { pointer: { kind: 'tick', value: lit(0.5), inner: 0.7, outer: 0.98, width: 3 } }, { code: 'missing_required', pointer: at(0, '/props/pointer/ink') });
bad('dial-pointer-needle-tail-ink-missing', 'The needle says the colour of each part: its tail too.', { pointer: { kind: 'needle', value: lit(0.5), ink: amber, dotInk: white } }, { code: 'missing_required', pointer: at(0, '/props/pointer/tailInk') });
bad('dial-pointer-needle-dot-ink-missing', 'And its dot.', { pointer: { kind: 'needle', value: lit(0.5), ink: amber, tailInk: white } }, { code: 'missing_required', pointer: at(0, '/props/pointer/dotInk') });
bad('dial-pointer-needle-has-no-width', 'The needle is one closed style: it takes no width, inner or outer end.', { pointer: { kind: 'needle', value: lit(0.5), ink: amber, tailInk: white, dotInk: white, width: 3 } }, { code: 'unknown_field', pointer: at(0, '/props/pointer/width') });
bad('dial-pointer-animates-on-a-tick', 'Only the needle turns.', { pointer: { kind: 'tick', value: lit(0.5), inner: 0.7, outer: 0.98, width: 3, ink: amber, animates: true } }, { code: 'unknown_field', pointer: at(0, '/props/pointer/animates') });
bad('dial-labels-items-empty', 'Letters, when there are some, are at least one.', { labels: { ink: white, items: [] } }, { code: 'limit_exceeded', pointer: at(0, '/props/labels/items') });
bad('dial-labels-over-12', 'At most twelve letters.', { labels: { ink: white, items: Array.from({ length: 13 }, (_, index) => ({ at: index / 13, text: 'x' })) } }, { code: 'limit_exceeded', pointer: at(0, '/props/labels/items') });
bad('dial-labels-text-blank', 'A letter is something.', { labels: { ink: white, items: [{ at: 0, text: ' ' }] } }, { code: 'invalid_value', pointer: at(0, '/props/labels/items/0/text') });
bad('dial-labels-text-over-8', 'A letter is short: eight characters at most.', { labels: { ink: white, items: [{ at: 0, text: 'too long!!' }] } }, { code: 'limit_exceeded', pointer: at(0, '/props/labels/items/0/text') });
bad('dial-labels-place-over-1', 'A place along the sweep is 0 to 1.', { labels: { ink: white, items: [{ at: 1.5, text: 'x' }] } }, { code: 'limit_exceeded', pointer: at(0, '/props/labels/items/0/at') });
bad('dial-labels-ink-missing', 'The letters say their colour.', { labels: { items: [{ at: 0, text: 'N' }] } }, { code: 'missing_required', pointer: at(0, '/props/labels/ink') });
bad('dial-labels-needs-value-without-a-pointer', 'A letter that waits for a value needs a pointer to have one.', { pointer: undefined, labels: { ink: white, items: [{ at: 0, text: 'N', needsValue: true }] } }, { code: 'invalid_combination', pointer: at(0, '/props/labels/items/0/needsValue') });
bad('dial-flag-ink-missing', 'The flag says its colour.', { flag: { at: 0 } }, { code: 'missing_required', pointer: at(0, '/props/flag/ink') });
bad('dial-flag-place-over-1', 'The flag stands within the sweep.', { flag: { at: 2, ink: white } }, { code: 'limit_exceeded', pointer: at(0, '/props/flag/at') });
bad('dial-center-empty', 'The middle holds a line at least when it is given.', { center: [] }, { code: 'limit_exceeded', pointer: at(0, '/props/center') });
bad('dial-center-over-3-lines', 'The middle holds three lines at most.', { center: [line('a'), line('b'), line('c'), line('d')] }, { code: 'limit_exceeded', pointer: at(0, '/props/center') });
bad('dial-center-line-value-missing', 'A line says its words.', { center: [{ style: 'title3', unavailableText: '-' }] }, { code: 'missing_required', pointer: at(0, '/props/center/0/value') });
bad('dial-center-line-style-unknown', 'A line has a text style of the system\'s.', { center: [line('a', { style: 'jumbo' })] }, { code: 'unknown_variant', pointer: at(0, '/props/center/0/style') });
bad('dial-center-ticker-needs-one-line', 'A ticker slides one line.', { center: [line('a', { overflow: 'ticker', lines: 2 })] }, { code: 'invalid_combination', pointer: at(0, '/props/center/0/overflow') });
bad('dial-center-font-max-below-points', 'A scaled font never grows to less than itself.', { center: [line('a', { font: { scale: { points: 30, relativeTo: 'title3', maxPoints: 20 } } })] }, { code: 'invalid_value', pointer: at(0, '/props/center/0/font/scale/maxPoints') });
bad('dial-center-line-has-no-layout', 'A line is only the props of a text.', { center: [{ ...line('a'), layout: { span: 1 } }] }, { code: 'unknown_field', pointer: at(0, '/props/center/0/layout') });
bad('dial-a11y-missing', 'A dial says how it is read.', {}, { code: 'missing_required', pointer: at(0, '/a11y') }, { a11y: undefined });
bad('dial-a11y-element-unknown', 'It is read as nothing or a value.', {}, { code: 'unknown_variant', pointer: at(0, '/a11y/element') }, { a11y: { element: 'image' } });
bad('dial-a11y-hidden-with-label', 'A hidden dial has no name.', {}, { code: 'unknown_field', pointer: at(0, '/a11y/label') }, { a11y: { element: 'hidden', label: lit('Level') } });
bad('dial-a11y-value-without-label', 'A dial read as a value names itself.', {}, { code: 'missing_required', pointer: at(0, '/a11y/label') }, { a11y: { element: 'value' } });
bad('dial-has-no-children', 'A dial holds no nodes: its middle is lines of text.', {}, { code: 'unknown_field', pointer: at(0, '/children') }, { children: [] });
bad('dial-props-extra-field', 'A dial has its own fields only.', { glow: true }, { code: 'unknown_field', pointer: at(0, '/props/glow') });
bad('dial-mirrors-text', 'Flipping is a yes or no.', { mirrors: 'yes' }, { code: 'invalid_value', pointer: at(0, '/props/mirrors') });

// MARK: Arc track (`sh.arc-track@1`)
accept('pending-arc-track-minimal', 'A dashed curve with a marker at half: the smallest arc.', ['arc-track'], [arcOf({ horizon: undefined })]);
accept('pending-arc-track-horizon', 'The curve with a horizon line.', ['arc-track'], [arcOf()]);
accept('pending-arc-track-solid', 'A solid curve: no dashes.', ['arc-track'], [arcOf({ dash: undefined })]);
accept('pending-arc-track-no-marker', 'A curve with no marker: decoration.', ['arc-track'], [arcOf({ progress: undefined, marker: undefined })]);
accept('pending-arc-track-percent-scale', 'Progress from 0 to 100.', ['arc-track'], [arcOf({ scale: 'percent', progress: lit(50) })]);
accept('pending-arc-track-progress-bound', 'Progress follows an entity: a number read from its state.', ['arc-track', 'bindings'], [arcOf({ progress: read('temp', ['state'], 'number') })]);
accept('pending-arc-track-mirrors-off', 'An arc that keeps its place in a right-to-left layout.', ['arc-track'], [arcOf({ mirrors: false })]);
accept('pending-arc-track-ink-pair', 'A line that follows light and dark: the pair id is declared too.', ['arc-track', 'solid-appearance'], [arcOf({ ink: pair(rgba(0, 0, 0, 0.5), rgba(255, 255, 255, 0.6)) })]);
accept('pending-arc-track-a11y-value', 'Read as a meter: a name and a spoken value.', ['arc-track'], [arcOf({}, { a11y: { element: 'value', label: lit('Progress'), value: lit('Halfway') } })]);
accept('pending-arc-track-a11y-bound-label', 'The spoken name may come from an entity.', ['arc-track', 'bindings'], [arcOf({}, { a11y: { element: 'value', label: read('temp', ['attributes', 'friendly_name']), value: read('temp', ['state']) } })]);
accept('pending-arc-track-other-curve', 'Any curve in any box: a shallow arc.', ['arc-track'], [arcOf({ curve: { from: [0, 20], control: [40, 0], to: [80, 20] }, box: [80, 20], horizon: undefined })]);
accept('pending-arc-track-in-a-grid', 'An arc takes a width in a grid like any node.', ['arc-track'], [node('grid', 'tile-grid', {
  props: { minimum: 'tile@1', maxColumns: 2, spacing: { type: 'token', name: 'm' }, equalRowHeights: true, shortRow: 'share', fold: 'page' }, children: [arcOf({}, { layout: { span: 2 } })] })]);

const badArc = (name: string, note: string, props: J, expect: WgDialCase['expect'], rest: J = {}, needs = ['arc-track']) => reject(name, note, needs, [arcOf(props, rest)], expect);
badArc('arc-track-curve-missing', 'An arc says its curve.', { curve: undefined }, { code: 'missing_required', pointer: at(0, '/props/curve') });
badArc('arc-track-curve-control-missing', 'A curve has its three points.', { curve: { from: [8, 40], to: [92, 40] } }, { code: 'missing_required', pointer: at(0, '/props/curve/control') });
badArc('arc-track-curve-point-outside-the-box', 'A curve point lies inside the box: the bend toward (50, 60) is below a box 48 tall.', { curve: { from: [8, 40], control: [50, 60], to: [92, 40] } }, { code: 'invalid_value', pointer: at(0, '/props/curve/control') });
badArc('arc-track-curve-end-outside-the-box', 'The end of a curve too.', { curve: { from: [8, 40], control: [50, 4], to: [120, 40] } }, { code: 'invalid_value', pointer: at(0, '/props/curve/to') });
badArc('arc-track-curve-point-negative', 'A point is not below 0.', { curve: { from: [-1, 40], control: [50, 4], to: [92, 40] } }, { code: 'limit_exceeded', pointer: at(0, '/props/curve/from/0') });
badArc('arc-track-curve-point-has-three-numbers', 'A point is an x and a y.', { curve: { from: [8, 40, 1], control: [50, 4], to: [92, 40] } }, { code: 'limit_exceeded', pointer: at(0, '/props/curve/from') });
badArc('arc-track-box-missing', 'An arc says its box.', { box: undefined }, { code: 'missing_required', pointer: at(0, '/props/box') });
badArc('arc-track-box-zero', 'A box has a size.', { box: [100, 0] }, { code: 'limit_exceeded', pointer: at(0, '/props/box/1') });
badArc('arc-track-horizon-point-outside-the-box', 'A horizon point lies inside the box.', { horizon: { from: [4, 40], to: [140, 40], ink: white, width: 1 } }, { code: 'invalid_value', pointer: at(0, '/props/horizon/to') });
badArc('arc-track-horizon-ink-missing', 'A horizon says its colour.', { horizon: { from: [4, 40], to: [96, 40], width: 1 } }, { code: 'missing_required', pointer: at(0, '/props/horizon/ink') });
badArc('arc-track-ink-missing', 'The line says its colour.', { ink: undefined }, { code: 'missing_required', pointer: at(0, '/props/ink') });
badArc('arc-track-width-zero', 'The line has a width.', { width: 0 }, { code: 'limit_exceeded', pointer: at(0, '/props/width') });
badArc('arc-track-dash-zero', 'A dash has a length.', { dash: [0, 4] }, { code: 'limit_exceeded', pointer: at(0, '/props/dash/0') });
badArc('arc-track-dash-one-number', 'A dash is a stroke and a gap.', { dash: [3] }, { code: 'limit_exceeded', pointer: at(0, '/props/dash') });
badArc('arc-track-scale-unknown', 'The scales are unit and percent: an arc has no degrees.', { scale: 'degrees' }, { code: 'unknown_variant', pointer: at(0, '/props/scale') });
badArc('arc-track-progress-without-a-marker', 'Progress with no marker has nothing to move.', { marker: undefined }, { code: 'invalid_combination', pointer: at(0, '/props/progress') });
badArc('arc-track-marker-without-progress', 'A marker with no progress has nowhere to be.', { progress: undefined }, { code: 'missing_required', pointer: at(0, '/props/progress') });
badArc('arc-track-progress-text', 'Progress is a number.', { progress: read('temp', ['state'], 'string') }, { code: 'binding_type', pointer: at(0, '/props/progress') }, {}, ['arc-track', 'bindings']);
badArc('arc-track-marker-size-below-6', 'A marker is at least 6 points.', { marker: { size: 4, ink: solid(255, 217, 77) } }, { code: 'limit_exceeded', pointer: at(0, '/props/marker/size') });
badArc('arc-track-marker-size-over-32', 'A marker is at most 32 points.', { marker: { size: 40, ink: solid(255, 217, 77) } }, { code: 'limit_exceeded', pointer: at(0, '/props/marker/size') });
badArc('arc-track-marker-ink-missing', 'A marker says its colour.', { marker: { size: 10 } }, { code: 'missing_required', pointer: at(0, '/props/marker/ink') });
badArc('arc-track-max-width-below-16', 'The widest an arc is drawn is at least 16 points.', { maxWidth: 8 }, { code: 'limit_exceeded', pointer: at(0, '/props/maxWidth') });
badArc('arc-track-mirrors-text', 'Flipping is a yes or no.', { mirrors: 'yes' }, { code: 'invalid_value', pointer: at(0, '/props/mirrors') });
badArc('arc-track-props-extra-field', 'An arc has its own fields only.', { glow: true }, { code: 'unknown_field', pointer: at(0, '/props/glow') });
badArc('arc-track-a11y-missing', 'An arc says how it is read.', {}, { code: 'missing_required', pointer: at(0, '/a11y') }, { a11y: undefined });
badArc('arc-track-a11y-value-without-label', 'An arc read as a value names itself.', {}, { code: 'missing_required', pointer: at(0, '/a11y/label') }, { a11y: { element: 'value' } });
badArc('arc-track-has-no-children', 'An arc holds no nodes.', {}, { code: 'unknown_field', pointer: at(0, '/children') }, { children: [] });

// MARK: Evaluation
export const wgDialEvaluations: WgDialEvaluation[] = [];
const dialCase = (name: string, note: string, subject: J, expected: J) => wgDialEvaluations.push({ name, note, subject: { dial: subject }, env: {}, expected: { dial: expected } });
const arcCase = (name: string, note: string, subject: J, expected: J) => wgDialEvaluations.push({ name, note, subject: { arc: subject }, env: {}, expected: { arc: expected } });
const WP = 'apple/Tests/HassCoreTests/WeatherPresentationTests.swift';

// The barometer: 49 ticks over 250 degrees from 145, one lit (UKWeatherPressureGaugeView.draw, UKWeatherViews.swift:492-509), in a box 1.4 wide to 1 tall (gridHeight, :489).
const PRESSURE: J = {
  width: 140, aspect: 1.4, centerY: 0.56, sweep: { start: 145, length: 250 },
  ticks: { count: 49, inner: 0.78, outer: 0.92, width: 1.4 }, pointer: { kind: 'tick', inner: 0.7, outer: 0.98, width: 3 },
};
const pressure = (value: number | null, rest: J = {}): J => ({ ...PRESSURE, pointer: { ...PRESSURE.pointer, value }, ...rest });
dialCase('dial-barometer-box', 'A barometer 140 wide is 100 tall (width / 1.4, UKWeatherViews.swift:489), its centre 0.56 down at (70, 56) and its radius half the width: 70 (:492-493).',
  { op: 'layout', input: pressure(0.5), pick: ['width', 'height', 'cx', 'cy', 'radius'] }, { width: 140, height: 100, cx: 70, cy: 56, radius: 70 });
dialCase('dial-barometer-ticks-are-49', '49 ticks, index 0 to 48 (UKWeatherViews.swift:497).', { op: 'layout', input: pressure(0.5), pick: ['ticks.length'] }, { 'ticks.length': 49 });
dialCase('dial-barometer-first-tick', 'The first tick is at 145 degrees, lower left: between 0.78 and 0.92 of the radius (tick(0, inner: 0.78, outer: 0.92), :498).',
  { op: 'layout', input: pressure(0.5), pick: ['ticks.0'] }, { 'ticks.0': { x1: 25.2743, y1: 87.3173, x2: 17.2466, y2: 92.9383 } });
dialCase('dial-barometer-middle-tick', 'Tick 24 is half way round, 145 + 125 = 270 degrees: straight up (a point above the box, as the native code draws it).',
  { op: 'layout', input: pressure(0.5), pick: ['ticks.24'] }, { 'ticks.24': { x1: 70, y1: 1.4, x2: 70, y2: -8.4 } });
dialCase('dial-barometer-last-tick', 'The last tick is at 145 + 250 = 395, which is 35 degrees: lower right.', { op: 'layout', input: pressure(0.5), pick: ['ticks.48'] }, { 'ticks.48': { x1: 114.7257, y1: 87.3173, x2: 122.7534, y2: 92.9383 } });
dialCase('dial-barometer-lit-tick-at-half', 'The lit tick at a share of 0.5 (1010 hPa on 970 to 1050) is at 270 degrees, between 0.70 and 0.98 (lit, :501-503).', { op: 'layout', input: pressure(0.5), pick: ['lit', 'share'] }, { lit: { x1: 70, y1: 7, x2: 70, y2: -12.6 }, share: 0.5 });
dialCase('dial-barometer-lit-tick-at-start', 'A share of 0 (970 hPa, WeatherPresentationTests.swift:115) lights the first tick, 145 degrees.', { op: 'layout', input: pressure(0), pick: ['lit'] }, { lit: { x1: 29.8615, y1: 84.1052, x2: 13.8062, y2: 95.3473 } });
dialCase('dial-barometer-lit-tick-at-end', 'A share of 1 (1050 hPa) lights the last, 395 degrees.', { op: 'layout', input: pressure(1), pick: ['lit'] }, { lit: { x1: 110.1385, y1: 84.1052, x2: 126.1938, y2: 95.3473 } });
dialCase('dial-barometer-lit-tick-between', '1013 hPa is (1013 - 970) / 80 = 0.5375 of the sweep: 145 + 134.375 = 279.375 degrees (WeatherPresentation.swift:209).', { op: 'layout', input: pressure(0.5375), pick: ['lit'] }, { lit: { x1: 77.9819, y1: 7.6545, x2: 81.1746, y2: -11.6837 } });
dialCase('dial-barometer-lit-tick-over-is-held', 'A share above 1 is held at the last tick (1100 hPa gives a marker of 100, WeatherPresentationTests.swift:116; min(100, max(0, percent)), UKWeatherViews.swift:482).', { op: 'layout', input: pressure(1.5), pick: ['lit', 'share'] }, { lit: { x1: 110.1385, y1: 84.1052, x2: 126.1938, y2: 95.3473 }, share: 1 });
dialCase('dial-barometer-lit-tick-below-is-held', 'A share below 0 is held at the first tick.', { op: 'layout', input: pressure(-0.2), pick: ['lit', 'share'] }, { lit: { x1: 29.8615, y1: 84.1052, x2: 13.8062, y2: 95.3473 }, share: 0 });
dialCase('dial-barometer-no-value-hides-the-pointer', 'With no value no tick is lit (a pressure of an unknown unit has no gauge).', { op: 'layout', input: pressure(null), pick: ['lit', 'share', 'ticks.length'] }, { lit: null, share: null, 'ticks.length': 49 });
dialCase('dial-barometer-percent-scale', 'On the percent scale 25 is a quarter of the sweep: 145 + 62.5 = 207.5 degrees.', { op: 'layout', input: pressure(25, { scale: 'percent' }), pick: ['lit'] }, { lit: { x1: 26.5365, y1: 33.3743, x2: 9.1511, y2: 24.324 } });
dialCase('dial-barometer-right-to-left-keeps-its-place', 'A dial is an instrument in space: in a right-to-left layout it does not flip unless the document says so.', { op: 'layout', input: pressure(0, { rtl: true }), pick: ['lit'] }, { lit: { x1: 29.8615, y1: 84.1052, x2: 13.8062, y2: 95.3473 } });
dialCase('dial-barometer-right-to-left-mirrors-when-asked', 'With mirrors the sweep is flipped about the vertical axis: a share of 0 lights the tick at 180 - 145 = 35 degrees, the place of the last in a left-to-right layout.', { op: 'layout', input: pressure(0, { rtl: true, mirrors: true }), pick: ['lit'] }, { lit: { x1: 110.1385, y1: 84.1052, x2: 126.1938, y2: 95.3473 } });
dialCase('dial-barometer-mirrors-does-nothing-left-to-right', 'Mirrors flips only a right-to-left layout.', { op: 'layout', input: pressure(0, { mirrors: true }), pick: ['lit'] }, { lit: { x1: 29.8615, y1: 84.1052, x2: 13.8062, y2: 95.3473 } });
dialCase('dial-barometer-mirrored-quarter', 'Mirrored, a quarter of the sweep is at 180 - 207.5 = -27.5 degrees.', { op: 'layout', input: pressure(0.25, { rtl: true, mirrors: true }), pick: ['lit'] }, { lit: { x1: 113.4635, y1: 33.3743, x2: 130.8489, y2: 24.324 } });

// The compass: 48 ticks round a full turn from the top, the north tick drawn as a flag, four letters, the closed needle (UKWeatherCompassView, :362-440).
const COMPASS: J = {
  width: 104, sweep: { start: -90, length: 360 }, scale: 'degrees', ticks: { count: 48, inner: 0.8, outer: 0.92, width: 1.2, alternate: { inner: 0.85 }, skip: [0] },
  pointer: { kind: 'needle' }, flag: { at: 0 },
  labels: [{ at: 0, text: 'N' }, { at: 0.25, text: 'E', needsValue: true }, { at: 0.5, text: 'S' }, { at: 0.75, text: 'W', needsValue: true }],
};
const compass = (value: number | null, rest: J = {}): J => ({ ...COMPASS, pointer: { kind: 'needle', value }, ...rest });
dialCase('dial-compass-ticks-skip-the-north-one', 'The ticks are 1 to 47 of 48: the first, at north, is the flag (for index in 1..<48, UKWeatherViews.swift:416).', { op: 'layout', input: compass(0), pick: ['ticks.length'] }, { 'ticks.length': 47 });
dialCase('dial-compass-short-tick', 'On a full turn the ticks are 1/48 of it apart and the last does not repeat the first: tick 1 is at -90 + 7.5 degrees, a short one (inner 0.85, outer 0.92, :418-423).', { op: 'layout', input: compass(0), pick: ['ticks.0'] }, { 'ticks.0': { x1: 57.7693, y1: 8.1781, x2: 58.2444, y2: 4.5693 } });
dialCase('dial-compass-long-tick', 'Tick 2 is a long one (inner 0.80): at -90 + 15 degrees.', { op: 'layout', input: compass(0), pick: ['ticks.1'] }, { 'ticks.1': { x1: 62.7669, y1: 11.8175, x2: 64.3819, y2: 5.7901 } });
dialCase('dial-compass-last-tick', 'Tick 47 is the last, a short one, 7.5 degrees before north.', { op: 'layout', input: compass(0), pick: ['ticks.46'] }, { 'ticks.46': { x1: 46.2307, y1: 8.1781, x2: 45.7556, y2: 4.5693 } });
dialCase('dial-compass-flag', 'The flag at north: its tip 0.94 up the radius, its base 0.84 up and 0.06 of the radius either side (:426-431).', { op: 'layout', input: compass(0), pick: ['flag'] }, { flag: [{ x: 52, y: 3.12 }, { x: 55.12, y: 8.32 }, { x: 48.88, y: 8.32 }] });
dialCase('dial-compass-letters', 'N, E, S, W at 0.58 of the radius (:341), in a font a fifth of the radius, at least 10: 10.4 at 104 wide (:395).', { op: 'layout', input: compass(90), pick: ['labels'] },
  { labels: [{ text: 'N', x: 52, y: 21.84, fontSize: 10.4 }, { text: 'E', x: 82.16, y: 52, fontSize: 10.4 }, { text: 'S', x: 52, y: 82.16, fontSize: 10.4 }, { text: 'W', x: 21.84, y: 52, fontSize: 10.4 }] });
dialCase('dial-compass-letters-need-a-direction', 'With no direction only N and S are drawn (`if sourceDegrees == nil, text == "E" || text == "W" { continue }`, :346).', { op: 'layout', input: compass(null), pick: ['labels', 'needle'] },
  { labels: [{ text: 'N', x: 52, y: 21.84, fontSize: 10.4 }, { text: 'S', x: 52, y: 82.16, fontSize: 10.4 }], needle: null });
dialCase('dial-compass-letter-size-has-a-floor', 'The letters are never below 10 points: at 40 wide a fifth of the radius is 4, so 10.', { op: 'layout', input: compass(0, { width: 40 }), pick: ['labels.0.fontSize'] }, { 'labels.0.fontSize': 10 });
const needle = (name: string, note: string, value: number | null, rotation: number | null) =>
  dialCase(name, note, { op: 'layout', input: compass(value), pick: ['needle'] }, { needle: rotation === null ? null : { rotation, angle: rotation - 90 } });
needle('dial-needle-north', 'A bearing of 0 leaves the needle as drawn: the head down, the dot at the top (rotationAngle(0), UKWeatherViews.swift:357).', 0, 0);
needle('dial-needle-east', 'A bearing of 90 turns it a quarter.', 90, 90);
needle('dial-needle-south-west', 'A bearing of 200 turns it 200 degrees.', 200, 200);
needle('dial-needle-over-a-turn-wraps', 'A bearing of 360 is north again (normalizeBearingDegrees, WeatherPresentation.swift:13).', 360, 0);
needle('dial-needle-negative-wraps', 'A bearing of -10 is 350 (WeatherPresentationTests.swift:86).', -10, 350);
needle('dial-needle-no-value-hides-it', 'With no bearing there is no needle (`needle.isHidden = sourceDegrees == nil`, :352).', null, null);
dialCase('dial-needle-unit-scale-quarter', 'A full turn read as a share: 0.25 is 90 degrees.', { op: 'layout', input: compass(0.25, { scale: 'unit' }), pick: ['needle'] }, { needle: { rotation: 90, angle: 0 } });
dialCase('dial-needle-on-a-partial-sweep', 'On a sweep short of a turn the needle follows the sweep and is held at its ends: a share of 1.5 on 145 to 395 points at 395 degrees, turned 485.', { op: 'layout', input: { width: 100, sweep: { start: 145, length: 250 }, pointer: { kind: 'needle', value: 1.5 } }, pick: ['needle'] }, { needle: { rotation: 485, angle: 395 } });
dialCase('dial-needle-right-to-left-is-not-mirrored', 'A compass keeps its places: bearing 90 is east in either direction.', { op: 'layout', input: compass(90, { rtl: true }), pick: ['needle'] }, { needle: { rotation: 90, angle: 0 } });
dialCase('dial-needle-mirrored', 'Mirrored (a dial that says so), bearing 90 sits at 180 - 0 = 180 degrees, turned 270.', { op: 'layout', input: compass(90, { rtl: true, mirrors: true }), pick: ['needle'] }, { needle: { rotation: 270, angle: 180 } });
dialCase('dial-share-degrees-full-turn', 'Degrees on a full turn: 90 is a quarter.', { op: 'share', value: 90, scale: 'degrees', sweep: { start: -90, length: 360 } }, { share: 0.25 });
dialCase('dial-share-degrees-negative-wraps', '-90 degrees is 270: three quarters of the turn.', { op: 'share', value: -90, scale: 'degrees', sweep: { start: -90, length: 360 } }, { share: 0.75 });
dialCase('dial-share-unit-over-one-wraps-on-a-full-turn', 'A unit value of 1.25 on a full turn is 0.25.', { op: 'share', value: 1.25, scale: 'unit', sweep: { start: -90, length: 360 } }, { share: 0.25 });
dialCase('dial-share-unit-one-on-a-full-turn-is-the-start', 'A full turn of 1 is back at the start.', { op: 'share', value: 1, scale: 'unit', sweep: { start: -90, length: 360 } }, { share: 0 });
dialCase('dial-share-partial-sweep-is-held-above', 'On a partial sweep a share is held between 0 and 1: 1.25 is 1.', { op: 'share', value: 1.25, scale: 'unit', sweep: { start: 145, length: 250 } }, { share: 1 });
dialCase('dial-share-partial-sweep-is-held-below', 'And -0.5 is 0.', { op: 'share', value: -0.5, scale: 'unit', sweep: { start: 145, length: 250 } }, { share: 0 });
dialCase('dial-share-percent', 'The percent scale: 7 is 0.07.', { op: 'share', value: 7, scale: 'percent', sweep: { start: 145, length: 250 } }, { share: 0.07 });
dialCase('dial-share-not-a-number-is-unknown', 'A value that is not a number gives no share.', { op: 'share', value: null, scale: 'unit', sweep: { start: 145, length: 250 } }, { share: null });

// The needle turns the short way (shortestBearingDelta, WeatherPresentationTests.swift:85-93) and wraps bearings (normalizeBearingDegrees, :86).
const delta = (name: string, from: number, to: number, expected: number, line: string) => dialCase(name, `From ${from} to ${to} is ${expected} degrees (${WP}:${line}).`, { op: 'delta', from, to }, { delta: expected });
delta('dial-turn-359-to-1', 359, 1, 2, '87'); delta('dial-turn-1-to-359', 1, 359, -2, '88'); delta('dial-turn-350-to-10', 350, 10, 20, '89'); delta('dial-turn-10-to-350', 10, 350, -20, '90');
delta('dial-turn-0-to-180-is-positive', 0, 180, 180, '91'); delta('dial-turn-0-to-minus-180-is-positive', 0, -180, 180, '92'); delta('dial-turn-720-to-10', 720, 10, 10, '93');
dialCase('dial-normalize-minus-10', '-10 degrees is 350 (WeatherPresentationTests.swift:86).', { op: 'normalize', value: -10 }, { degrees: 350 });
dialCase('dial-normalize-over-a-turn', '725 degrees is 5.', { op: 'normalize', value: 725 }, { degrees: 5 });
dialCase('dial-next-turn-first-draw', 'The first draw turns to where the needle belongs (`from = angle ?? new`, UKWeatherViews.swift:367).', { op: 'next', previous: null, target: 90 }, { angle: 90 });
dialCase('dial-next-turn-350-to-10-goes-on', 'From 350 to 10 the needle goes on to 370, 20 degrees, not back 340 (:368-369).', { op: 'next', previous: 350, target: 10 }, { angle: 370 });
dialCase('dial-next-turn-10-to-350-goes-back', 'From 10 to 350 it goes back to -10.', { op: 'next', previous: 10, target: 350 }, { angle: -10 });
dialCase('dial-next-turn-keeps-unwrapping', 'Having gone on to 730, a bearing of 10 is 0 degrees on.', { op: 'next', previous: 730, target: 10 }, { angle: 730 });

// MARK: Evaluation: the arc
const SUN = { curve: { from: [8, 40], control: [50, 4], to: [92, 40] }, box: [100, 48], maxWidth: 200, horizon: { from: [4, 40], to: [96, 40] } };
const sun = (width: number, progress: number | null, rest: J = {}): J => ({ ...SUN, width, progress, ...rest });
const marker = (name: string, note: string, progress: number | null, expected: J | null, rest: J = {}, width = 100) =>
  arcCase(name, note, { op: 'layout', input: sun(width, progress, rest), pick: ['marker'] }, { marker: expected });
marker('arc-track-marker-at-sunrise', 'Progress 0 puts the marker at the start of the curve: (8, 40) (sunArcMarker(percent: 0), WeatherPresentationTests.swift:149).', 0, { x: 8, y: 40, t: 0 });
marker('arc-track-marker-at-noon', 'Progress 0.5 is the top of the arc: (50, 22) (:150). x = 8 + 84t, y = 40 - 72 t (1 - t).', 0.5, { x: 50, y: 22, t: 0.5 });
marker('arc-track-marker-at-sunset', 'Progress 1 is the end: (92, 40) (:151).', 1, { x: 92, y: 40, t: 1 });
marker('arc-track-marker-past-the-end-is-held', 'Progress 2 (200 percent) is held at the end: (92, 40) (:152).', 2, { x: 92, y: 40, t: 1 });
marker('arc-track-marker-below-zero-is-held', 'Progress below 0 is held at the start (clampPercent, WeatherPresentation.swift:10).', -0.3, { x: 8, y: 40, t: 0 });
marker('arc-track-marker-a-quarter', 'At 0.25: x = 8 + 84 x 0.25 = 29, y = 40 - 72 x 0.25 x 0.75 = 26.5.', 0.25, { x: 29, y: 26.5, t: 0.25 });
marker('arc-track-marker-a-tenth', 'At 0.1: x = 16.4, y = 40 - 72 x 0.09 = 33.52.', 0.1, { x: 16.4, y: 33.52, t: 0.1 });
marker('arc-track-marker-no-progress-hides-it', 'With no progress there is no marker (`if let percent`, UKWeatherViews.swift:576): the arc without a percent, as when the sun is below the horizon.', null, null);
marker('arc-track-marker-percent-scale', 'On the percent scale 50 is the top: (50, 22).', 50, { x: 50, y: 22, t: 0.5 }, { scale: 'percent' });
marker('arc-track-marker-scales-with-the-width', 'The arc is as wide as the room: at 150 points the marker at 0.5 is at (75, 33), the box scaled by 1.5 (drawWidth / 100, :562).', 0.5, { x: 75, y: 33, t: 0.5 }, {}, 150);
marker('arc-track-marker-width-is-capped', 'It is never wider than 200: at 300 points of room the arc is 200 wide, so the marker at 0.5 is at (100, 44).', 0.5, { x: 100, y: 44, t: 0.5 }, {}, 300);
marker('arc-track-marker-right-to-left-mirrors', 'In a right-to-left layout progress runs from the right: 0 is at 100 - 8 = 92.', 0, { x: 92, y: 40, t: 0 }, { rtl: true });
marker('arc-track-marker-right-to-left-top-stays', 'The top of the arc is the middle: (50, 22) either way.', 0.5, { x: 50, y: 22, t: 0.5 }, { rtl: true });
marker('arc-track-marker-right-to-left-quarter', 'A quarter in a right-to-left layout is at 100 - 29 = 71.', 0.25, { x: 71, y: 26.5, t: 0.25 }, { rtl: true });
marker('arc-track-marker-mirrors-off-keeps-the-place', 'An arc that says it does not mirror keeps its place: 0 is at 8 in a right-to-left layout.', 0, { x: 8, y: 40, t: 0 }, { rtl: true, mirrors: false });
arcCase('arc-track-box-height-follows-the-width', 'The arc is min(width, 200) x 48 / 100 tall (gridHeight, UKWeatherViews.swift:547): 150 wide is 72 tall.', { op: 'layout', input: sun(150, null), pick: ['width', 'height'] }, { width: 150, height: 72 });
arcCase('arc-track-box-height-capped', 'At 300 points of room: 200 wide, 96 tall.', { op: 'layout', input: sun(300, null), pick: ['width', 'height'] }, { width: 200, height: 96 });
arcCase('arc-track-no-cap-fills-the-room', 'Without a widest the arc fills the room: 300 wide is 144 tall.', { op: 'layout', input: sun(300, null, { maxWidth: undefined }), pick: ['width', 'height'] }, { width: 300, height: 144 });
arcCase('arc-track-curve-and-horizon-scale', 'The curve and the horizon are the box scaled by 1.5 at 150 wide: (12, 60), (75, 6), (138, 60); the horizon (6, 60) to (144, 60) (:565-573).', { op: 'layout', input: sun(150, null), pick: ['curve', 'horizon'] },
  { curve: { from: [12, 60], control: [75, 6], to: [138, 60] }, horizon: { from: [6, 60], to: [144, 60] } });
arcCase('arc-track-curve-mirrored', 'Mirrored, the curve and the horizon swap sides: from (92, 40) to (8, 40) at 100 wide.', { op: 'layout', input: sun(100, null, { rtl: true }), pick: ['curve', 'horizon'] },
  { curve: { from: [92, 40], control: [50, 4], to: [8, 40] }, horizon: { from: [96, 40], to: [4, 40] } });
arcCase('arc-track-no-horizon', 'An arc without a horizon draws none.', { op: 'layout', input: sun(100, null, { horizon: undefined }), pick: ['horizon'] }, { horizon: null });
arcCase('arc-track-progress-percent', 'On the percent scale 7 is 0.07.', { op: 'progress', value: 7, scale: 'percent' }, { t: 0.07 });
arcCase('arc-track-progress-not-a-number', 'Not a number is no progress.', { op: 'progress', value: null }, { t: null });
arcCase('arc-track-point-of-another-curve', 'Any quadratic curve: from (0, 0) bent toward (10, 20) to (20, 0) is at (10, 10) at the middle: (1 - t)^2 from + 2 t (1 - t) control + t^2 to.', { op: 'point', curve: { from: [0, 0], control: [10, 20], to: [20, 0] }, t: 0.5 }, { x: 10, y: 10 });
