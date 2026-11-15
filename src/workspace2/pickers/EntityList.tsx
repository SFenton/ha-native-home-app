import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import './pickers.css';
import { Icon } from '../../ui';
import { domainName, domainsOf, filterEntities, isEntityId, recents, remember, type EntityRow } from './entities';
import { VirtualList } from './Virtual';
import { useWorkspaceData } from './WorkspaceData';

const glyphs: Record<string, string> = { light: 'lightbulb', switch: 'bolt', input_boolean: 'toggle', fan: 'fan', climate: 'thermometer', sensor: 'activity', binary_sensor: 'activity', lock: 'lock',
  cover: 'door', camera: 'camera', media_player: 'play', person: 'user', weather: 'cloud', alarm_control_panel: 'shield', scene: 'sparkles', script: 'play', button: 'plus' };
/** The Studio's stand-in glyph for a domain. */
export const domainGlyph = (domain: string) => glyphs[domain] ?? 'grid';

/** Row height of the entity list (spec 8.1). */
export const ENTITY_ROW = 56;

/** One entity row: stand-in icon, friendly name, then the id in monospace with the room or domain, and the state trailing. */
export function EntityRowView({ row, onPick }: { row: EntityRow; onPick: (row: EntityRow) => void }) {
  return <button type="button" role="option" aria-selected={false} className="w2-entity-row" data-entity={row.entityId} onClick={() => onPick(row)}>
    <span className="w2-entity-icon"><Icon name={domainGlyph(row.domain)} size={18}/></span>
    <span className="w2-entity-text"><span className="w2-entity-name">{row.name}</span><code className="w2-entity-id">{row.entityId}</code></span>
    <span className="w2-entity-meta">{row.area ?? domainName(row.domain)}</span>
    {row.state && <span className="w2-entity-state">{row.state}</span>}
  </button>;
}

/**
 * The entity list of spec 8.1: search over name, id and area; domain chips (pre-set to the domains a field accepts); the
 * five most recent first; virtualised rows. Not connected, it lists what the document names and "Use “<text>”" takes a typed id.
 */
export default function EntityList({ domains, onPick, height = 360, kind = 'entities', autoFocus = true, query: given, hideSearch }: { domains?: readonly string[]; onPick: (row: EntityRow) => void; height?: number; kind?: string; autoFocus?: boolean; /** A search the caller owns (the Add picker shares one box across its segments). */ query?: string; hideSearch?: boolean }) {
  const { entities, connected } = useWorkspaceData();
  const [own, setQuery] = useState('');
  const query = given ?? own;
  const [chips, setChips] = useState<ReadonlySet<string>>(() => new Set(domains));
  const present = useMemo(() => domainsOf(entities), [entities]);
  const text = query.trim();
  const matches = useMemo(() => filterEntities(entities, text, chips), [entities, text, chips]);
  const recent = useMemo(() => recents(kind).map(id => entities.find(row => row.entityId === id)).filter((row): row is EntityRow => Boolean(row) && (!chips.size || chips.has(row!.domain))), [entities, kind, chips]);
  const items = useMemo(() => {
    const typed: EntityRow[] = isEntityId(text) && !entities.some(row => row.entityId === text) ? [{ entityId: text, name: `Use “${text}”`, domain: text.split('.')[0] }] : [];
    const head = text ? [] : recent;
    return [...typed, ...head, ...matches.filter(row => !head.includes(row))];
  }, [text, entities, matches, recent]);
  const pick = (row: EntityRow) => { remember(kind, row.entityId); onPick(row); };
  const toggle = (domain: string) => setChips(old => { const next = new Set(old); if (next.has(domain)) next.delete(domain); else next.add(domain); return next; });
  return <div className="w2-entity-list">
    {!hideSearch && <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Search entities" aria-label="Search entities" value={query} autoFocus={autoFocus} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && items[0]) pick(items[0]); }}/></label>}
    {present.length > 1 && <div className="w2-chips" role="group" aria-label="Domains">{present.slice(0, 12).map(domain => <button type="button" key={domain} className="w2-chip" aria-pressed={chips.has(domain)} onClick={() => toggle(domain)}>{domainName(domain)}</button>)}</div>}
    {!connected && <p className="w2-caption">Not connected to Home Assistant. Type an entity ID.</p>}
    {!text && recent.length > 0 && <h3 className="w2-group-title">Recent</h3>}
    <VirtualList items={items} rowHeight={ENTITY_ROW} height={height} label="Entities" onActivate={pick}
      empty={<p className="w2-empty">No entities match.</p>}
      render={row => row.name.startsWith('Use “') ? <button type="button" role="option" aria-selected={false} className="w2-entity-row" onClick={() => pick({ ...row, name: row.entityId })}>
        <span className="w2-entity-icon"><Icon name="plus" size={18}/></span><span className="w2-entity-text"><span className="w2-entity-name">{row.name}</span></span></button> : <EntityRowView row={row} onPick={pick}/>}/>
  </div>;
}
