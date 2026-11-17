/**
 * Writes the `parts-*` cases of the shared publication corpus (TC3): the generic part extensions the vacuum and climate atoms are rebuilt from, each
 * under its own pending capability so native can take them one at a time.
 *
 *   tsx scripts/generate-parts-corpus.ts   # rewrites contract/corpus/{accept,reject}/(pending-)parts-*.json and their index entries
 *
 * | Family | Capability | What it adds |
 * | --- | --- | --- |
 * | `options` | `sh.bound-options-read@1` (+ `sh.list-read@1`) | a choice's options read from an entity's list attribute, the authored ones as the fallback |
 * | `disc` | `sh.tile-disc-rules@1` | a tile button's symbol by rule or entity, its label by rule or expression, and a label that names the tile |
 * | `columns` | `sh.grid-min-columns@1` | a tile grid that keeps at least two columns |
 * | `row` | `sh.bound-row-parts@1` | a toggle row's subtitle, glyph tint, hint, metrics and failure caption |
 * | `check` | `sh.check-face@1` | a toggle drawn as a check row |
 *
 * All five ids are shipped, so accepted cases are `accept/parts-*` and a refused case is `reject/parts-*`, recording the Studio's first issue. Where each
 * file lands comes from `corpus-handshake.ts`. Run `scripts/app-corpus-check/run.sh` afterwards: the app must agree with every case. This file owns
 * only `parts-*` and `pending-parts-*`.
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { placeCase, shippedCapabilities, shippedIssue } from './corpus-handshake';

type J = Record<string, any>;
const root = path.resolve(import.meta.dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(root, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const PAGE = 2;
const PREFIX = 'parts-';

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const is = (sourceId: string, ...states: string[]): J => ({ type: 'state', sourceId, path: ['state'], in: states });
const rgb = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const node = (id: string, type: string, rest: J = {}): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const service = (domain: string, name: string, rest: J = {}): J => ({ type: 'call-service', domain, service: name, feedback: 'policy', ...rest });
const target = (entity: string): J => ({ entity_id: lit(entity) });

// Sources every case gets: a robot (a vacuum), a speed select that lists its options, an auto-clean switch and a room switch.
const sources: J[] = [
  { id: 'robot', kind: 'ha-entity', entityId: lit('vacuum.demo_robot') },
  { id: 'speed', kind: 'ha-entity', entityId: lit('select.demo_fan_speed') },
  { id: 'auto-clean', kind: 'ha-entity', entityId: lit('input_boolean.demo_auto_clean') },
  { id: 'room', kind: 'ha-entity', entityId: lit('input_boolean.demo_room') },
  { id: 'dock', kind: 'model', model: 'home-status@1', inputs: { projection: 'lights', format: 'summary', entityIds: [lit('light.demo_study')], awayEntityIds: [] },
    labels: { idle: 'All Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'No lights', hidden: 'Hidden' } },
];

// Options
const speedOptions = (rest: J = {}): J => ({
  from: { type: 'source', sourceId: 'speed', path: ['attributes', 'options'] }, current: read('speed', ['state']), labels: 'title-case',
  action: service('select', 'select_option', { target: target('select.demo_fan_speed'), data: { type: 'object', fields: { option: { type: 'control' } } } }),
  ...rest,
});
const fallbackOptions = (): J[] => ['quiet', 'standard'].map(id => ({ id, label: id === 'quiet' ? 'Quiet' : 'Standard', selectedWhen: is('speed', id),
  action: service('select', 'select_option', { target: target('select.demo_fan_speed'), data: { type: 'object', fields: { option: lit(id) } } }) }));
const choice = (props: J = {}, rest: J = {}): J => node('speed-choice', 'bound-control', { props: { kind: 'choice', options: fallbackOptions(), unavailableText: 'Unavailable', ...props }, ...rest });

// Discs
const robotTile = (props: J = {}, rest: J = {}): J => node('main-floor', 'state-tile', {
  title: 'Main Floor', icon: symbol('fan'), binding: { entityId: 'vacuum.demo_robot', builtIn: 'robot' }, props, ...rest,
});
const startPause = (rest: J = {}): J => ({
  id: 'start-pause', icon: symbol('play.fill'), label: 'Start',
  action: service('vacuum', 'start', { target: target('vacuum.demo_robot') }), ...rest,
});
const pauseWhileCleaning: J = { type: 'conditional', cases: [{ when: is('robot', 'cleaning', 'returning'), then: symbol('pause.fill') }], otherwise: symbol('play.fill') };
const verbByState: J = { type: 'expr', value: { type: 'choose', otherwise: lit('Start'),
  cases: [{ when: is('robot', 'cleaning', 'returning'), then: lit('Pause') }, { when: is('robot', 'paused'), then: lit('Resume') }] } };

// Grid
const grid = (props: J = {}, children: J[] = [robotTile({ discs: [startPause()] }), robotTile({ discs: [startPause()] }, { id: 'upstairs', title: 'Upstairs' })]): J =>
  node('robots', 'tile-grid', { props: { minimum: 'tile@1', maxColumns: 4, spacing: { type: 'token', name: 'm' }, equalRowHeights: true, shortRow: 'share', fold: 'page', ...props }, children });

// Rows
const autoClean = (props: J = {}, rest: J = {}): J => node('auto-clean-row', 'bound-control', {
  title: 'Auto-Clean', icon: symbol('clock.arrow.circlepath'),
  props: { kind: 'toggle', isOn: is('auto-clean', 'on'), unavailableText: 'Unavailable', ...props },
  onAction: service('input_boolean', 'toggle', { target: target('input_boolean.demo_auto_clean') }),
  offAction: service('input_boolean', 'toggle', { target: target('input_boolean.demo_auto_clean') }), ...rest,
});
const checkRow = (props: J = {}, rest: J = {}): J => node('room-check', 'bound-control', {
  title: 'Master Bedroom',
  props: { kind: 'toggle', isOn: is('room', 'on'), unavailableText: 'Unavailable', face: 'check', ...props },
  onAction: service('homeassistant', 'toggle', { target: target('input_boolean.demo_room') }),
  offAction: service('homeassistant', 'toggle', { target: target('input_boolean.demo_room') }), ...rest,
});
const withoutIcon = (item: J): J => { const { icon: _icon, ...rest } = item; return rest; };
const subtitleByState: J = { type: 'expr', fallback: 'Unavailable', value: { type: 'choose', otherwise: lit('Off'), cases: [{ when: is('auto-clean', 'on'), then: lit('Paused') }] } };

// MARK: Cases
interface Case { name: string; family: string; outcome: 'accept' | 'reject'; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[] }
const cases: Case[] = [];
const NEED = { options: ['sh.bound-options-read@1', 'sh.list-read@1'], disc: ['sh.tile-disc-rules@1'], columns: ['sh.grid-min-columns@1'], row: ['sh.bound-row-parts@1'], check: ['sh.check-face@1'] };
const make = (outcome: Case['outcome'], family: keyof typeof NEED) => (name: string, note: string, components: J[], tweak?: Case['tweak']) =>
  cases.push({ name: `${PREFIX}${family}-${name}`, family, outcome, note, components, tweak, needs: NEED[family] });
const [okOptions, noOptions] = [make('accept', 'options'), make('reject', 'options')];
const [okDisc, noDisc] = [make('accept', 'disc'), make('reject', 'disc')];
const [okColumns, noColumns] = [make('accept', 'columns'), make('reject', 'columns')];
const [okRow, noRow] = [make('accept', 'row'), make('reject', 'row')];
const [okCheck, noCheck] = [make('accept', 'check'), make('reject', 'check')];

// Options (a)
okOptions('from-attribute', 'A choice whose options are the items of a select entity\'s `options` attribute, drawn in title case, with two authored options as the fallback.',
  [choice({ optionsFrom: speedOptions() })]);
okOptions('as-is-labels', 'The items are drawn as the entity holds them.', [choice({ optionsFrom: speedOptions({ labels: 'as-is' }) })]);
okOptions('current-by-expression', 'The option that is chosen is the one equal to what an expression gives: here a format of the select\'s state.',
  [choice({ optionsFrom: speedOptions({ current: { type: 'format', pattern: '{s}', args: { s: read('speed', ['state']) } } }) })]);
noOptions('on-a-toggle', 'Only a choice reads its options from an entity.', [autoClean({ optionsFrom: speedOptions() })]);
noOptions('without-fallback-options', 'The authored options stay required: they are what the choice offers while the list is missing.', [choice({ optionsFrom: speedOptions(), options: undefined })]);
noOptions('from-the-state', 'A list read names an attribute: the state is not a list.', [choice({ optionsFrom: speedOptions({ from: { type: 'source', sourceId: 'speed', path: ['state'] } }) })]);
noOptions('from-a-model-source', 'A list read stands on an entity: a model source is refused.', [choice({ optionsFrom: speedOptions({ from: { type: 'source', sourceId: 'dock', path: ['attributes', 'options'] } }) })]);
noOptions('from-an-unknown-source', 'The source must be declared.', [choice({ optionsFrom: speedOptions({ from: { type: 'source', sourceId: 'nothing', path: ['attributes', 'options'] } }) })]);
noOptions('current-is-a-number', 'The chosen value is text: a number read is refused.', [choice({ optionsFrom: speedOptions({ current: read('speed', ['attributes', 'step'], 'number') }) })]);
noOptions('labels-not-in-list', 'The label style is as-is or title-case.', [choice({ optionsFrom: speedOptions({ labels: 'upper' }) })]);
noOptions('action-is-not-a-call', 'Choosing an option calls a service.', [choice({ optionsFrom: speedOptions({ action: { type: 'back' } }) })]);
noOptions('without-action', 'What choosing an option does is required.', [choice({ optionsFrom: speedOptions({ action: undefined }) })]);
noOptions('extra-field', 'The options read takes the fields of its schema and no others.', [choice({ optionsFrom: speedOptions({ sort: 'ascending' }) })]);

// Discs (b)
okDisc('conditional-symbol', 'A start and pause button that shows pause while the robot cleans and play otherwise.', [robotTile({ discs: [startPause({ icon: pauseWhileCleaning })] })]);
okDisc('label-by-expression', 'A label that follows the robot\'s state: Pause, Resume or Start.', [robotTile({ discs: [startPause({ label: verbByState })] })]);
okDisc('label-names-tile', 'A label that VoiceOver reads with the tile\'s title after it: "Start Main Floor".', [robotTile({ discs: [startPause({ namesTile: true })] })]);
okDisc('all-three', 'Symbol by rule, label by expression and the tile\'s title together, on two buttons.', [robotTile({ discs: [
  startPause({ icon: pauseWhileCleaning, label: verbByState, namesTile: true }),
  { id: 'dock', icon: symbol('house.fill'), label: 'Dock', namesTile: true, action: service('vacuum', 'return_to_base', { target: target('vacuum.demo_robot') }) }] })]);
okDisc('symbol-from-entity', 'The symbol is named by an entity\'s text, with a fallback.', [robotTile({ discs: [startPause({
  icon: { type: 'bound-symbol', value: read('robot', ['attributes', 'button_icon']), fallback: symbol('play.fill') } })] })]);
okDisc('label-object-literal', 'A label may be a text slot holding plain words.', [robotTile({ discs: [startPause({ label: lit('Start') })] })]);
noDisc('label-blank', 'A label is never blank, even as a text slot.', [robotTile({ discs: [startPause({ label: lit('  ') })] })]);
noDisc('label-too-long', 'A label is at most 80 characters, even as a text slot.', [robotTile({ discs: [startPause({ label: lit('x'.repeat(81)) })] })]);
noDisc('label-is-a-structure', 'A label expression gives text: a structure is refused.', [robotTile({ discs: [startPause({ label: { type: 'expr', value: { type: 'object', fields: { a: lit('x') } } } })] })]);
noDisc('names-tile-not-a-boolean', 'Naming the tile is a yes or no.', [robotTile({ discs: [startPause({ namesTile: 'yes' })] })]);
noDisc('symbol-rule-without-otherwise', 'A rule ends with its fallback symbol.', [robotTile({ discs: [startPause({ icon: { type: 'conditional', cases: [{ when: is('robot', 'cleaning'), then: symbol('pause.fill') }] } })] })]);
noDisc('symbol-rule-unknown-source', 'A rule\'s condition reads a declared source.', [robotTile({ discs: [startPause({
  icon: { ...pauseWhileCleaning, cases: [{ when: is('nothing', 'cleaning'), then: symbol('pause.fill') }] } })] })]);
noDisc('bound-symbol-gives-a-number', 'An entity names a symbol with text: a number read is refused.', [robotTile({ discs: [startPause({
  icon: { type: 'bound-symbol', value: read('robot', ['attributes', 'battery_level'], 'number'), fallback: symbol('play.fill') } })] })]);
noDisc('label-read-unknown-source', 'A label read names a declared source.', [robotTile({ discs: [startPause({ label: { type: 'read', from: { type: 'source', sourceId: 'nothing', path: ['state'] }, as: 'string', missing: 'unavailable' } })] })]);

// Columns (c)
okColumns('two-robots-across', 'Two robot tiles with buttons in a four-column grid that keeps at least two columns, so a narrow phone draws them side by side.', [grid({ minimumColumns: 2 })]);
okColumns('equal-to-the-most', 'The floor may equal the most columns.', [grid({ minimumColumns: 4 })]);
okColumns('on-a-wide-section-grid', 'The floor works with the wide section grid, which has at most two columns.', [grid({ minimum: 'section-wide@1', maxColumns: 2, minimumColumns: 2 })]);
noColumns('above-the-most', 'The floor cannot exceed the most columns.', [grid({ maxColumns: 2, minimumColumns: 3 })]);
noColumns('one', 'A floor of one is no floor: the least is two.', [grid({ minimumColumns: 1 })]);
noColumns('five', 'At most four columns, floor included.', [grid({ minimumColumns: 5 })]);
noColumns('fraction', 'A column count is a whole number.', [grid({ minimumColumns: 2.5 })]);
noColumns('text', 'A column count is a number, not words.', [grid({ minimumColumns: 'two' })]);

// Rows (d)
okRow('auto-clean-row', 'The Auto-Clean row: a tinted leading glyph, a subtitle by rule, a hint and a failure caption, in module metrics.',
  [autoClean({ glyph: rgb(175, 82, 222), subtitle: subtitleByState, hint: 'Turns automatic cleaning on or off.', metrics: 'module', failureText: 'Automatic cleaning did not respond.' })]);
okRow('form-metrics', 'A toggle row in form metrics: 44 points high, a 28 point glyph column.', [autoClean({ metrics: 'form' })]);
okRow('subtitle-plain', 'A subtitle that is plain words.', [autoClean({ subtitle: lit('Cleans on a schedule') })]);
okRow('glyph-by-rule', 'The glyph\'s tint follows a rule.', [autoClean({ glyph: { type: 'conditional', cases: [{ when: is('auto-clean', 'on'), then: rgb(48, 209, 88) }], otherwise: rgb(142, 142, 147) } })]);
noRow('on-a-stepper', 'Row parts are for a toggle drawn as a row: a stepper is refused.', [node('steps', 'bound-control', {
  props: { kind: 'stepper', value: read('speed', ['attributes', 'step'], 'number'), range: { min: 0, max: 10, step: 1 }, unavailableText: 'Unavailable', subtitle: lit('Steps') },
  action: service('number', 'set_value', { target: target('number.demo_steps'), data: { type: 'object', fields: { value: { type: 'control' } } } }) })]);
noRow('on-a-tile-surface', 'A toggle drawn as a tile has no row parts.', [autoClean({ surface: 'tile', hint: 'Turns it on or off.' })]);
noRow('glyph-without-icon', 'A glyph tint tints the row\'s icon: a row with no icon has nothing to tint.', [withoutIcon(autoClean({ glyph: rgb(175, 82, 222) }))]);
noRow('metrics-not-in-list', 'The metrics are form or module.', [autoClean({ metrics: 'compact' })]);
noRow('hint-blank', 'A hint is never blank.', [autoClean({ hint: '  ' })]);
noRow('failure-text-too-long', 'The failure caption is at most 240 characters.', [autoClean({ failureText: 'x'.repeat(241) })]);
noRow('subtitle-is-a-structure', 'A subtitle expression gives text: a structure is refused.', [autoClean({ subtitle: { type: 'expr', value: { type: 'object', fields: { a: lit('x') } } } })]);
noRow('subtitle-too-long', 'A subtitle is at most 2000 characters.', [autoClean({ subtitle: lit('x'.repeat(2001)) })]);
noRow('glyph-standard', 'A glyph tint is an exact colour: `standard` is refused.', [autoClean({ glyph: { type: 'standard' } })]);

// Check face (e)
okCheck('room-row', 'A bound toggle drawn as a check row, with the action tint, a hint and a failure caption.', [checkRow({ checkTint: 'action', hint: 'Includes the room in the cycle.', failureText: 'The room did not respond.' })]);
okCheck('success-tint', 'The check row in the success tint, the default of the canonical row.', [checkRow({ checkTint: 'success' })]);
okCheck('explicit-switch-face', 'The face may name the switch explicitly.', [autoClean({ face: 'switch' })]);
noCheck('on-a-tile-surface', 'A check face is a row: a tile surface is refused.', [checkRow({ surface: 'tile' })]);
noCheck('with-an-icon', 'The leading slot of a check row is its circle: an icon is refused.', [checkRow({}, { icon: symbol('bed.double') })]);
noCheck('with-a-subtitle', 'A check row keeps its title, hint and caption only: a subtitle is refused.', [checkRow({ subtitle: lit('Occupied') })]);
noCheck('with-a-glyph-tint', 'A check row has no glyph to tint.', [checkRow({ glyph: rgb(1, 2, 3) })]);
noCheck('with-metrics', 'A check row has its own metrics.', [checkRow({ metrics: 'form' })]);
noCheck('tint-without-check', 'A check tint needs the check face.', [autoClean({ checkTint: 'action' })]);
noCheck('face-not-in-list', 'The face is switch or check.', [checkRow({ face: 'radio' })]);
noCheck('tint-not-in-list', 'The tint is action or success.', [checkRow({ checkTint: 'red' })]);
noCheck('on-a-choice', 'Only a toggle has a face.', [choice({ face: 'check' })]);

// MARK: Writing
function envelope(item: Case): J {
  const value = structuredClone(base);
  const document = value.document;
  document.dataSources.push(...structuredClone(sources));
  document.pages[PAGE].components = JSON.parse(JSON.stringify(item.components));
  return value;
}
const shipped = shippedCapabilities(root);
const mine = (file: unknown) => new RegExp(`^(accept|reject)/(pending-)?${PREFIX}`).test(String(file));
const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')) as { cases: J[] };
// The entries keep the place the first of them had, so a regeneration moves nothing else.
const firstAt = index.cases.findIndex(entry => mine(entry.file));
index.cases = index.cases.filter(entry => !mine(entry.file));
const fresh: J[] = [];
for (const folder of ['accept', 'reject']) for (const name of readdirSync(path.join(root, folder))) if (mine(`${folder}/${name}`)) unlinkSync(path.join(root, folder, name));
/** What each family's accepted cases declare together: a refused case of the family declares it too, so the fault under test is the only one reported. */
const familyCapabilities = new Map<string, Set<string>>();
for (const item of cases.filter(entry => entry.outcome === 'accept')) {
  const draft = envelope(item);
  item.tweak?.(draft);
  draft.capabilities = compileCompositionDocument(draft.document).capabilities;
  const found = familyCapabilities.get(item.family) ?? new Set<string>();
  for (const capability of draft.capabilities) found.add(capability);
  familyCapabilities.set(item.family, found);
}
const written: J = {};
for (const item of cases) {
  const draft = envelope(item);
  let studioIssue: J | undefined;
  if (item.outcome === 'accept') {
    item.tweak?.(draft);
    draft.capabilities = compileCompositionDocument(draft.document).capabilities;
  } else {
    draft.capabilities = [...new Set([...draft.capabilities, ...(familyCapabilities.get(item.family) ?? []), ...item.needs])].sort();
    item.tweak?.(draft);
    try { decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(draft))); throw new Error(`${item.name} was accepted`); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      const [first] = error.issues;
      if (first.pointer.startsWith('/capabilities')) throw new Error(`${item.name}: the first issue is about capabilities (${first.code} ${first.pointer}); the case is not testing what it names`);
      studioIssue = { code: first.code, pointer: first.pointer, ...(first.capability ? { capability: first.capability } : {}) };
    }
  }
  const { file, entry } = placeCase(item.name, item.note, item.outcome, shippedIssue(shipped, draft.capabilities), studioIssue);
  writeFileSync(path.join(root, file), `${JSON.stringify(draft)}\n`);
  fresh.push(entry);
  written[item.name] = studioIssue ? `${studioIssue.code} ${studioIssue.pointer}` : 'accepted';
}
index.cases.splice(firstAt < 0 ? index.cases.length : firstAt, 0, ...fresh);
writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (process.env.PARTS_VERBOSE) for (const [name, result] of Object.entries(written)) console.log(`${name}: ${result}`);
console.log(`wrote ${cases.length} cases (${cases.filter(item => item.outcome === 'accept').length} accept)`);
