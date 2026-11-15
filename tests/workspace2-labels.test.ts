import { describe, expect, it } from 'vitest';
import { compositionEditorSchema, fieldVariants, nodeDefinition, resolveField, type SchemaField } from '../src/composition-editor';
import { labelFor, labelMap, mapPath } from '../src/workspace2/labels';

const opaque = new Set(['action', 'onAction', 'offAction', 'visibleWhen', 'selectedWhen', 'isOn']);
const isEmptyObject = (schema: SchemaField) => schema.type === 'object' && !Object.keys(schema.properties ?? {}).length && typeof schema.additionalProperties !== 'object';
/** The editable fields of an object schema the way the rows flatten them (see `gatherEntries`). */
export function editableFields(schema: SchemaField, rel: string[] = [], out: string[][] = []): string[][] {
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const resolved = resolveField(child);
    if (resolved.const !== undefined || resolved.enum?.length === 1 || isEmptyObject(resolved)) continue;
    const here = [...rel, name];
    const plain = fieldVariants(child).length === 1 && resolved.type === 'object' && Object.keys(resolved.properties ?? {}).length > 0 && !opaque.has(name);
    if (plain) editableFields(resolved, here, out); else out.push(here);
  }
  return out;
}

/** Every owner the properties surface shows rows for: each node type, a page and a sheet. */
export function owners(): { owner: string; schema: SchemaField }[] {
  const nodes = (nodeDefinition().anyOf ?? nodeDefinition().oneOf ?? []).map(variant => ({ owner: String(resolveField(variant).properties?.type?.const), schema: resolveField(variant) }));
  const root = compositionEditorSchema.properties!;
  const pages = fieldVariants(resolveField(root.pages).items as SchemaField)[0];
  const modals = fieldVariants(resolveField(root.modals).items as SchemaField)[0];
  return [...nodes, { owner: 'page', schema: pages }, { owner: 'sheet', schema: modals }];
}

describe('label coverage', () => {
  it('has an authored entry for every editable field, so no mechanical label shows outside Advanced', () => {
    const missing: string[] = [];
    for (const { owner, schema } of owners()) for (const rel of editableFields(schema)) {
      if (['children', 'tabs', 'components'].includes(rel[0])) continue;
      if (!labelFor(owner, rel)) missing.push(`${owner}.${mapPath(rel)}`);
    }
    expect(missing).toEqual([]);
  });
  it('keeps the map itself free of empty labels', () => { for (const [key, value] of Object.entries(labelMap)) expect(value.label.trim(), key).not.toBe(''); });
});
