import { z } from 'zod/v4';
import { identifierSchema } from '../validation';
import { text } from './slots';

/**
 * `sh.grid-state-groups@1`: group a `tile-grid` by the state its tiles draw. An optional `props.groups` on `tile-grid`. Absent means today's grid, byte-identical.
 * Each tile sits under the heading of the group that holds its state: `active` (lit, filled or tinted active), `idle`, or `unavailable`. A group with no tiles is
 * not drawn; the grid stays one grid, so its columns are solved once (`build/design/sim-fidelity-contract.md`, section 3).
 */
const object = z.strictObject;

/** The three faces a tile draws, and so the three states a group holds. */
export const groupStates = ['active', 'idle', 'unavailable'] as const;
export type GroupState = typeof groupStates[number];
/** The most groups: one per state. */
export const MAX_GROUPS = 3;

export const gridGroupSchema = object({
  id: identifierSchema,
  /** The heading: title only (option A). */
  title: text(80),
  /** One to three states; the groups together hold each state exactly once. */
  states: z.array(z.enum(groupStates)).min(1).max(groupStates.length),
});
export const gridGroupsSchema = object({
  by: z.literal('state'),
  items: z.array(gridGroupSchema).min(1).max(MAX_GROUPS),
});
export type GridGroup = z.infer<typeof gridGroupSchema>;
export type GridGroups = z.infer<typeof gridGroupsSchema>;

/** One problem of a groups object, as a code at a pointer below `props/groups`. */
export interface GroupProblem { code: 'invalid_combination' | 'duplicate_id'; at: string }

/** The checks the shape cannot make: a group id is unique, a state appears in one group once, and every state appears. */
export function groupProblems(groups: GridGroups): GroupProblem[] {
  const found: GroupProblem[] = [], ids = new Set<string>(), seen = new Set<GroupState>();
  groups.items.forEach((group, at) => {
    if (ids.has(group.id)) found.push({ code: 'duplicate_id', at: `/items/${at}/id` }); ids.add(group.id);
    group.states.forEach((state, offset) => {
      if (seen.has(state)) found.push({ code: 'invalid_combination', at: `/items/${at}/states/${offset}` }); seen.add(state);
    });
  });
  if (groupStates.some(state => !seen.has(state))) found.push({ code: 'invalid_combination', at: '/items' });
  return found;
}

/** The preset when the option is switched on: "On" holding On, then "Off" holding Off and Unavailable (production's split of Lights). */
export const defaultGroups = (): GridGroups => ({ by: 'state', items: [
  { id: 'group-on', title: 'On', states: ['active'] },
  { id: 'group-off', title: 'Off', states: ['idle', 'unavailable'] },
] });

/** A tile's group index in `groups` for the state it draws; a state no group holds goes under the last group. */
export function groupIndexOf(groups: GridGroups, state: GroupState): number {
  const at = groups.items.findIndex(group => group.states.includes(state));
  return at < 0 ? groups.items.length - 1 : at;
}
/** The tiles of each group, in the groups' order and the grid's order inside a group; a group with no tile is dropped. */
export function arrange<T>(groups: GridGroups, tiles: readonly { key: string; state: GroupState; tile: T }[]): { group: GridGroup; tiles: { key: string; state: GroupState; tile: T }[] }[] {
  const buckets = groups.items.map(group => ({ group, tiles: [] as { key: string; state: GroupState; tile: T }[] }));
  for (const item of tiles) buckets[groupIndexOf(groups, item.state)].tiles.push(item);
  return buckets.filter(bucket => bucket.tiles.length > 0);
}
