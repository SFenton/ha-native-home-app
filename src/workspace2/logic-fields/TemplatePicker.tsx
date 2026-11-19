import { useState } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { LogicEntry, LogicRef } from '../../shared/composition/logic-library';
import type { Json } from '../../shared/types';
import { Modal } from '../kit';
import { explicitTemplateUse } from './templates';
import { sourceName } from '../dialogs/sources';
import { useLogicScope } from '../data/logic/logicScope';
import { SelectMenu } from '../SelectMenu';
const holeName = (arg: Json | undefined) => arg && typeof arg === 'object' && !Array.isArray(arg) && arg.type === 'hole' && typeof arg.name === 'string' ? arg.name : undefined;

export function TemplatePicker({ document, kind, onUse, entryId, label = 'Use Template', className = 'w2-link' }: { document: CompositionDocument; kind: LogicEntry['kind']; onUse: (use: LogicRef) => void; entryId?: string; label?: string; className?: string }) {
  const [entry, setEntry] = useState<LogicEntry>(), [args, setArgs] = useState<Record<string, Json>>({}), [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [operandKinds, setOperandKinds] = useState<Record<string, string>>({});
  const scope = useLogicScope();
  const enclosing = document.logicLibrary?.find(item => item.id === scope?.entryId)?.params ?? [];
  const entries = (document.logicLibrary ?? []).filter(item => item.kind === kind && item.id !== scope?.entryId);
  const unset = (name: string) => setArgs(current => { const { [name]: _removed, ...rest } = current; return rest; });
  const valid = () => { if (!entry) return false; try { explicitTemplateUse(entry, args, enclosing); return true; } catch { return false; } };
  return <>
    <button type="button" className={className} onClick={() => { setOpen(true); setEntry(entries.find(item => item.id === entryId)); setArgs({}); setOperandKinds({}); setError(''); }}>{label}</button>
    <Modal open={open} onOpenChange={setOpen} title="Use a Logic Template" size="s" footer={<>
      <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      <button type="button" className="w2-primary" disabled={!valid()} onClick={() => {
        if (!entry) return;
        try { onUse(explicitTemplateUse(entry, args, enclosing)); setOpen(false); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      }}>Use Template</button>
    </>}>
      <label className="w2-picker-row"><span className="w2-row-label">Template</span>
        <select aria-label="Template" value={entry?.id ?? ''} onChange={event => { setEntry(entries.find(entry => entry.id === event.target.value)); setArgs({}); setOperandKinds({}); }}>
          <option value="">Choose a template</option>{entries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      {!entries.length && <p className="w2-caption">No templates of this output type. Create one in the Flows tab.</p>}
      {entry && <p className="w2-caption">Set each use's values. Preview stand-ins are never filled in automatically.</p>}
      {entry?.params.map(param => <div key={param.name} className="w2-picker-row" data-stacked>
        <span className="w2-row-label">{param.label ?? param.name}</span>
        {enclosing.some(owner => owner.kind === param.kind) && <select aria-label={`${param.label ?? param.name} comes from`}
          value={holeName(args[param.name]) ?? ''}
          onChange={event => event.target.value ? setArgs({ ...args, [param.name]: { type: 'hole', name: event.target.value } }) : unset(param.name)}>
          <option value="">This use sets it</option>{enclosing.filter(owner => owner.kind === param.kind).map(owner => <option key={owner.name} value={owner.name}>Template setting: {owner.label ?? owner.name}</option>)}
        </select>}
        {holeName(args[param.name]) !== undefined
          ? <p className="w2-caption">Passed through from the enclosing template.</p>
          : param.kind === 'source-id' ? <select aria-label={param.label ?? param.name} value={typeof args[param.name] === 'string' ? args[param.name] as string : ''} onChange={event => event.target.value ? setArgs({ ...args, [param.name]: event.target.value }) : unset(param.name)}>
          <option value="">Choose a source</option>{document.dataSources.map(source => <option key={source.id} value={source.id}>{sourceName(source)}</option>)}
        </select> : param.kind === 'condition' ? <select aria-label={param.label ?? param.name} value={args[param.name] === undefined ? '' : String((args[param.name] as { isAdmin: boolean }).isAdmin)} onChange={event => event.target.value ? setArgs({ ...args, [param.name]: { type: 'viewer', isAdmin: event.target.value === 'true' } }) : unset(param.name)}>
          <option value="">Choose a check</option><option value="true">Viewer is an admin</option><option value="false">Viewer is not an admin</option>
        </select> : param.kind === 'operand' ? <>
          <SelectMenu label={`${param.label ?? param.name} value type`} value={operandKinds[param.name] ?? 'text'}
            options={[{ value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'boolean', label: 'Yes or No' }]}
            onChange={kind => { setOperandKinds({ ...operandKinds, [param.name]: kind }); unset(param.name); }}/>
          {operandKinds[param.name] === 'boolean' ? <SelectMenu label={param.label ?? param.name}
            value={args[param.name] === undefined ? '' : String((args[param.name] as { value: boolean }).value)}
            options={[{ value: '', label: 'Choose an answer' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
            onChange={value => value ? setArgs({ ...args, [param.name]: { type: 'literal', value: value === 'true' } }) : unset(param.name)}/>
            : <input aria-label={param.label ?? param.name} type={operandKinds[param.name] === 'number' ? 'number' : 'text'}
              value={String((args[param.name] as { value?: Json } | undefined)?.value ?? '')} onChange={event => {
                const text = event.target.value;
                if (operandKinds[param.name] === 'number' && (text === '' || !Number.isFinite(Number(text)))) unset(param.name);
                else setArgs({ ...args, [param.name]: { type: 'literal', value: operandKinds[param.name] === 'number' ? Number(text) : text } });
              }}/>}
        </> : <input aria-label={param.label ?? param.name} type={param.kind === 'number' ? 'number' : 'text'} value={String(args[param.name] ?? '')}
          onChange={event => {
            const text = event.target.value;
            if (param.kind === 'number' && (text === '' || !Number.isFinite(Number(text)))) { const { [param.name]: _removed, ...rest } = args; setArgs(rest); }
            else setArgs({ ...args, [param.name]: param.kind === 'number' ? Number(text) : text });
          }}/>}
      </div>)}
      {error && <p role="alert" className="w2-error-text">{error}</p>}
    </Modal>
  </>;
}
