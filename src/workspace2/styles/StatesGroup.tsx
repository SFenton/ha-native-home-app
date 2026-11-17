import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Json } from '../../shared/types';
import { overrideFor, resetOverride, saveAsNewStyle, setOverride, type StateTileNode } from '../../shared/composition/state-style-library';
import { previewTile } from '../../shared/composition/state-style-preview';
import {
  colourAllowed, indicatorOptions, resolveTileStyle, ruleFor, type OverrideLayer, type StateOverride, type StateTileBinding,
} from '../../shared/composition/state-styles';
import { Tag, usePush } from '../kit';
import { TextInput } from '../editors/controls';
import { PickerRow } from '../pickers/PickerField';
import IconList from '../pickers/IconList';
import { iconName } from '../pickers/icons';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { GlyphByName } from '../../preview2/nodes/shared';
import { useRows } from '../rowsContext';
import { ChoiceSelect, type Choice } from './ChoiceSelect';
import { LayerRow } from './LayerRow';
import './styles.css';
import { ClassDot, StateMenu } from './StateMenu';
import { StylesPanel } from './StylesPanel';
import { StylePage } from './StylePage';
import { RequestPage } from './RequestPage';
import { builtInsFor, hasTap, indicatorWord, phaseWords, stateName, stateNote, styleStates, useStatePreview } from './words';

const colourChoices: readonly Choice[] = [{ value: '', label: 'From the style' }, { value: 'unlit', label: 'Unlit' }, { value: 'lit', label: 'Lit' }];

// MARK: The group

/**
 * The States group of a state tile's inspector (studio-ux2, pick 7): the Style row, "Show state" (a choice of what the simulator
 * draws, never written), and the four layers of the shown state as overrides on this tile. Everything a style says for every tile
 * lives under Project, State Styles.
 */
export function StatesGroup({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const api = useStatePreview();
  const { entities } = useWorkspaceData();
  const node = valueAt(document, path) as StateTileNode | undefined;
  const binding = node?.binding;
  const library = document.stateStyles;
  const style = binding ? resolveTileStyle(binding, library) : undefined;
  const entries = useMemo(() => style ? styleStates(style) : [], [style]);
  const live = entities.find(row => row.entityId === binding?.entityId)?.state;
  // It starts on the entity's live state when Home Assistant is connected, else on the first state of the style.
  const initial = (live && entries.some(entry => entry.state === live) ? live : entries[0]?.state) ?? 'unavailable';
  const mine = node && api?.preview?.nodeId === node.id ? api.preview : undefined;
  const set = api?.set;
  useEffect(() => { if (set && node && !mine) set({ nodeId: node.id, state: initial }); }, [set, node?.id, mine === undefined, initial]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  if (!node || !binding) return null;
  const current = mine ?? { nodeId: node.id, state: initial };
  const edit = (next: StateTileBinding, group?: string) => onChange(replaceAt(document, [...path, 'binding'], next as unknown as Json), group);
  const openStyles = () => push?.push({ title: 'State Styles', body: <StylesPanel/> });

  // MARK: Style row
  const domain = binding.entityId.split('.')[0];
  const saved = (library?.styles ?? []).filter(item => item.domain === domain);
  const missing = Boolean(binding.styleId) && !library?.styles.some(item => item.id === binding.styleId);
  const styleValue = binding.styleId && !missing ? `saved:${binding.styleId}` : `built:${binding.builtIn ?? ''}`;
  const pickStyle = (value: string) => {
    if (value === 'manage') { openStyles(); return; }
    const { styleId: _gone, builtIn: _was, ...rest } = binding;
    if (value.startsWith('built:')) { edit({ ...rest, builtIn: value.slice(6) as StateTileBinding['builtIn'] }); return; }
    const chosen = saved.find(item => item.id === value.slice(6));
    const builtIn = binding.builtIn ?? chosen?.base;
    edit({ ...rest, styleId: value.slice(6), ...(builtIn ? { builtIn } : {}) });
  };
  const styleRow = <div className="w2-row" data-field-path={`${path.join('/')}/binding/style`}><div className="field"><span>Style</span>
    <ChoiceSelect label="Style" value={styleValue} shown={style?.name} onChange={pickStyle} groups={[
      ...(builtInsFor(domain).length ? [{ heading: 'Built-In', choices: builtInsFor(domain).map(item => ({ value: `built:${item.id}`, label: item.name })) }] : []),
      ...(saved.length ? [{ heading: 'Saved', choices: saved.map(item => ({ value: `saved:${item.id}`, label: item.name })) }] : []),
      { choices: [{ value: 'manage', label: 'Manage Styles…' }] },
    ]}/></div>
    {missing && <p className="w2-caption w2-missing-style"><Tag tone="warning">Missing</Tag> This style is no longer in the project. The tile shows its built-in style.</p>}
  </div>;
  if (!style) return <>{styleRow}</>;

  // MARK: The shown state
  const phase = current.phase;
  const state = current.state;
  const unavailable = state === 'unavailable' || state === 'unknown';
  const rule = ruleFor(style, state);
  const base = previewTile(style, state, [], {}, node.icon.name);
  const own: StateOverride | undefined = overrideFor(binding, state);
  const edited = new Set((binding.overrides ?? []).map(item => item.state));
  const layer = (name: OverrideLayer, value: string | undefined, group?: string) => edit(setOverride(binding, state, name, value), group);
  const reset = (name: OverrideLayer) => edit(resetOverride(binding, state, name));
  const options = indicatorOptions(unavailable ? { class: 'unknown' } : rule);
  const arc = options.find(item => item.value === 'arc-spinner');
  const colourOk = colourAllowed(base.stateClass);
  const phaseNote = phase ? 'Set by the style.' : undefined;

  const save = () => {
    const result = saveAsNewStyle(document, binding, name.trim());
    if (!result) return;
    onChange(replaceAt({ ...document, stateStyles: result.library }, [...path, 'binding'], result.binding as unknown as Json));
    setSaving(false); setName('');
  };
  return <>
    {styleRow}
    <div className="w2-row" data-field-path={`${path.join('/')}/binding/show`}><div className="field"><span>Show state</span>
      <StateMenu entries={entries} value={current} edited={edited} afterTap={hasTap(style)} onPick={next => set?.({ nodeId: node.id, ...next })}/></div>
      <p className="w2-caption" data-testid="state-note">{phase ? <><ClassDot stateClass={phase === 'sending' ? 'in-progress' : 'error'}/> {phaseWords[phase]}. {phaseNote}</> : stateNote(rule, unavailable)}</p>
    </div>
    {phase ? <div className="w2-row"><button type="button" className="w2-list-row" onClick={() => push?.push({ title: 'Request', body: <RequestPage id={style.id}/> })}>
      <span>Request Settings</span><ChevronRight size={16} aria-hidden/></button></div> : <>
      <LayerRow label="Icon" field={`${path.join('/')}/binding/overrides/icon`} edited={own?.icon !== undefined} onReset={() => reset('icon')}>
        <PickerRow title="Icon" glyph={<span className="w2-picker-glyph"><GlyphByName name={own?.icon ?? base.icon} size={18}/></span>}
          primary={own?.icon ? iconName(own.icon) ?? own.icon : <span className="w2-placeholder">From the style</span>}>
          {close => <IconList value={own?.icon ?? base.icon} onPick={picked => { layer('icon', picked); close(); }}/>}
        </PickerRow>
      </LayerRow>
      <LayerRow label="Words" field={`${path.join('/')}/binding/overrides/text`} edited={own?.text !== undefined} onReset={() => reset('text')}>
        <TextInput label="Words" value={own?.text ?? ''} placeholder={base.text} maxLength={80} onCommit={value => layer('text', value, `states-words:${node.id}:${state}`)}/>
      </LayerRow>
      <LayerRow label="Indicator" field={`${path.join('/')}/binding/overrides/indicator`} edited={own?.indicator !== undefined} onReset={() => reset('indicator')}
        note={arc && !arc.available ? `${arc.note}.` : undefined}>
        <ChoiceSelect label="Indicator" value={own?.indicator ?? ''} onChange={value => layer('indicator', value || undefined)}
          groups={[{ choices: [{ value: '', label: 'From the style' }, ...options.map(item => ({ value: item.value, label: indicatorWord[item.value], disabled: !item.available, note: item.note ? `${item.note}.` : undefined }))] }]}/>
      </LayerRow>
      <LayerRow label="Color" field={`${path.join('/')}/binding/overrides/colour`} edited={own?.colour !== undefined} onReset={() => reset('colour')} note={colourOk ? undefined : 'Color follows the class.'}>
        <ChoiceSelect label="Color" value={own?.colour ?? ''} disabled={!colourOk} onChange={value => layer('colour', value || undefined)} groups={[{ choices: colourChoices }]}/>
      </LayerRow>
    </>}
    <div className="w2-row w2-states-buttons">
      {own && !phase && <button type="button" onClick={() => edit(resetOverride(binding, state))}>Reset {stateName(state)}</button>}
      {Boolean(binding.overrides?.length) && !saving && <button type="button" onClick={() => { setSaving(true); setName(`${style.name} copy`); }}>Save as New Style…</button>}
    </div>
    {saving && <div className="w2-row w2-save-style"><div className="field"><span>Name</span><TextInput label="Name for the new style" value={name} maxLength={80} onCommit={setName}/></div>
      <div className="w2-editor-foot-inline"><button type="button" onClick={() => setSaving(false)}>Cancel</button><button type="button" className="w2-primary" disabled={!name.trim()} onClick={save}>Save Style</button></div></div>}
  </>;
}

// MARK: When tapped

/** "When tapped: Set by the style": a state tile's tap is its style's, so the row opens the style instead of editing a field. */
export function StateTapRow({ path }: { path: EditorPath }) {
  const { document } = useRows();
  const push = usePush();
  const node = valueAt(document, path) as StateTileNode | undefined;
  const style = node ? resolveTileStyle(node.binding, document.stateStyles) : undefined;
  return <div className="w2-row" data-field-path={`${path.join('/')}/tap`}>
    <button type="button" className="w2-add-row w2-tap-row" disabled={!style} onClick={() => style && push?.push({ title: style.name, body: <StylePage id={style.id}/> })}>
      <span className="w2-row-label">When tapped</span><span className="w2-summary">Set by the style</span><ChevronRight size={16} aria-hidden/>
    </button>
  </div>;
}
