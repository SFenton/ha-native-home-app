import { z } from 'zod/v4';
import { operandBase, type Operand } from './expression';
import { CompositionValidationError, pointer, type CompositionIssue } from './json';
import { contrast, packRgb, textContrast, type Rgb } from './color';

/**
 * The Profile Icon and the badge settings of the Studio.
 *
 * Four capability ids live here (`pb-contract`, `build/design/studio-profile-badges`): `sh.shell-profile@1` (an optional `profile` block on the
 * `shell-header` item), `sh.avatar@1` (the `avatar` node), `sh.badge-spoken@1` (an optional `spoken` text operand on a value badge) and
 * `sh.badge-nodes@1` (a `badge` on `action-tile`, `door-tile`, `light-group-tile`, `room-card`, `room-chip`, `settings-link` and `avatar`, and a drawn
 * badge on a header `button`). Each is declared only by a document that uses it.
 *
 * Two settings are the Studio's and never published: **Show at Most** (`cap`) and **Spoken As** (`spokenOne`, `spokenOther`). A draft keeps them on its
 * value badge; {@link expandBadgeSettings} works them out into the `choose`, `compare` and `format` the grammar already has before the compiler derives
 * capabilities, so the publication, the shared corpus and the app see plain operands. The closed schema refuses the three keys in a publication.
 */
const object = z.strictObject;

// MARK: Limits

/** The longest a Home Assistant entity id is. */
export const MAX_ENTITY_ID = 255;
/** The most characters a text badge draws. */
export const MAX_BADGE_TEXT = 4;
/** Show at Most takes a whole number from 1 to this. */
export const MAX_BADGE_CAP = 999;
/** The longest a Spoken As line is. */
export const MAX_SPOKEN_LINE = 240;
/** The kinds a badge may sit on beyond the ones that carried it before (`sh.badge-nodes@1`). A header `button` joins when its badge is not `none`. */
export const badgeNodeKinds: readonly string[] = ['action-tile', 'door-tile', 'light-group-tile', 'room-card', 'room-chip', 'settings-link', 'avatar'];
/** The token a Spoken As line holds for the whole, uncapped number. */
export const COUNT_TOKEN = '{Count}';

// MARK: Schema

/**
 * A badge on a chip, a tile, a tab, a header button or the Profile Icon (`sh.badges@1`): none, or a value that is a number or text. A value of 0 draws no
 * badge. A value badge may carry `spoken`, the words VoiceOver says for it (`sh.badge-spoken@1`).
 */
export const badgeSchema = z.discriminatedUnion('type', [
  object({ type: z.literal('none') }),
  object({ type: z.literal('value'), value: operandBase, spoken: operandBase.optional() }),
]);
/** The look of the header's Profile button (`sh.shell-profile@1`): the person's photo over the initials, the initials only, or the person symbol. */
export const profileLooks = ['photo', 'initials', 'symbol'] as const;
/** The optional `profile` block of the `shell-header` item (`sh.shell-profile@1`). Absent, the app draws what it draws today. */
export const shellProfileSchema = object({ look: z.enum(profileLooks).optional(), badge: badgeSchema.optional() });
/** Whom a Profile Icon node shows: whoever is signed in, or one `person.*` entity. */
export const avatarPersonSchema = z.discriminatedUnion('type', [
  object({ type: z.literal('viewer') }),
  object({ type: z.literal('person'), entityId: z.string().min(1).max(MAX_ENTITY_ID) }),
]);
/** The two sizes of a Profile Icon node: 36 pt (`row`) and 84 pt (`large`), both scaled with Dynamic Type. */
export const avatarSizes = ['row', 'large'] as const;
/** The look of a Profile Icon node: the photo over the initials, or the initials only (the symbol is the header's alone). */
export const avatarLooks = ['photo', 'initials'] as const;

// MARK: Pure rules

/**
 * The initials a person's disc draws: the first letter of each of the first two words of the name, upper-cased. `undefined` when the name is unknown or has
 * no letters, where the app draws the person symbol instead. Fixed in the app, never authored.
 */
export function initialsOf(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word.match(/\p{L}/u)?.[0]).filter((letter): letter is string => letter !== undefined);
  return letters.length ? letters.join('').toLocaleUpperCase() : undefined;
}
/** Whether white initials are readable on a disc of this colour: 4.5 to 1, the HIG's figure for text up to 17 pt. */
export const initialsReadable = (fill: Rgb): boolean => contrast(0xFFFFFF, packRgb(fill)) >= textContrast;
/** The text a cap writes in place of a number above it: `9` gives `9+`. */
export const cappedText = (cap: number): string => `${cap}+`;

// MARK: Settings

/** The Studio-only settings of a value badge. */
export interface BadgeSettings { cap?: number; spokenOne?: string; spokenOther?: string }
const settingKeys = ['cap', 'spokenOne', 'spokenOther'] as const;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const literal = (value: string): Operand => ({ type: 'literal', value });
/** The argument name a `{Count}` token compiles to. */
const COUNT_ARG = 'count';

/** What {@link expandBadgeSettings} gives: the document with every setting worked out, and where the badges that held settings stand. */
export interface BadgeExpansion {
  /** The same object when no badge holds a setting. */
  document: unknown;
  /** The pointers (from the envelope's root, `/document/...`) of the badges that held settings, in document order. */
  badges: string[];
}

/**
 * Works Show at Most and Spoken As out into plain operands. A value badge with `cap` N becomes a `choose` (above N, the text `N+`; otherwise the count
 * as text, so both branches are text); `spokenOne` and `spokenOther` become the badge's `spoken` operand (a `choose` on the count equal to 1, then a
 * `format` of `spokenOther` with each `{Count}` the whole, uncapped count). Everything else is untouched, so a document with no setting comes back as
 * the same object. A setting that is not valid throws a {@link CompositionValidationError} at its own pointer.
 */
export function expandBadgeSettings(document: unknown): BadgeExpansion {
  const issues: CompositionIssue[] = [];
  const badges: string[] = [];
  const add = (code: CompositionIssue['code'], at: string) => { issues.push({ code, pointer: at }); };
  const walk = (value: unknown, at: string): unknown => {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item, index) => { const result = walk(item, `${at}/${index}`); if (result !== item) changed = true; return result; });
      return changed ? next : value;
    }
    if (!isRecord(value)) return value;
    // The value a `literal` holds is data, never a badge.
    if (value.type === 'literal') return value;
    if (value.type === 'value' && isRecord(value.value) && settingKeys.some(key => key in value)) return expandBadge(value, at);
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = walk(item, pointer(at, key));
      if (result !== item) changed = true;
      next[key] = result;
    }
    return changed ? next : value;
  };
  const expandBadge = (badge: Record<string, unknown>, at: string): unknown => {
    badges.push(at);
    const count = badge.value as Operand;
    const { cap, spokenOne, spokenOther, ...rest } = badge as BadgeSettings & Record<string, unknown>;
    const before = issues.length;
    if ('cap' in badge && (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 1 || cap > MAX_BADGE_CAP)) add('invalid_value', `${at}/cap`);
    for (const key of ['spokenOne', 'spokenOther'] as const) {
      const line = badge[key];
      if (key in badge && (typeof line !== 'string' || !line.trim() || line.length > MAX_SPOKEN_LINE || bracesAreNotTokens(line))) add('invalid_value', `${at}/${key}`);
    }
    if (spokenOne !== undefined && spokenOther === undefined) add('missing_required', `${at}/spokenOther`);
    if ((spokenOne !== undefined || spokenOther !== undefined) && 'spoken' in badge) add('invalid_combination', `${at}/spoken`);
    if (issues.length > before) return badge;
    const out: Record<string, unknown> = { ...rest };
    if (cap !== undefined) out.value = cappedValue(count, cap);
    if (spokenOther !== undefined) out.spoken = spokenValue(count, spokenOne, spokenOther);
    return out;
  };
  const result = walk(document, '/document');
  if (issues.length) throw new CompositionValidationError(issues);
  return { document: result, badges };
}

/** Whether a line holds a brace that is not part of the one `{Count}` token. */
function bracesAreNotTokens(line: string): boolean {
  return /[{}]/.test(line.split(COUNT_TOKEN).join(''));
}
/** The count as text: a number prints as every other number does, so the `choose` below gives text in both branches. */
const countText = (count: Operand): Operand => ({ type: 'format', pattern: `{${COUNT_ARG}}`, args: { [COUNT_ARG]: count } });
/** `choose [when count above cap then "cap+"] otherwise count as text`. */
function cappedValue(count: Operand, cap: number): Operand {
  return { type: 'choose', cases: [{ when: { type: 'compare', op: 'above', left: count, right: { type: 'literal', value: cap } }, then: literal(cappedText(cap)) }], otherwise: countText(count) };
}
/** One Spoken As line: its words as a literal, or a `format` when it holds the `{Count}` token. */
function spokenLine(count: Operand, line: string): Operand {
  return line.includes(COUNT_TOKEN) ? { type: 'format', pattern: line.split(COUNT_TOKEN).join(`{${COUNT_ARG}}`), args: { [COUNT_ARG]: count } } : literal(line);
}
/** `choose [when count equals 1 then For 1] otherwise Otherwise`, or the Otherwise line alone. */
function spokenValue(count: Operand, one: string | undefined, other: string): Operand {
  const otherwise = spokenLine(count, other);
  if (one === undefined) return otherwise;
  return { type: 'choose', cases: [{ when: { type: 'compare', op: 'eq', left: count, right: { type: 'literal', value: 1 } }, then: spokenLine(count, one) }], otherwise };
}

/**
 * The document a publication holds: every setting worked out. The same object when there is none.
 * Throws when a setting is not valid.
 */
export const publishedBadges = (document: unknown): unknown => expandBadgeSettings(document).document;
/** Whether a document holds a Studio-only badge setting. */
export const usesBadgeSettings = (document: unknown): boolean => {
  try { return expandBadgeSettings(document).badges.length > 0; } catch { return true; }
};

/**
 * Moves an issue found in an expanded badge back to the setting that caused it. The count stands in the expansion more than once (in the comparison and
 * as text), so a fault in it is reported once, where the author wrote it (`<badge>/value/...` or `<badge>/spoken/...`). A fault in what the expansion wrote
 * is reported at the setting that asked for it: `cap`, `spokenOne` or `spokenOther`.
 */
export function remapBadgeIssues(issues: CompositionIssue[], badges: readonly string[], authored: unknown): CompositionIssue[] {
  const seen = new Set<string>();
  const out: CompositionIssue[] = [];
  for (const issue of issues) {
    const found = remapPointer(issue.pointer, badges, authored);
    const next = { ...issue, pointer: found };
    const key = `${next.code}\0${next.pointer}\0${next.capability ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}
function remapPointer(at: string, badges: readonly string[], authored: unknown): string {
  const badge = badges.find(base => at === base || at.startsWith(`${base}/`));
  if (badge === undefined) return at;
  const rest = at.slice(badge.length);
  const under = (lead: string) => rest === lead || rest.startsWith(`${lead}/`);
  const settings = settingsAt(authored, badge);
  /** The count as the author wrote it, or the count's kind (the comparison the setting wrote is about it). */
  const count = (lead: string) => `${badge}/value${rest.slice(lead.length)}`;
  const kindOfCount = `${badge}/value`;
  if (under('/value') && settings.cap !== undefined) {
    if (under('/value/cases/0/when/left')) return count('/value/cases/0/when/left');
    if (under('/value/otherwise/args/count')) return count('/value/otherwise/args/count');
    return under('/value/cases/0/when') ? kindOfCount : `${badge}/cap`;
  }
  if (under('/spoken') && settings.spokenOther !== undefined) {
    const one = settings.spokenOne !== undefined, otherwise = one ? '/spoken/otherwise' : '/spoken';
    if (one && under('/spoken/cases/0/when/left')) return count('/spoken/cases/0/when/left');
    if (one && under('/spoken/cases/0/when')) return kindOfCount;
    if (under(`${otherwise}/args/count`)) return count(`${otherwise}/args/count`);
    return one && under('/spoken/cases') ? `${badge}/spokenOne` : `${badge}/spokenOther`;
  }
  return at;
}
/** The settings the authored badge at a pointer holds (`{}` when it cannot be found). */
function settingsAt(document: unknown, at: string): BadgeSettings {
  let cursor: unknown = document;
  for (const part of at.split('/').slice(2)) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    cursor = Array.isArray(cursor) ? cursor[Number(key)] : isRecord(cursor) ? cursor[key] : undefined;
  }
  if (!isRecord(cursor)) return {};
  return { cap: cursor.cap as number | undefined, spokenOne: cursor.spokenOne as string | undefined, spokenOther: cursor.spokenOther as string | undefined };
}
