import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { Icon } from '../../ui';
import EntityList from '../pickers/EntityList';
import { recents, remember } from '../pickers/entities';
import { tileTypes, type Made, type TileType } from './catalog';
import { canHold, ownerTitle, type Destination } from './insert';
import { makeForEntity } from './catalog';
import './add.css';

/** What a pick asks the host to insert. */
export type AddChoice = { made: Made; type: string };

const lucide: Record<string, string> = { power: 'bolt', 'arrow-right-circle': 'play', 'rows-3': 'layers', 'layout-grid': 'grid', 'gallery-horizontal': 'layers', list: 'list', 'rectangle-horizontal': 'plus', type: 'message', settings: 'settings', 'toggle-right': 'toggle' };

/** Tile types the destination accepts, most recently used first (types it cannot hold are left out, not disabled). */
export function offeredTypes(document: CompositionDocument, destination: Destination, used: readonly string[]): TileType[] {
  const rank = (type: string) => { const at = used.indexOf(type); return at < 0 ? 99 : at; };
  return tileTypes.filter(type => canHold(document, destination.owner, type.type)).sort((a, b) => rank(a.type) - rank(b.type));
}

/**
 * The Add picker's content (spec 5.4): "Add to <container>", a search, Tiles and Entities. A tile type that needs an entity
 * goes to Entities with its domains set; an entity added directly becomes the tile that fits its domain, already bound.
 */
export default function AddPicker({ document, destination, onChoose, onClose }: { document: CompositionDocument; destination: Destination; onChoose: (choice: AddChoice) => void; onClose: () => void }) {
  const [segment, setSegment] = useState<'tiles' | 'entities'>('tiles');
  const [query, setQuery] = useState('');
  const [wanted, setWanted] = useState<TileType>();
  const used = useMemo(() => recents('tiles'), []);
  const types = useMemo(() => offeredTypes(document, destination, used), [document, destination, used]);
  const needle = query.trim().toLowerCase();
  const shown = types.filter(type => !needle || type.name.toLowerCase().includes(needle));
  const title = ownerTitle(document, destination.owner) || 'this page';
  const choose = (type: TileType) => {
    if (type.domains) { setWanted(type); setSegment('entities'); return; }
    remember('tiles', type.type);
    onChoose({ type: type.type, made: type.make({ document }) });
  };
  return <div className="w2-add" data-testid="add-picker">
    <header className="w2-add-head"><h2>Add to {title}</h2><button type="button" onClick={onClose}>Cancel</button></header>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Search tiles and entities" aria-label="Search tiles and entities" value={query} autoFocus onChange={event => { setQuery(event.target.value); if (event.target.value && segment === 'tiles' && !types.some(type => type.name.toLowerCase().includes(event.target.value.toLowerCase()))) setSegment('entities'); }}
      onKeyDown={event => { if (event.key === 'Enter' && segment === 'tiles' && shown[0]) choose(shown[0]); }}/></label>
    <div className="w2-segment-pill w2-add-segment" role="group" aria-label="Kind">
      {(['tiles', 'entities'] as const).map(item => <button key={item} type="button" aria-pressed={segment === item} onClick={() => { setSegment(item); if (item === 'tiles') setWanted(undefined); }}>{item === 'tiles' ? 'Tiles' : 'Entities'}</button>)}
    </div>
    {segment === 'tiles' ? <div className="w2-add-grid" role="list" aria-label="Tiles">
      {shown.length === 0 && <p className="w2-empty">Nothing matches.</p>}
      {shown.map(type => <button key={type.type} type="button" role="listitem" className="w2-add-tile" data-type={type.type} onClick={() => choose(type)}>
        <span className="w2-entity-icon"><Icon name={lucide[type.glyph] ?? 'grid'} size={18}/></span><span>{type.name}</span></button>)}
    </div> : <EntityList hideSearch query={query} kind="add" domains={wanted?.domains} height={320} autoFocus={false}
      onPick={row => { const type = wanted ?? undefined; remember('tiles', (type ?? makeForEntity(document, row.entityId, row.name).node).type as string);
        onChoose({ type: type?.type ?? 'entity', made: type ? type.make({ document, entityId: row.entityId, name: row.name !== row.entityId ? row.name : undefined }) : makeForEntity(document, row.entityId, row.name !== row.entityId ? row.name : undefined) }); }}/>}
    {wanted && segment === 'entities' && <p className="w2-caption">Choose an entity for the {wanted.name}.</p>}
  </div>;
}
