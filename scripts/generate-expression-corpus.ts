/**
 * Writes the expression cases of the shared publication corpus and the expression evaluation corpus. One operand and condition grammar serves
 * Data Flow, `visibleWhen`, rule-based values and authored strings (`sh.conditions@1`, `sh.rules@1`, `sh.app-state@1`, `sh.home-status-counts@1`).
 * These capabilities are shipped except `sh.pipeline-operands@1`, `sh.list-parts@1`, `sh.list-read@1` and `sh.raw-state@1`. A case that declares neither is an `accept/` file or a plain `reject/`
 * file; one that does is a `pending` reject (see `corpus-handshake.ts`), which the Studio either compiles (no `studioIssue`) or refuses with its own first issue.
 *
 *   tsx scripts/generate-expression-corpus.ts   # rewrites contract/corpus/{accept,reject}/pending-{conditions,rules,app-state,home-status}-*.json, reject/{conditions,rules,app-state,home-status}-*.json,
 *                                               # their index entries and contract/corpus/evaluation/*.json
 *
 * The evaluation cases carry hand-written answers: the generator writes the subjects and the environments, never the answers. The app runs the same files
 * with its own evaluator and must agree byte for byte. This file owns only the files named above.
 */
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { askCases, askEvaluations, askFamilies, askNeeds } from './asks-corpus';
import { grammar2Cases, grammar2Evaluations, grammar2Families, grammar2Needs } from './grammar2-corpus';
import { layoutEvaluations } from './layout-corpus';
import { wgStyleCases, wgStyleEvaluations, wgStyleFamilies, wgStyleNeeds } from './wgstyle-corpus';
import { wgFlowCases, wgFlowEvaluations, wgFlowFamilies, wgFlowNeeds } from './wgflow-corpus';
import { wgChartCases, wgChartEvaluations, wgChartFamilies, wgChartNeeds } from './wgchart-corpus';
import { wgDialCases, wgDialEvaluations, wgDialFamilies, wgDialNeeds } from './wgdial-corpus';
import { neCases, neEvaluations, neFamilies, neNeeds } from './neoperands-corpus';
import { pbCases, pbEvaluations, pbFamilies, pbNeeds } from './profile-badges-corpus';
import { dialCtlCases, dialCtlEvaluations, dialCtlFamilies, dialCtlNeeds } from './dialctl-corpus';
import { countCases, countEvaluations, countFamilies, countNeeds } from './count-corpus';
import { foldSidesEvaluations } from './fold-sides-evaluations';
import { placeCase, shippedCapabilities, shippedIssue } from './corpus-handshake';

type J = Record<string, any>;
const root = path.resolve(import.meta.dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(root, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const PAGE = 2;
const FAMILIES = ['conditions', 'rules', 'app-state', 'home-status', ...askFamilies, ...grammar2Families, ...wgStyleFamilies, ...wgFlowFamilies, ...wgChartFamilies, ...wgDialFamilies, ...neFamilies, ...pbFamilies, ...dialCtlFamilies, ...countFamilies];

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const cmp = (op: string, left: J, right: J): J => ({ type: 'compare', op, left, right });
const choose = (cases: [J, J][], otherwise: J): J => ({ type: 'choose', cases: cases.map(([when, then]) => ({ when, then })), otherwise });
const fmt = (pattern: string, args: J, formats?: J): J => ({ type: 'format', pattern, args, ...(formats ? { formats } : {}) });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const rgb = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, value: J, extra: J = {}): J => node(id, 'text', { props: { value, style: 'body', unavailableText: 'None' }, ...extra });
const when = (predicate: J): J[] => [text('t', lit('Shown'), { visibleWhen: predicate })];
const exprText = (operand: J): J[] => [text('t', { type: 'expr', value: operand })];
const appState = (topic: string): J => ({ id: `app-${topic}`, kind: 'model', model: 'app-state@1', inputs: { topic } });
const homeStatus: J = {
  id: 'lights', kind: 'model', model: 'home-status@1',
  inputs: { projection: 'lights', format: 'summary', entityIds: [lit('light.demo_study')], awayEntityIds: [] },
  labels: { idle: 'All Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'No lights', hidden: 'Hidden' },
};
const sources: J[] = [
  { id: 'guest-fan', kind: 'ha-entity', entityId: lit('fan.demo_bath_fan') },
  { id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') },
  homeStatus, ...['window', 'clock', 'os', 'notifications', 'preferences'].map(appState),
];
const chip = (appearance: J, fallback: J = { icon: symbol('lightbulb'), fill: { type: 'standard' } }): J => node('chip', 'status-chip', {
  props: { sourceId: 'lights', states: [{ state: 'active', appearance }], fallback, announcement: 'none' },
});
const conditional = (cases: [J, J][], otherwise: J): J => ({ type: 'conditional', cases: cases.map(([w, t]) => ({ when: w, then: t })), otherwise });
const hot: J = cmp('above', read('temp', ['state'], 'number'), lit(75));

interface Case { name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean }
const cases: Case[] = [];
const accept = (name: string, note: string, needs: string[], components: J[], tweak?: Case['tweak']) => cases.push({ name, note, needs, components, tweak, reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], tweak?: Case['tweak']) => cases.push({ name, note, needs, components, tweak, reject: true });

// MARK: Pending cases the Studio compiles
accept('pending-conditions-compare', 'A node shown when one value is above another: compare reads, with no state or numeric leaf.', ['conditions'],
  when(cmp('above', read('temp', ['state'], 'number'), lit(75))));
accept('pending-conditions-in-exists', 'in and exists leaves, combined with the old leaves and not.', ['conditions'],
  when({ type: 'all', of: [{ type: 'in', value: read('guest-fan', ['state']), in: [lit('on'), lit('auto')] }, { type: 'exists', value: read('guest-fan', ['attributes', 'preset_mode']) },
    { type: 'not', of: { type: 'state', sourceId: 'guest-fan', path: ['state'], in: ['off'] } }] }));
accept('pending-conditions-compare-dates', 'before and after compare dates; the clock operand gives today.', ['conditions', 'pipeline-operands'],
  when(cmp('before', { type: 'clock', part: 'today' }, lit('2030-01-01'))));
accept('pending-conditions-model-read-operand', 'An operand can read a model source: a call built from a home status field.', ['conditions'],
  [node('go', 'primary-button', { props: {}, action: { type: 'call-service', domain: 'x', service: 'y', data: { type: 'object', fields: { v: read('lights', ['isActive'], 'boolean') } } } })]);
accept('pending-conditions-model-read-predicate', 'A condition can read a model source: shown while a home status is active.', ['conditions'],
  when({ type: 'state', sourceId: 'lights', path: ['state'], in: ['active'] }));
accept('pending-rules-choose-text', 'An authored string made by a rule: the first case that holds gives the text.', ['rules', 'conditions'],
  exprText(choose([[hot, lit('Hot')], [cmp('below', read('temp', ['state'], 'number'), lit(60)), lit('Cold')]], lit('Fine'))));
accept('pending-rules-expr-format', 'An authored string that formats a number read from an entity.', ['rules'],
  exprText(fmt('{n} degrees', { n: read('temp', ['state'], 'number') }, { n: { number: { maximumFractionDigits: 1 } } })));
accept('pending-rules-conditional-look', 'A chip whose icon, glyph and fill follow a condition, each case an exact literal.', ['rules', 'conditions'],
  [chip({ icon: conditional([[hot, symbol('flame')]], symbol('lightbulb.fill')), fill: conditional([[hot, rgb(120, 20, 10)]], rgb(95, 53, 16)),
    glyph: conditional([[hot, rgb(255, 255, 255)]], rgb(240, 240, 240)) })]);
for (const [topic, field, as] of [['window', 'widthClass', 'string'], ['clock', 'minuteOfDay', 'number'], ['os', 'reduceMotion', 'boolean'], ['notifications', 'permission', 'string'], ['preferences', 'showCountOnIcon', 'boolean']] as const) {
  accept(`pending-app-state-${topic}`, `A text slot reads the ${topic} topic of the app state: ${field}.`, ['app-state'], [text('t', read(`app-${topic}`, [field], as === 'string' ? 'string' : as))].map(item => as === 'string' ? item
    : { ...item, props: { ...item.props, value: { type: 'expr', value: read(`app-${topic}`, [field], as) } } }));
}
accept('pending-app-state-condition', 'A node shown only in a regular-width window, by comparing the window width class.', ['app-state', 'conditions'],
  when(cmp('eq', read('app-window', ['widthClass']), lit('regular'))));
accept('pending-app-state-phase', 'A condition reads the phase of a topic, so it can wait for the first answer.', ['app-state', 'conditions'],
  when(cmp('eq', read('app-clock', ['phase']), lit('ready'))));
accept('pending-home-status-counts', 'A home status gives its count, total and unavailable count; a chip text shows the count and a node hides at zero.', ['home-status-counts', 'conditions', 'rules'],
  [text('count', { type: 'expr', value: fmt('{n} of {m} on', { n: read('lights', ['count'], 'number'), m: read('lights', ['total'], 'number') }) }),
    text('any', lit('Some on'), { visibleWhen: cmp('above', read('lights', ['count'], 'number'), lit(0)) })]);

// MARK: Rejected cases (the Studio's first issue is recorded as studioIssue)
reject('conditions-compare-above-text', 'above needs numbers: a text literal is refused.', ['conditions'], when(cmp('above', lit('hot'), lit(75))));
reject('conditions-compare-before-number', 'before and after need date text.', ['conditions'], when(cmp('before', lit(3), lit('2030-01-01'))));
reject('conditions-compare-eq-mixed-kinds', 'eq compares values of one kind: a number and text are refused.', ['conditions'], when(cmp('eq', lit(3), lit('three'))));
reject('conditions-in-empty', 'in lists at least one option.', ['conditions'], when({ type: 'in', value: lit('a'), in: [] }));
reject('conditions-in-over-16', 'in lists at most 16 options.', ['conditions'], when({ type: 'in', value: lit('a'), in: Array.from({ length: 17 }, () => lit('b')) }));
reject('conditions-unknown-leaf', 'A condition leaf is a known kind.', ['conditions'], when({ type: 'between', value: lit(1) }));
reject('conditions-item-outside-flow', 'item exists only inside a Data Flow.', ['conditions', 'pipeline-operands'], when(cmp('eq', { type: 'item', path: ['x'] }, lit('a'))));
reject('conditions-param-outside-flow', 'param exists only inside a Data Flow.', ['conditions', 'pipeline-operands'], when(cmp('eq', { type: 'param', name: 'p' }, lit('a'))));
reject('conditions-read-unknown-field', 'A read of a model names a field the model has.', ['conditions'], when(cmp('eq', read('lights', ['nothing']), lit('a'))));
reject('conditions-read-wrong-kind', 'A read of a text field as a number is refused.', ['conditions'], when(cmp('above', read('lights', ['stateText'], 'number'), lit(1))));
reject('rules-choose-no-otherwise', 'A rule always has an otherwise: never an implicit look.', ['rules', 'conditions'],
  exprText({ type: 'choose', cases: [{ when: hot, then: lit('Hot') }] }));
reject('rules-choose-over-16-cases', 'A rule has at most 16 cases.', ['rules', 'conditions'],
  exprText(choose(Array.from({ length: 17 }, (_, index) => [cmp('above', read('temp', ['state'], 'number'), lit(index)), lit(`${index}`)] as [J, J]), lit('x'))));
reject('rules-choose-empty', 'A rule has at least one case.', ['rules'], exprText({ type: 'choose', cases: [], otherwise: lit('x') }));
reject('rules-choose-mixed-kinds', 'The branches of a rule give one kind: text and a number are refused.', ['rules', 'conditions'], exprText(choose([[hot, lit('Hot')]], lit(3))));
reject('rules-expr-structure', 'An authored string is text, a number or a boolean, never a list or an object.', ['rules'], exprText({ type: 'list', items: [lit(1)] }));
accept('pending-rules-conditional-navigation-fill', 'A navigation tile fill that follows a condition: a case is an exact fill, never clamped.', ['rules', 'conditions'],
  [{ ...node('tile', 'navigation-tile', { props: { family: 'neutral', selected: 'none', subtitle: lit('x'), presentation: { layout: 'standard', titleLines: 1, fill: conditional([[hot, rgb(1, 2, 3)]], rgb(4, 5, 6)) } } }), icon: symbol('house'), action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } }]);
reject('rules-conditional-alarm-fill', 'An alarm appearance is a keyed state table and stays literal: a conditional fill is refused there.', ['rules', 'conditions'],
  [{ ...node('tile', 'navigation-tile', { props: { family: 'neutral', selected: 'none', subtitle: lit(''), alarm: { sourceId: 'alarm', projection: 'alarm-navigation@1',
    states: [{ state: 'armed_home', appearance: { icon: symbol('lock'), fill: conditional([[hot, rgb(1, 2, 3)]], rgb(4, 5, 6)), text: 'Home' } }],
    fallback: { icon: symbol('lock'), fill: rgb(1, 2, 3), text: 'x' }, loadingText: 'a', unavailableText: 'b', errorText: 'c', hiddenText: 'd' } } }), icon: symbol('house'),
    action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } }],
  envelope => { envelope.document.dataSources.push({ id: 'alarm', kind: 'model', model: 'alarm-mode@1', inputs: { entityId: lit('alarm_control_panel.demo_home') } }); });
reject('rules-conditional-no-otherwise', 'A conditional look has an otherwise.', ['rules', 'conditions'],
  [chip({ icon: symbol('lightbulb.fill'), fill: { type: 'conditional', cases: [{ when: hot, then: rgb(1, 2, 3) }] } })]);
reject('rules-conditional-bad-case-look', 'A conditional fill case holds a literal fill: a read is refused.', ['rules', 'conditions'],
  [chip({ icon: symbol('lightbulb.fill'), fill: { type: 'conditional', cases: [{ when: hot, then: read('temp', ['state']) }], otherwise: rgb(1, 2, 3) } })]);
reject('rules-conditional-over-16-cases', 'A conditional look has at most 16 cases.', ['rules', 'conditions'],
  [chip({ icon: symbol('lightbulb.fill'), fill: conditional(Array.from({ length: 17 }, () => [hot, rgb(1, 2, 3)] as [J, J]), rgb(1, 2, 3)) })]);
reject('app-state-unknown-topic', 'The topic is one of window, clock, os, notifications or preferences.', ['app-state'], [], envelope => { envelope.document.dataSources.push({ id: 'bad', kind: 'model', model: 'app-state@1', inputs: { topic: 'sensors' } }); });
reject('app-state-device-topic', 'There is no device topic: layout follows window geometry, and device chrome stays in the renderers.', ['app-state'], [], envelope => { envelope.document.dataSources.push({ id: 'bad', kind: 'model', model: 'app-state@1', inputs: { topic: 'device' } }); });
reject('app-state-extra-input', 'The source takes no input besides its topic.', ['app-state'], [], envelope => { envelope.document.dataSources.push({ id: 'bad', kind: 'model', model: 'app-state@1', inputs: { topic: 'clock', zone: 'home' } }); });
reject('app-state-field-not-in-topic', 'A read names a field its topic has.', ['app-state', 'conditions'], when(cmp('eq', read('app-window', ['hour']), lit('1'))));
reject('app-state-wrong-kind', 'A read of a number field as text is refused.', ['app-state', 'conditions'], when(cmp('eq', read('app-clock', ['hour'], 'string'), lit('1'))));
reject('home-status-counts-wrong-kind', 'The count of a home status is a number.', ['home-status-counts', 'conditions'], when(cmp('eq', read('lights', ['count'], 'string'), lit('1'))));

cases.push(...askCases, ...grammar2Cases, ...wgStyleCases, ...(wgFlowCases as unknown as typeof wgStyleCases), ...wgChartCases, ...wgDialCases, ...neCases, ...(pbCases as unknown as typeof wgStyleCases), ...dialCtlCases, ...countCases);

// MARK: Writing
const needsIds: Record<string, string> = {
  conditions: 'sh.conditions@1', rules: 'sh.rules@1', 'app-state': 'sh.app-state@1', 'home-status-counts': 'sh.home-status-counts@1', 'pipeline-operands': 'sh.pipeline-operands@1',
  ...askNeeds, ...grammar2Needs, ...wgStyleNeeds, ...wgFlowNeeds, ...wgChartNeeds, ...wgDialNeeds, ...neNeeds, ...pbNeeds, ...dialCtlNeeds, ...countNeeds,
};
const shipped = shippedCapabilities(root);
// `tile-ink-default-` belongs to its own generator: the grammar2 family `tile-ink` must not claim it by prefix.
const own = (file: unknown) => new RegExp(`^(accept|reject)/(pending-)?(${FAMILIES.join('|')})-`).test(String(file)) && !/^(accept|reject)\/(pending-)?tile-ink-default-/.test(String(file));
const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')) as { cases: J[] };
index.cases = index.cases.filter(entry => !own(entry.file));
for (const folder of ['accept', 'reject']) for (const name of readdirSync(path.join(root, folder))) if (own(`${folder}/${name}`)) unlinkSync(path.join(root, folder, name));
const problems: string[] = [];
for (const item of cases) {
  const draft = structuredClone(base);
  draft.document.pages[PAGE].components = item.components;
  // A case of the asks families carries an app state topic only when it uses one, so the first capability the shipped list refuses is the one the case is about.
  draft.document.dataSources.push(...(askCases.includes(item) || grammar2Cases.includes(item) || wgStyleCases.includes(item as (typeof wgStyleCases)[number]) || (wgFlowCases as unknown[]).includes(item) || wgChartCases.includes(item as (typeof wgChartCases)[number]) || (pbCases as unknown[]).includes(item) ? sources.filter(entry => entry.model !== 'app-state@1' || item.needs.includes('app-state')) : sources));
  item.tweak?.(draft);
  const bytes = () => new TextEncoder().encode(JSON.stringify(draft));
  let studioIssue: J | undefined;
  try { draft.capabilities = compileCompositionDocument(draft.document).capabilities; }
  catch { draft.capabilities = [...new Set([...draft.capabilities, ...item.needs.map(name => needsIds[name])])].sort(); }
  (item as { finish?: (envelope: J) => void }).finish?.(draft);
  try { decodeCompositionPublication(bytes()); if (item.reject) problems.push(`${item.name} was accepted`); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    const [first] = error.issues;
    studioIssue = { code: first.code, pointer: first.pointer, ...(first.capability ? { capability: first.capability } : {}) };
    if (!item.reject) problems.push(`${item.name} did not decode: ${JSON.stringify(error.issues)}`);
  }
  // A case that records its first issue by hand must get exactly that one (the WG-S1 families).
  const expect = (item as { expect?: { code: string; pointer: string } }).expect;
  if (expect && JSON.stringify([studioIssue?.code, studioIssue?.pointer]) !== JSON.stringify([expect.code, expect.pointer])) problems.push(`${item.name}: expected ${expect.code} at ${expect.pointer}, got ${JSON.stringify(studioIssue)}`);
  const { file, entry } = placeCase(item.name, item.note, item.reject ? 'reject' : 'accept', shippedIssue(shipped, draft.capabilities), item.reject ? studioIssue : undefined);
  writeFileSync(path.join(root, file), `${JSON.stringify(draft)}\n`);
  index.cases.push(entry);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

// MARK: Evaluation corpus
/**
 * Each case is a subject (an operand or a condition), an environment and the exact answer. `reads` maps `<sourceId>/<path...>` to what reading gives
 * (`{status: 'value', value}`, `{status: 'loading'}` or `{status: 'unavailable'}`); a read that is not listed is unavailable. `flow` runs the same
 * definition in flow mode (a gap is null and a condition is yes or no). An operand answers `{status: 'value', value}`, `loading` or `unavailable`;
 * a condition answers `yes`, `no` or `unknown`.
 */
/** The subject is one of `operand`, `condition`, `fill`, `symbol`, `text`, `badge`, `enabled`, `faces`, `action` or `asks`; the answer is shaped to it. */
interface Evaluation { name: string; note: string; subject: J; env: J; expected: J }
const evaluations: Evaluation[] = [];
const value = (v: unknown): J => ({ status: 'value', value: v });
const LOADING: J = { status: 'loading' }, UNAVAILABLE: J = { status: 'unavailable' };
const operand = (name: string, note: string, subject: J, expected: J, env: J = {}) => evaluations.push({ name, note, subject: { operand: subject }, env, expected });
const condition = (name: string, note: string, subject: J, expected: 'yes' | 'no' | 'unknown', env: J = {}) => evaluations.push({ name, note, subject: { condition: subject }, env, expected: { tri: expected } });
const reads = (map: Record<string, J>): J => ({ reads: map });
/** `now` is the wall time on the clock's own offset, without a zone suffix, as in a flow's context. */
const CLOCK = { now: '2026-11-15T09:30:00', utcOffsetMinutes: -480 };

condition('compare-eq-text-yes', 'eq on equal text is yes.', cmp('eq', lit('on'), lit('on')), 'yes');
condition('compare-eq-text-no', 'eq on different text is no.', cmp('eq', lit('on'), lit('off')), 'no');
condition('compare-eq-nfc', 'Text is equal when the NFC forms are: e and U+0301 equals U+00E9 (JavaScript compares code units, Swift compares canonical equivalence).', cmp('eq', lit('é'), lit('é')), 'yes');
condition('compare-eq-number-text', 'A number and the text of that number are equal: 1 and "1".', cmp('eq', lit(1), lit('1')), 'yes');
condition('compare-eq-structure-is-no', 'Only scalars compare: a list is never equal.', cmp('eq', lit([1]), lit([1])), 'no');
condition('compare-ne-null-is-no', 'A null value gives no, for ne as for eq: ne is not "not eq".', cmp('ne', lit(null), lit('a')), 'no');
condition('compare-above-yes', 'above on numbers.', cmp('above', lit(3), lit(2)), 'yes');
condition('compare-above-text-is-no', 'above takes numbers only: a numeric text gives no.', cmp('above', lit('3'), lit(2)), 'no');
condition('compare-below-read-number', 'A read as a number turns a state text into a number.', cmp('below', read('temp', ['state'], 'number'), lit(60)), 'yes', reads({ 'temp/state': value('55.5') }));
condition('compare-before-date', 'before compares dates.', cmp('before', lit('2026-11-14'), lit('2026-11-15')), 'yes');
condition('compare-after-offset', 'A date and time is compared as an instant on the clock\'s offset: 23:00 at +02:00 is 21:00 UTC.', cmp('after', lit('2026-11-15T23:00:00+02:00'), lit('2026-11-15T22:00:00Z')), 'no');
condition('compare-loading-is-unknown', 'An operand that is loading makes a comparison unknown.', cmp('above', read('temp', ['state'], 'number'), lit(60)), 'unknown', reads({ 'temp/state': LOADING }));
condition('compare-unavailable-is-unknown', 'An operand that is unavailable makes a comparison unknown, not no.', cmp('eq', read('temp', ['state']), lit('on')), 'unknown');
condition('compare-wrong-kind-is-no', 'A value of the wrong kind is a value: no, not unknown.', cmp('above', read('temp', ['state'], 'string'), lit(60)), 'no', reads({ 'temp/state': value('warm') }));
condition('compare-flow-gap-is-no', 'In flow mode a gap is null, so a comparison is no.', cmp('above', read('temp', ['state'], 'number'), lit(60)), 'no', { flow: true });
condition('in-found', 'in is yes when any option matches.', { type: 'in', value: lit('on'), in: [lit('off'), lit('on')] }, 'yes');
condition('in-not-found', 'in is no when none matches.', { type: 'in', value: lit('x'), in: [lit('off'), lit('on')] }, 'no');
condition('in-unavailable-option-unknown', 'An option that is unavailable keeps in unknown when nothing else matched.', { type: 'in', value: lit('x'), in: [lit('off'), read('temp', ['state'])] }, 'unknown');
condition('in-match-beats-unavailable', 'A match settles in even when another option is unavailable.', { type: 'in', value: lit('off'), in: [lit('off'), read('temp', ['state'])] }, 'yes');
condition('in-unavailable-subject', 'A subject that is unavailable is unknown.', { type: 'in', value: read('temp', ['state']), in: [lit('off')] }, 'unknown');
condition('exists-value', 'exists is yes for a value.', { type: 'exists', value: lit('a') }, 'yes');
condition('exists-null', 'exists is no for a null value.', { type: 'exists', value: lit(null) }, 'no');
condition('exists-unavailable', 'exists is unknown for an unavailable operand.', { type: 'exists', value: read('temp', ['state']) }, 'unknown');
condition('exists-flow-gap', 'In flow mode an unavailable operand is null, so exists is no.', { type: 'exists', value: read('temp', ['state']) }, 'no', { flow: true });
condition('all-no-beats-unknown', 'One no settles all.', { type: 'all', of: [cmp('eq', read('temp', ['state']), lit('a')), cmp('eq', lit(1), lit(2))] }, 'no');
condition('all-yes-and-unknown', 'all of yes and unknown is unknown.', { type: 'all', of: [cmp('eq', read('temp', ['state']), lit('a')), cmp('eq', lit(1), lit(1))] }, 'unknown');
condition('any-yes-beats-unknown', 'One yes settles any.', { type: 'any', of: [cmp('eq', read('temp', ['state']), lit('a')), cmp('eq', lit(1), lit(1))] }, 'yes');
condition('not-unknown', 'not of unknown is unknown.', { type: 'not', of: cmp('eq', read('temp', ['state']), lit('a')) }, 'unknown');
condition('not-no', 'not of no is yes.', { type: 'not', of: cmp('eq', lit(1), lit(2)) }, 'yes');
condition('legacy-state-yes', 'The state leaf still works on a value.', { type: 'state', sourceId: 'guest-fan', path: ['state'], in: ['on', 'auto'] }, 'yes', reads({ 'guest-fan/state': value('on') }));
condition('legacy-numeric-unknown', 'The numeric leaf is unknown while its source is loading.', { type: 'numeric', sourceId: 'temp', path: ['state'], above: lit(1) }, 'unknown', reads({ 'temp/state': LOADING }));
condition('legacy-viewer-admin', 'The viewer leaf asks the signed-in person.', { type: 'viewer', isAdmin: true }, 'yes', { viewer: { isAdmin: true } });
condition('app-window-compact', 'A window width class compares as text.', cmp('eq', read('app-window', ['widthClass']), lit('compact')), 'yes', reads({ 'app-window/widthClass': value('compact') }));
condition('app-clock-minute-of-day', 'The minute of the day compares as a number: after 09:00 and before 17:00.', { type: 'all', of: [cmp('above', read('app-clock', ['minuteOfDay'], 'number'), lit(540)), cmp('below', read('app-clock', ['minuteOfDay'], 'number'), lit(1020))] }, 'yes', reads({ 'app-clock/minuteOfDay': value(570) }));
condition('app-phase-loading', 'A topic that has not answered yet is unknown to a condition that reads its field, and says loading in its phase.', cmp('eq', read('app-window', ['widthClass']), lit('compact')), 'unknown', reads({ 'app-window/widthClass': LOADING }));
condition('count-above-zero', 'A home status count above zero.', cmp('above', read('lights', ['count'], 'number'), lit(0)), 'yes', reads({ 'lights/count': value(18) }));
condition('clock-before-date', 'The clock gives today as a date.', cmp('before', { type: 'clock', part: 'today' }, lit('2026-12-01')), 'yes', { clock: CLOCK });
condition('clock-missing-is-unknown', 'Without a clock, the clock operand is unavailable and the comparison unknown.', cmp('before', { type: 'clock', part: 'today' }, lit('2026-12-01')), 'unknown');

const hotRule = (count: J) => choose([[cmp('above', count, lit(1)), lit('many')], [cmp('eq', count, lit(1)), lit('one')]], lit('none'));
operand('choose-first-case', 'The first case that holds gives the value.', hotRule(read('n', ['count'], 'number')), value('many'), reads({ 'n/count': value(3) }));
operand('choose-second-case', 'A later case holds when the first does not.', hotRule(read('n', ['count'], 'number')), value('one'), reads({ 'n/count': value(1) }));
operand('choose-otherwise', 'No case holding gives otherwise.', hotRule(read('n', ['count'], 'number')), value('none'), reads({ 'n/count': value(0) }));
operand('choose-unknown-case-is-loading', 'A case that cannot be answered stops the rule: the slot keeps what it showed.', hotRule(read('n', ['count'], 'number')), LOADING, reads({ 'n/count': LOADING }));
operand('choose-unknown-before-yes', 'A later case that holds cannot stand in for an earlier one that is unknown.', choose([[cmp('eq', read('n', ['state']), lit('a')), lit('first')], [cmp('eq', lit(1), lit(1)), lit('second')]], lit('none')), LOADING);
operand('choose-flow-gap-falls-through', 'In flow mode a gap is no, so the rule moves on.', choose([[cmp('eq', read('n', ['state']), lit('a')), lit('first')], [cmp('eq', lit(1), lit(1)), lit('second')]], lit('none')), value('second'), { flow: true });
operand('choose-nested', 'A rule inside a rule.', choose([[cmp('eq', lit(1), lit(1)), choose([[cmp('eq', lit(1), lit(2)), lit('a')]], lit('b'))]], lit('c')), value('b'));
operand('choose-plural-text', 'The usual plural: one chore, 3 chores.', choose([[cmp('eq', read('n', ['count'], 'number'), lit(1)), lit('1 chore')]], fmt('{n} chores', { n: read('n', ['count'], 'number') })), value('3 chores'), reads({ 'n/count': value(3) }));
operand('format-number-text', 'A number prints as Swift prints a Double: 0.000001 is 1e-06.', fmt('{n}', { n: lit(0.000001) }), value('1e-06'));
operand('format-whole-number', 'A whole number has no fraction: 3 is "3".', fmt('{n}', { n: lit(3) }), value('3'));
operand('format-digits', 'maximumFractionDigits trims trailing zeros: 2.50 with two digits is "2.5".', fmt('{n}', { n: lit(2.5) }, { n: { number: { maximumFractionDigits: 2 } } }), value('2.5'));
operand('format-loading-beats-unavailable', 'loading is reported before unavailable.', fmt('{a}{b}', { a: read('x', ['state']), b: read('y', ['state']) }), LOADING, reads({ 'y/state': LOADING }));
operand('format-null-arg-unavailable', 'A null argument has no text: the format is unavailable.', fmt('{a}', { a: lit(null) }), UNAVAILABLE);
operand('math-round-half-away', 'round sends a tie away from zero: -2.5 gives -3.', { type: 'math', op: 'round', args: [lit(-2.5)] }, value(-3));
operand('math-divide-zero', 'Dividing by zero is unavailable.', { type: 'math', op: 'divide', args: [lit(1), lit(0)] }, UNAVAILABLE);
operand('map-null-subject', 'A null subject matches nothing and is unavailable.', { type: 'map', of: lit(null), cases: [{ equals: 'a', then: lit(1) }], otherwise: lit(2) }, UNAVAILABLE);
operand('map-text-number-match', 'A case matches the text of a number: "1" matches 1.', { type: 'map', of: lit('1'), cases: [{ equals: 1, then: lit('one') }], otherwise: lit('other') }, value('one'));
operand('object-gap-unavailable', 'In a document an object with a gap is unavailable as a whole.', { type: 'object', fields: { a: lit(1), b: read('x', ['state']) } }, UNAVAILABLE);
operand('object-gap-flow', 'In flow mode the gap is null and the object stands.', { type: 'object', fields: { a: lit(1), b: read('x', ['state']) } }, value({ a: 1, b: null }), { flow: true });
operand('list-gap-flow', 'The same for a list in flow mode.', { type: 'list', items: [lit(1), read('x', ['state'])] }, value([1, null]), { flow: true });
operand('read-entity-id-pattern', 'A read as entity-id keeps only text shaped like an entity id.', read('x', ['state'], 'entity-id'), UNAVAILABLE, reads({ 'x/state': value('not an id') }));
operand('read-boolean-text', 'A read as a boolean turns "true" into true.', read('x', ['state'], 'boolean'), value(true), reads({ 'x/state': value('true') }));
operand('clock-today', 'today is the date on the clock\'s own wall time.', { type: 'clock', part: 'today' }, value('2026-11-15'), { clock: { now: '2026-11-15T23:30:00', utcOffsetMinutes: -300 } });
operand('date-days-between', 'Whole days between two dates.', { type: 'date', op: 'days-between', from: lit('2026-11-10'), to: lit('2026-11-15') }, value(5));
operand('date-invalid', 'An invalid date is unavailable.', { type: 'date', op: 'days-between', from: lit('2026-13-10'), to: lit('2026-11-15') }, UNAVAILABLE);
operand('item-path', 'item reads a field of the item a step looks at.', { type: 'item', path: ['a', 'b'] }, value(7), { item: { a: { b: 7 } } });
operand('item-missing', 'A missing item path is null: a value, not unavailable.', { type: 'item', path: ['z'] }, value(null), { item: { a: 1 } });
operand('param-value', 'param reads a declared parameter.', { type: 'param', name: 'p' }, value('x'), { params: { p: 'x' } });
operand('viewer-before-known', 'A viewer fact is loading before the connection knows the person.', { type: 'viewer', field: 'userId' }, LOADING);
operand('expr-string-with-count', 'The text a slot shows: a count and a total.', fmt('{n} of {m} on', { n: read('lights', ['count'], 'number'), m: read('lights', ['total'], 'number') }), value('18 of 24 on'), reads({ 'lights/count': value(18), 'lights/total': value(24) }));

evaluations.push(...askEvaluations as Evaluation[]);
evaluations.push(...grammar2Evaluations as Evaluation[]);
evaluations.push(...layoutEvaluations as Evaluation[]);
evaluations.push(...wgStyleEvaluations as Evaluation[]);
evaluations.push(...wgFlowEvaluations as Evaluation[]);
evaluations.push(...wgChartEvaluations as Evaluation[]);
evaluations.push(...wgDialEvaluations as Evaluation[]);
evaluations.push(...neEvaluations as Evaluation[]);
evaluations.push(...pbEvaluations as Evaluation[]);
evaluations.push(...dialCtlEvaluations as Evaluation[]);
evaluations.push(...countEvaluations as Evaluation[]);
evaluations.push(...foldSidesEvaluations as Evaluation[]);
const evaluationRoot = path.join(root, 'evaluation');
mkdirSync(evaluationRoot, { recursive: true });
for (const name of readdirSync(evaluationRoot)) if (name.endsWith('.json')) unlinkSync(path.join(evaluationRoot, name));
const seen = new Set<string>();
for (const entry of evaluations) {
  if (seen.has(entry.name)) throw new Error(`duplicate evaluation ${entry.name}`);
  seen.add(entry.name);
  const { name, ...rest } = entry;
  writeFileSync(path.join(evaluationRoot, `${name}.json`), `${JSON.stringify({ format: 1, name, ...rest }, null, 2)}\n`);
}
console.log(`wrote ${cases.length} publication cases (${cases.filter(item => !item.reject).length} compile) and ${evaluations.length} evaluation cases`);
