import { z } from 'zod/v4';

/**
 * `sh.fold-sides@1`: which side of the hinge a page's sections sit on while the iPhone Duo is partly folded sideways (book pose). One page switch,
 * `layout.foldSides: 'auto'`, turns the two sides on, and a top-level component's `layout.foldSide` pins one section. This file is the one home of the
 * automatic rule (decision D1 of `studio-duo-sim`, the app's `FoldColumns.side(forConfiguredIndex:override:)`): the compiler checks the order with it,
 * the preview places sections with it, the inspector names the side with it, and the corpus pins its answers.
 */

/** The words of `layout.foldSide`: across the top of both sides, the leading side (before the hinge), the trailing side (after it). */
export const foldSideWords = ['span', 'leading', 'trailing'] as const;
export type FoldSide = (typeof foldSideWords)[number];
/** The schema of `layout.foldSide`. */
export const foldSideSchema = z.enum(foldSideWords);
/** The only value of `layout.foldSides`, the page switch. */
export const foldSidesSchema = z.literal('auto');

/** The kinds that are a status strip: they span the top of the page while it is split (the chip rail). The notification banner is not listed: it is filtered out statically and never holds a slot. */
export const stripTypes: readonly string[] = ['status-rail'];
/** The kinds the Studio leaves out of the canvas before sides are counted (the static filtering of the rule): they hold no slot. */
export const staticallyHiddenTypes: readonly string[] = ['notification-permission-banner'];
/** The kinds drawn outside the page's scrolling column (a floating action bar): they take no side and hold no slot. */
export const pinnedTypes: readonly string[] = ['pinned-actions'];

/** What the rule reads of a top-level component. */
export interface FoldSlotInput { type: string; layout: { foldSide?: FoldSide } }
/** One top-level component's place: its index in the page's component list, and its side. */
export interface FoldPlacement { index: number; side: FoldSide }

/** Whether a component holds a slot: it is not filtered out statically and is not pinned. A rule that hides it while the app runs does not matter: it keeps its slot. */
export const holdsSlot = (item: { type: string }): boolean => !staticallyHiddenTypes.includes(item.type) && !pinnedTypes.includes(item.type);

/**
 * The side of every component that holds a slot, in the page's order (the rule of decision D1):
 * 1. The page's components are counted after static filtering and before any rule hides one.
 * 2. The run of status strips at the top spans; so does any component that says `span` inside that run.
 * 3. The rest alternate by position in the rest: the first leads, the next trails, and so on.
 * 4. An explicit `foldSide` wins and still holds its position in the count.
 * 5. One placed component leads and the trailing side stays empty.
 */
export function resolveFoldSides(items: readonly FoldSlotInput[]): FoldPlacement[] {
  const placements: FoldPlacement[] = [];
  let run = true, position = 0;
  items.forEach((item, index) => {
    if (!holdsSlot(item)) return;
    const said = item.layout.foldSide;
    if (said === 'span') { placements.push({ index, side: 'span' }); return; }
    if (said === undefined && run && stripTypes.includes(item.type)) { placements.push({ index, side: 'span' }); return; }
    run = false;
    placements.push({ index, side: said ?? (position % 2 === 0 ? 'leading' : 'trailing') });
    position += 1;
  });
  return placements;
}

/** The side of the component at `index`, or undefined when it holds no slot. */
export const foldSideAt = (placements: readonly FoldPlacement[], index: number): FoldSide | undefined => placements.find(item => item.index === index)?.side;

/** Whether a page lays its sections out in two sides: the switch is on, or a component is pinned to a side. */
export function usesFoldSides(page: { layout: { foldSides?: 'auto' }; components: readonly FoldSlotInput[] }): boolean {
  return page.layout.foldSides === 'auto' || page.components.some(item => holdsSlot(item) && (item.layout.foldSide === 'leading' || item.layout.foldSide === 'trailing'));
}

/**
 * The indexes of the components whose `span` comes too late: `span` is Across the Top, so it has to come before the first section that takes a side
 * (a status strip, or another `span`, or nothing at all). The compiler refuses each with `invalid_combination` at `layout/foldSide`.
 */
export function lateSpans(items: readonly FoldSlotInput[]): number[] {
  const late: number[] = [];
  let run = true;
  items.forEach((item, index) => {
    if (!holdsSlot(item)) return;
    if (item.layout.foldSide === 'span') { if (!run) late.push(index); return; }
    if (!(item.layout.foldSide === undefined && stripTypes.includes(item.type))) run = false;
  });
  return late;
}

/** The side words as the Studio says them. */
export const foldSideLabels: Record<FoldSide, string> = { span: 'Across the Top', leading: 'Leading Side', trailing: 'Trailing Side' };

/** The widths of the two sides, as the app's `SplitGeometry`: points before the band, the band, and points after it. */
export interface SidesGeometry { leading: number; band: number; trailing: number }

/** One component of a page as the shared answer reads it. A `component-ref` names the type of its body in `bodyType`, as the expansion would. */
export interface FoldAnswerItem { id: string; type: string; bodyType?: string; foldSide?: FoldSide; hiddenByRule?: boolean }
/** The input of the corpus's `foldsides` subject: a page's top-level components and, to answer widths, the app's geometry and the page's side padding. */
export interface FoldAnswerInput { foldSides?: 'auto'; items: readonly FoldAnswerItem[]; geometry?: SidesGeometry; /** The page's leading and trailing padding, kept at both edges of each side (the app's `sideInset`). */ inset?: number }
/** What the corpus records for a page: whether it uses the two sides and, per component that holds a slot, its side and, with a geometry, its width in points (one decimal). */
export interface FoldAnswer { active: boolean; sides: { id: string; side: FoldSide; width?: number }[] }

/**
 * The answer both apps give for a page (`contract/corpus/evaluation/fold-sides-*`): the side of every component that holds a slot, and its width. A page that does not use the sides answers
 * `active: false` and no sides. A component that holds no slot (the notification banner, a pinned bar) is absent, whatever `foldSide` it says. A section that a rule hides at run time keeps its slot.
 */
export function foldSidesAnswer(input: FoldAnswerInput): FoldAnswer {
  const slots = input.items.map(item => ({ type: item.bodyType ?? item.type, layout: { foldSide: item.foldSide } }));
  if (!usesFoldSides({ layout: { foldSides: input.foldSides }, components: slots })) return { active: false, sides: [] };
  const inset = input.inset ?? 0, geometry = input.geometry;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    active: true,
    sides: resolveFoldSides(slots).map(({ index, side }) => ({
      id: input.items[index].id, side,
      ...(geometry ? { width: round(side === 'span' ? geometry.leading + geometry.band + geometry.trailing - 2 * inset : (side === 'leading' ? geometry.leading : geometry.trailing) - 2 * inset) } : {}),
    })),
  };
}

/** Whether `path` names a component at the top level of a page (`pages/<n>/components/<n>`): the only place a node takes a side. */
export const isTopLevelPageComponent = (path: readonly (string | number)[]): boolean => path.length === 4 && path[0] === 'pages' && typeof path[1] === 'number' && path[2] === 'components' && typeof path[3] === 'number';

/** `layout` without its `foldSide`: a place on a page carries the side, a template body or a node off a page holds none. */
export const omitFoldSide = <L extends object>(layout: L | undefined): Omit<L, 'foldSide'> => { const { foldSide: _side, ...rest } = (layout ?? {}) as L & { foldSide?: unknown }; void _side; return rest; };

/** The node as it lands off a page's top level: its `foldSide` dropped (a move does not carry it; moving back does not restore it). */
export const withoutFoldSide = <N extends object>(node: N): N => { const layout = (node as { layout?: object }).layout; return layout && 'foldSide' in layout ? { ...node, layout: omitFoldSide(layout) } : node; };
