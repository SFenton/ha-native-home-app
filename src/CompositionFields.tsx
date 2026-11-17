import type { CompositionDocument } from './shared/composition/schema';
import type { Json } from './shared/types';
import { changeFieldVariant, defaultField, fieldVariants, removeCompositionItem, reorderCompositionItem, replaceAt, resolveField, selectedVariant, valueAt, variantName, type EditorPath, type SchemaField } from './composition-editor';
import { Field, NumberField, SelectField, TextField } from './ui';
import { useContext, useState, type ReactElement } from 'react';
import { Rows } from './workspace2/rowsContext';
import { CallServiceEditor, OperandEditor, PredicateBuilder } from './GrammarEditors';
import { Disclosure } from './workspace2/Disclosure';
import { ChoiceRow } from './workspace2/SegmentRow';
import { sourceName } from './workspace2/dialogs/sources';
import ColorPairField, { type ColorPairValue } from './workspace2/pickers/ColorPairField';
import InkField, { type InkValue } from './workspace2/pickers/InkField';

/**
 * Opt-in behaviour for the workspace. Without it the form renders its plain default: generated labels, "Include"
 * checkboxes and fixed values listed.
 */
export type FieldOptions = {
  /** The authored label for a field, or undefined for the mechanical one. */
  label?: (path: EditorPath, key: string) => string | undefined;
  /** The words for a choice value (an enum member). */
  valueLabel?: (path: EditorPath, value: string) => string | undefined;
  /** The words for a union variant in its type picker. */
  variantLabel?: (path: EditorPath, name: string) => string | undefined;
  /** Never show a field whose schema allows one value; an optional field becomes an "Add" row instead of a checkbox. */
  rows?: boolean;
  /** Mark every leaf control with `data-field-path`, so a test can find each field. */
  fieldPath?: boolean;
  /** The words on an array's add button, when it is not "Add <label>". */
  addLabel?: (path: EditorPath) => string | undefined;
  /** A custom control for a text field the generator would draw as a plain input (an icon name gets the icon picker). */
  control?: (path: EditorPath, value: string, label: string, set: (next: string) => void) => ReactElement | undefined;
  /** A value slot (a text that may be built from entities, a color or icon that may follow rules): the workspace draws it with its value field. */
  slot?: (path: EditorPath, schema: SchemaField, label: string) => ReactElement | undefined;
  /** A part that is edited elsewhere (child nodes). */
  skip?: (path: EditorPath) => boolean;
};
type Props = {
  schema: SchemaField; value: Json; path: EditorPath; label: string; document: CompositionDocument;
  onChange: (document: CompositionDocument, group?: string) => void; onError: (message: string) => void; options?: FieldOptions;
  /** Rows mode only: this is a part inside another, so it names itself with a group title. */
  nested?: boolean;
};

/**
 * What the workspace draws instead of a fieldset: a labelled group whose parts are rows, with a title only when it sits inside
 * another part (the row that opened it already carries the name).
 */
function Group({ label, nested, children }: { label: string; nested?: boolean; children: React.ReactNode }) {
  return <div className="w2-subform" role={label ? 'group' : undefined} aria-label={label || undefined}>{nested && label && <h4 className="w2-group-title">{label}</h4>}{children}</div>;
}
export const nameOf = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, letter => letter.toUpperCase());
/** The choices a reference field offers. With `plain` (the workspace's rows) they carry names only; the ids stay under Advanced and About. */
const relationship = (key: string, document: CompositionDocument, plain = false) => {
  const named = (title: string, id: string) => plain ? title : `${title} (${id})`;
  if (key === 'pageId' || key === 'initialPageId') return document.pages.map(item => ({ value: item.id, label: named(item.title, item.id) }));
  if (key === 'modalId') return document.modals.map(item => ({ value: item.id, label: named(item.title, item.id) }));
  if (key === 'tabId' || key === 'initialTabId') return document.navigation.tabs.map(item => ({ value: item.id, label: named(item.label, item.id) }));
  if (key === 'sourceId') return document.dataSources.map(item => ({ value: item.id, label: plain ? `${sourceName(item)} · ${item.id}` : `${item.id} (${item.kind})` }));
  if (key === 'assetId') return document.assets.map(item => ({ value: item.id, label: item.id }));
  if (key === 'stateId') return (document.localState ?? []).map(item => ({ value: item.id, label: item.id }));
};

const fieldKey = (path: EditorPath) => path.at(-2) === 'subtitleSourceIds' ? 'sourceId' : String(path.at(-1) ?? '');
/** Which dedicated editor, if any, takes over the object at `path`: the service-call, predicate or operand editor. */
export function specialEditor(document: CompositionDocument, path: EditorPath, value: Json): 'call-service' | 'predicate' | 'operand' | undefined {
  const object = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json> : undefined;
  if (!object) return undefined;
  if (object.type === 'call-service') return 'call-service';
  if (['visibleWhen', 'selectedWhen', 'isOn'].includes(fieldKey(path)) && typeof object.type === 'string') return 'predicate';
  if (fieldKey(path) === 'value' && typeof object.type === 'string' && valueAt(document, path.slice(0, -2)) && (valueAt(document, path.slice(0, -2)) as Record<string, Json>).type === 'bound-control') return 'operand';
  return undefined;
}

/** The choices a reference field offers (pages, sheets, tabs, sources, assets, local states), or undefined for any other field. */
export function relationOptions(document: CompositionDocument, path: EditorPath): { value: string; label: string }[] | undefined { return relationInfo(document, path).relations; }
function relationInfo(document: CompositionDocument, path: EditorPath, plain = false) {
  const key = fieldKey(path);
  const container = path.at(-3) === 'tabs' ? valueAt(document, path.slice(0, -3)) : undefined;
  const localStateId = container && typeof container === 'object' && 'type' in container && container.type === 'local-tabs'
    && 'props' in container && container.props && typeof container.props === 'object' && 'stateId' in container.props
    ? container.props.stateId : undefined;
  const tabField = document.localState?.find(field => field.id === localStateId);
  const tabOptions = key === 'id' && tabField?.type === 'choice' ? tabField.options : undefined;
  return { tabOptions, relations: tabOptions?.map(option => ({ value: option.id, label: option.label })) ?? relationship(key, document, plain) };
}

/** The closed contract supplies fields and variants; references remain explicit relationship selectors. */
export default function CompositionFields(props: Props) {
  const { value, path, label, document, onChange, onError, options } = props;
  const problem = useContext(Rows)?.problems?.get(path.join('/'));
  const leaf = (element: ReactElement) => options?.fieldPath ? <div className="field-leaf" data-field-path={path.join('/')}>{element}{problem && <p className="w2-error-text w2-field-problem" data-field-problem={path.join('/')}>{problem}</p>}</div> : element;
  const schema = resolveField(props.schema), key = fieldKey(path);
  const set = (next: Json) => onChange(replaceAt(document, path, next));
  const run = (operation: () => CompositionDocument) => {
    try { onChange(operation()); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const object = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json> : undefined;
  const slotted = object && schema.xValue ? options?.slot?.(path, schema, label) : undefined;
  if (slotted) return leaf(slotted);
  if (object?.type === 'call-service') {
    const control = path.some((_, depth) => {
      const owner = valueAt(document, path.slice(0, depth)) as Record<string, Json> | undefined;
      return owner?.type === 'bound-control' && (owner.props as Record<string, Json>).kind !== 'button';
    });
    return leaf(<CallServiceEditor label={label} value={object} document={document} allowControl={control} onChange={set}/>);
  }
  if (object && ['visibleWhen', 'selectedWhen', 'isOn'].includes(key) && typeof object.type === 'string') return leaf(<PredicateBuilder label={label} value={object} document={document} onChange={set}/>);
  if (object && key === 'value' && typeof object.type === 'string' && valueAt(document, path.slice(0, -2)) && (valueAt(document, path.slice(0, -2)) as Record<string, Json>).type === 'bound-control')
    return leaf(<OperandEditor label={label} value={object} document={document} onChange={set}/>);
  const variants = fieldVariants(schema);
  // An ink (`sh.text-style@1`) is a colour with an opacity, and a pair of those: the colour picker, an Opacity and the dark mode switch.
  if (options?.rows && object && (object.type === 'solid-rgb' || object.type === 'rgba' || object.type === 'solid-appearance') && variants.some(variant => variantName(variant) === 'rgba')) {
    const group = `color:${path.join('/')}`;
    return leaf(<InkField label={label} path={path.join('/')} value={object as unknown as InkValue} allowPair onChange={(next, live) => onChange(replaceAt(document, path, next), live ? group : undefined)}/>);
  }
  // A free color is one control wherever the contract holds a `solid-rgb` fill (and the standard fill beside it, where it is allowed).
  if (options?.rows && object && (object.type === 'solid-rgb' || object.type === 'standard' || object.type === 'solid-appearance') && variants.some(variant => variantName(variant) === 'solid-rgb')) {
    const group = `color:${path.join('/')}`;
    return leaf(<ColorPairField label={label} path={path.join('/')} value={object as unknown as ColorPairValue} allowStandard={variants.some(variant => variantName(variant) === 'standard')}
      allowPair={variants.some(variant => variantName(variant) === 'solid-appearance')}
      onChange={(next, live) => onChange(replaceAt(document, path, next), live ? group : undefined)}/>);
  }
  const { relations, tabOptions } = relationInfo(document, path, options?.rows);
  if (relations) {
    const nullable = key === 'initialTabId';
    const choose = options?.rows ? { pageId: 'Choose a page', initialPageId: 'Choose a page', modalId: 'Choose a sheet', tabId: 'Choose a tab', sourceId: 'Choose a source', assetId: 'Choose an image', stateId: 'Choose a state' }[key] : undefined;
    const selectOptions = [...(nullable ? [{ value: '', label: 'No selected tab' }] : [{ value: '', label: choose ?? 'Select a destination' }]), ...relations];
    return leaf(<SelectField label={label} value={value === null ? '' : String(value)} options={selectOptions} onChange={next => {
      let updated = replaceAt(document, path, nullable && !next ? null : next);
      if (tabOptions) updated = replaceAt(updated, [...path.slice(0, -1), 'label'], tabOptions.find(option => option.id === next)?.label ?? '');
      if (key === 'initialTabId' && next) updated.navigation.initialPageId = document.navigation.tabs.find(tab => tab.id === next)!.pageId;
      onChange(updated);
    }}/>);
  }
  if (variants.length > 1) {
    const selected = selectedVariant(schema, value), index = variants.indexOf(selected);
    if (options?.rows) return <Group label="">
      <ChoiceRow label={label} value={String(index)} options={variants.map((variant, i) => ({ value: String(i), label: options.variantLabel?.(path, variantName(variant)) ?? variantName(variant) }))}
        onChange={choice => set(changeFieldVariant(variants[Number(choice)], value, document, key))}/>
      <CompositionFields {...props} schema={selected} nested={false}/>
    </Group>;
    return <fieldset className="composition-fieldset"><legend>{label}</legend>
      <SelectField label={`${label} type`} value={String(index)} options={variants.map((variant, i) => ({ value: String(i), label: options?.variantLabel?.(path, variantName(variant)) ?? variantName(variant) }))}
        onChange={choice => set(changeFieldVariant(variants[Number(choice)], value, document, key))}/>
      <CompositionFields {...props} schema={selected}/>
    </fieldset>;
  }
  if (options?.rows && (schema.const !== undefined || schema.enum?.length === 1)) return null;
  if (schema.const !== undefined) return <div className="composition-policy"><span>{label}</span><code>{String(schema.const)}</code></div>;
  if (schema.enum) {
    const choices = schema.enum.map(item => ({ value: String(item), label: options?.valueLabel?.(path, String(item)) ?? String(item) }));
    return leaf(options?.rows ? <ChoiceRow label={label} value={String(value)} options={choices} onChange={set}/> : <SelectField label={label} value={String(value)} options={choices} onChange={set}/>);
  }
  if (schema.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = Object.entries(schema.properties ?? {});
    if (!properties.length && typeof schema.additionalProperties === 'object') {
      return <DictionaryFields {...props} schema={schema} itemSchema={schema.additionalProperties} value={value}/>;
    }
    if (!properties.length) return null;
    const editable = properties.filter(([name, child]) => child.const === undefined && !options?.skip?.([...path, name])
      && !(options?.rows && resolveField(child).enum?.length === 1));
    const members = <>
      {editable.map(([name, child]) => {
        const required = schema.required?.includes(name), present = Object.hasOwn(value, name);
        const childLabel = options?.label?.([...path, name], name) ?? nameOf(name);
        const toggle = (on: boolean) => {
          const next = structuredClone(value);
          if (on) next[name] = defaultField(child, document, name);
          else delete next[name];
          set(next);
        };
        return <div key={name}>
          {!required && !options?.rows && <label className="checkbox-field"><input type="checkbox" checked={present} onChange={event => toggle(event.target.checked)}/>{`Include ${nameOf(name)}`}</label>}
          {!required && options?.rows && !present && <div className="add-row" data-field-path={[...path, name].join('/')}><span>{childLabel}</span><button type="button" onClick={() => toggle(true)}>{`Add ${childLabel}`}</button></div>}
          {!required && options?.rows && present && <div className="remove-row"><button type="button" onClick={() => toggle(false)}>{`Remove ${childLabel}`}</button></div>}
          {(required || present) && <CompositionFields {...props} schema={child} label={childLabel} value={value[name] ?? null} path={[...path, name]} nested/>}
        </div>;
      })}
    </>;
    return options?.rows ? <Group label={label} nested={props.nested}>{members}</Group> : <fieldset className="composition-fieldset"><legend>{label}</legend>{members}</fieldset>;
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    const tuple = Array.isArray(schema.items) ? schema.items : undefined;
    const itemSchema: SchemaField = Array.isArray(schema.items) ? {} : schema.items ?? {};
    const maximum = schema.maxItems ?? 100;
    const summaryOf = (item: Json, index: number) => item !== null && typeof item === 'object' && !Array.isArray(item) ? String(item.title ?? item.label ?? item.id ?? item.type ?? `Item ${index + 1}`) : `Item ${index + 1}`;
    const keyOf = (item: Json, index: number) => item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string' ? item.id : index;
    const controls = (summary: string, index: number) => !tuple && <div className="composition-actions">
      <button type="button" aria-label={`Move ${summary} up`} disabled={index === 0} onClick={() => run(() => reorderCompositionItem(document, path, index, -1))}>Up</button>
      <button type="button" aria-label={`Move ${summary} down`} disabled={index === value.length - 1} onClick={() => run(() => reorderCompositionItem(document, path, index, 1))}>Down</button>
      <button type="button" aria-label={`Delete ${summary}`} onClick={() => run(() => removeCompositionItem(document, path, index))}>Delete</button>
    </div>;
    const add = !tuple && maximum > 0 && <button type="button" className="add-button" disabled={value.length >= maximum}
      onClick={() => set([...value, defaultField(itemSchema, document)])}>{options?.rows ? options.addLabel?.(path) ?? `Add ${label}` : `Add ${label.toLowerCase()} item`}</button>;
    if (options?.rows) return <Group label={label} nested={props.nested}>
      {value.map((item, index) => {
        if (options.skip?.([...path, index])) return null;
        const summary = summaryOf(item, index);
        return <Disclosure key={keyOf(item, index)} label={`${index + 1}. ${summary}`} defaultOpen={value.length === 1} path={[...path, index].join('/')}>
          {controls(summary, index)}
          <CompositionFields {...props} schema={tuple?.[index] ?? itemSchema} label={summary} value={item} path={[...path, index]} nested={false}/>
        </Disclosure>;
      })}
      {add}
    </Group>;
    return <fieldset className="composition-fieldset"><legend>{label} ({value.length})</legend>
      {value.map((item, index) => {
        const summary = summaryOf(item, index);
        if (options?.skip?.([...path, index])) return null;
        return <details className="composition-item" key={keyOf(item, index)} open={value.length === 1}>
          <summary>{index + 1}. {summary}</summary>
          {controls(summary, index)}
          <CompositionFields {...props} schema={tuple?.[index] ?? itemSchema} label={summary} value={item} path={[...path, index]}/>
        </details>;
      })}
      {add}
      {maximum === 0 && <p className="field-note">Not supported.</p>}
    </fieldset>;
  }
  if (schema.type === 'boolean') return leaf(<label className="checkbox-field"><input type="checkbox" role={options?.rows ? 'switch' : undefined} checked={Boolean(value)} onChange={event => set(event.target.checked)}/><span>{label}</span></label>);
  if (schema.type === 'number' || schema.type === 'integer') return leaf(<NumberField label={label} value={Number(value)} min={schema.minimum ?? 0} max={schema.maximum ?? Number.MAX_SAFE_INTEGER} step={schema.type === 'integer' ? 1 : 0.01} onChange={set}/>);
  if (schema.type === 'null') return options?.rows ? null : <p className="field-note">{label}: none</p>;
  if (key === 'id' || key === 'schemaVersion') return leaf(<TextField label={label} value={String(value)} readOnly onChange={() => {}} title="IDs cannot be changed."/>);
  if (schema.maxLength && schema.maxLength > 1000) return leaf(<Field label={label}><textarea value={String(value ?? '')} maxLength={schema.maxLength} onChange={event => set(event.target.value)}/></Field>);
  const custom = typeof value === 'string' ? options?.control?.(path, value, label, set) : undefined;
  if (custom) return leaf(custom);
  return leaf(<TextField label={label} value={String(value ?? '')} maxLength={schema.maxLength} onChange={set}/>);
}

/** Stable identity preserves dictionary-key focus while structured descriptors change. */
function DictionaryFields(props: Omit<Props, 'value'> & { itemSchema: SchemaField; value: Record<string, Json> }) {
  const [key, setKey] = useState('');
  const add = () => {
    const names = props.schema.propertyNames;
    if (!key.trim() || ['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(props.value, key)
      || (names?.maxLength !== undefined && key.length > names.maxLength)
      || (names?.pattern && !new RegExp(names.pattern).test(key))) {
      props.onError('Enter a unique valid field name.'); return;
    }
    props.onChange(replaceAt(props.document, props.path, { ...props.value, [key]: defaultField(props.itemSchema, props.document) }));
    setKey('');
  };
  const rows = props.options?.rows;
  const body = <>
    {Object.entries(props.value).map(([name, value]) => <div key={name}>
      <CompositionFields {...props} schema={props.itemSchema} path={[...props.path, name]} label={name} value={value} nested={rows ? true : undefined}/>
      <button type="button" aria-label={`Delete ${name}`} onClick={() => {
        const next = { ...props.value }; delete next[name];
        props.onChange(replaceAt(props.document, props.path, next));
      }}>Delete</button>
    </div>)}
    <TextField label={rows ? 'Field name' : 'New field name'} value={key} onChange={setKey}/>
    <button type="button" onClick={add} disabled={Object.keys(props.value).length >= 64}>{rows ? 'Add Field' : 'Add field'}</button>
  </>;
  return rows ? <Group label={props.label} nested={props.nested}>{body}</Group> : <fieldset className="composition-fieldset"><legend>{props.label}</legend>{body}</fieldset>;
}
