import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { evaluatePredicate } from '../../preview2/evaluate';
import { createId } from '../../shared/ids';
import { ensureSource } from '../add/sources';
import { defaultAction } from '../editors/action';
import { TextInput } from '../editors/controls';
import { useDataTag, useDraftEnvironment } from '../expr/useExpr';
import { usePush } from '../kit';
import { EntityField } from '../pickers/PickerField';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { ObjectRows, useRows } from '../rows';
import OptionsFromEntity from './OptionsFromEntity';

/** The most choices a Choice holds, and the count past which a phone may cut the segments. */
export const MAX_CHOICES = 12, PHONE_CHOICES = 5;

interface Option { id: string; label: string; selectedWhen: unknown; action: unknown }
type Choice = { props: { kind: string; options?: Option[] } };

const literal = (value: string) => ({ type: 'literal' as const, value });
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * The choices of a Choice from the options an entity reports: one for each (label the option, Selected when the entity is that option, When chosen
 * `select_option`), the first {@link MAX_CHOICES}. Ids are the option's words, made unique.
 */
export function choicesFromOptions(entityId: string, sourceId: string, options: readonly string[]): { choices: Option[]; cut: number } {
  const taken = new Set<string>();
  const domain = entityId.split('.')[0];
  const choices = options.slice(0, MAX_CHOICES).map((label, at) => {
    let id = slug(label) || `choice-${at + 1}`, count = 1;
    const base = id;
    while (taken.has(id)) id = `${base}-${++count}`;
    taken.add(id);
    return {
      id, label,
      selectedWhen: { type: 'state', sourceId, path: ['state'], in: [label] },
      action: { type: 'call-service', domain, service: 'select_option', target: { entity_id: literal(entityId) }, data: { type: 'object', fields: { option: literal(label) } } },
    };
  });
  return { choices, cut: Math.max(0, options.length - MAX_CHOICES) };
}

/** One choice's page (pushed): Label, Selected when, When chosen, and Remove Choice at the foot (a Choice keeps 2). */
function ChoicePage({ path, index }: { path: EditorPath; index: number }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const node = valueAt(document, path) as Choice | undefined;
  const option = node?.props.options?.[index];
  if (!node || !option) return null;
  const optionPath = [...path, 'props', 'options', index], count = node.props.options!.length;
  return <div className="w2-editor-page" data-testid="choice-page">
    <div className="w2-row"><label className="field"><span>Label</span><TextInput label="Label" value={option.label} maxLength={240} onCommit={text => onChange(replaceAt(document, [...optionPath, 'label'], text))}/></label></div>
    <ObjectRows path={optionPath} owner="choice-option" skip={at => at.at(-1) === 'id' || at.at(-1) === 'label'}/>
    <div className="w2-editor-foot-inline"><button type="button" className="w2-remove" disabled={count <= 2} onClick={() => {
      onChange(replaceAt(document, [...path, 'props', 'options'], node.props.options!.filter((_, at) => at !== index)));
      push?.pop();
    }}>Remove Choice</button></div>
    {count <= 2 && <p className="w2-caption">A choice needs 2 choices.</p>}
  </div>;
}

/** The Choices group of a Choice: a 44 px row for each choice, Add Choice (up to 12) and Fill From an Entity…. */
export default function ChoicesGroup({ path }: { path: EditorPath }) {
  const { document, onChange, onError } = useRows();
  const push = usePush();
  const env = useDraftEnvironment(document), tag = useDataTag();
  const { house } = useWorkspaceData();
  const [replacing, setReplacing] = useState<{ entityId: string; choices: Option[]; cut: number; total: number; sourceId: string; document: typeof document }>();
  const [said, setSaid] = useState('');
  const node = valueAt(document, path) as Choice | undefined;
  if (!node) return null;
  const options = node.props.options ?? [];
  const write = (next: Option[], base = document) => onChange(replaceAt(base, [...path, 'props', 'options'], next));
  const move = (at: number, offset: number) => { const next = [...options]; const [moved] = next.splice(at, 1); next.splice(at + offset, 0, moved); write(next); };
  const selected = (option: Option) => Boolean(env) && evaluatePredicate(option.selectedWhen as never, env!) === 'yes';
  const add = () => {
    const id = createId('choice');
    write([...options, { id, label: `Choice ${options.length + 1}`, selectedWhen: { type: 'compare', op: 'eq', left: literal(''), right: literal(id) }, action: defaultAction('call-service', document) }]);
  };
  const fill = (entityId: string) => {
    const reported = house?.states?.get(entityId)?.options;
    if (!reported?.length) { onError(`Home Assistant reports no options for ${entityId}.`); return; }
    const made = ensureSource(document, entityId);
    const { choices, cut } = choicesFromOptions(entityId, made.sourceId, reported);
    if (choices.length < 2) { onError('A choice needs at least 2 options.'); return; }
    const line = cut > 0 ? `Home Assistant reports ${reported.length} options. The first ${MAX_CHOICES} were added.` : '';
    if (options.length > 0) { setReplacing({ entityId, choices, cut, total: reported.length, sourceId: made.sourceId, document: made.document }); return; }
    write(choices, made.document); setSaid(line);
  };
  const open = (at: number) => push?.push({ title: options[at].label, body: <ChoicePage path={path} index={at}/> });
  return <section className="w2-group" data-group="choices" aria-label="Choices">
    <h3 className="w2-group-title">Choices · {options.length} of {MAX_CHOICES}</h3>
    <ul className="w2-tab-list">
      {options.map((option, at) => {
        const on = selected(option);
        return <li key={option.id} className="w2-tab-row">
          <button type="button" className="w2-tab-open" onClick={() => open(at)} aria-label={`${option.label}${on ? ', selected now' : ''}`}>
            <span className="w2-choice-check" aria-hidden>{on ? <Check size={16}/> : null}</span>
            <span className="w2-page-text"><span className="w2-page-title">{option.label}</span>{on && <span className="w2-page-via">Selected now · {tag}</span>}</span><ChevronRight size={16} aria-hidden/>
          </button>
          <button type="button" className="w2-icon-button" aria-label={`Move ${option.label} up`} disabled={at === 0} onClick={() => move(at, -1)}><ArrowUp size={16} aria-hidden/></button>
          <button type="button" className="w2-icon-button" aria-label={`Move ${option.label} down`} disabled={at === options.length - 1} onClick={() => move(at, 1)}><ArrowDown size={16} aria-hidden/></button>
          <button type="button" className="w2-icon-button" aria-label={`Remove ${option.label}`} disabled={options.length <= 2} onClick={() => write(options.filter((_, index) => index !== at))}><Trash2 size={16} aria-hidden/></button>
        </li>;
      })}
    </ul>
    <div className="w2-tabs-add">
      <button type="button" disabled={options.length >= MAX_CHOICES} onClick={add}><Plus size={14} aria-hidden/> Add Choice</button>
      {options.length >= MAX_CHOICES && <p className="w2-caption">{MAX_CHOICES} choices at most.</p>}
    </div>
    <EntityField label="Fill From an Entity…" domains={['select', 'input_select']} onPick={row => fill(row.entityId)}/>
    <OptionsFromEntity path={path}/>
    {said && <p className="w2-caption" role="status">{said}</p>}
    {replacing && <div className="w2-row" role="alertdialog" aria-label="Replace choices">
      <p>Replace {options.length} {options.length === 1 ? 'choice' : 'choices'}?</p>
      <div className="w2-editor-foot-inline"><button type="button" onClick={() => setReplacing(undefined)}>Cancel</button>
        <button type="button" className="w2-primary" onClick={() => { write(replacing.choices, replacing.document); setSaid(replacing.cut > 0 ? `Home Assistant reports ${replacing.total} options. The first ${MAX_CHOICES} were added.` : ''); setReplacing(undefined); }}>Replace</button></div>
    </div>}
    {options.length > PHONE_CHOICES && <p className="w2-caption">More than {PHONE_CHOICES} choices may be cut on a phone.</p>}
  </section>;
}
