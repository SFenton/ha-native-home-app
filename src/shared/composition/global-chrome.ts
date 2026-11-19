/**
 * The four contract additions of the global-chrome rule (native-home `ServerUIGlobalChrome.swift`, PR #142), and the lowering that lets a build without
 * `sh.sheet-levels@1` carry the rule anyway. `schema.ts` and `compiler.ts` hold the shape and the checks; this file holds what is done with a build that lacks them.
 */
import type { CompositionDocument } from './schema';

/** Top-level `levels[]`: surfaces a sheet's `push` reaches without leaving the sheet. */
export const SHEET_LEVELS_CAPABILITY = 'sh.sheet-levels@1';
/** `pages[].hides`: the chrome a page hides for itself. */
export const PAGE_CHROME_HIDE_CAPABILITY = 'sh.page-chrome-hide@1';
/** `pages[].wideOpen`: how a page opens in a window wide enough for two columns. */
export const PAGE_WIDE_OPEN_CAPABILITY = 'sh.page-wide-open@1';
/** `navigation.tabsVisibility`: whether the tab bar shows on every page or on a root page only. */
export const TABS_VISIBILITY_CAPABILITY = 'sh.tabs-visibility@1';
/** The four ids, in the order native lists them. */
export const globalChromeCapabilities: readonly string[] = [SHEET_LEVELS_CAPABILITY, PAGE_CHROME_HIDE_CAPABILITY, PAGE_WIDE_OPEN_CAPABILITY, TABS_VISIBILITY_CAPABILITY];

/** What lowering a document for a target build did. */
export interface SheetLevelLowering {
  /** The document the target build can read: the same object when the target has `sh.sheet-levels@1`. */
  document: CompositionDocument;
  /** One line per rewrite, with the pointer it applies to (the input document's own pointers). */
  changes: string[];
  /**
   * Uses of a saved component inside a sheet or a level whose body pushes a page or takes a page as an argument. One body cannot be written two ways, so the use is left as it
   * is: on a build without the capability it pushes inside the sheet instead of closing it. Pointers are the document's own.
   */
  unlowered: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const step = (base: string, key: string | number) => `${base}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

/**
 * Writes a document for a build that lacks `sh.sheet-levels@1` (proposal `build/design/global-chrome/proposal.md`, section 3).
 *
 * The rule the new build applies by itself is that a `push` from inside a sheet to a page closes the sheet first, and a `push` to a level stays inside. The older build has
 * `dismiss-then-push` and no levels, so: every level becomes an entry of `pages[]` (a plain stack page, after the existing pages), and every `push` inside a sheet or a level
 * whose destination is a page becomes `dismiss-then-push`. A `push` to a level stays a `push`, now to a page that opens inside the sheet's own stack as it always did.
 * Pure: the input is not changed. A target that lists `sh.sheet-levels@1`, and a document that declares no `levels`, get the document back as it is: only a document with levels has the close-then-push rule.
 *
 * The result declares no `sh.sheet-levels@1`: compile it to get the manifest.
 */
export function lowerSheetLevels(document: CompositionDocument, target: readonly string[]): SheetLevelLowering {
  // The rule is scoped to documents that declare `levels` (native decision, gc-sheet-origin item 1): one without keeps the in-sheet push, on every build. An empty list still declares them.
  if (target.includes(SHEET_LEVELS_CAPABILITY) || document.levels === undefined) return { document, changes: [], unlowered: [] };
  const pageIds = new Set(document.pages.map(page => page.id));
  const levels = document.levels;
  const library = new Map((document.componentLibrary ?? []).map(entry => [entry.id, entry]));
  /** Whether a saved component's body holds a push to a page (or any push) or takes a page as an argument. */
  const pushes = (id: string): boolean => {
    const entry = library.get(id);
    return entry !== undefined && ((entry.params ?? []).some(param => param.kind === 'page-id') || JSON.stringify(entry.node).includes('"type":"push"'));
  };
  const changes: string[] = [], unlowered: string[] = [];
  const lower = (value: unknown, at: string, pointerOf: (path: string) => string): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => lower(item, step(at, index), pointerOf));
    if (!isRecord(value)) return value;
    // The destination of a `dismiss-then-push` has already left the sheet.
    if (value.type === 'dismiss-then-push') return value;
    if (value.type === 'push' && typeof value.pageId === 'string' && pageIds.has(value.pageId)) {
      changes.push(`dismiss then push at ${pointerOf(at)}`);
      return { type: 'dismiss-then-push', destination: value };
    }
    if (value.type === 'component-ref' && typeof value.componentId === 'string' && pushes(value.componentId)) unlowered.push(pointerOf(at));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, lower(item, step(at, key), pointerOf)]));
  };
  const modals = document.modals.map((modal, index) => lower(modal, '', path => `/document/modals/${index}${path}`)) as CompositionDocument['modals'];
  const moved = levels.map((level, index) => ({
    ...(lower(level, '', path => `/document/levels/${index}${path}`) as typeof level), navigation: { type: 'stack' as const },
  }));
  const { levels: _levels, ...rest } = document;
  if (moved.length) changes.push(`write ${moved.length} ${moved.length === 1 ? 'level' : 'levels'} as pages`);
  return { document: { ...rest, pages: [...document.pages, ...moved], modals }, changes, unlowered };
}
