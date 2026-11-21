import type { CompositionDocument } from '../shared/composition/schema';

type Page = CompositionDocument['pages'][number];

/** How a page opens in a window wide enough for two columns (`sh.page-wide-open@1`). */
export type WideOpen = NonNullable<Page['wideOpen']>;

/**
 * The page's own setting. Absent is Automatic, the default for a new page; a columns page with "Start a new column set here" (`standalone`)
 * and no setting of its own is Full width, as the Studio's migration writes it.
 */
export function wideOpenOf(page: Page): WideOpen {
  if (page.wideOpen) return page.wideOpen;
  return page.navigation.type === 'navigation-columns' && page.navigation.standalone ? 'full' : 'automatic';
}

/** A page that opens pages beside itself: the origin row "Open pages beside this one" (`navigation-columns`). */
export const opensBeside = (page: Page | undefined): boolean => page?.navigation.type === 'navigation-columns';

/**
 * What a wide window shows of a stack, as indexes into it. `columns` has two panes; an undefined `trailing` is the leading page's own empty side
 * (its empty-side text: nothing is open yet). `start` is the stack index where the column set began, the host that the pages beside it open from.
 * `single` is one page, full width.
 */
export type WideLayout =
  | { type: 'single'; index: number }
  | { type: 'columns'; leading: number; trailing?: number; start: number };

/** A page that lands without opening beside its origin: its own two panes when it is a columns page that is not on demand, else one pane. */
const landing = (page: Page | undefined, index: number): WideLayout =>
  page?.navigation.type === 'navigation-columns' && !page.navigation.onDemand ? { type: 'columns', leading: index, start: index } : { type: 'single', index };

/**
 * The panes a wide window draws for a tab's stack (proposal `global-chrome`, section 5, "The cascade and the rules it meets"). The stack is the one
 * route a narrow window pushes through, so the wide layout is a pure function of it, and rotating, folding or narrowing turns it into one stack
 * in the same order.
 *
 * Each page after the first opens by its own `wideOpen`, from the page before it (its origin):
 * - Full width: the page lands on its own (a columns page with its own panes), over whatever columns were showing; Back returns to them as they were.
 * - Beside: the origin takes the leading pane and the page the trailing one, wherever the origin was (its own columns, or full width).
 * - Automatic: Beside when the origin shows in columns or opens pages beside itself, otherwise Full width.
 *
 * Opening beside from a trailing pane is the cascade: that page moves to the leading pane and the new page opens trailing.
 */
export function arrangeWide(document: CompositionDocument, stack: readonly string[]): WideLayout {
  const page = (id: string) => document.pages.find(item => item.id === id);
  let layout = landing(page(stack[0]), 0);
  for (let index = 1; index < stack.length; index += 1) {
    const mode = page(stack[index]) ? wideOpenOf(page(stack[index])!) : 'automatic';
    const beside = mode === 'beside' || (mode === 'automatic' && (layout.type === 'columns' || opensBeside(page(stack[index - 1]))));
    layout = beside ? { type: 'columns', leading: index - 1, trailing: index, start: layout.type === 'columns' ? layout.start : index - 1 } : landing(page(stack[index]), index);
  }
  return layout;
}

/** The stack index of the page the layout shows last: the trailing pane, else the leading page, else the single page. */
export const lastShown = (layout: WideLayout): number => layout.type === 'single' ? layout.index : layout.trailing ?? layout.leading;

/** What leads the one bar in columns: how deep the trailing page is from the host of the column set. */
export type LeadingButton = 'none' | 'back' | 'close';

/**
 * The bar's leading button in columns, decided by column depth, not stack depth: Close for the first page beside the host, Back from depth 2
 * (`split-view.md`: "Close for the first page or Back from depth 2"). Nothing open yet, the host leads with nothing when it is the root of the stack
 * and with the page's own Back when it was pushed. What leads a columns page that was itself pushed, beside its own column Close, is not on record:
 * the column rule is kept there (open question for `gc-runtime-wide`).
 */
export function leadingButton(layout: Extract<WideLayout, { type: 'columns' }>): LeadingButton {
  const depth = layout.trailing === undefined ? 0 : layout.trailing - layout.start;
  if (depth === 1) return 'close';
  return depth === 0 && layout.start === 0 ? 'none' : 'back';
}
