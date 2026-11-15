import { useMemo, useState } from 'react';
import { Tag, usePush } from '../kit';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { ObjectRows, useRows } from '../rows';
import { PushRow } from './parts';
import { modelChoices, removeUnusedSources, sourceName, sourceUses, type Source } from './sources';

/** One source's fields, found by its id so an edit that reorders the list cannot point at another source. */
function SourceFields({ id }: { id: string }) {
  const { document } = useRows();
  const at = document.dataSources.findIndex(source => source.id === id);
  if (at < 0) return null;
  const source = document.dataSources[at];
  return <ObjectRows path={['dataSources', at]} owner={source.kind === 'model' ? source.model : 'entity-source'}/>;
}

/** The models a new source can be; choosing one adds it and opens its fields. */
function AddSource() {
  const { document, onChange } = useRows();
  const push = usePush();
  const [query, setQuery] = useState('');
  const choices = useMemo(() => modelChoices(), []);
  const shown = choices.filter(choice => choice.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <label className="w2-search"><span className="w2-sr">Search data</span><input type="search" placeholder="Search data" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <ul className="w2-list">{shown.map(choice => <li key={choice.model}><button type="button" className="w2-list-row" onClick={() => {
      const made = choice.make(document);
      onChange({ ...document, dataSources: [...document.dataSources, made] });
      push?.pop();
      push?.push({ title: choice.name, body: <SourceFields id={made.id}/> });
    }}>{choice.name}</button></li>)}</ul>
    {shown.length === 0 && <p className="w2-empty">No data yet.</p>}
  </>;
}

/** Project > Data (spec 5.7): sources in "Entities" and "Models", each with what reads it; a row pushes its fields. */
export default function Data() {
  const { document, onChange } = useRows();
  const push = usePush();
  const { entities } = useWorkspaceData();
  const [query, setQuery] = useState('');
  const names = useMemo(() => new Map(entities.map(row => [row.entityId, row.name])), [entities]);
  const uses = useMemo(() => sourceUses(document), [document]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = document.dataSources.map(source => ({ source, name: sourceName(source, names) }))
    .filter(({ source, name }) => words.every(word => `${name} ${source.id}`.toLowerCase().includes(word)));
  const unused = document.dataSources.filter(source => !uses.get(source.id)).length;
  const group = (title: string, items: typeof rows) => items.length > 0 && <section aria-label={title}>
    <h3 className="w2-group-title">{title}</h3>
    <ul className="w2-list">{items.map(({ source, name }) => {
      const count = uses.get(source.id) ?? 0;
      return <PushRow key={source.id} title={name} detail={source.id} tags={count > 0 ? <span className="w2-summary w2-used">Used by {count}</span> : <Tag>Unused</Tag>}
        onOpen={() => push?.push({ title: name, body: <SourceFields id={source.id}/> })}/>;
    })}</ul>
  </section>;
  return <div className="w2-data">
    {document.dataSources.length > 0 && <label className="w2-search"><span className="w2-sr">Search data</span><input type="search" placeholder="Search data" value={query} onChange={event => setQuery(event.target.value)}/></label>}
    {document.dataSources.length === 0 && <p className="w2-empty">No data yet.</p>}
    {group('Entities', rows.filter(item => item.source.kind === 'ha-entity'))}
    {group('Models', rows.filter(item => item.source.kind !== 'ha-entity'))}
    <div className="w2-actions">
      <button type="button" onClick={() => push?.push({ title: 'Add Source', body: <AddSource/> })}>Add Source</button>
      <button type="button" disabled={unused === 0} onClick={() => onChange(removeUnusedSources(document))}>Remove Unused</button>
    </div>
  </div>;
}

export type { Source };
