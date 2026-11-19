import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Plus, Search } from 'lucide-react';
import { fetchEntityAreas, fetchHaEntities, type EntityAreas, type HaEntity } from '../../api';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { modelChoices, sourceName, sourceUses, type Source } from '../dialogs/sources';
import { LibraryGroup } from '../Disclosure';
import type { Library } from '../useLibrary';
import type { Workspace2 } from '../useWorkspace2';
import { entityReaders, matches } from '../flows/model';
import { sourceEntity } from '../add/sources';
import './data.css';

export const appTopicWords: Record<string, string> = { window: 'Window', clock: 'Clock', os: 'This Phone', notifications: 'Notifications', preferences: 'App Settings' };
const friendly = (name: string, id: string) => name !== id ? name : id.split('.')[1]?.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()) ?? 'Entity';
const noSubscribe = () => () => {};
const zero = () => 0;

function EntityRow({ entity, uses }: { entity: HaEntity; uses: readonly string[] }) {
  const { live } = useWorkspaceData();
  useSyncExternalStore(live ? listener => live.subscribe(keys => { if (keys.includes(entity.entityId)) listener(); }) : noSubscribe, live ? () => live.versionOf(entity.entityId) : zero);
  const state = live?.states.get(entity.entityId);
  const text = state ? `${state.state}${state.unit ? ` ${state.unit}` : ''}` : `${entity.state}${entity.unit ? ` ${entity.unit}` : ''}`;
  return <li className="w2-ha-entity">
    <div className="w2-ha-entity-head"><span className="w2-data-name">{friendly(state?.name ?? entity.name, entity.entityId)}</span><span className="w2-ha-state">{text || 'Unavailable'}</span></div>
    {uses.length > 0 && <small className="w2-ha-readers" title={uses.join(', ')}>{uses.join(', ')}</small>}
  </li>;
}

/** Home Assistant is a read-only catalog; App and Models remain authored sources. */
export default function DataPanel({ ws, library, onError }: { ws: Workspace2; library: Library; onError: (message: string) => void }) {
  const document = ws.document!, { entities } = useWorkspaceData();
  const [query, setQuery] = useState(''), [everything, setEverything] = useState(false);
  const [catalog, setCatalog] = useState<HaEntity[]>(), [areas, setAreas] = useState<EntityAreas>();
  const [catalogError, setCatalogError] = useState(''), [areaError, setAreaError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const next = await fetchHaEntities(); if (active) { setCatalog(next); setCatalogError(''); } }
      catch (error) { if (active) setCatalogError(error instanceof Error ? error.message : String(error)); }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    void fetchEntityAreas().then(next => { if (active) setAreas(next); }, error => { if (active) setAreaError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const readers = useMemo(() => entityReaders(document), [document]);
  const uses = useMemo(() => sourceUses(document), [document]);
  const names = useMemo(() => new Map(entities.map(row => [row.entityId, row.name])), [entities]);
  const all = useMemo(() => {
    const rows = new Map((catalog ?? entities.map(row => ({ entityId: row.entityId, name: row.name, state: row.state ?? '' }))).map(row => [row.entityId, row]));
    // Keep an authored read visible if Home Assistant temporarily doesn't have the entity.
    for (const id of readers.keys()) if (!rows.has(id)) rows.set(id, { entityId: id, name: names.get(id) ?? id, state: 'Unavailable' });
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog, entities, readers, names]);
  const areaNames = new Map(areas?.areas.map(area => [area.id, area.name]));
  const membership = new Map(areas?.entities.map(entity => [entity.entityId, entity]));
  const inUse = all.filter(entity => readers.has(entity.entityId));
  const selectedName = ws.selection ? ws.index?.get(ws.selection)?.node?.title : document.componentLibrary?.find(entry => entry.id === ws.templateId)?.name;
  const openEntity = sourceEntity(document.dataSources.find(source => source.id === ws.flowId));
  const grouped = new Map<string, { title: string; entities: HaEntity[] }>();
  for (const entity of everything ? all : inUse) {
    const meta = membership.get(entity.entityId), area = meta?.areaId ?? '', title = areaNames.get(area) ?? 'No Area';
    if (!matches(query, entity.name, entity.entityId, title, meta?.device ?? '')) continue;
    const group = grouped.get(area) ?? { title, entities: [] };
    group.entities.push(entity); grouped.set(area, group);
  }
  const groups = [...grouped].sort(([a, left], [b, right]) => !a ? 1 : !b ? -1 : left.title.localeCompare(right.title));
  const models = document.dataSources.filter(source => source.kind === 'model' && source.model !== 'pipeline@1');
  const appName = (source: Source) => source.kind === 'model' && source.model === 'app-state@1' ? appTopicWords[source.inputs.topic] ?? sourceName(source, names) : sourceName(source, names);
  const plainGroup = (title: string, sources: Source[]) => {
    const shown = sources.filter(source => matches(query, appName(source)));
    if (!shown.length) return null;
    return <LibraryGroup id={`data.${title}`} title={title} names={shown.map(appName)} library={library} reveal={sources.some(source => source.id === ws.flowId) ? ws.flowId : undefined} searching={Boolean(query.trim())}>
      <ul className="w2-data-list">{shown.map(source => {
        const open = ws.flowId === source.id, label = appName(source), count = uses.get(source.id) ?? 0;
        return <li key={source.id} className="w2-data-plain"><button type="button" className="w2-data-row" aria-current={open || undefined} aria-label={`${label}, source, used by ${count}`} onClick={() => ws.openFlow(open ? undefined : source.id)}>
          <span className="w2-data-name">{label}</span><span className="w2-data-used">Used by {count}</span>
        </button></li>;
      })}</ul>
    </LibraryGroup>;
  };
  return <div className="w2-data-panel" data-testid="data-panel">
    <p className="w2-data-count">From Home Assistant · read only</p>
    <div className="w2-segment-pill w2-data-segment" role="group" aria-label="Home Assistant entities">
      <button type="button" aria-pressed={!everything} onClick={() => setEverything(false)}>In Use · {inUse.length}</button>
      <button type="button" aria-pressed={everything} onClick={() => setEverything(true)}>Everything · {all.length}</button>
    </div>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Find an entity, device or area" aria-label="Find an entity, device or area" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div className="w2-lib-scroll">
      {catalogError && <p className="w2-caption" role="status">{catalogError}. Showing entities named by this project.</p>}
      {areaError && <p className="w2-caption" role="status">Areas unavailable: {areaError}. Entities are listed in No Area.</p>}
      {groups.map(([id, group]) => <LibraryGroup key={id} id={`data.area.${id || 'none'}`} title={group.title} names={group.entities.map(entity => friendly(entity.name, entity.entityId))} library={library} searching={Boolean(query.trim())}
        reveal={group.entities.some(entity => entity.entityId === openEntity || selectedName && readers.get(entity.entityId)?.has(selectedName)) ? ws.selection ?? ws.templateId ?? ws.flowId : undefined}>
        <ul className="w2-data-list">{group.entities.map(entity => <EntityRow key={entity.entityId} entity={entity} uses={[...readers.get(entity.entityId) ?? []]}/>)}</ul>
      </LibraryGroup>)}
      {!groups.length && <p className="w2-caption">{query ? 'Nothing matches.' : everything ? 'No Home Assistant entities available.' : 'No entities in use yet.'}</p>}
      {plainGroup('App', models.filter(source => source.kind === 'model' && source.model === 'app-state@1'))}
      {plainGroup('Models', models.filter(source => source.kind === 'model' && source.model !== 'app-state@1'))}
    </div>
    <footer className="w2-data-foot">
      <p className="w2-caption">Listed while a tile or flow reads it. Nothing to add or clean up.</p>
      <Menu.Root><Menu.Trigger className="w2-data-add"><Plus size={16} aria-hidden/>Source</Menu.Trigger>
        <Menu.Portal><Menu.Positioner side="top" sideOffset={6} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu w2-data-sources" aria-label="Add a source">
          {modelChoices().filter(choice => choice.model !== 'pipeline@1').map(choice => <Menu.Item key={choice.model} className="w2-menu-item" onClick={() => {
            try { const made = choice.make(document); ws.studio.apply({ ...document, dataSources: [...document.dataSources, made] }); ws.openFlow(made.id); }
            catch (error) { onError(error instanceof Error ? error.message : String(error)); }
          }}>{choice.name}</Menu.Item>)}
        </Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.Root>
    </footer>
  </div>;
}
