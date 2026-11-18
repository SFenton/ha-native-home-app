import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronLeft, Search, X } from 'lucide-react';
import { componentUses, expandRef, type ComponentUse } from '../shared/composition/components';
import type { ComponentEntry, CompositionDocument } from '../shared/composition/schema';
import type { SelectionKey } from '../preview2/model';
import Crumbs from './Crumbs';
import RowGlyph from './RowGlyph';
import { templateWords as words } from './templateWords';
import type { Workspace2 } from './useWorkspace2';

/** One page or sheet of the Uses level: the places of a template that sit on it. */
export interface UseGroup { key: string; title: string; kind: 'Page' | 'Sheet'; uses: { use: ComponentUse; title: string; icon?: string; where?: string }[] }
export function useGroups(document: CompositionDocument, entry: ComponentEntry): UseGroup[] {
  const groups = new Map<string, UseGroup>();
  for (const use of componentUses(document, entry.id)) {
    const key = `${use.surface.kind}:${use.surface.id}`;
    const group = groups.get(key) ?? { key, title: use.surface.title, kind: use.surface.kind === 'page' ? 'Page' : 'Sheet', uses: [] };
    const node = expandRef(use.ref, entry) as { title?: string; icon?: { name: string } };
    // The container the place sits in (a section, a grid), for the row's second word.
    const parentPath = use.path.slice(0, -2);
    let parent: unknown = document; for (const step of parentPath) parent = (parent as Record<string | number, unknown>)?.[step];
    const where = [use.tab?.label, parentPath.length > 2 ? (parent as { title?: string })?.title : undefined].filter(Boolean).join(' › ');
    group.uses.push({ use, title: node.title || entry.name, icon: node.icon?.name, where: where || undefined });
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The rows: a group for each page or sheet, a 32 px row for each place. A press goes to the place and selects it; the list stays. */
export function TemplateUsesList({ ws, entry, query, onPicked }: { ws: Workspace2; entry: ComponentEntry; query: string; onPicked?: (key: SelectionKey) => void }) {
  const document = ws.document!;
  const groups = useMemo(() => useGroups(document, entry), [document, entry]);
  const [closed, setClosed] = useState<readonly string[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const shown = groups.map(group => ({ ...group, uses: group.uses.filter(row => !needle || `${row.title} ${row.where ?? ''} ${group.title}`.toLowerCase().includes(needle)) })).filter(group => group.uses.length);
  if (!groups.length) return <p className="w2-empty">Not used yet. Add it to a page from its row.</p>;
  if (!shown.length) return <p className="w2-empty">Nothing matches.</p>;
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = [...list.current?.querySelectorAll<HTMLElement>('[data-use]') ?? []];
    const at = rows.indexOf(window.document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : undefined;
    if (at < 0 || next === undefined) return;
    event.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, next))].focus();
  };
  return <div ref={list} className="w2-tree-list w2-uses-tree" data-testid="template-uses" onKeyDown={keys}>
    {shown.map(group => {
      const open = Boolean(needle) || !closed.includes(group.key);
      return <section key={group.key} aria-label={`${group.title}, ${group.kind.toLowerCase()}`}>
        <h3 className="w2-group-title w2-tree-group"><button type="button" className="w2-tree-group-button" aria-expanded={open} onClick={() => setClosed(open ? [...closed, group.key] : closed.filter(key => key !== group.key))}>
          <ChevronDown size={12} aria-hidden data-open={open || undefined}/><span>{group.title}</span><span className="w2-tree-count">{group.uses.length}</span></button></h3>
        {open && <ul className="w2-saved-list" aria-label={group.title}>{group.uses.map(row => {
          const key = `node:${row.use.ref.id}` as SelectionKey, selected = ws.selection === key;
          return <li key={row.use.ref.id}><button type="button" className="w2-tpl-row w2-use-row" data-use={row.use.ref.id} data-selected={selected || undefined} aria-current={selected || undefined}
            aria-label={`${row.title}, ${group.title}${row.where ? `, ${row.where}` : ''}`} onClick={() => { onPicked?.(key); ws.selectAnywhere(key); }}>
            <span className="w2-tree-icon"><RowGlyph type={entry.node.type} icon={row.icon}/></span>
            <span className="w2-tree-title">{row.title}</span>
            {row.where && <span className="w2-tpl-trail">{row.where}</span>}
          </button></li>;
        })}</ul>}
      </section>;
    })}
  </div>;
}

/** The Uses level of the Components panel: Back, the title with its path (Templates › Name), a search, the count and the list. */
export default function TemplateUsesLevel({ ws, entry, onBack, onClose, onKeepPanel }: { ws: Workspace2; entry: ComponentEntry; onBack: () => void; onClose?: () => void; /** A press on a place keeps the panel open where the inspector and it cannot both show. */ onKeepPanel?: (key: SelectionKey) => void }) {
  const [query, setQuery] = useState('');
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => { head.current?.focus(); }, []);
  const groups = useMemo(() => useGroups(ws.document!, entry), [ws.document, entry]);
  const count = groups.reduce((total, group) => total + group.uses.length, 0);
  return <section className="w2-repeats-level w2-uses-level" aria-label={`Uses of ${entry.name}`} data-testid="template-uses-level">
    <header className="w2-lib-head w2-lib-level-head">
      <button type="button" className="w2-icon-button w2-lib-back" aria-label="Back to Templates" onClick={onBack}><ChevronLeft size={20} aria-hidden/></button>
      <div className="w2-lib-titles">
        <h2 className="w2-lib-title" ref={head} tabIndex={-1}>{words.usesTitle}</h2>
        <Crumbs path={[{ key: 'rail:list' as SelectionKey, title: 'Templates' }, { key: `template:${entry.id}` as SelectionKey, title: entry.name }]} atRoot={false} onJump={onBack} align="start"/>
      </div>
      {onClose && <button type="button" className="w2-icon-button" aria-label="Close" onClick={onClose}><X size={18} aria-hidden/></button>}
    </header>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder={words.findUses} aria-label={words.findUses} value={query} onChange={event => setQuery(event.target.value)}/></label>
    <p className="w2-uses-count">{words.usesSummary(count, groups.filter(group => group.kind === 'Page').length, groups.filter(group => group.kind === 'Sheet').length)}</p>
    <div className="w2-lib-scroll"><TemplateUsesList ws={ws} entry={entry} query={query} onPicked={onKeepPanel}/></div>
  </section>;
}
