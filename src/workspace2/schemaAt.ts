import { compositionEditorSchema, selectedVariant, valueAt, type EditorPath, type SchemaField } from '../composition-editor';
import type { CompositionDocument } from '../shared/composition/schema';
import type { Json } from '../shared/types';

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
