import { useState } from 'react';
import { TextInput } from '../editors/controls';
import { EntityField } from '../pickers/PickerField';
import { robotComplete, robotRows, type RobotParts } from './robot';

/** The robot form: a name, the id its map has in Home Assistant, and one entity for each part a robot needs. "Add Robot" waits until all are chosen. */
export default function RobotForm({ onCreate, onCancel }: { onCreate: (parts: RobotParts) => void; onCancel: () => void }) {
  const [parts, setParts] = useState<Partial<RobotParts>>({ title: '', vacuumMapId: '' });
  const set = (patch: Partial<RobotParts>) => setParts(old => ({ ...old, ...patch }));
  const complete = robotComplete(parts);
  return <div className="w2-robot-form">
    <div className="w2-row"><label className="field"><span>Name</span><TextInput label="Name" value={parts.title ?? ''} maxLength={80} onCommit={title => set({ title })}/></label></div>
    {robotRows.map(row => <EntityField key={row.key} label={row.label} entityId={parts[row.key]} domains={row.domains} onPick={picked => set({ [row.key]: picked.entityId, ...(row.key === 'entityId' && !parts.vacuumMapId ? { vacuumMapId: picked.entityId.split('.')[1] } : {}), ...(row.key === 'entityId' && !parts.title?.trim() ? { title: picked.name } : {}) })}/>)}
    <div className="w2-row"><label className="field"><span>Map ID</span><TextInput label="Map ID" value={parts.vacuumMapId ?? ''} onCommit={vacuumMapId => set({ vacuumMapId })}/></label>
      <p className="w2-caption">The id the robot’s map has in Home Assistant, in lowercase words with underscores.</p></div>
    <div className="w2-editor-foot-inline"><button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="w2-primary" disabled={!complete} onClick={() => complete && onCreate(parts)}>Add Robot</button></div>
  </div>;
}
