import { useEffect, useState } from 'react';
import { classFixed, patchStyleRule, removeStyleRule } from '../../shared/composition/state-style-library';
import { colourAllowed, indicatorOptions, type StateClass, type StateRule } from '../../shared/composition/state-styles';
import { defaultIndicator, titleCase } from '../../shared/composition/state-style-preview';
import { GlyphByName } from '../../preview2/nodes/shared';
import { usePush } from '../kit';
import { TextInput } from '../editors/controls';
import { PickerRow } from '../pickers/PickerField';
import ColorPairField from '../pickers/ColorPairField';
import IconList from '../pickers/IconList';
import { iconName } from '../pickers/icons';
import { ChoiceSelect, type Choice } from './ChoiceSelect';
import { LayerRow } from './LayerRow';
import { useStyle } from './useStyle';
import { classWord, indicatorWord, pickableClasses, stateName, tapWords } from './words';

const words = (text: string) => text.split(',').map(item => item.trim()).filter(Boolean);

/** A comma list that applies when the field is left, so typing a comma never eats it. */
function ListInput({ label, value, disabled, onApply }: { label: string; value: readonly string[]; disabled?: boolean; onApply: (next: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => setText(value.join(', ')), [value]);
  return <input aria-label={label} value={text} disabled={disabled} onChange={event => setText(event.target.value)}
    onBlur={() => { const next = words(text); if (next.length && next.join() !== value.join()) onApply(next); else setText(value.join(', ')); }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>;
}

/**
 * One state of a style, shared by every tile that uses the style: which Home Assistant states it covers, what they mean, whether the
 * face is lit, and the four layers. "When Tapped" says in words what the disc does; the tap is read-only (a copy of a built-in style
 * keeps the taps it was made with).
 */
export function RulePage({ id, index }: { id: string; index: number }) {
  const { style, readOnly, edit } = useStyle(id);
  const push = usePush();
  if (!style) return <p className="w2-empty">This style is no longer in the project.</p>;
  const fallback = index < 0;
  const rule = (fallback ? style.fallback : style.rules[index]) as StateRule | undefined;
  if (!rule) return <p className="w2-empty">This state is no longer in the style.</p>;
  const patch = (change: Partial<StateRule>, group?: string) => edit(patchStyleRule(style, index, change), group);
  const fixed = !fallback && classFixed(rule as StateRule);
  const stateClass = rule.class;
  const options = indicatorOptions(rule);
  const arc = options.find(item => item.value === 'arc-spinner');
  const colourOk = colourAllowed(stateClass);
  const means: Choice[] = (fixed ? (['unknown'] as StateClass[]) : pickableClasses).map(item => ({ value: item, label: classWord[item] }));
  const firstState = fallback ? 'state' : (rule as StateRule).states[0];
  const field = `rule/${index}`;
  return <div className="w2-rule-page">
    {!fallback && <div className="w2-row"><div className="field"><span>States</span>
      <ListInput label="States" value={(rule as StateRule).states} disabled={readOnly} onApply={states => patch({ states })}/></div>
      <p className="w2-caption">Home Assistant’s names, separated by commas.</p></div>}
    <div className="w2-row"><div className="field"><span>Means</span>
      <ChoiceSelect label="Means" value={stateClass} disabled={readOnly || fixed} groups={[{ choices: means }]} onChange={value => patch({ class: value as StateClass })}/></div>
      {fixed && <p className="w2-caption">Unavailable and unknown always mean Unavailable.</p>}</div>
    <label className="w2-switch-row"><span className="w2-row-label">Lit</span>
      <input type="checkbox" role="switch" checked={rule.active} disabled={readOnly} onChange={event => patch({ active: event.target.checked })}/></label>
    <LayerRow label="Icon" field={`${field}/icon`} edited={rule.icon !== undefined} onReset={() => patch({ icon: undefined })} resetLabel="Clear Icon">
      <PickerRow title="Icon" glyph={rule.icon ? <span className="w2-picker-glyph"><GlyphByName name={rule.icon} size={18}/></span> : undefined}
        primary={rule.icon ? iconName(rule.icon) ?? rule.icon : <span className="w2-placeholder">Default</span>}>
        {close => readOnly ? <p className="w2-caption">Built-in styles can’t be changed.</p> : <IconList value={rule.icon} onPick={picked => { patch({ icon: picked }); close(); }}/>}
      </PickerRow>
    </LayerRow>
    <LayerRow label="Words" field={`${field}/text`} edited={rule.text !== undefined} onReset={() => patch({ text: undefined })} resetLabel="Clear Words">
      <TextInput label="Words" value={rule.text ?? ''} placeholder={titleCase(firstState)} maxLength={80} disabled={readOnly} onCommit={text => patch({ text: text || undefined }, `rule-words:${id}:${index}`)}/>
    </LayerRow>
    <LayerRow label="Indicator" field={`${field}/indicator`} edited={rule.indicator !== undefined} onReset={() => patch({ indicator: undefined })} resetLabel="Clear Indicator" note={arc && !arc.available ? `${arc.note}.` : undefined}>
      <ChoiceSelect label="Indicator" value={rule.indicator ?? ''} disabled={readOnly} onChange={value => patch({ indicator: (value || undefined) as StateRule['indicator'] })}
        groups={[{ choices: [{ value: '', label: `Default for ${classWord[stateClass]}`, note: `${indicatorWord[defaultIndicator(stateClass, Boolean(rule.action))]}.` },
          ...options.map(item => ({ value: item.value, label: indicatorWord[item.value], disabled: !item.available, note: item.note ? `${item.note}.` : undefined }))] }]}/>
    </LayerRow>
    <LayerRow label="Color" field={`${field}/colour`} edited={rule.colour !== undefined} onReset={() => patch({ colour: undefined })} resetLabel="Clear Color" note={colourOk ? undefined : 'Color follows the class.'}>
      <ChoiceSelect label="Color" value={rule.colour ?? ''} disabled={readOnly || !colourOk} onChange={value => patch({ colour: (value || undefined) as StateRule['colour'] })}
        groups={[{ choices: [{ value: '', label: 'Class Default' }, { value: 'unlit', label: 'Unlit' }, { value: 'lit', label: 'Lit' }] }]}/>
    </LayerRow>
    <LayerRow label="Fill" field={`${field}/fill`} edited={rule.fill !== undefined} onReset={() => patch({ fill: undefined })} resetLabel="Clear Fill"
      note={rule.fill || readOnly ? undefined : 'Without a fill the tile draws the face of its class.'}>
      {readOnly && !rule.fill ? <span className="w2-readonly">Class Default</span>
        : <ColorPairField label="Fill" path={`${field}/fill`} allowStandard={false} allowPair value={rule.fill ?? { type: 'solid-rgb', red: 84, green: 110, blue: 122 }}
          onChange={next => { if (!readOnly && next.type !== 'standard') patch({ fill: next }, `rule-fill:${id}:${index}`); }}/>}
    </LayerRow>
    <LayerRow label="Words on fill" field={`${field}/fillInk`} edited={rule.fillInk !== undefined} onReset={() => patch({ fillInk: undefined })} resetLabel="Clear Words on Fill"
      note={rule.fill ? undefined : 'Needs a fill. Without one, the words keep the ink of the face.'}>
      <ChoiceSelect label="Words on fill" value={rule.fillInk ?? ''} disabled={readOnly || !rule.fill} onChange={value => patch({ fillInk: (value || undefined) as StateRule['fillInk'] })}
        groups={[{ choices: [{ value: '', label: 'White' }, { value: 'soft', label: 'Soft White', note: 'White at 92%.' }] }]}/>
    </LayerRow>
    <section aria-label="When tapped"><h3 className="w2-group-title">When tapped</h3>
      <div className="w2-row"><div className="field"><span>Tap</span><span className="w2-readonly" data-testid="rule-tap">{rule.action ? rule.action.verb : 'Nothing'}</span></div>
        <p className="w2-caption">{rule.action ? `${tapWords(rule)}${rule.action.confirmation ? ', after asking first' : ''}. Taps come with the built-in style a copy was made from.` : 'A tap does nothing in this state.'}</p></div>
    </section>
    {!fallback && <div className="w2-row"><button type="button" className="w2-danger" disabled={readOnly || style.rules.length < 2}
      onClick={() => { edit(removeStyleRule(style, index)); push?.pop(); }}>Remove {stateName(firstState)}</button>
      {style.rules.length < 2 && <p className="w2-caption">A style keeps at least one state.</p>}</div>}
  </div>;
}
