/**
 * The corpus cases of the four grammar additions the climate controls need (native-climate-kinds CT1), all generic: N1 a fixed count of fraction
 * digits (`minimumFractionDigits`), T1 a title-case text format, A1 a list read (`list-count`, `list-includes`) and A2 a raw state read (`raw-state`).
 * N1 and T1 are format specs, so they live under `sh.pipeline-operands@1` beside the date styles; A1 is `sh.list-read@1` and A2 `sh.raw-state@1`, new
 * pending ids so native can ingest them one at a time. This module only holds the cases; `generate-expression-corpus.ts` writes them with its own, so
 * one generator owns `contract/corpus/evaluation`.
 *
 * Publication cases are `pending-<family>-*` (the Studio compiles them) and `<family>-*` (the Studio refuses them). Evaluation answers are hand-written:
 * where a number or a text needs an independent check, the note says how it was worked out (C `printf("%.Nf")`, ASCII upper case).
 */
type J = Record<string, any>;

export interface Grammar2Case { name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean }
export interface Grammar2Evaluation { name: string; note: string; subject: J; env: J; expected: J }
/** The families this module owns: `reject/pending-<family>-*` and `reject/<family>-*`. */
export const grammar2Families = ['number-format', 'text-format', 'list-read', 'raw-state', 'appearance', 'tile-ink', 'surface-orientation', 'surface-controls'];
/** Capability ids by the short names the cases use. */
export const grammar2Needs: Record<string, string> = {
  'list-read': 'sh.list-read@1', 'raw-state': 'sh.raw-state@1', 'text-case-words': 'sh.text-case-words@1', 'solid-appearance': 'sh.solid-appearance@1',
  'tile-ink': 'sh.tile-ink@1', 'surface-orientation': 'sh.surface-orientation@1', 'surface-controls': 'sh.surface-controls@1',
};

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const cmp = (op: string, left: J, right: J): J => ({ type: 'compare', op, left, right });
const choose = (cases: [J, J][], otherwise: J): J => ({ type: 'choose', cases: cases.map(([when, then]) => ({ when, then })), otherwise });
const fmt = (pattern: string, args: J, formats?: J): J => ({ type: 'format', pattern, args, ...(formats ? { formats } : {}) });
const digits = (maximumFractionDigits: number, minimumFractionDigits?: number): J => ({ number: { maximumFractionDigits, ...(minimumFractionDigits === undefined ? {} : { minimumFractionDigits }) } });
const title: J = { text: { case: 'title' } };
const everyWord: J = { text: { case: 'words' } };
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const exprText = (operand: J): J[] => [node('t', 'text', { props: { value: { type: 'expr', value: operand }, style: 'body', unavailableText: 'None' } })];
const when = (predicate: J): J[] => [node('t', 'text', { props: { value: lit('Shown'), style: 'body', unavailableText: 'None' }, visibleWhen: predicate })];
const listCount = (sourceId: string, segments: string[]): J => ({ type: 'list-count', from: { type: 'source', sourceId, path: segments } });
const listIncludes = (sourceId: string, segments: string[], value: J): J => ({ type: 'list-includes', from: { type: 'source', sourceId, path: segments }, value });
const rawState = (sourceId: string): J => ({ type: 'raw-state', sourceId });

export const grammar2Cases: Grammar2Case[] = [];
const accept = (name: string, note: string, needs: string[], components: J[], tweak?: Grammar2Case['tweak']) => grammar2Cases.push({ name, note, needs, components, tweak, reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], tweak?: Grammar2Case['tweak']) => grammar2Cases.push({ name, note, needs, components, tweak, reject: true });
// The sources the generator gives every case: `temp` (a sensor), `guest-fan` (a fan, which has preset modes) and `lights` (a home status model).

// MARK: Number format (N1)
accept('pending-number-format-fixed-digits', 'A temperature drawn with exactly one fraction digit: 72 reads "72.0".', ['pipeline-operands'],
  exprText(fmt('{t}°F', { t: read('temp', ['state'], 'number') }, { t: digits(1, 1) })));
accept('pending-number-format-minimum-below-maximum', 'The minimum may be below the maximum: at least one digit and at most three.', ['pipeline-operands'],
  exprText(fmt('{t}', { t: read('temp', ['state'], 'number') }, { t: digits(3, 1) })));
reject('number-format-minimum-above-maximum', 'The minimum cannot exceed the maximum.', ['pipeline-operands'], exprText(fmt('{t}', { t: lit(1) }, { t: digits(1, 2) })));
reject('number-format-minimum-over-six', 'At most six fraction digits, minimum too.', ['pipeline-operands'], exprText(fmt('{t}', { t: lit(1) }, { t: digits(6, 7) })));
reject('number-format-minimum-negative', 'A count of digits is not negative.', ['pipeline-operands'], exprText(fmt('{t}', { t: lit(1) }, { t: digits(2, -1) })));

// MARK: Text format (T1)
accept('pending-text-format-title-case', 'An entity state such as heat_cool drawn as words: "Heat Cool".', ['pipeline-operands'],
  exprText(fmt('Mode: {m}', { m: read('guest-fan', ['state']) }, { m: title })));
accept('pending-text-format-title-case-attribute', 'A text attribute drawn in title case beside a fixed digits number.', ['pipeline-operands'],
  exprText(fmt('{m} at {t}', { m: read('guest-fan', ['attributes', 'preset_mode']), t: read('temp', ['state'], 'number') }, { m: title, t: digits(1, 1) })));
reject('text-format-number-argument', 'Title case draws text: a number argument is refused.', ['pipeline-operands'], exprText(fmt('{t}', { t: read('temp', ['state'], 'number') }, { t: title })));
reject('text-format-unknown-case', 'The case is title, never a pattern.', ['pipeline-operands'], exprText(fmt('{m}', { m: lit('on') }, { m: { text: { case: 'upper' } } })));
reject('text-format-both-formats', 'One argument has one format.', ['pipeline-operands'], exprText(fmt('{m}', { m: lit('on') }, { m: { text: { case: 'title' }, number: { maximumFractionDigits: 1 } } })));
reject('text-format-unknown-argument', 'A format names an argument the pattern has.', ['pipeline-operands'], exprText(fmt('{m}', { m: lit('on') }, { n: title })));
reject('text-format-extra-field', 'The text format has only a case.', ['pipeline-operands'], exprText(fmt('{m}', { m: lit('on') }, { m: { text: { case: 'title', locale: 'en' } } })));
// TC4: the `words` case, its own id so a lowering that needs only "Wheel Stuck" does not wait for the pipeline.
accept('pending-text-format-words-case', 'A vacuum\'s issue text drawn with a capital on every word: "Wheel stuck" is "Wheel Stuck".', ['text-case-words'],
  exprText(fmt('{m}', { m: read('guest-fan', ['attributes', 'issue']) }, { m: everyWord })));
accept('pending-text-format-words-case-in-a-sentence', 'The words case beside plain text and a fixed digits number.', ['text-case-words', 'pipeline-operands'],
  exprText(fmt('Issue: {m} at {t}', { m: read('guest-fan', ['attributes', 'issue']), t: read('temp', ['state'], 'number') }, { m: everyWord, t: digits(1, 1) })));
accept('pending-text-format-words-and-title-case', 'One format may use both cases on different arguments: it needs both ids.', ['text-case-words', 'pipeline-operands'],
  exprText(fmt('{a} {b}', { a: read('guest-fan', ['state']), b: read('guest-fan', ['attributes', 'issue']) }, { a: title, b: everyWord })));
reject('text-format-words-number-argument', 'The words case draws text: a number argument is refused.', ['text-case-words'], exprText(fmt('{t}', { t: read('temp', ['state'], 'number') }, { t: everyWord })));
reject('text-format-words-unknown-case', 'The cases are title and words; a differently spelled one is refused.', ['text-case-words'], exprText(fmt('{m}', { m: lit('on') }, { m: { text: { case: 'Words' } } })));
reject('text-format-words-extra-field', 'The text format has only a case.', ['text-case-words'], exprText(fmt('{m}', { m: lit('on') }, { m: { text: { case: 'words', locale: 'en' } } })));
reject('text-format-words-unknown-argument', 'A format names an argument the pattern has.', ['text-case-words'], exprText(fmt('{m}', { m: lit('on') }, { n: everyWord })));

// MARK: Appearance pair (TC4c): `sh.solid-appearance@1`, a `solid-appearance` { light, dark } wherever a slot takes an exact colour.
const symbolOf = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const solid = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const pair = (light: J, dark: J): J => ({ type: 'solid-appearance', light, dark });
/** The cleaning glyph: 0x9C6DC3 in Light Mode and 0xC88CFA in Dark Mode. */
const purple = pair(solid(0x9C, 0x6D, 0xC3), solid(0xC8, 0x8C, 0xFA));
const STANDARD: J = { type: 'standard' };
const hot: J = cmp('above', read('temp', ['state'], 'number'), lit(75));
const conditionalOf = (cases: [J, J][], otherwise: J): J => ({ type: 'conditional', cases: cases.map(([whenCase, then]) => ({ when: whenCase, then })), otherwise });
const chipOf = (appearance: J): J[] => [node('chip', 'status-chip', {
  props: { sourceId: 'lights', states: [{ state: 'active', appearance }], fallback: { icon: symbolOf('lightbulb'), fill: STANDARD }, announcement: 'none' } })];
const tileOf = (fill: J): J[] => [node('nav', 'navigation-tile', { icon: symbolOf('house'), props: { family: 'neutral', selected: 'none', subtitle: lit('x'), presentation: { layout: 'standard', titleLines: 1, fill } },
  action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } })];
const roomOf = (stateColors: J[]): J[] => [node('rc', 'room-card', { icon: symbolOf('house'), binding: { sourceId: 'guest-fan', projection: 'room-state@1' }, props: {
  kind: 'light', showState: true, subtitleSourceIds: [], activeStates: [], disabledStates: [], stateLabels: [], stateColors } })];
/** A state style whose first rule paints the given fill; the rest is a plain vacuum style. */
const styleWith = (fill: J): J => ({ type: 'state-styles@1', styles: [{
  id: 'tidy-vacuum', name: 'Tidy vacuum', base: 'robot', domain: 'vacuum',
  rules: [
    { states: ['docked', 'idle'], class: 'resting', active: false, fill },
    { states: ['cleaning'], class: 'resting', active: true },
    { states: ['unavailable', 'unknown'], class: 'unknown', active: false },
  ],
  fallback: { class: 'unknown', active: false },
}] });
const styled = (fill: J) => (envelope: J) => { envelope.document.stateStyles = styleWith(fill); };
const STYLE_NEEDS = ['sh.state-style@1', 'sh.state-style-fills@1'];
const withStyle = (name: string, accepted: boolean, note: string, fill: J) => {
  const add = accepted ? accept : reject;
  add(name, note, ['solid-appearance'], [], envelope => { styled(fill)(envelope); envelope.capabilities = [...new Set([...envelope.capabilities, ...STYLE_NEEDS])].sort(); });
};
accept('pending-appearance-glyph', 'A chip glyph with one colour for Light and another for Dark: the cleaning glyph is 0x9C6DC3 in Light Mode and 0xC88CFA in Dark Mode.', ['solid-appearance'],
  chipOf({ icon: symbolOf('lightbulb.fill'), glyph: purple, fill: STANDARD }));
accept('pending-appearance-fill', 'A fill that is a pair: a chip and a navigation tile, each with its own Light and Dark colour.', ['solid-appearance'],
  [...chipOf({ icon: symbolOf('lightbulb.fill'), fill: pair(solid(255, 149, 0), solid(255, 159, 10)) }), ...tileOf(pair(solid(1, 2, 3), solid(200, 210, 220)))].map((item, index) => ({ ...item, id: `${item.id}-${index}` })));
accept('pending-appearance-conditional', 'A rule whose cases are pairs: the first case that holds gives a Light and Dark colour, and otherwise is a plain colour.', ['solid-appearance', 'conditions', 'rules'],
  chipOf({ icon: symbolOf('lightbulb.fill'), glyph: conditionalOf([[hot, purple]], solid(60, 60, 67)), fill: conditionalOf([[hot, pair(solid(120, 20, 10), solid(255, 69, 58))]], STANDARD) }));
accept('pending-appearance-bound-color-fallback', 'An entity\'s colour with a fallback that is a pair: used while the entity gives no colour.', ['solid-appearance', 'rules'],
  chipOf({ icon: symbolOf('lightbulb.fill'), glyph: { type: 'bound-color', value: read('temp', ['state']), fallback: purple }, fill: STANDARD }));
accept('pending-appearance-room-state-colors', 'A room card colour for a state, as a pair.', ['solid-appearance'], roomOf([{ state: 'on', fill: pair(solid(255, 204, 0), solid(255, 214, 10)) }]));
accept('pending-appearance-identical-colors', 'The two colours may be equal: the Studio does not collapse a pair into one colour.', ['solid-appearance'],
  chipOf({ icon: symbolOf('lightbulb.fill'), glyph: pair(solid(1, 2, 3), solid(1, 2, 3)), fill: STANDARD }));
withStyle('pending-appearance-state-style-fill', true, 'A state style fill as a pair: the docked tile is one colour in Light Mode and another in Dark Mode. It needs the fills id too.', purple);
reject('appearance-missing-dark', 'A pair has both colours: a missing dark is refused.', ['solid-appearance'], chipOf({ icon: symbolOf('lightbulb.fill'), glyph: { type: 'solid-appearance', light: solid(1, 2, 3) }, fill: STANDARD }));
reject('appearance-missing-light', 'A pair has both colours: a missing light is refused.', ['solid-appearance'], chipOf({ icon: symbolOf('lightbulb.fill'), glyph: { type: 'solid-appearance', dark: solid(1, 2, 3) }, fill: STANDARD }));
reject('appearance-channel-over-255', 'A channel of either colour is 0 to 255.', ['solid-appearance'], chipOf({ icon: symbolOf('lightbulb.fill'), glyph: pair(solid(1, 2, 3), solid(256, 0, 0)), fill: STANDARD }));
reject('appearance-channel-fraction', 'A channel is a whole number.', ['solid-appearance'], chipOf({ icon: symbolOf('lightbulb.fill'), glyph: pair(solid(1.5, 2, 3), solid(4, 5, 6)), fill: STANDARD }));
reject('appearance-standard-inside', 'A pair holds exact colours: the standard fill is not one of them.', ['solid-appearance'], chipOf({ icon: symbolOf('lightbulb.fill'), glyph: pair(STANDARD, solid(1, 2, 3)), fill: STANDARD }));
reject('appearance-nested-pair', 'A pair does not nest.', ['solid-appearance'], chipOf({ icon: symbolOf('lightbulb.fill'), glyph: pair(pair(solid(1, 2, 3), solid(4, 5, 6)), solid(7, 8, 9)), fill: STANDARD }));
reject('appearance-extra-field', 'A pair has only light and dark: a family or an alpha is refused.', ['solid-appearance'], chipOf({ icon: symbolOf('lightbulb.fill'), glyph: { ...purple, family: 'purple' }, fill: STANDARD }));
reject('appearance-named-family', 'There is no named family: a pair names its colours as values.', ['solid-appearance'], chipOf({ icon: symbolOf('lightbulb.fill'), glyph: { type: 'solid-appearance', family: 'cleaning' }, fill: STANDARD }));
reject('appearance-as-hex-string', 'A colour is the solid-rgb object, never a string.', ['solid-appearance'], chipOf({ icon: symbolOf('lightbulb.fill'), glyph: { type: 'solid-appearance', light: '#9C6DC3', dark: '#C88CFA' }, fill: STANDARD }));
reject('appearance-on-an-icon', 'A pair is a colour: a symbol slot does not take one.', ['solid-appearance'], chipOf({ icon: purple, fill: STANDARD }));
reject('appearance-in-a-literal-text', 'A pair is a look, not a text value.', ['solid-appearance'], [node('t', 'text', { props: { value: purple, style: 'body', unavailableText: 'None' } })]);
withStyle('appearance-state-style-missing-dark', false, 'A state style fill pair has both colours.', { type: 'solid-appearance', light: solid(1, 2, 3) });
withStyle('appearance-state-style-standard-inside', false, 'A state style pair holds exact colours: the standard fill is not one.', pair(STANDARD, solid(1, 2, 3)));

// MARK: Tile ink (TC5): `sh.tile-ink@1`, an exact colour for a state tile's icon and its buttons' icons, and the ink of the words on a state style fill.
/** The vacuum-like purple of the cleaning card, as values: the Studio authors it, no family names it. */
const iconPurple = pair(solid(0x8E, 0x6D, 0xAC), solid(0xC1, 0x8C, 0xEE));
const discPurple = pair(solid(0x8E, 0x6D, 0xAC), solid(0xB8, 0x8D, 0xDD));
const tileOfStyle = (rest: J = {}): J => node('tile', 'state-tile', { icon: symbolOf('fan'), binding: { entityId: 'vacuum.demo_robot', styleId: 'tidy-vacuum' }, props: {}, ...rest });
const pauseDisc: J = { id: 'pause', icon: symbolOf('pause.fill'), label: 'Pause', action: { type: 'call-service', domain: 'vacuum', service: 'pause', feedback: 'policy', target: { entity_id: lit('vacuum.demo_robot') } } };
/** A state style whose first rule paints `fill` with `ink`, and whose fallback paints `fallbackInk` without a fill when it is not undefined. */
const inkStyle = (fill: J | undefined, ink: unknown, fallback: J = {}): J => ({ type: 'state-styles@1', styles: [{
  id: 'tidy-vacuum', name: 'Tidy vacuum', base: 'robot', domain: 'vacuum',
  rules: [
    { states: ['docked', 'idle'], class: 'resting', active: false, ...(fill ? { fill } : {}), ...(ink === undefined ? {} : { fillInk: ink }) },
    { states: ['cleaning'], class: 'resting', active: true },
    { states: ['unavailable', 'unknown'], class: 'unknown', active: false },
  ],
  fallback: { class: 'unknown', active: false, ...fallback },
}] });
const inked = (fill: J | undefined, ink: unknown, fallback: J = {}) => (envelope: J) => {
  envelope.document.stateStyles = inkStyle(fill, ink, fallback);
  envelope.capabilities = [...new Set([...envelope.capabilities, ...STYLE_NEEDS])].sort();
};
accept('pending-tile-ink-glyph-tint', 'A state tile whose icon is an exact colour on a plain face: one colour for both appearances. Without it the icon stays grey.', ['tile-ink'],
  [tileOfStyle({ glyphTint: solid(142, 109, 172) })], inked(undefined, undefined));
accept('pending-tile-ink-glyph-tint-pair', 'The icon colour as a Light and Dark pair: it needs the pair id too.', ['tile-ink', 'solid-appearance'],
  [tileOfStyle({ glyphTint: iconPurple })], inked(undefined, undefined));
accept('pending-tile-ink-disc-glyph-tint', 'The icons of a tile\'s buttons as an exact colour on a dark face. Without it they stay white.', ['tile-ink'],
  [tileOfStyle({ discGlyphTint: solid(184, 141, 221), props: { discs: [pauseDisc] } })], inked(undefined, undefined));
accept('pending-tile-ink-both-tints', 'The vacuum-like tile: a purple icon and purple button icons, each a Light and Dark pair, beside a button.', ['tile-ink', 'solid-appearance'],
  [tileOfStyle({ glyphTint: iconPurple, discGlyphTint: discPurple, props: { discs: [pauseDisc] } })], inked(undefined, undefined));
accept('pending-tile-ink-cell-fit-natural', 'A tile that keeps its own height at the top of a taller grid cell, in a grid whose rows are equally tall.', ['tile-ink'],
  [node('grid', 'tile-grid', { props: { minimum: 'tile@1', maxColumns: 2, spacing: { type: 'token', name: 'm' }, equalRowHeights: true, shortRow: 'share', fold: 'page' },
    children: [tileOfStyle({ id: 'a', title: 'A', cellFit: 'natural' }), tileOfStyle({ id: 'b', title: 'B', cellFit: 'fill' })] })], inked(undefined, undefined));
accept('pending-tile-ink-cell-fit-fill', 'Fill is the default and may be written: the tile stretches to its cell.', ['tile-ink'], [tileOfStyle({ cellFit: 'fill' })], inked(undefined, undefined));
accept('pending-tile-ink-fill-ink-soft', 'A state with a fill draws its words in white at 92%.', ['tile-ink'], [tileOfStyle()], inked(solid(120, 90, 160), 'soft'));
accept('pending-tile-ink-fill-ink-white', 'White is the ink a fill has without the field; naming it is allowed.', ['tile-ink'], [tileOfStyle()], inked(solid(120, 90, 160), 'white'));
accept('pending-tile-ink-fill-ink-on-pair-fill', 'The ink of a fill that is a Light and Dark pair, on the fallback state too.', ['tile-ink', 'solid-appearance'],
  [tileOfStyle()], inked(iconPurple, 'soft', { fill: solid(1, 2, 3), fillInk: 'soft' }));
const refuseTint = (name: string, note: string, tint: J, field = 'glyphTint') => reject(name, note, ['tile-ink'], [tileOfStyle({ [field]: tint })], inked(undefined, undefined));
refuseTint('tile-ink-glyph-tint-standard', 'A tint is an exact colour: the standard fill is not one.', STANDARD);
refuseTint('tile-ink-glyph-tint-conditional', 'A tint is one colour or one for each appearance: a rule of colours is not a tint.', conditionalOf([[hot, solid(1, 2, 3)]], solid(4, 5, 6)));
refuseTint('tile-ink-glyph-tint-bound-color', 'A tint is not an entity\'s colour: bound-color is refused.', { type: 'bound-color', value: read('temp', ['state']), fallback: solid(1, 2, 3) });
refuseTint('tile-ink-glyph-tint-missing-blue', 'A tint colour has red, green and blue.', { type: 'solid-rgb', red: 1, green: 2 });
refuseTint('tile-ink-glyph-tint-over-255', 'A channel is 0 to 255.', solid(1, 256, 3));
refuseTint('tile-ink-glyph-tint-hex-string', 'A colour is the solid-rgb object, never a string.', '#8E6DAC');
refuseTint('tile-ink-glyph-tint-named-family', 'There is no named family: a tint names its colours as values.', { type: 'solid-appearance', family: 'cleaning' });
refuseTint('tile-ink-glyph-tint-nested-pair', 'A pair does not nest.', pair(pair(solid(1, 2, 3), solid(4, 5, 6)), solid(7, 8, 9)));
refuseTint('tile-ink-disc-glyph-tint-standard', 'The button tint takes the same colours: the standard fill is refused.', STANDARD, 'discGlyphTint');
refuseTint('tile-ink-disc-glyph-tint-missing-dark', 'The button tint pair has both colours.', { type: 'solid-appearance', light: solid(1, 2, 3) }, 'discGlyphTint');
refuseTint('tile-ink-disc-glyph-tint-extra-field', 'A tint has only the colour: an alpha is refused.', { ...solid(1, 2, 3), alpha: 0.5 }, 'discGlyphTint');
reject('tile-ink-glyph-tint-on-a-navigation-tile', 'Only a state tile has the tints: another tile refuses the field.', ['tile-ink'],
  [{ ...tileOf(STANDARD)[0], glyphTint: solid(1, 2, 3) }]);
refuseTint('tile-ink-cell-fit-unknown-value', 'The fit is fill or natural: another word is refused.', 'stretch', 'cellFit');
refuseTint('tile-ink-cell-fit-not-text', 'The fit is a word, never a number.', 1, 'cellFit');
reject('tile-ink-cell-fit-on-a-navigation-tile', 'Only a state tile has the fit: another tile refuses the field.', ['tile-ink'],
  [{ ...tileOf(STANDARD)[0], cellFit: 'natural' }]);
reject('tile-ink-fill-ink-unknown-value', 'The ink is white or soft: another word is refused.', ['tile-ink'], [tileOfStyle()], inked(solid(120, 90, 160), 'black'));
reject('tile-ink-fill-ink-percent-spelling', 'The ink is a word, never a percentage.', ['tile-ink'], [tileOfStyle()], inked(solid(120, 90, 160), 'white-92'));
reject('tile-ink-fill-ink-without-fill', 'The ink belongs to a fill: a state with no fill refuses it.', ['tile-ink'], [tileOfStyle()], inked(undefined, 'soft'));
reject('tile-ink-fill-ink-fallback-without-fill', 'The fallback is a state too: an ink without its fill is refused there.', ['tile-ink'], [tileOfStyle()], inked(solid(1, 2, 3), 'soft', { fillInk: 'soft' }));

// MARK: Surface orientation and controls (vacuum-map-ctl): `sh.surface-orientation@1`, `sh.surface-controls@1`.
/** A vacuum source with everything its descriptor requires, and an area-cleaning script so `cleanArea` has somewhere to go. */
const robotSource = (extra: J = {}): J => ({ id: 'robot-src', kind: 'model', model: 'vacuum@1', inputs: {
  title: 'Demo Robot', entityId: 'vacuum.demo_robot', batteryEntityId: 'sensor.demo_battery', cleanScript: 'script.demo_clean', errorEntityId: 'sensor.demo_error',
  passesEntityId: 'input_select.demo_passes', statusEntityId: 'sensor.demo_status', statusFlagEntityId: 'input_text.demo_flag', vacuumMapId: 'demo_robot', mapRoomSelection: true,
  mapRotationDegrees: 0, mapScale: 1, areaCleaning: { minimumSizeCm: 50, script: 'script.demo_area' }, consumables: [], autoCleanDisabledRooms: [], outcomeRoomNames: [],
  outcomeReconciliations: [], zoneDescription: [], zones: [], ...extra } });
const mapOf = (controls?: J[], locate = false, extra: J = {}): J[] => [node('map', 'vacuum-control', { props: { sourceId: 'robot-src', primitive: {
  kind: 'map', overlay: 'rooms', height: 300, runtimeHeight: 400, label: 'Demo map', loadingText: 'Loading', unavailableText: 'Unavailable', locate, ...(controls ? { controls } : {}), ...extra } } })];
const withRobot = (extra: J = {}) => (envelope: J) => { envelope.document.dataSources.push(robotSource(extra)); };
const button = (id: string, name: string, action: J, rest: J = {}): J => ({ id, icon: symbolOf('star'), label: name, action, ...rest });
const locateAction: J = { type: 'map', command: 'locate' };
const locateBtn: J = button('locate', 'Locate', locateAction, { icon: symbolOf('scope'), hint: 'Asks the robot to play a sound.' });
const toggleAction: J = { type: 'call-service', domain: 'light', service: 'toggle', target: { entity_id: lit('light.demo_kitchen') } };
const dockAction: J = { type: 'source-command', command: 'dock' };
const pushAction: J = { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' };
const group = (corner: string, axis: string, buttons: J[]): J => ({ corner, axis, buttons });
const flipped = (flipHorizontal: boolean, flipVertical: boolean) => withRobot({ orientation: { flipHorizontal, flipVertical } });
accept('pending-surface-orientation-flip-horizontal', 'A vacuum map mirrored left to right.', ['surface-orientation'], mapOf(undefined, true), flipped(true, false));
accept('pending-surface-orientation-flip-vertical', 'A vacuum map mirrored top to bottom.', ['surface-orientation'], mapOf(undefined, true), flipped(false, true));
accept('pending-surface-orientation-both', 'Both flips: the owner\'s "invert".', ['surface-orientation'], mapOf(undefined, true), flipped(true, true));
accept('pending-surface-orientation-both-off', 'An orientation object with both flips off still declares the id: it is authored.', ['surface-orientation'], mapOf(undefined, true), flipped(false, false));
accept('pending-surface-orientation-with-rotation', 'A flip beside a rotation: the flip mirrors the rotated picture on screen.', ['surface-orientation'], mapOf(undefined, true), withRobot({ mapRotationDegrees: 90, orientation: { flipHorizontal: true, flipVertical: false } }));
reject('surface-orientation-missing-vertical', 'Both flips are written.', ['surface-orientation'], mapOf(undefined, true), withRobot({ orientation: { flipHorizontal: true } }));
reject('surface-orientation-not-boolean', 'A flip is true or false, never text.', ['surface-orientation'], mapOf(undefined, true), withRobot({ orientation: { flipHorizontal: 'yes', flipVertical: false } }));
reject('surface-orientation-extra-field', 'The orientation has two flips: a rotation belongs to the source\'s own mapRotationDegrees.', ['surface-orientation'], mapOf(undefined, true), withRobot({ orientation: { flipHorizontal: false, flipVertical: false, rotation: 90 } }));
accept('pending-surface-controls-locate-explicit', 'Locate authored in its own corner: `locate` is true because a Locate button exists.', ['surface-controls'], mapOf([group('top-leading', 'column', [locateBtn])], true), withRobot());
accept('pending-surface-controls-row-of-three-top-trailing', 'A row of three at top trailing: Locate, a light and a page.', ['surface-controls'],
  mapOf([group('top-trailing', 'row', [locateBtn, button('lights', 'Kitchen Lights', toggleAction), button('plan', 'Floor Plan', pushAction)])], true), withRobot());
accept('pending-surface-controls-column-of-two-bottom-leading', 'A column of two at bottom leading, and no Locate: `locate` is false.', ['surface-controls'],
  mapOf([group('bottom-leading', 'column', [button('dock', 'Dock', dockAction, { icon: symbolOf('house') }), button('lights', 'Kitchen Lights', toggleAction)])], false), withRobot());
accept('pending-surface-controls-each-corner', 'One group in each of the four corners, rows and columns.', ['surface-controls'],
  mapOf([group('top-leading', 'column', [locateBtn]), group('top-trailing', 'row', [button('a', 'A', toggleAction), button('b', 'B', toggleAction)]),
    group('bottom-leading', 'column', [button('c', 'C', toggleAction), button('d', 'D', toggleAction)]), group('bottom-trailing', 'row', [button('e', 'E', pushAction)])], true), withRobot());
accept('pending-surface-controls-mixed-actions', 'A map action, a source command, a service call and a page in one corner: the source command also needs the vacuum controls id.', ['surface-controls'],
  mapOf([group('top-trailing', 'row', [locateBtn, button('dock', 'Dock', dockAction), button('pause', 'Pause', { type: 'source-command', command: 'pause' }), button('lights', 'Kitchen Lights', toggleAction), button('plan', 'Floor Plan', pushAction)])], true), withRobot());
accept('pending-surface-controls-more-sized', 'Eight buttons in one row, the most a group holds: the app puts what does not fit behind More.', ['surface-controls'],
  mapOf([group('top-trailing', 'row', Array.from({ length: 8 }, (_, index) => button(`b${index}`, `Button ${index + 1}`, toggleAction)))], false), withRobot());
accept('pending-surface-controls-rules', 'A service button whose symbol and label follow a rule, shown and enabled by a condition (`sh.tile-disc-rules@1`, `sh.visible-when@1`, `sh.enabled-when@1`).', ['surface-controls', 'conditions', 'rules'],
  mapOf([group('bottom-trailing', 'row', [button('lights', { type: 'expr', value: choose([[hot, lit('Cool Down')]], lit('Warm Up')) }, toggleAction, {
    icon: conditionalOf([[hot, symbolOf('snowflake')]], symbolOf('flame')), visibleWhen: hot, whenUnknown: 'hide', enabledWhen: { condition: hot, whenUnknown: 'disabled' } })])], false), withRobot());
const refuse = (name: string, note: string, controls: J[], locate = false, extra: J = {}) => reject(`surface-controls-${name}`, note, ['surface-controls'], mapOf(controls, locate, extra), withRobot());
refuse('two-groups-one-corner', 'One group for each corner.', [group('top-leading', 'row', [button('a', 'A', toggleAction)]), group('top-leading', 'column', [button('b', 'B', toggleAction)])]);
refuse('empty-group', 'A group holds at least one button.', [group('top-leading', 'row', [])]);
refuse('nine-buttons', 'A group holds at most eight buttons.', [group('top-leading', 'row', Array.from({ length: 9 }, (_, index) => button(`b${index}`, `B${index}`, toggleAction)))]);
refuse('five-groups', 'There are four corners: more than four groups is refused.', [...['top-leading', 'top-trailing', 'bottom-leading', 'bottom-trailing', 'top-leading'].map((corner, index) => group(corner, 'row', [button(`b${index}`, 'B', toggleAction)]))]);
refuse('duplicate-id', 'Ids are unique across the whole surface, not only in one group.', [group('top-leading', 'row', [button('a', 'A', toggleAction)]), group('top-trailing', 'row', [button('a', 'B', toggleAction)])]);
refuse('missing-label', 'A button has a label: VoiceOver and Voice Control read it.', [group('top-leading', 'row', [{ id: 'a', icon: symbolOf('star'), action: toggleAction }])]);
refuse('blank-label', 'A blank label is no label.', [group('top-leading', 'row', [button('a', '   ', toggleAction)])]);
refuse('missing-icon', 'A button has a symbol.', [group('top-leading', 'row', [{ id: 'a', label: 'A', action: toggleAction }])]);
refuse('unknown-corner', 'The corners are the four named ones: there is no centre.', [group('center', 'row', [button('a', 'A', toggleAction)])]);
refuse('unknown-axis', 'A group is a row or a column.', [group('top-leading', 'grid', [button('a', 'A', toggleAction)])]);
refuse('extra-button-field', 'A button has no tint: it is the primary ink on glass.', [group('top-leading', 'row', [button('a', 'A', toggleAction, { tint: 'red' })])]);
refuse('locate-twice', 'Locate is on the map once.', [group('top-leading', 'row', [locateBtn, button('again', 'Locate Again', locateAction)])], true);
refuse('locate-flag-false-with-locate-button', '`locate` states whether a Locate button is authored: false beside one is refused.', [group('top-leading', 'row', [locateBtn])], false);
refuse('locate-flag-true-without-locate-button', '`locate` true with controls that hold no Locate button is refused.', [group('top-leading', 'row', [button('a', 'A', toggleAction)])], true);
refuse('unknown-map-command', 'A map action is one the surface supports: Locate.', [group('top-leading', 'row', [button('a', 'A', { type: 'map', command: 'fit' })])]);
refuse('unknown-source-command', 'A source command is one of the vacuum\'s commands.', [group('top-leading', 'row', [button('a', 'A', { type: 'source-command', command: 'selfDestruct' })])]);
reject('surface-controls-clean-area-without-area-cleaning', 'Clean Area needs the vacuum\'s area cleaning script.', ['surface-controls'],
  mapOf([group('top-leading', 'row', [button('a', 'Clean Area', { type: 'source-command', command: 'cleanArea' })])], false), withRobot({ areaCleaning: undefined }));
refuse('source-command-visible-when', 'A source command is shown by the vacuum\'s own state rules: `visibleWhen` is refused.', [group('top-leading', 'row', [button('a', 'Dock', dockAction, { visibleWhen: hot })])]);
refuse('source-command-enabled-when', 'A source command is enabled by the vacuum\'s own state rules: `enabledWhen` is refused.', [group('top-leading', 'row', [button('a', 'Dock', dockAction, { enabledWhen: { condition: hot, whenUnknown: 'disabled' } })])]);
refuse('locate-visible-when', 'Locate hides while the robot is unavailable, by itself: `visibleWhen` is refused.', [group('top-leading', 'row', [{ ...locateBtn, visibleWhen: hot }])], true);
refuse('when-unknown-without-visible-when', 'A policy for an unknown condition means nothing without the condition.', [group('top-leading', 'row', [button('a', 'A', toggleAction, { whenUnknown: 'hide' })])]);
refuse('present-replace', 'A presented sheet is rejected when already shown, never replaced.', [group('top-leading', 'row', [button('a', 'A', { type: 'present', modalId: 'modal-lattice', arguments: {}, ifPresented: 'replace' })])]);
refuse('power-toggle-action', 'A button takes a map action, a source command, a service call or navigation: not a power toggle.', [group('top-leading', 'row', [button('a', 'A', { type: 'domain', sourceId: 'lights', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } })])]);
refuse('set-local-action', 'A button does not set local state.', [group('top-leading', 'row', [button('a', 'A', { type: 'set-local', stateId: 'x', value: { type: 'boolean', value: true } })])]);
refuse('unknown-page', 'A page a button opens exists.', [group('top-leading', 'row', [button('a', 'A', { ...pushAction, pageId: 'page-missing' })])]);
reject('surface-controls-locate-on-a-non-vacuum-source', 'A map action needs a vacuum source: a map over any other source is refused.', ['surface-controls'], mapOf([group('top-leading', 'row', [locateBtn])], true),
  envelope => { envelope.document.dataSources.push({ id: 'robot-src', kind: 'ha-entity', entityId: lit('fan.demo_bath_fan') }); });

// MARK: List read (A1)
accept('pending-list-read-count', 'A node shown only when an entity offers more than one preset: the count of an attribute list.', ['list-read', 'conditions'],
  when(cmp('above', listCount('guest-fan', ['attributes', 'preset_modes']), lit(1))));
accept('pending-list-read-includes', 'A node shown only when the entity offers a preset: an attribute list includes a value.', ['list-read', 'conditions'],
  when(cmp('eq', listIncludes('guest-fan', ['attributes', 'preset_modes'], lit('auto')), lit(true))));
accept('pending-list-read-text', 'A text that counts the modes an entity offers.', ['list-read'],
  exprText(fmt('{n} modes', { n: listCount('guest-fan', ['attributes', 'preset_modes']) })));
reject('list-read-state-path', 'A list read names an attribute: the state is not a list.', ['list-read'], exprText(fmt('{n}', { n: listCount('guest-fan', ['state']) })));
reject('list-read-attribute-needs-name', 'A list read names one attribute, not all of them.', ['list-read'], exprText(fmt('{n}', { n: listCount('guest-fan', ['attributes']) })));
reject('list-read-model-source', 'A list read stands on an entity: a model source is refused.', ['list-read'], exprText(fmt('{n}', { n: listCount('lights', ['attributes', 'modes']) })));
reject('list-read-unknown-source', 'The source must be declared.', ['list-read'], exprText(fmt('{n}', { n: listCount('nothing', ['attributes', 'modes']) })));
reject('list-read-includes-structure', 'The item asked for is one value: a list is refused.', ['list-read'], when(cmp('eq', listIncludes('guest-fan', ['attributes', 'preset_modes'], lit(['auto'])), lit(true))));
reject('list-read-includes-without-value', 'includes needs the value to look for.', ['list-read'],
  exprText(fmt('{n}', { n: { type: 'list-includes', from: { type: 'source', sourceId: 'guest-fan', path: ['attributes', 'preset_modes'] } } })));
reject('list-read-count-with-value', 'count takes no value.', ['list-read'],
  exprText(fmt('{n}', { n: { type: 'list-count', from: { type: 'source', sourceId: 'guest-fan', path: ['attributes', 'preset_modes'] }, value: lit('auto') } })));
reject('list-read-compared-with-text', 'The count is a number: comparing it with text is refused.', ['list-read', 'conditions'], when(cmp('eq', listCount('guest-fan', ['attributes', 'preset_modes']), lit('two'))));

// MARK: Raw state (A2)
accept('pending-raw-state-text', 'A text that tells an entity that is unknown from one that is unavailable.', ['raw-state', 'rules', 'conditions'],
  exprText(choose([[cmp('eq', rawState('temp'), lit('unavailable')), lit('Unavailable')], [cmp('eq', rawState('temp'), lit('unknown')), lit('Unknown')]], fmt('{t} degrees', { t: rawState('temp') }))));
accept('pending-raw-state-condition', 'A node shown only while an entity is not unavailable: the raw state against the word.', ['raw-state', 'conditions'],
  when(cmp('ne', rawState('temp'), lit('unavailable'))));
reject('raw-state-model-source', 'A raw state read stands on an entity: a model source is refused.', ['raw-state'], exprText(rawState('lights')));
reject('raw-state-unknown-source', 'The source must be declared.', ['raw-state'], exprText(rawState('nothing')));
reject('raw-state-compared-with-number', 'The raw state is text: comparing it with a number is refused.', ['raw-state', 'conditions'], when(cmp('eq', rawState('temp'), lit(3))));
reject('raw-state-with-path', 'A raw state read has a source and nothing else.', ['raw-state'], exprText({ type: 'raw-state', sourceId: 'temp', path: ['state'] }));

// MARK: Evaluation
/**
 * `env.raw` maps a source id to what `readRaw` gives (`{status: 'value', value: 'unknown'}` and so on); a source that is not listed has no entity, so it is
 * unavailable. `env.reads` is the plain read, which the native host answers `unavailable` for an unknown or unavailable entity: the pair of cases below
 * pins that `raw-state` is how a rule tells the two apart.
 */
export const grammar2Evaluations: Grammar2Evaluation[] = [];
const evaluation = (name: string, note: string, subject: J, expected: J, env: J = {}) => grammar2Evaluations.push({ name, note, subject, env, expected });
const operand = (name: string, note: string, subject: J, expected: J, env: J = {}) => evaluation(name, note, { operand: subject }, expected, env);
const condition = (name: string, note: string, subject: J, expected: 'yes' | 'no' | 'unknown', env: J = {}) => evaluation(name, note, { condition: subject }, { tri: expected }, env);
const value$ = (v: unknown): J => ({ status: 'value', value: v });
const LOADING: J = { status: 'loading' }, UNAVAILABLE: J = { status: 'unavailable' };
const reads = (map: Record<string, J>): J => ({ reads: map });
const raw = (map: Record<string, J>): J => ({ raw: map });
const modes = ['heat', 'cool', 'heat_cool', 'off'];
const number = (n: number, formats: J, pattern = '{n}'): J => fmt(pattern, { n: lit(n) }, { n: formats });

// N1. The expected text is what C's printf("%.Nf") prints for the double, then trailing zeros are dropped down to the minimum.
operand('format-fixed-digits-whole-keeps-zero', 'A whole number with a minimum of one fraction digit keeps its zero: 72 is "72.0".', number(72, digits(1, 1)), value$('72.0'));
operand('format-fixed-digits-pads-to-minimum', 'The minimum pads: 72.5 with two is "72.50".', number(72.5, digits(2, 2)), value$('72.50'));
operand('format-fixed-digits-minimum-below-maximum', 'Between the two, zeros are trimmed down to the minimum: 72.5 with at most 3 and at least 1 is "72.5", and 72 is "72.0".', fmt('{a} {b}', { a: lit(72.5), b: lit(72) }, { a: digits(3, 1), b: digits(3, 1) }), value$('72.5 72.0'));
operand('format-fixed-digits-rounds', '72.26 with one fraction digit is "72.3".', number(72.26, digits(1, 1)), value$('72.3'));
operand('format-fixed-digits-tie-goes-even', '0.125 is exactly halfway: two fraction digits give the even "0.12", as printf does.', number(0.125, digits(2, 2)), value$('0.12'));
operand('format-fixed-digits-negative-zero', 'A result that rounds to zero has no sign: -0.04 with one digit is "0.0".', number(-0.04, digits(1, 1)), value$('0.0'));
operand('format-fixed-digits-negative', 'A negative number keeps its sign: -3 with one digit is "-3.0".', number(-3, digits(1, 1)), value$('-3.0'));
operand('format-fixed-digits-zero-minimum-trims', 'A minimum of 0 is the old format: 2.5 with at most 2 is "2.5".', number(2.5, digits(2, 0)), value$('2.5'));
operand('format-fixed-digits-zero-places', 'No fraction digits at all: 72.4 with 0 and 0 is "72".', number(72.4, digits(0, 0)), value$('72'));
operand('format-fixed-digits-in-a-sentence', 'A read as a number from a state text, in a sentence: "68" is "68.0°F".', fmt('{t}°F', { t: read('temp', ['state'], 'number') }, { t: digits(1, 1) }), value$('68.0°F'), reads({ 'temp/state': value$('68') }));
operand('format-fixed-digits-unavailable', 'An unavailable argument makes the format unavailable.', fmt('{t}°F', { t: read('temp', ['state'], 'number') }, { t: digits(1, 1) }), UNAVAILABLE);
operand('format-fixed-digits-loading', 'A loading argument makes the format loading.', fmt('{t}°F', { t: read('temp', ['state'], 'number') }, { t: digits(1, 1) }), LOADING, reads({ 'temp/state': LOADING }));
operand('format-fixed-digits-text-is-not-a-number', 'Text that is not a number is drawn as it is.', fmt('{t}', { t: lit('warm') }, { t: digits(1, 1) }), value$('warm'));

// T1. Only `_` separates words, the first character of a word is upper-cased when it is an ASCII letter, the rest stays, the words are joined by one space.
const titled = (text: string | null) => fmt('{m}', { m: text === null ? lit(null) : lit(text) }, { m: title });
operand('format-title-case-state', 'An entity state as words: heat_cool is "Heat Cool".', titled('heat_cool'), value$('Heat Cool'));
operand('format-title-case-one-word', 'One word: "auto" is "Auto".', titled('auto'), value$('Auto'));
operand('format-title-case-keeps-the-rest', 'Only the first character of a word changes: "AUTO" stays "AUTO" and a space does not separate words, so "heat cool" is "Heat cool".', fmt('{a} {b}', { a: lit('AUTO'), b: lit('heat cool') }, { a: title, b: title }), value$('AUTO Heat cool'));
operand('format-title-case-non-ascii-is-left', 'Only an ASCII letter changes, so JavaScript and Swift cannot disagree: "élan_vital" is "élan Vital".', titled('élan_vital'), value$('élan Vital'));
operand('format-title-case-empty-parts', 'Empty parts stay: "a__b" is "A  B" (two spaces) and "_x" is " X".', fmt('{a}|{b}', { a: lit('a__b'), b: lit('_x') }, { a: title, b: title }), value$('A  B| X'));
operand('format-title-case-empty-text', 'Empty text is empty.', titled(''), value$(''));
operand('format-title-case-digit-first', 'A word that starts with a digit is unchanged: "2nd_floor" is "2nd Floor".', titled('2nd_floor'), value$('2nd Floor'));
operand('format-title-case-from-entity', 'Text from an entity.', fmt('Mode: {m}', { m: read('mode', ['state']) }, { m: title }), value$('Mode: Fan Only'), reads({ 'mode/state': value$('fan_only') }));
operand('format-title-case-number-text', 'A number has no letters: the text of the number.', fmt('{m}', { m: lit(72) }, { m: title }), value$('72'));
operand('format-title-case-null-unavailable', 'A null argument has no text: the format is unavailable.', titled(null), UNAVAILABLE);
operand('format-title-case-unavailable', 'An unavailable argument makes the format unavailable.', fmt('{m}', { m: read('mode', ['state']) }, { m: title }), UNAVAILABLE);
// TC4. `words`: a word ends at `_` or at a space (U+0020); the first character is upper-cased when it is an ASCII letter; empty parts stay; the parts are joined by one space.
const worded = (text: string | null) => fmt('{m}', { m: text === null ? lit(null) : lit(text) }, { m: everyWord });
operand('format-words-case-issue-text', 'A vacuum issue as words: "Wheel stuck" is "Wheel Stuck".', worded('Wheel stuck'), value$('Wheel Stuck'));
operand('format-words-case-lower-with-spaces', 'Lower case words: "main brush jammed" is "Main Brush Jammed".', worded('main brush jammed'), value$('Main Brush Jammed'));
operand('format-words-case-underscores', 'An underscore ends a word too: "heat_cool" is "Heat Cool".', worded('heat_cool'), value$('Heat Cool'));
operand('format-words-case-mixed-separators', 'Spaces and underscores together: "side_brush stuck" is "Side Brush Stuck".', worded('side_brush stuck'), value$('Side Brush Stuck'));
operand('format-words-case-keeps-the-rest', 'Only the first character of a word changes: "AUTO mode" is "AUTO Mode" and "iPhone" is "IPhone".', fmt('{a}|{b}', { a: lit('AUTO mode'), b: lit('iPhone') }, { a: everyWord, b: everyWord }), value$('AUTO Mode|IPhone'));
operand('format-words-case-one-word', 'One word: "auto" is "Auto".', worded('auto'), value$('Auto'));
operand('format-words-case-empty-parts', 'Empty parts stay: "a  b" is "A  B" (two spaces), "_x" is " X" and a trailing space stays.', fmt('{a}|{b}|{c}', { a: lit('a  b'), b: lit('_x'), c: lit('x ') }, { a: everyWord, b: everyWord, c: everyWord }), value$('A  B| X|X '));
operand('format-words-case-empty-text', 'Empty text is empty.', worded(''), value$(''));
operand('format-words-case-non-ascii-is-left', 'Only an ASCII letter changes, so JavaScript and Swift cannot disagree: "élan vital" is "élan Vital".', worded('élan vital'), value$('élan Vital'));
operand('format-words-case-digit-first', 'A word that starts with a digit is unchanged: "2nd floor" is "2nd Floor".', worded('2nd floor'), value$('2nd Floor'));
operand('format-words-case-other-whitespace-is-not-a-separator', 'Only U+0020 separates: a tab or a newline stays inside its word, so "a\tb\nc d" is "A\tb\nc D".', worded('a\tb\nc d'), value$('A\tb\nc D'));
operand('format-words-case-from-entity', 'Text from an entity attribute.', fmt('Issue: {m}', { m: read('robot', ['attributes', 'issue']) }, { m: everyWord }), value$('Issue: Wheel Stuck'), reads({ 'robot/attributes/issue': value$('Wheel stuck') }));
operand('format-words-case-number-text', 'A number has no letters: the text of the number.', fmt('{m}', { m: lit(72) }, { m: everyWord }), value$('72'));
operand('format-words-case-null-unavailable', 'A null argument has no text: the format is unavailable.', worded(null), UNAVAILABLE);
operand('format-words-case-unavailable', 'An unavailable argument makes the format unavailable.', fmt('{m}', { m: read('robot', ['attributes', 'issue']) }, { m: everyWord }), UNAVAILABLE);
operand('format-words-case-loading', 'A loading argument makes the format loading.', fmt('{m}', { m: read('robot', ['attributes', 'issue']) }, { m: everyWord }), LOADING, reads({ 'robot/attributes/issue': LOADING }));
operand('format-words-case-beside-title-case', 'Both cases in one pattern: title leaves the space, words capitalizes after it.', fmt('{a}|{b}', { a: lit('wheel stuck'), b: lit('wheel stuck') }, { a: title, b: everyWord }), value$('Wheel stuck|Wheel Stuck'));

// A1. A list is an attribute that holds an array; anything else is unavailable.
const modeList = (op: 'count' | 'includes', needle?: J): J => op === 'count' ? listCount('hvac', ['attributes', 'hvac_modes']) : listIncludes('hvac', ['attributes', 'hvac_modes'], needle!);
const hvac = (list: unknown): J => reads({ 'hvac/attributes/hvac_modes': value$(list) });
operand('list-count-items', 'The count of an attribute list: four modes.', modeList('count'), value$(4), hvac(modes));
operand('list-count-empty', 'An empty list has zero items.', modeList('count'), value$(0), hvac([]));
operand('list-count-counts-every-item', 'Every item counts, whatever it is.', modeList('count'), value$(3), hvac(['heat', null, 2]));
operand('list-count-not-a-list', 'An attribute that is not a list is unavailable: text is not a list of one.', modeList('count'), UNAVAILABLE, hvac('heat'));
operand('list-count-missing', 'An attribute the entity does not have is unavailable.', modeList('count'), UNAVAILABLE);
operand('list-count-loading', 'A list that is loading is loading.', modeList('count'), LOADING, reads({ 'hvac/attributes/hvac_modes': LOADING }));
operand('list-includes-yes', 'The list holds the value: true.', modeList('includes', lit('cool')), value$(true), hvac(modes));
operand('list-includes-no', 'The list does not hold the value: false, a value and not unavailable.', modeList('includes', lit('dry')), value$(false), hvac(modes));
operand('list-includes-empty', 'An empty list holds nothing: false.', modeList('includes', lit('cool')), value$(false), hvac([]));
operand('list-includes-number-text', 'Equality is the grammar\'s: the text "2" matches the number 2.', modeList('includes', lit('2')), value$(true), hvac(['1', 2]));
operand('list-includes-nfc', 'Text is equal under NFC: e and U+0301 matches U+00E9.', modeList('includes', lit('é')), value$(true), hvac(['é']));
operand('list-includes-case-matters', 'Text is not folded: "Cool" is not "cool".', modeList('includes', lit('Cool')), value$(false), hvac(modes));
operand('list-includes-skips-structures', 'An item that is a list or an object never matches.', modeList('includes', lit('a')), value$(false), hvac([['a'], { a: 1 }, null]));
operand('list-includes-not-a-list', 'An attribute that is not a list is unavailable.', modeList('includes', lit('cool')), UNAVAILABLE, hvac('cool'));
operand('list-includes-missing', 'An attribute the entity does not have is unavailable.', modeList('includes', lit('cool')), UNAVAILABLE);
operand('list-includes-loading-beats-unavailable', 'loading is reported before unavailable.', modeList('includes', read('want', ['state'])), LOADING, reads({ 'hvac/attributes/hvac_modes': LOADING }));
operand('list-includes-value-unavailable', 'A value that is unavailable makes the answer unavailable.', modeList('includes', read('want', ['state'])), UNAVAILABLE, hvac(modes));
operand('list-includes-null-value', 'null is not a value to look for: unavailable.', modeList('includes', lit(null)), UNAVAILABLE, hvac(modes));
operand('list-includes-value-from-entity', 'The value to look for can be read.', modeList('includes', read('want', ['state'])), value$(true), { reads: { 'hvac/attributes/hvac_modes': value$(modes), 'want/state': value$('heat_cool') } });
condition('list-includes-condition-yes', 'A condition: the list includes the mode.', cmp('eq', modeList('includes', lit('cool')), lit(true)), 'yes', hvac(modes));
condition('list-includes-condition-no', 'A condition: the list does not include the mode.', cmp('eq', modeList('includes', lit('dry')), lit(true)), 'no', hvac(modes));
condition('list-includes-condition-unknown', 'A condition over a list the entity does not have cannot be told: unknown.', cmp('eq', modeList('includes', lit('cool')), lit(true)), 'unknown');
condition('list-count-condition-above', 'A condition: more than one mode.', cmp('above', modeList('count'), lit(1)), 'yes', hvac(modes));
condition('list-count-condition-flow-gap', 'In flow mode a gap is null, so a comparison is no.', cmp('above', modeList('count'), lit(1)), 'no', { flow: true });

// A2. `raw` is what the host gives for the state text; `reads` is the plain read, which says unavailable for an entity that is not available.
const rawRule = choose([[cmp('eq', rawState('sensor'), lit('unavailable')), lit('Unavailable')], [cmp('eq', rawState('sensor'), lit('unknown')), lit('Unknown')]], fmt('{t} degrees', { t: rawState('sensor') }));
operand('raw-state-value', 'A state that is a value is its text.', rawState('sensor'), value$('72.5'), raw({ sensor: value$('72.5') }));
operand('raw-state-unknown-is-text', 'An entity whose state is unknown gives the text "unknown", a value.', rawState('sensor'), value$('unknown'), raw({ sensor: value$('unknown') }));
operand('raw-state-unavailable-is-text', 'An entity whose state is unavailable gives the text "unavailable", a value, not the status.', rawState('sensor'), value$('unavailable'), raw({ sensor: value$('unavailable') }));
operand('raw-state-no-entity-is-unavailable', 'A source that has no entity is unavailable, the one case that is.', rawState('sensor'), UNAVAILABLE);
operand('raw-state-loading', 'Before the first states arrive the read is loading.', rawState('sensor'), LOADING, raw({ sensor: LOADING }));
operand('raw-state-plain-read-cannot-tell', 'The plain read of the same unknown entity is unavailable (native): this is why raw-state exists.', read('sensor', ['state']), UNAVAILABLE, { ...reads({}), ...raw({ sensor: value$('unknown') }) });
operand('raw-state-rule-tells-unavailable', 'A rule tells unavailable: "Unavailable".', rawRule, value$('Unavailable'), raw({ sensor: value$('unavailable') }));
operand('raw-state-rule-tells-unknown', 'A rule tells unknown from unavailable: "Unknown".', rawRule, value$('Unknown'), raw({ sensor: value$('unknown') }));
operand('raw-state-rule-reads-a-value', 'A rule falls through to the value: "72.5 degrees".', rawRule, value$('72.5 degrees'), raw({ sensor: value$('72.5') }));
operand('raw-state-rule-loading-keeps', 'A rule that cannot be answered yet is loading, so the slot keeps what it showed.', rawRule, LOADING, raw({ sensor: LOADING }));
operand('raw-state-rule-no-entity', 'With no entity the rule cannot be answered: loading.', rawRule, LOADING);
operand('raw-state-in-flow-is-null', 'A flow has no raw reads: a gap is null.', rawState('sensor'), value$(null), { flow: true, ...raw({ sensor: value$('on') }) });
condition('raw-state-is-unknown-yes', 'A condition: the state is "unknown".', cmp('eq', rawState('sensor'), lit('unknown')), 'yes', raw({ sensor: value$('unknown') }));
condition('raw-state-is-unknown-no-for-unavailable', 'Unavailable is not unknown: no.', cmp('eq', rawState('sensor'), lit('unknown')), 'no', raw({ sensor: value$('unavailable') }));
condition('raw-state-not-unavailable', 'A condition that holds for an entity that is anything but unavailable.', cmp('ne', rawState('sensor'), lit('unavailable')), 'yes', raw({ sensor: value$('unknown') }));
condition('raw-state-in-either', 'A condition that holds for either word.', { type: 'in', value: rawState('sensor'), in: [lit('unknown'), lit('unavailable')] }, 'yes', raw({ sensor: value$('unavailable') }));
condition('raw-state-no-entity-is-unknown', 'A source with no entity makes a comparison unknown.', cmp('eq', rawState('sensor'), lit('unknown')), 'unknown');