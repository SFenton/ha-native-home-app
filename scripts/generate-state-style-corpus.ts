/**
 * Writes the `state-style-*` cases of the shared publication corpus and the built-in style fixture: accepted and rejected
 * envelopes for `sh.state-style@1` (the style library and the `state-tile` node). Each case is the shared first-slice fixture with
 * its third page's body replaced and the document's library set, so the files stay small.
 *
 *   tsx scripts/generate-state-style-corpus.ts   # rewrites contract/corpus/{accept,reject}/state-style-*.json, the index entries
 *                                                #   and contract/corpus/state-styles/built-in.json
 *
 * Accepted capability lists come from the Studio compiler; a rejected case records the Studio's first issue. Run
 * `scripts/app-corpus-check/run.sh` afterwards: the app's compiler must agree with every line. This file owns only
 * `state-style-*` and `state-styles/`.
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { builtInStyles } from '../src/shared/composition/state-styles';

type J = Record<string, any>;
const root = path.resolve(import.meta.dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(root, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const PAGE = 2;
const PREFIX = 'state-style-';

// MARK: Builders
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const tile = (binding: J, id = 'demo-tile', rest: J = {}): J => ({
  id, title: 'Vacuum', type: 'state-tile', layout: { span: 1 }, icon: symbol('fan'), props: {}, binding, ...rest,
});
const vacuumStyle = (rest: J = {}): J => ({
  id: 'tidy-vacuum', name: 'Tidy vacuum', base: 'robot', domain: 'vacuum',
  rules: [
    { states: ['docked', 'idle'], class: 'resting', active: false },
    { states: ['cleaning'], class: 'resting', active: true, icon: 'fan', text: 'Tidying', indicator: 'breathe' },
    { states: ['returning'], class: 'in-progress', active: false, indicator: 'arc-spinner' },
    { states: ['paused'], class: 'warning', active: false },
    { states: ['unavailable', 'unknown'], class: 'unknown', active: false },
  ],
  fallback: { class: 'unknown', active: false },
  ...rest,
});
const actionStyle = (rest: J = {}): J => ({
  id: 'player', name: 'Player', domain: 'media_player',
  rules: [
    { states: ['off'], class: 'resting', active: false, action: { verb: 'Turn On', icon: 'play.fill', service: 'turn_on' } },
    { states: ['playing'], class: 'resting', active: true, action: { verb: 'Pause', icon: 'pause.fill', service: 'media_pause' } },
    { states: ['buffering'], class: 'in-progress', active: true, action: { verb: 'Stop', icon: 'stop.fill', service: 'media_stop', requiresFeature: 8, otherwise: { verb: 'Pause', icon: 'pause.fill', service: 'media_pause' } } },
    { states: ['unavailable', 'unknown'], class: 'unknown', active: false },
  ],
  fallback: { class: 'unknown', active: false },
  ...rest,
});
const library = (...styles: J[]): J => ({ type: 'state-styles@1', styles });
const bind = (rest: J = {}): J => ({ entityId: 'vacuum.demo_robot', styleId: 'tidy-vacuum', builtIn: 'robot', ...rest });
const request = (rest: J = {}): J => ({ lockoutSeconds: 2, ackTimeoutSeconds: 10, settleTimeoutSeconds: 45, errorHoldSeconds: 8, onTimeout: 'error', ...rest });

interface Case { name: string; outcome: 'accept' | 'reject'; note: string; stateStyles?: J; components?: J[]; tweak?: (envelope: J) => void }
const cases: Case[] = [];
const accept = (name: string, note: string, more: Partial<Case>) => cases.push({ name: PREFIX + name, outcome: 'accept', note, ...more });
const reject = (name: string, note: string, more: Partial<Case>) => cases.push({ name: PREFIX + name, outcome: 'reject', note, ...more });
const withRule = (index: number, patch: J) => vacuumStyle({ rules: vacuumStyle().rules.map((rule: J, at: number) => (at === index ? { ...rule, ...patch } : rule)) });

// MARK: Accepted
accept('authored-vacuum', 'A saved style over a vacuum with a tile that overrides one state layer by layer.', {
  stateStyles: library(vacuumStyle()),
  components: [tile(bind({ overrides: [{ state: 'cleaning', text: 'Vacuuming', indicator: 'pulse' }, { state: 'returning', icon: 'house', colour: 'lit' }] }))],
});
accept('every-built-in-copy', 'A library holding the eight built-in styles as saved copies, each with its explicit fallback.', {
  stateStyles: library(...builtInStyles.map(style => ({ ...structuredClone(style), id: `copy-${style.id}`, base: style.id }))),
  components: [tile({ entityId: 'cover.demo_garage', styleId: 'copy-garage-door', builtIn: 'garage-door' })],
});
accept('request-lifecycle', 'Request settings with pending words, a Home Assistant script and its error timer, and a state action with a confirmation.', {
  stateStyles: library(actionStyle({
    request: request({ pendingWords: [{ service: 'media_pause', text: 'Pausing…' }], errorWords: 'Error', script: 'script.demo_player_lifecycle', errorTimer: 'timer.demo_player_error' }),
    rules: actionStyle().rules.map((rule: J, index: number) => (index === 0
      ? { ...rule, action: { ...rule.action, confirmation: { title: 'Turn on the player?', message: 'It plays at the last volume.', confirmVerb: 'Turn On' } } } : rule)),
  })),
  components: [tile({ entityId: 'media_player.demo_player', styleId: 'player' })],
});
accept('built-in-only-tile', 'A tile with a built-in style and no library: it requires the capability and nothing else.', {
  components: [tile({ entityId: 'vacuum.demo_robot', builtIn: 'robot' })],
});
accept('unknown-style-id-falls-back', 'A style id the library does not define is accepted; the app uses the tile\'s built-in style.', {
  stateStyles: library(vacuumStyle()),
  components: [tile(bind({ styleId: 'removed-style' }))],
});
accept('library-without-tiles', 'A library no tile uses is accepted; it costs nothing.', { stateStyles: library(vacuumStyle(), actionStyle()) });
accept('style-without-base-or-built-in', 'A style with no built-in base on a tile with no built-in style of its own.', {
  stateStyles: library(actionStyle()),
  components: [tile({ entityId: 'media_player.demo_player', styleId: 'player' }, 'player-tile')],
});
accept('override-arc-on-state-without-action', 'An arc override on a state that has no action is accepted.', {
  stateStyles: library(vacuumStyle()),
  components: [tile(bind({ overrides: [{ state: 'docked', indicator: 'arc-spinner' }] }))],
});

// MARK: Rejected
reject('arc-spinner-on-state-with-action', 'The arc stands in for the disc, so a rule whose state has an action refuses it.', {
  stateStyles: library(actionStyle({ rules: actionStyle().rules.map((rule: J, index: number) => (index === 1 ? { ...rule, indicator: 'arc-spinner' } : rule)) })),
});
reject('arc-spinner-on-unknown-class', 'An unavailable state never shows an arc, so busy and unavailable differ.', { stateStyles: library(withRule(4, { indicator: 'arc-spinner' })) });
reject('fallback-arc-with-action', 'The fallback rule follows the same rule about the arc.', {
  stateStyles: library(actionStyle({ fallback: { class: 'resting', active: false, indicator: 'arc-spinner', action: { verb: 'Stop', icon: 'stop.fill', service: 'media_stop' } } })),
});
reject('override-arc-on-state-with-action', 'A tile\'s arc override follows the resolved style: the state it names has an action.', {
  stateStyles: library(actionStyle()),
  components: [tile({ entityId: 'media_player.demo_player', styleId: 'player', overrides: [{ state: 'playing', indicator: 'arc-spinner' }] })],
});
reject('override-arc-on-built-in-state-with-action', 'With no library style the tile\'s built-in style decides: a lock\'s locking state has an action.', {
  components: [tile({ entityId: 'lock.demo_door', builtIn: 'lock', overrides: [{ state: 'locking', indicator: 'arc-spinner' }] })],
});
reject('unavailable-state-not-unknown-class', '`unavailable` and `unknown` are the unknown class in every style.', { stateStyles: library(withRule(4, { class: 'resting' })) });
reject('duplicate-style-id', 'A library names each style id once.', { stateStyles: library(vacuumStyle(), vacuumStyle({ name: 'Copy' })) });
reject('fallback-missing', 'Every style ends with a fallback rule.', { stateStyles: library((({ fallback: _fallback, ...style }) => style)(vacuumStyle())) });
reject('indicator-not-in-list', 'The indicator list is closed.', { stateStyles: library(withRule(1, { indicator: 'spin' })) });
reject('colour-not-in-list', 'The colour layer is a palette token, never a value.', { stateStyles: library(withRule(1, { colour: '#ff0000' })) });
reject('colour-warning-token', 'The colour layer has two tokens, unlit and lit; a class is never a token.', { stateStyles: library(withRule(1, { colour: 'warning' })) });
reject('colour-on-warning-class', 'A colour token is for a resting or in-progress state; a warning keeps the face of its class.', { stateStyles: library(withRule(3, { colour: 'lit' })) });
reject('colour-on-error-class', 'An error keeps the face of its class, so a rule of that class refuses a colour token.', {
  stateStyles: library(vacuumStyle({ rules: [...vacuumStyle().rules.slice(0, 4), { states: ['error'], class: 'error', active: false, colour: 'unlit' }, vacuumStyle().rules[4]] })),
});
reject('override-colour-on-warning-state', 'A tile\'s colour override follows the resolved style: a paused vacuum is a warning and keeps its face.', {
  stateStyles: library(vacuumStyle()), components: [tile(bind({ overrides: [{ state: 'paused', colour: 'lit' }] }))],
});
reject('class-not-in-list', 'A state has one of the five classes.', { stateStyles: library(withRule(1, { class: 'busy' })) });
reject('rule-unknown-field', 'A rule takes the fields of its schema and no others.', { stateStyles: library(withRule(1, { tint: 'red' })) });
reject('rule-without-states', 'A rule names at least one state; the fallback is the rule that names none.', { stateStyles: library(withRule(1, { states: [] })) });
reject('base-not-built-in', 'A base is one of the eight built-in styles.', { stateStyles: library(vacuumStyle({ base: 'dishwasher' })) });
reject('action-otherwise-without-feature', '`otherwise` is the same action without a feature, so it needs `requiresFeature`.', {
  stateStyles: library(actionStyle({ rules: actionStyle().rules.map((rule: J, index: number) => (index === 2
    ? { ...rule, action: { verb: 'Stop', icon: 'stop.fill', service: 'media_stop', otherwise: { verb: 'Pause', icon: 'pause.fill', service: 'media_pause' } } } : rule)) })),
});
reject('request-script-without-timer', 'The lifecycle names its script and its error timer together.', { stateStyles: library(vacuumStyle({ request: request({ script: 'script.demo_lifecycle' }) })) });
reject('request-script-not-a-script', 'The lifecycle script is a script entity.', {
  stateStyles: library(vacuumStyle({ request: request({ script: 'switch.demo_lifecycle', errorTimer: 'timer.demo_error' }) })),
});
reject('request-seconds-over-limit', 'A timing has an upper bound.', { stateStyles: library(vacuumStyle({ request: request({ settleTimeoutSeconds: 601 }) })) });
reject('tile-without-style-or-built-in', 'A tile names a library style, a built-in style, or both.', { components: [tile({ entityId: 'vacuum.demo_robot' })] });
reject('tile-entity-not-the-style-domain', 'A tile\'s entity is in the domain its style acts on.', {
  stateStyles: library(vacuumStyle()), components: [tile(bind({ entityId: 'switch.demo_robot', builtIn: undefined }))],
});
reject('tile-entity-not-the-built-in-domain', 'A tile\'s built-in style acts on its own domain.', { components: [tile({ entityId: 'switch.demo_robot', builtIn: 'robot' })] });
reject('tile-entity-malformed', 'An entity id has the form domain.object.', { components: [tile({ entityId: 'Vacuum Robot', builtIn: 'robot' })] });
reject('override-without-a-layer', 'An override sets at least one layer.', { stateStyles: library(vacuumStyle()), components: [tile(bind({ overrides: [{ state: 'cleaning' }] }))] });
reject('override-state-twice', 'A tile overrides a state once.', {
  stateStyles: library(vacuumStyle()),
  components: [tile(bind({ overrides: [{ state: 'cleaning', text: 'One' }, { state: 'cleaning', text: 'Two' }] }))],
});
reject('tile-binding-unknown-field', 'A binding takes the fields of its schema and no others.', { components: [tile({ entityId: 'vacuum.demo_robot', builtIn: 'robot', tint: 'red' })] });
reject('capability-missing-from-manifest', 'A document that carries a style library must list the capability.', {
  stateStyles: library(vacuumStyle()), tweak: envelope => { envelope.capabilities = envelope.capabilities.filter((name: string) => name !== 'sh.state-style@1'); },
});

// MARK: Writing
function envelope(item: Case): J {
  const value = structuredClone(base);
  const document = value.document;
  if (item.components) document.pages[PAGE].components = item.components;
  if (item.stateStyles) document.stateStyles = item.stateStyles;
  return value;
}
const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')) as { cases: J[] };
index.cases = index.cases.filter(entry => !String(entry.file).includes(`/${PREFIX}`));
for (const folder of ['accept', 'reject']) for (const name of readdirSync(path.join(root, folder))) if (name.startsWith(PREFIX)) unlinkSync(path.join(root, folder, name));
for (const item of cases) {
  const file = `${item.outcome}/${item.name}.json`;
  const draft = envelope(item);
  let issue: J | undefined;
  if (item.outcome === 'accept') draft.capabilities = compileCompositionDocument(draft.document).capabilities;
  else {
    // A rejected case starts from a document that would otherwise be complete, so only the fault under test is reported.
    try { draft.capabilities = compileCompositionDocument(draft.document).capabilities; } catch { /* the document is the fault */ }
    if (!draft.capabilities.includes('sh.state-style@1')) draft.capabilities = [...draft.capabilities, 'sh.state-style@1'].sort();
    item.tweak?.(draft);
    try { decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(draft))); throw new Error(`${item.name} was accepted`); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      const [first] = error.issues;
      issue = { code: first.code, pointer: first.pointer, ...(first.capability ? { capability: first.capability } : {}) };
    }
  }
  writeFileSync(path.join(root, file), `${JSON.stringify(draft)}\n`);
  index.cases.push({ file, outcome: item.outcome, note: item.note, ...(issue ? { issue } : {}) });
}
writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
mkdirSync(path.join(root, 'state-styles'), { recursive: true });
writeFileSync(path.join(root, 'state-styles/built-in.json'), `${JSON.stringify({ format: 1, styles: builtInStyles }, null, 2)}\n`);
console.log(`wrote ${cases.length} cases (${cases.filter(item => item.outcome === 'accept').length} accept)`);
