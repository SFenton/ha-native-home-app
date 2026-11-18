import { useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { request } from '../../api';
import { buildStateMap, newStateTile, styleFromEntity } from '../../shared/composition/state-style-library';
import { suggestBuiltInStyle } from '../../shared/composition/state-styles';
import type { CompositionDocument } from '../../shared/composition/schema';
import { Icon } from '../../ui';
import EntityList from '../pickers/EntityList';
import { recents, remember } from '../pickers/entities';
import { NO_STYLE_FITS, tileChoices, tileKinds, tileTypes, type Made, type TileType } from './catalog';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import type { EntityRow } from '../pickers/entities';
import { canHold, ownerTitle, type Destination } from './insert';
import { makeForEntity } from './catalog';
import RobotAsk from './RobotAsk';
import './add.css';

/** What a pick asks the host to insert. */
export type AddChoice = { made: Made; type: string };

export const lucide: Record<string, string> = { power: 'bolt', 'arrow-right-circle': 'play', 'rows-3': 'layers', 'layout-list': 'list', repeat: 'layers', shapes: 'sparkles', sparkles: 'sparkles', chart: 'activity', gauge: 'circlegauge', 'layout-grid': 'grid', 'gallery-horizontal': 'layers', list: 'list', 'rectangle-horizontal': 'plus', type: 'message', settings: 'settings', 'toggle-right': 'toggle' };
// The Add glyphs of the gauge parts (`sh.dial@1`, `sh.arc-track@1`).
Object.assign(lucide, { dial: 'circlegauge', 'dial-control': 'circlegauge', 'arc-track': 'sunrise' });

/** Tile types the destination accepts, most recently used first (types it cannot hold are left out, not disabled). */
export function offeredTypes(document: CompositionDocument, destination: Destination, used: readonly string[]): TileType[] {
  const rank = (key: string) => { const at = used.indexOf(key); return at < 0 ? 99 : at; };
  return tileTypes.filter(type => canHold(document, destination.owner, type.type)).sort((a, b) => rank(a.key) - rank(b.key));
}

/**
 * The Add picker's content (spec 5.4): "Add to <container>", a search, Tiles, Templates (on a phone) and Entities. A tile type that needs an entity
 * goes to Entities with its domains set; an entity added directly becomes the tile that fits its domain, already bound.
 */
export default function AddPicker({ document, destination, onChoose, onClose, initialType, templates }: { document: CompositionDocument; destination: Destination; onChoose: (choice: AddChoice) => void; onClose: () => void; /** The Templates segment's list for a search (the phone's Add sheet; wide, templates are in the library). Without it there is no segment. */ templates?: (query: string) => ReactNode; /** A type chosen in the library that needs an entity: the picker opens on the Entities segment for it. */ initialType?: string }) {
  const [segment, setSegment] = useState<'tiles' | 'templates' | 'entities'>(initialType && !tileTypes.find(type => type.key === initialType)?.asks ? 'entities' : 'tiles');
  const [query, setQuery] = useState('');
  const [wanted, setWanted] = useState<TileType | undefined>(() => initialType && !tileTypes.find(type => type.key === initialType)?.asks ? tileTypes.find(type => type.key === initialType) : undefined);
  // A tile is not one thing: "Tile" asks what it should do before anything is added.
  const [asking, setAsking] = useState(false);
  // A map asks which robot it shows before anything is added.
  const [robotAsk, setRobotAsk] = useState(() => Boolean(initialType && tileTypes.find(type => type.key === initialType)?.asks));
  // A state tile for an entity no style fits asks to make one from the entity's states first.
  const [styling, setStyling] = useState<{ row: EntityRow; busy: boolean; error?: string }>();
  const { connected } = useWorkspaceData();
  const used = useMemo(() => recents('tiles'), []);
  const types = useMemo(() => offeredTypes(document, destination, used), [document, destination, used]);
  const needle = query.trim().toLowerCase();
  const hasTile = types.some(type => tileKinds.includes(type.key));
  const shown = types.filter(type => !tileKinds.includes(type.key) && (!needle || type.name.toLowerCase().includes(needle)));
  const showTile = hasTile && (!needle || 'tile'.includes(needle) || tileChoices.some(choice => `${choice.name} ${choice.detail}`.toLowerCase().includes(needle)));
  const title = ownerTitle(document, destination.owner) || 'this page';
  const searchWords = templates ? 'Search tiles, templates and entities' : 'Search tiles and entities';
  const choose = (type: TileType) => {
    if (type.asks === 'robot') { setRobotAsk(true); return; }
    if (type.domains) { setWanted(type); setSegment('entities'); return; }
    remember('tiles', type.key);
    onChoose({ type: type.key, made: type.make({ document }) });
  };
  const makeStyle = async (row: EntityRow) => {
    setStyling({ row, busy: true });
    try {
      const states = await request<{ deviceClass?: string; states: { state: string; name?: string }[]; history: string[]; openEnded: boolean }>(`/native/api/ha/entity-states?entityId=${encodeURIComponent(row.entityId)}`);
      const draft = buildStateMap(row.entityId, states.states, states.history, states.deviceClass, states.openEnded);
      const base = suggestBuiltInStyle(row.entityId, states.deviceClass);
      const style = { ...styleFromEntity(row.entityId, `${row.name} states`, draft), ...(base ? { base } : {}) };
      const node = newStateTile(row.entityId, row.name !== row.entityId ? row.name : row.entityId, states.deviceClass, { type: 'state-styles@1', styles: [style] })!;
      onChoose({ type: 'state-tile', made: { node, sources: [], stateStyles: [style] } });
    } catch (error) { setStyling({ row, busy: false, error: error instanceof Error ? error.message : String(error) }); }
  };
  if (styling) return <div className="w2-add" data-testid="add-picker">
    <header className="w2-add-head"><h2>Add to {title}</h2><button type="button" onClick={onClose}>Cancel</button></header>
    <h3 className="w2-add-question">{NO_STYLE_FITS}</h3>
    <p className="w2-caption">{connected ? `${styling.row.name} has no built-in style. Make one from the states Home Assistant knows for it.` : 'Home Assistant isn’t connected, so the entity’s states can’t be read.'}</p>
    {styling.error && <p role="alert" className="w2-error-text">{styling.error}</p>}
    <button type="button" className="w2-add-tile" disabled={!connected || styling.busy} onClick={() => void makeStyle(styling.row)}>New Style From This Entity…</button>
    <button type="button" className="w2-add-back" onClick={() => setStyling(undefined)}>Back</button>
  </div>;
  if (robotAsk) return <RobotAsk document={document} title={title} onClose={onClose} onBack={() => setRobotAsk(false)} onChoose={(made, sources) => onChoose({ type: 'map', made: { ...made, sources } })}/>;
  if (asking) return <div className="w2-add" data-testid="add-picker">
    <header className="w2-add-head"><h2>Add to {title}</h2><button type="button" onClick={onClose}>Cancel</button></header>
    <h3 className="w2-add-question">What should this tile do?</h3>
    <div className="w2-add-choices" role="list" aria-label="What a tile can do">
      {tileChoices.filter(choice => types.some(type => type.key === choice.type)).map(choice => <button key={choice.type} type="button" role="listitem" className="w2-add-tile w2-add-choice" data-type={choice.type}
        onClick={() => { setAsking(false); choose(types.find(type => type.key === choice.type)!); }}><span className="w2-add-choice-name">{choice.name}</span><span className="w2-add-choice-detail">{choice.detail}</span></button>)}
    </div>
    <button type="button" className="w2-add-back" onClick={() => setAsking(false)}>Back</button>
  </div>;
  return <div className="w2-add" data-testid="add-picker">
    <header className="w2-add-head"><h2>Add to {title}</h2><button type="button" onClick={onClose}>Cancel</button></header>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder={searchWords} aria-label={searchWords} value={query} autoFocus onChange={event => { setQuery(event.target.value); if (event.target.value && segment === 'tiles' && !types.some(type => type.name.toLowerCase().includes(event.target.value.toLowerCase())) && !tileChoices.some(choice => `${choice.name} ${choice.detail}`.toLowerCase().includes(event.target.value.toLowerCase()))) setSegment('entities'); }}
      onKeyDown={event => { if (event.key === 'Enter' && segment === 'tiles' && shown[0]) choose(shown[0]); }}/></label>
    <div className="w2-segment-pill w2-add-segment" role="group" aria-label="Kind">
      {(templates ? ['tiles', 'templates', 'entities'] as const : ['tiles', 'entities'] as const).map(item => <button key={item} type="button" aria-pressed={segment === item} onClick={() => { setSegment(item); if (item === 'tiles') setWanted(undefined); }}>{item === 'tiles' ? 'Tiles' : item === 'templates' ? 'Templates' : 'Entities'}</button>)}
    </div>
    {segment === 'templates' && templates ? <div className="w2-add-templates">{templates(query)}</div> : segment === 'tiles' ? <div className="w2-add-grid" role="list" aria-label="Tiles">
      {shown.length === 0 && !showTile && <p className="w2-empty">Nothing matches.</p>}
      {showTile && <button type="button" role="listitem" className="w2-add-tile" data-type="tile" onClick={() => setAsking(true)}><span className="w2-entity-icon"><Icon name="grid" size={18}/></span><span>Tile</span></button>}
      {shown.map(type => <button key={type.key} type="button" role="listitem" className="w2-add-tile" data-type={type.key} onClick={() => choose(type)}>
        <span className="w2-entity-icon"><Icon name={lucide[type.glyph] ?? 'grid'} size={18}/></span><span>{type.name}</span></button>)}
    </div> : <EntityList hideSearch query={query} kind="add" domains={wanted?.domains} height={320} autoFocus={false}
      onPick={row => { const type = wanted ?? undefined;
        if (type?.type === 'state-tile' && !newStateTile(row.entityId, row.name, row.deviceClass, document.stateStyles)) { setStyling({ row, busy: false }); return; }
        remember('tiles', type?.key ?? (makeForEntity(document, row.entityId, row.name).node).type as string);
        onChoose({ type: type?.key ?? 'entity', made: type ? type.make({ document, entityId: row.entityId, name: row.name !== row.entityId ? row.name : undefined, deviceClass: row.deviceClass }) : makeForEntity(document, row.entityId, row.name !== row.entityId ? row.name : undefined) }); }}/>}
    {wanted && segment === 'entities' && <p className="w2-caption">Choose an entity for the {wanted.name}.</p>}
  </div>;
}
