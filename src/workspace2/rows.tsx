import { createContext, useContext, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CompositionDocument } from '../shared/composition/schema';
import type { Json } from '../shared/types';
import CompositionFields, { type FieldOptions } from '../CompositionFields';
import { compositionEditorSchema, defaultField, fieldVariants, replaceAt, resolveField, selectedVariant, valueAt, type EditorPath, type SchemaField } from '../composition-editor';
import { groupOrder, groupTitles, labelFor, mapPath, mechanicalLabel, type FieldGroup } from './labels';

/** Everything a row needs to read and change the document. */
export interface RowsContext {
  document: CompositionDocument;
  onChange: (document: CompositionDocument) => void;
  onError: (message: string) => void;
  /** Test hook: render every disclosure open so a walk can find every field. */
  openAll?: boolean;
}
const Rows = createContext<RowsContext | undefined>(undefined);
/** Provides the document and its setters to the rows below. */
export const RowsProvider = Rows.Provider;
export function useRows(): RowsContext {
  const value = useContext(Rows);
  if (!value) throw new Error('Rows need a RowsProvider');
  return value;
}

/** The schema that governs the value at `path`, following union variants by what the value is. */
export function schemaAt(document: CompositionDocument, path: EditorPath): SchemaField {
  let schema: SchemaField = compositionEditorSchema;
  path.forEach((key, depth) => {
    const here = valueAt(document, path.slice(0, depth)) as Json;
    const picked = selectedVariant(schema, here);
    if (typeof key === 'number') schema = Array.isArray(picked.items) ? picked.items[key] ?? {} : picked.items ?? {};
    else {
      const next: SchemaField | boolean | undefined = picked.properties?.[key] ?? picked.additionalProperties;
      schema = typeof next === 'object' ? next : {};
    }
  });
  return schema;
}

/** The words for the variants a type picker offers. */
export const variantWords: Record<string, string> = {
  inherit: 'Same as app', replace: 'Custom', stack: 'Off', 'navigation-columns': 'On',
  'call-service': 'Call a Service', push: 'Open Page', present: 'Open Sheet', 'select-tab': 'Switch Tab', back: 'Back', dismiss: 'Close Sheet',
  'set-local': 'Set Local State', 'dismiss-then-push': 'Close Sheet, Open Page', domain: 'Toggle Power',
  full: 'Full', fitted: 'Fitted', all: 'All of', any: 'Any of', not: 'Not', state: 'An entity is', numeric: 'A number', viewer: 'The person using the app', 'viewer-person': 'The person is',
  literal: 'Fixed value', read: 'From an entity', control: 'From this control',
};

/** One field to show: where it is, what governs it and how it sits among its neighbours. */
interface Entry { path: EditorPath; rel: EditorPath; schema: SchemaField; required: boolean; present: boolean; value: Json }

const opaque = new Set(['action', 'onAction', 'offAction', 'visibleWhen', 'selectedWhen', 'isOn']);
const isEmptyObject = (schema: SchemaField) => schema.type === 'object' && !Object.keys(schema.properties ?? {}).length && typeof schema.additionalProperties !== 'object';

/** The fields of the object at `path`, flattening plain nested objects (`props`, `layout`) so their members read as rows. */
export function gatherEntries(document: CompositionDocument, path: EditorPath, skip?: (path: EditorPath) => boolean, rel: EditorPath = [], out: Entry[] = []): Entry[] {
  const value = valueAt(document, path) as Record<string, Json> | undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const schema = selectedVariant(schemaAt(document, path), value);
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const resolved = resolveField(child);
    if (resolved.const !== undefined || resolved.enum?.length === 1 || isEmptyObject(resolved)) continue;
    const childPath = [...path, name], childRel = [...rel, name];
    if (skip?.(childPath)) continue;
    const present = Object.hasOwn(value, name), childValue = value[name];
    const plain = present && fieldVariants(child).length === 1 && resolved.type === 'object' && Object.keys(resolved.properties ?? {}).length > 0 && !opaque.has(name)
      && childValue !== null && typeof childValue === 'object' && !Array.isArray(childValue);
    if (plain) { gatherEntries(document, childPath, skip, childRel, out); continue; }
    out.push({ path: childPath, rel: childRel, schema: child, required: Boolean(schema.required?.includes(name)), present, value: childValue ?? null });
  }
  return out;
}

const countConditions = (predicate: Json): number => {
  if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate)) return 0;
  const record = predicate as Record<string, Json>;
  if ((record.type === 'all' || record.type === 'any') && Array.isArray(record.of)) return record.of.reduce<number>((sum, item) => sum + countConditions(item), 0);
  if (record.type === 'not') return countConditions(record.of);
  return 1;
};
/** The one-line summary of a field that opens into a form (spec section 10, "Tile rows"). */
export function summarize(document: CompositionDocument, name: string, value: Json | undefined): string {
  if (name === 'action') {
    const action = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json> : undefined;
    if (!action) return 'Nothing';
    const page = (id: Json) => document.pages.find(item => item.id === id)?.title ?? String(id);
    switch (action.type) {
      case 'push': return `Opens ${page(action.pageId)}`;
      case 'dismiss-then-push': return `Opens ${page((action.destination as Record<string, Json>)?.pageId)}`;
      case 'present': return `Opens ${document.modals.find(item => item.id === action.modalId)?.title ?? action.modalId}`;
      case 'select-tab': return `Switches to ${document.navigation.tabs.find(item => item.id === action.tabId)?.label ?? action.tabId}`;
      case 'call-service': {
        const target = action.target as Record<string, Json> | undefined;
        const first = Array.isArray(target?.entityIds) ? target.entityIds[0] : undefined;
        return `${action.domain}.${action.service}${first && typeof first === 'object' && !Array.isArray(first) && 'value' in first ? ` · ${first.value}` : ''}`;
      }
      case 'back': return 'Back';
      case 'dismiss': return 'Closes the sheet';
      case 'set-local': return 'Sets a local state';
      default: return variantWords[String(action.type)] ?? String(action.type);
    }
  }
  if (name === 'visibleWhen' || name === 'selectedWhen' || name === 'isOn') {
    if (!value) return 'Always';
    const count = countConditions(value);
    return count === 1 ? '1 condition' : `${count} conditions`;
  }
  if (Array.isArray(value)) return `${value.length}`;
  if (value && typeof value === 'object') return String((value as Record<string, Json>).type ?? '');
  return '';
}

/** A row that opens into a form: label and summary leading, a chevron trailing. */
export function Disclosure({ label, summary, children, defaultOpen = false, path }: { label: string; summary?: string; children: ReactNode; defaultOpen?: boolean; path?: string }) {
  const { openAll } = useRows();
  const [open, setOpen] = useState(defaultOpen);
  const shown = open || openAll;
  return <div className="w2-disclosure" data-open={shown || undefined} data-disclosure={path}>
    <button type="button" className="w2-disclosure-head" aria-expanded={Boolean(shown)} onClick={() => setOpen(!open)}>
      <span className="w2-row-label">{label}</span><span className="w2-summary">{summary}</span>{shown ? <ChevronDown size={16} aria-hidden/> : <ChevronRight size={16} aria-hidden/>}
    </button>
    {shown && <div className="w2-disclosure-body">{children}</div>}
  </div>;
}

/** Hooks the label map into the field generator. `base` is the path of the object the rows belong to. */
export function fieldOptions(owner: string, base: EditorPath, skip?: (path: EditorPath) => boolean): FieldOptions {
  const below = (path: EditorPath) => path.slice(base.length);
  return {
    rows: true, fieldPath: true, skip,
    label: (path, key) => labelFor(owner, below(path))?.label ?? mechanicalLabel(key),
    valueLabel: (path, value) => labelFor(owner, below(path))?.options?.[value],
    variantLabel: (_path, name) => variantWords[name],
    addLabel: path => labelFor(owner, below(path))?.add,
  };
}

/** A custom control for one field, keyed by its path below the object (for fields the generator draws poorly). */
export type RowOverride = (entry: { path: EditorPath; value: Json; label: string }) => ReactNode;

/**
 * The fields of the object at `path` as rows in four groups: what it shows, how it looks, "Behaviour", "Advanced".
 * Labels, groups and order come from the label map; an editable field with no entry lands in Advanced under a mechanical label.
 */
export function ObjectRows({ path, owner, skip, overrides = {}, extra, groups = groupOrder }: { path: EditorPath; owner: string; skip?: (path: EditorPath) => boolean; overrides?: Record<string, RowOverride>; extra?: Partial<Record<FieldGroup, ReactNode>>; groups?: readonly FieldGroup[] }) {
  const { document, onChange, onError } = useRows();
  const options = fieldOptions(owner, path, skip);
  const entries = gatherEntries(document, path, skip).map((entry, at) => {
    const mapped = labelFor(owner, entry.rel);
    return { entry, mapped, at, group: (mapped ? mapped.group ?? 'what' : 'advanced') as FieldGroup, label: mapped?.label ?? mechanicalLabel(String(entry.rel.at(-1))) };
  }).filter(item => !item.mapped?.hidden);
  const render = ({ entry, label, mapped }: typeof entries[number]) => {
    const key = mapPath(entry.rel), name = String(entry.rel.at(-1));
    const override = overrides[key];
    if (override) return override({ path: entry.path, value: entry.value, label });
    const resolved = resolveField(entry.schema), variants = fieldVariants(entry.schema);
    const complex = resolved.type === 'array' || variants.length > 1 || opaque.has(name) || (resolved.type === 'object' && Object.keys(resolved.properties ?? {}).length > 0) || typeof resolved.additionalProperties === 'object';
    const generated = <CompositionFields schema={entry.schema} value={entry.value} path={entry.path} label={label} document={document} onChange={onChange} onError={onError} options={options}/>;
    if (!entry.required && !entry.present) {
      return <div className="w2-add-row" data-field-path={entry.path.join('/')}>
        <span className="w2-row-label">{label}</span><span className="w2-summary">{summarize(document, name, undefined)}</span>
        <button type="button" aria-label={`Add ${label}`} onClick={() => onChange(replaceAt(document, entry.path, defaultField(entry.schema, document, name)))}>Add</button>
      </div>;
    }
    const control = complex
      ? <Disclosure label={label} summary={summarize(document, name, entry.value)} path={entry.path.join('/')}>{generated}</Disclosure>
      : <>{generated}{mapped?.caption && <p className="w2-caption">{mapped.caption}</p>}</>;
    if (entry.required) return control;
    const remove = () => { const owner = valueAt(document, entry.path.slice(0, -1)) as Record<string, Json>; const { [name]: _gone, ...rest } = owner; onChange(replaceAt(document, entry.path.slice(0, -1), rest)); };
    return <>{control}<button type="button" className="w2-remove" aria-label={`Remove ${label}`} onClick={remove}>Remove</button></>;
  };
  return <>
    {groups.map(group => {
      const rows = entries.filter(item => item.group === group).sort((a, b) => (a.mapped?.order ?? 50) - (b.mapped?.order ?? 50) || a.at - b.at);
      if (!rows.length && !extra?.[group]) return null;
      return <section key={group} className="w2-group" data-group={group} aria-label={groupTitles[group] || undefined}>
        {groupTitles[group] && groups.length > 1 && <h3 className="w2-group-title">{groupTitles[group]}</h3>}
        {rows.map(item => <div className="w2-row" key={item.entry.path.join('/')}>{render(item)}</div>)}
        {extra?.[group]}
      </section>;
    })}
  </>;
}
