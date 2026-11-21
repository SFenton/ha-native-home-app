import { ArrowDown, ArrowUp, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Operand } from '../../shared/composition/expression';
import { evaluateOperand, evaluatePredicate } from '../../preview2/evaluate';
import { createId } from '../../shared/ids';
import { GlyphByName } from '../../preview2/nodes/shared';
import { symbol } from '../add/catalog';
import { ensureSource } from '../add/sources';
import { defaultAction } from '../editors/action';
import { ChoiceRow } from '../SegmentRow';
import { ResultLine } from '../expr/ResultLine';
import { useDataTag, useDraftEnvironment } from '../expr/useExpr';
import { EntityField } from '../pickers/PickerField';
import { Tag, usePush } from '../kit';
import { ObjectRows, summarize, useRows } from '../rows';
import { TextInput } from '../editors/controls';
import { Rows } from '../rowsContext';
import ValueField from '../expr/ValueField';
import { AddressedField } from '../logic-fields/AddressedField';
import { useLogicFields } from '../logic-fields/LogicFields';

// MARK: Progress

type Tile = { props: { progress?: Operand; discs?: Disc[] } };
/** A text slot as the contract holds it (`sh.tile-disc-rules@1`): plain words, or an object that reads or follows an expression. */
type DiscLabel = string | { type: 'literal'; value: string } | { type: 'read' | 'expr' };
/** A button's symbol: exact, or one that follows a rule or an entity (`sh.tile-disc-rules@1`), which has no `name` of its own. */
type DiscIcon = { type: 'sf-symbol'; name: string } | { type: 'conditional' | 'bound-symbol' };
interface Disc { id: string; icon: DiscIcon; label: DiscLabel; namesTile?: boolean; action: unknown; visibleWhen?: unknown; enabledWhen?: { condition: unknown } }

/** The words a button's row shows: its label when that is plain words, else "Button" (the label follows a rule or an entity). */
export const discWords = (disc: Pick<Disc, 'label'>): string => typeof disc.label === 'string' ? disc.label : disc.label.type === 'literal' ? (disc.label as { value: string }).value : 'Button';
/** Whether a button's symbol or label follows a rule or an entity. */
const followsRule = (disc: Disc) => disc.icon.type !== 'sf-symbol' || (typeof disc.label !== 'string' && disc.label.type !== 'literal');
/** The button's glyph for its row: its own symbol, or the one it shows when no rule holds. */
const discGlyph = (disc: Disc): string => disc.icon.type === 'sf-symbol' ? (disc.icon as { name: string }).name : (disc.icon as unknown as { otherwise?: { name: string }; fallback?: { name: string } }).otherwise?.name ?? (disc.icon as unknown as { fallback?: { name: string } }).fallback?.name ?? 'bolt';

const literal = (value: number) => ({ type: 'literal' as const, value });
/** How a progress operand reads: a number from 0 to 1 read from an entity, a percentage (0 to 100) divided by 100, or a formula this row does not edit. */
function progressOf(operand: Operand | undefined): { form: 'fraction' | 'percentage'; sourceId: string; path: string[] } | undefined {
  if (!operand) return undefined;
  const read = (value: Operand) => value.type === 'read' && value.from.type === 'source' ? { sourceId: value.from.sourceId, path: value.from.path } : undefined;
  if (operand.type === 'math' && operand.op === 'divide' && operand.args.length === 2 && operand.args[1].type === 'literal' && operand.args[1].value === 100) {
    const found = read(operand.args[0]);
    return found && { form: 'percentage', ...found };
  }
  const found = read(operand);
  return found && { form: 'fraction', ...found };
}
const readOf = (sourceId: string, path: string[]): Operand => ({ type: 'read', from: { type: 'source', sourceId, path }, as: 'number', missing: 'unavailable' });
const progressOperand = (form: 'fraction' | 'percentage', sourceId: string, path: string[]): Operand =>
  form === 'percentage' ? { type: 'math', op: 'divide', args: [readOf(sourceId, path), literal(100)] } : readOf(sourceId, path);

/** The tile's Progress row: None, or a number from an entity as a fraction or a percentage, with what it gives now. */
export function ProgressRow({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const canvas = useLogicFields();
  const tile = valueAt(document, path) as Tile | undefined;
  const env = useDraftEnvironment(document), tag = useDataTag();
  if (!tile) return null;
  const progressPath = [...path, 'props', 'progress'];
  const operand = tile.props.progress;
  const parts = progressOf(operand);
  const set = (next: Operand | undefined) => {
    const props = { ...tile.props } as Record<string, unknown>;
    if (next) props.progress = next; else delete props.progress;
    return replaceAt(document, [...path, 'props'], props);
  };
  const pick = (entityId: string, unit?: string) => {
    const made = ensureSource(document, entityId);
    const form = unit?.trim() === '%' ? 'percentage' : parts?.form ?? 'fraction';
    onChange(replaceAt(made.document, [...path, 'props'], { ...tile.props, progress: progressOperand(form, made.sourceId, ['state']) }));
  };
  if (!operand) return <div className="w2-row" data-field-path={progressPath.join('/')}>
    <EntityField label="Progress" entityId={undefined} domains={['sensor', 'number', 'input_number']} onPick={row => pick(row.entityId, row.state?.match(/%\s*$/) ? '%' : undefined)}/>
    <p className="w2-caption">A number from 0 to 1. Nothing is drawn while it is None.</p>
  </div>;
  const source = parts ? document.dataSources.find(item => item.id === parts.sourceId) : undefined;
  const entityId = source?.kind === 'ha-entity' && source.entityId.type === 'literal' ? source.entityId.value : undefined;
  const result = env ? evaluateOperand(operand, env) : undefined;
  const now = result?.status === 'value' && typeof result.value === 'number' ? Math.round(Math.min(1, Math.max(0, result.value)) * 100) : undefined;
  return <div className="w2-progress-row" data-field-path={progressPath.join('/')}>
    {parts ? <>
      <EntityField label="Progress" entityId={entityId} domains={['sensor', 'number', 'input_number']} onPick={row => pick(row.entityId, row.state?.match(/%\s*$/) ? '%' : undefined)}/>
      <div className="w2-row"><label className="field"><span>Read</span>
        <TextInput label="Read" value={parts.path.join('.')} placeholder="state" onCommit={text => { const next = text.trim().split('.').filter(Boolean); if (next.length) onChange(set(progressOperand(parts.form, parts.sourceId, next))); }}/></label></div>
      <ChoiceRow label="Value is" value={parts.form} options={[{ value: 'percentage', label: 'A Percentage (0 to 100)' }, { value: 'fraction', label: 'A Fraction (0 to 1)' }]}
        onChange={form => onChange(set(progressOperand(form as 'fraction' | 'percentage', parts.sourceId, parts.path)))}/>
      {env && <ResultLine marker={now === undefined ? 'unknown' : 'check'} head={now === undefined ? 'No progress now.' : `Now: ${now}%`} tag={tag}/>}
    </> : canvas ? <AddressedField path={progressPath} kind="operand" label="Progress"/> : <p className="w2-caption">Progress is a formula. Edit it in Advanced.</p>}
    {canvas && parts && <AddressedField path={progressPath} kind="operand" label="Progress logic"/>}
    <button type="button" className="w2-remove" onClick={() => onChange(set(undefined))}>Remove Progress</button>
  </div>;
}

// MARK: Buttons

/**
 * A button's Label (VoiceOver reads it, it is never drawn): plain words, or a value that follows an entity or rules, like any text slot. A label stored as plain
 * words shows as a fixed value; the first change through the value field stores it as a text slot (`sh.tile-disc-rules@1`).
 */
function DiscLabel({ path, disc, tileTitle }: { path: EditorPath; disc: Disc; tileTitle: string }) {
  const rows = useRows();
  const view = typeof disc.label === 'string' ? replaceAt(rows.document, path, { type: 'literal', value: disc.label }) : rows.document;
  return <Rows.Provider value={{ ...rows, document: view }}>
    <ValueField label="Label" path={path} kind="text" itemName={tileTitle} maxLength={80}/>
    <p className="w2-caption">VoiceOver reads this. It is not drawn.</p>
  </Rows.Provider>;
}

/** One button's page (pushed): Label (VoiceOver reads it, it is never drawn), Icon, then Behavior, with Remove Button at the foot. */
function ButtonPage({ path, index }: { path: EditorPath; index: number }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const tile = valueAt(document, path) as Tile | undefined;
  const disc = tile?.props.discs?.[index];
  if (!tile || !disc) return null;
  const discPath = [...path, 'props', 'discs', index];
  return <div className="w2-editor-page" data-testid="button-page">
    <DiscLabel path={[...discPath, 'label']} disc={disc} tileTitle={(tile as unknown as { title?: string }).title ?? ''}/>
    <ObjectRows path={discPath} owner="tile-disc" skip={at => at.at(-1) === 'id' || at.at(-1) === 'label'}/>
    <div className="w2-editor-foot-inline"><button type="button" className="w2-remove" onClick={() => {
      const rest = (tile.props.discs ?? []).filter((_, at) => at !== index);
      const props = { ...tile.props } as Record<string, unknown>;
      if (rest.length) props.discs = rest; else delete props.discs;
      onChange(replaceAt(document, [...path, 'props'], props));
      push?.pop();
    }}>Remove Button</button></div>
  </div>;
}

/** The Buttons group of a state tile: one 44 px row for each button (up to 2), each pushing its page, and Add Button. */
export function ButtonsGroup({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const env = useDraftEnvironment(document);
  const tile = valueAt(document, path) as Tile | undefined;
  if (!tile) return null;
  const discs = tile.props.discs ?? [];
  const write = (next: Disc[]) => {
    const props = { ...tile.props } as Record<string, unknown>;
    if (next.length) props.discs = next; else delete props.discs;
    onChange(replaceAt(document, [...path, 'props'], props));
  };
  const move = (at: number, offset: number) => { const next = [...discs]; const [moved] = next.splice(at, 1); next.splice(at + offset, 0, moved); write(next); };
  const state = (disc: Disc) => {
    if (!env) return '';
    const holds = (predicate: unknown) => evaluatePredicate(predicate as never, env);
    if (disc.visibleWhen && holds(disc.visibleWhen) === 'no') return 'Hidden now';
    if (disc.enabledWhen && holds(disc.enabledWhen.condition) === 'no') return 'Disabled now';
    return '';
  };
  const open = (at: number) => push?.push({ title: discWords(discs[at]), body: <ButtonPage path={path} index={at}/> });
  return <section className="w2-group" data-group="buttons" aria-label="Buttons">
    <h3 className="w2-group-title">Buttons</h3>
    <ul className="w2-tab-list">
      {discs.map((disc, at) => <li key={disc.id} className="w2-tab-row">
        <button type="button" className="w2-tab-open" onClick={() => open(at)} aria-label={`${discWords(disc)}, ${summarize(document, 'action', disc.action as never)}${state(disc) ? `, ${state(disc)}` : ''}`}>
          <GlyphByName name={discGlyph(disc)} size={18}/>
          <span className="w2-page-text"><span className="w2-page-title">{discWords(disc)}</span><span className="w2-page-via">{[summarize(document, 'action', disc.action as never), state(disc)].filter(Boolean).join(' · ')}</span></span>
          {(disc.visibleWhen != null || followsRule(disc)) && <Tag>Rule</Tag>}<ChevronRight size={16} aria-hidden/>
        </button>
        <button type="button" className="w2-icon-button" aria-label={`Move ${discWords(disc)} up`} disabled={at === 0} onClick={() => move(at, -1)}><ArrowUp size={16} aria-hidden/></button>
        <button type="button" className="w2-icon-button" aria-label={`Move ${discWords(disc)} down`} disabled={at === discs.length - 1} onClick={() => move(at, 1)}><ArrowDown size={16} aria-hidden/></button>
        <button type="button" className="w2-icon-button" aria-label={`Remove ${discWords(disc)}`} onClick={() => write(discs.filter((_, index) => index !== at))}><Trash2 size={16} aria-hidden/></button>
      </li>)}
    </ul>
    <div className="w2-tabs-add">
      <button type="button" disabled={discs.length >= 2} onClick={() => { write([...discs, { id: createId('button'), icon: symbol('bolt'), label: 'Button', action: defaultAction('call-service', document) }]); }}><Plus size={14} aria-hidden/> Add Button</button>
      {discs.length >= 2 && <p className="w2-caption">2 buttons at most.</p>}
    </div>
  </section>;
}

// MARK: Width

/** The tile's Width pop-up: Automatic (the grid decides), or 2, 3 or 4 columns; the grid widens a tile with buttons until they fit. */
export function WidthRow({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const tile = valueAt(document, path) as { layout?: { span?: number }; props?: { discs?: unknown[] } } | undefined;
  if (!tile) return null;
  const span = tile.layout?.span;
  const options = [{ value: 'auto', label: 'Automatic' }, ...(span === 1 ? [{ value: '1', label: '1 column' }] : []), { value: '2', label: '2 columns' }, { value: '3', label: '3 columns' }, { value: '4', label: '4 columns' }];
  const set = (value: string) => { const { span: _gone, ...rest } = tile.layout ?? {}; void _gone; onChange(replaceAt(document, [...path, 'layout'], value === 'auto' ? rest : { ...rest, span: Number(value) })); };
  return <div data-field-path={[...path, 'layout', 'span'].join('/')}>
    <ChoiceRow label="Width" value={span === undefined ? 'auto' : String(span)} options={options} onChange={set}/>
    {Boolean(tile.props?.discs?.length) && <p className="w2-caption">The app widens a tile with buttons until they fit.</p>}
  </div>;
}

