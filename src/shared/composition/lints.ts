/**
 * Authoring warnings for the generic grammar. They never block a save or a publish: the owner chose full control, and
 * the Studio only points out calls that are easy to regret.
 */
import { overflowNotices } from './surface-controls-fit';
import { dialControlWarnings } from './dial-control-edit';
import type { CompositionDocument } from './schema';
import { lowerSheetLevels, PAGE_CHROME_HIDE_CAPABILITY, PAGE_WIDE_OPEN_CAPABILITY, TABS_VISIBILITY_CAPABILITY } from './global-chrome';

export interface CompositionWarning { pointer: string; message: string; /** The capability the warning is about, when it is one the target build lacks. */ capability?: string }

/** Domains whose actions should ask first. */
export const confirmedDomains = ['lock', 'alarm_control_panel', 'cover'] as const;
const secretName = /(token|secret|password|passwd|api[_-]?key|webhook)/i;

/** Warnings for one `call-service` action (an object with `type: 'call-service'`). */
export function callServiceWarnings(call: unknown, pointer = ''): CompositionWarning[] {
  if (!call || typeof call !== 'object') return [];
  const value = call as { domain?: unknown; service?: unknown; confirmation?: { type?: unknown }; data?: { fields?: Record<string, unknown> } };
  const warnings: CompositionWarning[] = [];
  if (typeof value.domain === 'string' && (confirmedDomains as readonly string[]).includes(value.domain) && value.confirmation?.type !== 'additional')
    warnings.push({ pointer, message: `A ${value.domain}.${String(value.service)} call has no confirmation. Add one so a stray tap cannot change a lock, alarm or cover.` });
  for (const name of Object.keys(value.data?.fields ?? {})) {
    if (secretName.test(name)) warnings.push({ pointer: `${pointer}/data/fields/${name}`, message: `Data field "${name}" looks like a secret. The publication is readable by every signed-in user.` });
  }
  return warnings;
}

/**
 * A `choose` or `map` operand whose Otherwise is a text with nothing in it (`sh.rules@1`, a Logic Template's cases): when no case holds it says nothing. The
 * Studio's "How Many Are…" cases write one for a counted value that is not a whole number. An Otherwise that is not text, or that reads something, is not asked.
 */
export function emptyOtherwiseWarnings(operand: unknown, pointer = ''): CompositionWarning[] {
  if (!operand || typeof operand !== 'object') return [];
  const value = operand as { type?: unknown; otherwise?: { type?: unknown; value?: unknown }; cases?: unknown };
  if ((value.type !== 'choose' && value.type !== 'map') || !Array.isArray(value.cases)) return [];
  const blank = value.otherwise?.type === 'literal' && typeof value.otherwise.value === 'string' && value.otherwise.value.trim() === '';
  return blank ? [{ pointer: `${pointer}/otherwise`, message: 'Otherwise has no text, so nothing shows when no case holds. Add the text for Otherwise.' }] : [];
}

/** What a lint may be told about where the document is going. */
export interface WarningOptions {
  /** The capability ids of the build the document is published to. Absent: the target is not known, so no "Needs a newer app" lint is made. */
  target?: readonly string[];
}

const newerApp = (what: string) => `Needs a newer app. The app build this publishes to ${what}, and it refuses a publication that uses the setting until it updates.`;

/**
 * The "Needs a newer app" lints of the global-chrome contract (`sh.page-chrome-hide@1`, `sh.page-wide-open@1`, `sh.tabs-visibility@1`): one for each place the document
 * uses a setting that the `target` build lacks. A page's levels (`sh.sheet-levels@1`) have none: they are written the old way for a build without them
 * ({@link lowerSheetLevels}), except a saved component that pushes from inside a sheet, which cannot be written two ways and says so.
 */
export function chromeCapabilityWarnings(document: CompositionDocument, target: readonly string[]): CompositionWarning[] {
  const warnings: CompositionWarning[] = [];
  const lacks = (capability: string) => !target.includes(capability);
  document.pages.forEach((page, index) => {
    if (page.hides !== undefined && lacks(PAGE_CHROME_HIDE_CAPABILITY))
      warnings.push({ pointer: `/document/pages/${index}/hides`, capability: PAGE_CHROME_HIDE_CAPABILITY, message: newerApp('cannot hide the tab bar or a header button for a page') });
    if (page.wideOpen !== undefined && lacks(PAGE_WIDE_OPEN_CAPABILITY))
      warnings.push({ pointer: `/document/pages/${index}/wideOpen`, capability: PAGE_WIDE_OPEN_CAPABILITY, message: newerApp('does not know how a page opens in a wide window') });
  });
  if (document.navigation.tabsVisibility !== undefined && lacks(TABS_VISIBILITY_CAPABILITY))
    warnings.push({ pointer: '/document/navigation/tabsVisibility', capability: TABS_VISIBILITY_CAPABILITY, message: newerApp('does not know when the tab bar shows') });
  for (const pointer of lowerSheetLevels(document, target).unlowered)
    warnings.push({ pointer, message: 'Needs a newer app. This saved component opens a page from inside a sheet, and the app build this publishes to would open it inside the sheet instead of closing the sheet first. Use it on a page, or write the link as Close Sheet, Then Open.' });
  return warnings;
}

/** Every warning in a document, with the pointer of the offending action. Pass the `target` build to add the "Needs a newer app" lints. */
export function compositionWarnings(document: unknown, options: WarningOptions = {}): CompositionWarning[] {
  const warnings: CompositionWarning[] = [];
  const walk = (value: unknown, pointer: string) => {
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${pointer}/${index}`)); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.type === 'call-service') warnings.push(...callServiceWarnings(record, pointer));
    // A choose or map case with an empty Otherwise text (a Logic Template's count cases write one).
    warnings.push(...emptyOtherwiseWarnings(record, pointer));
    // A map whose buttons do not all fit a family: a note, never a refusal (the app puts the rest behind More).
    if (record.kind === 'map' && Array.isArray(record.controls) && typeof record.height === 'number' && typeof record.locate === 'boolean')
      for (const message of overflowNotices(record as unknown as Parameters<typeof overflowNotices>[0])) warnings.push({ pointer: `${pointer}/controls`, message });
    // A dial control (`sh.dial-control@1`): the notes that need no house (a stopper with no value, a rim under 3 to 1, a first stopper above the second).
    if (record.type === 'dial-control' && record.props && typeof record.props === 'object' && 'range' in record.props && 'stoppers' in record.props)
      warnings.push(...dialControlWarnings(record as unknown as Parameters<typeof dialControlWarnings>[0], pointer));
    for (const [key, child] of Object.entries(record)) walk(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
  };
  walk(document, '/document');
  if (options.target && document && typeof document === 'object' && Array.isArray((document as CompositionDocument).pages)) warnings.push(...chromeCapabilityWarnings(document as CompositionDocument, options.target));
  return warnings;
}
