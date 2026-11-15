import type { CompositionDocument } from './shared/composition/schema';
import type { Json } from './shared/types';
import { changeFieldVariant, defaultField, fieldVariants, removeCompositionItem, reorderCompositionItem, replaceAt, resolveField, selectedVariant, valueAt, variantName, type EditorPath, type SchemaField } from './composition-editor';
import { Field, NumberField, SelectField, TextField } from './ui';
import { useState, type ReactElement } from 'react';
import { CallServiceEditor, OperandEditor, PredicateBuilder } from './GrammarEditors';

/**
 * Opt-in behaviour for the 2.0 workspace. Without it the form renders exactly as the 1.0 workspace expects: generated
 * labels, "Include" checkboxes and fixed values listed.
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
  /** A part that is edited elsewhere (child nodes). */
  skip?: (path: EditorPath) => boolean;
};
type Props = {
  schema: SchemaField; value: Json; path: EditorPath; label: string; document: CompositionDocument;
  onChange: (document: CompositionDocument) => void; onError: (message: string) => void; options?: FieldOptions;
};
export const nameOf = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, letter => letter.toUpperCase());
const relationship = (key: string, document: CompositionDocument) => {
  if (key === 'pageId' || key === 'initialPageId') return document.pages.map(item => ({ value: item.id, label: `${item.title} (${item.id})` }));
  if (key === 'modalId') return document.modals.map(item => ({ value: item.id, label: `${item.title} (${item.id})` }));
  if (key === 'tabId' || key === 'initialTabId') return document.navigation.tabs.map(item => ({ value: item.id, label: `${item.label} (${item.id})` }));
  if (key === 'sourceId') return document.dataSources.map(item => ({ value: item.id, label: `${item.id} (${item.kind})` }));
  if (key === 'assetId') return document.assets.map(item => ({ value: item.id, label: item.id }));
  if (key === 'stateId') return (document.localState ?? []).map(item => ({ value: item.id, label: `${item.id} (${item.type})` }));
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
function relationInfo(document: CompositionDocument, path: EditorPath) {
  const key = fieldKey(path);
  const container = path.at(-3) === 'tabs' ? valueAt(document, path.slice(0, -3)) : undefined;
  const localStateId = container && typeof container === 'object' && 'type' in container && container.type === 'local-tabs'
    && 'props' in container && container.props && typeof container.props === 'object' && 'stateId' in container.props
    ? container.props.stateId : undefined;
  const tabField = document.localState?.find(field => field.id === localStateId);
  const tabOptions = key === 'id' && tabField?.type === 'choice' ? tabField.options : undefined;
  return { tabOptions, relations: tabOptions?.map(option => ({ value: option.id, label: option.label })) ?? relationship(key, document) };
}

/** The closed contract supplies fields and variants; references remain explicit relationship selectors. */
export default function CompositionFields(props: Props) {
  const { value, path, label, document, onChange, onError, options } = props;
  const leaf = (element: ReactElement) => options?.fieldPath ? <div className="field-leaf" data-field-path={path.join('/')}>{element}</div> : element;
  const schema = resolveField(props.schema), key = fieldKey(path);
  const set = (next: Json) => onChange(replaceAt(document, path, next));
  const run = (operation: () => CompositionDocument) => {
    try { onChange(operation()); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const object = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json> : undefined;
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
  const { relations, tabOptions } = relationInfo(document, path);
  if (relations) {
    const nullable = key === 'initialTabId';
    const selectOptions = [...(nullable ? [{ value: '', label: 'No selected tab' }] : [{ value: '', label: 'Select a destination' }]), ...relations];
    return leaf(<SelectField label={label} value={value === null ? '' : String(value)} options={selectOptions} onChange={next => {
      let updated = replaceAt(document, path, nullable && !next ? null : next);
      if (tabOptions) updated = replaceAt(updated, [...path.slice(0, -1), 'label'], tabOptions.find(option => option.id === next)?.label ?? '');
      if (key === 'initialTabId' && next) updated.navigation.initialPageId = document.navigation.tabs.find(tab => tab.id === next)!.pageId;
      onChange(updated);
    }}/>);
  }
  if (variants.length > 1) {
    const selected = selectedVariant(schema, value), index = variants.indexOf(selected);
    return <fieldset className="composition-fieldset"><legend>{label}</legend>
      <SelectField label={`${label} type`} value={String(index)} options={variants.map((variant, i) => ({ value: String(i), label: options?.variantLabel?.(path, variantName(variant)) ?? variantName(variant) }))}
        onChange={choice => set(changeFieldVariant(variants[Number(choice)], value, document, key))}/>
      <CompositionFields {...props} schema={selected}/>
    </fieldset>;
  }
  if (options?.rows && (schema.const !== undefined || schema.enum?.length === 1)) return null;
  if (schema.const !== undefined) return <div className="composition-policy"><span>{label}</span><code>{String(schema.const)}</code></div>;
  if (schema.enum) return leaf(<SelectField label={label} value={String(value)} options={schema.enum.map(item => ({ value: String(item), label: options?.valueLabel?.(path, String(item)) ?? String(item) }))} onChange={set}/>);
  if (schema.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = Object.entries(schema.properties ?? {});
    if (!properties.length && typeof schema.additionalProperties === 'object') {
      return <DictionaryFields {...props} schema={schema} itemSchema={schema.additionalProperties} value={value}/>;
    }
    if (!properties.length) return null;
    const editable = properties.filter(([name, child]) => child.const === undefined && !options?.skip?.([...path, name])
      && !(options?.rows && resolveField(child).enum?.length === 1));
    return <fieldset className="composition-fieldset"><legend>{label}</legend>
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
          {(required || present) && <CompositionFields {...props} schema={child} label={childLabel} value={value[name] ?? null} path={[...path, name]}/>}
        </div>;
      })}
    </fieldset>;
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    const tuple = Array.isArray(schema.items) ? schema.items : undefined;
    const itemSchema: SchemaField = Array.isArray(schema.items) ? {} : schema.items ?? {};
    const maximum = schema.maxItems ?? 100;
    return <fieldset className="composition-fieldset"><legend>{label} ({value.length})</legend>
      {value.map((item, index) => {
        const summary = item !== null && typeof item === 'object' && !Array.isArray(item) ? String(item.title ?? item.label ?? item.id ?? item.type ?? `Item ${index + 1}`) : `Item ${index + 1}`;
        if (options?.skip?.([...path, index])) return null;
        return <details className="composition-item" key={item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string' ? item.id : index} open={value.length === 1}>
          <summary>{index + 1}. {summary}</summary>
          {!tuple && <div className="composition-actions">
            <button type="button" aria-label={`Move ${summary} up`} disabled={index === 0} onClick={() => run(() => reorderCompositionItem(document, path, index, -1))}>Up</button>
            <button type="button" aria-label={`Move ${summary} down`} disabled={index === value.length - 1} onClick={() => run(() => reorderCompositionItem(document, path, index, 1))}>Down</button>
            <button type="button" aria-label={`Delete ${summary}`} onClick={() => run(() => removeCompositionItem(document, path, index))}>Delete</button>
          </div>}
          <CompositionFields {...props} schema={tuple?.[index] ?? itemSchema} label={summary} value={item} path={[...path, index]}/>
        </details>;
      })}
      {!tuple && maximum > 0 && <button type="button" className="add-button" disabled={value.length >= maximum}
        onClick={() => set([...value, defaultField(itemSchema, document)])}>{options?.rows ? options.addLabel?.(path) ?? `Add ${label}` : `Add ${label.toLowerCase()} item`}</button>}
      {maximum === 0 && !options?.rows && <p className="field-note">Not supported.</p>}
    </fieldset>;
  }
  if (schema.type === 'boolean') return leaf(<label className="checkbox-field"><input type="checkbox" role={options?.rows ? 'switch' : undefined} checked={Boolean(value)} onChange={event => set(event.target.checked)}/>{label}</label>);
  if (schema.type === 'number' || schema.type === 'integer') return leaf(<NumberField label={label} value={Number(value)} min={schema.minimum ?? 0} max={schema.maximum ?? Number.MAX_SAFE_INTEGER} step={schema.type === 'integer' ? 1 : 0.01} onChange={set}/>);
  if (schema.type === 'null') return options?.rows ? null : <p className="field-note">{label}: none</p>;
  if (key === 'id' || key === 'schemaVersion') return leaf(<TextField label={label} value={String(value)} readOnly onChange={() => {}} title="IDs cannot be changed."/>);
  if (schema.maxLength && schema.maxLength > 1000) return leaf(<Field label={label}><textarea value={String(value ?? '')} maxLength={schema.maxLength} onChange={event => set(event.target.value)}/></Field>);
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
  return <fieldset className="composition-fieldset"><legend>{props.label}</legend>
    {Object.entries(props.value).map(([name, value]) => <div key={name}>
      <CompositionFields {...props} schema={props.itemSchema} path={[...props.path, name]} label={name} value={value}/>
      <button type="button" aria-label={`Delete ${name}`} onClick={() => {
        const next = { ...props.value }; delete next[name];
        props.onChange(replaceAt(props.document, props.path, next));
      }}>Delete</button>
    </div>)}
    <TextField label="New field name" value={key} onChange={setKey}/>
    <button type="button" onClick={add} disabled={Object.keys(props.value).length >= 64}>Add field</button>
  </fieldset>;
}
