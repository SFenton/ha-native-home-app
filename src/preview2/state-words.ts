import type { StateWords } from '../shared/composition/state-words';

/**
 * Where the sim says a tile's own words (`sh.state-words@1`): an authored word replaces the app's, an absent one leaves it. Pure, so the nodes and their tests
 * share one answer. The defaults are production's words (`RoomOverview.lightSubtitle`, `BrightnessTile.status`).
 */
/** `{count}` or `{value}` replaced by the number. */
const put = (pattern: string, token: string, value: number) => pattern.split(token).join(String(value));

/** A light's line on a light group tile or a brightness tile: Unavailable, Off, the level, or On for a light that does not dim. */
export function lightLine(words: StateWords | undefined, state: { dead: boolean; on: boolean; percent: number; dims: boolean }): string {
  if (state.dead) return words?.unavailable ?? 'Unavailable';
  if (!state.on) return words?.off ?? 'Off';
  return state.dims ? put(words?.level ?? '{value}%', '{value}', state.percent) : words?.on ?? 'On';
}

/** What a room overview's source gave: the projection, its format, the phase and the counts. */
export interface OverviewFacts { projection?: unknown; format?: unknown; phase?: unknown; count?: unknown; total?: unknown }
/**
 * The line of a room overview tile: its words for the states it can say (the lights room, the occupancy, the unavailable word of the others), else `line`,
 * the source's own text. The room and detail formats are production's sentences; a summary or item format keeps its labels.
 */
export function overviewLine(words: StateWords | undefined, facts: OverviewFacts, line: string): string {
  if (!words) return line;
  if (facts.phase === 'unavailable') return words.unavailable ?? line;
  if (facts.format !== 'room' && facts.format !== 'detail') return line;
  const count = typeof facts.count === 'number' ? facts.count : undefined, total = typeof facts.total === 'number' ? facts.total : undefined;
  if (facts.projection === 'lights' && count !== undefined) {
    if (count === 0) return words.off ?? line;
    return total === 1 ? words.on ?? line : words.count ? put(words.count, '{count}', count) : line;
  }
  if (facts.projection === 'occupancy' && count !== undefined) return count > 0 ? words.on ?? line : words.off ?? line;
  return line;
}
