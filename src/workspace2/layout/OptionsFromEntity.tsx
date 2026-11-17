import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { optionsFromList } from '../../shared/composition/bound-control';
import { ensureSource } from '../add/sources';
import { ResultLine } from '../expr/ResultLine';
import { useDataTag, useDraftEnvironment } from '../expr/useExpr';
import { EntityField } from '../pickers/PickerField';
import { useRows } from '../rows';
import { ChoiceRow } from '../SegmentRow';

/** What a Choice that reads its choices from an entity holds (`sh.bound-options-read@1`). */
interface OptionsFrom {
  from: { type: 'source'; sourceId: string; path: string[] };
  current: unknown;
  labels: 'as-is' | 'title-case';
  action: unknown;
}
type Choice = { props: { kind: string; optionsFrom?: OptionsFrom } };

const literal = (value: string) => ({ type: 'literal' as const, value });
/** The entity's own list: the options a `select` or `input_select` offers. */
const OPTIONS_PATH = ['attributes', 'options'];

/** The reading for `entityId`: its options, the option it is on, and `select_option` with the chosen item as the value. */
export function optionsFromEntity(entityId: string, sourceId: string, labels: OptionsFrom['labels'] = 'title-case'): OptionsFrom {
  return {
    from: { type: 'source', sourceId, path: OPTIONS_PATH },
    current: { type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as: 'string', missing: 'unavailable' },
    labels,
    action: { type: 'call-service', domain: entityId.split('.')[0], service: 'select_option', target: { entity_id: literal(entityId) }, data: { type: 'object', fields: { option: { type: 'control' } } }, feedback: 'policy' },
  };
}

/**
 * "Read Choices From an Entity…" under a Choice's list: the choices follow the entity's own options while it reports at least two, and the ones
 * listed above are the fallback. Once set, the row names the entity, offers the words' style and says what the entity reports now.
 */
export default function OptionsFromEntity({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const env = useDraftEnvironment(document), tag = useDataTag();
  const node = valueAt(document, path) as Choice | undefined;
  if (!node) return null;
  const reading = node.props.optionsFrom;
  const fieldPath = [...path, 'props', 'optionsFrom'].join('/');
  const pick = (entityId: string) => {
    const made = ensureSource(document, entityId);
    onChange(replaceAt(made.document, [...path, 'props', 'optionsFrom'], optionsFromEntity(entityId, made.sourceId, reading?.labels)));
  };
  if (!reading) return <div className="w2-row" data-field-path={fieldPath}>
    <EntityField label="Read Choices From an Entity…" domains={['select', 'input_select']} onPick={row => pick(row.entityId)}/>
    <p className="w2-caption">The choices follow the entity’s own options while it has two or more. The ones above are used until then.</p>
  </div>;
  const source = document.dataSources.find(item => item.id === reading.from.sourceId);
  const entityId = source?.kind === 'ha-entity' && source.entityId.type === 'literal' ? source.entityId.value : undefined;
  const list = env ? env.read(reading.from.sourceId, reading.from.path) : undefined;
  const read = list?.status === 'value' ? optionsFromList(list.value, reading.labels) : undefined;
  return <div className="w2-row" data-field-path={fieldPath}>
    <EntityField label="Reads Choices From" entityId={entityId} domains={['select', 'input_select']} onPick={row => pick(row.entityId)}/>
    <ChoiceRow label="Choice words" value={reading.labels} options={[{ value: 'title-case', label: 'Title Case' }, { value: 'as-is', label: 'As Written' }]}
      onChange={labels => onChange(replaceAt(document, [...path, 'props', 'optionsFrom', 'labels'], labels))}/>
    {env && <ResultLine marker={read ? 'check' : 'unknown'} head={read ? `Reads ${read.length} choices now.` : 'Uses the choices above now.'} tag={tag}>{read ? read.map(option => option.label).join(', ') : 'The entity reports fewer than two options.'}</ResultLine>}
    <p className="w2-caption">The choices above are used while the entity reports fewer than two options.</p>
    <button type="button" className="w2-remove" onClick={() => {
      const { optionsFrom: _gone, ...rest } = node.props;
      void _gone;
      onChange(replaceAt(document, [...path, 'props'], rest));
    }}>Stop Reading Choices</button>
  </div>;
}
