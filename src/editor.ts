import type { Action, Component, LiveActivity, Page, StudioDocument } from './shared/types';
import { createId } from './shared/ids';
import { isSafeUrl } from './shared/urls';
import { containerTypes as containers } from './shared/catalog';
export { containers };

export type Variant = keyof LiveActivity['variants'];
export const variants: Variant[] = ['lockScreen', 'compactLeading', 'compactTrailing', 'minimal', 'expanded'];
export const variantLabels: Record<Variant, string> = { lockScreen: 'Lock Screen', compactLeading: 'Compact leading', compactTrailing: 'Compact trailing', minimal: 'Minimal', expanded: 'Expanded' };
export type Target = { kind: 'page' | 'modal'; id: string } | { kind: 'activity'; id: string; variant: Variant };
export type Edit = (document: StudioDocument) => void;
export const uid = createId;

export function getPage(document: StudioDocument, target: Target): Page | undefined {
  return target.kind === 'activity' ? undefined : (target.kind === 'page' ? document.pages : document.modals).find(page => page.id === target.id);
}

export function getComponents(document: StudioDocument, target: Target): Component[] {
  return target.kind === 'activity'
    ? document.liveActivities.find(activity => activity.id === target.id)?.variants[target.variant] ?? []
    : getPage(document, target)?.components ?? [];
}

export function findComponent(components: Component[], id: string): Component | undefined {
  for (const component of components) {
    if (component.id === id) return component;
    const child = findComponent(component.children ?? [], id);
    if (child) return child;
  }
}

export function findSiblings(components: Component[], id: string): Component[] | undefined {
  if (components.some(component => component.id === id)) return components;
  for (const component of components) {
    const siblings = findSiblings(component.children ?? [], id);
    if (siblings) return siblings;
  }
}

export function duplicateComponent(component: Component): Component {
  const duplicate = structuredClone(component);
  const ids = new Map<string, string>();
  for (const item of flattenComponents([duplicate])) { const id = uid(item.type); ids.set(item.id, id); item.id = id; }
  for (const item of flattenComponents([duplicate])) {
    for (const key of ['destinationId', 'initialDestinationId', 'initialTabId']) {
      const old = item.props[key];
      if (typeof old === 'string' && ids.has(old)) item.props[key] = ids.get(old)!;
    }
    if (item.rowActions) for (const action of [...item.rowActions.leading, ...item.rowActions.trailing]) action.id = uid('swipe');
  }
  return duplicate;
}

export function duplicatePage<T extends Page>(page: T): T {
  const duplicate = structuredClone(page), ids = new Map<string, string>();
  duplicate.id = uid('surface');
  const remapAction = (action: Action): Action => {
    if (!('presentation' in page) && action.type === 'navigate' && action.pageId === page.id) return { ...action, pageId: duplicate.id };
    if ('presentation' in page && action.type === 'modal' && action.modalId === page.id) return { ...action, modalId: duplicate.id };
    return action;
  };
  for (const component of flattenComponents(duplicate.components)) { const id = uid(component.type); ids.set(component.id, id); component.id = id; }
  for (const component of flattenComponents(duplicate.components)) {
    for (const key of ['destinationId', 'initialDestinationId', 'initialTabId']) {
      const old = component.props[key];
      if (typeof old === 'string' && ids.has(old)) component.props[key] = ids.get(old)!;
    }
    if (component.action) component.action = remapAction(component.action);
    for (const descriptor of [...(component.rowActions?.leading ?? []), ...(component.rowActions?.trailing ?? [])]) {
      descriptor.id = uid('swipe');
      if (descriptor.action.type !== 'todo-row') descriptor.action = remapAction(descriptor.action);
    }
  }
  for (const action of duplicate.toolbar) { action.id = uid('toolbar'); action.action = remapAction(action.action); }
  for (const button of duplicate.floatingButtons ?? []) {
    button.id = uid('floating');
    if (button.action.type === 'todo-add') button.action.componentId = ids.get(button.action.componentId) ?? button.action.componentId;
    else button.action = remapAction(button.action);
  }
  if (duplicate.search) {
    duplicate.search.id = uid('search');
    if (duplicate.search.mode === 'filter') duplicate.search.targetComponentIds = duplicate.search.targetComponentIds.map(id => ids.get(id) ?? id);
  }
  return duplicate;
}

export function assertCanRemoveComponent(page: Page | undefined, id: string): void {
  const item = page && findComponent(page.components, id);
  if (!item || !page) return;
  const ids = new Set(flattenComponents([item]).map(item => item.id));
  if (page.floatingButtons?.some(button => button.action.type === 'todo-add' && ids.has(button.action.componentId))
    || (page.search?.mode === 'filter' && page.search.targetComponentIds.some(id => ids.has(id))))
    throw new Error('This component is used by floating actions or search. Edit those controls before deleting or moving it to another surface.');
  if (page.search?.mode === 'endpoint') {
    const sourceId = page.search.sourceId;
    if (!flattenComponents(page.components).some(item => !ids.has(item.id) && item.binding?.sourceId === sourceId))
      throw new Error('Search needs a bound component on this surface. Edit search before deleting or moving its last bound component.');
  }
}
export function interactionReferences(document: StudioDocument, kind: 'source' | 'variable', id: string): boolean {
  const actions = [
    ...allComponents(document).flatMap(component => [...(component.rowActions?.leading ?? []), ...(component.rowActions?.trailing ?? [])]),
    ...[...document.pages, ...document.modals].flatMap(page => page.floatingButtons ?? []),
  ];
  return [...document.pages, ...document.modals].some(page => kind === 'source'
    ? page.search?.mode === 'endpoint' && page.search.sourceId === id
    : page.search?.mode === 'filter' && page.search.queryVariable === id)
    || (kind === 'variable' && actions.some(({ action }) => (action.type === 'set' || action.type === 'toggle') && action.variable === id));
}
export function removeComponent(components: Component[], id: string): void {
  const siblings = findSiblings(components, id);
  if (siblings) siblings.splice(siblings.findIndex(component => component.id === id), 1);
}

export function insertComponent(components: Component[], component: Component, afterId?: string, inside = false, placement: 'before' | 'after' = 'after'): void {
  const destination = afterId ? findComponent(components, afterId) : undefined;
  if (inside && destination && containers.has(destination.type)) {
    (destination.children ??= []).push(component);
    return;
  }
  const siblings = afterId ? findSiblings(components, afterId) : undefined;
  if (siblings) siblings.splice(siblings.findIndex(item => item.id === afterId) + (placement === 'after' ? 1 : 0), 0, component);
  else components.push(component);
}

export function moveComponent(components: Component[], id: string, overId: string, inside = false, placement?: 'before' | 'after'): boolean {
  if (id === overId) return false;
  const component = findComponent(components, id);
  if (!component || findComponent(component.children ?? [], overId)) return false;
  const source = findSiblings(components, id);
  const over = findComponent(components, overId);
  const destination = inside && over && containers.has(over.type) ? (over.children ??= []) : findSiblings(components, overId);
  if (!source || !destination) return false;
  const sourceIndex = source.findIndex(item => item.id === id);
  const originalIndex = destination.findIndex(item => item.id === overId);
  source.splice(sourceIndex, 1);
  if (inside && over && containers.has(over.type)) destination.push(component);
  else destination.splice(placement ? destination.findIndex(item => item.id === overId) + (placement === 'after' ? 1 : 0) : originalIndex, 0, component);
  return true;
}

export function reorderComponent(components: Component[], id: string, offset: number): void {
  const siblings = findSiblings(components, id);
  if (!siblings) return;
  const index = siblings.findIndex(component => component.id === id);
  const next = index + offset;
  if (next < 0 || next >= siblings.length) return;
  const [component] = siblings.splice(index, 1);
  siblings.splice(next, 0, component);
}

export function allComponents(document: StudioDocument): Component[] {
  return [...document.pages, ...document.modals].flatMap(page => flattenComponents(page.components)).concat(document.liveActivities.flatMap(activity => variants.flatMap(variant => flattenComponents(activity.variants[variant]))));
}

export function flattenComponents(components: Component[]): Component[] {
  return components.flatMap(component => [component, ...flattenComponents(component.children ?? [])]);
}

export function deleteSurface(document: StudioDocument, target: Target): void {
  if (target.kind === 'activity') {
    document.liveActivities = document.liveActivities.filter(item => item.id !== target.id);
    return;
  }
  if (target.kind === 'page' && document.pages.length < 2) throw new Error('Keep at least one page in your project.');
  if (target.kind === 'page') {
    document.pages = document.pages.filter(item => item.id !== target.id);
    document.navigation.tabs = document.navigation.tabs.filter(tab => tab.pageId !== target.id);
    if (document.navigation.initialPageId === target.id) document.navigation.initialPageId = document.pages[0].id;
  } else document.modals = document.modals.filter(item => item.id !== target.id);
  const clearReference = (action: Action | undefined): Action | undefined =>
    (action?.type === 'navigate' && action.pageId === target.id) || (action?.type === 'modal' && action.modalId === target.id) ? { type: 'none' } : action;
  for (const component of allComponents(document)) {
    const action = clearReference(component.action);
    if (action !== component.action) { delete component.props.initialDestinationId; delete component.props.initialTabId; }
    component.action = action;
    for (const descriptor of [...(component.rowActions?.leading ?? []), ...(component.rowActions?.trailing ?? [])])
      if (descriptor.action.type !== 'todo-row') descriptor.action = clearReference(descriptor.action) ?? { type: 'none' };
  }
  for (const page of [...document.pages, ...document.modals]) {
    for (const action of page.toolbar) action.action = clearReference(action.action) ?? { type: 'none' };
    for (const button of page.floatingButtons ?? []) if (button.action.type !== 'todo-add') button.action = clearReference(button.action) ?? { type: 'none' };
  }
}

export function safeHttpUrl(value: string, base?: string): string | undefined {
  if (!isSafeUrl(value)) return undefined;
  try {
    const url = new URL(value, value.startsWith('/') ? base : undefined);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function readPath(value: unknown, path = ''): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) =>
    current && typeof current === 'object' && Object.hasOwn(current, key) ? (current as Record<string, unknown>)[key] : undefined, value);
}
