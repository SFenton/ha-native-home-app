import { choreRecord } from './native-chores';
import { readBindingPath } from './runtime';
import type { Component, FloatingButton, Json, Page, PageSearch, Primitive, RowActions } from './types';

export const isTodoList = (component: Component) => ['todo-items', 'resident-todo-items'].includes(String(component.props.collectionKind));
export const interactionComponents = (components: Component[]): Component[] => components.flatMap(component => [component, ...interactionComponents(component.children ?? [])]);
export const safeRecordPath = (path: string) => path.length <= 500 && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path) && !path.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key));
export const normalizeQuery = (query: string) => query.trim().normalize('NFKC').toLocaleLowerCase();
export function matchesSearch(value: Json, query: Primitive | undefined, paths: readonly string[]): boolean {
  const needle = typeof query === 'string' ? normalizeQuery(query) : '';
  return !needle || paths.some(path => {
    const scalar = readBindingPath(value, path);
    return scalar !== null && scalar !== undefined && typeof scalar !== 'object' && normalizeQuery(String(scalar)).includes(needle);
  });
}
export function searchTargets(search: PageSearch | undefined, components: Component[]): string[] {
  if (search?.mode !== 'filter') return [];
  const all = interactionComponents(components);
  return search.targetComponentIds.flatMap(id => {
    const component = all.find(item => item.id === id);
    return component?.props.nativeTodoPage === true ? interactionComponents(component.children ?? []).filter(isTodoList).map(item => item.id) : [id];
  });
}
export function collectionKeys(values: readonly Json[], path: string): string[] {
  const seen = new Set<string>();
  return values.map(value => {
    const key = readBindingPath(value, path);
    if (typeof key !== 'string' || !key.trim() || key.length > 512 || seen.has(key)) throw new Error('Row actions require unique nonblank string keys (at most 512 characters). Check the configured key path and data.');
    seen.add(key);
    return key;
  });
}
export function legacyFloatingButtons(page: Page): FloatingButton[] {
  return interactionComponents(page.components).filter(component => component.props.nativeTodoPage === true).flatMap(component => {
    const add = choreRecord(component.props.addAction ?? component.children?.[0]?.props.addAction);
    return Object.keys(add).length ? [{ id: `${component.id}-legacy-add`, label: Object.hasOwn(add, 'groceryItem') ? 'Add Groceries' : 'Add Task', icon: 'plus', action: { type: 'todo-add' as const, componentId: component.id } }] : [];
  });
}
export function legacyRowActions({ taskForm, grocery, admin }: { taskForm: boolean; grocery: boolean; admin: boolean }): RowActions {
  return {
    leading: [{ id: 'legacy-complete', label: 'Complete', completedLabel: 'Mark Not Done', icon: 'checkmark.circle.fill', color: '#2A732E', fullSwipe: true, action: { type: 'todo-row', operation: 'toggle' } }],
    trailing: [
      ...(!admin && (taskForm || grocery) ? [{ id: 'legacy-delete', label: 'Delete', icon: 'trash', color: '#D93025', fullSwipe: true, action: { type: 'todo-row' as const, operation: 'delete' as const }, ...(!grocery ? { confirmation: { title: 'Delete Task simulation', message: 'This removes the row from the simulation only.', confirmLabel: 'Delete', cancelLabel: 'Cancel', destructive: true } } : {}) }] : []),
      ...(admin || taskForm ? [{ id: 'legacy-edit', label: 'Edit', icon: 'square.and.pencil', color: '#0071E3', fullSwipe: admin, action: { type: 'todo-row' as const, operation: 'edit' as const } }] : []),
    ],
  };
}
export function contrastForeground(color: string): string {
  const hex = color.slice(1), rgb = hex.length === 3 ? [...hex].map(c => parseInt(c + c, 16)) : [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const luminance = rgb.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  return luminance > .179 ? '#000000' : '#FFFFFF';
}
