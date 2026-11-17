import { useState } from 'react';
import { request } from '../../api';
import { buildStateMap, styleFromEntity, type HaState, type StateMapDraft } from '../../shared/composition/state-style-library';
import { suggestBuiltInStyle } from '../../shared/composition/state-styles';
import { Tag, usePush } from '../kit';
import { TextInput } from '../editors/controls';
import EntityList from '../pickers/EntityList';
import type { EntityRow } from '../pickers/entities';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { useRows } from '../rowsContext';
import { StylePage } from './StylePage';
import { ClassDot } from './StateMenu';
import { classWord, stateName } from './words';

/** What `/native/api/ha/entity-states` answers for an entity. */
export interface EntityStates { entityId: string; deviceClass?: string; states: HaState[]; history: string[]; openEnded: boolean }

/**
 * New Style From an Entity…: the entity picker, then the states Home Assistant knows for it as a state map. States seen only in
 * history are listed under "Not Classified" with a warning, resting until the author gives them a class. Not connected, the
 * entity's states cannot be read, so the page says so and points at duplicating a built-in style.
 */
export function NewFromEntity() {
  const { document, onChange, onError } = useRows();
  const { connected } = useWorkspaceData();
  const push = usePush();
  const [picked, setPicked] = useState<{ row: EntityRow; states: EntityStates; draft: StateMapDraft }>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!connected) return <div className="w2-new-style-page"><p className="w2-caption">Home Assistant isn’t connected, so the entity’s states can’t be read.</p><p className="w2-caption">Duplicate a built-in style instead.</p></div>;
  const pick = async (row: EntityRow) => {
    setBusy(true);
    try {
      const states = await request<EntityStates>(`/native/api/ha/entity-states?entityId=${encodeURIComponent(row.entityId)}`);
      setPicked({ row, states, draft: buildStateMap(row.entityId, states.states, states.history, states.deviceClass, states.openEnded) });
      setName(`${row.name} states`);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (!picked) return <div className="w2-new-style-page"><p className="w2-caption">Choose the entity whose states the style should follow.</p>
    <EntityList kind="styles" height={320} autoFocus={false} onPick={row => void pick(row)}/>{busy && <p role="status" className="w2-caption">Reading the states.</p>}</div>;
  const { row, states, draft } = picked;
  const create = () => {
    const made = styleFromEntity(row.entityId, name.trim(), draft);
    const base = suggestBuiltInStyle(row.entityId, states.deviceClass);
    const style = { ...made, ...(base ? { base } : {}) };
    onChange({ ...document, stateStyles: { type: 'state-styles@1', styles: [...(document.stateStyles?.styles ?? []), style] } });
    push?.pop(); push?.push({ title: style.name, body: <StylePage id={style.id}/> });
  };
  return <div className="w2-new-style-page">
    <p className="w2-caption">From {row.name}: {states.states.length} {states.states.length === 1 ? 'state' : 'states'} from Home Assistant.</p>
    <ul className="w2-state-rows" aria-label="States found">
      {draft.rules.map((rule, at) => <li key={at} className="w2-state-row"><span className="w2-link-row"><ClassDot stateClass={rule.class}/>
        <span className="w2-style-text"><span className="w2-page-title">{rule.states.map(stateName).join(', ')}</span><span className="w2-page-via">{classWord[rule.class]}</span></span></span></li>)}
    </ul>
    {draft.unclassified.length > 0 && <section aria-label="Not Classified"><h3 className="w2-group-title">Not Classified</h3>
      <p className="w2-caption"><Tag tone="warning">Warning</Tag> {draft.unclassified.map(stateName).join(', ')}. These rest until you give them a class.</p></section>}
    <div className="w2-row"><div className="field"><span>Name</span><TextInput label="Name of the new style" value={name} maxLength={80} onCommit={setName}/></div></div>
    <div className="w2-editor-foot-inline"><button type="button" onClick={() => setPicked(undefined)}>Choose Another</button><button type="button" className="w2-primary" disabled={!name.trim()} onClick={create}>Create Style</button></div>
  </div>;
}
