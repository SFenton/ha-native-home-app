import { useMemo } from 'react';
import { replaceAt, valueAt, type EditorPath } from '../composition-editor';
import { expandRef, fieldSteps, findNodePath } from '../shared/composition/components';
import type { ComponentEntry, ComponentRefNode, CompositionDocument } from '../shared/composition/schema';
import { useDeepRows } from './editors/overrides';
import { labelFor, type FieldGroup } from './labels';
import { paramLabel, resetValue, setValue, type Param } from './params';
import { ObjectRows, useRows } from './rows';
import { RowsProvider } from './rowsContext';

/**
 * One row of a place's settings for a `value` parameter (templates spec, "any field", section 3): the field's own editor, drawn by the same row code as
 * the template's field, against this place's expansion. The place is shown as it is drawn (the reference replaced by `expandRef`), the row at the first
 * field the setting fills, and a change to that field is written as this place's `values` entry. So the colour picker, the symbol picker, the rule page
 * and every row override are reused, with no second editor. A place's value is its own: it never asks, and it can be changed in Use.
 */
export default function PlaceValueRow({ document, component, refPath, param, say, onChange, onError }: {
  document: CompositionDocument; component: ComponentEntry; refPath: EditorPath; param: Param;
  /** Announces a status line through the polite live region. */ say?: (message: string) => void;
  /** Applies the document the change makes. */ onChange: (document: CompositionDocument) => void; onError: (message: string) => void;
}) {
  const parent = useRows();
  const ref = valueAt(document, refPath) as ComponentRefNode;
  const binding = component.bindings?.find(item => item.param === param.name && item.nodeId !== undefined);
  const inside = binding?.nodeId !== undefined ? findNodePath(component.node, binding.nodeId) : undefined;
  const label = paramLabel(param);
  const own = Boolean(ref.values && Object.hasOwn(ref.values, param.name));
  const shown = useMemo(() => replaceAt(document, refPath, expandRef(ref, component)), [document, refPath, ref, component]);
  if (!binding || !inside) return null;
  const nodePath = [...refPath, ...inside], steps = fieldSteps(binding.field), fieldPath = [...nodePath, ...steps];
  const apply = (next: CompositionDocument) => {
    try {
      const value = valueAt(next, fieldPath);
      // A rule or a binding the editor made may have added a data source of the document (an entity it now reads): the value refers to it, so it is kept.
      const known = new Set(shown.dataSources.map(item => item.id));
      const added = next.dataSources.filter(item => !known.has(item.id));
      const base = added.length ? { ...document, dataSources: [...document.dataSources, ...added] } : document;
      onChange(setValue(base, refPath, param.name, value === undefined ? null : value));
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const describe = `place-value-${ref.id}-${param.name}`;
  return <div className="w2-place-value" role="group" aria-label={label} aria-describedby={own ? describe : undefined} data-testid="place-value" data-param={param.name} data-own={own || undefined}>
    <RowsProvider value={{ ...parent, document: shown, onChange: apply }}>
      <PlaceField nodePath={nodePath} fieldPath={fieldPath} steps={steps}/>
    </RowsProvider>
    {own && <div className="w2-per-place" data-on>
      <p id={describe} className="w2-caption">Differs from the template.</p>
      <button type="button" className="w2-per-place-button" aria-label={`Use the template’s ${label}`} aria-describedby={describe}
        onClick={() => { try { onChange(resetValue(document, refPath, param.name)); say?.(`${label} uses the template’s value.`); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } }}>Reset</button>
    </div>}
  </div>;
}

/** The one row of the expanded node that holds the field: every other row is skipped. */
function PlaceField({ nodePath, fieldPath, steps }: { nodePath: EditorPath; fieldPath: EditorPath; steps: string[] }) {
  const { document } = useRows();
  const overrides = useDeepRows(nodePath);
  const node = valueAt(document, nodePath) as { type: string } | undefined;
  if (!node) return null;
  const group: FieldGroup = labelFor(node.type, steps)?.group ?? (labelFor(node.type, steps) ? 'what' : 'advanced');
  const along = (at: EditorPath) => at.length <= fieldPath.length && at.every((step, index) => step === fieldPath[index]);
  return <ObjectRows path={nodePath} owner={node.type} skip={at => !along(at)} overrides={overrides} groups={[group] as readonly FieldGroup[]}/>;
}
