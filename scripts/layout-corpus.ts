/**
 * The cases of the layout families (`sh.tab-blocks@1`, `sh.tab-bar@1`, `sh.overlay@1`, `sh.tile-parts@1`, and the rule-based readout tone of
 * `sh.rules@1`): what each one builds, what the Studio's first issue must be (hand-written here, never computed) and the evaluation cases for the
 * parts a runtime must agree on. `generate-layout-corpus.ts` writes the publication files; `generate-expression-corpus.ts` writes `layoutEvaluations`
 * with the other evaluation cases, because it owns the `evaluation/` folder.
 */
type J = Record<string, any>;

// MARK: Builders
export const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const cmp = (op: string, left: J, right: J): J => ({ type: 'compare', op, left, right });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const text = (id: string, value = 'Hello'): J => node(id, 'text', { props: { value: lit(value), style: 'body', unavailableText: 'None' } });
const hot: J = cmp('above', read('temp', ['state'], 'number'), lit(75));
const shownWhen: J = { type: 'state', sourceId: 'source-entity', path: ['state'], in: ['on'] };
const push = (): J => ({ type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const call = (): J => ({ type: 'call-service', domain: 'vacuum', service: 'locate', target: { entity_id: lit('vacuum.example_robot') } });
const button = (id: string, rest: J = {}): J => node(id, 'primary-button', { props: {}, icon: symbol('location'), action: push(), ...rest });
const command = (id: string): J => node(id, 'bound-control', { icon: symbol('bolt'), props: { kind: 'button', unavailableText: 'Unavailable' }, action: call() });
const pill = (id: string): J => node(id, 'status-pill', { icon: symbol('bolt.fill'), props: { value: lit('87%'), detail: lit(''), tone: 'ok', unavailableText: 'Unavailable' } });
const stateTile = (id: string, props: J = {}, rest: J = {}): J => node(id, 'state-tile', { icon: symbol('lock'), binding: { entityId: 'lock.demo_door', builtIn: 'lock' }, props, ...rest });
const disc = (id: string, rest: J = {}): J => ({ id, icon: symbol('lock'), label: 'Lock', action: call(), ...rest });
const toggle = (id: string): J => node(id, 'bound-control', { icon: symbol('power'), props: { kind: 'button', unavailableText: 'Unavailable' }, action: call() });
void toggle;

const TABS = ['controls', 'rooms', 'dock'] as const;
const tab = (id: string, extra: J = {}, icon = true): J => ({ id, label: id[0].toUpperCase() + id.slice(1), children: [], ...(icon ? { icon: symbol('square.grid.2x2') } : {}), ...extra });
/** A tab container at the top of the page. `tabs` default to Controls, Rooms and Dock, each with an icon. */
const tabs = (rest: J = {}, tabList: J[] = TABS.map(id => tab(id))): J => node('tabs', 'local-tabs', {
  props: { stateId: 'panel', transition: 'canonical-swap@1', ...(rest.props ?? {}) }, tabs: tabList, ...(rest.blocks ? { blocks: rest.blocks } : {}),
});
const block = (id: string, on: 'all' | string[], children: J[] = [text(`${id}-text`)], rest: J = {}): J => ({ id, tabs: on, children, ...rest });
/** The local state a container's selector needs: one choice whose options are the container's tabs. */
const stateFor = (tabList: J[] = TABS.map(id => tab(id))) => (envelope: J) => {
  envelope.document.localState = [{ id: 'panel', type: 'choice', initial: tabList[0].id, options: tabList.map(item => ({ id: item.id, label: item.label })) }];
};
const sourcesFor = (envelope: J) => {
  envelope.document.dataSources.push({ id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_temperature') });
};

export interface LayoutCase {
  name: string; note: string; components: J[]; tweak?: (envelope: J) => void;
  /** Capability ids this case needs besides the ones the Studio's compile reports (used when the compile refuses it). */
  needs: string[]; reject: boolean;
  /** The Studio's first issue, written by hand: a reject must give exactly this. */
  expect?: { code: string; pointer: string };
}
export const layoutCases: LayoutCase[] = [];
const base = ['sh.local-state@1', 'sh.local-tabs@1'];
const accept = (name: string, note: string, needs: string[], components: J[], tweak?: LayoutCase['tweak']) =>
  layoutCases.push({ name, note, needs: [...needs, ...base], components, tweak, reject: false });
const reject = (name: string, note: string, needs: string[], expect: LayoutCase['expect'], components: J[], tweak?: LayoutCase['tweak']) =>
  layoutCases.push({ name, note, needs: [...needs, ...base], components, tweak, reject: true, expect });
/** A tab container with its state. */
const container = (rest: J = {}, tabList?: J[]): { components: J[]; tweak: LayoutCase['tweak'] } => ({ components: [tabs(rest, tabList)], tweak: envelope => { stateFor(tabList)(envelope); sourcesFor(envelope); } });
const T = '/document/pages/2/components/0';

// MARK: tab-blocks
const shipped = ['sh.tab-blocks@1'];
accept('pending-tab-blocks-shared-tab-shared-tab', 'A shared area, an area for one tab, another shared area and an area for another tab, in draw order.', shipped, ...Object.values(container({
  blocks: [block('map', 'all'), block('controls-only', ['controls']), block('readouts', 'all'), block('rooms-only', ['rooms']), block('dock-only', ['dock'])],
})) as [J[], LayoutCase['tweak']]);
accept('pending-tab-blocks-all-tabs', 'One area for every tab.', shipped, ...Object.values(container({ blocks: [block('everywhere', 'all')] })) as [J[], LayoutCase['tweak']]);
accept('pending-tab-blocks-two-tabs', 'An area for two of the three tabs, and one for the third.', shipped, ...Object.values(container({
  blocks: [block('first-two', ['controls', 'rooms']), block('last', ['dock'])],
})) as [J[], LayoutCase['tweak']]);
accept('pending-tab-blocks-block-visible-when', 'A shared area that shows only while a condition holds.', shipped, ...Object.values(container({
  blocks: [block('map', 'all', undefined, { visibleWhen: shownWhen, whenUnknown: 'show' }), block('rest', 'all')],
})) as [J[], LayoutCase['tweak']]);
accept('pending-tab-blocks-tab-visible-when', 'A tab that shows only while a condition holds; its children stay on the tab.', shipped, ...Object.values(container({}, [
  tab('controls'), tab('rooms', { visibleWhen: shownWhen, whenUnknown: 'hide' }), tab('dock')])) as [J[], LayoutCase['tweak']]);
accept('pending-tab-blocks-with-pinned', 'Areas in a bottom bar: the container is pinned and every tab has an icon.', [...shipped, 'sh.pinned-tabs@1'], ...Object.values(container({
  props: { pinned: true }, blocks: [block('map', 'all'), block('rest', ['rooms'])],
}, [tab('controls'), tab('rooms')])) as [J[], LayoutCase['tweak']]);
accept('pending-tab-blocks-overlay-in-shared-block', 'A shared area that holds an overlay (a base with a command on top).', [...shipped, 'sh.overlay@1', 'sh.call-service@1', 'sh.bound-control@1', 'sh.bindings@1'], ...Object.values(container({
  blocks: [block('over', 'all', [node('lay', 'overlay', { props: { anchors: [{ childId: 'go', anchor: 'top-trailing', inset: { type: 'token', name: 'm' } }] }, children: [text('under'), command('go')] })])],
})) as [J[], LayoutCase['tweak']]);

const withBlocks = (blocks: J[], rest: J = {}, tabList?: J[]) => Object.values(container({ blocks, ...rest }, tabList)) as [J[], LayoutCase['tweak']];
reject('tab-blocks-with-tab-children', 'When areas exist every tab\'s own children are empty.', shipped, { code: 'invalid_combination', pointer: `${T}/tabs/0/children` },
  ...withBlocks([block('a', 'all')], {}, [tab('controls', { children: [text('stray')] }), tab('rooms'), tab('dock')]));
reject('tab-blocks-unknown-tab', 'An area names tabs the container has.', shipped, { code: 'invalid_reference', pointer: `${T}/blocks/0/tabs/0` },
  ...withBlocks([block('a', ['missing']), block('b', 'all')]));
reject('tab-blocks-repeated-tab', 'An area names a tab once.', shipped, { code: 'invalid_reference', pointer: `${T}/blocks/0/tabs/1` },
  ...withBlocks([block('a', ['controls', 'controls']), block('b', ['rooms', 'dock'])]));
reject('tab-blocks-empty-tabs', 'An area names at least one tab.', shipped, { code: 'limit_exceeded', pointer: `${T}/blocks/0/tabs` },
  ...withBlocks([block('a', []), block('b', 'all')]));
reject('tab-blocks-duplicate-id', 'Area ids are unique in the container.', shipped, { code: 'duplicate_id', pointer: `${T}/blocks/1/id` },
  ...withBlocks([block('a', 'all', [text('one')]), block('a', 'all', [text('two')])]));
reject('tab-blocks-tab-without-area', 'Every tab is in an area.', shipped, { code: 'invalid_combination', pointer: `${T}/tabs/2` },
  ...withBlocks([block('a', ['controls', 'rooms'])]));
reject('tab-blocks-form-in-shared-area', 'A form can only sit in an area for one tab.', shipped, { code: 'invalid_combination', pointer: `${T}/blocks/0/children/0/type` },
  ...withBlocks([block('a', 'all', [node('f', 'form', { props: { providerId: 'missing', saveLabel: 'Save', selectionOnly: false, fields: [{ key: 'k', label: 'Name', control: 'text' }] } })])]));
reject('tab-blocks-41-areas', 'A container has at most 40 areas.', shipped, { code: 'limit_exceeded', pointer: `${T}/blocks` },
  ...withBlocks(Array.from({ length: 41 }, (_, index) => block(`area-${index}`, 'all', []))));

// MARK: tab-bar
const barNeeds = ['sh.tab-bar@1'];
for (const [placement, labels] of [['top', 'titles'], ['top', 'icons'], ['top', 'icons-and-titles'], ['top', 'by-size'], ['bottom', 'titles'], ['bottom', 'icons'], ['bottom', 'icons-and-titles'], ['bottom', 'by-size']]) {
  accept(`pending-tab-bar-${placement}-${labels}`, `The bar at the ${placement} with ${labels} labels, an icon on every tab.`, [...barNeeds, ...(placement === 'bottom' ? ['sh.pinned-tabs@1'] : [])],
    ...Object.values(container({ props: { ...(placement === 'bottom' ? { pinned: true } : {}), tabBar: { placement, labels } } })) as [J[], LayoutCase['tweak']]);
}
const noIcons = [tab('controls', {}, false), tab('rooms'), tab('dock')];
reject('tab-bar-bottom-without-icons', 'A bottom bar needs an icon on every tab.', [...barNeeds, 'sh.pinned-tabs@1'], { code: 'missing_required', pointer: `${T}/tabs/0/icon` },
  ...Object.values(container({ props: { pinned: true, tabBar: { placement: 'bottom', labels: 'titles' } } }, noIcons)) as [J[], LayoutCase['tweak']]);
reject('tab-bar-icons-at-top-without-icons', 'Icon labels need an icon on every tab, wherever the bar sits.', barNeeds, { code: 'missing_required', pointer: `${T}/tabs/0/icon` },
  ...Object.values(container({ props: { tabBar: { placement: 'top', labels: 'icons' } } }, noIcons)) as [J[], LayoutCase['tweak']]);
reject('tab-bar-bottom-not-pinned', 'A bottom bar is a pinned container.', barNeeds, { code: 'invalid_combination', pointer: `${T}/props/tabBar/placement` },
  ...Object.values(container({ props: { pinned: false, tabBar: { placement: 'bottom', labels: 'titles' } } })) as [J[], LayoutCase['tweak']]);
reject('tab-bar-top-but-pinned', 'A top bar is not pinned.', [...barNeeds, 'sh.pinned-tabs@1'], { code: 'invalid_combination', pointer: `${T}/props/tabBar/placement` },
  ...Object.values(container({ props: { pinned: true, tabBar: { placement: 'top', labels: 'titles' } } })) as [J[], LayoutCase['tweak']]);
reject('tab-bar-unknown-labels', 'The label mode is one of four.', barNeeds, { code: 'unknown_variant', pointer: `${T}/props/tabBar/labels` },
  ...Object.values(container({ props: { tabBar: { placement: 'top', labels: 'big' } } })) as [J[], LayoutCase['tweak']]);

// MARK: overlay
const overlayNeeds = ['sh.overlay@1', 'sh.call-service@1', 'sh.bound-control@1', 'sh.bindings@1'];
const token = (name: string): J => ({ type: 'token', name });
const overlayOf = (children: J[], anchors: J[]): J => node('lay', 'overlay', { props: { anchors }, children });
const anchorAt = (childId: string, anchor: string, inset = 'm'): J => ({ childId, anchor, inset: token(inset) });
const onPage = (components: J[]) => [components, (envelope: J) => { sourcesFor(envelope); }] as [J[], LayoutCase['tweak']];
const O = '/document/pages/2/components/0';
accept('pending-overlay-five-anchors', 'One base and four controls on top, at four of the five anchors; the fifth is the center.', overlayNeeds,
  ...onPage([overlayOf([text('under'), command('a'), command('b'), command('c'), command('d')],
    [anchorAt('a', 'top-leading'), anchorAt('b', 'top-trailing'), anchorAt('c', 'bottom-leading'), anchorAt('d', 'bottom-trailing', 'xl')])]));
accept('pending-overlay-center', 'A control at the center, with no inset.', overlayNeeds, ...onPage([overlayOf([text('under'), command('a')], [anchorAt('a', 'center', 'zero')])]));
accept('pending-overlay-two-on-top', 'Two controls on top.', overlayNeeds, ...onPage([overlayOf([text('under'), command('a'), pill('b')], [anchorAt('a', 'top-trailing'), anchorAt('b', 'bottom-leading')])]));
accept('pending-overlay-command-child', 'A command (a bound control button) on top of the base.', overlayNeeds, ...onPage([overlayOf([text('under'), command('a')], [anchorAt('a', 'top-trailing')])]));
accept('pending-overlay-button-child', 'A primary button on top of the base.', ['sh.overlay@1', 'sh.primary-button@1', 'sh.actions.navigation@1'], ...onPage([overlayOf([text('under'), button('a')], [anchorAt('a', 'bottom-trailing')])]));
accept('pending-overlay-state-tile-base', 'A state tile as the base.', ['sh.overlay@1', 'sh.state-style@1', 'sh.call-service@1', 'sh.bound-control@1', 'sh.bindings@1'],
  ...onPage([overlayOf([stateTile('under'), command('a')], [anchorAt('a', 'top-trailing')])]));
reject('overlay-anchor-for-base', 'An anchor names a child on top, never the base.', ['sh.overlay@1'], { code: 'invalid_reference', pointer: `${O}/props/anchors/0/childId` },
  ...onPage([overlayOf([text('under'), command('a')], [anchorAt('under', 'center'), anchorAt('a', 'top-trailing')])]));
reject('overlay-anchor-unknown-child', 'An anchor names a child the overlay has.', ['sh.overlay@1'], { code: 'invalid_reference', pointer: `${O}/props/anchors/0/childId` },
  ...onPage([overlayOf([text('under'), command('a')], [anchorAt('nobody', 'center'), anchorAt('a', 'top-trailing')])]));
reject('overlay-child-without-anchor', 'Every control on top has a position.', overlayNeeds, { code: 'missing_required', pointer: `${O}/props/anchors` },
  ...onPage([overlayOf([text('under'), command('a')], [])]));
reject('overlay-child-not-allowed', 'On top there are commands, buttons, readouts and text: a row is refused.', overlayNeeds, { code: 'invalid_combination', pointer: `${O}/children/1/type` },
  ...onPage([overlayOf([text('under'), node('a', 'row', { props: { primary: lit('Row'), secondary: lit(''), value: lit(''), accessory: 'none', loadingText: 'Loading', unavailableText: 'Unavailable' } })], [anchorAt('a', 'center')])]));
reject('overlay-five-on-top', 'At most four controls sit on top.', overlayNeeds, { code: 'limit_exceeded', pointer: `${O}/children` },
  ...onPage([overlayOf([text('under'), ...['a', 'b', 'c', 'd', 'e'].map(command)], ['a', 'b', 'c', 'd', 'e'].map(id => anchorAt(id, 'center')))]));

// MARK: tile-parts
const partNeeds = ['sh.tile-parts@1', 'sh.tiles@1', 'sh.state-style@1'];
const P = '/document/pages/2/components/0/props';
accept('pending-tile-parts-two-discs-enabled-when', 'Two buttons on a state tile, each with an enabled rule and a visible rule.', [...partNeeds, 'sh.enabled-when@1', 'sh.call-service@1', 'sh.bindings@1', 'sh.conditions@1'],
  ...(() => { const [components, tweak] = onPage([stateTile('door', { discs: [disc('lock', { enabledWhen: { condition: hot, whenUnknown: 'disabled' } }), disc('unlock', { visibleWhen: hot, whenUnknown: 'hide' })] })]); return [components, tweak] as [J[], LayoutCase['tweak']]; })());
accept('pending-tile-parts-progress-read', 'A progress fill that reads a number from an entity.', [...partNeeds, 'sh.bindings@1'],
  ...onPage([stateTile('door', { progress: read('temp', ['state'], 'number') })]));
accept('pending-tile-parts-progress-math', 'A progress fill from a percentage divided by 100.', [...partNeeds, 'sh.bindings@1', 'sh.pipeline-operands@1'],
  ...onPage([stateTile('door', { progress: { type: 'math', op: 'divide', args: [read('temp', ['state'], 'number'), lit(100)] } })]));
accept('pending-tile-parts-destination', 'A tap on the tile opens a page.', [...partNeeds, 'sh.actions.navigation@1'], ...onPage([stateTile('door', {}, { action: push() })]));
accept('pending-tile-parts-subtitle-rule', 'A subtitle made by a rule.', [...partNeeds, 'sh.rules@1', 'sh.conditions@1', 'sh.operands@1', 'sh.bindings@1'],
  ...onPage([stateTile('door', { subtitle: { type: 'expr', value: { type: 'choose', cases: [{ when: hot, then: lit('Warm') }], otherwise: lit('Fine') } } })]));
reject('tile-parts-three-discs', 'A tile has at most two buttons.', partNeeds, { code: 'limit_exceeded', pointer: `${P}/discs` },
  ...onPage([stateTile('door', { discs: [disc('a'), disc('b'), disc('c')] })]));
reject('tile-parts-disc-domain-action', 'A button never takes a domain action.', [...partNeeds, 'sh.power-toggle@1', 'sh.bindings@1'], { code: 'invalid_combination', pointer: `${P}/discs/0/action/type` },
  ...onPage([stateTile('door', { discs: [disc('a', { action: { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } } })] })]));
reject('tile-parts-progress-text', 'A progress value is a number, never text.', [...partNeeds, 'sh.bindings@1'], { code: 'binding_type', pointer: `${P}/progress` },
  ...onPage([stateTile('door', { progress: lit('half') })]));
reject('tile-parts-duplicate-disc-id', 'Button ids are unique on a tile.', partNeeds, { code: 'duplicate_id', pointer: `${P}/discs/1/id` },
  ...onPage([stateTile('door', { discs: [disc('a'), disc('a')] })]));

// MARK: readout tone by rule
const toneNeeds = ['sh.rules@1', 'sh.conditions@1', 'sh.status-pill@1', 'sh.bindings@1'];
accept('pending-readout-tone-conditional', 'A readout whose tone follows a condition: each case a literal tone.', toneNeeds,
  ...onPage([node('pill', 'status-pill', { icon: symbol('bolt.fill'), props: { value: lit('20%'), detail: lit(''), tone: { type: 'conditional', cases: [{ when: hot, then: 'danger' }], otherwise: 'ok' }, unavailableText: 'Unavailable' } })]));
reject('readout-tone-outside-enum', 'A conditional tone holds one of the six tones.', toneNeeds, { code: 'unknown_variant', pointer: `${O}/props/tone` },
  ...onPage([node('pill', 'status-pill', { icon: symbol('bolt.fill'), props: { value: lit('20%'), detail: lit(''), tone: { type: 'conditional', cases: [{ when: hot, then: 'danger' }], otherwise: 'purple' }, unavailableText: 'Unavailable' } })]));

/** Every family prefix this module owns (a case name starts with `pending-<family>-` or `<family>-`). */
export const layoutFamilies = ['tab-blocks', 'tab-bar', 'overlay', 'tile-parts', 'readout-tone'] as const;

// MARK: Evaluation cases
interface Evaluation { name: string; note: string; subject: J; env: J; expected: J }
export const layoutEvaluations: Evaluation[] = [];
const value = (v: unknown): J => ({ status: 'value', value: v });
const progress = (name: string, note: string, operand: J, expected: number | null, env: J = {}) => layoutEvaluations.push({ name, note, subject: { progress: operand }, env, expected: { progress: expected } });
const reads = (map: Record<string, J>): J => ({ reads: map });
const fill = read('temp', ['state'], 'number');
progress('progress-zero', 'A progress of 0 is no fill, and is still a number.', fill, 0, reads({ 'temp/state': value('0') }));
progress('progress-fraction', 'A fraction between 0 and 1 is kept.', fill, 0.62, reads({ 'temp/state': value('0.62') }));
progress('progress-one', 'A progress of 1 is full.', fill, 1, reads({ 'temp/state': value('1') }));
progress('progress-clamped-above', 'A value above 1 is clamped to 1: 1.4 gives 1.', fill, 1, reads({ 'temp/state': value('1.4') }));
progress('progress-clamped-below', 'A value below 0 is clamped to 0.', fill, 0, reads({ 'temp/state': value('-0.5') }));
progress('progress-unavailable', 'An unavailable value draws no progress.', fill, null);
progress('progress-loading', 'A value that is loading draws no progress.', fill, null, reads({ 'temp/state': { status: 'loading' } }));
progress('progress-text-is-none', 'A value that is not a number draws no progress.', read('temp', ['state'], 'string'), null, reads({ 'temp/state': value('cleaning') }));
progress('progress-percentage-divided', 'A percentage divided by 100 gives the fraction: 62 gives 0.62.', { type: 'math', op: 'divide', args: [fill, lit(100)] }, 0.62, reads({ 'temp/state': value('62') }));
const enabled = (name: string, note: string, answer: boolean, env: J) => layoutEvaluations.push({ name, note, subject: { enabled: { condition: hot, whenUnknown: 'disabled' } }, env, expected: { enabled: answer } });
enabled('disc-enabled-yes', 'A button whose enabled rule holds is enabled.', true, reads({ 'temp/state': value('80') }));
enabled('disc-enabled-no', 'A button whose enabled rule does not hold is disabled.', false, reads({ 'temp/state': value('50') }));
enabled('disc-enabled-unknown', 'A button whose rule cannot be answered follows its policy: disabled here.', false, {});
const tabs3 = [{ id: 'controls' }, { id: 'rooms', visibleWhen: hot, whenUnknown: 'hide' }, { id: 'dock' }];
const shownTab = (name: string, note: string, requested: string, fallback: string | undefined, answer: string, env: J) =>
  layoutEvaluations.push({ name, note, subject: { tab: { tabs: tabs3, requested, ...(fallback ? { fallback } : {}) } }, env, expected: { tab: answer } });
shownTab('tab-shown-when-rule-holds', 'The tab asked for shows while its rule holds.', 'rooms', 'dock', 'rooms', reads({ 'temp/state': value('80') }));
shownTab('tab-hidden-takes-fallback', 'A tab hidden by its rule gives way to the fallback tab.', 'rooms', 'dock', 'dock', reads({ 'temp/state': value('50') }));
shownTab('tab-hidden-without-fallback-takes-first', 'With no fallback tab, a hidden tab gives way to the first tab that shows.', 'rooms', undefined, 'controls', reads({ 'temp/state': value('50') }));
shownTab('tab-unknown-hides-by-policy', 'A rule that cannot be answered hides the tab when its policy is hide.', 'rooms', 'dock', 'dock', {});
const toneRule: J = { type: 'conditional', cases: [{ when: cmp('below', read('temp', ['state'], 'number'), lit(20)), then: 'danger' }, { when: cmp('below', read('temp', ['state'], 'number'), lit(50)), then: 'warning' }], otherwise: 'ok' };
const tone = (name: string, note: string, answer: string, env: J) => layoutEvaluations.push({ name, note, subject: { tone: toneRule }, env, expected: { tone: answer } });
tone('tone-first-case', 'The first case that holds gives the tone.', 'danger', reads({ 'temp/state': value('10') }));
tone('tone-second-case', 'A later case holds when the first does not.', 'warning', reads({ 'temp/state': value('30') }));
tone('tone-otherwise', 'No case holding gives otherwise.', 'ok', reads({ 'temp/state': value('80') }));
tone('tone-unknown-shows-otherwise', 'A case that cannot be answered shows otherwise until it can, as a look does.', 'ok', {});
layoutEvaluations.push({ name: 'tone-plain', note: 'A plain tone is the tone.', subject: { tone: 'active' }, env: {}, expected: { tone: 'active' } });
