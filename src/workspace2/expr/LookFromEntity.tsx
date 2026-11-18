import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Operand } from '../../shared/composition/expression';
import { clampedColor, parseColor, type Rgb } from '../../shared/composition/color';
import { evaluateOperand, scalarText } from '../data/logic/logicEval';
import type { Json } from '../../shared/types';
import { useDraftDocument, type Draft } from '../editors/draft';
import LookControl, { type LookKind } from './LookControl';
import { ResultLine } from './ResultLine';
import { ValuePickerRow } from './ValuePicker';
import { operandName } from './condition';
import { useDataTag, useDraftEnvironment, useNameContext } from './useExpr';
import { words } from './words';

type Bound = { type: string; value: Operand; fallback: Json };
const hex = ({ red, green, blue }: Rgb) => `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/**
 * From Entity for a color or an icon (spec "From Entity"): the entity whose text is the color or the symbol name, what Home Assistant says,
 * how the app reads it, and the required fallback. Only the text a `read` can return (`#rrggbb`, `rgb()`, `hsl()`) is a color (`color.ts`).
 */
export default function LookFromEntity({ draft, path, kind, look, label }: { draft: Draft; path: EditorPath; kind: 'color' | 'icon'; look: LookKind; label: string }) {
  const document = useDraftDocument(draft), env = useDraftEnvironment(document), ctx = useNameContext(document), tag = useDataTag();
  const slot = valueAt(document, path) as Bound | undefined;
  if (!slot) return null;
  const operand = slot.value, chosen = operand.type === 'read';
  const said = chosen && env ? evaluateOperand(operand, env) : undefined;
  const text = said?.status === 'value' ? scalarText(said.value) ?? '' : undefined;
  const parsed = kind === 'color' && text !== undefined ? parseColor(text) : undefined;
  const fallbackName = kind === 'icon' ? words.noIcon : words.noColor;
  return <div className="w2-expr-entity" data-testid="look-from-entity">
    <ValuePickerRow draft={draft} label={words.from} title={words.from} stacked groups={['entities']} primary={chosen ? operandName(operand, ctx) : <span className="w2-placeholder">Choose</span>}
      onPick={picked => { const value = picked.operand.type === 'read' ? { ...picked.operand, as: 'string' as const, missing: 'unavailable' as const } : picked.operand; draft.set(replaceAt(picked.document, [...path, 'value'], value as unknown as Json)); }}/>
    {chosen && <div className="w2-expr-says"><span className="w2-row-label">{words.homeAssistantSays}</span><code>{text ?? '—'}</code></div>}
    {chosen && text !== undefined && kind === 'color' && (parsed
      ? <ResultLine marker="check" head={`${words.readAs} ${hex(parsed)}`} tag={tag}>{`${words.inTheApp} ${hex(clampedColor(parsed, look === 'glyph' ? 'glyph' : 'fill'))}`}</ResultLine>
      : <ResultLine marker="unknown" head={words.notAColor} tag={tag}>{`“${text}” isn't a color the app reads, so the fallback is used.`}</ResultLine>)}
    {chosen && text !== undefined && kind === 'icon' && /[:]/.test(text) && <p className="w2-caption">{`“${text}” isn't an SF Symbol name. The app draws SF Symbols, so the fallback is used.`}</p>}
    <LookControl look={look} value={slot.fallback} label={fallbackName} path={`${path.join('/')}/fallback`} onChange={(next, live) => draft.set(replaceAt(draft.get(), [...path, 'fallback'], next), live ? `look:${path.join('/')}` : undefined)}/>
    <p className="w2-caption">{kind === 'icon' ? words.noIconNote : words.noColorNote}</p>
    <span className="w2-sr">{label}</span>
  </div>;
}
