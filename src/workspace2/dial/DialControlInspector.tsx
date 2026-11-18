import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { Operand } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import CompositionFields from '../../CompositionFields';
import { NumberField, TextField } from '../../ui';
import { ChoiceRow } from '../SegmentRow';
import { SelectMenu } from '../SelectMenu';
import { Disclosure } from '../Disclosure';
import { fieldOptions, schemaAt, useRows } from '../rows';
import { ActionRow } from '../editors/ActionEditor';
import ConditionField from '../expr/ConditionField';
import { ValuePickerRow } from '../expr/ValuePicker';
import { operandName } from '../expr/condition';
import { useNameContext } from '../expr/useExpr';
import type { Draft } from '../editors/draft';
import { EntityField } from '../pickers/PickerField';
import {
  addStopper, betweenChoices, recallThermostat, rememberThermostat, thermostatFor, rebindThermostat, betweenOf, callFormOf, callForms, dialStarts, fromThermostat, removeStopper, restart,
  stoppersOf, withBetween, withCallForm, isThermostatDial, thermostatView, withThermostatView, type BetweenChoice, type CallForm, type DialNodeShape, type DialStart,
} from '../../shared/composition/dial-control-edit';

// MARK: Pieces

type Obj = Record<string, Json>;
const literal = (value: Json): Operand => ({ type: 'literal', value });
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value);
/** A document and its setter as the picker's draft: it reads the latest document and writes straight through (the row is its own step). */
function useRowsDraft(): Draft {
  const { document, onChange } = useRows();
  const latest = useRef(document);
  latest.current = document;
  const draft = useRef<Draft>(undefined);
  draft.current ??= { get: () => latest.current, set: next => onChange(next), subscribe: () => () => {}, dirty: () => false, tryLeave: () => true, prompt: { get: () => false, set: () => {}, subscribe: () => () => {} }, undo() {}, redo() {}, canUndo: () => false, canRedo: () => false, name: '' };
  return draft.current;
}

/** The group a set of rows sits in: a titled section, as the generated inspector draws one. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="w2-group" aria-label={title}><h3 className="w2-group-title">{title}</h3>{children}</section>;
}
/**
 * Inside a template each leaf row stands for one field, and the panel's `own` gives it the line "Set Per Place" and, while fields are chosen, a box
 * under Choose Fields (the rows the generated inspector draws get both). `depth` is the length of the node's path, so a row names its field below the node.
 */
export type OwnRow = (field: string, row: ReactNode) => ReactNode;
const OwnContext = createContext<{ own: OwnRow; depth: number } | undefined>(undefined);
/** One leaf row, routed through `own` for the field at `path` when the node is in a template; the row as it is otherwise. */
function Mine({ path, children }: { path: EditorPath; children: ReactNode }) {
  const mine = useContext(OwnContext);
  return <>{mine ? mine.own(path.slice(mine.depth).join('/'), children) : children}</>;
}
const Row = ({ children, field }: { children: ReactNode; field?: string }) => <div className="w2-row" data-field-path={field}>{children}</div>;

/** A number the person types, or a value they pick ("Use a Value…"): Home Assistant's number, read as a number. */
function NumberValueRow({ path, label, scope, step = 0.01, min = -100000, max = 100000, onRemove }: { path: EditorPath; label: string; /** The stopper it belongs to, so the button's name is its own. */ scope?: string; step?: number; min?: number; max?: number; onRemove?: () => void }) {
  const { document, onChange } = useRows();
  const draft = useRowsDraft();
  const ctx = useNameContext(document);
  const operand = valueAt(document, path) as Operand | undefined;
  const plain = operand?.type === 'literal' && typeof operand.value === 'number';
  const pick = (picked: { document: CompositionDocument; operand: Operand }) => onChange(replaceAt(picked.document, path, picked.operand.type === 'read' ? { ...picked.operand, as: 'number', missing: 'unavailable' } : picked.operand));
  return <Mine path={path}><div className="w2-row" data-field-path={path.join('/')}>
    {plain
      ? <>
        <NumberField label={label} value={(operand as { value: number }).value} min={min} max={max} step={step} onChange={next => onChange(replaceAt(document, path, literal(next)))}/>
        <ValuePickerRow draft={draft} title={`Use a Value for ${label}${scope ? ` of ${scope}` : ''}`} primary="Use a Value…" groups={['entities', 'counts', 'models', 'settings']} onPick={pick}/>
      </>
      : <>
        <ValuePickerRow draft={draft} title={`${label}${scope ? ` of ${scope}` : ''}`} label={label} primary={operand ? operandName(operand, ctx) : 'Choose'} groups={['entities', 'counts', 'models', 'settings']} onPick={pick}/>
        <button type="button" className="w2-remove" aria-label={`Use a Number for ${label}${scope ? ` of ${scope}` : ''}`} onClick={() => onChange(replaceAt(document, path, literal(0)))}>Use a Number</button>
      </>}
    {onRemove && <button type="button" className="w2-remove" aria-label={`Remove ${label}${scope ? ` of ${scope}` : ''}`} onClick={onRemove}>Remove</button>}
  </div></Mine>;
}

/** A field the contract's own generator draws (a text, a colour or a rule over colours), under the label this editor gives it. */
function Leaf({ node, path, label, plain }: { node: EditorPath; path: EditorPath; label: string; /** Not a row of its own for Set Per Place: another row of the same field carries it. */ plain?: boolean }) {
  const { document, onChange, onError } = useRows();
  const value = valueAt(document, path) as Json;
  if (value === undefined) return null;
  const row = <div className="w2-row"><CompositionFields schema={schemaAt(document, path)} value={value} path={path} label={label} document={document} onChange={onChange} onError={onError} options={fieldOptions('dial-control', node)}/></div>;
  return plain ? row : <Mine path={path}>{row}</Mine>;
}
/** An optional field: a row that adds it with `initial`, or draws it with Remove. */
function Optional({ path, label, initial, children }: { path: EditorPath; label: string; initial: Json; children: ReactNode }) {
  const { document, onChange } = useRows();
  const here = valueAt(document, path);
  if (here === undefined) return <Row><button type="button" className="w2-add-row" data-field-path={path.join('/')} aria-label={`Add ${label}`} onClick={() => onChange(replaceAt(document, path, initial))}>
    <span className="w2-row-label">{label}</span><span className="w2-summary">None</span></button></Row>;
  const remove = () => { const owner = valueAt(document, path.slice(0, -1)) as Obj; const { [String(path.at(-1))]: _gone, ...rest } = owner; void _gone; onChange(replaceAt(document, path.slice(0, -1), rest)); };
  return <>{children}<button type="button" className="w2-remove" aria-label={`Remove ${label}`} onClick={remove}>Remove</button></>;
}

// MARK: Start From

/** What Start From says for a dial control now, by what it holds. */
function startOf(node: DialNodeShape): DialStart {
  const stoppers = stoppersOf(node);
  return stoppers.length === 2 ? 'range' : isObject(stoppers[0]) && stoppers[0].trail === 'from-start' ? 'one' : 'blank';
}
function StartFrom({ path, current }: { path: EditorPath; current: DialStart }) {
  const { document, onChange } = useRows();
  // Thermostat on a Dial Control asks which thermostat, unless this node was one a moment ago: nothing is bound silently.
  const [asking, setAsking] = useState(false);
  const node = () => valueAt(document, path) as unknown as DialNodeShape;
  const pick = (to: string) => {
    if (to === 'thermostat') {
      const back = recallThermostat(node().id, document.dataSources as never);
      if (back) { setAsking(false); onChange(replaceAt(document, path, back as never)); } else setAsking(true);
      return;
    }
    setAsking(false);
    if (current === 'thermostat') {
      rememberThermostat(node(), document.dataSources as never);
      const range = fromThermostat(node() as never) as unknown as DialNodeShape;
      onChange(replaceAt(document, path, (to === 'range' ? range : restart(range, to as Exclude<DialStart, 'thermostat'>)) as never));
    } else onChange(replaceAt(document, path, restart(node(), to as Exclude<DialStart, 'thermostat'>) as never));
  };
  const choose = (entityId: string) => {
    const made = thermostatFor(document, { id: node().id, title: node().title, layout: node().layout }, entityId);
    setAsking(false);
    onChange(replaceAt({ ...document, dataSources: made.dataSources } as unknown as CompositionDocument, path, made.node as never));
  };
  return <Group title="Start From">
    <Row><span className="w2-row-label">Preset</span><SelectMenu label="Preset" value={asking ? 'thermostat' : current} options={[...dialStarts]} onChange={pick}/></Row>
    {asking && <Row><EntityField label="Choose a Thermostat" domains={['climate']} onPick={row => choose(row.entityId)}/></Row>}
  </Group>;
}

// MARK: One stopper

/** The one-line summary of a stopper's value: where it reads from, or its number. */
function useSummary() {
  const { document } = useRows();
  const ctx = useNameContext(document);
  return (operand: Operand | undefined) => (operand ? operandName(operand, ctx) : 'No value');
}
function StopperRow({ node, path, count, itemName, form }: { node: EditorPath; path: EditorPath; count: number; itemName: string; form: CallForm }) {
  const { document, onChange } = useRows();
  const summary = useSummary();
  const stopper = valueAt(document, path) as Obj;
  const at = (...rel: (string | number)[]) => [...path, ...rel];
  const set = (next: Obj) => onChange(replaceAt(document, path, next));
  const sides = isObject(stopper.limit) ? stopper.limit : undefined;
  const setSide = (side: 'min' | 'max', value: Json | undefined) => {
    const limit: Obj = { ...(sides ?? {}) };
    if (value === undefined) delete limit[side]; else limit[side] = value;
    const { limit: _old, ...rest } = stopper; void _old;
    set(Object.keys(limit).length ? { ...rest, limit } : rest);
  };
  const trail = typeof stopper.trail === 'string' ? stopper.trail : 'none';
  const name = (isObject(stopper.label) && typeof stopper.label.value === 'string' ? stopper.label.value : String(stopper.id));
  const swatch = <span className="w2-dial-swatch" aria-hidden style={{ background: swatchColor(stopper.ink) }}/>;
  const body = <>
    <NumberValueRow path={at('value')} label="Value" scope={name}/>
    <Leaf node={node} path={at('label')} label="Name for VoiceOver"/>
    <Mine path={at('spokenValue')}><Row><TextField label="Spoken As" value={typeof stopper.spokenValue === 'string' ? stopper.spokenValue : ''} placeholder="{value} degrees"
      onChange={text => { const { spokenValue: _drop, ...rest } = stopper; void _drop; set(text ? { ...rest, spokenValue: text } : rest); }}/></Row></Mine>
    <Leaf node={node} path={at('ink')} label="Color"/>
    <Mine path={at('trail')}><Row><SelectMenu label="Trail" value={trail} options={[{ value: 'none', label: 'None' }, { value: 'from-start', label: 'From the Start' }, { value: 'to-end', label: 'To the End' }]}
      onChange={next => { const { trail: _t, trailInk: _i, ...rest } = stopper; void _t; void _i; set(next === 'none' ? rest : { ...rest, trail: next, trailInk: stopper.trailInk ?? stopper.ink }); }}/></Row></Mine>
    {trail !== 'none' && <Leaf node={node} path={at('trailInk')} label="Trail Color"/>}
    {sides?.min === undefined
      ? <Mine path={at('limit', 'min')}><Row><button type="button" className="w2-add-row" aria-label="Add Lowest" onClick={() => setSide('min', literal(0))}><span className="w2-row-label">Lowest</span><span className="w2-summary">None</span></button></Row></Mine>
      : <NumberValueRow path={at('limit', 'min')} label="Lowest" scope={name} onRemove={() => setSide('min', undefined)}/>}
    {sides?.max === undefined
      ? <Mine path={at('limit', 'max')}><Row><button type="button" className="w2-add-row" aria-label="Add Highest" onClick={() => setSide('max', literal(100))}><span className="w2-row-label">Highest</span><span className="w2-summary">None</span></button></Row></Mine>
      : <NumberValueRow path={at('limit', 'max')} label="Highest" scope={name} onRemove={() => setSide('max', undefined)}/>}
    {form === 'stopper' && <Mine path={at('action')}><ActionRow label="When Released" path={at('action')} schema={schemaAt(document, at('action'))} optional={false} itemName={itemName}/></Mine>}
    {count > 1 && <button type="button" className="w2-remove" aria-label={`Remove Stopper ${name}`} onClick={() => {
      const owner = valueAt(document, node) as DialNodeShape;
      const next = removeStopper(owner as never, String(stopper.id)) as unknown as Obj | null;
      if (next) onChange(replaceAt(document, node, next));
    }}>Remove Stopper</button>}
  </>;
  return <Disclosure label={name} lead={swatch} summary={`${summary(stopper.value as Operand | undefined)}`} path={path.join('/')}>
    <div className="w2-dial-stopper">{body}</div>
  </Disclosure>;
}
/** The swatch's colour: the light side of a pair, a fixed ink, or none for a rule. */
function swatchColor(ink: Json | undefined): string {
  const one = isObject(ink) && ink.type === 'solid-appearance' && isObject(ink.light) ? ink.light : ink;
  return isObject(one) && typeof one.red === 'number' ? `rgb(${one.red} ${one.green} ${one.blue})` : 'transparent';
}

// MARK: The dial control

/**
 * The Dial Control's inspector (`build/design/studio-dial/proposal.md`, section 4): Start From, Range, Stoppers, Between Stoppers (two only), When Released,
 * Reading, Bands and Ticks, Middle and States. It draws the structure and the words; the leaves (texts, colours, calls, conditions) are the Studio's own
 * fields. The word is **stopper**, never "operand", "predicate" or "handle id".
 */
export function DialControlInspector({ path, own }: { path: EditorPath; /** In a template: gives a row its Set Per Place line and its Choose Fields box (the panel's `own`). */ own?: OwnRow }) {
  const { document, onChange } = useRows();
  const node = valueAt(document, path) as unknown as DialNodeShape | undefined;
  if (!node) return null;
  const props = node.props as Obj;
  const at = (...rel: (string | number)[]): EditorPath => [...path, ...rel];
  const stoppers = stoppersOf(node);
  const form = callFormOf(node as never);
  const apply = (next: unknown) => { if (next) onChange(replaceAt(document, path, next as never)); };
  const range = props.range as { min: number; max: number; step: number };
  const setRange = (key: 'min' | 'max' | 'step', value: number) => onChange(replaceAt(document, at('props', 'range'), { ...range, [key]: value }));
  const reading = isObject(props.reading) ? props.reading : undefined;
  const center = props.center as Obj, shows = (center.value as Obj).shows as string;
  const caption = center.caption === undefined ? 'none' : center.caption === 'stoppers' ? 'stoppers' : 'text';
  const ticks = isObject(props.ticks) ? props.ticks : undefined;
  const bands = Array.isArray(props.bands) ? props.bands : [];
  const setCenter = (next: Obj) => onChange(replaceAt(document, at('props', 'center'), next));
  const label = (stopper: Obj) => (isObject(stopper.label) && typeof stopper.label.value === 'string' ? stopper.label.value : String(stopper.id));
  const mine = (...rel: (string | number)[]) => (row: ReactNode) => <Mine path={at(...rel)}>{row}</Mine>;
  return <OwnContext.Provider value={own ? { own, depth: path.length } : undefined}>
    <StartFrom path={path} current={startOf(node)}/>
    <Group title="Range">
      {mine('props', 'range', 'min')(<Row><NumberField label="Lowest" value={range.min} min={-100000} max={100000} step={0.01} onChange={value => setRange('min', value)}/></Row>)}
      {mine('props', 'range', 'max')(<Row><NumberField label="Highest" value={range.max} min={-100000} max={100000} step={0.01} onChange={value => setRange('max', value)}/></Row>)}
      {mine('props', 'range', 'step')(<Row><NumberField label="Step" value={range.step} min={0.01} max={100000} step={0.01} onChange={value => setRange('step', value)}/></Row>)}
      {mine('props', 'size')(<ChoiceRow label="Size" value={String(props.size)} options={[{ value: 'page', label: 'Page' }, { value: 'modal', label: 'Sheet' }, { value: 'compact', label: 'Compact' }]} onChange={value => onChange(replaceAt(document, at('props', 'size'), value))}/>)}
    </Group>
    <Group title="Stoppers">
      {stoppers.map((_, index) => <StopperRow key={String(stoppers[index].id)} node={path} path={at('props', 'stoppers', index)} count={stoppers.length} itemName={node.title} form={form}/>)}
      {stoppers.length < 2 && <button type="button" className="add-button" onClick={() => apply(addStopper(node as never))}>Add Stopper</button>}
    </Group>
    {stoppers.length === 2 && <Group title="Between Stoppers">
      {mine('props', 'between')(<Row><span className="w2-row-label">Rule</span><SelectMenu label="Rule" value={betweenOf(node as never)} options={[...betweenChoices]} onChange={next => apply(withBetween(node as never, next as BetweenChoice))}/></Row>)}
      {betweenOf(node as never) === 'apart' && <NumberValueRow path={at('props', 'between', 'gap')} label="Gap" step={0.01} min={0}/>}
      {betweenOf(node as never) === 'apart' && <p className="w2-caption">A stopper stops this far from the other. Reported values that are closer are drawn as they are.</p>}
    </Group>}
    <Group title="When Released">
      <Row><span className="w2-row-label">Sends</span><SelectMenu label="Sends" value={form} options={[...callForms]} onChange={next => apply(withCallForm(node as never, next as CallForm))}/></Row>
      {form === 'dial' && mine('action')(<ActionRow label="Call" path={at('action')} schema={schemaAt(document, at('action'))} optional={false} itemName={node.title}/>)}
    </Group>
    <Group title="Reading, Bands, Ticks">
      <Optional path={at('props', 'reading')} label="Reading" initial={{ value: literal(Math.round((range.min + range.max) / 2)), ink: { type: 'solid-rgb', red: 255, green: 255, blue: 255 } }}>
        <NumberValueRow path={at('props', 'reading', 'value')} label="Reading"/>
        {reading && <Leaf node={path} path={at('props', 'reading', 'ink')} label="Reading Color"/>}
      </Optional>
      {bands.map((band, index) => <Disclosure key={index} label={`Band ${index + 1}`} summary={isObject(band) ? `${band.from} to ${band.to}` : ''} path={at('props', 'bands', index).join('/')}>
        {mine('props', 'bands', index, 'from')(<Row><NumberField label="From" value={Number((band as Obj).from)} min={range.min} max={range.max} step={range.step} onChange={value => onChange(replaceAt(document, at('props', 'bands', index, 'from'), value))}/></Row>)}
        {mine('props', 'bands', index, 'to')(<Row><NumberField label="To" value={Number((band as Obj).to)} min={range.min} max={range.max} step={range.step} onChange={value => onChange(replaceAt(document, at('props', 'bands', index, 'to'), value))}/></Row>)}
        <Leaf node={path} path={at('props', 'bands', index, 'ink')} label="Color"/>
        <button type="button" className="w2-remove" aria-label={`Remove Band ${index + 1}`} onClick={() => onChange(replaceAt(document, at('props', 'bands'), bands.filter((_, i) => i !== index)))}>Remove</button>
      </Disclosure>)}
      {bands.length < 4 && <button type="button" className="add-button" onClick={() => onChange(replaceAt(document, at('props', 'bands'), [...bands, { from: range.min, to: Math.min(range.max, range.min + (range.max - range.min) / 4), ink: { type: 'solid-rgb', red: 142, green: 142, blue: 147 } }]))}>Add Band</button>}
      {mine('props', 'ticks')(<Row><span className="w2-row-label">Ticks</span><SelectMenu label="Ticks" value={ticks ? 'every' : 'off'} options={[{ value: 'off', label: 'Off' }, { value: 'every', label: 'Every' }]}
        onChange={next => { const { ticks: _gone, ...rest } = props; void _gone; onChange(replaceAt(document, at('props'), next === 'off' ? rest : { ...rest, ticks: { every: Math.max(range.step, (range.max - range.min) / 10) } })); }}/></Row>)}
      {ticks && mine('props', 'ticks', 'every')(<Row><NumberField label="Every" value={Number(ticks.every)} min={0.01} max={100000} step={0.01} onChange={value => onChange(replaceAt(document, at('props', 'ticks'), { every: value }))}/></Row>)}
      {ticks && <p className="w2-caption">In value units. At most 60 dots.</p>}
    </Group>
    <Group title="Middle">
      <Optional path={at('props', 'center', 'top')} label="Top Line" initial={literal('')}><Leaf node={path} path={at('props', 'center', 'top')} label="Top Line"/></Optional>
      {mine('props', 'center', 'value', 'shows')(<Row><span className="w2-row-label">Large Value</span><SelectMenu label="Large Value" value={shows} options={[...(reading ? [{ value: 'reading', label: 'Reading' }] : []), ...stoppers.map(stopper => ({ value: String(stopper.id), label: label(stopper) }))]}
        onChange={next => setCenter({ ...center, value: { ...(center.value as Obj), shows: next } })}/></Row>)}
      {mine('props', 'center', 'value', 'unit')(<Row><TextField label="Unit" value={String((center.value as Obj).unit ?? '')} maxLength={8} onChange={text => setCenter({ ...center, value: { ...(center.value as Obj), unit: text } })}/></Row>)}
      {mine('props', 'center', 'value', 'fractionDigits')(<Row><NumberField label="Decimals" value={Number((center.value as Obj).fractionDigits)} min={0} max={2} step={1} onChange={value => setCenter({ ...center, value: { ...(center.value as Obj), fractionDigits: value } })}/></Row>)}
      {mine('props', 'center', 'caption')(<Row><span className="w2-row-label">Caption</span><SelectMenu label="Caption" value={caption} options={[{ value: 'stoppers', label: 'Stopper Values' }, { value: 'text', label: 'Text' }, { value: 'none', label: 'None' }]}
        onChange={next => { const { caption: _gone, ...rest } = center; void _gone; setCenter(next === 'none' ? rest : { ...rest, caption: next === 'stoppers' ? 'stoppers' : literal('') }); }}/></Row>)}
      {caption === 'text' && <Leaf node={path} path={at('props', 'center', 'caption')} label="Caption Text" plain/>}
    </Group>
    <Group title="States">
      {mine('props', 'dimmedWhen')(<ConditionField label="Dimmed When" title="Dimmed When" path={at('props', 'dimmedWhen')} place="active" none="Never" itemName={node.title}/>)}
      {mine('enabledWhen', 'condition')(<ConditionField label="Enabled When" title="Enabled When" path={at('enabledWhen', 'condition')} place="enable" policy="enable" itemName={node.title}/>)}
      {mine('props', 'unavailableText')(<Row><TextField label="Unavailable Text" value={String(props.unavailableText ?? '')} onChange={text => onChange(replaceAt(document, at('props', 'unavailableText'), text))}/></Row>)}
      {mine('props', 'failureText')(<Row><TextField label="Failure Text" value={String(props.failureText ?? '')} onChange={text => onChange(replaceAt(document, at('props', 'failureText'), text))}/></Row>)}
      <p className="w2-caption">{'{value} is the number that was refused.'}</p>
    </Group>
  </OwnContext.Provider>;
}

// MARK: The Thermostat view

/**
 * A thermostat dial (`climate-control` kind `dial`) shown as a Dial Control whose Start From is Thermostat. Only `props.dial` is editable here (the range, the
 * unit and the size), so the node publishes exactly as it did; every row the `climate@1` model owns says "Set by the thermostat".
 */
export function ThermostatInspector({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const node = valueAt(document, path) as unknown as DialNodeShape;
  if (!node || !isThermostatDial(node as never)) return null;
  const view = thermostatView(node as never);
  const source = document.dataSources.find(item => item.id === view.sourceId) as { inputs?: { entityId?: string } } | undefined;
  const write = (change: Parameters<typeof withThermostatView>[1]) => onChange(replaceAt(document, path, withThermostatView(node as never, change) as never));
  const dialField = (key: string) => [...path, 'props', 'dial', key].join('/');
  const locked = (label: string, line: string) => <Row><span className="w2-row-label">{label}</span><span className="w2-summary">{line}</span></Row>;
  return <>
    <StartFrom path={path} current="thermostat"/>
    <Group title="Thermostat">
      <Row><EntityField label="Thermostat" entityId={source?.inputs?.entityId} domains={['climate']} onPick={row => {
        // This node's binding only: a source another node reads is forked, and the rest of its entity list stays.
        const rebound = rebindThermostat(document as never, path, node as never, row.entityId);
        const moved = replaceAt({ ...document, dataSources: rebound.dataSources } as unknown as CompositionDocument, [...path, 'props', 'sourceId'], rebound.sourceId);
        onChange(moved);
      }}/></Row>
    </Group>
    <Group title="Range">
      <Row field={dialField('minimum')}><NumberField label="Lowest" value={view.minimum} min={-100} max={200} step={0.5} onChange={value => write({ minimum: value })}/></Row>
      <Row field={dialField('maximum')}><NumberField label="Highest" value={view.maximum} min={-100} max={200} step={0.5} onChange={value => write({ maximum: value })}/></Row>
      <Row field={dialField('step')}><NumberField label="Step" value={view.step} min={0.01} max={10} step={0.01} onChange={value => write({ step: value })}/></Row>
      <div data-field-path={dialField('unit')}><ChoiceRow label="Unit" value={view.unit} options={[{ value: '°F', label: '°F' }, { value: '°C', label: '°C' }]} onChange={value => write({ unit: value as '°F' | '°C' })}/></div>
      <div data-field-path={dialField('size')}><ChoiceRow label="Size" value={view.size} options={[{ value: 'page', label: 'Page' }, { value: 'modal', label: 'Sheet' }, { value: 'compact', label: 'Compact' }]} onChange={value => write({ size: value as ThermostatSize })}/></div>
    </Group>
    <Group title="Stoppers">{locked('Heat to and Cool to', 'Set by the thermostat')}</Group>
    <Group title="Between Stoppers">{locked('Rule', 'Set by the thermostat')}</Group>
    <Group title="When Released">{locked('Sends', 'Set by the thermostat')}</Group>
    <Group title="Middle">{locked('Large Value', 'Set by the thermostat')}</Group>
  </>;
}
type ThermostatSize = 'page' | 'modal' | 'compact';
