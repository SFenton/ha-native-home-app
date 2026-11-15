import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CompositionDocument } from '../shared/composition/schema';
import { Icon } from '../ui';
import { buildOutline, type OutlineRow, type SurfaceRef } from './outline';
import { Tag } from './kit';
import ThisPage from './ThisPage';
import type { Workspace2 } from './useWorkspace2';

/** The Pages overlay's content (spec 5.3): search, then the derived outline. Phase 1 has the "Pages" view only. */
export default function PagesPanel({ document, current, onPick, ws, onClose }: { document: CompositionDocument; current: SurfaceRef | undefined; onPick: (surface: SurfaceRef) => void; ws?: Workspace2; onClose?: () => void }) {
  const [view, setView] = useState<'pages' | 'this'>('pages');
  const outline = useMemo(() => buildOutline(document), [document]);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = (row: OutlineRow): boolean => !needle || row.title.toLowerCase().includes(needle) || row.children.some(matches);
  const render = (row: OutlineRow, depth: number): React.ReactNode => !matches(row) ? null : <li key={`${row.surface.kind}:${row.surface.id}`}>
    <button type="button" className="w2-page-row" style={{ paddingInlineStart: 12 + depth * 18 }} data-current={current?.kind === row.surface.kind && current.id === row.surface.id || undefined}
      aria-current={current?.kind === row.surface.kind && current.id === row.surface.id ? 'page' : undefined} onClick={() => onPick(row.surface)}>
      <Icon name={row.icon} size={18}/>
      <span className="w2-page-text"><span className="w2-page-title">{row.title}</span>{row.via && <span className="w2-page-via">{row.via}</span>}</span>
      {row.tags.map(tag => <Tag key={tag} tone={tag === 'No Way In' ? 'warning' : 'neutral'}>{tag}</Tag>)}
    </button>
    {row.children.length > 0 && <ul>{row.children.map(child => render(child, depth + 1))}</ul>}
  </li>;
  const groups = outline.groups.map(group => ({ ...group, rows: group.rows.filter(matches) })).filter(group => group.rows.length);
  if (ws && view === 'this') return <div className="w2-pages"><ViewSegment view={view} onChange={setView}/><div className="w2-pages-scroll"><ThisPage ws={ws} onPick={onClose}/></div></div>;
  return <div className="w2-pages">
    {ws && <ViewSegment view={view} onChange={setView}/>}
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Find a page" aria-label="Find a page" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div className="w2-pages-scroll">
      {groups.length === 0 ? <p className="w2-empty">{needle ? 'No pages match.' : 'No sheets yet.'}</p> : groups.map(group => <section key={group.id} aria-label={group.title}>
        <h3 className="w2-group-title">{group.title}</h3>
        <ul>{group.rows.map(row => render(row, 0))}</ul>
      </section>)}
    </div>
  </div>;
}

/** The Pages overlay's two views: the outline of every page, and the nodes of the page being shown. */
function ViewSegment({ view, onChange }: { view: 'pages' | 'this'; onChange: (view: 'pages' | 'this') => void }) {
  return <div className="w2-segment-pill w2-pages-views" role="group" aria-label="View">
    {(['pages', 'this'] as const).map(id => <button key={id} type="button" aria-pressed={view === id} onClick={() => onChange(id)}>{id === 'pages' ? 'Pages' : 'This Page'}</button>)}
  </div>;
}
