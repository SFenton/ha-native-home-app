/**
 * The corpus cases of `sh.count@1`, the `count` operand: how many of a list of entities' conditions hold, as one node plus its tests, evaluated once.
 * It is generic (nothing here is named for a card or a house): a text that says "2 doors open", a node that hides at zero, a number of batteries below a
 * level, a count that follows who is looking (`viewer`), a sum of two counts (an app icon's number). Demo ids only.
 *
 * `generate-expression-corpus.ts` writes them with its own, so one generator owns `contract/corpus/evaluation`. Publication cases are `pending-count-operand-*`
 * (the Studio compiles them: while the app lacks the id, that file is the proof that a phone without it refuses the document) and `count-operand-*` (the
 * Studio refuses them); every refusal records the Studio's first issue here by hand in `expect`, and the generator fails when the compiler disagrees.
 *
 * The answers are worked out by hand from the rules in the header of `evaluator.ts` and the doc, never computed by the module under test:
 * - an entry whose test holds counts 1; one that does not, or whose entity reports a state other than the listed ones (`unavailable`, `unknown`), counts 0;
 * - an entry whose test cannot be answered (the entity has no state yet, or none at all, or a number test over text) is not counted;
 * - the count is `loading` (a source is still loading) or `unavailable` only when every entry in play cannot be answered;
 * - `viewer` puts an entry in play only while the viewer's `personEntityId` is listed; with no viewer yet the count is `loading`;
 * - "cannot be answered yet" covers every way a test reads: `read`, `raw-state`, `last-changed`, the viewer's person state and a viewer not known yet;
 * - inside a flow it is null, as the other source reads are.
 */
type J = Record<string, any>;

export interface CountCase {
  name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean;
  /** The Studio's first issue, written by hand: a reject must give exactly this. */
  expect?: { code: string; pointer: string };
}
export interface CountEvaluation { name: string; note: string; subject: J; env: J; expected: J }
/** The family this module owns: `reject/pending-count-operand-*` and `reject/count-operand-*`. */
export const countFamilies = ['count-operand'];
/** Capability ids by the short names the cases use. */
export const countNeeds: Record<string, string> = { count: 'sh.count@1' };

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const cmp = (op: string, left: J, right: J): J => ({ type: 'compare', op, left, right });
const choose = (cases: [J, J][], otherwise: J): J => ({ type: 'choose', cases: cases.map(([when, then]) => ({ when, then })), otherwise });
const fmt = (pattern: string, args: J, formats?: J): J => ({ type: 'format', pattern, args, ...(formats ? { formats } : {}) });
const math = (op: string, ...args: J[]): J => ({ type: 'math', op, args });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const exprText = (operand: J, fallback?: string): J[] => [node('t', 'text', { props: { value: { type: 'expr', value: operand, ...(fallback ? { fallback } : {}) }, style: 'body', unavailableText: 'None' } })];
const when = (predicate: J): J[] => [node('t', 'text', { props: { value: lit('Shown'), style: 'body', unavailableText: 'None' }, visibleWhen: predicate })];
/** A state test: the entity's state, or one of its attributes, is one of the words. */
const isState = (sourceId: string, words: string[], path = ['state']): J => ({ type: 'state', sourceId, path, in: words });
const on = (sourceId: string): J => isState(sourceId, ['on']);
/** A numeric test: the state is above or below a number. */
const below = (sourceId: string, limit: number): J => ({ type: 'numeric', sourceId, path: ['state'], below: lit(limit) });
const above = (sourceId: string, limit: number): J => ({ type: 'numeric', sourceId, path: ['state'], above: lit(limit) });
const entry = (test: J, persons?: string[]): J => ({ test, ...(persons ? { viewer: { personEntityIds: persons } } : {}) });
const count = (...tests: J[]): J => ({ type: 'count', of: tests.map(test => entry(test)) });
const ids = (prefix: string, total: number): string[] => Array.from({ length: total }, (_, index) => `${prefix}${index + 1}`);
/** Declares demo entity sources by id (the fixture gives `temp`, `guest-fan` and `lights`); the app-state sources are dropped, as the other families do. */
const withSources = (names: string[]): NonNullable<CountCase['tweak']> => envelope => {
  envelope.document.dataSources = envelope.document.dataSources.filter((item: J) => item.model !== 'app-state@1');
  for (const name of names) envelope.document.dataSources.push({ id: name, kind: 'ha-entity', entityId: lit(`binary_sensor.demo_${name.replace(/-/g, '_')}`) });
};
const doors = ['door-front', 'door-back', 'door-garage', 'window-study'];
/** The flow is appended after the fixture's five sources and the four demo doors. */
const FLOW_VALUE = `/document/dataSources/${5 + doors.length}/inputs/request/value`;
const at = (rest: string) => `/document/pages/2/components/0${rest}`;
const COUNT = '/props/value/value';

export const countCases: CountCase[] = [];
const accept = (name: string, note: string, needs: string[], components: J[], names = doors) =>
  countCases.push({ name, note, needs, components, tweak: withSources(names), reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], expect: CountCase['expect'], names = doors) =>
  countCases.push({ name, note, needs, components, tweak: withSources(names), reject: true, expect });

// MARK: Accepted (pending) cases
const openDoors = count(...doors.map(on));
accept('pending-count-operand-doors-line', 'A sentence that follows how many doors and windows are open: "All closed", "One open", or the number. The count stands in each case, one node plus its tests every time.', ['count', 'rules', 'conditions'],
  exprText(choose([[cmp('eq', openDoors, lit(0)), lit('All closed')], [cmp('above', openDoors, lit(1)), fmt('{n} open', { n: openDoors })]], lit('One open'))));
accept('pending-count-operand-shown-when-any', 'A node shown while at least one is open: the count above zero, as a condition.', ['count', 'conditions'], when(cmp('above', openDoors, lit(0))));
accept('pending-count-operand-numeric-tests', 'Entries may test a number: how many batteries are below 20, drawn as text.', ['count', 'pipeline-operands'],
  exprText(fmt('{n} low', { n: count(...doors.map(name => below(name, 20))) }), 'None'));
accept('pending-count-operand-attribute-and-all', 'An entry tests an attribute, or a few things at once: a fan on and in its auto preset, a sensor above a level, a door open.', ['count'],
  exprText(count({ type: 'all', of: [on('guest-fan'), isState('guest-fan', ['auto'], ['attributes', 'preset_mode'])] }, above('temp', 70), on('door-front')), 'None'), doors);
accept('pending-count-operand-viewer-filter', 'A count that follows who is looking: each person\'s own entries, and one entry for everyone (no viewer). Person entity ids are person.*.', ['count'],
  exprText({ type: 'count', of: [entry(above('door-front', 0), ['person.demo_sam']), entry(above('door-back', 0), ['person.demo_alex']), entry(above('door-garage', 0), ['person.demo_sam', 'person.demo_alex']), entry(above('window-study', 0))] }, 'None'));
accept('pending-count-operand-sum-of-counts', 'An app icon\'s number: a sum of two counts, each over its own list, so a few kinds of thing add up.', ['count'],
  exprText(math('add', count(on('door-front'), on('door-back')), count(on('door-garage'), on('window-study'))), 'None'));
accept('pending-count-operand-thirty-two', 'The most entries: 32 entities in one operand, 33 nodes of the 64 an expression may hold (the math form costs four nodes an entity and ends at three).', ['count'],
  exprText(count(...ids('e', 32).map(on)), 'None'), ids('e', 32));

// MARK: Refused cases
reject('count-operand-empty', 'A count has at least one entry.', ['count'], exprText({ type: 'count', of: [] }), { code: 'limit_exceeded', pointer: at(`${COUNT}/of`) });
reject('count-operand-over-32', 'A count has at most 32 entries.', ['count'], exprText(count(...ids('e', 33).map(on))), { code: 'limit_exceeded', pointer: at(`${COUNT}/of`) }, ids('e', 33));
reject('count-operand-over-budget', 'The 64-node limit still holds: 32 entries whose tests each hold an operand are 97 nodes.', ['count'],
  exprText(count(...ids('e', 32).map(name => above(name, 1)))), { code: 'limit_exceeded', pointer: at(`${COUNT}/of/31/test/above`) }, ids('e', 32));
reject('count-operand-no-of', 'The entries are required.', ['count'], exprText({ type: 'count' }), { code: 'missing_required', pointer: at(`${COUNT}/of`) });
reject('count-operand-entry-without-test', 'Every entry has a test.', ['count'], exprText({ type: 'count', of: [{}] }), { code: 'missing_required', pointer: at(`${COUNT}/of/0/test`) });
reject('count-operand-test-not-a-condition', 'A test is a condition: an operand is refused.', ['count'], exprText({ type: 'count', of: [{ test: lit(true) }] }), { code: 'unknown_variant', pointer: at(`${COUNT}/of/0/test/type`) });
reject('count-operand-unknown-source', 'A test names a declared source.', ['count'], exprText(count(on('nowhere'))), { code: 'invalid_reference', pointer: at(`${COUNT}/of/0/test/sourceId`) });
reject('count-operand-unknown-entry-field', 'An entry has a test and a viewer, nothing else.', ['count'], exprText({ type: 'count', of: [{ test: on('door-front'), weight: 2 }] }), { code: 'unknown_field', pointer: at(`${COUNT}/of/0/weight`) });
reject('count-operand-unknown-field', 'The count itself has `of` only: a viewer stands on an entry.', ['count'], exprText({ type: 'count', of: [entry(on('door-front'))], viewer: { personEntityIds: ['person.demo_sam'] } }), { code: 'unknown_field', pointer: at(`${COUNT}/viewer`) });
reject('count-operand-viewer-not-a-person', 'A viewer filter lists person entities.', ['count'], exprText({ type: 'count', of: [entry(on('door-front'), ['light.demo_hall'])] }), { code: 'invalid_value', pointer: at(`${COUNT}/of/0/viewer/personEntityIds/0`) });
reject('count-operand-viewer-empty', 'A viewer filter lists at least one person.', ['count'], exprText({ type: 'count', of: [entry(on('door-front'), [])] }), { code: 'limit_exceeded', pointer: at(`${COUNT}/of/0/viewer/personEntityIds`) });
reject('count-operand-viewer-unknown-field', 'A viewer filter lists person entities, not user ids.', ['count'], exprText({ type: 'count', of: [{ test: on('door-front'), viewer: { personEntityIds: ['person.demo_sam'], userIds: ['u1'] } }] }), { code: 'unknown_field', pointer: at(`${COUNT}/of/0/viewer/userIds`) });
reject('count-operand-compared-as-text', 'A count is a number: comparing it as text is refused.', ['count', 'conditions'], when(cmp('eq', openDoors, lit('three'))), { code: 'binding_type', pointer: at('/visibleWhen/right') });
reject('count-operand-test-too-deep', 'A test is a condition with the rule limit of six levels: seven nested nots are refused.', ['count'],
  exprText(count([1, 2, 3, 4, 5, 6].reduce<J>(inner => ({ type: 'not', of: inner }), { type: 'not', of: on('door-front') }))), { code: 'limit_exceeded', pointer: at(`${COUNT}/of/0/test/of/of/of/of/of/of`) });
reject('count-operand-stray-id', 'An operand has no id: a stray one is an unknown field, not the profile count node.', ['count'], exprText({ type: 'count', id: 'x', of: [entry(on('door-front'))] }), { code: 'unknown_field', pointer: at(`${COUNT}/id`) });
reject('count-operand-profile-node-is-not-the-operand', 'A `count` node (an id, a layout) is the unsupported profile count, `sh.profile-count@1`: the name is shared, so the record with an id and no `of` is the node.', ['count'],
  [node('profile-count', 'count', { props: {} })], { code: 'unsupported_capability', pointer: at('') });
const flowCount = (value: J): CountCase['tweak'] => envelope => {
  withSources(doors)(envelope);
  envelope.document.dataSources.push({ id: 'flow', kind: 'model', model: 'pipeline@1', inputs: { title: 'Count Flow', parameters: [], request: { type: 'none', value }, steps: [], output: { kind: 'scalar' }, schema: { kind: 'number' } } });
};
countCases.push({ name: 'count-operand-in-a-flow', note: 'A flow reads no document source: it runs on what it was given, so a count is refused there.', needs: ['count', 'pipeline', 'pipeline-operands'], components: [], tweak: flowCount(openDoors), reject: true,
  expect: { code: 'invalid_combination', pointer: FLOW_VALUE } });

// MARK: Evaluation
export const countEvaluations: CountEvaluation[] = [];
const value = (v: unknown): J => ({ status: 'value', value: v });
const LOADING: J = { status: 'loading' }, UNAVAILABLE: J = { status: 'unavailable' };
const operand = (name: string, note: string, subject: J, expected: J, env: J = {}) => countEvaluations.push({ name: `count-operand-${name}`, note, subject: { operand: subject }, env, expected });
const condition = (name: string, note: string, subject: J, expected: 'yes' | 'no' | 'unknown', env: J = {}) =>
  countEvaluations.push({ name: `count-operand-${name}`, note, subject: { condition: subject }, env, expected: { tri: expected } });
/** The states of sources, `<source>/state`. */
const states = (map: Record<string, unknown>): J => ({ reads: Object.fromEntries(Object.entries(map).map(([name, state]) => [`${name}/state`, (state as J)?.status ? state : value(state)])) });
const three = count(on('a'), on('b'), on('c'));

operand('zero', 'None of three holds: 0, a number, not an empty answer.', three, value(0), states({ a: 'off', b: 'off', c: 'off' }));
operand('one', 'One of three holds.', three, value(1), states({ a: 'off', b: 'on', c: 'off' }));
operand('many', 'Three of four hold.', count(on('a'), on('b'), on('c'), on('d')), value(3), states({ a: 'on', b: 'on', c: 'off', d: 'on' }));
operand('all', 'All four hold: the count is the number of entries.', count(on('a'), on('b'), on('c'), on('d')), value(4), states({ a: 'on', b: 'on', c: 'on', d: 'on' }));
operand('state-words-are-exact', 'The listed words are compared as written: "ON" is not "on".', three, value(1), states({ a: 'ON', b: 'on', c: 'off' }));
operand('state-is-unavailable-text', 'An entity that reports the state "unavailable" is a value that is not "on": not counted, and not a reason to stop counting.', three, value(1), states({ a: 'unavailable', b: 'on', c: 'off' }));
operand('state-is-unknown-text', 'The same for the state "unknown".', three, value(1), states({ a: 'unknown', b: 'on', c: 'unknown' }));
operand('test-for-the-unavailable-state', 'A test can ask for the word itself: how many entities are unavailable.', count(isState('a', ['unavailable']), isState('b', ['unavailable']), isState('c', ['unavailable'])), value(2), states({ a: 'unavailable', b: 'on', c: 'unavailable' }));
operand('entity-without-state-is-skipped', 'An entry whose entity has no state at all cannot be answered: it is not counted, and the others are.', three, value(1), states({ a: 'on', b: UNAVAILABLE, c: 'off' }));
operand('entry-still-loading-is-skipped', 'One entity still loading is not counted while another is answered.', three, value(1), states({ a: 'on', b: LOADING, c: 'off' }));
operand('every-entry-without-state-is-unavailable', 'When no entry can be answered the count has nothing to say: unavailable.', three, UNAVAILABLE);
operand('every-entry-loading-is-loading', 'When every entry is still loading the count is loading, so a slot keeps what it showed rather than drawing 0.', three, LOADING, states({ a: LOADING, b: LOADING, c: LOADING }));
operand('loading-and-missing-is-loading', 'A mix of loading and missing, none answered: loading, because a state is still on its way.', three, LOADING, states({ a: LOADING, c: UNAVAILABLE }));
operand('same-entity-counts-twice', 'Entries stand on their own: the same entity listed twice counts twice.', count(on('a'), on('a')), value(2), states({ a: 'on' }));
operand('attribute-test', 'An entry may test an attribute: how many fans are in their auto preset.', count(isState('a', ['auto'], ['attributes', 'preset_mode']), isState('b', ['auto'], ['attributes', 'preset_mode'])), value(1),
  { reads: { 'a/attributes/preset_mode': value('auto'), 'b/attributes/preset_mode': value('low') } });
operand('numeric-below', 'Batteries below 20: 15 and 19.5 hold, 80 does not, and a state that is text ("unavailable") cannot be answered and is not counted.', count(below('a', 20), below('b', 20), below('c', 20), below('d', 20)), value(2),
  states({ a: '15', b: '80', c: '19.5', d: 'unavailable' }));
operand('numeric-boundary-is-not-below', 'Below is strict: 20 is not below 20.', count(below('a', 20)), value(0), states({ a: '20' }));
operand('all-test-with-a-gap', 'An entry that is an `all` of a yes and an unanswerable test is unanswerable: not counted. The other entry holds.', count({ type: 'all', of: [on('a'), above('b', 70)] }, on('c')), value(1),
  states({ a: 'on', b: 'unavailable', c: 'on' }));
operand('all-test-with-a-no', 'An `all` with a no is a no even when another test cannot be answered: counted as not holding, so the count is a value.', count({ type: 'all', of: [on('a'), above('b', 70)] }), value(0),
  states({ a: 'off', b: 'unavailable' }));
operand('thirty-two', 'The most entries: 20 of 32 hold.', count(...ids('e', 32).map(on)), value(20), states(Object.fromEntries(ids('e', 32).map((name, index) => [name, index < 20 ? 'on' : 'off']))));

// Viewer filter. `a` is Sam's, `b` is Alex's, `c` is for both, `d` is for everyone.
const chores = { type: 'count', of: [entry(above('a', 0), ['person.demo_sam']), entry(above('b', 0), ['person.demo_alex']), entry(above('c', 0), ['person.demo_sam', 'person.demo_alex']), entry(above('d', 0))] };
const choreStates = states({ a: '2', b: '5', c: '1', d: '1' });
operand('viewer-first-person', 'Sam sees his own entry, the entry for both and the one for everyone.', chores, value(3), { ...choreStates, viewer: { userId: 'u1', personEntityId: 'person.demo_sam' } });
operand('viewer-second-person', 'Alex sees Alex\'s entry, the one for both and the one for everyone.', chores, value(3), { ...choreStates, viewer: { userId: 'u2', personEntityId: 'person.demo_alex' } });
operand('viewer-someone-else', 'A person who is in no filter sees the entry for everyone only.', chores, value(1), { ...choreStates, viewer: { userId: 'u3', personEntityId: 'person.demo_guest' } });
operand('viewer-without-a-person', 'A viewer with no person entity matches no filter: the entry for everyone only.', chores, value(1), { ...choreStates, viewer: { userId: 'u4' } });
operand('viewer-not-known-yet', 'Before the connection knows the viewer a filtered count is loading: "whose" cannot be said yet.', chores, LOADING, choreStates);
operand('viewer-not-needed-without-a-filter', 'A count with no filter does not wait for the viewer.', count(above('d', 0)), value(1), choreStates);
operand('viewer-filtered-out-entry-is-not-read', 'An entry the viewer is not in is not in play: its entity is never asked, so a missing state there does not matter.', { type: 'count', of: [entry(above('a', 0), ['person.demo_sam'])] }, value(0), { viewer: { personEntityId: 'person.demo_alex' } });
operand('viewer-all-in-play-unanswerable', 'The entries in play decide: when the only entry the viewer is in cannot be answered, the count is unavailable.', { type: 'count', of: [entry(above('a', 0), ['person.demo_sam']), entry(above('b', 0), ['person.demo_alex'])] }, UNAVAILABLE,
  { viewer: { personEntityId: 'person.demo_sam' } });

// Used in an expression.
operand('sum-of-counts', 'Two counts add: 2 of one list and 1 of the other make 3.', math('add', count(on('a'), on('b')), count(on('c'), on('d'))), value(3), states({ a: 'on', b: 'on', c: 'off', d: 'on' }));
operand('sum-with-an-unavailable-count', 'A sum with a count that has nothing to say is unavailable: the number of an icon is not guessed.', math('add', count(on('a')), count(on('b'))), UNAVAILABLE, states({ a: 'on' }));
const line = choose([[cmp('eq', three, lit(0)), lit('All closed')], [cmp('above', three, lit(1)), fmt('{n} open', { n: three })]], lit('One open'));
operand('line-none', 'The sentence says "All closed" at zero.', line, value('All closed'), states({ a: 'off', b: 'off', c: 'off' }));
operand('line-one', 'It says "One open" at one.', line, value('One open'), states({ a: 'off', b: 'on', c: 'off' }));
operand('line-many', 'It says the number above one.', line, value('2 open'), states({ a: 'on', b: 'on', c: 'off' }));
operand('line-unanswerable-is-loading', 'A count with nothing to say stops the rule: the line keeps what it showed rather than drawing "All closed".', line, LOADING, states({ a: UNAVAILABLE, b: UNAVAILABLE, c: UNAVAILABLE }));
condition('above-zero-yes', 'As a condition: more than none are open.', cmp('above', three, lit(0)), 'yes', states({ a: 'on', b: 'off', c: 'off' }));
condition('above-zero-no', 'None are open.', cmp('above', three, lit(0)), 'no', states({ a: 'off', b: 'off', c: 'off' }));
condition('above-zero-unknown', 'A count with nothing to say makes the condition unknown.', cmp('above', three, lit(0)), 'unknown');
operand('in-a-flow-is-null', 'A flow reads no document source: the count is a gap there, null.', three, value(null), { ...states({ a: 'on', b: 'on', c: 'on' }), flow: true });

// Every way a test reads reports "not yet" the same way. `raw` is what `readRaw` gives, `changed` what `readChanged` gives, `viewerPerson` what `viewerPersonState` gives.
const rawIs = (sourceId: string, word: string): J => cmp('eq', { type: 'raw-state', sourceId }, lit(word));
const changedAfter = (sourceId: string): J => cmp('after', { type: 'last-changed', sourceId }, lit('2026-01-01T00:00:00Z'));
const rawTwo = count(rawIs('a', 'on'), rawIs('b', 'on'));
operand('raw-state-value', 'A test over the raw state counts when it holds: "unavailable" is a word it can ask for.', count(rawIs('a', 'unavailable'), rawIs('b', 'unavailable')), value(1), { raw: { a: value('unavailable'), b: value('on') } });
operand('raw-state-loading-is-loading', 'Raw states still loading, nothing answered: loading, as for a plain read.', rawTwo, LOADING, { raw: { a: LOADING, b: LOADING } });
operand('raw-state-missing-is-unavailable', 'Raw states of entities that do not exist, nothing answered: unavailable.', rawTwo, UNAVAILABLE);
operand('raw-state-loading-and-missing-is-loading', 'One loading and one missing, none answered: loading.', rawTwo, LOADING, { raw: { a: LOADING } });
operand('raw-state-one-loading-one-answered-is-a-value', 'One answered is enough for a number: the loading one is not counted.', rawTwo, value(1), { raw: { a: value('on'), b: LOADING } });
const changedTwo = count(changedAfter('a'), changedAfter('b'));
operand('last-changed-value', 'A test over when a state last changed counts when it holds: one after the date, one before.', changedTwo, value(1), { changed: { a: value('2026-11-17T21:30:00.000Z'), b: value('2025-05-01T00:00:00.000Z') } });
operand('last-changed-loading-is-loading', 'Last-change times still loading, nothing answered: loading.', changedTwo, LOADING, { changed: { a: LOADING, b: LOADING } });
operand('last-changed-missing-is-unavailable', 'No last-change time at all: unavailable.', changedTwo, UNAVAILABLE);
const home = count({ type: 'viewer-person', in: ['home'] }, { type: 'viewer-person', in: ['home', 'work'] });
operand('viewer-person-value', 'The state of the viewer\'s person entity: home counts both entries.', home, value(2), { viewerPerson: value('home') });
operand('viewer-person-other-value', 'A person state that is not listed counts neither.', home, value(0), { viewerPerson: value('away') });
operand('viewer-person-loading-is-loading', 'The person entity still loading, nothing answered: loading.', home, LOADING, { viewerPerson: LOADING });
operand('viewer-person-missing-is-unavailable', 'A host with no person state: unavailable.', home, UNAVAILABLE);
const admin = count({ type: 'viewer', isAdmin: true }, { type: 'viewer', userIds: ['u1'] });
operand('viewer-test-without-a-viewer-is-loading', 'A viewer test before the connection knows the viewer cannot answer: loading.', admin, LOADING);
operand('viewer-test-value', 'Known viewer: an administrator who is u1 counts both.', admin, value(2), { viewer: { userId: 'u1', isAdmin: true } });
operand('viewer-test-field-missing-is-unavailable', 'A viewer is known but has no facts on it: the tests cannot be answered, and nothing is loading, so unavailable.', admin, UNAVAILABLE, { viewer: {} });
operand('viewer-operand-without-a-viewer-is-loading', 'A comparison with the viewer\'s id before the viewer is known: loading.', count(cmp('eq', { type: 'viewer', field: 'userId' }, lit('u1'))), LOADING);
operand('mixed-reads-one-loading-is-a-value', 'Entries over a plain read, a raw state and a person state: the unanswered ones are not counted while one is answered.', count(on('a'), rawIs('b', 'on'), { type: 'viewer-person', in: ['home'] }), value(1),
  { ...states({ a: 'on' }), raw: { b: LOADING }, viewerPerson: LOADING });

// In a badge (`resolveBadge`): "not yet" on any read path keeps the last text; nothing to say draws nothing.
const badgeOf = (name: string, note: string, subject: J, expected: J, env: J = {}) => countEvaluations.push({ name: `count-operand-badge-${name}`, note, subject: { badge: { type: 'value', value: subject } }, env, expected });
badgeOf('filtered-count-without-a-viewer-keeps', 'A person-filtered count in a badge before the viewer is known keeps what it showed, rather than drawing nothing.', chores, LOADING, choreStates);
badgeOf('filtered-count-with-a-viewer-draws', 'Once the viewer is known the badge draws the count: Sam\'s three.', chores, { status: 'value', text: '3' }, { ...choreStates, viewer: { personEntityId: 'person.demo_sam' } });
badgeOf('last-changed-loading-keeps', 'A count over last-change times still loading keeps the badge\'s last text.', changedTwo, LOADING, { changed: { a: LOADING, b: LOADING } });
badgeOf('raw-state-loading-keeps', 'The same for raw states.', rawTwo, LOADING, { raw: { a: LOADING, b: LOADING } });
badgeOf('person-state-loading-keeps', 'The same for the viewer\'s person state.', home, LOADING, { viewerPerson: LOADING });
badgeOf('nothing-to-say-draws-nothing', 'A count that cannot be read and waits on nothing draws no badge.', rawTwo, { status: 'value', text: null });
badgeOf('zero-draws-nothing', 'A count of 0 draws no badge.', three, { status: 'value', text: null }, states({ a: 'off', b: 'off', c: 'off' }));

// A badge with no `count` in it keeps its last text on the same "not yet" reads (`studio-logic.md`, the badge's loading rule): these are the plain operands.
const plainBadge = (name: string, note: string, subject: J, expected: J, env: J = {}) => countEvaluations.push({ name: `badge-${name}`, note, subject: { badge: { type: 'value', value: subject } }, env, expected });
plainBadge('viewer-operand-without-a-viewer-keeps', 'A badge over the viewer\'s id, before the connection knows the viewer, keeps what it showed rather than drawing nothing.', { type: 'viewer', field: 'userId' }, LOADING);
plainBadge('last-changed-loading-keeps', 'A badge over a last-change time that is still loading keeps what it showed.', { type: 'last-changed', sourceId: 'a' }, LOADING, { changed: { a: LOADING } });
