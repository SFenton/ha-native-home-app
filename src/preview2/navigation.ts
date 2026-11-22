import type { CompositionAction, CompositionDocument } from '../shared/composition/schema';

/**
 * The page, sheet or level the preview shows. A level is shown inside a sheet: `sheetId` names the one it is shown in. Absent, the sheet already on
 * show decides when it reaches the level, else the first sheet that does, else no sheet and the level is drawn alone.
 */
export type NavSurface = { kind: 'page' | 'modal'; id: string } | { kind: 'level'; id: string; sheetId?: string };
/**
 * One presented sheet and the pages and levels pushed inside it (its root is the modal itself). A level no sheet opens is drawn `alone`: `modalId`
 * is then the level's own id, there is no modal behind it and it has Close and no Back.
 */
export interface SheetFrame { modalId: string; pages: readonly string[]; alone?: boolean }
/**
 * Where the preview is. Each tab keeps its own stack of page ids (root first); sheets are drawn over the page beneath.
 * `motion` says how the last change should move: a push slides in, a pop slides out, anything else cuts.
 */
export interface NavState {
  /** The selected tab; undefined when the document has none. */
  tabId?: string;
  /** Page stacks by tab id (the key is empty without tabs). */
  stacks: Readonly<Record<string, readonly string[]>>;
  sheets: readonly SheetFrame[];
  motion: 'none' | 'push' | 'pop';
  /** Counts reselects of the current tab, so its root page scrolls to the top. */
  scrollTop: number;
  /** A sheet with nothing that presents it is drawn over a dimmed empty page. */
  emptyBase?: boolean;
}
/** The six navigation actions the reducer reads; every other action is not navigation. */
export type NavAction = Extract<CompositionAction, { type: 'push' | 'select-tab' | 'present' | 'dismiss-then-push' | 'back' | 'dismiss' }>;
const navTypes = new Set(['push', 'select-tab', 'present', 'dismiss-then-push', 'back', 'dismiss']);
/** Whether an action is navigation. */
export const isNavAction = (action: { type: string }): action is NavAction => navTypes.has(action.type);

const rootKey = (tabId: string | undefined) => tabId ?? '';
const hasPage = (document: CompositionDocument, id: string) => document.pages.some(page => page.id === id);
const hasModal = (document: CompositionDocument, id: string) => document.modals.some(modal => modal.id === id);
/** Whether `id` is a level of a sheet (`levels[]`, `sh.sheet-levels@1`): a surface a push inside a sheet reaches without leaving it. */
export const isLevel = (document: CompositionDocument, id: string) => document.levels?.some(level => level.id === id) ?? false;
const same = (a: NavSurface | undefined, b: NavSurface | undefined) => a?.kind === b?.kind && a?.id === b?.id
  // A level named without its sheet stands for the level wherever it is shown.
  && (a?.kind !== 'level' || b?.kind !== 'level' || a.sheetId === undefined || b.sheetId === undefined || a.sheetId === b.sheetId);
/** Whether two surfaces are the same page, sheet or level. */
export const sameSurface = same;

/** The first page the document opens: the initial tab's root, else `initialPageId`. */
export function initialNav(document: CompositionDocument): NavState {
  const { tabs, initialTabId, initialPageId } = document.navigation;
  const tab = tabs.find(item => item.id === initialTabId) ?? tabs.find(item => item.pageId === initialPageId) ?? tabs[0];
  const root = tab && hasPage(document, tab.pageId) ? tab.pageId : initialPageId;
  return { tabId: tab?.id, stacks: { [rootKey(tab?.id)]: [root] }, sheets: [], motion: 'none', scrollTop: 0 };
}

/** The pages of the selected tab's stack, root first. */
export const tabStack = (document: CompositionDocument, state: NavState): readonly string[] =>
  state.stacks[rootKey(state.tabId)] ?? [document.navigation.initialPageId];
/** The page beneath any sheets: the top of the selected tab's stack. */
export const basePageId = (document: CompositionDocument, state: NavState): string => tabStack(document, state).at(-1) ?? document.navigation.initialPageId;
/** What is on top now: the top sheet (or a page or level pushed inside it), else the top page. A level reports the sheet it is shown in. */
export function currentSurface(document: CompositionDocument, state: NavState): NavSurface {
  const sheet = state.sheets.at(-1);
  if (sheet) {
    const top = sheet.pages.at(-1) ?? (sheet.alone ? sheet.modalId : undefined);
    if (top !== undefined && isLevel(document, top)) return sheet.alone ? { kind: 'level', id: top } : { kind: 'level', id: top, sheetId: sheet.modalId };
    return top !== undefined ? { kind: 'page', id: top } : { kind: 'modal', id: sheet.modalId };
  }
  return { kind: 'page', id: basePageId(document, state) };
}

const withStack = (state: NavState, stack: readonly string[]): Record<string, readonly string[]> => ({ ...state.stacks, [rootKey(state.tabId)]: stack });
/** Pushes `pageId` onto `stack`, or pops back to it when it is already there (`reuse-nearest`). */
function pushOnto(stack: readonly string[], pageId: string): { stack: readonly string[]; motion: 'push' | 'pop' | 'none' } {
  if (stack.at(-1) === pageId) return { stack, motion: 'none' };
  const at = stack.lastIndexOf(pageId);
  return at >= 0 ? { stack: stack.slice(0, at + 1), motion: 'pop' } : { stack: [...stack, pageId], motion: 'push' };
}
function pushPage(document: CompositionDocument, state: NavState, pageId: string): NavState {
  const sheet = state.sheets.at(-1);
  const inSheet = (): NavState => {
    const next = pushOnto(sheet!.pages, pageId);
    if (next.motion === 'none') return state;
    return { ...state, sheets: [...state.sheets.slice(0, -1), { ...sheet!, pages: next.stack }], motion: next.motion };
  };
  // A level opens inside its sheet and nowhere else: a page cannot open one.
  if (isLevel(document, pageId)) return sheet ? inSheet() : state;
  if (!hasPage(document, pageId)) return state;
  // A document without levels keeps the push inside the sheet it has always had (the rule is scoped to documents that declare `levels`).
  if (sheet && document.levels === undefined) return inSheet();
  // A push to an entry of `pages[]` from a sheet or a level closes every level and the sheet, then pushes on the tab's stack: Back returns to the page under the sheet.
  const base: NavState = sheet ? { ...state, sheets: [], emptyBase: false } : state;
  const next = pushOnto(tabStack(document, base), pageId);
  if (next.motion === 'none') return base === state ? state : { ...base, motion: 'none' };
  return { ...base, stacks: withStack(base, next.stack), motion: next.motion };
}
/** Cuts the selected stack back to the page that sent a push, so opening from the leading column replaces the trailing one (the columns' one rule). */
function cutToSender(document: CompositionDocument, state: NavState, sender: string | undefined): NavState {
  if (!sender || state.sheets.length) return state;
  const stack = tabStack(document, state), at = stack.lastIndexOf(sender);
  return at >= 0 && at < stack.length - 1 ? { ...state, stacks: withStack(state, stack.slice(0, at + 1)) } : state;
}
function dismissTop(state: NavState): NavState {
  return state.sheets.length ? { ...state, sheets: state.sheets.slice(0, -1), motion: 'none', emptyBase: state.sheets.length > 1 ? state.emptyBase : false } : state;
}

/**
 * Applies one navigation action. Pure: an action that changes nothing returns `state` itself.
 *
 * - `push` opens a page on the selected tab's stack; a page already on the stack is popped back to (`reuse-nearest`). From a sheet:
 *   a level of `levels[]` opens inside the sheet, with Back and Close; an entry of `pages[]` closes every level and the sheet first, then
 *   pushes on the tab's stack (a document without `levels` keeps the push inside the sheet). `sender` is the page the push came from, when
 *   it is a column that is not on top: the stack is cut back to it first.
 * - `present` opens a sheet over the current page; when that sheet is already on top, `reject` does nothing and `replace` restarts it.
 * - `select-tab` is rejected while a sheet is open; selecting the selected tab pops it to its root and asks for a scroll to the top.
 * - `dismiss-then-push` closes the top sheet and then pushes.
 * - `back` pops a page of the top sheet or tab; `dismiss` closes the top sheet.
 */
export function reduceNavigation(document: CompositionDocument, state: NavState, action: NavAction, sender?: string): NavState {
  switch (action.type) {
    case 'push': return pushPage(document, cutToSender(document, state, sender), action.pageId);
    case 'present': {
      if (!hasModal(document, action.modalId)) return state;
      const top = state.sheets.at(-1);
      if (top?.modalId === action.modalId) {
        return action.ifPresented === 'replace' && top.pages.length ? { ...state, sheets: [...state.sheets.slice(0, -1), { modalId: top.modalId, pages: [] }], motion: 'pop' } : state;
      }
      return { ...state, sheets: [...state.sheets, { modalId: action.modalId, pages: [] }], motion: 'none' };
    }
    case 'select-tab': {
      if (state.sheets.length) return state;
      const tab = document.navigation.tabs.find(item => item.id === action.tabId);
      if (!tab || !hasPage(document, tab.pageId)) return state;
      if (state.tabId === tab.id) {
        const stack = tabStack(document, state);
        return { ...state, stacks: withStack(state, [stack[0]]), motion: stack.length > 1 ? 'pop' : 'none', scrollTop: state.scrollTop + 1 };
      }
      return { ...state, tabId: tab.id, stacks: state.stacks[tab.id] ? state.stacks : { ...state.stacks, [tab.id]: [tab.pageId] }, motion: 'none', emptyBase: false };
    }
    case 'dismiss-then-push': return pushPage(document, dismissTop(state), action.destination.pageId);
    case 'dismiss': return dismissTop(state);
    case 'back': {
      const sheet = state.sheets.at(-1);
      if (sheet) return sheet.pages.length ? { ...state, sheets: [...state.sheets.slice(0, -1), { ...sheet, pages: sheet.pages.slice(0, -1) }], motion: 'pop' } : state;
      const stack = tabStack(document, state);
      return stack.length > 1 ? { ...state, stacks: withStack(state, stack.slice(0, -1)), motion: 'pop' } : state;
    }
  }
}

/** The page that presents `modalId`: a tab root first, then any page. Undefined when nothing does. */
export function presenterOf(document: CompositionDocument, modalId: string): string | undefined {
  const mentions = (pageId: string) => JSON.stringify(document.pages.find(page => page.id === pageId)).includes(`"modalId":"${modalId}"`);
  const roots = document.navigation.tabs.map(tab => tab.pageId).filter(id => hasPage(document, id));
  return roots.find(mentions) ?? document.pages.map(page => page.id).find(mentions);
}

/**
 * The state that shows `surface` as-is, for the shell choosing a page or sheet (Edit, a tab tap, the Pages overlay). A page a
 * tab roots selects that tab; any other page is pushed on the current tab; a sheet opens over the page that presents it.
 */
export function navigateTo(document: CompositionDocument, state: NavState, surface: NavSurface): NavState {
  if (surface.kind === 'page') {
    if (!hasPage(document, surface.id)) return state;
    const tab = document.navigation.tabs.find(item => item.pageId === surface.id);
    if (tab) return { ...state, tabId: tab.id, stacks: { ...state.stacks, [tab.id]: [tab.pageId] }, sheets: [], motion: 'none', emptyBase: false };
    const stack = tabStack(document, state);
    return { ...state, stacks: withStack(state, [stack[0], surface.id].filter((id, i, all) => all.indexOf(id) === i)), sheets: [], motion: 'none', emptyBase: false };
  }
  if (surface.kind === 'level') {
    if (!isLevel(document, surface.id)) return state;
    const modalId = sheetOfLevel(document, state, surface.id, surface.sheetId);
    // A level no sheet opens is drawn alone, over the dimmed empty page.
    if (modalId === undefined) return { ...state, sheets: [{ modalId: surface.id, pages: [], alone: true }], motion: 'none', emptyBase: true };
    const open = state.sheets.length === 1 && state.sheets[0].modalId === modalId && !state.sheets[0].alone ? state.sheets[0] : undefined;
    const pages = stackToLevel(document, open?.pages, modalId, surface.id)!;
    // The sheet already open keeps the page under it, so Back and Close return to where the person was.
    const under = open ? { ...state, sheets: [] } : navigateTo(document, state, { kind: 'modal', id: modalId });
    return { ...under, sheets: [{ modalId, pages }], motion: 'none', emptyBase: under.emptyBase };
  }
  if (!hasModal(document, surface.id)) return state;
  const presenter = presenterOf(document, surface.id);
  const base = presenter ? navigateTo(document, state, { kind: 'page', id: presenter }) : { ...state, sheets: [] };
  return { ...base, sheets: [{ modalId: surface.id, pages: [] }], motion: 'none', emptyBase: !presenter };
}

/** The levels `surface` pushes to, in document order, anywhere in its own content. */
function levelsPushedBy(document: CompositionDocument, surface: unknown): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (record.type === 'push' && typeof record.pageId === 'string' && isLevel(document, record.pageId) && !found.includes(record.pageId)) found.push(record.pageId);
    Object.values(record).forEach(visit);
  };
  visit(surface);
  return found;
}
/**
 * The shortest chain of levels from `from` (a sheet, or a level already open in it) to `target`, each reached by a `push` of the one before; empty when
 * `from` is the target, undefined when no chain reaches it.
 */
function levelChain(document: CompositionDocument, from: { modalId: string } | { levelId: string }, target: string): string[] | undefined {
  const start = 'levelId' in from ? document.levels?.find(level => level.id === from.levelId) : document.modals.find(modal => modal.id === from.modalId);
  if (!start) return undefined;
  if ('levelId' in from && from.levelId === target) return [];
  const queue: { chain: string[]; surface: unknown }[] = [{ chain: [], surface: start }];
  const seen = new Set<string>('levelId' in from ? [from.levelId] : []);
  for (let at = 0; at < queue.length; at += 1) {
    for (const next of levelsPushedBy(document, queue[at].surface)) {
      if (seen.has(next)) continue;
      seen.add(next);
      const chain = [...queue[at].chain, next];
      if (next === target) return chain;
      queue.push({ chain, surface: document.levels!.find(level => level.id === next) });
    }
  }
  return undefined;
}
/** The levels the sheet opens when it shows `target`: the way the person came when the sheet is open and a link reaches `target` from it, else the shortest chain. */
function stackToLevel(document: CompositionDocument, open: readonly string[] | undefined, modalId: string, target: string): string[] | undefined {
  const came = open ?? [];
  if (came.includes(target)) return came.slice(0, came.indexOf(target) + 1);
  for (let kept = came.length; kept >= 0; kept -= 1) {
    const chain = levelChain(document, kept === 0 ? { modalId } : { levelId: came[kept - 1] }, target);
    if (chain) return [...came.slice(0, kept), ...chain];
  }
  return undefined;
}
/** The sheet that shows `levelId`: the one named, else the one on top when it reaches the level, else the first that does. Undefined when no sheet reaches it. */
function sheetOfLevel(document: CompositionDocument, state: NavState, levelId: string, named?: string): string | undefined {
  const reaches = (modalId: string) => document.modals.some(modal => modal.id === modalId) && stackToLevel(document, undefined, modalId, levelId) !== undefined;
  if (named !== undefined && reaches(named)) return named;
  const top = state.sheets.at(-1);
  if (top && !top.alone && reaches(top.modalId)) return top.modalId;
  return document.modals.find(modal => reaches(modal.id))?.id;
}

/** The first page a page opens by a `push` (or `dismiss-then-push`) action, in document order: what a columns page draws beside itself. */
export function firstChildPage(document: CompositionDocument, pageId: string): string | undefined {
  const page = document.pages.find(item => item.id === pageId);
  let found: string | undefined;
  const visit = (value: unknown): void => {
    if (found || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (record.type === 'push' && typeof record.pageId === 'string' && hasPage(document, record.pageId) && record.pageId !== pageId) { found = record.pageId; return; }
    Object.values(record).forEach(visit);
  };
  visit(page?.components);
  return found;
}
