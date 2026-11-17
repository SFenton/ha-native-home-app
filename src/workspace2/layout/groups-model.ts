import { defaultGroups, groupStates, MAX_GROUPS, type GridGroup, type GridGroups, type GroupState } from '../../shared/composition/grid-groups';

/** The words of the three states, in the page's checkboxes: the contract's `active`, `idle` and `unavailable`. */
export const stateWords: Record<GroupState, string> = { active: 'On', idle: 'Off', unavailable: 'Unavailable' };
/** The preset when "Group by State" is switched on. */
export const presetGroups = (): GridGroups => defaultGroups();

/** The row's summary: "Off", or "2 Groups". */
export const groupsSummary = (groups: GridGroups | undefined): string => groups ? `${groups.items.length} ${groups.items.length === 1 ? 'Group' : 'Groups'}` : 'Off';

/** Whether another group can be added: a new group takes a state from a group that has two, so it needs one that does. The page then says "Every state is in a group." */
export const canAddGroup = (groups: GridGroups): boolean => groups.items.length < MAX_GROUPS && groups.items.some(group => group.states.length > 1);

const withItems = (groups: GridGroups, items: GridGroup[]): GridGroups => ({ ...groups, items });
const freshId = (groups: GridGroups): string => { let n = groups.items.length + 1; while (groups.items.some(item => item.id === `group-${n}`)) n++; return `group-${n}`; };

/** Ticks `state` in `target`: it leaves the group that held it, which is dropped if that leaves it with no state. Every state stays in exactly one group. */
export function tickState(groups: GridGroups, target: string, state: GroupState): GridGroups {
  const items = groups.items.map(group => group.id === target
    ? { ...group, states: groupStates.filter(item => item === state || group.states.includes(item)) }
    : { ...group, states: group.states.filter(item => item !== state) });
  return withItems(groups, items.filter(group => group.states.length > 0));
}
/** Adds a group after the last one, holding the last state of the last group that has two; its title is that state's word. */
export function addGroup(groups: GridGroups): GridGroups {
  if (!canAddGroup(groups)) return groups;
  const donor = [...groups.items].reverse().find(group => group.states.length > 1)!;
  const state = donor.states[donor.states.length - 1];
  const items = groups.items.map(group => group.id === donor.id ? { ...group, states: group.states.filter(item => item !== state) } : group);
  return withItems(groups, [...items, { id: freshId(groups), title: stateWords[state], states: [state] }]);
}
/** Removes a group: its states go to the group before it (the one after it when it is first), so no state is left out. The last group cannot be removed. */
export function removeGroup(groups: GridGroups, id: string): GridGroups {
  const at = groups.items.findIndex(group => group.id === id);
  if (at < 0 || groups.items.length < 2) return groups;
  const heir = at > 0 ? at - 1 : 1;
  const items = groups.items.filter((_, index) => index !== at).map(group => group.id === groups.items[heir].id
    ? { ...group, states: groupStates.filter(state => group.states.includes(state) || groups.items[at].states.includes(state)) } : group);
  return withItems(groups, items);
}
/** Moves a group one place earlier (-1) or later (1) in the drawn order. */
export function moveGroup(groups: GridGroups, id: string, by: -1 | 1): GridGroups {
  const at = groups.items.findIndex(group => group.id === id), to = at + by;
  if (at < 0 || to < 0 || to >= groups.items.length) return groups;
  const items = [...groups.items];
  [items[at], items[to]] = [items[to], items[at]];
  return withItems(groups, items);
}
/** Gives a group a title. */
export const retitle = (groups: GridGroups, id: string, title: string): GridGroups => withItems(groups, groups.items.map(group => group.id === id ? { ...group, title } : group));
