import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { addStyleRule, duplicateStyle, moveStyleRule, renameStyle } from '../../shared/composition/state-style-library';
import { builtInStyle } from '../../shared/composition/state-styles';
import { usePush } from '../kit';
import { TextInput } from '../editors/controls';
import { ClassDot } from './StateMenu';
import { RequestPage } from './RequestPage';
import { RulePage } from './RulePage';
import { StylePreview } from './StylePreview';
import { useStyle } from './useStyle';
import { classWord, stateName, tapWords } from './words';

/**
 * One style: its picture, its name, the states in the order the app tries them, and the request that follows a tap. A built-in style
 * shows the same page with every field disabled and "Duplicate to Edit".
 */
export function StylePage({ id }: { id: string }) {
  const { document, onChange, style, readOnly, edit, uses, tiles } = useStyle(id);
  const push = usePush();
  const [added, setAdded] = useState('');
  if (!style) return <p className="w2-empty">This style is no longer in the project.</p>;
  const library = document.stateStyles;
  const copied = readOnly ? undefined : builtInStyle(style.base)?.name;
  const names = added.trim();
  const taken = style.rules.some(rule => rule.states.includes(names));
  const openRule = (index: number) => push?.push({ title: index < 0 ? 'Anything Else' : style.rules[index].states.map(stateName).join(', '), body: <RulePage id={id} index={index}/> });
  const duplicate = () => {
    const copy = duplicateStyle(library, style);
    onChange({ ...document, stateStyles: copy.library });
    push?.pop(); push?.push({ title: `${style.name} copy`, body: <StylePage id={copy.id}/> });
  };
  const first = tiles[0];
  return <div className="w2-style-page">
    <StylePreview style={style} title={first?.title ?? style.name} overrides={first?.binding.overrides} icon={first?.icon.name}/>
    {readOnly && <div className="w2-style-locked"><p className="w2-caption">Built-in styles can’t be changed.</p><button type="button" onClick={duplicate}>Duplicate to Edit</button></div>}
    <div className="w2-row"><div className="field"><span>Name</span><TextInput label="Name" value={style.name} maxLength={80} disabled={readOnly}
      onCommit={name => name.trim() && library && onChange({ ...document, stateStyles: renameStyle(library, id, name.trim()) }, `style-name:${id}`)}/></div></div>
    <div className="w2-row"><div className="field"><span>Hidden words</span><TextInput label="Hidden words" value={style.hiddenWords ?? ''} placeholder="Same as the state" maxLength={80} disabled={readOnly}
      onCommit={hiddenWords => edit({ ...style, hiddenWords: hiddenWords.trim() || undefined }, `style-hidden:${id}`)}/></div>
      <p className="w2-caption">Shown instead of the state’s words while the screen is hidden, as in a screenshot.</p></div>
    {copied && <div className="w2-row"><div className="field"><span>Copied from</span><span className="w2-readonly">{copied}</span></div></div>}
    {!readOnly && uses > 0 && <p className="w2-caption" data-testid="changes-apply">Changes apply to {uses} {uses === 1 ? 'tile' : 'tiles'}.</p>}
    <section aria-label="States"><h3 className="w2-group-title">States</h3>
      <p className="w2-caption">The first match wins.</p>
      <ul className="w2-state-rows">
        {style.rules.map((rule, index) => <li key={`${index}-${rule.states.join()}`} className="w2-state-row">
          <button type="button" className="w2-link-row" onClick={() => openRule(index)}>
            <ClassDot stateClass={rule.class}/><span className="w2-style-text"><span className="w2-page-title">{rule.states.map(stateName).join(', ')}</span>
              <span className="w2-page-via">{classWord[rule.class]} · {tapWords(rule)}</span></span><ChevronRight size={16} aria-hidden/></button>
          {!readOnly && <>
            <button type="button" className="w2-icon-button" aria-label={`Move ${stateName(rule.states[0])} up`} disabled={index === 0} onClick={() => edit(moveStyleRule(style, index, -1))}><ArrowUp size={16} aria-hidden/></button>
            <button type="button" className="w2-icon-button" aria-label={`Move ${stateName(rule.states[0])} down`} disabled={index === style.rules.length - 1} onClick={() => edit(moveStyleRule(style, index, 1))}><ArrowDown size={16} aria-hidden/></button>
          </>}
        </li>)}
        <li className="w2-state-row"><button type="button" className="w2-link-row" onClick={() => openRule(-1)}>
          <ClassDot stateClass={style.fallback.class}/><span className="w2-style-text"><span className="w2-page-title">Anything Else</span>
            <span className="w2-page-via">{classWord[style.fallback.class]} · {tapWords(style.fallback)}</span></span><ChevronRight size={16} aria-hidden/></button></li>
      </ul>
      {!readOnly && <div className="w2-row w2-add-state"><div className="field"><span>New state</span>
        <TextInput label="Name of the new state" value={added} placeholder="Home Assistant’s name, like charging" onCommit={setAdded}/></div>
        <div className="w2-editor-foot-inline"><button type="button" disabled={!names || taken} onClick={() => { edit(addStyleRule(style, names)); setAdded(''); }}>Add State</button></div>
        {taken && <p className="w2-caption">A state with that name is already here.</p>}</div>}
    </section>
    <section aria-label="After a tap"><h3 className="w2-group-title">After a tap</h3>
      {style.request ? <button type="button" className="w2-link-row" onClick={() => push?.push({ title: 'Request', body: <RequestPage id={id}/> })}><span>Request</span><ChevronRight size={16} aria-hidden/></button>
        : <div className="w2-row"><p className="w2-caption">This style has no request phase: a tap shows no sending words and no wait.</p>
          {!readOnly && <button type="button" onClick={() => edit({ ...style, request: { lockoutSeconds: 2, ackTimeoutSeconds: 10, settleTimeoutSeconds: 45, errorHoldSeconds: 4, onTimeout: 'error' } })}>Add a Request Phase</button>}</div>}
    </section>
  </div>;
}
