import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import './pickers.css';
import { filterServices, loadServices, sampleServices, serviceTitle, type ServiceRow } from './services';
import { VirtualList } from './Virtual';

/** Row height of the service list. */
export const SERVICE_ROW = 56;

/** The service list of spec 8.3: "Light: Turn on" with `light.turn_on` in monospace; Home Assistant's own list, else a sample. */
export default function ServiceList({ onPick, height = 360 }: { onPick: (row: ServiceRow) => void; height?: number }) {
  const [rows, setRows] = useState<readonly ServiceRow[]>(sampleServices);
  const [query, setQuery] = useState('');
  useEffect(() => { let live = true; void loadServices().then(list => { if (live && list?.length) setRows(list); }); return () => { live = false; }; }, []);
  const text = query.trim();
  const matches = useMemo(() => filterServices(rows, text), [rows, text]);
  const typed = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(text) && !rows.some(row => `${row.domain}.${row.service}` === text);
  const items: ServiceRow[] = useMemo(() => typed ? [{ domain: text.split('.')[0], service: text.split('.')[1], name: `Use “${text}”`, fields: {}, target: true }, ...matches] : matches, [typed, text, matches]);
  return <div className="w2-service-list">
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Search services" aria-label="Search services" value={query} autoFocus onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && items[0]) onPick(items[0]); }}/></label>
    <VirtualList items={items} rowHeight={SERVICE_ROW} height={height} label="Services" onActivate={onPick} empty={<p className="w2-empty">No services match.</p>}
      render={row => <button type="button" role="option" aria-selected={false} className="w2-entity-row" data-service={`${row.domain}.${row.service}`} onClick={() => onPick(row)}>
        <span className="w2-entity-text"><span className="w2-entity-name">{row.name.startsWith('Use “') ? row.name : serviceTitle(row)}</span><code className="w2-entity-id">{row.domain}.{row.service}</code></span></button>}/>
  </div>;
}
