import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronRight, Plus } from 'lucide-react';
import type { CompositionDocument } from '../../../shared/composition/schema';
import type { Operand, Predicate } from '../../../shared/composition/expression';
import type { Json } from '../../../shared/types';
import { TextInput } from '../../editors/controls';
import type { Draft } from '../../editors/draft';
import { ensureSource } from '../../add/sources';
import { SelectMenu } from '../../SelectMenu';
import { useWorkspaceData } from '../../pickers/WorkspaceData';
import { entityOfSource, operandName, sentence } from '../../expr/condition';
import { useNameContext } from '../../expr/useExpr';
import { SettingRow } from './LogicUse';
import { addSetting, canAddSetting, entryOf, removeSetting, settingKindOf, settingKinds, settingUsed, updateSetting, type LogicParam, type SettingKind } from './logicModel';
import { minutesWords } from './logicNames';
import { logicWords } from './logicWords';

/** "Value · tried with 3": what a setting takes and what it is tried with. */
function triedLine(param: LogicParam, document: CompositionDocument, ctx: ReturnType<typeof useNameContext>): string {
  const kind = settingKindOf(param), sample = param.sample;
  const value = kind === 'entity' ? (typeof sample === 'string' ? (() => { const id = entityOfSource(ctx, sample); return id ? ctx.entityName?.(id) ?? id : sample; })() : '')
    : kind === 'person' ? (typeof sample === 'string' ? ctx.entityName?.(sample) ?? sample : '')
    : kind === 'time' ? (typeof sample === 'number' ? minutesWords(sample) : '')
    : kind === 'value' ? (sample && typeof sample === 'object' ? operandName(sample as unknown as Operand, ctx) : '')
    : kind === 'condition' ? (sample && typeof sample === 'object' ? sentence(sample as unknown as Predicate, ctx) : '')
    : String(sample ?? '');
  void document;
  return `${logicWords.kinds[kind]}${value ? ` · tried with ${value}` : ''}`;
}

/** The settings list of the editor: "Each use sets (3)", one row per setting that opens in place, and Add Setting…. */
export default function LogicSettings({ draft, document, id, onError, apply }: { draft: Draft; document: CompositionDocument; id: string; onError: (message: string) => void; apply: (next: CompositionDocument) => void }) {
  const entry = entryOf(document, id), ctx = useNameContext(document), { entities } = useWorkspaceData();
  const [open, setOpen] = useState<string>();
  if (!entry) return null;
  const run = (operation: () => CompositionDocument) => { try { apply(operation()); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const add = (kind: SettingKind) => {
    try {
      let base = document, sourceId: string | undefined;
      if (kind === 'person') {
        sourceId = entities.find(row => row.domain === 'person')?.entityId;
        if (!sourceId) throw new Error('Connect to Home Assistant to try a Person setting.');
      }
      if (kind === 'entity') {
        const held = document.dataSources.find(source => source.kind === 'ha-entity');
        const first = entities.find(row => row.domain === 'binary_sensor') ?? entities[0];
        if (held) sourceId = held.id; else if (first) { const made = ensureSource(document, first.entityId); base = made.document; sourceId = made.sourceId; }
        else throw new Error('Connect to Home Assistant, or add an entity source, to try an Entity setting.');
      }
      const made = addSetting(base, id, kind, sourceId);
      apply(made.document); setOpen(made.name);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const room = canAddSetting(entry);
  return <section className="w2-group w2-logic-settings" aria-label={logicWords.settings(entry.params.length)} data-testid="logic-settings">
    <h3 className="w2-group-title">{logicWords.settings(entry.params.length)}</h3>
    <ul className="w2-data-list" aria-label="Settings">
      {entry.params.map(param => {
        const kind = settingKindOf(param), isOpen = open === param.name, used = settingUsed(entry, param.name), label = param.label ?? param.name;
        return <li key={param.name} className="w2-logic-setting" data-open={isOpen || undefined}>
          <button type="button" className="w2-data-row w2-logic-settingbtn" aria-expanded={isOpen} aria-label={`${label}, ${triedLine(param, document, ctx).replace(' · ', ', ')}`} onClick={() => setOpen(isOpen ? undefined : param.name)}>
            <span className="w2-logic-rowtext"><span className="w2-data-name">{label}</span>{" "}<small className="w2-logic-second">{triedLine(param, document, ctx)}</small></span><ChevronRight size={16} aria-hidden/>
          </button>
          {isOpen && <div className="w2-logic-settingopen" role="group" aria-label={label}>
            <div className="w2-picker-row" data-stacked><span className="w2-row-label">{logicWords.settingLabel}</span>
              <TextInput label={logicWords.settingLabel} value={label} maxLength={80} onCommit={text => { if (text.trim()) run(() => updateSetting(document, id, param.name, { label: text })); }}/></div>
            <div className="w2-row-segment"><span className="w2-row-label">{logicWords.settingKind}</span>
              <div className="w2-expr-control"><SelectMenu label={logicWords.settingKind} value={kind} disabled={used} options={settingKinds.map(item => ({ value: item, label: logicWords.kinds[item] }))}
                onChange={next => run(() => { const source = next === 'entity' ? document.dataSources.find(item => item.kind === 'ha-entity')?.id : undefined; if (next === 'entity' && !source) throw new Error('Add an entity source first.'); const person = next === 'person' ? entities.find(row => row.domain === 'person')?.entityId : undefined; if (next === 'person' && !person) throw new Error('Connect to Home Assistant to try a Person setting.'); return updateSetting(document, id, param.name, { kind: next as SettingKind, sample: next === 'entity' ? source : next === 'person' ? person : undefined }); })}/></div>
              {used && <p className="w2-caption">{logicWords.kindLocked}</p>}</div>
            <p className="w2-row-label">{logicWords.tryWith}</p>
            <SettingRow draft={draft} param={{ ...param, label: logicWords.tryWith }} arg={param.sample}
              onArg={(next: Json, base?: CompositionDocument) => run(() => updateSetting(base ?? document, id, param.name, { sample: next }))}/>
            {!used && <p className="w2-caption" data-testid="setting-unused">{logicWords.settingNotUsed}</p>}
            <button type="button" className="w2-expr-remove" onClick={() => { setOpen(undefined); run(() => removeSetting(document, id, param.name)); }}>{logicWords.removeSetting}</button>
          </div>}
        </li>;
      })}
    </ul>
    <Menu.Root>
      <Menu.Trigger className="w2-data-add" disabled={!room} aria-describedby={room ? undefined : 'w2-logic-settings-limit'}><Plus size={16} aria-hidden/>{logicWords.addSetting}</Menu.Trigger>
      <Menu.Portal><Menu.Positioner sideOffset={6} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" aria-label={logicWords.addSettingMenu}>
        {settingKinds.map(kind => <Menu.Item key={kind} className="w2-menu-item" onClick={() => add(kind)}>{logicWords.kinds[kind]}</Menu.Item>)}
      </Menu.Popup></Menu.Positioner></Menu.Portal>
    </Menu.Root>
    {!room && <p id="w2-logic-settings-limit" className="w2-caption" role="note">{logicWords.limitSettings}</p>}
  </section>;
}
