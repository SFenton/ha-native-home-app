import { useEffect, type RefObject } from 'react';

/**
 * The partly folded Duo draws one screen twice, once through each half. The two copies are the same React tree, so their DOM has the
 * same shape, and an element in one is found in the other by its path of child indexes. These helpers keep their scroll positions equal.
 */

/** The child-index path from `root` down to `element`, or undefined when `element` is not inside it. */
export function pathTo(root: Element, element: Element): number[] | undefined {
  const path: number[] = [];
  for (let at: Element | null = element; at && at !== root; at = at.parentElement) {
    const parent: Element | null = at.parentElement;
    if (!parent) return undefined;
    path.push(Array.prototype.indexOf.call(parent.children, at));
  }
  return root.contains(element) ? path.reverse() : undefined;
}

/** The element at a path below `root`. */
export function elementAt(root: Element, path: readonly number[]): Element | undefined {
  let at: Element | undefined = root;
  for (const step of path) { at = at?.children[step]; if (!at) return undefined; }
  return at;
}

/** The offset each element was last given by {@link copyOffset}, so the scroll event it raises is known for an echo, not a person's own scroll. */
const given = new WeakMap<Element, string>();
const offsetOf = (element: Element) => `${element.scrollTop},${element.scrollLeft}`;
/** Gives `to` the scroll offset of `from`, when they differ. */
const copyOffset = (from: Element, to: Element) => {
  if (to.scrollTop === from.scrollTop && to.scrollLeft === from.scrollLeft) return;
  to.scrollTop = from.scrollTop;
  to.scrollLeft = from.scrollLeft;
  given.set(to, offsetOf(to));
};

/** Copies every scroll offset of one copy to the other, walking both trees together. Called when the second copy mounts. */
export function copyScrolls(from: Element, to: Element): void {
  copyOffset(from, to);
  const count = Math.min(from.children.length, to.children.length);
  for (let at = 0; at < count; at += 1) copyScrolls(from.children[at], to.children[at]);
}

/**
 * Keeps two copies of a screen scrolled together: a scroll in either lands in the other, one frame behind at worst. Returns the function that stops it.
 * A scroll that is only the echo of the other copy's offset being copied in carries nothing new and is dropped: scroll events arrive a frame after the
 * change, so an echo that outlived a newer change in the first copy would copy the old offset back over it and the two would settle on the stale one.
 */
export function mirrorScrolls(a: Element, b: Element): () => void {
  const onScroll = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (given.get(target) === offsetOf(target)) { given.delete(target); return; }
    given.delete(target);
    const [from, to] = a.contains(target) ? [a, b] : b.contains(target) ? [b, a] : [undefined, undefined];
    if (!from || !to) return;
    const path = pathTo(from, target), other = path && elementAt(to, path);
    if (other) copyOffset(target, other);
  };
  a.addEventListener('scroll', onScroll, true);
  b.addEventListener('scroll', onScroll, true);
  return () => { a.removeEventListener('scroll', onScroll, true); b.removeEventListener('scroll', onScroll, true); };
}

/**
 * Keeps two copies of a screen scrolled together while `enabled` ({@link mirrorScrolls}). `first` and `second` are the elements that hold each copy's
 * screen. The copy that mounts second takes the first's offsets once.
 */
export function useTwinScroll(first: RefObject<Element | null>, second: RefObject<Element | null>, enabled: boolean): void {
  useEffect(() => {
    const a = first.current, b = second.current;
    if (!enabled || !a || !b) return;
    copyScrolls(a, b);
    return mirrorScrolls(a, b);
  }, [first, second, enabled]);
}

/**
 * Of the copies of one element (a node drawn through each half of a partly folded Duo), the one a person can see: the copy whose centre is
 * inside its half's clip along the hinge's axis (the axis the two clips are apart on: a node scrolled out of view below the clip still
 * belongs to the half it is in), else the first. With a single copy it is that one.
 */
export function visibleCopy<T extends Element>(copies: readonly T[]): T | undefined {
  if (copies.length < 2) return copies[0];
  const clips = copies.map(element => element.closest('.sh-clip')?.getBoundingClientRect());
  const [one, two] = clips;
  const across = one && two && Math.abs(one.left - two.left) < Math.abs(one.top - two.top) ? 'y' : 'x';
  return copies.find((element, at) => {
    const view = clips[at];
    if (!view) return true;
    const box = element.getBoundingClientRect();
    return across === 'x' ? box.left + box.width / 2 >= view.left && box.left + box.width / 2 <= view.right : box.top + box.height / 2 >= view.top && box.top + box.height / 2 <= view.bottom;
  }) ?? copies[0];
}
