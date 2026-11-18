import type { CompositionDocument } from '../../shared/composition/schema';
import { isTopLevelPageComponent, withoutFoldSide } from '../../shared/composition/fold-sides';
import { compositionErrors, replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { buildDocumentIndex, type SelectionKey } from '../../preview2/model';
import { canHold, endOf, ownerTitle, type Destination } from '../add/insert';

/** Whether the move from `before` to `after` made the document worse: the compiler finds more problems in it than it did. */
export const movedIntoProblems = (before: CompositionDocument, after: CompositionDocument) => compositionErrors(after).length > compositionErrors(before).length;

/** One place a node can be dropped, with the words the keyboard announces. */
export interface Slot extends Destination {
  /** Items the list holds now (the moving node counts while it is still in it). */
  count: number;
  /** The container's title. */
  title: string;
}

/** The move of a node to a destination, in words for the announcements. */
export interface Placement { position: number; of: number; title: string }

const sameList = (a: EditorPath, b: EditorPath) => a.length === b.length && a.every((part, at) => part === b[at]);
const within = (path: EditorPath, ancestor: EditorPath) => path.length >= ancestor.length && ancestor.every((part, at) => path[at] === part);

/**
 * Every place the node can be dropped on the surface that holds it, in document order across containers: a slot before each
 * child and one at the end of each container. A slot that would leave the node where it is, and any inside the node itself, are
 * left out, as are containers that cannot hold its type.
 */
export function validSlots(document: CompositionDocument, key: SelectionKey): Slot[] {
  const index = buildDocumentIndex(document), entry = index.get(key);
  if (!entry?.node || !entry.surface) return [];
  const slots: Slot[] = [];
  // The surface's own children come first, each followed by what it holds, so the order is the page's reading order.
  const flat: SelectionKey[] = [];
  const walk = (owner: SelectionKey) => { flat.push(owner); for (const child of index.children(owner)) { const kid = index.get(child); if (kid?.kind === 'node' || kid?.kind === 'local-tab') walk(child); } };
  walk(entry.surface);
  for (const owner of flat) {
    const here = index.get(owner);
    if (!here || (owner !== entry.surface && within(here.path, entry.path))) continue;
    const end = endOf(document, owner);
    if (!end || !canHold(document, owner, entry.node.type)) continue;
    const from = sameList(end.list, entry.path.slice(0, -1)) ? Number(entry.path.at(-1)) : -1;
    for (let at = 0; at <= end.index; at++) {
      if (from >= 0 && (at === from || at === from + 1)) continue;
      slots.push({ ...end, index: at, count: end.index, title: ownerTitle(document, owner) });
    }
  }
  return slots.sort((a, b) => order(index, a) - order(index, b) || a.index - b.index);
}
const order = (index: ReturnType<typeof buildDocumentIndex>, slot: Slot) => index.keys.indexOf(slot.owner);

/**
 * Moves a node (never copies it) to a destination, keeping its identity and everything it holds. Leaving a grid resets a
 * tile's width to half (span 1). The compiler has the last word: a move that introduces a problem throws instead, unless
 * `validate: false`, where the caller asks {@link movedIntoProblems} itself, after the drop is on screen: compiling a large
 * document is too slow to wait for while a person watches the drop.
 */
export function moveToSlot(document: CompositionDocument, key: SelectionKey, destination: Destination, options: { validate?: boolean } = {}): { document: CompositionDocument; key: SelectionKey; placement: Placement } {
  const index = buildDocumentIndex(document), entry = index.get(key);
  if (!entry?.node) throw new Error('That item no longer exists');
  const target = index.get(destination.owner);
  if (!target || within(target.path, entry.path)) throw new Error('A tile cannot go inside itself');
  if (!canHold(document, destination.owner, entry.node.type)) throw new Error(`${entry.node.title} cannot go there`);
  const fromList = entry.path.slice(0, -1), fromAt = Number(entry.path.at(-1));
  const siblings = valueAt(document, fromList) as unknown[];
  const removed = replaceAt(document, fromList, siblings.filter((_, at) => at !== fromAt));
  const end = endOf(removed, destination.owner);
  if (!end) throw new Error('That place no longer exists');
  const here = sameList(destination.list, fromList);
  const at = Math.max(0, Math.min(end.index, here && fromAt < destination.index ? destination.index - 1 : destination.index));
  const grid = (index.get(destination.owner)?.node?.type) === 'tile-grid';
  const sized = grid || entry.node.layout.span === 1 ? entry.node : { ...entry.node, layout: { ...entry.node.layout, span: 1 } };
  // A side belongs to a component at the top level of a page: a drop anywhere else (a sheet, a section) drops it.
  const node = isTopLevelPageComponent([...end.list, at]) ? sized : withoutFoldSide(sized);
  const list = valueAt(removed, end.list) as unknown[];
  const next = replaceAt(removed, end.list, [...list.slice(0, at), node, ...list.slice(at)]);
  if (options.validate !== false && movedIntoProblems(document, next)) throw new Error(`${entry.node.title} cannot go there`);
  return { document: next, key, placement: { position: at + 1, of: list.length + 1, title: ownerTitle(next, destination.owner) } };
}

/** "Picked up Evening lights. Position 1 of 4 in Living Room." and the other announcements (spec section 6). */
export const spoken = {
  pickedUp: (name: string, place: Placement) => `Picked up ${name}. Position ${place.position} of ${place.of} in ${place.title}.`,
  over: (place: Placement) => `Position ${place.position} of ${place.of} in ${place.title}.`,
  moved: (name: string, place: Placement) => `Moved ${name} to position ${place.position} of ${place.of} in ${place.title}.`,
  cancelled: 'Move canceled.',
};

/** Where a slot would put the node, as a placement. */
export function placementOf(document: CompositionDocument, key: SelectionKey, slot: Destination): Placement {
  const entry = buildDocumentIndex(document).get(key);
  const here = entry && sameList(slot.list, entry.path.slice(0, -1));
  const count = (valueAt(document, slot.list) as unknown[]).length;
  const from = entry ? Number(entry.path.at(-1)) : -1;
  const position = here && from < slot.index ? slot.index : slot.index + 1;
  return { position, of: here ? count : count + 1, title: ownerTitle(document, slot.owner) };
}
