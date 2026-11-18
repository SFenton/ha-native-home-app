import { ChevronRight } from 'lucide-react';
import { valueAt, type EditorPath } from '../../composition-editor';
import type { Predicate } from '../../shared/composition/expression';
import EditorRow from '../editors/EditorRow';
import { useRows } from '../rowsContext';
import { evaluatePredicate } from '../data/logic/logicEval';
import ConditionEditor from './ConditionEditor';
import { conditionCount, groupOf, markerOf, missingEntity, resultText, summary, type Scope } from './condition';
import { Marker } from './ui';
import { useDataTag, useDraftEnvironment, useNameContext } from './useExpr';
import { groupCount, words, type Place } from './words';
import { removeRuleAt, whenUnknownOf } from './removal';

/** Props of {@link ConditionField}: where it is and what the place calls things. Wiring a place is one line plus its words (spec "Where the fields are wired"). */
export interface ConditionFieldProps {
  /** The row's label ("Only show when"). */
  label: string;
  /** The page title ("Only Show When"); the label by default. */
  title?: string;
  /** The condition's path in the document. */
  path: EditorPath;
  place: Place;
  /** The edited item's name, trailing in a dialog header and named by Undo. */
  itemName: string;
  /** Whether the place has an "If it can't tell" policy: `show` for show and hide, `enable` for enable and disable. */
  policy?: 'show' | 'enable';
  /** The word at rest while there is no condition: "Always" by default ("Never" for Ask first, "From the style" for a tile look). */
  none?: string;
  scope?: Scope;
  /** The key beside the condition that holds the policy. */
  policyKey?: string;
}

/**
 * The condition field (spec "The condition field"): one inspector row, the label and one button that opens the editor on a draft. At
 * rest it says the condition in a sentence and what it gives now, with a marker that is a shape and a word.
 */
export default function ConditionField({ label, title = label.replace(/(^|\s)(\w)/g, (_, space: string, letter: string) => `${space}${letter.toUpperCase()}`), path, place, itemName, policy, none = words.always, scope = 'document', policyKey = 'whenUnknown' }: ConditionFieldProps) {
  const { document, onChange, problems } = useRows();
  const rule = valueAt(document, path) as Predicate | undefined;
  const env = useDraftEnvironment(document), ctx = useNameContext(document), tag = useDataTag();
  const tri = rule && env ? evaluatePredicate(rule, env) : undefined;
  const missing = missingEntity(rule, ctx);
  const problem = missing ? `Home Assistant has no entity named ${missing}.` : problems?.get(path.join('/'));
  const group = rule && groupOf(rule), line1 = !rule ? none : group ? groupCount(group.mode, conditionCount(rule)) : summary(rule, ctx);
  const result = resultText(place, tri);
  const unknownPolicy = policy ? whenUnknownOf(document, path, policyKey) : undefined;
  const line2 = !rule ? '' : missing ? words.noEntity : tri === 'unknown' ? `${result} · ${unknownPolicy === 'hide' || unknownPolicy === 'disabled' ? (policy === 'enable' ? 'Disabled' : 'Hidden') : unknownPolicy === 'show' || unknownPolicy === 'enabled' ? (policy === 'enable' ? 'Enabled' : 'Shown') : 'Kept as it was'}` : env ? `${result} · ${tag}` : '';
  const name = rule ? `${label}: ${line1}.${missing ? ` ${words.noEntity}.` : tri === 'unknown' ? ` ${line2.replace(' · ', ', ')}.` : result && env ? ` ${result}, ${tag.toLowerCase()}.` : ''}` : `${label}: ${none}.`;
  return <EditorRow label={label} title={title} summary={line1} itemName={itemName} document={document} onApply={onChange} path={path.join('/')}
    remove={rule ? { label: words.removeCondition, run: draft => draft.set(removeRuleAt(draft.get(), path, policy ? policyKey : undefined)) } : undefined}
    head={start => <div className="w2-expr-fieldrow" data-field-path={path.join('/')} data-has-condition={rule ? '' : undefined}>
      <span className="w2-row-label">{label}</span>
      <button type="button" className="w2-expr-fieldbtn" data-testid="condition-field" data-two-line={rule ? '' : undefined} data-problem={problem ? '' : undefined} title={rule ? line1 : undefined}
        aria-label={name} aria-describedby={problem ? `${path.join('-')}-problem` : undefined} onClick={start}>
        {rule && <Marker kind={markerOf(tri, Boolean(problem))}/>}
        <span className="w2-expr-fieldtext"><span className={`w2-expr-line1 ${rule ? '' : 'w2-expr-none'}`}>{line1}</span>{rule && line2 && <span className="w2-expr-line2">{line2}</span>}</span>
        <ChevronRight size={16} aria-hidden/>
      </button>
      {problem && <p id={`${path.join('-')}-problem`} className="w2-error-text w2-expr-problem" data-field-problem={path.join('/')}>{problem}</p>}
    </div>}>
    {draft => <ConditionEditor draft={draft} path={path} place={place} scope={scope} policy={policy} policyKey={policyKey}/>}
  </EditorRow>;
}
