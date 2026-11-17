import { X } from 'lucide-react';
import { PickerRow } from '../pickers/PickerField';
import EntityList from '../pickers/EntityList';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { domainName } from '../pickers/entities';
import { flowLimits } from './flow';

/** "42 lights" when every entity shares a domain, else "42 entities"; the second line is the first two names and "and 40 more". */
export function entitiesWords(ids: readonly string[], names: ReadonlyMap<string, string>): { primary: string; secondary: string } {
  const domains = new Set(ids.map(id => id.split('.')[0]));
  const noun = domains.size === 1 ? domainName([...domains][0]).toLowerCase().replace(/s?$/, 's') : 'entities';
  const first = ids.slice(0, 2).map(id => names.get(id) ?? id).join(', ');
  return { primary: `${ids.length} ${ids.length === 1 ? noun.replace(/ies$/, 'y').replace(/s$/, '') : noun}`, secondary: ids.length > 2 ? `${first} and ${ids.length - 2} more` : first };
}

/**
 * A multi-select of the entity picker (up to 64): a pick adds an entity, a chip removes one, and the count is announced after each change ("42 of 64 chosen").
 * Past the limit the picker says "64 entities at most." and takes no more.
 */
export default function EntitiesChooser({ label, ids, max = flowLimits.entities.max, onChange, path }: { label: string; ids: readonly string[]; max?: number; onChange: (ids: string[]) => void; path?: string }) {
  const { entities } = useWorkspaceData();
  const names = new Map(entities.map(row => [row.entityId, row.name]));
  const words = entitiesWords(ids, names);
  const full = ids.length >= max;
  return <PickerRow label={label} title={label} path={path} stacked primary={ids.length ? words.primary : <span className="w2-placeholder">Choose</span>} secondary={ids.length ? words.secondary : undefined} popupClassName="w2-data-entities-pop">
    {() => <div className="w2-data-entities">
      <p role="status" aria-live="polite" className="w2-caption">{`${ids.length} of ${max} chosen`}{full ? ` · ${flowLimits.entities.words}` : ''}</p>
      {ids.length > 0 && <ul className="w2-data-chips" aria-label="Chosen">{ids.map(id => <li key={id}><button type="button" className="w2-chip" aria-label={`Remove ${names.get(id) ?? id}`} onClick={() => ids.length > 1 && onChange(ids.filter(item => item !== id))}>{names.get(id) ?? id}<X size={12} aria-hidden/></button></li>)}</ul>}
      {!full && <EntityList onPick={row => { if (!ids.includes(row.entityId)) onChange([...ids, row.entityId]); }} autoFocus={false}/>}
    </div>}
  </PickerRow>;
}
