import { PickerRow } from '../../pickers/PickerField';
import type { Draft } from '../../editors/draft';
import { useDraftDocument } from '../../editors/draft';
import type { LogicEntry } from '../../../shared/composition/logic-library';
import { libraryOf, makeUse, defaultArgs, setsLine } from './logicModel';
import { useLogicScope } from './logicScope';
import { logicWords } from './logicWords';

/**
 * The "+ Template" button of the Logic view's add row: a list of Condition templates. A pick adds a use of it as a new condition. It is not offered inside a
 * logic template's own editor, whose body holds no use of another template.
 */
export default function LogicTemplateButton({ draft, onPick }: { draft: Draft; onPick: (entry: LogicEntry, use: ReturnType<typeof makeUse>) => void }) {
  const document = useDraftDocument(draft), scope = useLogicScope();
  if (scope) return null;
  const entries = libraryOf(document).filter(entry => entry.kind === 'condition');
  return <PickerRow stacked title={logicWords.condAddTitle} primary={logicWords.condAdd} popupClassName="w2-expr-addpop">
    {close => <div className="w2-expr-picker" data-testid="logic-template-list">
      {entries.length === 0 ? <p className="w2-caption">{logicWords.condNone}</p>
        : <ul className="w2-expr-picklist" aria-label="Condition templates">{entries.map(entry => <li key={entry.id}><button type="button" className="w2-expr-pickrow" onClick={() => { close(); onPick(entry, makeUse(entry, defaultArgs(entry))); }}>
          {entry.name}<small className="w2-choice-note">{setsLine(entry)}</small></button></li>)}</ul>}
    </div>}
  </PickerRow>;
}
