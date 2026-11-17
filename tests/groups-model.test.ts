import { describe, expect, it } from 'vitest';
import { groupProblems, type GridGroups } from '../src/shared/composition/grid-groups';
import { addGroup, canAddGroup, groupsSummary, moveGroup, presetGroups, removeGroup, retitle, tickState } from '../src/workspace2/layout/groups-model';

const shape = (groups: GridGroups) => groups.items.map(group => `${group.title}:${group.states.join('+')}`);

describe('Group by State on the page', () => {
  it('summarises as Off, 1 Group or N Groups', () => {
    expect(groupsSummary(undefined)).toBe('Off');
    expect(groupsSummary(presetGroups())).toBe('2 Groups');
    expect(groupsSummary({ by: 'state', items: [presetGroups().items[0]] })).toBe('1 Group');
  });
  it('starts as production does: On, then Off holding Off and Unavailable', () => {
    expect(shape(presetGroups())).toEqual(['On:active', 'Off:idle+unavailable']);
  });
  it('moves a ticked state out of the group that held it, so every state stays in one group', () => {
    const next = tickState(presetGroups(), 'group-on', 'idle');
    expect(shape(next)).toEqual(['On:active+idle', 'Off:unavailable']);
    expect(groupProblems(next)).toEqual([]);
  });
  it('drops a group that ticking leaves with no state', () => {
    const next = tickState(presetGroups(), 'group-off', 'active');
    expect(shape(next)).toEqual(['Off:active+idle+unavailable']);
    expect(groupProblems(next)).toEqual([]);
  });
  it('adds a group from the last group that has two states, and is full at three groups', () => {
    const three = addGroup(presetGroups());
    expect(shape(three)).toEqual(['On:active', 'Off:idle', 'Unavailable:unavailable']);
    expect(groupProblems(three)).toEqual([]);
    expect(canAddGroup(three)).toBe(false);
    expect(addGroup(three)).toBe(three);
    const one = { by: 'state', items: [{ id: 'all', title: 'All', states: ['active', 'idle', 'unavailable'] }] } as GridGroups;
    expect(shape(addGroup(one))).toEqual(['All:active+idle', 'Unavailable:unavailable']);
  });
  it('removes a group into the one before it (the one after it when it is first), and never the last', () => {
    expect(shape(removeGroup(presetGroups(), 'group-off'))).toEqual(['On:active+idle+unavailable']);
    expect(shape(removeGroup(presetGroups(), 'group-on'))).toEqual(['Off:active+idle+unavailable']);
    const single = removeGroup(presetGroups(), 'group-off');
    expect(removeGroup(single, 'group-on')).toBe(single);
  });
  it('moves a group up or down, and stops at the ends', () => {
    expect(shape(moveGroup(presetGroups(), 'group-on', 1))).toEqual(['Off:idle+unavailable', 'On:active']);
    const same = presetGroups();
    expect(moveGroup(same, 'group-on', -1)).toBe(same);
  });
  it('retitles a group', () => { expect(shape(retitle(presetGroups(), 'group-on', 'Lit'))[0]).toBe('Lit:active'); });
});
