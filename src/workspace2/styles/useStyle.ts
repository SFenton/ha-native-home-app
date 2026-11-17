import { useCallback } from 'react';
import { replaceStyle, usedBy, stateTiles } from '../../shared/composition/state-style-library';
import { builtInStyle, resolveTileStyle, type StateStyleDefinition } from '../../shared/composition/state-styles';
import type { CompositionDocument } from '../../shared/composition/schema';
import { useRows } from '../rowsContext';

/** The style `id` (the document's, else the built-in one), whether it can be edited, and how to change it. */
export function useStyle(id: string) {
  const { document, onChange } = useRows();
  const saved = document.stateStyles?.styles.find(item => item.id === id);
  const style = saved ?? builtInStyle(id);
  const readOnly = !saved;
  const edit = useCallback((next: StateStyleDefinition, group?: string) => {
    if (document.stateStyles) onChange({ ...document, stateStyles: replaceStyle(document.stateStyles, id, next) }, group);
  }, [document, id, onChange]);
  return { document, onChange, style, readOnly, edit, uses: styleUses(document, id), tiles: tilesOf(document, id) };
}

/** The tiles that draw with the style `id`, saved or built-in. */
export const tilesOf = (document: CompositionDocument, id: string) =>
  stateTiles(document).filter(tile => resolveTileStyle(tile.binding, document.stateStyles)?.id === id);

/** How many tiles use the style `id`: the library's count for a saved style, the tiles resolving to it for a built-in one. */
export const styleUses = (document: CompositionDocument, id: string): number => document.stateStyles?.styles.some(item => item.id === id) ? usedBy(document, id) : tilesOf(document, id).length;
