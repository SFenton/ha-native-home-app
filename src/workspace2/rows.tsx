import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { CompositionDocument } from '../shared/composition/schema';
import { Disclosure } from './Disclosure';
import { useRows } from './rowsContext';
import type { Json } from '../shared/types';
import CompositionFields, { type FieldOptions } from '../CompositionFields';
import { compositionEditorSchema, defaultField, fieldVariants, replaceAt, resolveField, selectedVariant, valueAt, variantName, type EditorPath, type SchemaField } from '../composition-editor';
import { groupOrder, groupTitles, labelFor, mapPath, mechanicalLabel, valueWords, type FieldGroup } from './labels';
import { IconField } from './pickers/PickerField';
import { SegmentRow } from './SegmentRow';
import { domainSummary } from './editors/action';
import { useWorkspaceData } from './pickers/WorkspaceData';
import { slotControl } from './expr/slots';

export { RowsProvider, useRows, type RowsContext } from './rowsContext';
export { Disclosure } from './Disclosure';

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
  'set-local': 'Set Local State', 'dismiss-then-push': 'Close Sheet, Open Page', domain: 'Turn On or Off',
  full: 'Full', fitted: 'Fitted', all: 'All of', any: 'Any of', not: 'Not', state: 'An entity is', numeric: 'A number', viewer: 'The person using the app', 'viewer-person': 'The person is',
  literal: 'Fixed value', read: 'From an entity', control: 'From this control',
};

/** One field to show: where it is, what governs it and how it sits among its neighbours. */
interface Entry { path: EditorPath; rel: EditorPath; schema: SchemaField; required: boolean; present: boolean; value: Json }

const opaque = new Set(['action', 'onAction', 'offAction', 'quickLinksAction', 'profileAction', 'visibleWhen', 'selectedWhen', 'isOn', 'enabledWhen']);
/** A free color: a `solid-rgb` fill, alone or beside the standard one. It is one control, never rows for its channels. */
export const isColorField = (schema: SchemaField) => fieldVariants(schema).some(variant => variantName(variant) === 'solid-rgb');
const isEmptyObject = (schema: SchemaField) => schema.type === 'object' && !Object.keys(schema.properties ?? {}).length && typeof schema.additionalProperties !== 'object';

/** The single-value fields of the object at `path` (the ones the contract fixes), by key, flattening plain nested objects as {@link gatherEntries} does. */
export function gatherFixed(document: CompositionDocument, path: EditorPath, out: string[] = []): string[] {
  const value = valueAt(document, path) as Record<string, Json> | undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const schema = selectedVariant(schemaAt(document, path), value);
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const resolved = resolveField(child);
    if (resolved.const !== undefined || resolved.enum?.length === 1) { out.push(name); continue; }
    const childValue = value[name];
    if (fieldVariants(child).length === 1 && resolved.type === 'object' && Object.keys(resolved.properties ?? {}).length > 0 && !opaque.has(name) && childValue && typeof childValue === 'object' && !Array.isArray(childValue)) gatherFixed(document, [...path, name], out);
  }
  return out;
}

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
    const plain = present && fieldVariants(child).length === 1 && resolved.type === 'object' && Object.keys(resolved.properties ?? {}).length > 0 && !opaque.has(name) && !isColorField(child) && !resolved.xValue
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
export function summarize(document: CompositionDocument, name: string, value: Json | undefined, names?: ReadonlyMap<string, string>): string {
  if (name === 'action' || /Action$/.test(name)) {
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
      case 'domain': return domainSummary(document, String(action.sourceId), names);
      case 'conditional': return 'By Rule';
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
  if (value === undefined || value === null || value === '') return 'None';
  if (Array.isArray(value)) return value.length === 0 ? 'None' : `${value.length} ${unitFor[name] ?? 'item'}${value.length === 1 ? '' : 's'}`;
  if (value && typeof value === 'object') { const type = String((value as Record<string, Json>).type ?? ''); return variantWords[type] ?? valueWords(type); }
  return String(value);
}

/** What a list counts, for its one-line summary ("2 states"). */
const unitFor: Record<string, string> = { states: 'state', stateLabels: 'word', stateColors: 'color', activeStates: 'state', disabledStates: 'state', subtitleSourceIds: 'entity' };

/** Hooks the label map into the field generator. `base` is the path of the object the rows belong to. */
export function fieldOptions(owner: string, base: EditorPath, skip?: (path: EditorPath) => boolean): FieldOptions {
  /** An icon name at any depth (`props.fallback.icon.name`) is picked, not typed. */
  const control: FieldOptions['control'] = (path, value, label, set) =>
    path.at(-1) === 'name' && (path.at(-2) === 'icon' || path.at(-2) === 'symbol' || path.at(-2) === 'fallback' || (path.at(-2) === 'name' && path.at(-3) === 'props')) ? <IconField label={label} symbol={value} path={path.join('/')} onPick={set}/> : undefined;
  const below = (path: EditorPath) => path.slice(base.length);
  return {
    rows: true, fieldPath: true, skip, control, slot: slotControl,
    label: (path, key) => labelFor(owner, below(path))?.label ?? mechanicalLabel(key),
    valueLabel: (path, value) => labelFor(owner, below(path))?.options?.[value] ?? valueWords(value),
    variantLabel: (_path, name) => variantWords[name] ?? valueWords(name),
    addLabel: path => labelFor(owner, below(path))?.add,
  };
}

/** A custom control for one field, keyed by its path below the object (for fields the generator draws poorly). */
export type RowOverride = (entry: { path: EditorPath; value: Json; label: string }) => ReactNode | undefined;

/** The friendly name of every entity Home Assistant has (or, offline, the document names), by id. */
export function useEntityNames(): ReadonlyMap<string, string> {
  const { entities } = useWorkspaceData();
  return useMemo(() => new Map(entities.map(row => [row.entityId, row.name])), [entities]);
}

/**
 * The fields of the object at `path` as rows in four groups: what it shows, how it looks, "Behavior", "Advanced".
 * Labels, groups and order come from the label map; an editable field with no entry lands in Advanced under a mechanical label.
 */
export function ObjectRows({ path, owner, skip, overrides = {}, extra, groups = groupOrder, below }: { path: EditorPath; owner: string; skip?: (path: EditorPath) => boolean; overrides?: Record<string, RowOverride>; extra?: Partial<Record<FieldGroup, ReactNode>>; groups?: readonly FieldGroup[]; /** A line under a row, from the field's path below the object (a template's "Set Per Place"). */ below?: (rel: EditorPath) => ReactNode }) {
  const { document, onChange, onError } = useRows();
  const names = useEntityNames();
  const options = fieldOptions(owner, path, skip);
  const entries = gatherEntries(document, path, skip).map((entry, at) => {
    const mapped = labelFor(owner, entry.rel);
    return { entry, mapped, at, group: (mapped ? mapped.group ?? 'what' : 'advanced') as FieldGroup, label: mapped?.label ?? mechanicalLabel(String(entry.rel.at(-1))) };
  }).filter(item => !item.mapped?.hidden);
  // A row the person just set from "None" opens, so the empty value and the form it becomes are one gesture.
  const [justAdded, setJustAdded] = useState<string>();
  const drawn = (item: typeof entries[number]) => overrides[mapPath(item.entry.rel)]?.({ path: item.entry.path, value: item.entry.value, label: item.label });
  const custom = new Map(entries.map(item => [item, drawn(item)] as const));
  // One row per value: a generated row that reads the same label and value as a row an override draws is the second copy.
  const copies = entries.filter(item => custom.get(item) !== undefined);
  const duplicate = (item: typeof entries[number]) => custom.get(item) === undefined && copies.some(other => other.label === item.label && other.group === item.group && JSON.stringify(other.entry.value) === JSON.stringify(item.entry.value));
  const render = (item: typeof entries[number]) => {
    const { entry, label, mapped } = item;
    const name = String(entry.rel.at(-1));
    // An override that returns undefined declines, and the generated control is used.
    const drawnRow = custom.get(item);
    if (drawnRow !== undefined) return drawnRow;
    const resolved = resolveField(entry.schema), variants = fieldVariants(entry.schema);
    const complex = !isColorField(entry.schema) && (resolved.type === 'array' || variants.length > 1 || opaque.has(name) || (resolved.type === 'object' && Object.keys(resolved.properties ?? {}).length > 0) || typeof resolved.additionalProperties === 'object');
    const generated = <CompositionFields schema={entry.schema} value={entry.value} path={entry.path} label={label} document={document} onChange={onChange} onError={onError} options={options}/>;
    const at = entry.path.join('/');
    // Width is Automatic (the grid decides), Half or Full: one segment, whether or not the span is written.
    if (entry.rel.at(-1) === 'span' && entry.rel.at(-2) === 'layout' && (entry.value === undefined || entry.value === null || entry.value === 1 || entry.value === 2)) {
      const layoutPath = entry.path.slice(0, -1), layout = valueAt(document, layoutPath) as Record<string, Json>;
      const set = (next: number | undefined) => { const { span: _span, ...rest } = layout; void _span; onChange(replaceAt(document, layoutPath, next === undefined ? rest : { ...rest, span: next })); };
      return <SegmentRow label={label} path={at} value={(entry.value as number | undefined) ?? 0} choices={[{ value: 0, label: 'Automatic' }, { value: 1, label: 'Half' }, { value: 2, label: 'Full' }]} onPick={next => set(next === 0 ? undefined : next)}/>;
    }
    if (!entry.required && !entry.present) {
      return <button type="button" className="w2-add-row" data-field-path={at} aria-label={`Add ${label}`}
        onClick={() => { setJustAdded(at); onChange(replaceAt(document, entry.path, defaultField(entry.schema, document, name))); }}>
        <span className="w2-row-label">{label}</span><span className="w2-summary">{summarize(document, name, undefined)}</span><ChevronRight size={16} aria-hidden/>
      </button>;
    }
    // Width is Half or Full: two words, so a segment (a span other than 1 or 2 keeps the number).
    const span = entry.rel.at(-1) === 'span' && entry.rel.at(-2) === 'layout' && (entry.value === 1 || entry.value === 2);
    const slotRow = resolved.xValue && entry.value && typeof entry.value === 'object' ? slotControl(entry.path, resolved, label) : undefined;
    const control = slotRow ? slotRow : span
      ? <SegmentRow label={label} path={at} value={entry.value as number} choices={[{ value: 1, label: 'Half' }, { value: 2, label: 'Full' }]} onPick={next => onChange(replaceAt(document, entry.path, next))}/>
      : complex
        ? <Disclosure label={label} summary={summarize(document, name, entry.value, names)} path={at} defaultOpen={justAdded === at}>{generated}</Disclosure>
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
        {rows.filter(item => !duplicate(item)).map(item => <div className="w2-row" key={item.entry.path.join('/')}>{render(item)}{below?.(item.entry.rel)}</div>)}
        {extra?.[group]}
      </section>;
    })}
  </>;
}
