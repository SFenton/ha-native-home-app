import { createComponent } from './shared/catalog';
import type { Component, Page, StudioDocument, Tab } from './shared/types';
import { assertCanRemoveComponent, containers, findComponent, findSiblings, flattenComponents, getComponents, getPage, removeComponent, uid, type Target } from './editor';

export type Placement = { kind: 'start' | 'end' } | { kind: 'before' | 'after' | 'inside'; anchorId: string };
export type PageLink = { source: Target; kind: 'component' | 'toolbar'; id: string; label: string };

export function createSidebarPage(id: string, title: string): Page {
  return { id, title, icon: 'document', layout: { columns: 2, gap: 12 }, toolbar: [], components: [] };
}

export function addLinkedPage(document: StudioDocument, page: Page, parentId?: string): void {
  if (document.pages.some(item => item.id === page.id)) throw new Error('This page already exists.');
  const parent = parentId ? document.pages.find(item => item.id === parentId) : undefined;
  if (parentId && !parent) throw new Error('The parent page no longer exists.');
  document.pages.push(structuredClone(page));
  if (parent) addPageLink(document, page.id, parent.id, { kind: 'end' });
}

export function addSidebarTab(document: StudioDocument, tab: Tab, newPage?: Page): void {
  if (document.navigation.tabs.some(item => item.id === tab.id)) throw new Error('This tab already exists.');
  if (newPage) addLinkedPage(document, newPage);
  if (!document.pages.some(page => page.id === tab.pageId)) throw new Error('Choose an existing root page.');
  document.navigation.tabs.push(structuredClone(tab));
}

export function reorderTab(document: StudioDocument, id: string, offset: number): void {
  const tabs = document.navigation.tabs;
  const index = tabs.findIndex(tab => tab.id === id);
  if (index < 0) throw new Error('The tab no longer exists.');
  const next = index + offset;
  if (next < 0 || next >= tabs.length) throw new Error('The tab is already at this edge.');
  tabs.splice(next, 0, tabs.splice(index, 1)[0]);
}

export function removeTab(document: StudioDocument, id: string): void {
  const index = document.navigation.tabs.findIndex(tab => tab.id === id);
  if (index < 0) throw new Error('The tab no longer exists.');
  document.navigation.tabs.splice(index, 1);
}

export function pageLinks(document: StudioDocument, pageId: string): PageLink[] {
  const result: PageLink[] = [];
  const scan = (source: Target) => {
    for (const component of flattenComponents(getComponents(document, source))) {
      if (component.action?.type === 'navigate' && component.action.pageId === pageId)
        result.push({ source, kind: 'component', id: component.id, label: component.title || component.type });
    }
    for (const item of getPage(document, source)?.toolbar ?? []) {
      if (item.action.type === 'navigate' && item.action.pageId === pageId)
        result.push({ source, kind: 'toolbar', id: item.id, label: item.label || 'Toolbar action' });
    }
  };
  document.pages.forEach(page => scan({ kind: 'page', id: page.id }));
  document.modals.forEach(modal => scan({ kind: 'modal', id: modal.id }));
  document.liveActivities.forEach(activity => {
    for (const variant of ['lockScreen', 'compactLeading', 'compactTrailing', 'minimal', 'expanded'] as const)
      scan({ kind: 'activity', id: activity.id, variant });
  });
  return result;
}

function requireComponents(document: StudioDocument, target: Target): Component[] {
  const exists = target.kind === 'activity'
    ? document.liveActivities.some(activity => activity.id === target.id)
    : Boolean(getPage(document, target));
  if (!exists) throw new Error('The destination no longer exists.');
  return getComponents(document, target);
}

function insertion(components: Component[], placement: Placement): { siblings: Component[]; index: number } {
  if (!('anchorId' in placement))
    return { siblings: components, index: placement.kind === 'start' ? 0 : components.length };
  const anchor = findComponent(components, placement.anchorId);
  if (!anchor) throw new Error('The insertion target no longer exists.');
  if (placement.kind === 'inside') {
    if (!containers.has(anchor.type)) throw new Error('Only groups can contain components.');
    const children = anchor.children ?? [];
    anchor.children = children;
    return { siblings: children, index: children.length };
  }
  const siblings = findSiblings(components, anchor.id)!;
  return { siblings, index: siblings.indexOf(anchor) + (placement.kind === 'after' ? 1 : 0) };
}

export function relocateComponent(document: StudioDocument, source: Target, id: string, destination: Target, placement: Placement): void {
  const from = requireComponents(document, source);
  const to = requireComponents(document, destination);
  const component = findComponent(from, id);
  if (!component) throw new Error('The component no longer exists.');
  if (source.kind !== destination.kind || source.id !== destination.id) assertCanRemoveComponent(getPage(document, source), id);
  if ('anchorId' in placement && (placement.anchorId === id || findComponent(component.children ?? [], placement.anchorId)))
    throw new Error('A component cannot be moved into itself or its descendants.');
  // Resolve before removing, then again afterwards so same-list indices remain exact.
  insertion(to, placement);
  removeComponent(from, id);
  const { siblings, index } = insertion(to, placement);
  siblings.splice(index, 0, component);
}

export function addPageLink(document: StudioDocument, pageId: string, sourceId: string, placement: Placement): void {
  const page = document.pages.find(item => item.id === pageId);
  if (!page) throw new Error('The linked page no longer exists.');
  if (pageId === sourceId) throw new Error('Choose a different page for this link.');
  const components = requireComponents(document, { kind: 'page', id: sourceId });
  const link = createComponent('navigation-tile');
  link.title = page.title;
  link.icon = page.icon;
  link.action = { type: 'navigate', pageId };
  const { siblings, index } = insertion(components, placement);
  siblings.splice(index, 0, link);
}

function requireLink(document: StudioDocument, pageId: string, reference: PageLink) {
  const page = getPage(document, reference.source);
  const component = reference.kind === 'component' ? findComponent(requireComponents(document, reference.source), reference.id) : undefined;
  const toolbar = reference.kind === 'toolbar' ? page?.toolbar.find(item => item.id === reference.id) : undefined;
  const action = component?.action ?? toolbar?.action;
  if (action?.type !== 'navigate' || action.pageId !== pageId) throw new Error('This link changed. Close this dialog and choose it again.');
  return { component, toolbar, page };
}

export function movePageLink(document: StudioDocument, pageId: string, reference: PageLink, sourceId: string, placement: Placement): void {
  if (pageId === sourceId) throw new Error('Choose a different page for this link.');
  const { toolbar, page } = requireLink(document, pageId, reference);
  const destination = document.pages.find(item => item.id === sourceId);
  if (!destination) throw new Error('The destination page no longer exists.');
  if (toolbar && page) {
    if (placement.kind !== 'start' && placement.kind !== 'end') throw new Error('Toolbar links can only move to the start or end of a toolbar.');
    page.toolbar.splice(page.toolbar.indexOf(toolbar), 1);
    if (destination.toolbar.some(item => item.id === toolbar.id)) toolbar.id = uid('toolbar');
    destination.toolbar.splice(placement.kind === 'start' ? 0 : destination.toolbar.length, 0, toolbar);
  } else relocateComponent(document, reference.source, reference.id, { kind: 'page', id: sourceId }, placement);
}

export function unlinkPage(document: StudioDocument, pageId: string, reference: PageLink): void {
  const { component, toolbar } = requireLink(document, pageId, reference);
  if (component) component.action = { type: 'none' };
  if (toolbar) toolbar.action = { type: 'none' };
}
