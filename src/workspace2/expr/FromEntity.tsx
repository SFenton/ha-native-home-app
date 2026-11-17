import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Json } from '../../shared/types';
import { TextInput } from '../editors/controls';
import type { Operand } from '../../shared/composition/expression';
import { evaluateOperand, scalarText } from '../../preview2/evaluate';
import { useDraftDocument, type Draft } from '../editors/draft';
import TokenField, { lineOperand } from './TokenField';
import TokenSettings from './TokenSettings';
import { ResultLine } from './ResultLine';
import { parseLine, tokenCount, type Part } from './tokens';
import { words } from './words';
import { useDataTag, useDraftEnvironment } from './useExpr';

/** The result line of a text value: "Shows **18 On**", or "Can't tell yet" with what the slot keeps. */
export function TextResult({ operand, document }: { operand: Operand | undefined; document: Parameters<typeof useDraftEnvironment>[0] }) {
  const env = useDraftEnvironment(document), tag = useDataTag();
  if (!operand || !env) return null;
  const result = evaluateOperand(operand, env);
  if (result.status !== 'value') return <ResultLine marker="unknown" head="Can't tell yet." tag={tag}>{result.status === 'loading' ? "Home Assistant hasn't answered yet, so the text keeps what it showed." : 'A value it reads is unavailable, so the text keeps what it showed.'}</ResultLine>;
  return <ResultLine marker="check" head={`Shows ${scalarText(result.value) ?? ''}`} tag={tag}/>;
}

/**
 * From Entity for text or a number (spec "From Entity"): the token line holding the values, the result line, and, for one value, its
 * settings (Value, Show as, Decimals). A color or an icon read from an entity waits for the contract (asks 3 and 4), so those slots
 * never offer this mode.
 */
export default function FromEntity({ draft, path, label, onWording }: { draft: Draft; path: EditorPath; label: string; onWording?: (parts: Part[], index: number) => void }) {
  const document = useDraftDocument(draft);
  const operand = lineOperand(valueAt(document, path), 'slot');
  const parts = operand ? parseLine(operand) : undefined;
  return <div className="w2-expr-entity" data-testid="from-entity">
    <TokenField draft={draft} address={{ path, wrap: 'slot' }} label={label} onWording={onWording}/>
    <TextResult operand={operand} document={document}/>
    {parts && tokenCount(parts) === 1 && <TokenSettings draft={draft} address={{ path, wrap: 'slot' }} index={0} onWording={onWording}/>}
    {parts && tokenCount(parts) >= 1 && (() => {
      const slot = valueAt(document, path) as { type: string; fallback?: string } | undefined;
      return slot && (slot.type === 'read' || slot.type === 'expr') ? <div className="w2-picker-row" data-stacked data-field-path={`${path.join('/')}/fallback`}><span className="w2-row-label">{words.ifUnavailable}</span>
        <TextInput label={words.ifUnavailable} value={slot.fallback ?? ''} placeholder="The node's own text" maxLength={2000}
          onCommit={text => { const { fallback: _gone, ...rest } = slot; draft.set(replaceAt(draft.get(), path, (text ? { ...rest, fallback: text } : rest) as unknown as Json), `fallback:${path.join('/')}`); }}/>
        <p className="w2-caption">{words.ifUnavailableNote}</p></div> : null;
    })()}
    {parts && tokenCount(parts) === 0 && <p className="w2-caption">Type {'{'}, or press Insert a Value, to add a value from an entity.</p>}
  </div>;
}
