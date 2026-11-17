import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import './pickers.css';
import { GlyphByName } from '../../preview2/nodes/shared';
import { Tag } from '../kit';
import { filterIcons, iconGroups, isKnownIcon } from './icons';

/** The icon list of spec 8.2: grouped symbols with a plain name and the symbol name in monospace; typed names are "Not Checked". */
export default function IconList({ value, onPick }: { value?: string; onPick: (symbol: string) => void }) {
  const [query, setQuery] = useState('');
  const text = query.trim();
  const found = useMemo(() => filterIcons(text), [text]);
  return <div className="w2-icon-list">
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Search icons" aria-label="Search icons" value={query} autoFocus onChange={event => setQuery(event.target.value)}/></label>
    <div className="w2-icon-scroll">
      {text && !isKnownIcon(text) && <button type="button" className="w2-icon-row" onClick={() => onPick(text)}><span className="w2-entity-icon"><GlyphByName name={text} size={18}/></span>
        <span className="w2-entity-text"><span className="w2-entity-name">Use “{text}”</span></span><Tag>Not Checked</Tag></button>}
      {iconGroups.map(group => { const rows = found.filter(choice => choice.group === group); return rows.length === 0 ? null : <section key={group} aria-label={group}>
        <h3 className="w2-group-title">{group}</h3>
        {rows.map(choice => <button type="button" key={choice.symbol} className="w2-icon-row" aria-pressed={choice.symbol === value} data-symbol={choice.symbol} onClick={() => onPick(choice.symbol)}>
          <span className="w2-entity-icon"><GlyphByName name={choice.symbol} size={18}/></span><span className="w2-entity-text"><span className="w2-entity-name">{choice.name}</span><code className="w2-entity-id">{choice.symbol}</code></span></button>)}
      </section>; })}
      {found.length === 0 && !text && null}
      {found.length === 0 && text && <p className="w2-empty">Nothing matches.</p>}
    </div>
    <p className="w2-caption">Stand-in icons. The app draws SF Symbols.</p>
  </div>;
}
