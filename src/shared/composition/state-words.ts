import { z } from 'zod/v4';
import { text } from './slots';

/**
 * `sh.state-words@1`: the words a tile says for its states. An optional `props.words` object on `light-group-tile`, `custom-light-control` (kind `brightness`)
 * and `room-overview-tile`. An absent key draws the app's word (production's), so a document without `words` is byte-identical and draws production's text
 * (`build/design/sim-fidelity-contract.md`, section 2).
 */
const object = z.strictObject;
const title = text(240);

export const stateWordsSchema = object({
  /** "On": a light group tile that does not dim, a room with one light, an occupancy that is occupied. */
  on: title.optional(),
  /** "Off": a light that is off, a room with no lights on, an occupancy that is clear. */
  off: title.optional(),
  /** "Unavailable". */
  unavailable: title.optional(),
  /** "{count} On": a room with more than one light, with `{count}` for the number on. Required token. */
  count: text(80).optional(),
  /** "{value}%": a light's level, with `{value}` for the percentage. Required token. */
  level: text(80).optional(),
});
export type StateWords = z.infer<typeof stateWordsSchema>;
export type StateWordKey = keyof StateWords;
export const stateWordKeys: readonly StateWordKey[] = ['on', 'off', 'unavailable', 'count', 'level'];

/** What a tile can draw: the keys it takes. A key it cannot draw is refused, so no document holds a dead word. */
export const wordKeysFor = {
  'light-group-tile': ['on', 'off', 'unavailable', 'level'],
  'custom-light-control': ['off', 'unavailable', 'level'],
  /** A `room-overview-tile` by its source's projection: lights say `on` for one light and `count` for more; occupancy its two words; the rest only the unavailable one. */
  lights: ['on', 'off', 'unavailable', 'count'],
  occupancy: ['on', 'off', 'unavailable'],
  other: ['unavailable'],
} as const satisfies Record<string, readonly StateWordKey[]>;
/** The room overview's key set for a `home-status@1` projection. */
export const overviewWordKeys = (projection: string): readonly StateWordKey[] => projection === 'lights' ? wordKeysFor.lights : projection === 'occupancy' ? wordKeysFor.occupancy : wordKeysFor.other;

/** The token a word must hold, and the tokens it may not: `on`, `off` and `unavailable` hold none. */
const required: Partial<Record<StateWordKey, string>> = { count: '{count}', level: '{value}' };
const tokens = (word: string): string[] => word.match(/\{[^}]*\}/g) ?? [];

/** One problem of a words object, as a code at a pointer below `props/words`. */
export interface WordProblem { code: 'invalid_value' | 'invalid_combination'; at: string }

/** The checks of a words object for a tile that takes `allowed`: each key is one the tile draws, holds its token (count and level) and no other. */
export function wordProblems(words: StateWords, allowed: readonly StateWordKey[]): WordProblem[] {
  const found: WordProblem[] = [];
  for (const key of stateWordKeys) {
    const word = words[key];
    if (word === undefined) continue;
    if (!allowed.includes(key)) { found.push({ code: 'invalid_combination', at: `/${key}` }); continue; }
    const need = required[key], present = tokens(word);
    if (need ? !present.includes(need) || present.some(token => token !== need) : present.length > 0) found.push({ code: 'invalid_value', at: `/${key}` });
    else if (/[{}]/.test(word.split(need ?? '\0').join(''))) found.push({ code: 'invalid_value', at: `/${key}` });
  }
  return found;
}
