import { readBindingPath } from './runtime';
import { choreResident, readChoreList, sortChoreItems } from './native-chores';
import type { Component, Json, Primitive, StudioDocument } from './types';
import { matchesSearch } from './interactions';

export function canShowResidentContent(component: Component, document: StudioDocument): boolean {
  if (component.props.requiresResident !== true) return true;
  return choreResident(component, document) !== undefined;
}

export function resolveCollection(component: Component, value: Json | undefined, variables: Record<string, Primitive>, search?: { query: Primitive | undefined; paths: readonly string[] }): { value: Json; sourceIndex: number }[] {
  let records: { value: Json; sourceIndex: number }[];
  if (component.props.collectionKind === 'todo-items' && typeof component.props.entityId === 'string') {
    const list = readChoreList(value, component.props.entityId);
    records = list.status === 'ready' ? sortChoreItems(list.items).filter(item => component.props.hideCompleted === false || item.status !== 'completed').map((item, sourceIndex) => ({ value: item, sourceIndex })) : [];
  } else {
    if (component.props.requiredData) return [];
    records = Array.isArray(value) ? value.map((value, sourceIndex) => ({ value, sourceIndex })) : [];
  }
  if (component.props.collectionKind === 'household-people') records = records.filter(({ value }) => {
    const id = readBindingPath(value, 'entityId');
    return typeof id === 'string' && id.startsWith('person.') && readBindingPath(value, 'state') === 'home';
  });
  const { filterPath, filterVariable, sortBy, sortDirection, sortDirectionVariable } = component.props;
  const filter = typeof filterVariable === 'string' ? variables[filterVariable] : undefined;
  if (typeof filterPath === 'string' && filterPath && filter !== undefined && filter !== null && filter !== '') {
    records = records.filter(record => readBindingPath(record.value, filterPath) === filter);
  }
  if (search) records = records.filter(record => matchesSearch(record.value, search.query, search.paths));
  if (typeof sortBy === 'string' && sortBy) {
    const direction = typeof sortDirectionVariable === 'string' ? variables[sortDirectionVariable] : sortDirection;
    const order = direction === 'desc' || direction === true ? -1 : 1;
    records.sort((left, right) => {
      const a = readBindingPath(left.value, sortBy), b = readBindingPath(right.value, sortBy);
      if (a === undefined || a === null) return b === undefined || b === null ? 0 : 1;
      if (b === undefined || b === null) return -1;
      return order * (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
    });
  }
  return records;
}
