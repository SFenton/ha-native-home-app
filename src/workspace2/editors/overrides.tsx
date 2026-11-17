import type { Json } from '../../shared/types';
import { replaceAt, selectedVariant, valueAt, type EditorPath } from '../../composition-editor';
import { acceptedDomains, bindEntity, bindSource, nodeSourceId, sourceChoices } from '../add/sources';
import { IconField } from '../pickers/PickerField';
import SourceField from '../pickers/SourceField';
import { schemaAt, useRows, type RowOverride } from '../rows';
import { boundControlKinds, withBoundControlFace, withBoundControlKind } from './boundControl';
import { ChoiceRow } from '../SegmentRow';
import { SelectField } from '../../ui';
import { valueWords } from '../labels';
import type { BoundControlKind } from '../../shared/composition/bound-control';
import { ActionRow } from './ActionEditor';
import ConditionField from '../expr/ConditionField';
import { words } from '../expr/words';
import BadgeField from '../expr/BadgeField';
import { FallbackTab, OpensOn } from '../expr/OpensOn';
import { EmptyMessageRow, isList, RefreshableRow, RowsFromRow, StateText } from '../data/ListStates';
import { RecordsFromRow } from '../data/RecordsFrom';

/** The domains an entity field offers for a node type (spec 8.1: pre-set to the domains a field accepts). */
const domainsFor: Record<string, readonly string[]> = { 'action-tile': ['switch', 'input_boolean'], 'camera-tile': ['camera'], 'weather-panel': ['weather'], 'light-group-tile': ['light', 'switch', 'input_boolean'] };

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
  // The data a node reads: the entity picker (friendly name first, the id second) with a "Models" group for the sources that are not one entity.
  const entity: RowOverride = ({ label, path: at }) => {
    const id = nodeSourceId(document, path);
    const choices = sourceChoices(document, path);
    return <SourceField label={label} path={at.join('/')} current={document.dataSources.find(source => source.id === id)} acceptsEntity={choices.acceptsEntity} models={choices.models}
      domains={domainsFor[String(node?.type)]} restrict={acceptedDomains(document, path, domainsFor)} onPickEntity={row => onChange(bindEntity(document, path, row.entityId))} onPickSource={sourceId => onChange(bindSource(document, path, sourceId))}/>;
  };
  return {
    action, onAction: action, offAction: action, quickLinksAction: action, profileAction: action,
    visibleWhen: ({ path: at, label }) => <ConditionField label={label} path={at} place="show" policy="show" itemName={itemName}/>,
    badge: ({ path: at, label }) => <BadgeField path={at} label={label} itemName={itemName}/>,
    enabledWhen: ({ path: at, label }) => <ConditionField label={label} path={[...at, 'condition']} place="enable" policy="enable" itemName={itemName}/>,
    activeWhen: ({ path: at, label }) => <ConditionField label={label} path={at} place="active" none={words.fromStyle} itemName={itemName}/>,
    filledWhen: ({ path: at, label }) => <ConditionField label={label} path={at} place="filled" none={words.fromStyle} itemName={itemName}/>,
    errorWhen: ({ path: at, label }) => <ConditionField label={label} path={at} place="error" none={words.fromStyle} itemName={itemName}/>,
    'icon.name': ({ path: at, value, label }) => <IconField label={label} symbol={String(value)} path={at.join('/')} onPick={symbol => onChange(replaceAt(document, at, symbol))}/>,
    ...(node?.type === 'bound-control' ? {
      // Changing the kind drops the fields the new kind does not use, so a Toggle never keeps a button's "When tapped".
      'props.kind': ({ path: at, value, label }: { path: EditorPath; value: Json; label: string }) => <SelectField label={label} value={String(value)}
        options={boundControlKinds.map(kind => ({ value: kind, label: valueWords(kind) }))} onChange={kind => onChange(withBoundControlKind(document, path, kind as BoundControlKind))}/>,
      // A check face has no icon, subtitle, glyph tint or row size: choosing it drops them.
      'props.face': ({ value, label }: { path: EditorPath; value: Json; label: string }) => <ChoiceRow label={label} value={String(value)} options={[{ value: 'switch', label: 'Switch' }, { value: 'check', label: 'Check Mark' }]}
        onChange={face => onChange(withBoundControlFace(document, path, face as 'switch' | 'check'))}/>,
    } : {}),
    ...(node?.type === 'local-tabs' ? { 'props.automatic': () => <OpensOn path={path} itemName={itemName}/>, 'props.fallbackTabId': () => <FallbackTab path={path}/> } : {}),
    ...(isList(node?.type) ? {
      // The List (studio-ux2, L-data): one inspector for `row-collection` and the app's own `collection`.
      'props.providerId': ({ label }: { label: string }) => <RowsFromRow path={path} label={label}/>,
      'props.refreshable': () => <RefreshableRow path={path}/>,
      'props.emptyMessage': () => <EmptyMessageRow path={path} itemName={itemName}/>,
      'props.rowAction': ({ path: at }: { path: EditorPath; label: string }) => action({ path: at, label: 'Row tapped' }),
      ...Object.fromEntries(['loadingText', 'emptyText', 'staleText', 'errorText', 'unavailableText'].map(key => [`props.${key}`, ({ path: at, value, label }: { path: EditorPath; value: Json; label: string }) =>
        <StateText node={String((valueAt(document, path) as { id: string }).id)} field={key} label={label} path={at} value={String(value ?? '')}/>])),
    } : {}),
    // The Repeat (`sh.repeat@1`): the records flow it draws, and the five words of its states.
    ...(node?.type === 'repeat' ? {
      'props.providerId': ({ label }: { label: string }) => <RecordsFromRow path={path} label={label}/>,
      ...Object.fromEntries(['loadingText', 'emptyText', 'staleText', 'errorText', 'unavailableText'].map(key => [`props.${key}`, ({ path: at, value, label }: { path: EditorPath; value: Json; label: string }) =>
        <StateText node={String((valueAt(document, path) as { id: string }).id)} field={key} label={label} path={at} value={String(value ?? '')}/>])),
    } : {}),
    'binding.sourceId': entity, 'props.sourceId': entity,
  };
}
