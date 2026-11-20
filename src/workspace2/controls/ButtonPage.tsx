import { useEffect } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { valueAt, type EditorPath } from '../../composition-editor';
import { SelectField } from '../../ui';
import { focusMapControl } from '../../preview2/map-control-focus';
import { vacuumCommands, vacuumCommandLooks } from '../../shared/composition/vacuum';
import { buttonOf, moveToCorner, nudge, placeOf, removeButton, updateButton } from '../../shared/composition/surface-controls-edit';
import { cornerWords } from '../../shared/composition/surface-controls-fit';
import type { SurfaceButton, SurfaceCorner } from '../../shared/composition/surface-controls';
import { ActionRow } from '../editors/ActionEditor';
import { defaultAction } from '../editors/action';
import { TextInput } from '../editors/controls';
import ConditionField from '../expr/ConditionField';
import { usePush } from '../kit';
import { IconField } from '../pickers/PickerField';
import { schemaAt, useRows } from '../rows';
import { cornerOrder, groupsOf, mapNodeAt, withGroups } from './mapControls';
import { AddressedField } from '../logic-fields/AddressedField';
import { useLogicFields } from '../logic-fields/LogicFields';

/** What a button does, as the page's choice. */
type Does = 'locate' | 'command' | 'service' | 'page';
const doesOf = (button: SurfaceButton): Does => button.action.type === 'map' ? 'locate' : button.action.type === 'source-command' ? 'command' : button.action.type === 'call-service' ? 'service' : 'page';
const doesWords: Record<Does, string> = { locate: 'Locate', command: 'Robot Command', service: 'Service Call', page: 'Go to Page or Sheet' };

/**
 * One button's page (pushed from its row): Icon, Label (required), Hint; the Action; where it sits (Corner and Order); When shown and When enabled for a
 * service call or a page; Remove Button. The button whose page is open is ringed in the preview.
 */
export default function ButtonPage({ path, buttonId, focusLabel }: { path: EditorPath; buttonId: string; focusLabel?: boolean }) {
  const { document, onChange } = useRows();
  const canvas = useLogicFields();
  const push = usePush();
  const map = mapNodeAt(document, path);
  const nodeId = (valueAt(document, path) as { id: string } | undefined)?.id;
  useEffect(() => { if (nodeId) focusMapControl({ nodeId, buttonId }); return () => focusMapControl(undefined); }, [nodeId, buttonId]);
  // A new button's page opens with the label focused, so the person names it at once.
  useEffect(() => { if (focusLabel) globalThis.document.querySelector<HTMLInputElement>('.w2-mc-page input[aria-label="Label"]')?.focus(); }, [focusLabel]);
  const groups = map ? groupsOf(map) : [], button = buttonOf(groups, buttonId), place = placeOf(groups, buttonId);
  if (!map || !button || !place) return <p className="w2-empty">This button is gone.</p>;
  const change = (patch: Partial<SurfaceButton>) => onChange(withGroups(document, map, updateButton(groups, buttonId, patch)));
  const at = (...rest: (string | number)[]): EditorPath => [...map.primitivePath, 'controls', groups.findIndex(group => group.corner === place.corner), 'buttons', place.index, ...rest];
  const authored = map.primitive.controls !== undefined;
  const does = doesOf(button);
  // The button's own paths exist in the document only once `controls` is authored; every edit above writes it, so the editors below wait for it.
  const choose = (next: Does) => {
    if (next === does) return;
    const action = next === 'locate' ? { type: 'map' as const, command: 'locate' as const } : next === 'command' ? { type: 'source-command' as const, command: 'dock' }
      : next === 'service' ? defaultAction('call-service', document) : defaultAction('push', document);
    const looks = next === 'command' ? { icon: { ...button.icon, name: vacuumCommandLooks.dock.symbol } as never, label: vacuumCommandLooks.dock.label } : {};
    change({ action: action as never, visibleWhen: undefined, whenUnknown: undefined, enabledWhen: undefined, ...(next === 'locate' ? { label: 'Locate', hint: 'Asks the robot to play a sound.' } : looks) });
  };
  const takenLocate = groups.some(group => group.buttons.some(item => item.id !== buttonId && item.action.type === 'map'));
  const choices = (['locate', 'command', 'service', 'page'] as const).filter(item => item !== 'locate' || !takenLocate || does === 'locate').map(item => ({ value: item, label: doesWords[item] }));
  const symbol = button.icon.type === 'sf-symbol' ? button.icon.name : undefined;
  return <div className="w2-editor-page w2-mc-page" data-testid="map-button-page">
    {symbol !== undefined ? <IconField label="Icon" symbol={symbol} onPick={name => change({ icon: { ...button.icon, name } as never })}/> : canvas && authored ? <AddressedField path={at('icon')} kind="slot" label="Icon"/> : <p className="w2-caption">The symbol follows a rule.</p>}
    {typeof button.label === 'string'
      ? <div className="w2-row"><label className="w2-field-row"><span className="w2-field-label">Label</span><div className="w2-field-control"><TextInput label="Label" value={button.label} onCommit={text => change({ label: text })}/></div></label>
        <p className="w2-caption">VoiceOver and Voice Control use the label.</p>{button.label.trim() === '' && <p role="alert" className="w2-error-text">A button needs a label.</p>}</div>
      : canvas && authored ? <AddressedField path={at('label')} kind="slot" label="Label"/> : <p className="w2-caption">The label follows a rule.</p>}
    <div className="w2-row"><label className="w2-field-row"><span className="w2-field-label">Hint</span><div className="w2-field-control"><TextInput label="Hint" value={button.hint ?? ''} onCommit={text => change({ hint: text === '' ? undefined : text })}/></div></label></div>
    <section className="w2-group" aria-label="Action"><h3 className="w2-group-title">Action</h3>
      <SelectField label="Does" value={does} options={choices} onChange={next => choose(next as Does)}/>
      {does === 'locate' && <p className="w2-caption">Asks the robot to play a sound. It hides while the robot is unavailable.</p>}
      {does === 'command' && button.action.type === 'source-command' && <>
        <SelectField label="Command" value={button.action.command} options={vacuumCommands.map(command => ({ value: command, label: vacuumCommandLooks[command].label }))}
          onChange={command => change({ action: { type: 'source-command', command }, icon: { ...button.icon, name: vacuumCommandLooks[command as keyof typeof vacuumCommandLooks].symbol } as never, label: typeof button.label === 'string' ? vacuumCommandLooks[command as keyof typeof vacuumCommandLooks].label : button.label })}/>
        <p className="w2-caption">Shown only when the robot offers it, dimmed while it is blocked, and the reason is read as its value.</p></>}
      {authored && (does === 'service' || does === 'page') && <ActionRow label="Action" path={at('action')} schema={schemaAt(document, at('action'))} optional={false} itemName={typeof button.label === 'string' ? button.label : button.id}/>}
      {authored && (does === 'service' || does === 'page') && <>
        <ConditionField label="Only show when" path={at('visibleWhen')} place="show" policy="show" itemName={button.id}/>
        <ConditionField label="Only enable when" path={at('enabledWhen', 'condition')} place="enable" policy="enable" itemName={button.id}/></>}
    </section>
    <section className="w2-group" aria-label="Place"><h3 className="w2-group-title">Place</h3>
      <SelectField label="Corner" value={place.corner} options={cornerOrder.map(corner => ({ value: corner, label: cornerWords[corner] }))}
        onChange={corner => onChange(withGroups(document, map, moveToCorner(groups, buttonId, corner as SurfaceCorner)))}/>
      <div className="w2-field-row"><span className="w2-field-label">Order</span><div className="w2-field-control w2-mc-order"><span>{place.index + 1} of {place.count}</span>
        <button type="button" className="w2-icon-button" aria-label="Move Up" disabled={place.index === 0} onClick={() => onChange(withGroups(document, map, nudge(groups, buttonId, -1)))}><ArrowUp size={16} aria-hidden/></button>
        <button type="button" className="w2-icon-button" aria-label="Move Down" disabled={place.index >= place.count - 1} onClick={() => onChange(withGroups(document, map, nudge(groups, buttonId, 1)))}><ArrowDown size={16} aria-hidden/></button></div></div>
    </section>
    <button type="button" className="w2-remove w2-danger-item" onClick={() => { onChange(withGroups(document, map, removeButton(groups, buttonId))); push?.pop(); }}>Remove Button</button>
  </div>;
}
