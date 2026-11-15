import type { Json } from '../../shared/types';
import { replaceAt, selectedVariant, valueAt, type EditorPath } from '../../composition-editor';
import { bindEntity, boundEntity } from '../add/sources';
import { EntityField, IconField } from '../pickers/PickerField';
import { schemaAt, useRows, type RowOverride } from '../rows';
import { boundControlKinds, withBoundControlKind } from './boundControl';
import { SelectField } from '../../ui';
import { valueWords } from '../labels';
import type { BoundControlKind } from '../../shared/composition/bound-control';
import { ActionRow } from './ActionEditor';
import { RuleRow } from './RuleEditor';

/** The domains an entity field offers for a node type (spec 8.1: pre-set to the domains a field accepts). */
const domainsFor: Record<string, readonly string[]> = { 'action-tile': ['switch', 'input_boolean'], 'camera-tile': ['camera'], 'weather-panel': ['weather'] };

/**
 * The deep editors for the rows every node and page shares (spec section 8): the icon picker, the entity picker for a node's
 * data, the action editor ("When tapped") and the rule builder ("Visible when"). `path` is the node's own path; a field the
 * pickers cannot serve (a source that is not one entity) declines, and the generated control is used.
 */
export function useDeepRows(path: EditorPath): Record<string, RowOverride> {
  const { document, onChange } = useRows();
  const node = valueAt(document, path) as { type?: string; title?: string; binding?: { sourceId?: string } } | undefined;
  const itemName = node?.title ?? '';
  const action = ({ path: at, label }: { path: EditorPath; label: string }) => {
    const parent = valueAt(document, at.slice(0, -1)) as Json, parentSchema = selectedVariant(schemaAt(document, at.slice(0, -1)), parent);
    return <ActionRow label={label} path={at} schema={schemaAt(document, at)} optional={!parentSchema.required?.includes(String(at.at(-1)))} boundSourceId={node?.binding?.sourceId} itemName={itemName}/>;
  };
  const entity: RowOverride = ({ label, path: at }) => {
    const bound = boundEntity(document, path);
    if (!bound) return undefined;
    return <EntityField label={label} entityId={bound} domains={domainsFor[String(node?.type)]} path={at.join('/')} onPick={row => onChange(bindEntity(document, path, row.entityId))}/>;
  };
  return {
    action, onAction: action, offAction: action, quickLinksAction: action, profileAction: action,
    visibleWhen: ({ path: at, label }) => <RuleRow label={label} path={at} itemName={itemName}/>,
    'icon.name': ({ path: at, value, label }) => <IconField label={label} symbol={String(value)} path={at.join('/')} onPick={symbol => onChange(replaceAt(document, at, symbol))}/>,
    ...(node?.type === 'bound-control' ? {
      // Changing the kind drops the fields the new kind does not use, so a Toggle never keeps a button's "When tapped".
      'props.kind': ({ path: at, value, label }: { path: EditorPath; value: Json; label: string }) => <SelectField label={label} value={String(value)}
        options={boundControlKinds.map(kind => ({ value: kind, label: valueWords(kind) }))} onChange={kind => onChange(withBoundControlKind(document, path, kind as BoundControlKind))}/>,
    } : {}),
    'binding.sourceId': entity, 'props.sourceId': entity,
  };
}
