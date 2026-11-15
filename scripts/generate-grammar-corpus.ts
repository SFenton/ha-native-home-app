/**
 * Writes the `grammar-*` cases of the shared publication corpus: accepted and rejected envelopes for the generic
 * grammar (call-service, bound controls, operands, predicates, visibleWhen, selectedWhen). Each case is the shared
 * first-slice fixture with its third page's body replaced, so the files stay small and readable.
 *
 *   tsx scripts/generate-grammar-corpus.ts            # rewrites contract/corpus/{accept,reject}/grammar-*.json and their index entries
 *
 * Accepted capability lists come from the Studio compiler; a rejected case records the Studio's first issue. Run
 * `scripts/app-corpus-check/run.sh` afterwards: the app's compiler must agree with every line.
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';

type J = Record<string, any>;
const root = path.resolve(import.meta.dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(root, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const PAGE = 2;

// MARK: Builders
const lit = (value: unknown) => ({ type: 'literal', value });
const read = (sourceId: string, p: string[], as = 'string') => ({ type: 'read', from: { type: 'source', sourceId, path: p }, as, missing: 'unavailable' });
const isOn: J = { type: 'state', sourceId: 'guest-fan', path: ['state'], in: ['on'] };
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const call = (service: string, extra: J = {}, domain = 'fan'): J =>
  ({ type: 'call-service', domain, service, target: { entity_id: lit('fan.demo_bath_fan') }, ...extra });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, extra: J = {}): J => node(id, 'text', { props: { value: lit('Timer'), style: 'body', unavailableText: 'None' }, ...extra });
const button = (action: J, id = 'go'): J => node(id, 'primary-button', { props: {}, action });
const control = (id: string, props: J, rest: J = {}): J => node(id, 'bound-control', { props: { unavailableText: 'Unavailable', ...props }, ...rest });
const section = (style: string, children: J[]): J => node('s', 'section', {
  props: { header: 'S', footer: '', style, density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children,
});
const toggle = (id: string, props: J = {}, rest: J = {}) => control(id, { kind: 'toggle', isOn, ...props }, { onAction: call('turn_on'), offAction: call('turn_off'), ...rest });
const fanSources: J[] = [
  { id: 'guest-fan', kind: 'ha-entity', entityId: lit('fan.demo_bath_fan') },
  { id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') },
];
const panel: J = { id: 'panel', type: 'choice', initial: 'a', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };

interface Case { name: string; outcome: 'accept' | 'reject'; note: string; components: J[]; tweak?: (envelope: J) => void; localState?: J[]; fallback?: string[] }
const cases: Case[] = [];
const accept = (name: string, note: string, components: J[], more: Partial<Case> = {}) => cases.push({ name, outcome: 'accept', note, components, ...more });
const reject = (name: string, note: string, components: J[], more: Partial<Case> = {}) => cases.push({ name, outcome: 'reject', note, components, ...more });
const badCall = (edit: (value: J) => void) => { const value = call('turn_on'); edit(value); return [button(value)]; };
const dataCall = (operand: unknown) => [button({ type: 'call-service', domain: 'x', service: 'y', data: { type: 'object', fields: { v: operand } } })];
const when = (predicate: J, extra: J = {}) => [text('t', { visibleWhen: predicate, ...extra })];
const chain = (operand: J, wrap: (inner: J) => J, times: number) => { let value = operand; for (let i = 0; i < times; i++) value = wrap(value); return value; };
const add = (inner: J): J => ({ type: 'math', op: 'add', args: [inner, lit(1)] });

// MARK: Accepted
accept('grammar-call-service-button', 'A button calls any domain and service with a literal target and optimistic state.',
  [button(call('turn_on', { optimistic: [{ sourceId: 'guest-fan', value: 'on', revertAfterSeconds: 2, failsOnTimeout: false }] }))]);
accept('grammar-call-service-script-and-lock', 'Any script name and a lock service with an authored confirmation are accepted; the app keeps no allow list.',
  [button({ type: 'call-service', domain: 'script', service: 'goodnight_routine' }, 'script'),
    button({ type: 'call-service', domain: 'lock', service: 'unlock', target: { entity_id: lit('lock.demo_front_door') },
      confirmation: { type: 'additional', style: 'alert', title: 'Unlock?', confirmLabel: 'Unlock', cancelLabel: 'Cancel', destructive: true, exemptUserIds: ['u1'] } }, 'lock')]);
accept('grammar-call-service-operands', 'Call data and target built from every operand kind: read, viewer, format, map, math, list and object.',
  [button({
    type: 'call-service', domain: 'notify', service: 'mobile_app',
    target: { entity_id: read('guest-fan', ['state'], 'entity-id'), area_id: { type: 'list', items: [lit('demo_area')] } },
    data: { type: 'object', fields: {
      who: { type: 'viewer', field: 'userId' },
      message: { type: 'format', pattern: '{n} degrees at {s}', args: { n: read('temp', ['state'], 'number'), s: read('guest-fan', ['attributes', 'preset_mode']) }, formats: { n: { number: { maximumFractionDigits: 1 } } } },
      mode: { type: 'map', of: { type: 'viewer', field: 'isAdmin' }, cases: [{ equals: true, then: lit('admin') }], otherwise: lit('member') },
      level: { type: 'math', op: 'scale', args: [read('temp', ['state'], 'number'), lit(0), lit(100), lit(0), lit(1)] },
      extras: { type: 'object', fields: { tags: { type: 'list', items: [lit('a'), lit(2), lit(true)] }, raw: lit({ k: [1, 2] }) } },
    } },
  })]);
accept('grammar-bound-toggle-tile', 'A bound toggle on a glass tile with on and off calls.',
  [toggle('t', { surface: 'tile' }, { icon: symbol('fan') })]);
accept('grammar-bound-toggle-row-in-module-list', 'A bound toggle row is allowed in a module list; a bound control without a visibleWhen rule.',
  [section('module-list', [toggle('t')])]);
accept('grammar-bound-slider', 'A bound slider reads a number attribute and sends the control value.',
  [control('s', { kind: 'slider', value: read('guest-fan', ['attributes', 'percentage'], 'number') },
    { action: call('set_percentage', { data: { type: 'object', fields: { percentage: { type: 'control' } } } }) })]);
accept('grammar-bound-stepper', 'A bound stepper with a range, a value format and a clamped control value.',
  [control('st', { kind: 'stepper', value: read('temp', ['state'], 'number'), range: { min: 60, max: 80, step: 1 }, format: '{value} degrees' },
    { action: call('set_temperature', { data: { type: 'object', fields: { temperature: { type: 'math', op: 'clamp', args: [{ type: 'control' }, lit(60), lit(80)] } } } }, 'climate') })]);
accept('grammar-bound-choice', 'A bound choice: each option has its own selectedWhen predicate and call.',
  [control('c', { kind: 'choice', options: ['low', 'high'].map(id => ({ id, label: id, selectedWhen: { type: 'state', sourceId: 'guest-fan', path: ['attributes', 'preset_mode'], in: [id] }, action: call(`set_${id}`) })) })]);
accept('grammar-bound-button', 'A bound button with a confirmation and no control value.',
  [control('b', { kind: 'button' }, { action: call('toggle', { confirmation: { type: 'additional', style: 'dialog', title: 'Toggle the fan?', confirmLabel: 'Toggle', cancelLabel: 'Cancel', destructive: false } }) })]);
accept('grammar-visible-when-node', 'A node shown by a combined predicate (state, viewer, viewer-person, numeric, not) with an explicit unknown policy.',
  when({ type: 'all', of: [isOn, { type: 'viewer', isAdmin: true, userIds: ['u1'] }, { type: 'not', of: { type: 'viewer-person', in: ['away'] } },
    { type: 'numeric', sourceId: 'temp', path: ['state'], above: lit(70), below: read('temp', ['attributes', 'max'], 'number') }] }, { whenUnknown: 'hide' }));
accept('grammar-visible-when-default-unknown', 'A rule with no whenUnknown keeps the node as it was (the default) and uses any/state only.',
  when({ type: 'any', of: [isOn, { type: 'state', sourceId: 'temp', path: ['state'], in: ['1', '2'] }] }));
accept('grammar-visible-when-in-grid-and-plain-section', 'A rule hides a child in place in a tile grid and in a plain section.',
  [node('g', 'tile-grid', { props: { minimum: 'tile@1', maxColumns: 2, spacing: { type: 'token', name: 'm' }, equalRowHeights: false, shortRow: 'share', fold: 'page' },
    children: [text('g1', { visibleWhen: { type: 'viewer', isAdmin: true } })] }),
  section('plain', [text('s1', { visibleWhen: { type: 'viewer', isAdmin: false } })])]);
accept('grammar-visible-when-tab', 'A navigation tab hidden by a rule.', [], { tweak: envelope => {
  Object.assign(envelope.document.navigation.tabs[1], { visibleWhen: { type: 'viewer', isAdmin: true }, whenUnknown: 'show' });
} });
accept('grammar-selected-when-local-tabs', 'Local tabs choose their panel from entity state (selectedWhen, first match).',
  [node('tabs', 'local-tabs', { props: { stateId: 'panel', transition: 'canonical-swap@1', automatic: [{ tabId: 'b', selectedWhen: isOn }] },
    tabs: [{ id: 'a', label: 'A', children: [] }, { id: 'b', label: 'B', children: [] }] })], { localState: [panel] });

// MARK: Rejected: call-service
const at = '/document/pages/2/components/0';
reject('grammar-call-domain-uppercase', 'A domain must match ^[a-z][a-z0-9_]{0,63}$.', badCall(c => { c.domain = 'Fan'; }));
reject('grammar-call-service-with-space', 'A service must match ^[a-z][a-z0-9_]{0,63}$.', badCall(c => { c.service = 'turn on'; }));
reject('grammar-call-target-unknown-key', 'A target key must be entity_id, device_id, area_id, floor_id or label_id.', badCall(c => { c.target = { entityid: lit('fan.demo_bath_fan') }; }));
reject('grammar-call-target-literal-not-text', 'A literal target must be text or a list of text.', badCall(c => { c.target = { entity_id: lit(3) }; }));
reject('grammar-call-target-key-also-in-data', 'A target key cannot also be a data field.', badCall(c => { c.data = { type: 'object', fields: { entity_id: lit('x') } }; }));
reject('grammar-call-optimistic-unknown-source', 'An optimistic value names a declared source.', badCall(c => { c.optimistic = [{ sourceId: 'nope', value: 'on', revertAfterSeconds: 2, failsOnTimeout: false }]; }));
reject('grammar-call-optimistic-not-ha-entity', 'An optimistic value needs an ha-entity source, not a model source.', badCall(c => { c.optimistic = [{ sourceId: 'source-power', value: 'on', revertAfterSeconds: 2, failsOnTimeout: false }]; }));
reject('grammar-call-control-outside-bound-control', 'The control value exists only on a bound control\'s own call.', badCall(c => { c.data = { type: 'object', fields: { v: { type: 'control' } } }; }));
reject('grammar-call-unknown-field', 'A call carries no fields beyond the grammar.', badCall(c => { c.extra = 1; }));
reject('grammar-operand-read-unknown-source', 'A read names a declared source.', dataCall(read('ghost', ['state'])));
reject('grammar-operand-read-not-ha-entity', 'A read in an expression needs an ha-entity source.', dataCall(read('source-power', ['isOn'], 'boolean')));
reject('grammar-operand-read-path-not-state-or-attributes', 'An ha-entity read path is ["state"] or ["attributes", ...].', dataCall(read('guest-fan', ['brightness'])));
reject('grammar-operand-read-path-proto', 'A path segment cannot be a prototype name.', dataCall(read('guest-fan', ['__proto__'])));
reject('grammar-operand-read-state-as-boolean', 'The state is text, so it cannot be read as a boolean.', dataCall(read('guest-fan', ['state'], 'boolean')));
reject('grammar-operand-depth-over-eight', 'Expressions nest at most eight levels.', dataCall(chain(lit(1), add, 8)));
reject('grammar-operand-list-over-64', 'A list holds at most 64 items.', dataCall({ type: 'list', items: Array.from({ length: 65 }, () => lit(1)) }));
reject('grammar-operand-literal-text-over-2000', 'A literal text is at most 2,000 characters.', dataCall(lit('x'.repeat(2001))));
reject('grammar-operand-math-arity', 'divide takes exactly two arguments.', dataCall({ type: 'math', op: 'divide', args: [lit(1)] }));
reject('grammar-operand-format-missing-argument', 'Every {hole} of a format pattern needs an argument.', dataCall({ type: 'format', pattern: '{a} {b}', args: { a: lit(1) } }));
reject('grammar-operand-template', 'There is no template operand and no client-side Jinja.', dataCall({ type: 'template', value: "{{ states('x') }}" }));
reject('grammar-operand-viewer-field', 'A viewer fact is userId, isAdmin or personEntityId.', dataCall({ type: 'viewer', field: 'token' }));
reject('grammar-operand-literal-null', 'A literal cannot be null.', dataCall({ type: 'literal', value: null }));
// MARK: Rejected: predicates and visibility
reject('grammar-predicate-unknown-source', 'A predicate names a declared source.', when({ type: 'state', sourceId: 'nope', path: ['state'], in: ['on'] }));
reject('grammar-predicate-not-ha-entity', 'A predicate needs an ha-entity source.', when({ type: 'state', sourceId: 'source-power', path: ['state'], in: ['on'] }));
reject('grammar-predicate-empty-in', 'A state predicate lists at least one state.', when({ type: 'state', sourceId: 'guest-fan', path: ['state'], in: [] }));
reject('grammar-predicate-numeric-without-bound', 'A numeric predicate needs above or below.', when({ type: 'numeric', sourceId: 'temp', path: ['state'] }));
reject('grammar-predicate-viewer-empty', 'A viewer predicate needs isAdmin or userIds.', when({ type: 'viewer' }));
reject('grammar-predicate-all-empty', 'all needs at least one predicate.', when({ type: 'all', of: [] }));
reject('grammar-predicate-time', 'There is no time predicate yet.', when({ type: 'time', after: '22:00' }));
reject('grammar-predicate-control-operand', 'A predicate operand cannot use the control value.', when({ type: 'numeric', sourceId: 'temp', path: ['state'], above: { type: 'control' } }));
reject('grammar-predicate-depth-over-eight', 'Predicates nest at most eight levels.', when(chain(isOn, inner => ({ type: 'not', of: inner }), 8)));
reject('grammar-when-unknown-without-rule', 'whenUnknown means nothing without a visibleWhen.', [text('t', { whenUnknown: 'show' })]);
reject('grammar-visible-when-in-module-list', 'A module list lets no child go: a visibleWhen on one of its rows is refused.',
  [section('module-list', [toggle('t', {}, { visibleWhen: { type: 'viewer', isAdmin: true } })])]);
reject('grammar-visible-when-in-paged-row', 'A paged row lets no child go.',
  [node('p', 'paged-row', { props: { perPage: 2, pageLabel: 'Page', showsIndicator: true }, children: [text('t', { visibleWhen: { type: 'viewer', isAdmin: true } })] })]);
reject('grammar-visible-when-in-room-section', 'A room section lets no child go.',
  [node('r', 'room-section', { props: { arrangement: 'grid', leadJoinsAtRegularWidth: false }, children: [text('t', { visibleWhen: { type: 'viewer', isAdmin: true } })] })]);
reject('grammar-selected-when-unknown-tab', 'An automatic rule names one of the local tabs.',
  [node('tabs', 'local-tabs', { props: { stateId: 'panel', transition: 'canonical-swap@1', automatic: [{ tabId: 'zzz', selectedWhen: isOn }] },
    tabs: [{ id: 'a', label: 'A', children: [] }, { id: 'b', label: 'B', children: [] }] })], { localState: [panel] });
// MARK: Rejected: bound controls
reject('grammar-bound-toggle-missing-off-action', 'A bound toggle needs onAction and offAction.', [control('t', { kind: 'toggle', isOn }, { onAction: call('turn_on') })]);
reject('grammar-bound-toggle-extra-action', 'A toggle sends through onAction and offAction only.', [toggle('t', {}, { action: call('x') })]);
reject('grammar-bound-toggle-missing-is-on', 'A bound toggle reads isOn.', [control('t', { kind: 'toggle' }, { onAction: call('a'), offAction: call('b') })]);
reject('grammar-bound-button-with-surface', 'Only a toggle has a surface.', [control('b', { kind: 'button', surface: 'tile' }, { action: call('x') })]);
reject('grammar-bound-stepper-step-does-not-divide', 'A stepper\'s range must be reachable in whole steps.',
  [control('s', { kind: 'stepper', value: lit(1), range: { min: 0, max: 10, step: 3 } }, { action: call('x') })]);
reject('grammar-bound-stepper-format-without-hole', 'A stepper format carries a {value} hole.',
  [control('s', { kind: 'stepper', value: lit(1), range: { min: 0, max: 10, step: 1 }, format: 'no hole' }, { action: call('x') })]);
reject('grammar-bound-slider-with-range', 'A slider is the canonical 0 to 100 row and takes no range.',
  [control('s', { kind: 'slider', value: lit(1), range: { min: 0, max: 100, step: 5 } }, { action: call('x') })]);
reject('grammar-bound-button-control-value', 'A button has no control value.',
  [control('b', { kind: 'button' }, { action: call('x', { data: { type: 'object', fields: { v: { type: 'control' } } } }) })]);
reject('grammar-bound-button-in-module-list', 'Only a bound toggle row, stepper, slider or choice fits a module list.',
  [section('module-list', [control('b', { kind: 'button' }, { action: call('x') })])]);

// MARK: Writing
function envelope(item: Case, capabilities?: string[]): J {
  const value = structuredClone(base);
  const document = value.document;
  document.pages[PAGE].components = item.components;
  document.dataSources.push(...fanSources);
  if (item.localState) document.localState = item.localState;
  item.tweak?.(value);
  if (capabilities) value.capabilities = capabilities;
  return value;
}
const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')) as { cases: J[] };
index.cases = index.cases.filter(entry => !String(entry.file).includes('/grammar-'));
for (const folder of ['accept', 'reject']) for (const name of readdirSync(path.join(root, folder))) if (name.startsWith('grammar-')) unlinkSync(path.join(root, folder, name));
for (const item of cases) {
  const file = `${item.outcome}/${item.name}.json`;
  const draft = envelope(item);
  let issue: J | undefined;
  if (item.outcome === 'accept') draft.capabilities = compileCompositionDocument(draft.document).capabilities;
  else {
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
console.log(`wrote ${cases.length} cases (${cases.filter(item => item.outcome === 'accept').length} accept)`);
void at;
