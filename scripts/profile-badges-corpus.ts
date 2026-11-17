/**
 * The corpus cases of the four ids of the Profile Icon and badges lane (`pb-contract`): `sh.shell-profile@1` (the `profile` block of the `shell-header` item), `sh.avatar@1`
 * (the `avatar` node, "Profile Icon" in the Studio), `sh.badge-spoken@1` (a `spoken` text operand on a value badge) and `sh.badge-nodes@1` (a `badge` on `action-tile`,
 * `door-tile`, `light-group-tile`, `room-card`, `room-chip`, `settings-link` and `avatar`, and a drawn badge on a header `button`). Demo ids only.
 *
 * `generate-expression-corpus.ts` writes them with its own, so one generator owns `contract/corpus/evaluation`. Publication cases are `pending-profile-badges-*` (the Studio
 * compiles them) and `profile-badges-*` (the Studio refuses them); every refusal records the Studio's first issue here by hand in `expect`, and the generator fails when the
 * compiler disagrees. Show at Most and Spoken As are the Studio's and never published: the cases hold the operands they work out into (`cap` 9 is the `choose` of
 * `cappedValue`, which a unit test holds equal to the expansion), and a case that leaves a setting in a badge is refused as an unknown field. The evaluation cases are
 * written by hand.
 */
type J = Record<string, any>;

export interface ProfileBadgesCase {
  name: string; note: string; components: J[]; tweak?: (envelope: J) => void; needs: string[]; reject: boolean;
  /** The Studio's first issue, written by hand: a reject must give exactly this. */
  expect?: { code: string; pointer: string };
  /** Edits the envelope after the capabilities are computed (a manifest that does not match). */
  finish?: (envelope: J) => void;
}
export interface ProfileBadgesEvaluation { name: string; note: string; subject: J; env: J; expected: J }
/** The families this module owns: `reject/pending-<family>-*` and `reject/<family>-*`. */
export const pbFamilies = ['profile-badges'];
/** Capability ids by the short names the cases use. */
export const pbNeeds: Record<string, string> = {
  avatar: 'sh.avatar@1', 'badge-nodes': 'sh.badge-nodes@1', 'badge-spoken': 'sh.badge-spoken@1', 'shell-profile': 'sh.shell-profile@1', badges: 'sh.badges@1', rules: 'sh.rules@1',
  conditions: 'sh.conditions@1', 'pipeline-operands': 'sh.pipeline-operands@1',
};

// MARK: Builders
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const symbol = (name: string): J => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const node = (id: string, type: string, rest: J): J => ({ id, title: id, type, layout: { span: 1 }, ...rest });
const push = (pageId = 'page-lattice'): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const value = (operand: J, spoken?: J): J => ({ type: 'value', value: operand, ...(spoken ? { spoken } : {}) });
const fmt = (pattern: string, args: J): J => ({ type: 'format', pattern, args });
/** The count every case reads: an entity's state as a number. `temp` is a source the generator adds. */
const COUNT = read('temp', ['state'], 'number');
/** `cap` N as the compiler writes it: above N the text `N+`, otherwise the count as text. */
export const cappedValue = (count: J, cap: number): J => ({
  type: 'choose', cases: [{ when: { type: 'compare', op: 'above', left: count, right: lit(cap) }, then: lit(`${cap}+`) }], otherwise: fmt('{count}', { count }),
});
/** Spoken As "For 1" and "Otherwise" as the compiler writes them. */
export const spokenValue = (count: J, one: string | undefined, other: string): J => {
  const line = (text: string) => text.includes('{Count}') ? fmt(text.split('{Count}').join('{count}'), { count }) : lit(text);
  return one === undefined ? line(other) : { type: 'choose', cases: [{ when: { type: 'compare', op: 'eq', left: count, right: lit(1) }, then: line(one) }], otherwise: line(other) };
};
const overdue = (): J => value(cappedValue(COUNT, 9), spokenValue(COUNT, undefined, '{Count} overdue'));

// MARK: Nodes that can carry a badge
const avatar = (props: J = {}, rest: J = {}, id = 'me'): J => node(id, 'avatar', { props: { person: { type: 'viewer' }, ...props }, ...rest });
const roomState: J = { id: 'room-state', kind: 'ha-entity', entityId: lit('switch.demo_room') };
const doorSource: J = { id: 'door', kind: 'model', model: 'security-door@1', inputs: { entityId: lit('lock.demo_entity_406'), kind: 'lock' } };
const lightSource: J = { id: 'light-main', kind: 'model', model: 'home-light@1', inputs: { entityId: lit('light.demo_lamp') } };
const demoSources = (envelope: J, ...extra: J[]) => { envelope.document.dataSources.push(...extra); };
const doorState = (state: string, text: string, fill: J, active: boolean): J => ({ state, appearance: { icon: symbol('lock.fill'), fill, text }, active, error: false });
const doorTile = (rest: J = {}): J => node('front-door', 'door-tile', { props: {
  sourceId: 'door', kind: 'lock', states: [doorState('locked', 'Locked', { type: 'solid-rgb', red: 67, green: 160, blue: 71 }, false), doorState('unlocked', 'Unlocked', { type: 'solid-rgb', red: 229, green: 57, blue: 53 }, true)],
  fallback: { icon: symbol('lock'), fill: { type: 'solid-rgb', red: 84, green: 110, blue: 122 }, text: 'Unknown' }, loadingText: 'Loading', unavailableText: 'Unavailable', hiddenText: 'Hidden', errorText: "Didn't Respond",
  sendingOpenText: 'Sending Open...', sendingCloseText: 'Sending Close...', openLabel: 'Unlock', closeLabel: 'Lock', reverseLabel: 'Reverse' }, ...rest });
const roomProps = (kind: string): J => ({ kind, showState: true, subtitleSourceIds: [], activeStates: [], disabledStates: [], stateLabels: [] });
const roomCard = (rest: J = {}): J => node('card', 'room-card', { icon: symbol('square.grid.2x2'), binding: { sourceId: 'room-state', projection: 'room-state@1' }, props: roomProps('power'), ...rest });
const roomChip = (rest: J = {}): J => node('chip', 'room-chip', { icon: symbol('square.grid.2x2'), binding: { sourceId: 'room-state', projection: 'room-state@1' }, props: roomProps('occupancy'), ...rest });
const lightGroup = (rest: J = {}): J => node('lamps', 'light-group-tile', { props: { sourceId: 'light-main' }, ...rest });
const actionTile = (rest: J = {}): J => node('power', 'action-tile', {
  icon: symbol('power'), binding: { sourceId: 'source-power', projection: 'power-tile@1' }, props: { family: 'lights', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' },
  action: { type: 'domain', sourceId: 'source-power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } }, ...rest });
const settingsLink = (rest: J = {}): J => node('prefs', 'settings-link', { icon: symbol('gearshape'), props: { subtitle: '', showsChevron: true }, action: push(), ...rest });
const navTile = (rest: J = {}): J => node('nav', 'navigation-tile', { icon: symbol('house'), props: { family: 'neutral', selected: 'none', subtitle: lit('x') }, action: push(), ...rest });
const stateChip = (rest: J = {}): J => node('status', 'status-chip', { props: { sourceId: 'lights', states: [{ state: 'active', appearance: { icon: symbol('lightbulb.fill'), fill: { type: 'standard' } } }],
  fallback: { icon: symbol('lightbulb'), fill: { type: 'standard' } }, announcement: 'none' }, ...rest });

// MARK: Chrome
const HEADER: J = { id: 'native-header', type: 'shell-header', visibility: 'always',
  quickLinksAction: { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' }, profileAction: { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' } };
/** The header item, in the trailing group alone (the only place the app takes it), with a `profile` block when `profile` is given. */
const withHeader = (profile?: J) => (envelope: J) => {
  const groups = envelope.document.navigation.chrome.groups;
  groups.find((group: J) => group.id === 'chrome-utilities').items = [{ ...HEADER, ...(profile ? { profile } : {}) }];
};
const chromeButton = (badge: J): ((envelope: J) => void) => envelope => {
  envelope.document.navigation.chrome.groups[0].items.find((item: J) => item.id === 'chrome-inspect').badge = badge;
};
const tabBadge = (badge: J): ((envelope: J) => void) => envelope => { envelope.document.navigation.tabs[0].badge = badge; };
/** Runs several edits in order. */
const all = (...edits: ((envelope: J) => void)[]) => (envelope: J) => { for (const edit of edits) edit(envelope); };
const without = (id: string): ((envelope: J) => void) => envelope => { envelope.capabilities = envelope.capabilities.filter((name: string) => name !== id); };

export const pbCases: ProfileBadgesCase[] = [];
const accept = (name: string, note: string, needs: string[], components: J[], tweak?: ProfileBadgesCase['tweak']) =>
  pbCases.push({ name: `pending-profile-badges-${name}`, note, needs, components, tweak, reject: false });
const reject = (name: string, note: string, needs: string[], components: J[], expect: ProfileBadgesCase['expect'], tweak?: ProfileBadgesCase['tweak'], finish?: ProfileBadgesCase['finish']) =>
  pbCases.push({ name: `profile-badges-${name}`, note, needs, components, tweak, reject: true, expect, finish });
const at = (index: number, rest: string) => `/document/pages/2/components/${index}${rest}`;
const headerAt = (rest: string) => `/document/navigation/chrome/groups/1/items/0${rest}`;
const pageOnly: J[] = [];

// MARK: Accepted: the header's Profile button (sh.shell-profile@1)
accept('header-profile-photo', 'The header\'s Profile button asks for the person\'s photo over the initials, the default written out.', ['shell-profile'], pageOnly, withHeader({ look: 'photo' }));
accept('header-profile-initials', 'The initials disc only: no picture is asked for.', ['shell-profile'], pageOnly, withHeader({ look: 'initials' }));
accept('header-profile-symbol', 'The person symbol on glass, the web dashboard\'s look; the symbol is the header\'s alone.', ['shell-profile'], pageOnly, withHeader({ look: 'symbol' }));
accept('header-profile-empty', 'A profile block with nothing in it: the id is needed because the block is there.', ['shell-profile'], pageOnly, withHeader({}));
accept('header-profile-badge', 'The count the Profile button carries: the sum of two counts, "9+" above nine, and the words VoiceOver says for it.', ['shell-profile', 'badge-spoken', 'badge-nodes'], pageOnly, withHeader({
  look: 'photo', badge: value(cappedValue({ type: 'math', op: 'add', args: [COUNT, read('temp', ['attributes', 'extra'], 'number')] }, 9),
    spokenValue({ type: 'math', op: 'add', args: [COUNT, read('temp', ['attributes', 'extra'], 'number')] }, '1 item needs attention', '{Count} items need attention')) }));
accept('header-without-profile-needs-no-id', 'A header with no profile block is the header it always was: none of the four ids is declared.', [], pageOnly, withHeader());
accept('header-profile-badge-none', 'The built-in count is switched off by a badge of none: a drawn badge, no value.', ['shell-profile', 'badge-nodes'], pageOnly, withHeader({ badge: { type: 'none' } }));

// MARK: Accepted: the Profile Icon node (sh.avatar@1)
accept('avatar-viewer', 'The signed-in person as a row-sized disc: the smallest Profile Icon.', ['avatar'], [avatar()]);
accept('avatar-person-large', 'One named person as the large disc, with its title under it.', ['avatar'], [avatar({ person: { type: 'person', entityId: 'person.demo_alex' }, size: 'large' }, { title: 'Resident A' })]);
accept('avatar-look-photo', 'The photo over the initials, written out.', ['avatar'], [avatar({ look: 'photo' })]);
accept('avatar-look-initials', 'The initials only, for a wall tablet that shows no photos.', ['avatar'], [avatar({ look: 'initials' })]);
accept('avatar-fill-standard', 'The standard fill, the action blue.', ['avatar'], [avatar({ fill: { type: 'standard' } })]);
accept('avatar-fill-colour', 'An exact colour that keeps white initials at 4.5 to 1.', ['avatar'], [avatar({ fill: { type: 'solid-rgb', red: 0, green: 60, blue: 160 } })]);
accept('avatar-action', 'A disc that opens a page: a button, so it needs a title for VoiceOver.', ['avatar'], [avatar({}, { title: 'Open Profile', action: push() })]);
accept('avatar-decoration', 'No title and no action: the disc is decoration and VoiceOver skips it.', ['avatar'], [avatar({}, { title: '' })]);
accept('avatar-badge', 'A Profile Icon with a count and the words VoiceOver says for it.', ['avatar', 'badge-nodes', 'badge-spoken'], [avatar({}, { title: 'Alex', badge: overdue() })]);

// MARK: Accepted: a badge on each kind that could not carry one (sh.badge-nodes@1) and the spoken words (sh.badge-spoken@1)
const on = (name: string, note: string, build: (badge: J) => J, extra: J[] = []) => accept(`badge-${name}`, note, ['badge-nodes', 'badge-spoken'], [build(overdue())], envelope => demoSources(envelope, ...extra));
on('action-tile', 'A power tile with a count, "9+" above nine, and the words VoiceOver says.', badge => actionTile({ badge }));
on('door-tile', 'A door tile with a count.', badge => doorTile({ badge }), [doorSource]);
on('light-group-tile', 'A light group tile with a count.', badge => lightGroup({ badge }), [lightSource]);
on('room-card', 'A room card with a count.', badge => roomCard({ badge }), [roomState]);
on('room-chip', 'A room chip with a count.', badge => roomChip({ badge }), [roomState]);
on('settings-link', 'A settings row with a capsule before its chevron.', badge => settingsLink({ badge }));
accept('badge-text-four-characters', 'A text badge of four characters, the most it draws.', ['badge-nodes'], [doorTile({ badge: value(lit('NEW!')) })], envelope => demoSources(envelope, doorSource));
accept('badge-none-on-a-kind', 'A badge of none on a kind that could not carry one: the field is there, so the id is declared.', ['badge-nodes'], [actionTile({ badge: { type: 'none' } })]);
accept('badge-chrome-button', 'A header button whose badge is a value: drawn since this id, so the id is declared.', ['badge-nodes'], pageOnly, chromeButton(value(read('temp', ['state'], 'number'))));
accept('badge-chrome-button-none-needs-no-id', 'A header button whose badge is none is the button it always was: no new id.', [], pageOnly, chromeButton({ type: 'none' }));
accept('spoken-tab', 'A tab badge with its spoken words: the tab\'s name stays its label and the words are its value.', ['badge-spoken'], pageOnly, tabBadge(value(COUNT, lit('Several things'))));
accept('spoken-navigation-tile', 'The words VoiceOver says on a tile that already carried a badge.', ['badge-spoken'], [navTile({ badge: value(COUNT, lit('Several')) })]);
accept('spoken-chip', 'The words VoiceOver says on a chip that already carried a badge.', ['badge-spoken'], [stateChip({ badge: value(COUNT, lit('Several')) })]);
accept('spoken-chrome-button', 'The words VoiceOver says on a header button.', ['badge-nodes', 'badge-spoken'], pageOnly, chromeButton(value(COUNT, spokenValue(COUNT, '1 alert', '{Count} alerts'))));
accept('cap-9-expanded', 'Show at Most 9 as it is published: above nine the text "9+", otherwise the count as text; the spoken words say the whole number.', ['badge-spoken'], pageOnly, tabBadge(overdue()));
accept('cap-9-tab', 'Show at Most 9 alone on a tab, with no spoken words: the form the first publication uses, and it needs only the ids already shipped.', [], pageOnly, tabBadge(value(cappedValue(COUNT, 9))));
accept('spoken-for-one', 'Spoken As with a line for 1: the first case of a choose on the count equal to 1.', ['badge-spoken'], pageOnly, tabBadge(value(COUNT, spokenValue(COUNT, '1 item needs attention', '{Count} items need attention'))));

// MARK: Refused
reject('avatar-look-symbol', 'The person symbol is the header\'s alone: a node refuses it.', ['avatar'], [avatar({ look: 'symbol' })], { code: 'unknown_variant', pointer: at(0, '/props/look') });
reject('avatar-size-unknown', 'A Profile Icon has two sizes, row and large: no free size.', ['avatar'], [avatar({ size: 'medium' })], { code: 'unknown_variant', pointer: at(0, '/props/size') });
reject('avatar-person-not-a-person', 'A named person is a `person.*` entity.', ['avatar'], [avatar({ person: { type: 'person', entityId: 'light.demo_lamp' } })], { code: 'invalid_value', pointer: at(0, '/props/person/entityId') });
reject('avatar-person-id-too-long', 'An entity id is at most 255 characters.', ['avatar'], [avatar({ person: { type: 'person', entityId: `person.demo_${'a'.repeat(250)}` } })], { code: 'limit_exceeded', pointer: at(0, '/props/person/entityId') });
reject('avatar-viewer-with-entity', 'The viewer is whoever is signed in: it names no entity.', ['avatar'], [avatar({ person: { type: 'viewer', entityId: 'person.demo_alex' } })], { code: 'unknown_field', pointer: at(0, '/props/person/entityId') });
reject('avatar-fill-low-contrast', 'White initials are not readable on a pale yellow: the fill must reach 4.5 to 1.', ['avatar'], [avatar({ fill: { type: 'solid-rgb', red: 255, green: 235, blue: 59 } })], { code: 'invalid_value', pointer: at(0, '/props/fill') });
reject('avatar-fill-pair', 'The fill is one colour: a light and dark pair is refused.', ['avatar', 'badge-nodes'], [avatar({ fill: { type: 'solid-appearance', light: { type: 'solid-rgb', red: 0, green: 60, blue: 160 }, dark: { type: 'solid-rgb', red: 0, green: 60, blue: 160 } } })], { code: 'unknown_variant', pointer: at(0, '/props/fill/type') });
reject('avatar-action-without-title', 'A disc that is a button needs a title for VoiceOver.', ['avatar'], [avatar({}, { title: '', action: push() })], { code: 'missing_required', pointer: at(0, '/title') });
reject('avatar-unknown-prop', 'The props are closed.', ['avatar'], [avatar({ shape: 'square' })], { code: 'unknown_field', pointer: at(0, '/props/shape') });
reject('avatar-action-not-navigation', 'A Profile Icon opens a page: a service call is refused.', ['avatar'], [avatar({}, { title: 'Open', action: { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: lit('light.demo_lamp') } } })], { code: 'unknown_variant', pointer: at(0, '/action/type') });
reject('header-profile-look-unknown', 'The header\'s Profile button has three looks.', ['shell-profile'], pageOnly, { code: 'unknown_variant', pointer: headerAt('/profile/look') }, withHeader({ look: 'photo-only' }));
reject('header-profile-unknown-field', 'The profile block is closed.', ['shell-profile'], pageOnly, { code: 'unknown_field', pointer: headerAt('/profile/size') }, withHeader({ size: 'large' }));
reject('header-profile-badge-boolean', 'A badge is a number or text: a boolean is refused here too.', ['shell-profile'], pageOnly, { code: 'binding_type', pointer: headerAt('/profile/badge/value') }, withHeader({ badge: value(read('temp', ['state'], 'boolean')) }));
reject('header-profile-on-a-button', 'Only the header item has a profile block.', ['shell-profile'], pageOnly, { code: 'unknown_field', pointer: '/document/navigation/chrome/groups/0/items/1/profile' },
  envelope => { envelope.document.navigation.chrome.groups[0].items[1].profile = { look: 'photo' }; });
reject('spoken-not-text', 'The spoken words are text: a number is refused.', ['badge-spoken'], pageOnly, { code: 'binding_type', pointer: '/document/navigation/tabs/0/badge/spoken' }, tabBadge(value(COUNT, lit(3))));
reject('spoken-boolean', 'A boolean read is not text either.', ['badge-spoken'], pageOnly, { code: 'binding_type', pointer: '/document/navigation/tabs/0/badge/spoken' }, tabBadge(value(COUNT, read('temp', ['state'], 'boolean'))));
reject('spoken-on-none', 'A badge of none says nothing else.', ['badge-spoken'], pageOnly, { code: 'unknown_field', pointer: '/document/navigation/tabs/0/badge/spoken' }, tabBadge({ type: 'none', spoken: lit('x') }));
reject('spoken-unknown-reference', 'The spoken words read a source the document has.', ['badge-spoken'], pageOnly, { code: 'invalid_reference', pointer: '/document/navigation/tabs/0/badge/spoken/from/sourceId' }, tabBadge(value(COUNT, read('missing', ['state']))));
reject('badge-text-too-long', 'A badge draws at most four characters: five are refused on a kind that carries one since this id.', ['badge-nodes'], [doorTile({ badge: value(lit('Alert')) })], { code: 'limit_exceeded', pointer: at(0, '/badge/value') }, envelope => demoSources(envelope, doorSource));
reject('badge-text-too-long-in-a-rule', 'A text a rule can give is held to the same four characters.', ['badge-nodes'], [actionTile({ badge: value({ type: 'choose', cases: [{ when: { type: 'compare', op: 'above', left: COUNT, right: lit(9) }, then: lit('Many!') }], otherwise: lit('1') }) })],
  { code: 'limit_exceeded', pointer: at(0, '/badge/value') });
reject('badge-on-a-kind-boolean', 'A badge is a number or text on every kind.', ['badge-nodes'], [roomChip({ badge: value(read('temp', ['state'], 'boolean')) })], { code: 'binding_type', pointer: at(0, '/badge/value') }, envelope => demoSources(envelope, roomState));
reject('badge-on-a-text-node', 'A text node has no badge.', ['badge-nodes'], [node('t', 'text', { props: { value: lit('x'), style: 'body', unavailableText: 'None' }, badge: value(lit(1)) })], { code: 'unknown_field', pointer: at(0, '/badge') });
reject('cap-left-in-a-publication', 'Show at Most is the Studio\'s: a publication that leaves `cap` in a badge is refused as an unknown field.', ['badge-spoken'], pageOnly,
  { code: 'unknown_field', pointer: '/document/navigation/tabs/0/badge/cap' }, tabBadge({ ...value(COUNT), cap: 9 }));
reject('spoken-as-left-in-a-publication', 'Spoken As is the Studio\'s: a publication that leaves its lines in a badge is refused as an unknown field.', ['badge-spoken'], pageOnly,
  { code: 'unknown_field', pointer: '/document/navigation/tabs/0/badge/spokenOther' }, tabBadge({ ...value(COUNT), spokenOther: '{Count} overdue' }));
reject('avatar-capability-not-declared', 'A Profile Icon whose manifest does not list `sh.avatar@1` does not match the document.', ['avatar'], [avatar()], { code: 'capability_manifest_mismatch', pointer: '/capabilities' }, undefined, without('sh.avatar@1'));
reject('shell-profile-capability-not-declared', 'A profile block whose manifest does not list `sh.shell-profile@1` does not match the document.', ['shell-profile'], pageOnly, { code: 'capability_manifest_mismatch', pointer: '/capabilities' }, withHeader({ look: 'photo' }), without('sh.shell-profile@1'));
reject('badge-spoken-capability-not-declared', 'A spoken badge whose manifest does not list `sh.badge-spoken@1` does not match the document.', ['badge-spoken'], pageOnly, { code: 'capability_manifest_mismatch', pointer: '/capabilities' }, tabBadge(overdue()), without('sh.badge-spoken@1'));
reject('badge-nodes-capability-not-declared', 'A badge on a door tile whose manifest does not list `sh.badge-nodes@1` does not match the document.', ['badge-nodes'], [actionTile({ badge: value(COUNT) })], { code: 'capability_manifest_mismatch', pointer: '/capabilities' }, undefined, without('sh.badge-nodes@1'));

// MARK: Evaluation cases
const env = (count?: unknown): J => count === undefined ? {} : { reads: { 'temp/state': count === 'loading' ? { status: 'loading' } : { status: 'value', value: count } } };
export const pbEvaluations: ProfileBadgesEvaluation[] = [];
const evaluation = (name: string, note: string, badge: J, expected: J, environment: J = {}) => pbEvaluations.push({ name, note, subject: { badge }, env: environment, expected });
const cap9 = value(cappedValue(COUNT, 9));
evaluation('badge-cap-below', 'Show at Most 9, as published: a count below the cap is its text.', cap9, { status: 'value', text: '3' }, env(3));
evaluation('badge-cap-at', 'A count equal to the cap is its text: only above it is capped.', cap9, { status: 'value', text: '9' }, env(9));
evaluation('badge-cap-above', 'A count above the cap reads the cap and a plus.', cap9, { status: 'value', text: '9+' }, env(10));
evaluation('badge-cap-far-above', 'The count may be any size: 120 is still 9+.', cap9, { status: 'value', text: '9+' }, env(120));
evaluation('badge-cap-zero', 'A count of 0 draws no badge, capped or not.', cap9, { status: 'value', text: null }, env(0));
evaluation('badge-cap-loading-keeps', 'While the count is loading the badge keeps what it showed.', cap9, { status: 'loading' }, env('loading'));
evaluation('badge-cap-unavailable-hides', 'A count that cannot be read draws nothing, as a plain count does: a stalled rule with no source loading is unavailable, not "not yet".', cap9, { status: 'value', text: null }, env());
evaluation('badge-spoken-literal', 'A badge says its spoken words after the name: the text is drawn, the words are said.', value(lit(3), lit('3 items')), { status: 'value', text: '3', spoken: '3 items' });
evaluation('badge-spoken-whole-count', 'The spoken words carry the whole count, never "9+": 12 is drawn 9+ and said "12 overdue".', overdue(), { status: 'value', text: '9+', spoken: '12 overdue' }, env(12));
evaluation('badge-spoken-below-cap', 'Below the cap the drawn text and the count agree.', overdue(), { status: 'value', text: '4', spoken: '4 overdue' }, env(4));
evaluation('badge-spoken-for-one', 'A line for 1 is the first case of a choose on the count equal to 1.', value(COUNT, spokenValue(COUNT, '1 item needs attention', '{Count} items need attention')),
  { status: 'value', text: '1', spoken: '1 item needs attention' }, env(1));
evaluation('badge-spoken-otherwise', 'Any other count uses the Otherwise line.', value(COUNT, spokenValue(COUNT, '1 item needs attention', '{Count} items need attention')),
  { status: 'value', text: '2', spoken: '2 items need attention' }, env(2));
evaluation('badge-spoken-hidden-at-zero', 'A badge that draws nothing says nothing.', overdue(), { status: 'value', text: null, spoken: null }, env(0));
evaluation('badge-spoken-empty-says-the-text', 'Empty spoken words say the drawn text: the system default.', value(lit(3), lit('')), { status: 'value', text: '3', spoken: null });
evaluation('badge-spoken-not-text-says-the-text', 'Evaluation is total: a spoken value that is not text says the drawn text (the compiler refuses it).', value(lit(3), lit(7)), { status: 'value', text: '3', spoken: null });
evaluation('badge-spoken-unavailable-says-the-text', 'A spoken value that cannot be read says the drawn text.', value(lit(3), read('words', ['state'])), { status: 'value', text: '3', spoken: null });
evaluation('badge-spoken-loading-keeps', 'A spoken value that is still loading keeps what the badge showed.', value(lit(3), read('words', ['state'])), { status: 'loading' }, { reads: { 'words/state': { status: 'loading' } } });
evaluation('badge-spoken-with-text-badge', 'A text badge keeps its text and says its words.', value(lit('!'), lit('Needs attention')), { status: 'value', text: '!', spoken: 'Needs attention' });
