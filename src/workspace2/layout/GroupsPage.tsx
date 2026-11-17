import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { groupStates, type GridGroups } from '../../shared/composition/grid-groups';
import { LabeledRow, Switch, TextInput } from '../editors/controls';
import { useRows } from '../rows';
import { addGroup, canAddGroup, moveGroup, presetGroups, removeGroup, retitle, stateWords, tickState } from './groups-model';

/**
 * The page the Group by State row opens (`build/design/sim-fidelity-contract.md`, section 3): a switch, off by default; then a card per group with its Title and
 * three boxes, On, Off and Unavailable, Move Up and Move Down, and Add Group. Ticking a state in one group unticks it in the others, so a state is in exactly one group.
 */
export default function GroupsPage({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const node = valueAt(document, path) as { type?: string; props: { groups?: GridGroups } & Record<string, unknown> } | undefined;
  if (!node || node.type !== 'tile-grid') return null;
  const groups = node.props.groups;
  const write = (next: GridGroups | undefined) => {
    const props = { ...node.props } as Record<string, unknown>;
    if (next) props.groups = next; else delete props.groups;
    onChange(replaceAt(document, [...path, 'props'], props));
  };
  return <div className="w2-editor-page" data-testid="groups-page" data-field-path={[...path, 'props', 'groups'].join('/')}>
    <Switch label="Group by State" checked={groups !== undefined} onChange={on => write(on ? presetGroups() : undefined)}/>
    {groups === undefined && <p className="w2-caption">Tiles sit under a heading for their state. Off unless you turn it on.</p>}
    {groups && <>
      {groups.items.map((group, at) => <div key={group.id} className="w2-group-card" data-testid="group-card" data-group-id={group.id}>
        <LabeledRow label="Title"><TextInput label={`Title of group ${at + 1}`} value={group.title} maxLength={80} onCommit={text => { if (text.trim()) write(retitle(groups, group.id, text)); }}/></LabeledRow>
        {groupStates.map(state => <label key={state} className="w2-switch-row">
          <span className="w2-row-label">{stateWords[state]}</span>
          <input type="checkbox" aria-label={`${stateWords[state]} in ${group.title}`} checked={group.states.includes(state)} onChange={() => write(tickState(groups, group.id, state))}/>
        </label>)}
        <div className="w2-group-actions">
          <button type="button" className="w2-link-button" disabled={at === 0} aria-label={`Move ${group.title} Up`} onClick={() => write(moveGroup(groups, group.id, -1))}>Move Up</button>
          <button type="button" className="w2-link-button" disabled={at === groups.items.length - 1} aria-label={`Move ${group.title} Down`} onClick={() => write(moveGroup(groups, group.id, 1))}>Move Down</button>
          <button type="button" className="w2-link-button" disabled={groups.items.length < 2} aria-label={`Remove ${group.title}`} onClick={() => write(removeGroup(groups, group.id))}>Remove Group</button>
        </div>
      </div>)}
      <button type="button" className="w2-add-row" disabled={!canAddGroup(groups)} onClick={() => write(addGroup(groups))}>Add Group</button>
      {!canAddGroup(groups) && <p className="w2-caption" data-testid="groups-full">Every state is in a group.</p>}
      <p className="w2-caption">Tiles sit under a heading for their state. A group with no tiles is not shown.</p>
      <p className="w2-caption">Tiles keep the grid’s order inside a group.</p>
    </>}
  </div>;
}
