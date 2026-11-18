import { expandRef } from '../shared/composition/components';
import { holdsSlot, resolveFoldSides, usesFoldSides, type FoldSide, type FoldSlotInput } from '../shared/composition/fold-sides';
import type { ComponentEntry, CompositionNode } from '../shared/composition/schema';

/** Where the sections of a page sit while the Duo is partly folded, and what makes the page lay out in two sides at all. */
export interface FoldPlan {
  /** Whether the page lays its sections out in two sides: its switch is on, or a section is pinned to a side. Independent of the window: the drawing keeps one DOM in every pose. */
  active: boolean;
  /** The side of each scrolling top-level component by id. */
  sides: ReadonlyMap<string, FoldSide>;
  /** The component's place in the page's own order, so the one column reads in document order whichever side a component sits on. */
  order: ReadonlyMap<string, number>;
}

/** A component as the rule sees it: a use of a saved component is its body's root, carrying the place's own side. */
function slotOf(node: CompositionNode, library: ReadonlyMap<string, ComponentEntry>): FoldSlotInput & { id: string } {
  const entry = node.type === 'component-ref' ? library.get(node.componentId) : undefined;
  const seen = entry ? expandRef(node as never, entry) : node;
  return { id: node.id, type: seen.type, layout: { foldSide: (node.layout as { foldSide?: FoldSide }).foldSide } };
}

/**
 * The plan of a page's top-level components (decision D1, `src/shared/composition/fold-sides.ts`). The rule counts the components after static filtering
 * and before any rule hides one, so a section a rule hides in Use keeps its place, and the sections after it keep their sides.
 */
export function planFoldSides(page: { layout: { foldSides?: 'auto' }; components: readonly CompositionNode[] }, library: ReadonlyMap<string, ComponentEntry>): FoldPlan {
  const slots = page.components.map(node => slotOf(node, library));
  const placed = resolveFoldSides(slots);
  const sides = new Map<string, FoldSide>(), order = new Map<string, number>();
  let at = 0;
  slots.forEach(slot => { if (holdsSlot(slot)) order.set(slot.id, at++); });
  for (const item of placed) sides.set(slots[item.index].id, item.side);
  return { active: usesFoldSides({ layout: page.layout, components: slots }), sides, order };
}
