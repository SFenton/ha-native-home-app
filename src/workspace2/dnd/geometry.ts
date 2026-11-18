import type { CompositionDocument } from '../../shared/composition/schema';
import { valueAt } from '../../composition-editor';
import type { SelectionKey } from '../../preview2/model';
import { canHold, endOf, ownerTitle, type Destination } from '../add/insert';

/** A rectangle in client coordinates. */
export interface Box { left: number; top: number; width: number; height: number }
/** What the drop cue draws: a bar where the node would land, and the container's outline with its name. */
export interface Cue {
  /** The bar between siblings (spec 6, "Drop indicator"): vertical in a row of siblings, horizontal in a column. */
  line: Box;
  /** The target container's outline. */
  container?: Box;
  /** The container's name, for its small tag. */
  name: string;
  /** Whether the bar is vertical (siblings share a row). */
  vertical: boolean;
}
/** Where a pointer would drop: the destination and the cue that shows it. */
export interface Hit { destination: Destination; cue: Cue }

const boxOf = (element: Element): Box => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; };
const contains = (box: Box, x: number, y: number) => x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;
const area = (box: Box) => box.width * box.height;

/** The container elements the preview left in Edit: each `.sh-add-slot`'s parent, with the key of the container it holds. */
export function containerHosts(root: ParentNode): { host: HTMLElement; owner: SelectionKey }[] {
  return [...root.querySelectorAll<HTMLElement>('.sh-add-slot[data-add-for]')].flatMap(slot => slot.parentElement ? [{ host: slot.parentElement, owner: slot.getAttribute('data-add-for') as SelectionKey }] : []);
}

/**
 * The drawn children of a container, by the id of the node each draws, in the order of `list` when it is given. A page on two sides (`sh.fold-sides@1`) draws its sections inside
 * wrappers marked `data-fold-group` (the strip, the lower part, each side): they are looked through, and the order of the list, not the DOM's grouping, is the reading order.
 */
function childrenOf(host: HTMLElement, list?: unknown[]): { element: HTMLElement; id: string; box: Box }[] {
  const found = [...host.children].flatMap((child): { element: HTMLElement; id: string; box: Box }[] => {
    if (typeof (child as HTMLElement).getAttribute !== 'function') return [];
    if (child.getAttribute('data-fold-group') !== null) return childrenOf(child as HTMLElement);
    const key = (child as HTMLElement).getAttribute('data-sel');
    return key?.startsWith('node:') ? [{ element: child as HTMLElement, id: key.slice(5), box: boxOf(child) }] : [];
  });
  if (!list || host.getAttribute?.('data-fold-sides') === null) return found;
  const place = (id: string) => { const at = list.findIndex(entry => (entry as { id?: string }).id === id); return at < 0 ? list.length : at; };
  return found.sort((a, b) => place(a.id) - place(b.id));
}

/** Whether a page's two sides are drawn side by side (the Duo partly folded sideways): the sections then read down each side, not across. */
const onTwoSides = (host: HTMLElement) => host.getAttribute?.('data-sides') != null;

/** Whether siblings sit side by side (a grid or a rail) rather than in a column. */
const flowsAcross = (boxes: Box[]) => boxes.some((box, at) => at > 0 && Math.abs(box.top - boxes[at - 1].top) < 4);

/** The bar for a slot of `host`: before the child at `at`, or after the last. */
function cueAt(host: HTMLElement, list: unknown[], at: number, name: string): Cue {
  const children = childrenOf(host, list), frame = boxOf(host);
  const boxes = children.map(child => child.box), across = !onTwoSides(host) && flowsAcross(boxes);
  const before = children.find(child => child.id === (list[at] as { id?: string } | undefined)?.id);
  const last = [...children].reverse().find(child => list.some(item => (item as { id?: string }).id === child.id && list.indexOf(item) < at)) ?? children.at(-1);
  const thickness = 3;
  let line: Box;
  if (before) line = across ? { left: before.box.left - 4, top: before.box.top, width: thickness, height: before.box.height } : { left: before.box.left, top: before.box.top - 4, width: before.box.width, height: thickness };
  else if (last) line = across ? { left: last.box.left + last.box.width + 2, top: last.box.top, width: thickness, height: last.box.height } : { left: last.box.left, top: last.box.top + last.box.height + 2, width: last.box.width, height: thickness };
  else line = { left: frame.left + 8, top: frame.top + frame.height / 2, width: Math.max(0, frame.width - 16), height: thickness };
  return { line, container: frame, name, vertical: across };
}

/**
 * The slot under a pointer on the canvas: the innermost container that holds the point (never the node being dragged or one
 * inside it), then the position among its drawn children, by their reading order. Undefined when nothing there can take the node.
 */
export function locateOnCanvas(root: ParentNode, document: CompositionDocument, dragged: SelectionKey, x: number, y: number, carriedType?: string): Hit | undefined {
  const draggedElement = [...root.querySelectorAll<HTMLElement>('[data-sel]')].find(element => element.getAttribute('data-sel') === dragged);
  const hosts = containerHosts(root).filter(({ host }) => !(draggedElement && (draggedElement === host || draggedElement.contains(host))));
  // The Duo's book pose draws the screen twice, each copy clipped to its half: a copy's column also covers the other half on paper, so only a container the pointer can actually reach (it is in the stack at that point) counts.
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const stack = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(x, y) : undefined;
  const reachable = (host: HTMLElement) => !stack?.length || stack.some(element => host.contains(element));
  const under = hosts.map(item => ({ ...item, box: boxOf(item.host) })).filter(item => contains(item.box, x, y) && reachable(item.host)).sort((a, b) => area(a.box) - area(b.box));
  for (const item of under) {
    const base = endOf(document, item.owner);
    if (!base) continue;
    const draggedType = carriedType ?? draggedNodeType(document, dragged);
    if (!draggedType || !canHold(document, item.owner, draggedType)) continue;
    const list = valueAt(document, base.list) as unknown[];
    const children = childrenOf(item.host, list);
    const sides = onTwoSides(item.host);
    const boxes = children.map(child => child.box), across = !sides && flowsAcross(boxes);
    let at = list.length;
    for (const child of children) {
      if (child.id === dragged.slice(5)) continue;
      // On two sides only the sections in the pointer's own column count: a strip over both sides, or the side the pointer is over.
      if (sides && (x < child.box.left || x > child.box.left + child.box.width)) continue;
      const centreX = child.box.left + child.box.width / 2, centreY = child.box.top + child.box.height / 2;
      const before = across ? (y < child.box.top || (y <= child.box.top + child.box.height && x < centreX)) : y < centreY;
      if (before) { at = list.findIndex(entry => (entry as { id?: string }).id === child.id); break; }
    }
    const destination: Destination = { ...base, index: at < 0 ? list.length : at };
    return { destination, cue: cueAt(item.host, list, destination.index, ownerTitle(document, item.owner)) };
  }
  return undefined;
}

/** The cue for a destination (the keyboard's slots), found from the drawn container. */
export function cueFor(root: ParentNode, document: CompositionDocument, destination: Destination): Cue | undefined {
  const host = containerHosts(root).find(item => item.owner === destination.owner)?.host;
  if (!host) return undefined;
  return cueAt(host, valueAt(document, destination.list) as unknown[], destination.index, ownerTitle(document, destination.owner));
}

function draggedNodeType(document: CompositionDocument, key: SelectionKey): string | undefined {
  const id = key.slice(5);
  const found: { type?: string }[] = [];
  const walk = (nodes: unknown) => { if (!Array.isArray(nodes)) return; for (const node of nodes as { id: string; type: string; children?: unknown; tabs?: { children: unknown }[] }[]) { if (node.id === id) found.push(node); walk(node.children); node.tabs?.forEach(tab => walk(tab.children)); } };
  document.pages.forEach(page => walk(page.components)); document.modals.forEach(modal => walk(modal.components));
  return found[0]?.type;
}
