/**
 * What the tab bar holds. One table drives the Tabs panel: a later second group ("More in the iPad sidebar") is a
 * data change here, not a new layout (spec 5.2). Only the first group exists today.
 */
export interface TabGroup {
  id: string;
  /** The group header, followed by "· <n> of <capacity>". */
  title: string;
  /** How many tabs the group holds; undefined for no limit. */
  capacity?: number;
  /** The line shown when the group is full. */
  full?: string;
}

/** The tab bar on iPhone and iPad. */
export const tabGroups: readonly TabGroup[] = [{ id: 'bar', title: 'Tab bar', capacity: 5, full: 'The tab bar holds 5.' }];

/** A group with the tabs that fall into it, in order. */
export interface FilledGroup<T> { group: TabGroup; tabs: T[] }

/** Deals `tabs` into `groups` in order, each group taking up to its capacity; the last group takes the rest. */
export function fillTabGroups<T>(tabs: readonly T[], groups: readonly TabGroup[] = tabGroups): FilledGroup<T>[] {
  let at = 0;
  return groups.map((group, index) => {
    const take = group.capacity === undefined || index === groups.length - 1 && group.capacity === undefined ? tabs.length - at : group.capacity;
    const slice = tabs.slice(at, at + take);
    at += slice.length;
    return { group, tabs: slice };
  });
}

/** The group a new tab would join, or undefined when every group is full. */
export function groupWithRoom<T>(tabs: readonly T[], groups: readonly TabGroup[] = tabGroups): TabGroup | undefined {
  return fillTabGroups(tabs, groups).find(({ group, tabs: held }) => group.capacity === undefined || held.length < group.capacity)?.group;
}
