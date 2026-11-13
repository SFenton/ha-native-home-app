import type { Action, Component, Page, StudioDocument } from './types';

function actions(page: Page): Action[] {
  const result = page.toolbar.map(item => item.action);
  for (const button of page.floatingButtons ?? []) if (button.action.type !== 'todo-add') result.push(button.action);
  const visit = (components: Component[]) => {
    for (const component of components) {
      if (component.action) result.push(component.action);
      for (const item of [...component.rowActions?.leading ?? [], ...component.rowActions?.trailing ?? []])
        if (item.action.type !== 'todo-row') result.push(item.action);
      visit(component.children ?? []);
    }
  };
  visit(page.components);
  return result;
}

/** Configured page links, including links reached through one or more modals. */
export function linkedPageIds(document: StudioDocument, pageId: string): string[] {
  const page = document.pages.find(item => item.id === pageId);
  if (!page) return [];
  const pages = new Set(document.pages.map(item => item.id));
  const modals = new Map(document.modals.map(item => [item.id, item]));
  const visited = new Set<string>();
  const result = new Set<string>();
  const visit = (surface: Page) => {
    for (const action of actions(surface)) {
      if (action.type === 'navigate' && pages.has(action.pageId)) result.add(action.pageId);
      if (action.type === 'modal' && !visited.has(action.modalId)) {
        visited.add(action.modalId);
        const modal = modals.get(action.modalId);
        if (modal) visit(modal);
      }
    }
  };
  visit(page);
  return [...result];
}

export function owningTabIds(document: StudioDocument, pageId: string): string[] {
  if (!document.pages.some(page => page.id === pageId)) return [];
  const roots = new Set(document.navigation.tabs.map(tab => tab.pageId));
  const adjacency = new Map(document.pages.map(page => [page.id, linkedPageIds(document, page.id)]));
  return document.navigation.tabs.filter(tab => {
    const visited = new Set<string>();
    const pending = [tab.pageId];
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current) || (current !== tab.pageId && roots.has(current))) continue;
      if (current === pageId) return true;
      visited.add(current);
      pending.push(...adjacency.get(current) ?? []);
    }
    return false;
  }).map(tab => tab.id);
}
