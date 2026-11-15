import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { sourceName } from '../dialogs/sources';
import { sourceEntity } from '../add/sources';
import { PickerRow } from './PickerField';
import EntityList from './EntityList';
import { useWorkspaceData } from './WorkspaceData';
import type { EntityRow } from './entities';
import './pickers.css';

type Source = CompositionDocument['dataSources'][number];

/** A data source's name for the "Models" group, matched against the search words. */
export const matchesSource = (name: string, id: string, query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${name} ${id}`.toLowerCase();
  return words.every(word => haystack.includes(word));
};

/**
 * The field for the data a node reads. It names the entity by its friendly name with the id second, or the model source by its
 * words. Its picker is the entity picker (name, id, area and domain search) when the node reads one entity, with a "Models"
 * group of the other sources the node may use; a node that reads a model only has the group.
 */
export default function SourceField({ label, path, current, acceptsEntity, models, domains, onPickEntity, onPickSource }: {
  label: string; path?: string; current?: Source; acceptsEntity: boolean; models: readonly Source[]; domains?: readonly string[];
  onPickEntity: (row: EntityRow) => void; onPickSource: (sourceId: string) => void;
}) {
  const { entities } = useWorkspaceData();
  const names = useMemo(() => new Map(entities.map(row => [row.entityId, row.name])), [entities]);
  const entityId = current ? sourceEntity(current) : undefined;
  const primary = !current ? <span className="w2-placeholder">Choose</span> : entityId ? names.get(entityId) ?? entityId : sourceName(current, names);
  const secondary = !current ? undefined : entityId ? (names.has(entityId) && names.get(entityId) !== entityId ? entityId : undefined) : current.id;
  return <PickerRow label={label} title={label} path={path} primary={primary} secondary={secondary}>
    {close => <SourcePicker acceptsEntity={acceptsEntity} models={models} current={current?.id} names={names} domains={domains}
      onPickEntity={row => { onPickEntity(row); close(); }} onPickSource={id => { onPickSource(id); close(); }}/>}
  </PickerRow>;
}

function SourcePicker({ acceptsEntity, models, current, names, domains, onPickEntity, onPickSource }: {
  acceptsEntity: boolean; models: readonly Source[]; current?: string; names: ReadonlyMap<string, string>; domains?: readonly string[];
  onPickEntity: (row: EntityRow) => void; onPickSource: (sourceId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = models.filter(source => matchesSource(sourceName(source, names), source.id, query));
  return <div className="w2-entity-list">
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder={acceptsEntity ? 'Search entities' : 'Search'} aria-label={acceptsEntity ? 'Search entities' : 'Search'} autoFocus value={query} onChange={event => setQuery(event.target.value)}/></label>
    {shown.length > 0 && <div className="w2-choice-list" role="group" aria-label="Models" style={acceptsEntity ? { maxHeight: 150 } : undefined}>
      <h3 className="w2-group-title">Models</h3>
      <div role="listbox" aria-label="Models" className="w2-model-list">
        {shown.map(source => <button type="button" role="option" key={source.id} aria-selected={source.id === current} className="w2-choice" data-choice={source.id} onClick={() => onPickSource(source.id)}>
          <span className="w2-entity-text"><span className="w2-entity-name">{sourceName(source, names)}</span><code className="w2-entity-id">{source.id}</code></span></button>)}
      </div>
    </div>}
    {acceptsEntity ? <EntityList hideSearch query={query} domains={domains} height={shown.length ? 240 : 320} autoFocus={false}
      onPick={onPickEntity}/> : shown.length === 0 && <p className="w2-empty">Nothing matches.</p>}
  </div>;
}
