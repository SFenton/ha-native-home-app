/**
 * The corpus cases of the format fields the condition and value editors need: `enabledWhen`, the tile look conditions, `bound-color` and `bound-symbol`,
 * the text `fallback`, badges, an action chosen by rule, `confirmation.when`, `fallbackTabId`, the list parts and the date format. This module only
 * holds the cases; `generate-expression-corpus.ts` writes them with its own, so one generator owns `contract/corpus/evaluation`.
 *
 * Publication cases are `pending-<family>-*` (the Studio compiles them) and `<family>-*` (the Studio refuses them); where each file lives depends on which ids the app ships (`corpus-handshake.ts`).
 * Evaluation cases are hand-written answers. The clamped colors below come from an independent port of `ChipTint.fromWeb`, checked against the
 * app's own anchor (`0x009688` gives the fill `0x006E63`, `ChipTint.swift:50-52`), never from the Studio's code.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type J = Record<string, any>;
const root = path.resolve(import.meta.dirname, '../contract/corpus');

export interface AskCase { name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean }
export interface AskEvaluation { name: string; note: string; subject: J; env: J; expected: J }
/** The families this module owns: `reject/pending-<family>-*` and `reject/<family>-*`. */
export const askFamilies = ['enabled-when', 'tile-look', 'bound-color', 'bound-symbol', 'text-fallback', 'badge', 'action-rules', 'confirm-when', 'tab-fallback', 'list-parts', 'date-format'];
/** Capability ids by the short names the cases use. */
export const askNeeds: Record<string, string> = {
  'enabled-when': 'sh.enabled-when@1', 'tile-look': 'sh.tile-look@1', badges: 'sh.badges@1', 'action-rules': 'sh.action-rules@1', 'confirm-when': 'sh.confirm-when@1',
  'tab-fallback': 'sh.tab-fallback@1', 'list-parts': 'sh.list-parts@1',
};

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const cmp = (op: string, left: J, right: J): J => ({ type: 'compare', op, left, right });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const rgb = (red: number, green: number, blue: number): J => ({ type: 'solid-rgb', red, green, blue });
const STANDARD: J = { type: 'standard' };
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const hot: J = cmp('above', read('temp', ['state'], 'number'), lit(75));
const cold: J = cmp('below', read('temp', ['state'], 'number'), lit(60));
const conditional = (cases: [J, J][], otherwise: J): J => ({ type: 'conditional', cases: cases.map(([when, then]) => ({ when, then })), otherwise });
const push = (pageId = 'page-lattice'): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const call = (extra: J = {}): J => ({ type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.demo_lamp') }, ...extra });
const row = (id: string, rest: J = {}): J => node(id, 'row', {
  props: { primary: lit('Lamp'), secondary: lit(''), value: lit(''), accessory: 'none', loadingText: 'Loading', unavailableText: 'Unavailable' }, ...rest,
});
const button = (id: string, rest: J = {}): J => node(id, 'primary-button', { props: {}, action: push(), ...rest });
const stateTile = (id: string, rest: J = {}): J => node(id, 'state-tile', { icon: symbol('lock'), binding: { entityId: 'lock.demo_door', builtIn: 'lock' }, props: {}, ...rest });
const chip = (appearance: J, rest: J = {}): J => node('chip', 'status-chip', {
  props: { sourceId: 'lights', states: [{ state: 'active', appearance }], fallback: { icon: symbol('lightbulb'), fill: STANDARD }, announcement: 'none' }, ...rest,
});
const navTile = (id: string, presentation: J | undefined, rest: J = {}): J => node(id, 'navigation-tile', {
  icon: symbol('house'), props: { family: 'neutral', selected: 'none', subtitle: lit('x'), ...(presentation ? { presentation } : {}) }, action: push(), ...rest,
});
const enabledWhen = (condition: J, whenUnknown = 'disabled'): J => ({ condition, whenUnknown });
const rowCollection = (providerId: string, props: J = {}, id = 'rows'): J => node(id, 'row-collection', {
  props: { providerId, loadingText: 'Loading', emptyText: 'Nothing here', unavailableText: 'Unavailable', errorText: 'Could not update', staleText: 'Out of date', ...props },
});
/** A flow from the pipeline corpus: `upcoming` has "When pulled", `overdue` is live and has no refresh. */
const flow = (id: 'upcoming' | 'overdue'): J => {
  const file = id === 'upcoming' ? 'pipeline-upcoming-chores' : 'pipeline-overdue-chores';
  // The case sits under `accept/` once its capability ships and under `reject/pending-` while it is pending.
  const kept = path.join(root, `accept/${file}.json`);
  const envelope = JSON.parse(readFileSync(existsSync(kept) ? kept : path.join(root, `reject/pending-${file}.json`), 'utf8'));
  return envelope.document.dataSources.find((entry: J) => entry.id === id);
};
const chromeButton = (badge: J): J => ({
  id: 'chrome-bell', type: 'button', label: 'Alerts', menuLabel: 'Alerts', icon: symbol('bell'), visibility: 'always', priority: 'normal', rail: 'eligible', badge, action: push(),
});

export const askCases: AskCase[] = [];
const accept = (name: string, note: string, needs: string[], components: J[], tweak?: AskCase['tweak']) => askCases.push({ name, note, needs, components, tweak, reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], tweak?: AskCase['tweak']) => askCases.push({ name, note, needs, components, tweak, reject: true });
const withTabs = (envelope: J, badge: J) => { envelope.document.navigation.tabs[0].badge = badge; };

// MARK: enabledWhen
accept('pending-enabled-when-row', 'A row with an action is enabled only while a condition holds; while it cannot be answered it stays disabled.', ['enabled-when'],
  [row('r', { action: push(), enabledWhen: enabledWhen(hot) })]);
accept('pending-enabled-when-button', 'A button keeps what it was while the condition cannot be answered.', ['enabled-when'],
  [button('b', { enabledWhen: enabledWhen(hot, 'keep') })]);
accept('pending-enabled-when-bound-control', 'A bound control is enabled by a condition over an app state topic.', ['enabled-when', 'conditions', 'app-state'],
  [node('c', 'bound-control', { props: { kind: 'button', unavailableText: 'Unavailable' }, action: call(), enabledWhen: enabledWhen(cmp('eq', read('app-window', ['widthClass']), lit('regular')), 'enabled') })]);
accept('pending-enabled-when-state-tile', 'A state tile is enabled by a condition.', ['enabled-when'], [stateTile('t', { enabledWhen: enabledWhen(hot) })]);
reject('enabled-when-row-without-action', 'enabledWhen needs an action to enable: a row with none is refused.', ['enabled-when'], [row('r', { enabledWhen: enabledWhen(hot) })]);
reject('enabled-when-missing-policy', 'enabledWhen always says what to do while the condition cannot be answered.', ['enabled-when'], [button('b', { enabledWhen: { condition: hot } })]);
reject('enabled-when-visibility-policy', 'The policies are enabled, disabled and keep; show and hide belong to visibleWhen.', ['enabled-when'], [button('b', { enabledWhen: enabledWhen(hot, 'show') })]);
reject('enabled-when-on-text', 'A text node has nothing to enable.', ['enabled-when'], [node('t', 'text', { props: { value: lit('x'), style: 'body', unavailableText: 'None' }, enabledWhen: enabledWhen(hot) })]);
reject('enabled-when-unknown-reference', 'The condition reads a source the document has.', ['enabled-when'],
  [button('b', { enabledWhen: enabledWhen(cmp('above', read('missing', ['state'], 'number'), lit(1))) })]);

// MARK: Tile look conditions
accept('pending-tile-look-all', 'A state tile whose active, filled and error faces follow conditions, each overriding the style.', ['tile-look'],
  [stateTile('t', { activeWhen: hot, filledWhen: cold, errorWhen: cmp('eq', read('guest-fan', ['state']), lit('off')) })]);
reject('tile-look-on-navigation-tile', 'Only a state tile has the three faces.', ['tile-look'], [navTile('n', undefined, { activeWhen: hot })]);
reject('tile-look-unknown-source', 'A look condition reads a source the document has.', ['tile-look'], [stateTile('t', { errorWhen: cmp('above', read('missing', ['state'], 'number'), lit(1)) })]);

// MARK: bound-color
const tealFallback = rgb(60, 60, 67);
accept('pending-bound-color-chip', 'A chip whose fill and glyph come from an entity color; each has an exact fallback.', ['rules'],
  [chip({ icon: symbol('lightbulb.fill'), fill: { type: 'bound-color', value: read('temp', ['state']), fallback: STANDARD }, glyph: { type: 'bound-color', value: read('temp', ['state']), fallback: tealFallback } })]);
accept('pending-bound-color-navigation-tile', 'A navigation tile fill from an entity color.', ['rules'],
  [navTile('n', { layout: 'standard', titleLines: 1, fill: { type: 'bound-color', value: read('temp', ['state']), fallback: tealFallback } })]);
accept('pending-bound-color-navigation-tile-conditional', 'A navigation tile fill that follows a rule: a case is an exact color.', ['rules', 'conditions'],
  [navTile('n', { layout: 'standard', titleLines: 1, fill: conditional([[hot, rgb(120, 20, 10)]], STANDARD) })]);
accept('pending-bound-color-room-card-state-colors', 'A room card color for one state, from an entity color.', ['rules'], [
  node('rc', 'room-card', { icon: symbol('house'), binding: { sourceId: 'guest-fan', projection: 'room-state@1' }, props: {
    kind: 'light', showState: true, subtitleSourceIds: [], activeStates: [], disabledStates: [], stateLabels: [],
    stateColors: [{ state: 'on', fill: { type: 'bound-color', value: read('temp', ['state']), fallback: tealFallback } }, { state: 'off', fill: conditional([[hot, rgb(1, 2, 3)]], rgb(4, 5, 6)) }],
  } })]);
reject('bound-color-no-fallback', 'A bound color always has a fallback: never an implicit look.', ['rules'],
  [chip({ icon: symbol('lightbulb.fill'), fill: { type: 'bound-color', value: read('temp', ['state']) } })]);
reject('bound-color-number-value', 'A color is text: a number read is refused.', ['rules'],
  [chip({ icon: symbol('lightbulb.fill'), fill: { type: 'bound-color', value: read('temp', ['state'], 'number'), fallback: STANDARD } })]);
reject('bound-color-glyph-standard-fallback', 'A glyph has no standard look: its fallback is an exact color.', ['rules'],
  [chip({ icon: symbol('lightbulb.fill'), fill: STANDARD, glyph: { type: 'bound-color', value: read('temp', ['state']), fallback: STANDARD } })]);
reject('bound-color-inside-conditional', 'A conditional case holds an exact color, never a bound one.', ['rules', 'conditions'],
  [chip({ icon: symbol('lightbulb.fill'), fill: conditional([[hot, { type: 'bound-color', value: read('temp', ['state']), fallback: STANDARD }]], STANDARD) })]);
reject('bound-color-bad-reference', 'The value reads a source the document has.', ['rules'],
  [chip({ icon: symbol('lightbulb.fill'), fill: { type: 'bound-color', value: read('missing', ['state']), fallback: STANDARD } })]);
reject('bound-color-on-alarm-fill', 'A keyed state table stays literal: an alarm appearance takes no bound color.', ['rules'], [
  navTile('n', undefined, { props: {
    family: 'neutral', selected: 'none', subtitle: lit(''),
    alarm: { sourceId: 'alarm', projection: 'alarm-navigation@1', states: [{ state: 'armed_home', appearance: { icon: symbol('lock'), fill: { type: 'bound-color', value: read('temp', ['state']), fallback: tealFallback }, text: 'Home' } }],
      fallback: { icon: symbol('lock'), fill: rgb(1, 2, 3), text: 'x' }, loadingText: 'a', unavailableText: 'b', errorText: 'c', hiddenText: 'd' },
  } })],
envelope => { envelope.document.dataSources.push({ id: 'alarm', kind: 'model', model: 'alarm-mode@1', inputs: { entityId: lit('alarm_control_panel.demo_home') } }); });

// MARK: bound-symbol
accept('pending-bound-symbol-chip', 'A chip icon named by an entity, with a required fallback symbol.', ['rules'],
  [chip({ icon: { type: 'bound-symbol', value: read('temp', ['state']), fallback: symbol('lightbulb.fill') }, fill: STANDARD })]);
reject('bound-symbol-no-fallback', 'A bound symbol always has a fallback.', ['rules'],
  [chip({ icon: { type: 'bound-symbol', value: read('temp', ['state']) }, fill: STANDARD })]);
reject('bound-symbol-number-value', 'A symbol name is text: a number read is refused.', ['rules'],
  [chip({ icon: { type: 'bound-symbol', value: read('temp', ['state'], 'number'), fallback: symbol('lightbulb.fill') }, fill: STANDARD })]);
reject('bound-symbol-on-glyph', 'A bound symbol stands only where a symbol does: not in a color slot.', ['rules'],
  [chip({ icon: symbol('lightbulb.fill'), fill: STANDARD, glyph: { type: 'bound-symbol', value: read('temp', ['state']), fallback: symbol('lightbulb') } })]);

// MARK: Text fallback
accept('pending-text-fallback-expr', 'An authored string with the text to show while its value is unavailable.', ['rules'],
  [node('t', 'text', { props: { value: { type: 'expr', value: read('temp', ['state']), fallback: 'No reading' }, style: 'body', unavailableText: 'None' } })]);
accept('pending-text-fallback-read', 'A read slot with a fallback text.', ['rules'],
  [node('t', 'text', { props: { value: { ...read('temp', ['state']), fallback: 'No reading' }, style: 'body', unavailableText: 'None' } })]);
reject('text-fallback-on-literal', 'A literal has nothing to fall back from.', ['rules'],
  [node('t', 'text', { props: { value: { type: 'literal', value: 'a', fallback: 'b' }, style: 'body', unavailableText: 'None' } })]);
reject('text-fallback-blank-primary', 'A row title is never blank, so neither is its fallback.', ['rules'],
  [row('r', { props: { primary: { type: 'expr', value: read('temp', ['state']), fallback: '' }, secondary: lit(''), value: lit(''), accessory: 'none', loadingText: 'a', unavailableText: 'b' } })]);
reject('text-fallback-too-long', 'A fallback keeps the slot\'s own length limit.', ['rules'],
  [node('t', 'text', { props: { value: { type: 'expr', value: read('temp', ['state']), fallback: 'x'.repeat(16385) }, style: 'body', unavailableText: 'None' } })]);

// MARK: Badges
const value = (operand: J): J => ({ type: 'value', value: operand });
accept('pending-badge-chip', 'A chip with a count badge that reads a number.', ['badges'], [chip({ icon: symbol('lightbulb.fill'), fill: STANDARD }, { badge: value(read('lights', ['count'], 'number')) })]);
accept('pending-badge-tiles', 'A navigation tile with a fixed text badge and a state tile with none.', ['badges'],
  [navTile('n', undefined, { badge: value(lit('New')) }), stateTile('t', { badge: { type: 'none' } })]);
accept('pending-badge-tab', 'A tab of the shell with a badge from a format.', ['badges'], [],
  envelope => withTabs(envelope, value({ type: 'format', pattern: '{n}', args: { n: read('lights', ['count'], 'number') } })));
accept('pending-badge-chrome-button', 'A header button whose badge is a value; the shipped none stays valid.', ['badges'], [],
  envelope => { envelope.document.navigation.chrome.groups[1].items.push(chromeButton(value(lit(3)))); });
reject('badge-boolean-value', 'A badge is a number or text: a boolean is refused.', ['badges'], [navTile('n', undefined, { badge: value(read('guest-fan', ['state'], 'boolean')) })]);
reject('badge-structure-value', 'A badge is a number or text: a list is refused.', ['badges'], [navTile('n', undefined, { badge: value({ type: 'list', items: [lit(1)] }) })]);
reject('badge-none-with-value', 'None says nothing else.', ['badges'], [navTile('n', undefined, { badge: { type: 'none', value: lit(1) } })]);
reject('badge-on-text', 'A text node has no badge.', ['badges'], [node('t', 'text', { props: { value: lit('x'), style: 'body', unavailableText: 'None' }, badge: value(lit(1)) })]);
reject('badge-unknown-reference', 'A badge reads a source the document has.', ['badges'], [navTile('n', undefined, { badge: value(read('missing', ['state'], 'number')) })]);

// MARK: An action chosen by rule
const rule = (cases: [J, J][], otherwise: J): J => ({ type: 'conditional', cases: cases.map(([when, then]) => ({ when, then })), otherwise });
accept('pending-action-rules-row', 'A row that opens one page when hot and another otherwise.', ['action-rules'], [row('r', { action: rule([[hot, push('page-lattice')]], push('page-echo')) })]);
accept('pending-action-rules-do-nothing', 'A button whose otherwise is do nothing, and a rule that runs a service.', ['action-rules'],
  [button('b', { action: rule([[hot, call()]], { type: 'none' }) })]);
accept('pending-action-rules-navigation-tile', 'A navigation tile that opens a page chosen by rule.', ['action-rules'], [navTile('n', undefined, { action: rule([[hot, push('page-lattice')]], push('page-echo')) })]);
accept('pending-action-rules-list-row', 'A list whose rows run a rule when tapped.', ['action-rules', 'list-parts'],
  [rowCollection('upcoming', { rowAction: rule([[hot, push('page-lattice')]], push('page-echo')) })], envelope => { envelope.document.dataSources.push(flow('upcoming')); });
reject('action-rules-nested', 'One level only: a case holds a plain action, never another rule.', ['action-rules'],
  [button('b', { action: rule([[hot, rule([[cold, push()]], { type: 'none' })]], push('page-echo')) })]);
reject('action-rules-no-otherwise', 'A rule always says what to do when no case holds.', ['action-rules'], [button('b', { action: { type: 'conditional', cases: [{ when: hot, then: push() }] } })]);
reject('action-rules-no-cases', 'A rule has at least one case.', ['action-rules'], [button('b', { action: rule([], push()) })]);
reject('action-rules-over-16-cases', 'A rule has at most 16 cases.', ['action-rules'], [button('b', { action: rule(Array.from({ length: 17 }, () => [hot, push()] as [J, J]), push()) })]);
reject('action-rules-on-action-tile', 'A power tile takes its own power action only.', ['action-rules'], [
  node('a', 'action-tile', { icon: symbol('power'), binding: { sourceId: 'source-power', projection: 'power-tile@1' }, props: {
    family: 'neutral', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' }, action: rule([[hot, push()]], { type: 'none' }) })]);
reject('action-rules-domain-on-row', 'A power action stays off a row, also inside a rule.', ['action-rules'],
  [row('r', { action: rule([[hot, { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } }]], { type: 'none' }) })]);
reject('action-rules-bad-page', 'A case names a page the document has.', ['action-rules'], [button('b', { action: rule([[hot, push('page-missing')]], { type: 'none' }) })]);

// MARK: confirmation.when
const ask = (when?: J): J => ({ type: 'additional', style: 'alert', title: 'Turn on?', confirmLabel: 'Turn On', cancelLabel: 'Cancel', destructive: false, ...(when ? { when } : {}) });
accept('pending-confirm-when-call', 'A service call that asks first only while a condition holds.', ['confirm-when'], [button('b', { action: call({ confirmation: ask(hot) }) })]);
accept('pending-confirm-when-domain', 'A power tile that asks first only while a condition holds.', ['confirm-when'], [
  node('a', 'action-tile', { icon: symbol('power'), binding: { sourceId: 'source-power', projection: 'power-tile@1' }, props: {
    family: 'neutral', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' },
  action: { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: ask(hot) } })]);
reject('confirm-when-on-policy', 'The app\'s own policy takes no condition.', ['confirm-when'], [button('b', { action: call({ confirmation: { type: 'policy', when: hot } }) })]);
reject('confirm-when-unknown-reference', 'The condition reads a source the document has.', ['confirm-when'],
  [button('b', { action: call({ confirmation: ask(cmp('above', read('missing', ['state'], 'number'), lit(1))) }) })]);
reject('confirm-when-over-limit', 'The condition keeps the 32-node limit of a rule.', ['confirm-when'],
  [button('b', { action: call({ confirmation: ask({ type: 'all', of: Array.from({ length: 16 }, () => ({ type: 'all', of: [hot, cold] })) }) }) })]);

// MARK: fallbackTabId
const tabs = (extra: J): J => node('tabs', 'local-tabs', {
  props: { stateId: 'pane', transition: 'canonical-swap@1', ...extra },
  tabs: [{ id: 'one', label: 'One', children: [] }, { id: 'two', label: 'Two', children: [] }],
});
const paneField = (envelope: J) => { envelope.document.localState = [{ id: 'pane', type: 'choice', initial: 'one', options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] }]; };
accept('pending-tab-fallback-second-tab', 'A tab container that opens on its second tab when the one it would choose cannot be shown.', ['tab-fallback'], [tabs({ fallbackTabId: 'two' })], paneField);
reject('tab-fallback-unknown-tab', 'The fallback is one of the container\'s tabs.', ['tab-fallback'], [tabs({ fallbackTabId: 'three' })], paneField);

// MARK: List parts
accept('pending-list-parts-row-action', 'A list whose rows open a page, with a message under its empty title.', ['list-parts'],
  [rowCollection('upcoming', { rowAction: push(), emptyMessage: { type: 'expr', value: lit('Nothing is due.'), fallback: 'Nothing is due.' } })], envelope => { envelope.document.dataSources.push(flow('upcoming')); });
accept('pending-list-parts-refreshable', 'A list that can be pulled, over a flow that has "When pulled".', ['list-parts'],
  [rowCollection('upcoming', { refreshable: true })], envelope => { envelope.document.dataSources.push(flow('upcoming')); });
accept('pending-list-parts-built-in-provider', 'The list parts do not need a flow: an app list takes a row action too.', ['list-parts'], [rowCollection('sample-provider', { rowAction: push() })]);
reject('list-parts-refreshable-live-flow', 'A live flow has no refresh, so the list cannot be pulled.', ['list-parts'],
  [rowCollection('overdue', { refreshable: true })], envelope => { envelope.document.dataSources.push(flow('overdue')); });
reject('list-parts-domain-row-action', 'A power action stays off a row.', ['list-parts'],
  [rowCollection('sample-provider', { rowAction: { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } } })]);
reject('list-parts-refreshable-not-boolean', 'refreshable is true or false.', ['list-parts'], [rowCollection('sample-provider', { refreshable: 'yes' })]);
reject('list-parts-on-collection', 'The three parts belong to the rows list, not to collection.', ['list-parts'], [
  node('c', 'collection', { props: { providerId: 'sample-provider', template: 'rows', loadingText: 'a', emptyText: 'b', rowAction: push() } })]);

// MARK: Date format
const dated = (style: string, arg: J = lit('2026-11-12')): J => ({ type: 'format', pattern: '{d}', args: { d: arg }, formats: { d: { date: { style } } } });
const dateText = (operand: J): J[] => [node('t', 'text', { props: { value: { type: 'expr', value: operand }, style: 'body', unavailableText: 'None' } })];
accept('pending-date-format-all-styles', 'A format with each of the six date styles on a date from an entity.', ['pipeline-operands'], [
  node('t', 'text', { props: { value: { type: 'expr', value: { type: 'format', pattern: '{a} {b} {c} {d} {e} {f}', args: Object.fromEntries('abcdef'.split('').map(key => [key, read('temp', ['state'])])),
    formats: Object.fromEntries(['short-date', 'long-date', 'weekday-date', 'time', 'date-time', 'relative'].map((style, at) => ['abcdef'[at], { date: { style } }])) } }, style: 'body', unavailableText: 'None' } })]);
reject('date-format-unknown-style', 'The style is one of the six names, never a pattern.', ['pipeline-operands'], dateText(dated('MMM d')));
reject('date-format-number-argument', 'A date style draws text: a number argument is refused.', ['pipeline-operands'], dateText(dated('long-date', read('temp', ['state'], 'number'))));
reject('date-format-both-styles', 'One argument has one format.', ['pipeline-operands'], dateText({ type: 'format', pattern: '{d}', args: { d: lit('2026-11-12') }, formats: { d: { date: { style: 'time' }, number: { maximumFractionDigits: 1 } } } }));
reject('date-format-unknown-argument', 'A format names an argument the pattern has.', ['pipeline-operands'], dateText({ type: 'format', pattern: '{d}', args: { d: lit('2026-11-12') }, formats: { e: { date: { style: 'time' } } } }));

// MARK: Evaluation
export const askEvaluations: AskEvaluation[] = [];
const evaluation = (name: string, note: string, subject: J, expected: J, env: J = {}) => askEvaluations.push({ name, note, subject, env, expected });
const value$ = (v: unknown): J => ({ status: 'value', value: v });
const LOADING: J = { status: 'loading' }, UNAVAILABLE: J = { status: 'unavailable' };
const reads = (map: Record<string, J>): J => ({ reads: map });
const CLOCK = { now: '2026-11-15T09:30:00', utcOffsetMinutes: -480 };
const bound = (operand: J, fallback: J = tealFallback): J => ({ type: 'bound-color', value: operand, fallback });
const color = (name: string, note: string, text: string | null, expected: J, role = 'fill', fallback: J = tealFallback) => evaluation(name, note,
  { fill: bound(read('c', ['state']), fallback), role }, expected, text === null ? {} : reads({ 'c/state': value$(text) }));
const solid = (red: number, green: number, blue: number): J => ({ look: rgb(red, green, blue), status: 'value' });
const fell: J = { look: tealFallback, status: 'value' };

color('bound-color-hex-fill', 'A hex color is scaled toward black until white text reads on it: #009688 gives #006E63 (the app\'s own anchor, ChipTint.swift:50-52).', '#009688', solid(0, 110, 99));
color('bound-color-hex-glyph', 'The glyph slot takes the color lightened until it keeps 3:1: #009688 gives #A6DAD5.', '#009688', solid(166, 218, 213), 'glyph');
color('bound-color-hex-case-and-space', 'Case and the spaces around the text do not matter.', '  #009688 ', solid(0, 110, 99));
color('bound-color-hex-short', 'A three digit hex doubles each digit: #f80 is #FF8800.', '#f80', solid(152, 81, 0));
color('bound-color-hex-alpha-ignored', 'An eight digit hex ignores alpha unless it is 0.', '#009688CC', solid(0, 110, 99));
color('bound-color-hex-alpha-zero', 'Alpha 0 means no color: the fallback.', '#00968800', fell);
color('bound-color-rgb-comma', 'rgb() with commas.', 'rgb(0, 150, 136)', solid(0, 110, 99));
color('bound-color-rgb-space-alpha', 'rgb() with spaces and a slash alpha.', 'rgb(0 150 136 / 50%)', solid(0, 110, 99));
color('bound-color-rgb-percent', 'rgb() channels may be percentages: 100% is 255.', 'rgb(100%, 100%, 0%)', solid(101, 101, 0));
color('bound-color-rgb-out-of-range', 'A channel over 255 is not a color: the fallback.', 'rgb(300, 0, 0)', fell);
color('bound-color-rgb-alpha-zero', 'rgba() with alpha 0 is no color.', 'rgba(0, 150, 136, 0)', fell);
color('bound-color-hsl', 'hsl() with a unitless hue: hsl(210, 50%, 40%) is #336699.', 'hsl(210, 50%, 40%)', solid(37, 74, 112));
color('bound-color-hsl-deg', 'hsl() with a deg hue and spaces.', 'hsl(210deg 50% 40%)', solid(37, 74, 112));
color('bound-color-yellow-fill-keeps-darkening', 'A bright color is darkened in steps until white passes 4.5:1: #FFFF00 gives #656500.', '#FFFF00', solid(101, 101, 0));
color('bound-color-yellow-glyph-already-reads', 'A glyph that already keeps 3:1 is not lightened.', '#FFFF00', solid(255, 255, 0), 'glyph');
color('bound-color-purple', 'A mid color: #9C27B0 gives #721C80.', '#9C27B0', solid(114, 28, 128));
color('bound-color-name-is-fallback', 'A color name is not tier 1: the fallback.', 'teal', fell);
color('bound-color-text-is-fallback', 'Text that is not a color: the fallback.', 'warm', fell);
color('bound-color-unavailable-is-fallback', 'An unavailable value uses the fallback.', null, fell);
color('bound-color-standard-fallback', 'The fallback may be the standard look.', 'warm', { look: STANDARD, status: 'value' }, 'fill', STANDARD);
evaluation('bound-color-number-is-fallback', 'A number is not a color: the fallback.', { fill: bound(read('c', ['state'], 'number')), role: 'fill' }, fell, reads({ 'c/state': value$('5') }));
evaluation('bound-color-loading-keeps', 'While the value is loading the slot keeps what it showed: not yet.', { fill: bound(read('c', ['state'])), role: 'fill' }, { status: 'loading' }, reads({ 'c/state': LOADING }));
evaluation('conditional-fill-exact', 'A conditional case holds an exact fill: it is never clamped.', { fill: conditional([[hot, rgb(255, 255, 0)]], STANDARD), role: 'fill' }, { look: rgb(255, 255, 0), status: 'value' }, reads({ 'temp/state': value$('80') }));
evaluation('conditional-fill-otherwise', 'No case holding gives otherwise.', { fill: conditional([[hot, rgb(255, 255, 0)]], STANDARD), role: 'fill' }, { look: STANDARD, status: 'value' }, reads({ 'temp/state': value$('50') }));
evaluation('conditional-fill-stalled-is-otherwise', 'A look never blanks: a case that cannot be answered yet shows otherwise.', { fill: conditional([[hot, rgb(255, 255, 0)]], STANDARD), role: 'fill' }, { look: STANDARD, status: 'value' }, reads({ 'temp/state': LOADING }));

const sym = (text: string): J => ({ type: 'bound-symbol', value: read('s', ['state']), fallback: symbol(text) });
evaluation('bound-symbol-name', 'A text that names a symbol the app can draw becomes the symbol, the fallback\'s other fields kept.', { symbol: sym('lightbulb') }, { look: symbol('flame.fill'), status: 'value' }, reads({ 's/state': value$('flame.fill') }));
evaluation('bound-symbol-unavailable', 'An unavailable value uses the fallback symbol.', { symbol: sym('lightbulb') }, { look: symbol('lightbulb'), status: 'value' });
evaluation('bound-symbol-blank', 'A blank name uses the fallback symbol.', { symbol: sym('lightbulb') }, { look: symbol('lightbulb'), status: 'value' }, reads({ 's/state': value$('   ') }));
evaluation('bound-symbol-too-long', 'A name over 80 characters uses the fallback symbol.', { symbol: sym('lightbulb') }, { look: symbol('lightbulb'), status: 'value' }, reads({ 's/state': value$('a'.repeat(81)) }));
evaluation('bound-symbol-not-drawn', 'A name the app cannot draw uses the fallback symbol.', { symbol: sym('lightbulb') }, { look: symbol('lightbulb'), status: 'value' }, { ...reads({ 's/state': value$('no.such.symbol') }), undrawnSymbols: ['no.such.symbol'] });
evaluation('bound-symbol-loading-keeps', 'While loading the slot keeps what it showed.', { symbol: sym('lightbulb') }, { status: 'loading' }, reads({ 's/state': LOADING }));

const textRead = (fallback?: string): J => ({ ...read('temp', ['state']), ...(fallback === undefined ? {} : { fallback }) });
evaluation('text-expr-fallback-unavailable', 'An unavailable value uses the slot\'s fallback text.', { text: { type: 'expr', value: textRead(), fallback: 'No reading' } }, value$('No reading'));
evaluation('text-read-fallback-unavailable', 'A read slot falls back the same way.', { text: textRead('No reading') }, value$('No reading'));
evaluation('text-expr-fallback-unused-when-value', 'A value that is there is shown, not the fallback.', { text: { type: 'expr', value: textRead(), fallback: 'No reading' } }, value$('72'), reads({ 'temp/state': value$('72') }));
evaluation('text-expr-fallback-loading-keeps', 'While loading there is no fallback: the slot keeps what it showed.', { text: { type: 'expr', value: textRead(), fallback: 'No reading' } }, LOADING, reads({ 'temp/state': LOADING }));
evaluation('text-expr-no-fallback-unavailable', 'With no fallback an unavailable value stays unavailable: the node\'s own text shows.', { text: { type: 'expr', value: textRead() } }, UNAVAILABLE);
evaluation('text-choose-fallback-unavailable', 'A rule over an unavailable value cannot tell, so it is loading; the fallback does not stand in for it.',
  { text: { type: 'expr', value: { type: 'choose', cases: [{ when: hot, then: lit('Hot') }], otherwise: lit('Fine') }, fallback: 'No reading' } }, LOADING);
evaluation('text-literal', 'A literal is itself.', { text: { type: 'literal', value: 'Hello' } }, value$('Hello'));

const badge = (name: string, note: string, operand: J | null, expected: J, env: J = {}) => evaluation(name, note, { badge: operand === null ? { type: 'none' } : { type: 'value', value: operand } }, expected, env);
badge('badge-none', 'Fixed None draws no badge.', null, { status: 'value', text: null });
badge('badge-number', 'A number is its text.', lit(3), { status: 'value', text: '3' });
badge('badge-zero', 'A value of 0 draws no badge.', lit(0), { status: 'value', text: null });
badge('badge-zero-text', 'Text that reads as 0 draws no badge: an entity\'s count arrives as text.', read('n', ['state']), { status: 'value', text: null }, reads({ 'n/state': value$('0') }));
badge('badge-empty-text', 'Empty text draws no badge.', lit(''), { status: 'value', text: null });
badge('badge-text', 'Text is shown as it is.', lit('New'), { status: 'value', text: 'New' });
badge('badge-fraction', 'A number prints as every other number does.', lit(12.5), { status: 'value', text: '12.5' });
badge('badge-count-from-entity', 'A count read from an entity.', read('lights', ['count'], 'number'), { status: 'value', text: '18' }, reads({ 'lights/count': value$(18) }));
badge('badge-unavailable', 'An unavailable value draws no badge.', read('n', ['state']), { status: 'value', text: null });
badge('badge-loading-keeps', 'While loading the badge keeps what it showed.', read('n', ['state']), { status: 'loading' }, reads({ 'n/state': LOADING }));
badge('badge-boolean-draws-none', 'A boolean is not a count (the compiler refuses it): nothing is drawn.', lit(true), { status: 'value', text: null });

const enabled = (name: string, note: string, rule: J, expected: boolean, extra: J = {}) => evaluation(name, note, { enabled: rule, ...(extra.previous === undefined ? {} : { previous: extra.previous }) }, { enabled: expected }, extra.env ?? {});
const warm = reads({ 'temp/state': value$('80') }), cool = reads({ 'temp/state': value$('50') }), gap = reads({ 'temp/state': LOADING });
enabled('enabled-yes', 'A condition that holds enables the control.', enabledWhen(hot), true, { env: warm });
enabled('enabled-no', 'A condition that does not hold disables it, whatever the policy.', enabledWhen(hot, 'enabled'), false, { env: cool });
enabled('enabled-unknown-enabled', 'Unknown with the policy enabled: enabled.', enabledWhen(hot, 'enabled'), true, { env: gap });
enabled('enabled-unknown-disabled', 'Unknown with the policy disabled: disabled.', enabledWhen(hot, 'disabled'), false, { env: gap });
enabled('enabled-unknown-keep-was-enabled', 'Unknown with keep repeats the last answer: it was enabled.', enabledWhen(hot, 'keep'), true, { env: gap, previous: true });
enabled('enabled-unknown-keep-was-disabled', 'Unknown with keep repeats the last answer: it was disabled.', enabledWhen(hot, 'keep'), false, { env: gap, previous: false });
enabled('enabled-unknown-keep-never-answered', 'Unknown with keep and no earlier answer: enabled.', enabledWhen(hot, 'keep'), true, { env: gap });

const faces = (name: string, note: string, look: J, expected: J, env: J) => evaluation(name, note, { faces: look }, { faces: expected }, env);
faces('faces-none', 'A tile with no look conditions leaves every face to the style.', {}, { active: null, filled: null, error: null }, warm);
faces('faces-all-hold', 'A condition that holds sets its face.', { activeWhen: hot, filledWhen: hot, errorWhen: hot }, { active: true, filled: true, error: true }, warm);
faces('faces-none-hold', 'A condition that does not hold sets the face off: unlit, not filled, no error from the tile.', { activeWhen: hot, filledWhen: hot, errorWhen: hot }, { active: false, filled: false, error: false }, cool);
faces('faces-unknown-is-style', 'A condition that cannot be answered leaves the face to the style.', { activeWhen: hot, errorWhen: hot }, { active: null, filled: null, error: null }, gap);

const pick = (name: string, note: string, action: J, expected: J, env: J = {}) => evaluation(name, note, { action }, expected, env);
const rows: J = rule([[hot, push('page-lattice')], [cold, call()]], { type: 'none' });
pick('action-first-case', 'The first case that holds runs its action.', rows, { pick: 0, runs: 'push' }, warm);
pick('action-second-case', 'A later case holds when the first does not.', rows, { pick: 1, runs: 'call-service' }, cool);
pick('action-otherwise-none', 'No case holding runs otherwise: here, nothing.', rows, { pick: 'otherwise', runs: 'none' }, reads({ 'temp/state': value$('65') }));
pick('action-otherwise-action', 'otherwise may be an action.', rule([[hot, push()]], push('page-echo')), { pick: 'otherwise', runs: 'push' }, cool);
pick('action-stalled-runs-nothing', 'A case that cannot be answered yet stops the rule: nothing runs, and a later case cannot stand in.', rule([[hot, push()], [cmp('eq', lit(1), lit(1)), call()]], push('page-echo')), { pick: 'stalled', runs: 'none' }, gap);
pick('action-plain-runs', 'An action that is not a rule is itself.', push(), { pick: 'plain', runs: 'push' });

const asks = (name: string, note: string, when: J | null, expected: boolean, env: J = {}) => evaluation(name, note, { asks: when === null ? {} : { when } }, { asks: expected }, env);
asks('asks-always', 'No condition always asks.', null, true);
asks('asks-holds', 'A condition that holds asks.', hot, true, warm);
asks('asks-not', 'A condition that does not hold holds the question back.', hot, false, cool);
asks('asks-unknown', 'A condition that cannot be answered asks: a gap never skips a question the author wanted.', hot, true, gap);

const dateOperand = (style: string, arg: J, pattern = '{d}'): J => ({ type: 'format', pattern, args: { d: arg }, formats: { d: { date: { style } } } });
const dates = (name: string, note: string, style: string, arg: unknown, text: string | J, env: J = { clock: CLOCK }) => evaluation(name, note,
  { operand: dateOperand(style, lit(arg)) }, typeof text === 'string' ? value$(text) : text, { locale: 'en_US', ...env });
dates('date-short-date', 'Short date in this year: Nov 12.', 'short-date', '2026-11-12', 'Nov 12');
dates('date-short-date-other-year', 'Short date in another year carries the year.', 'short-date', '2025-11-12', 'Nov 12, 2025');
dates('date-long-date', 'Long date: November 12, 2026.', 'long-date', '2026-11-12', 'November 12, 2026');
dates('date-weekday-date', 'Weekday and date: 2026-11-12 is a Thursday.', 'weekday-date', '2026-11-12', 'Thu, Nov 12');
dates('date-weekday-saturday', '2000-01-01 was a Saturday: the weekday follows the calendar, not a table of years.', 'weekday-date', '2000-01-01', 'Sat, Jan 1');
dates('date-time-morning', 'Time: 9:41 AM.', 'time', '2026-11-12T09:41:00', '9:41 AM');
dates('date-time-evening', 'Time: 9:05 PM, with the minute padded.', 'time', '2026-11-12T21:05:00', '9:05 PM');
dates('date-time-midnight', 'Time: just after midnight is 12:07 AM.', 'time', '2026-11-12T00:07:00', '12:07 AM');
dates('date-time-noon', 'Time: noon is 12:00 PM.', 'time', '2026-11-12T12:00:00', '12:00 PM');
dates('date-time-of-a-date', 'A date has no time: it is midnight.', 'time', '2026-11-12', '12:00 AM');
dates('date-time-moved-to-clock-zone', 'A time with an offset is moved to the clock\'s: 17:41 UTC is 9:41 AM at -08:00.', 'time', '2026-11-12T17:41:00Z', '9:41 AM');
dates('date-time-without-clock', 'The time needs no clock: it reads the value on offset 0.', 'time', '2026-11-12T09:41:00', '9:41 AM', {});
dates('date-date-time', 'Date and time: Nov 12 at 9:41 AM.', 'date-time', '2026-11-12T09:41:00', 'Nov 12 at 9:41 AM');
dates('date-date-time-other-year', 'Date and time in another year carries the year.', 'date-time', '2025-12-31T23:59:00', 'Dec 31, 2025 at 11:59 PM');
dates('date-relative-today', 'Relative: the clock\'s day is Today.', 'relative', '2026-11-15', 'Today');
dates('date-relative-yesterday', 'Relative: Yesterday.', 'relative', '2026-11-14', 'Yesterday');
dates('date-relative-tomorrow', 'Relative: Tomorrow.', 'relative', '2026-11-16', 'Tomorrow');
dates('date-relative-days-ago', 'Relative: 3 days ago.', 'relative', '2026-11-12', '3 days ago');
dates('date-relative-in-days', 'Relative: In 3 days.', 'relative', '2026-11-18', 'In 3 days');
dates('date-relative-clock-zone', 'Relative counts whole days on the clock: 03:00 UTC on the 16th is 19:00 on the 15th at -08:00, so Today.', 'relative', '2026-11-16T03:00:00Z', 'Today');
dates('date-short-date-without-clock', 'Short date needs the clock (it asks whether the year is this year): without one there is no text.', 'short-date', '2026-11-12', UNAVAILABLE, {});
dates('date-relative-without-clock', 'Relative needs the clock.', 'relative', '2026-11-12', UNAVAILABLE, {});
dates('date-not-a-calendar-date', 'A date that is not on the calendar has no text.', 'long-date', '2026-02-30', UNAVAILABLE);
dates('date-number-argument', 'A number is not a date: the format is unavailable.', 'long-date', 5, UNAVAILABLE);
dates('date-text-argument', 'Text that is not a date has no text.', 'long-date', 'soon', UNAVAILABLE);
evaluation('date-in-a-sentence', 'A date style sits in a pattern beside other text.', { operand: dateOperand('weekday-date', lit('2026-11-12'), 'Due {d}.') }, value$('Due Thu, Nov 12.'), { locale: 'en_US', clock: CLOCK });
