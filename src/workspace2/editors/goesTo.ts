import type { CompositionDocument } from '../../shared/composition/schema';
import type { EditorPath } from '../../composition-editor';
import { levelOwners, surfaceWord } from '../outline';

/**
 * The "Goes to" picker's choices (proposal `build/design/global-chrome/proposal.md`, section 3): Pages, Levels, Sheets and Modals, in that order. A tile inside a sheet
 * or one of its levels offers that sheet's levels; a tile on a page offers none. Pure: the picker only draws it.
 */

/** The four groups of the picker, in order. */
export const goesToGroups = ['Pages', 'Levels', 'Sheets', 'Modals'] as const;
export type GoesToGroup = typeof goesToGroups[number];

/** What an entry opens: a page or a level is a `push`; a sheet or modal is a `present`. */
export type GoesToKind = 'page' | 'level' | 'modal';

/** One entry of the picker. `id` is `<kind>:<id>`, since a page and a sheet may share an id. */
export interface GoesToChoice { id: string; label: string; group: GoesToGroup; kind: GoesToKind; target: string }

/** The picker's value for an action: `page:<id>`, `level:<id>` or `modal:<id>`; empty when it names nothing. */
export function goesToValue(document: CompositionDocument, action: { type?: string; pageId?: string; modalId?: string } | undefined): string {
  if (action?.type === 'push' && action.pageId) return `${(document.levels ?? []).some(level => level.id === action.pageId) ? 'level' : 'page'}:${action.pageId}`;
  if (action?.type === 'present' && action.modalId) return `modal:${action.modalId}`;
  return '';
}

/** Splits a picker value back into what it opens. */
export function parseGoesTo(value: string): { kind: GoesToKind; target: string } {
  const at = value.indexOf(':');
  return { kind: value.slice(0, at) as GoesToKind, target: value.slice(at + 1) };
}

/** The sheet a surface at `path` is, or is a level of: where "Levels" comes from. A page, a header button or a saved component's body is in none. */
function sheetsAt(document: CompositionDocument, path: EditorPath): string[] {
  const [list, at] = path;
  if (typeof at !== 'number') return [];
  if (list === 'modals') { const modal = document.modals[at]; return modal ? [modal.id] : []; }
  if (list === 'levels') {
    const level = document.levels?.[at];
    if (!level) return [];
    // Every sheet that reaches the level: its levels are this level's neighbours.
    return [...levelOwners(document).reach].filter(([, ids]) => ids.has(level.id)).map(([sheet]) => sheet);
  }
  return [];
}

/**
 * The picker's entries for the action at `path`. Levels are the ones the surrounding sheet reaches (a shared level counts for each sheet that reaches it), plus the ones no sheet
 * reaches yet, since they belong to no other sheet; a surface that is not in a sheet gets none. `current` is kept in the list even when it would not be offered, so a link that is wrong
 * still shows what it names (the checks say why it is wrong).
 */
export function goesToChoices(document: CompositionDocument, path: EditorPath, current?: string): GoesToChoice[] {
  const out: GoesToChoice[] = document.pages.map(page => ({ id: `page:${page.id}`, label: page.title, group: 'Pages', kind: 'page', target: page.id }));
  const sheets = sheetsAt(document, path);
  if (sheets.length) {
    const owners = levelOwners(document);
    const offered = new Set([...sheets.flatMap(sheet => [...(owners.reach.get(sheet) ?? [])]), ...owners.loose]);
    for (const level of document.levels ?? []) if (offered.has(level.id) || `level:${level.id}` === current) out.push({ id: `level:${level.id}`, label: level.title, group: 'Levels', kind: 'level', target: level.id });
  } else if (current?.startsWith('level:')) {
    const level = document.levels?.find(item => `level:${item.id}` === current);
    if (level) out.push({ id: current, label: level.title, group: 'Levels', kind: 'level', target: level.id });
  }
  for (const modal of document.modals) out.push({ id: `modal:${modal.id}`, label: modal.title, group: surfaceWord(modal) === 'Modal' ? 'Modals' : 'Sheets', kind: 'modal', target: modal.id });
  return goesToGroups.flatMap(group => out.filter(choice => choice.group === group));
}
