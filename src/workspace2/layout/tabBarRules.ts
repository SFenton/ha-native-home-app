import { valueAt, type EditorPath } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { tabBarOf, type TabsNode } from '../../shared/composition/layout-blocks';

type Loose = { type?: string; props?: { pinned?: boolean; tabBar?: { placement?: string } }; children?: Loose[]; tabs?: { children?: Loose[] }[]; blocks?: { children?: Loose[] }[] };

const kidsOf = (node: Loose): Loose[] => [...(node.children ?? []), ...(node.tabs ?? []).flatMap(tab => tab.children ?? []), ...(node.blocks ?? []).flatMap(block => block.children ?? [])];
function* walk(nodes: readonly Loose[]): Generator<Loose> { for (const node of nodes) { yield node; yield* walk(kidsOf(node)); } }

/**
 * Why the Bottom placement is not offered for the tab container at `path`, in the words of the dimmed segment's reason; `undefined` when it is.
 * The bar sits under a page or a sheet, so the container must be directly on one; a page holds one bottom bar; a form or an action bar
 * already owns the bottom edge.
 */
export function bottomRefusal(document: CompositionDocument, path: EditorPath): string | undefined {
  if (path.length !== 4) return 'A bottom bar must sit directly on the page or sheet.';
  const components = valueAt(document, path.slice(0, -1)) as Loose[];
  const self = valueAt(document, path) as Loose;
  const others = components.filter(node => node !== self);
  if ([...walk(others)].some(node => node.type === 'form' || node.type === 'pinned-actions')) return 'A page with a form or an action bar has no room for a bottom bar.';
  if (others.some(node => node.type === 'local-tabs' && tabBarOf(node.props as TabsNode['props']).placement === 'bottom')) return 'A page holds one bottom bar.';
  return undefined;
}

/** The tabs with no icon, by name, in tab order. */
export const tabsWithoutIcon = (node: TabsNode): string[] => node.tabs.filter(tab => !tab.icon).map(tab => tab.label);

/** Whether the container sits in a sheet that is fitted to its content, where a tab bar has no fixed height to sit in. */
export function inFittedSheet(document: CompositionDocument, path: EditorPath): boolean {
  if (path[0] !== 'modals') return false;
  const modal = document.modals[Number(path[1])] as { presentation?: { height?: { type?: string } } } | undefined;
  return modal?.presentation?.height?.type === 'fitted';
}

/** A tab container whose bar shows titles that a phone is likely to cut: five tabs, or four with a long name. */
export interface CutTitles { path: (string | number)[]; title: string }

/** The tab containers whose titles may be cut on an iPhone, with the path of each (for the Checks list). */
export function tabsWithCutTitles(document: CompositionDocument): CutTitles[] {
  const found: CutTitles[] = [];
  const visit = (nodes: Loose[], base: (string | number)[]) => nodes.forEach((node, at) => {
    const path = [...base, at];
    const tabs = node.type === 'local-tabs' ? (node as unknown as TabsNode) : undefined;
    if (tabs) {
      const bar = tabBarOf(tabs.props);
      const showsTitles = bar.labels === 'titles' || bar.labels === 'icons-and-titles' || (bar.labels === 'by-size' && bar.placement === 'top');
      const longest = Math.max(...tabs.tabs.map(tab => tab.label.length));
      if (showsTitles && (tabs.tabs.length >= 5 || (tabs.tabs.length === 4 && longest > 10))) found.push({ path, title: (node as unknown as { title: string }).title });
    }
    (node.children ?? []).length && visit(node.children!, [...path, 'children']);
    (node.tabs ?? []).forEach((tab, index) => tab.children?.length && visit(tab.children, [...path, 'tabs', index, 'children']));
    (node.blocks ?? []).forEach((block, index) => block.children?.length && visit(block.children, [...path, 'blocks', index, 'children']));
  });
  document.pages.forEach((surface, at) => visit(surface.components as unknown as Loose[], ['pages', at, 'components']));
  document.modals.forEach((surface, at) => visit(surface.components as unknown as Loose[], ['modals', at, 'components']));
  return found;
}

/** Overlays that put two controls at one place, by the path of the overlay and the place's name. */
export function overlaysWithStackedControls(document: CompositionDocument): { path: (string | number)[]; title: string; anchor: string }[] {
  const found: { path: (string | number)[]; title: string; anchor: string }[] = [];
  const visit = (nodes: Loose[], base: (string | number)[]) => nodes.forEach((node, at) => {
    const path = [...base, at];
    if (node.type === 'overlay') {
      const overlay = node as unknown as { title: string; children: { id: string }[]; props: { anchors: { childId: string; anchor: string }[] } };
      const seen = new Set<string>();
      for (const child of overlay.children.slice(1)) {
        const anchor = overlay.props.anchors.find(item => item.childId === child.id)?.anchor ?? 'top-trailing';
        if (seen.has(anchor)) { found.push({ path, title: overlay.title, anchor }); break; }
        seen.add(anchor);
      }
    }
    if (node.children?.length) visit(node.children, [...path, 'children']);
    (node.tabs ?? []).forEach((tab, index) => tab.children?.length && visit(tab.children, [...path, 'tabs', index, 'children']));
    (node.blocks ?? []).forEach((block, index) => block.children?.length && visit(block.children, [...path, 'blocks', index, 'children']));
  });
  document.pages.forEach((surface, at) => visit(surface.components as unknown as Loose[], ['pages', at, 'components']));
  document.modals.forEach((surface, at) => visit(surface.components as unknown as Loose[], ['modals', at, 'components']));
  return found;
}
