import { useState } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { argFits, logicSampleArguments, type LogicEntry } from '../../shared/composition/logic-library';
import { canonicalOfBounded } from '../../shared/composition/json';
import type { CanvasLens } from '../../shared/composition/graph';
import type { Json } from '../../shared/types';
import { sourceName } from '../dialogs/sources';
import { templateUses } from './lenses';
import { SelectMenu } from '../SelectMenu';
import { useNameContext } from '../expr/useExpr';
import { describeLogic, sourceLabel } from './presentation';

export function LensChooser({ document, entry, lens, onLens, onArguments }: {
  document: CompositionDocument; entry?: LogicEntry; lens: CanvasLens;
  onLens: (lens: CanvasLens) => void; onArguments: (args: Record<string, Json>) => void;
}) {
  const [values, setValues] = useState(() => logicSampleArguments(entry ?? { params: [] }) as Record<string, Json>);
  const [error, setError] = useState('');
  const ctx = useNameContext(document);
  const uses = entry ? templateUses(document, entry) : [];
  const selected = lens.kind === 'use' ? uses.findIndex(use => canonicalOfBounded(use.anchor) === canonicalOfBounded(lens.anchor)) : -1;
  const change = (name: string, value: Json, kind: LogicEntry['params'][number]['kind']) => {
    if (!argFits(kind, value)) { setError('That preview value does not fit the setting.'); return; }
    const next = { ...values, [name]: value }; setValues(next); onArguments(next); setError('');
  };
  return <section className="w2-logic-lens" aria-label="Preview lens">
    <div className="w2-picker-row" data-stacked><span className="w2-row-label">Preview</span>
      <SelectMenu label="Preview lens" popupClassName="w2-logic-lens-menu" value={lens.kind === 'use' ? `use-${selected}` : lens.kind} onChange={value => {
        if (value === 'values' || value === 'stand-in') onLens({ kind: value });
        else { const use = uses[Number(value.slice(4))]; if (use) onLens({ kind: 'use', anchor: use.anchor }); }
      }} options={[{ value: 'values', label: 'Just the Values' }, { value: 'stand-in', label: 'Stand-in' },
        ...uses.map((use, index) => ({ value: `use-${index}`, label: `A use: ${use.label}` }))]}/>
    </div>
    {lens.kind === 'use' ? <p className="w2-caption">A use: {uses[selected]?.label ?? 'This use was removed'}. Settings resolve for this use only.</p>
      : <p className="w2-caption">{lens.kind === 'stand-in' ? 'Stand-in field. Preview only - not saved.' : 'Typed outputs. No component is required.'}{entry?.params.length ? ' Using temporary Try with values.' : ''}</p>}
    {entry && lens.kind !== 'use' && entry.params.length > 0 && <details className="w2-data-fold"><summary>Try with · {entry.params.map(param => `${param.label ?? param.name}: ${param.kind === 'source-id' ? sourceLabel(values[param.name], ctx) : describeLogic(values[param.name], ctx)}`).join(' · ')}</summary>
      {entry.params.map(param => <div key={param.name} className="w2-picker-row" data-stacked><span className="w2-row-label">{param.label ?? param.name}</span>
        {param.kind === 'source-id' ? <SelectMenu label={`Try with ${param.label ?? param.name}`} popupClassName="w2-logic-lens-menu" value={String(values[param.name] ?? '')} onChange={value => change(param.name, value, param.kind)}
          options={document.dataSources.map(source => ({ value: source.id, label: source.kind === 'ha-entity' ? sourceLabel(source.id, ctx) : sourceName(source) }))}/>
          : <input aria-label={`Try with ${param.label ?? param.name}`} type={param.kind === 'number' ? 'number' : 'text'}
          defaultValue={typeof values[param.name] === 'object' ? JSON.stringify(values[param.name]) : String(values[param.name] ?? '')} onBlur={event => {
            try {
              const text = event.target.value;
              if (param.kind === 'number' && (!text.trim() || !Number.isFinite(Number(text)))) throw new Error('Enter a finite preview number.');
              change(param.name, param.kind === 'number' ? Number(text) : param.kind === 'operand' || param.kind === 'condition' ? JSON.parse(text) as Json : text, param.kind);
            } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
          }}/>}
      </div>)}
      <p className="w2-caption">Preview only - not saved to the template or a use.</p>
    </details>}
    {error && <p role="alert" className="w2-error-text">{error}</p>}
  </section>;
}
