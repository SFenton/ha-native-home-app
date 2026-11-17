import type { ReactElement } from 'react';
import { valueAt, type EditorPath, type SchemaField } from '../../composition-editor';
import { useRows } from '../rowsContext';
import ValueField from './ValueField';
import type { LookKind } from './LookControl';

/** The name of the item a field belongs to: the nearest object above it with a title or label ("Guest Room"). */
function useItemName(path: EditorPath): string {
  const { document } = useRows();
  for (let depth = path.length - 1; depth > 0; depth -= 1) {
    const holder = valueAt(document, path.slice(0, depth)) as { title?: unknown; label?: unknown } | undefined;
    const name = holder && typeof holder === 'object' ? holder.title ?? holder.label : undefined;
    if (typeof name === 'string' && name) return name;
  }
  return '';
}
const looks: Record<string, LookKind> = { icon: 'icon', glyph: 'glyph', fill: 'fill' };

/** A value slot drawn with {@link ValueField}: text through the token line, a look by Rules (From Entity waits for the contract, asks 3 and 4). */
function SlotField({ path, schema, label }: { path: EditorPath; schema: SchemaField; label: string }) {
  const itemName = useItemName(path);
  if (schema.xValue === 'text') return <ValueField label={label} path={path} kind="text" itemName={itemName} maxLength={schema.maxLength}/>;
  const look = looks[String(path.at(-1))] ?? 'fill';
  return <ValueField label={label} path={path} kind={look === 'icon' ? 'icon' : 'color'} look={look} itemName={itemName} modes={schema.xBound ? ['fixed', 'entity', 'rules'] : ['fixed', 'rules']}/>;
}
/** The control for a value slot, or undefined when the field is not one. Use as `FieldOptions.slot`. */
export function slotControl(path: EditorPath, schema: SchemaField, label: string): ReactElement | undefined {
  return schema.xValue ? <SlotField path={path} schema={schema} label={label}/> : undefined;
}
