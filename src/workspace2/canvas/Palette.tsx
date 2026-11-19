import { useMemo, useRef, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { blockCatalog, type BlockCatalogEntry, type GraphScopeKind, type LogicGraph } from '../../shared/composition/graph';
import { blockGroup, blockName, blockResult, nodeName, paletteAvailability, paletteGroups } from './blocks';
import BlockIcon from './BlockIcon';
const comparisonNames: Readonly<Record<string, string>> = { eq: 'Is / Is Not', above: 'Above / Below', before: 'Before / After' };

export default function Palette({ scope, capabilities, sourceId, graph, locate, onAdd, close }: {
  scope: GraphScopeKind; capabilities: readonly string[]; sourceId?: string; graph: LogicGraph; locate: (id: string) => void; onAdd: (entry: BlockCatalogEntry) => void; close: () => void;
}) {
  const [query, setQuery] = useState(''), [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLElement>(null), needle = query.trim().toLowerCase();
  const entries = useMemo(() => blockCatalog.filter(entry => `${blockName(entry.key)} ${blockGroup(entry)} ${entry.key}`.toLowerCase().includes(needle)), [needle]);
  const available = entries.filter(entry => paletteAvailability(entry, scope, capabilities, sourceId).enabled && (needle || !['predicate.compare.ne', 'predicate.compare.below', 'predicate.compare.after'].includes(entry.key)));
  const unavailable = entries.filter(entry => !paletteAvailability(entry, scope, capabilities, sourceId).enabled);
  const current = graph.nodes.filter(node => nodeName(node, graph).toLowerCase().includes(needle));
  const name = (entry: BlockCatalogEntry) => !needle && entry.grammar === 'predicate.compare'
    ? (comparisonNames[entry.variant] ?? blockName(entry.key)) : blockName(entry.key);
  const toggle = (group: string) => setOpened(held => { const next = new Set(held); if (next.has(group)) next.delete(group); else next.add(group); return next; });
  return <aside ref={root} className="w2-canvas-palette" aria-label="Block palette" onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const buttons = [...root.current?.querySelectorAll<HTMLButtonElement>('[data-block-choice]') ?? []].filter(button => button.getClientRects().length);
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement), delta = event.key === 'ArrowUp' ? -2 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 2 : 1;
    if (index < 0) root.current?.querySelector<HTMLButtonElement>('[data-block-add-choice]')?.focus();
    else buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  }}>
    <div className="w2-canvas-panel-head"><strong>Blocks</strong><button type="button" aria-label="Close block palette" onClick={close}><X size={16}/></button></div>
    <label className="w2-canvas-search"><Search size={16} aria-hidden/><input autoFocus type="search" aria-label="Find a block" placeholder="Find a block" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && available[0]) { event.preventDefault(); onAdd(available[0]); }
      if (event.key === 'Escape') close();
    }}/></label>
    <div className="w2-canvas-palette-scroll">
      {paletteGroups.map(group => {
        const here = available.filter(entry => blockGroup(entry) === group), nodes = group === 'In This Flow' ? current : [];
        const names = group === 'In This Flow' ? nodes.map(node => nodeName(node, graph)) : here.map(name);
        if (needle && !names.length) return null;
        const open = Boolean(needle) || opened.has(group);
        return <section className="w2-canvas-category" key={group}>
          <button type="button" className="w2-canvas-category-head" aria-expanded={open} aria-label={`${group}, ${names.length} blocks`} onClick={() => toggle(group)}>
            <ChevronRight size={12} aria-hidden data-open={open || undefined}/><span>{group}</span>
            {!open && <small>{names.slice(0, 3).join(', ') || 'None here'}</small>}<span className="w2-canvas-count">{names.length}</span>
          </button>
          {open && <ul aria-label={`${group} blocks`} className="w2-canvas-palette-grid">
            {nodes.map(node => <li key={node.id}><button type="button" data-block-choice aria-label={`Go to ${nodeName(node, graph)} ${graph.nodes.indexOf(node) + 1}`} onClick={() => locate(node.id)}>
              <BlockIcon catalogKey={node.catalogKey} size={20}/><span>{nodeName(node, graph)}</span>
            </button></li>)}
            {here.map(entry => <li key={entry.key}><button type="button" data-block-choice data-block-add-choice aria-label={`Add ${name(entry)}, ${blockResult(entry)}`} onClick={() => onAdd(entry)}>
              <i className="w2-canvas-type-dot" data-wire-type={blockResult(entry)} aria-hidden/><BlockIcon catalogKey={entry.key} size={20}/><span>{name(entry)}</span>
            </button></li>)}
          </ul>}
        </section>;
      })}
      {!!unavailable.length && <details className="w2-canvas-unavailable"><summary>Not available here <span>{unavailable.length}</span></summary><ul>{unavailable.map(entry => <li key={entry.key}><strong>{blockName(entry.key)}</strong><p>{paletteAvailability(entry, scope, capabilities, sourceId).reason}</p></li>)}</ul></details>}
      {!entries.length && !current.length && <p>Nothing matches.</p>}
    </div>
    <p className="w2-canvas-caption w2-canvas-palette-foot">Click to add, or search and use arrows and Enter. The dot shows what a block gives back: <span><i data-wire-type="number"/> number, <i data-wire-type="condition"/> yes/no, <i data-wire-type="text"/> text.</span></p>
  </aside>;
}
