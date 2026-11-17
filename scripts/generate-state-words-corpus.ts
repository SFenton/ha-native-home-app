/**
 * The corpus cases of `sh.state-words@1`: an optional `props.words` on `light-group-tile`, `custom-light-control` (kind `brightness`) and `room-overview-tile`.
 *
 *   tsx scripts/generate-state-words-corpus.ts   # rewrites contract/corpus/{accept,reject}/{pending-,}state-words-*.json and their index entries
 *
 * The keys each tile draws and the token each word holds are `src/shared/composition/state-words.ts`. Accepted cases are `reject/pending-state-words-*`; refusals
 * are `reject/state-words-*` with the Studio's first issue written here by hand. Demo ids only.
 */
import { at, demoSources, lit, node, symbolOf, writeFamily, type J, type TileCase } from './tilecontract-lib';

const cases: TileCase[] = [];
const accept = (name: string, note: string, components: J[], tweak?: TileCase['tweak']) =>
  cases.push({ name: `pending-state-words-${name}`, note, needs: ['state-words'], components, reject: false, tweak });
const reject = (name: string, note: string, components: J[], expect: TileCase['expect'], tweak?: TileCase['tweak']) =>
  cases.push({ name: `state-words-${name}`, note, needs: ['state-words'], components, reject: true, expect, tweak });

// MARK: Builders
const labels = { idle: 'All Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'None', hidden: 'Hidden' };
const status = (id: string, projection: string, entityIds: string[]): J => ({
  id, kind: 'model', model: 'home-status@1', labels, inputs: { projection, format: 'room', entityIds: entityIds.map(value => lit(value)), awayEntityIds: [] },
});
const sources: J[] = [
  ...demoSources, status('rooms-lights', 'lights', ['light.demo_a', 'light.demo_b']), status('rooms-occupancy', 'occupancy', ['binary_sensor.demo_occupancy']),
  status('rooms-contacts', 'contacts', ['binary_sensor.demo_contact']),
  { id: 'custom-lights', kind: 'model', model: 'custom-lights@1', inputs: {
    sectionTitle: 'Demo', manualTitle: 'Manual', modeTitle: 'Mode', manualEntityId: 'input_boolean.demo_manual', modeEntityId: 'input_select.demo_mode', groupEntityId: 'light.demo_group',
    customMode: 'Custom', fallbackModes: ['Warm White', 'Custom'], palettes: [], resetKelvin: 2700, resetBrightness: 255, resetTransition: 1, lights: [{ title: 'Lamp', entityId: 'light.demo_lamp' }] } },
];
const lightGroup = (words?: J): J => node('lamp', 'light-group-tile', { props: { sourceId: 'light-main', ...(words ? { words } : {}) } });
const brightness = (words?: J, kind = 'brightness'): J => node('lamp-control', 'custom-light-control', { props: { sourceId: 'custom-lights', kind, ...(kind === 'brightness' ? { entityId: 'light.demo_lamp' } : {}), ...(words ? { words } : {}) } });
const overview = (sourceId: string, words?: J): J => node('room', 'room-overview-tile', {
  props: { sourceId, states: [], fallback: { icon: symbolOf('lightbulb'), fill: { type: 'standard' } }, announcement: 'none', hidesContactSubtitle: false, ...(words ? { words } : {}) },
});
const wordsPath = (rest: string) => at(0, `/props/words${rest}`);

// MARK: Accepted
accept('light-group-all-keys', 'A light group tile with every word it can draw: on, off, unavailable and the level with its token.', [lightGroup({ on: 'Lit', off: 'Dark', unavailable: 'No Answer', level: '{value} Percent' })]);
accept('light-group-on-only', 'One word is enough: the others draw the app\'s own.', [lightGroup({ on: 'Lit' })]);
accept('light-group-level-only', 'A level text with its `{value}` token.', [lightGroup({ level: 'Level {value}' })]);
accept('light-group-empty-object', 'An empty `words` object changes nothing, and still declares the id: the id is needed exactly when `words` is present.', [lightGroup({})]);
accept('light-group-without-words-needs-no-id', 'A tile with no `words` needs no new id and draws production\'s words.', [lightGroup()]);
accept('custom-light-brightness', 'The Custom Lights brightness tile takes off, unavailable and the level.', [brightness({ off: 'Dark', unavailable: 'Gone', level: '{value}%' })]);
accept('overview-lights-all-keys', 'A lights room overview: on for a room with one light, count for more, off and unavailable.', [overview('rooms-lights', { on: 'Lit', off: 'Dark', unavailable: 'No Answer', count: '{count} Lit' })]);
accept('overview-occupancy', 'An occupancy overview has its two words and the unavailable one: "Occupied" and "Not Occupied" are the defaults.', [overview('rooms-occupancy', { on: 'Someone Here', off: 'Nobody', unavailable: 'No Answer' })]);
accept('overview-contacts-unavailable', 'A contacts overview takes only the unavailable word: its other phrases are computed ("2 Doors Open").', [overview('rooms-contacts', { unavailable: 'No Answer' })]);
accept('max-length-words', 'The longest words: 240 characters for on, off and unavailable, 80 for count and level.', [lightGroup({ on: 'a'.repeat(240), level: `${'a'.repeat(72)} {value}` })]);

// MARK: Refused: keys the tile cannot draw
reject('light-group-count', 'A light group tile has no count: a room overview does.', [lightGroup({ count: '{count} On' })], { code: 'invalid_combination', pointer: wordsPath('/count') });
reject('custom-light-on', 'The brightness tile has no "on": it says the level, or "Off".', [brightness({ on: 'Lit' })], { code: 'invalid_combination', pointer: wordsPath('/on') });
reject('custom-light-count', 'The brightness tile has no count.', [brightness({ count: '{count} On' })], { code: 'invalid_combination', pointer: wordsPath('/count') });
reject('custom-light-other-kind', 'Only the brightness kind takes `words`: a manual switch has nothing to say.', [brightness({ off: 'Dark' }, 'manual')], { code: 'unknown_field', pointer: wordsPath('') });
reject('overview-lights-level', 'A lights overview has no level: it counts its lights.', [overview('rooms-lights', { level: '{value}%' })], { code: 'invalid_combination', pointer: wordsPath('/level') });
reject('overview-occupancy-count', 'An occupancy overview has no count.', [overview('rooms-occupancy', { count: '{count}' })], { code: 'invalid_combination', pointer: wordsPath('/count') });
reject('overview-contacts-on', 'A contacts overview computes its phrases: "on" is a key it cannot draw.', [overview('rooms-contacts', { on: 'Open' })], { code: 'invalid_combination', pointer: wordsPath('/on') });
reject('overview-contacts-off', 'A contacts overview has no "off" either.', [overview('rooms-contacts', { off: 'Closed' })], { code: 'invalid_combination', pointer: wordsPath('/off') });

// MARK: Refused: tokens, length, shape
reject('count-without-token', 'Count Text must hold `{count}`, or every room would read the same.', [overview('rooms-lights', { count: 'Some On' })], { code: 'invalid_value', pointer: wordsPath('/count') });
reject('level-without-token', 'Level Text must hold `{value}`.', [lightGroup({ level: 'Dimmed' })], { code: 'invalid_value', pointer: wordsPath('/level') });
reject('level-with-count-token', 'The level\'s token is `{value}`, not `{count}`.', [lightGroup({ level: '{count}%' })], { code: 'invalid_value', pointer: wordsPath('/level') });
reject('count-with-unknown-token', 'No token but `{count}`.', [overview('rooms-lights', { count: '{count} of {total}' })], { code: 'invalid_value', pointer: wordsPath('/count') });
reject('on-with-a-token', 'On, off and unavailable hold no token.', [lightGroup({ on: '{value} On' })], { code: 'invalid_value', pointer: wordsPath('/on') });
reject('stray-brace', 'A brace that is not a token is refused.', [lightGroup({ off: 'Off }' })], { code: 'invalid_value', pointer: wordsPath('/off') });
reject('on-too-long', 'A word of 241 characters is over the 240 that `on` allows.', [lightGroup({ on: 'a'.repeat(241) })], { code: 'limit_exceeded', pointer: wordsPath('/on') });
reject('level-too-long', 'Level Text is at most 80 characters.', [lightGroup({ level: `${'a'.repeat(75)} {value}` })], { code: 'limit_exceeded', pointer: wordsPath('/level') });
reject('blank-word', 'A blank word is refused: an empty field stores nothing, so the key is absent.', [lightGroup({ off: '  ' })], { code: 'invalid_value', pointer: wordsPath('/off') });
reject('unknown-key', 'A word the contract does not have is refused.', [lightGroup({ loading: 'Waiting' })], { code: 'unknown_field', pointer: wordsPath('/loading') });
reject('capability-not-declared', 'A document with `words` whose manifest lacks `sh.state-words@1` does not match.', [lightGroup({ on: 'Lit' })], { code: 'capability_manifest_mismatch', pointer: '/capabilities' });
cases[cases.length - 1].finish = envelope => { envelope.capabilities = envelope.capabilities.filter((name: string) => name !== 'sh.state-words@1'); };

writeFamily('state-words', cases, { 'state-words': 'sh.state-words@1' }, sources);
