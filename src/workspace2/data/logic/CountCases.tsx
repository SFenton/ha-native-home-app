import { useState } from 'react';
import type { Operand, Predicate } from '../../../shared/composition/expression';
import type { Draft } from '../../editors/draft';
import { useDraftDocument } from '../../editors/draft';
import { PickerRow } from '../../pickers/PickerField';
import ValuePicker from '../../expr/ValuePicker';
import { countCases, entryOf, COUNT_MAX_ENTITIES, howManyAre, settingKindOf } from './logicModel';
import { useLogicScope } from './logicScope';
import { logicWords } from './logicWords';

/** The rules a count writes, ready for a rules list. */
export interface CountResult { cases: { when: Predicate; then: Operand }[]; otherwise: Operand }

/** "How Many Are…": tick the Entity settings to count and the state they count in; the count is `math` over `choose`, operands the grammar already has. */
function HowMany({ draft, onPick }: { draft: Draft; onPick: (count: Operand) => void }) {
  const scope = useLogicScope(), document = useDraftDocument(draft);
  const entry = scope ? entryOf(document, scope.entryId) : undefined;
  const entities = entry?.params.filter(param => settingKindOf(param) === 'entity') ?? [];
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(entities.slice(0, COUNT_MAX_ENTITIES).map(param => param.name)));
  const [state, setState] = useState('on');
  if (entities.length === 0) return null;
  const chosen = entities.filter(param => ticked.has(param.name)).map(param => param.name);
  return <fieldset className="w2-logic-rows" data-testid="how-many"><legend className="w2-group-title">{logicWords.howMany}</legend>
    <p className="w2-caption">{logicWords.howManyTick}</p>
    <p className="w2-caption" data-testid="count-limit">{logicWords.howManyLimit}</p>
    {entities.map(param => <label key={param.name} className="w2-logic-checkrow"><input type="checkbox" checked={ticked.has(param.name)} disabled={!ticked.has(param.name) && ticked.size >= COUNT_MAX_ENTITIES}
      onChange={event => setTicked(held => { const next = new Set(held); if (event.target.checked) next.add(param.name); else next.delete(param.name); return next; })}/><span>{param.label ?? param.name}</span></label>)}
    <label className="w2-logic-name"><span className="w2-row-label">{logicWords.howManyState}</span>
      <input aria-label={logicWords.howManyState} value={state} maxLength={160} onChange={event => setState(event.target.value)}/></label>
    <p className="w2-caption">{logicWords.howManyNote}</p>
    <button type="button" className="w2-primary" disabled={chosen.length === 0 || !state.trim()} onClick={() => onPick(howManyAre(chosen, [state.trim()]) as unknown as Operand)}>{logicWords.howManyAdd}</button>
  </fieldset>;
}

/**
 * "Add Cases for a Count…", above the first row of a text value's Rules: it asks which value is counted and writes three rules, is 0, is 1 and is more than 1,
 * then Otherwise. Inside a logic template the counted value's picker lists the template's settings first, then How Many Are….
 */
export default function CountCases({ draft, onCases }: { draft: Draft; onCases: (result: CountResult) => void }) {
  return <PickerRow stacked title={logicWords.countAsk} primary={logicWords.countAdd} popupClassName="w2-expr-addpop">
    {close => <div className="w2-logic-countpick" data-testid="count-picker">
      <p className="w2-caption">{logicWords.countCases}</p>
      <HowMany draft={draft} onPick={count => { close(); onCases(countCases(count as never) as unknown as CountResult); }}/>
      <ValuePicker draft={draft} onPick={picked => { close(); onCases(countCases((picked.operand.type === 'read' ? { ...picked.operand, as: 'number' } : picked.operand) as never) as unknown as CountResult); }}/>
    </div>}
  </PickerRow>;
}
