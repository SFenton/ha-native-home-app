import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { StateWordKey, StateWords } from '../../shared/composition/state-words';
import { overviewWordKeys, stateWordKeys, wordKeysFor } from '../../shared/composition/state-words';
import { Disclosure } from '../Disclosure';
import { LabeledRow, TextInput } from '../editors/controls';
import { useRows } from '../rows';

/** The tiles that carry `props.words`. */
export const wordsTileOf = (type: string | undefined): 'light-group-tile' | 'room-overview-tile' | undefined => type === 'light-group-tile' || type === 'room-overview-tile' ? type : undefined;

/** The row label of each word (`build/design/sim-fidelity-contract.md`, section 2). */
export const wordLabels: Record<StateWordKey, string> = { on: 'When On', off: 'When Off', unavailable: 'When Unavailable', count: 'Count Text', level: 'Level Text' };
/** What each word says when its field is empty: production's words. */
export const wordDefaults: Record<StateWordKey, string> = { on: 'On', off: 'Off', unavailable: 'Unavailable', count: '{count} On', level: '{value}%' };
/** The required token of a word, if it has one. */
const tokenOf: Partial<Record<StateWordKey, string>> = { count: '{count}', level: '{value}' };

/** The keys a tile takes, in the table's order: a light group tile by its own list, a room overview by its source's projection. */
export function wordRowsFor(type: string, projection?: string): StateWordKey[] {
  const allowed: readonly StateWordKey[] = type === 'light-group-tile' ? wordKeysFor['light-group-tile'] : overviewWordKeys(projection ?? '');
  return stateWordKeys.filter(key => allowed.includes(key));
}

/** The fold's summary: "Default", or "N Changed". */
export const wordsSummary = (words: StateWords | undefined): string => {
  const changed = stateWordKeys.filter(key => words?.[key] !== undefined).length;
  return changed ? `${changed} Changed` : 'Default';
};

/** A line under a row: the example or range of a word, or the check that concerns it. */
export function wordLine(key: StateWordKey, word: string | undefined): { text: string; tone: 'note' | 'warn' } | undefined {
  const token = tokenOf[key];
  if (word !== undefined && token && !word.includes(token)) return { tone: 'warn', text: key === 'count' ? 'Count Text has no {count}, so every room would read the same.' : 'Level Text has no {value}.' };
  if (key === 'count') return { tone: 'note', text: `Shows “${(word ?? wordDefaults.count).split('{count}').join('2')}”.` };
  if (key === 'level') return { tone: 'note', text: 'Shows 1% to 100% on a light that dims.' };
  return undefined;
}

/**
 * The State Words fold of a light group tile or a room overview tile (`sh.state-words@1`): closed, in the Content group after Tap; open, one text row per word the tile can draw.
 * An empty field stores nothing and shows the app's word as its placeholder; clearing a field removes the key, and the last key removed removes `words`.
 */
export function StateWordsFold({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const node = valueAt(document, path) as { type?: string; props?: { sourceId?: string; words?: StateWords } & Record<string, unknown> } | undefined;
  const tile = wordsTileOf(node?.type);
  if (!node || !tile) return null;
  const source = tile === 'room-overview-tile' ? document.dataSources.find(item => item.id === node.props?.sourceId) as { inputs?: { projection?: string } } | undefined : undefined;
  const keys = wordRowsFor(tile, source?.inputs?.projection);
  const words = node.props?.words;
  const write = (key: StateWordKey, text: string) => {
    const next = { ...words } as Record<string, string>;
    if (text) next[key] = text; else delete next[key];
    const props = { ...node.props } as Record<string, unknown>;
    if (Object.keys(next).length) props.words = next; else delete props.words;
    onChange(replaceAt(document, [...path, 'props'], props));
  };
  return <Disclosure label="State Words" summary={wordsSummary(words)} path={[...path, 'props', 'words'].join('/')}>
    {keys.map(key => {
      const line = wordLine(key, words?.[key]);
      return <div key={key} data-word-key={key}>
        <LabeledRow label={wordLabels[key]}><TextInput label={wordLabels[key]} value={words?.[key] ?? ''} placeholder={wordDefaults[key]} maxLength={key === 'count' || key === 'level' ? 80 : 240} onCommit={text => write(key, text)}/></LabeledRow>
        {line && <p className="w2-caption w2-swipe-line" role="note" data-tone={line.tone} data-word-line={key}>{line.text}</p>}
      </div>;
    })}
    <p className="w2-caption" data-testid="words-foot">An empty field uses the app’s word, shown in grey.</p>
  </Disclosure>;
}
