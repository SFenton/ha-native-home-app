import { dateStyles, durationStyles, durationUnits, operandKind, textCases, type DateStyle, type DurationStyle, type DurationUnit, type TextCase } from '../../shared/composition/expression';
import { valueAt } from '../../composition-editor';
import { usePush } from '../kit';
import { useDraftDocument, type Draft } from '../editors/draft';
import { SelectMenu } from '../SelectMenu';
import { Switch, TextInput } from '../editors/controls';
import { ValuePickerRow } from './ValuePicker';
import { lineOperand, writeParts, type LineAddress } from './TokenField';
import { operandName } from './condition';
import { newToken, parseLine, wordingFor01, type Part } from './tokens';
import { useNameContext } from './useExpr';
import { words } from './words';

/** The capital letters a text value can have: as written, then each case the contract has. */
const textCaseChoices = [{ value: 'as-written', label: words.textCaseChoices['as-written'] }, ...[...textCases].reverse().map(item => ({ value: item, label: words.textCaseChoices[item] }))];

/** What a token opened offers (spec "The token line"): its value, how a number is written, wording for 0 and 1, and Remove Value. */
export default function TokenSettings({ draft, address, index, onWording, onClose }: { draft: Draft; address: LineAddress; index: number; onWording?: (parts: Part[], index: number) => void; onClose?: () => void }) {
  const document = useDraftDocument(draft), ctx = useNameContext(document), push = usePush();
  const operand = lineOperand(valueAt(document, address.path), address.wrap);
  const parts = operand ? parseLine(operand) : undefined;
  const tokenIndexes = (parts ?? []).flatMap((part, at) => 'token' in part ? [at] : []);
  const at = tokenIndexes[index], part = at === undefined ? undefined : parts![at];
  if (!parts || !part || !('token' in part)) return <p className="w2-caption">{words.customValue}</p>;
  const { token } = part;
  const set = (next: Part[]) => writeParts(draft, address, next, false);
  const update = (change: Partial<typeof token>) => set(parts.map((item, i) => i === at ? { token: { ...token, ...change } } : item));
  const numeric = token.operand.type === 'read' && token.operand.as === 'number' && !token.dateStyle;
  // Text that is not a date or a number: it can be drawn with each word capitalized.
  const wording = token.operand.type === 'read' && token.operand.as === 'string' && !token.dateStyle;
  // A number can also be drawn as a length of time (`sh.duration-format@1`).
  const numberish = !token.dateStyle && !token.textCase && operandKind(token.operand) === 'number';
  /** Decimals keep their trailing zeros as one setting: the minimum follows the count. */
  const setDigits = (digits: number) => update({ digits, ...(token.minDigits !== undefined ? { minDigits: digits } : {}) });
  const leave = () => { onClose?.(); if (!onClose) push?.pop(); };
  return <div className="w2-token-settings" data-testid="token-settings">
    <p className="w2-expr-tokenname"><strong>{operandName(token.operand, ctx)}</strong></p>
    <ValuePickerRow draft={draft} label={words.value} title={words.value} stacked={false} primary={operandName(token.operand, ctx)}
      onPick={picked => { draft.set(picked.document); set(parts.map((item, i) => i === at ? { token: newToken(picked.operand) } : item)); }}/>
    {token.operand.type === 'read' && <div className="w2-row-segment"><span className="w2-row-label">Show as</span>
      <div className="w2-expr-control"><SelectMenu label="Show as" value={token.dateStyle ? 'date' : numeric ? 'number' : 'string'} options={[{ value: 'string', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'date', label: words.dateShow }]}
        onChange={next => update(next === 'date'
          ? { operand: { ...token.operand, as: 'string' } as typeof token.operand, digits: undefined, minDigits: undefined, truncate: undefined, textCase: undefined, dateStyle: token.dateStyle ?? 'short-date' }
          : { operand: { ...token.operand, as: next as 'string' | 'number' } as typeof token.operand, digits: next === 'number' ? token.digits : undefined, minDigits: next === 'number' ? token.minDigits : undefined, textCase: next === 'string' ? token.textCase : undefined, dateStyle: undefined })}/></div></div>}
    {wording && <div className="w2-row-segment"><span className="w2-row-label">{words.capitalize}</span>
      <div className="w2-expr-control"><SelectMenu label={words.capitalize} value={token.textCase ?? 'as-written'} options={textCaseChoices}
        onChange={next => update({ textCase: next === 'as-written' ? undefined : next as TextCase })}/></div>
      {token.textCase && <p className="w2-caption">{words.textCaseNotes[token.textCase]}</p>}</div>}
    {(token.dateStyle || token.operand.type === 'clock' || token.operand.type === 'last-changed') && <div className="w2-row-segment"><span className="w2-row-label">{words.dateStyle}</span>
      <div className="w2-expr-control"><SelectMenu label={words.dateStyle} value={token.dateStyle ?? 'short-date'} options={dateStyles.map(style => ({ value: style, label: words.dateStyles[style] }))}
        onChange={next => update({ dateStyle: next as DateStyle })}/></div>
      <p className="w2-caption">{words.dateNote}</p>
      {token.operand.type === 'clock' && token.operand.part === 'now-second' && <p className="w2-caption">{words.nowSecondNote}</p>}</div>}
    {numberish && <div className="w2-row-segment"><span className="w2-row-label">{words.durationShow}</span>
      <div className="w2-expr-control"><SelectMenu label={words.durationShow} value={token.duration?.style ?? 'number'} options={[{ value: 'number', label: words.durationNumber }, ...durationStyles.map(style => ({ value: style, label: words.durationStyles[style] }))]}
        onChange={next => update(next === 'number' ? { duration: undefined } : { duration: { style: next as DurationStyle, ...(next === 'compact' && token.duration?.unit ? { unit: token.duration.unit } : {}) }, digits: undefined, minDigits: undefined, truncate: undefined })}/></div>
      {token.duration && <p className="w2-caption">{token.duration.style === 'compact' && token.duration.unit === 'minutes' ? words.durationNoteMinutes : words.durationNote}</p>}</div>}
    {token.duration?.style === 'compact' && <div className="w2-row-segment"><span className="w2-row-label">{words.durationUnit}</span>
      <div className="w2-expr-control"><SelectMenu label={words.durationUnit} value={token.duration.unit ?? 'seconds'} options={durationUnits.map(unit => ({ value: unit, label: words.durationUnits[unit] }))}
        onChange={next => update({ duration: { style: 'compact', unit: next as DurationUnit } })}/></div></div>}
    {numeric && !token.duration && <div className="w2-row-segment"><span className="w2-row-label">Decimals</span>
      <div className="w2-expr-stepper"><button type="button" aria-label="Fewer decimals" disabled={(token.digits ?? 0) <= 0 && token.digits !== undefined} onClick={() => setDigits(Math.max(0, (token.digits ?? 1) - 1))}>−</button>
        <TextInput label="Decimals" number value={token.digits === undefined ? '' : String(token.digits)} placeholder="Auto" onCommit={text => { const value = Math.round(Number(text)); if (text !== '' && value >= 0 && value <= 6) setDigits(value); }}/>
        <button type="button" aria-label="More decimals" disabled={(token.digits ?? 0) >= 6} onClick={() => setDigits(Math.min(6, (token.digits ?? -1) + 1))}>+</button></div></div>}
    {numeric && token.digits !== undefined && !token.duration && <div className="w2-row-segment"><Switch label={words.truncate} checked={!!token.truncate} onChange={on => update({ truncate: on || undefined })}/><p className="w2-caption">{words.truncateNote}</p></div>}
    {numeric && token.digits !== undefined && <div className="w2-row-segment"><Switch label={words.keepZeros} checked={token.minDigits !== undefined} onChange={on => update({ minDigits: on ? token.digits : undefined })}/><p className="w2-caption">{words.keepZerosNote}</p></div>}
    {numeric && onWording && <button type="button" className="w2-expr-wording" onClick={() => { onWording(parts, at); leave(); }}>{words.wording01}</button>}
    <button type="button" className="w2-expr-remove" onClick={() => { set(parts.filter((_, i) => i !== at)); leave(); }}>{words.removeValue}</button>
  </div>;
}
export { wordingFor01 };
