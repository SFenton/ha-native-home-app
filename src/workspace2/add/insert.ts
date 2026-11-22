import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { nodeTitle } from '../../shared/composition/components';
import { buildDocumentIndex, type SelectionKey } from '../../preview2/model';
import { makeForEntity, tileType, type Made } from './catalog';

/** Where a new or moved node lands: the child list it joins and its position in it. */
export interface Destination {
  /** Path to the array of child nodes. */
  list: EditorPath;
  /** Position in the list (0 to its length). */
  index: number;
  /** The selection key of the container (a page, sheet, node or local tab), for the picker's title and the cue. */
  owner: SelectionKey;
}

/** The container a destination sits in, in words: its title. */
export function ownerTitle(document: CompositionDocument, owner: SelectionKey): string {
  const index = buildDocumentIndex(document), entry = index.get(owner);
  if (!entry) return '';
  if (entry.kind === 'node') return entry.node?.title ?? '';
  if (entry.kind === 'local-tab') {
    const node = valueAt(document, entry.path.slice(0, -2)) as { title: string; tabs: { label: string }[] } | undefined;
    const tab = valueAt(document, entry.path) as { label: string } | undefined;
    return node && tab ? `${node.title} / ${tab.label}` : '';
  }
  return (valueAt(document, entry.path) as { title?: string } | undefined)?.title ?? '';
}

/** The destination at the end of a container's own children: a page, sheet or level's components, or a node's or area's children. */
export function endOf(document: CompositionDocument, owner: SelectionKey): Destination | undefined {
  const entry = buildDocumentIndex(document).get(owner);
  if (!entry) return undefined;
  const list = entry.kind === 'page' || entry.kind === 'modal' || entry.kind === 'level' ? [...entry.path, 'components'] : entry.kind === 'node' || entry.kind === 'local-tab' ? [...(entry.bodyPath ?? entry.path), 'children'] : undefined;
  const items = list ? valueAt(document, list) : undefined;
  return list && Array.isArray(items) ? { list, index: items.length, owner } : undefined;
}

/** The destination right after a node, in the same container. */
export function after(document: CompositionDocument, key: SelectionKey): Destination | undefined {
  const index = buildDocumentIndex(document), entry = index.get(key);
  if (!entry || entry.kind !== 'node' || !entry.parent) return undefined;
  return { list: entry.path.slice(0, -1), index: Number(entry.path.at(-1)) + 1, owner: entry.parent };
}

/** The container type and, for a grid, whether children may be wide, that a destination's owner is. */
function containerOf(document: CompositionDocument, owner: SelectionKey): { kind: 'surface' | 'local-tab' | 'node'; type?: string; props?: Record<string, unknown>; held?: number; forOneTab?: boolean } {
  const entry = buildDocumentIndex(document).get(owner);
  if (entry?.kind === 'node') return { kind: 'node', type: entry.node?.type, props: (entry.node as { props?: Record<string, unknown> }).props, held: ((entry.node as { children?: unknown[] }).children ?? []).length };
  // An area: a form or a pinned action bar can go only in one for exactly one tab (`sh.tab-blocks@1`).
  return { kind: entry?.kind === 'local-tab' ? 'local-tab' : 'surface', forOneTab: entry?.kind === 'local-tab' ? !entry.shared && (entry.tabs?.length ?? 1) === 1 : undefined };
}

/**
 * Whether a container takes a node of this type (the compiler's rules for who may sit where). Sections laid out as a list of
 * settings rows, rails of status chips and room sections are the narrow ones; a page or a grid holds anything. A destination
 * the table lets through can still be refused at the drop by the compiler, which has the last word.
 */
export function canHold(document: CompositionDocument, owner: SelectionKey, childType: string): boolean {
  const container = containerOf(document, owner);
  if (container.kind === 'node') {
    switch (container.type) {
      case 'status-rail': return childType === 'status-chip' || childType === 'room-chip';
      case 'section': return container.props?.style !== 'module-list' || ['row', 'local-control', 'settings-link', 'settings-control', 'bound-control', 'climate-control'].includes(childType);
      case 'tile-grid': case 'room-section': return !['account-header', 'form', 'pinned-actions', 'settings-link'].includes(childType);
      case 'paged-row': case 'stack': return childType !== 'form' && childType !== 'pinned-actions';
      // A repeat holds its cell and, with a placeholder, a second child; a repeat does not hold a repeat or a saved component.
      case 'repeat': return childType !== 'form' && childType !== 'pinned-actions' && childType !== 'repeat' && childType !== 'component-ref';
      case 'local-tabs': return false;
      // The first child is the base: anything that draws. The four on top are a closed list (`sh.overlay@1`).
      case 'overlay': return (container.held ?? 0) === 0 ? childType !== 'form' && childType !== 'pinned-actions' && childType !== 'overlay'
        : (container.held ?? 0) < 5 && ['bound-control', 'primary-button', 'status-pill', 'text'].includes(childType);
      default: return false;
    }
  }
  if (childType === 'status-chip' || childType === 'room-chip') return false;
  if (container.kind === 'local-tab' && container.forOneTab === false && (childType === 'form' || childType === 'pinned-actions')) return false;
  return true;
}

/** Whether a node of this type is wider than one column anywhere but a grid (the compiler needs span 1 there). */
const fitSpan = (node: CompositionNode, grid: boolean): CompositionNode => grid || node.layout.span === undefined || node.layout.span === 1 ? node : { ...node, layout: { ...node.layout, span: 1 } };

/** The document with `made` added at `destination`, its sources added, and the key of the new node. One value, so one undo step. */
export function insertMade(document: CompositionDocument, destination: Destination, made: Made): { document: CompositionDocument; key: SelectionKey } {
  const items = valueAt(document, destination.list);
  if (!Array.isArray(items)) throw new Error('That place no longer exists');
  if (!canHold(document, destination.owner, made.node.type)) throw new Error(`${nodeTitle(made.node)} cannot go there`);
  const grid = containerOf(document, destination.owner).type === 'tile-grid';
  const node = fitSpan(made.node, grid);
  const next = [...items.slice(0, destination.index), node, ...items.slice(destination.index)];
  let result = replaceAt(document, destination.list, next);
  if (made.sources.length) result = { ...result, dataSources: [...result.dataSources, ...made.sources] };
  if (made.localState?.length) result = { ...result, localState: [...(result.localState ?? []), ...made.localState] };
  if (made.stateStyles?.length) result = { ...result, stateStyles: { type: 'state-styles@1', styles: [...(result.stateStyles?.styles ?? []), ...made.stateStyles] } };
  return { document: result, key: `node:${node.id}` };
}

/** Adds a tile of a catalog type. */
export function insertType(document: CompositionDocument, destination: Destination, type: string, entity?: { entityId: string; name?: string; deviceClass?: string }): { document: CompositionDocument; key: SelectionKey } {
  const kind = tileType(type);
  if (!kind) throw new Error('Unknown tile type');
  return insertMade(document, destination, kind.make({ document, entityId: entity?.entityId, name: entity?.name, deviceClass: entity?.deviceClass }));
}

/** Adds the bound tile that fits an entity's domain. */
export function insertEntity(document: CompositionDocument, destination: Destination, entityId: string, name?: string) {
  return insertMade(document, destination, makeForEntity(document, entityId, name));
}

/** Why an area refuses a drop of this type, when the reason is the one the person can fix: the line the tree says. */
export function refusalFor(document: CompositionDocument, owner: SelectionKey, childType: string): string | undefined {
  const container = containerOf(document, owner);
  if (container.kind === 'local-tab' && container.forOneTab === false && (childType === 'form' || childType === 'pinned-actions'))
    return `${childType === 'form' ? 'A form' : 'An action bar'} can only go in an area for one tab.`;
  if (container.kind === 'node' && container.type === 'overlay' && (container.held ?? 0) >= 5) return '4 items on top at most.';
  return undefined;
}
