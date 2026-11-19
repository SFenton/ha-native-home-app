import { useMemo, useRef, useState } from 'react';
import { Braces, Clock, Database, GitBranch, Hash, List, Search, Type, Workflow, X } from 'lucide-react';
import { blockCatalog, type BlockCatalogEntry, type GraphScopeKind } from '../../shared/composition/graph';
import { blockGroup, blockName, paletteAvailability } from './blocks';

const icons = { Values: Type, Data: Database, Checks: GitBranch, Combine: Workflow, Maths: Hash, Time: Clock, Templates: Braces, Outputs: GitBranch, 'Lists & Flows': List, Rules: GitBranch };
export default function Palette({ scope, capabilities, sourceId, onAdd, close }: {
  scope: GraphScopeKind; capabilities: readonly string[]; sourceId?: string; onAdd: (entry: BlockCatalogEntry) => void; close: () => void;
}) {
  const [query, setQuery] = useState('');
  const root = useRef<HTMLElement>(null);
  const entries = useMemo(() => blockCatalog.filter(entry => `${blockName(entry.key)} ${blockGroup(entry)} ${entry.key} ${entry.scopes.join(' ')} ${entry.capabilities.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const groups = [...new Set(entries.map(blockGroup))];
  const next = (event: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const buttons = [...root.current?.querySelectorAll<HTMLButtonElement>('[data-block-choice]') ?? []];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement), delta = event.key === 'ArrowUp' ? -2 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 2 : 1;
    buttons[index < 0 ? 0 : (index + delta + buttons.length) % buttons.length]?.focus();
  };
  return <aside ref={root} className="w2-canvas-palette" aria-label="Block palette" onKeyDown={next}>
    <div className="w2-canvas-panel-head"><div><strong>Blocks</strong><small>{scope} scope</small></div><button type="button" aria-label="Close block palette" onClick={close}><X size={16}/></button></div>
    <label className="w2-canvas-search"><Search size={16} aria-hidden/><input autoFocus type="search" aria-label="Find a block" placeholder="Find a block" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); const entry = entries.find(entry => paletteAvailability(entry, scope, capabilities, sourceId).enabled); if (entry) onAdd(entry); }
      if (event.key === 'Escape') close();
    }}/></label>
    <div className="w2-canvas-palette-scroll">
      {groups.map(group => <section key={group}><h3>{group}</h3><ul aria-label={`${group} blocks`} className="w2-canvas-palette-grid">
        {entries.filter(entry => blockGroup(entry) === group).map(entry => {
          const availability = paletteAvailability(entry, scope, capabilities, sourceId), Icon = icons[group as keyof typeof icons] ?? Braces;
          const hint = entry.grammar.startsWith('predicate') ? 'yes/no condition' : entry.grammar === 'operand.math' ? 'number' : entry.cost === 'step' ? 'flow stream' : entry.variant === 'value' ? entry.grammar.split('.').at(-1) : entry.variant;
          return <li key={entry.key}><button type="button" data-block-choice aria-label={`Add ${blockName(entry.key)}, ${hint}`} aria-disabled={!availability.enabled || undefined}
            title={availability.reason} onClick={() => availability.enabled && onAdd(entry)} aria-describedby={`block-${entry.key}`}>
            <Icon size={20} aria-hidden/><span>{blockName(entry.key)}</span><small>{hint}</small>
          </button><span id={`block-${entry.key}`} className={availability.enabled ? 'w2-canvas-sr' : 'w2-canvas-disabled-reason'}>{availability.reason ?? `Available in ${entry.scopes.join(', ')}.`}
            {entry.capabilities.includes('sh.flow-average@1') || entry.capabilities.includes('sh.text-keep@1') ? ' Pending native capability.' : ''}</span></li>;
        })}
      </ul></section>)}
      {!entries.length && <p>Nothing matches.</p>}
    </div>
    <p className="w2-canvas-caption">Click to add, or search and use arrows and Enter. Wires never convert types implicitly.</p>
  </aside>;
}
