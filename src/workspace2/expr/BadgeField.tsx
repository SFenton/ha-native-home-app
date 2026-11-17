import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Operand } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import EditorRow from '../editors/EditorRow';
import { useDraftDocument, type Draft } from '../editors/draft';
import { useRows } from '../rowsContext';
import TokenField from './TokenField';
import { operandName } from './condition';
import { Segmented } from './ui';
import { parseLine } from './tokens';
import { useNameContext } from './useExpr';
import { words } from './words';

type Badge = { type: 'none' } | { type: 'value'; value: Operand };

/** The summary a badge reads at rest: "None", or the line it draws. */
function summary(badge: Badge | undefined, name: (operand: Operand) => string): string {
  if (!badge || badge.type === 'none') return words.none;
  const parts = parseLine(badge.value);
  return parts ? parts.map(part => 'text' in part ? part.text : name(part.token.operand)).join('') || words.none : words.customValue;
}

function BadgeBody({ draft, path }: { draft: Draft; path: EditorPath }) {
  const document = useDraftDocument(draft);
  const badge = valueAt(document, path) as Badge | undefined;
  const mode = badge?.type === 'value' ? 'value' : 'none';
  return <div className="w2-expr-editor" data-testid="badge-editor">
    <Segmented label="Badge" value={mode} options={[{ value: 'none', label: words.none }, { value: 'value', label: words.value }]}
      onChange={next => draft.set(replaceAt(draft.get(), path, (next === 'none' ? { type: 'none' } : { type: 'value', value: { type: 'literal', value: '' } }) as unknown as Json))}/>
    {badge?.type === 'value' && <>
      <TokenField draft={draft} address={{ path: [...path, 'value'], wrap: 'operand' }} label="Badge"/>
      <p className="w2-caption">{words.badgeZero}</p></>}
  </div>;
}

/** "Badge" on a chip, a tile or a tab (spec "Badges"): None, or a number or text that may follow an entity. A value of 0 draws no badge. */
export default function BadgeField({ path, label = 'Badge', itemName }: { path: EditorPath; label?: string; itemName: string }) {
  const { document, onChange } = useRows();
  const ctx = useNameContext(document);
  const badge = valueAt(document, path) as Badge | undefined;
  return <EditorRow label={label} summary={summary(badge, operand => operandName(operand, ctx))} itemName={itemName} document={document} onApply={onChange} path={path.join('/')}>
    {draft => <BadgeBody draft={draft} path={path}/>}
  </EditorRow>;
}
