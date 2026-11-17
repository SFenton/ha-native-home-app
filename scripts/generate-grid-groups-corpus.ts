/**
 * The corpus cases of `sh.grid-state-groups@1`: an optional `props.groups` on `tile-grid` (`{ by: 'state', items: [{ id, title, states }] }`).
 *
 *   tsx scripts/generate-grid-groups-corpus.ts   # rewrites contract/corpus/{accept,reject}/{pending-,}grid-groups-*.json and their index entries
 *
 * One to three groups; each of `active`, `idle` and `unavailable` is in exactly one; a title is not blank. Accepted cases are `reject/pending-grid-groups-*`;
 * refusals are `reject/grid-groups-*` with the Studio's first issue written here by hand. Demo ids only.
 */
import { at, demoSources, node, writeFamily, type J, type TileCase } from './tilecontract-lib';

const cases: TileCase[] = [];
const accept = (name: string, note: string, components: J[]) => cases.push({ name: `pending-grid-groups-${name}`, note, needs: ['grid-state-groups'], components, reject: false });
const reject = (name: string, note: string, components: J[], expect: TileCase['expect']) => cases.push({ name: `grid-groups-${name}`, note, needs: ['grid-state-groups'], components, reject: true, expect });

const space = { type: 'token', name: 'm' };
const tiles = (): J[] => [
  node('lamp', 'light-group-tile', { props: { sourceId: 'light-main' } }),
  node('blinds-tile', 'state-tile', { icon: { type: 'sf-symbol', name: 'blinds.horizontal.open', rendering: 'canonical', unavailable: 'fallback' }, binding: { entityId: 'cover.demo_blinds', builtIn: 'blind' }, props: {} }),
];
const grid = (groups?: J, props: J = {}): J => node('grid', 'tile-grid', {
  props: { minimum: 'tile@1', maxColumns: 2, spacing: space, equalRowHeights: false, shortRow: 'share', fold: 'page', ...(groups ? { groups } : {}), ...props }, children: tiles(),
});
const group = (id: string, title: string, states: string[]): J => ({ id, title, states });
const groupsPath = (rest: string) => at(0, `/props/groups${rest}`);
const by = (...items: J[]): J => ({ by: 'state', items });

// MARK: Accepted
accept('two-groups', 'Production\'s split: "On" holds the active tiles, "Off" the idle and the unavailable ones.', [grid(by(group('on', 'On', ['active']), group('off', 'Off', ['idle', 'unavailable'])))]);
accept('three-groups', 'One group for each state, in the order they are drawn.', [grid(by(group('on', 'On', ['active']), group('off', 'Off', ['idle']), group('gone', 'Unavailable', ['unavailable'])))]);
accept('single-group', 'One group holding every state: a heading over the whole grid.', [grid(by(group('all', 'Everything', ['active', 'idle', 'unavailable'])))]);
accept('order-follows-the-list', 'The list\'s order is the drawn order: "Off" first, then "On".', [grid(by(group('off', 'Off', ['idle', 'unavailable']), group('on', 'On', ['active'])))]);
accept('with-equal-row-heights', 'Groups in a grid that shares one row height: still one grid, one row height.', [grid(by(group('on', 'On', ['active']), group('off', 'Off', ['idle', 'unavailable'])), { equalRowHeights: true })]);
accept('without-groups-needs-no-id', 'A grid with no `groups` is today\'s grid and needs no new id.', [grid()]);

// MARK: Refused
reject('state-twice', 'A state may be in one group only: `idle` is in both.', [grid(by(group('on', 'On', ['active', 'idle']), group('off', 'Off', ['idle', 'unavailable'])))], { code: 'invalid_combination', pointer: groupsPath('/items/1/states/0') });
reject('state-twice-in-one-group', 'A state twice in one group is the same refusal.', [grid(by(group('all', 'All', ['active', 'idle', 'unavailable', 'idle'])))], { code: 'limit_exceeded', pointer: groupsPath('/items/0/states') });
reject('state-missing', 'Every state is in a group: `unavailable` is in none.', [grid(by(group('on', 'On', ['active']), group('off', 'Off', ['idle'])))], { code: 'invalid_combination', pointer: groupsPath('/items') });
reject('title-blank', 'A heading needs words.', [grid(by(group('on', '   ', ['active']), group('off', 'Off', ['idle', 'unavailable'])))], { code: 'invalid_value', pointer: groupsPath('/items/0/title') });
reject('title-too-long', 'A heading is at most 80 characters.', [grid(by(group('on', 'a'.repeat(81), ['active']), group('off', 'Off', ['idle', 'unavailable'])))], { code: 'limit_exceeded', pointer: groupsPath('/items/0/title') });
reject('four-groups', 'At most three groups, one for each state.', [grid(by(group('a', 'A', ['active']), group('b', 'B', ['idle']), group('c', 'C', ['unavailable']), group('d', 'D', ['active'])))], { code: 'limit_exceeded', pointer: groupsPath('/items') });
reject('no-groups', 'An empty list of groups is not grouping: leave `groups` out.', [grid(by())], { code: 'limit_exceeded', pointer: groupsPath('/items') });
reject('group-without-states', 'A group holds at least one state.', [grid(by(group('on', 'On', []), group('off', 'Off', ['active', 'idle', 'unavailable'])))], { code: 'limit_exceeded', pointer: groupsPath('/items/0/states') });
reject('duplicate-group-id', 'Group ids are unique within a grid.', [grid(by(group('same', 'On', ['active']), group('same', 'Off', ['idle', 'unavailable'])))], { code: 'duplicate_id', pointer: groupsPath('/items/1/id') });
reject('by-something-else', 'Only `by: "state"` is defined.', [grid({ by: 'room', items: [group('on', 'On', ['active', 'idle', 'unavailable'])] })], { code: 'unknown_variant', pointer: groupsPath('/by') });
reject('by-missing', '`by` is required.', [grid({ items: [group('on', 'On', ['active', 'idle', 'unavailable'])] })], { code: 'missing_required', pointer: groupsPath('/by') });
reject('unknown-state', 'A state is one of the three the tile draws.', [grid(by(group('on', 'On', ['active', 'idle', 'unavailable', 'loading'])))], { code: 'limit_exceeded', pointer: groupsPath('/items/0/states') });
reject('unknown-state-name', 'A state the tile cannot draw is refused.', [grid(by(group('on', 'On', ['lit', 'idle', 'unavailable'])))], { code: 'unknown_variant', pointer: groupsPath('/items/0/states/0') });
reject('unknown-field', 'A count or a collapse is not in `@1`: the heading is title only.', [grid({ ...by(group('on', 'On', ['active', 'idle', 'unavailable'])), count: true })], { code: 'unknown_field', pointer: groupsPath('/count') });
reject('capability-not-declared', 'A grid with `groups` whose manifest lacks `sh.grid-state-groups@1` does not match.', [grid(by(group('on', 'On', ['active', 'idle', 'unavailable'])))], { code: 'capability_manifest_mismatch', pointer: '/capabilities' });
cases[cases.length - 1].finish = envelope => { envelope.capabilities = envelope.capabilities.filter((name: string) => name !== 'sh.grid-state-groups@1'); };

writeFamily('grid-groups', cases, { 'grid-state-groups': 'sh.grid-state-groups@1' }, demoSources);
