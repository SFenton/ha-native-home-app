import { createContext, useContext, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { EditorPath } from '../../composition-editor';
import type { Predicate } from '../../shared/composition/expression';
import { SelectMenu } from '../SelectMenu';
import { usePush } from '../kit';
import { PickerRow } from '../pickers/PickerField';
import type { Draft } from '../editors/draft';
import { evaluatePredicate } from '../../preview2/evaluate';
import ConditionRow from './ConditionRow';
import ValuePicker, { type Picked } from './ValuePicker';
import { conditionCount, groupAt, groupOf, groupPredicate, growProblem, markerOf, moveItem, replaceGroupAt, resultText, type Group, type Scope } from './condition';
import { Marker, MoreMenu, type MenuCommand } from './ui';
import { useDraftEnvironment, useNameContext } from './useExpr';
import { useRule } from './useRule';
import { groupCount, groupSentence, groupTitle, words, type Place } from './words';

/** Which row is open in the builder: one at a time (D5). */
const OpenRow = createContext<{ open: string | undefined; setOpen: (key: string | undefined) => void }>({ open: undefined, setOpen: () => {} });

/** What a builder needs: the draft and where the condition is in it, never a closure, so a pushed page reads what is there now. */
export interface BuilderProps {
  draft: Draft; path: EditorPath; place: Place; scope: Scope; policyKey?: string;
  /** How many levels draw in place before a group becomes a row that pushes a page; 2 is option C (D4). */
  inlineDepth: number;
}

/** The condition a freshly picked value starts as: "is on" for a state, "is above 0" for a number, "is yes" for a yes or no value. */
export function defaultFor(picked: Picked): Predicate {
  if (picked.predicate) return picked.predicate;
  const left = picked.operand;
  if (picked.kind === 'number') return { type: 'compare', op: 'above', left, right: { type: 'literal', value: 0 } };
  if (picked.kind === 'yesno') return { type: 'compare', op: 'eq', left, right: { type: 'literal', value: true } };
  if (picked.kind === 'date') return { type: 'compare', op: 'after', left, right: { type: 'literal', value: '2026-01-01' } };
  const read = left.type === 'read' ? left : undefined;
  if (read && read.from.path.length === 1 && read.from.path[0] === 'state') return { type: 'state', sourceId: read.from.sourceId, path: read.from.path, in: [picked.closed?.[0] ?? 'on'] };
  return { type: 'compare', op: 'eq', left, right: { type: 'literal', value: picked.closed?.[0] ?? '' } };
}

/** An Add button that opens the value picker; the pick becomes the new condition (or the first of a new group), open. */
function AddButton({ draft, label, onPicked }: { draft: Draft; label: string; onPicked: (picked: Picked) => void }) {
  return <PickerRow stacked title={`Add ${label.replace(/^\+ /, '')}`} primary={label} popupClassName="w2-expr-addpop">
    {close => <ValuePicker draft={draft} conditions onPick={picked => { close(); onPicked(picked); }}/>}
  </PickerRow>;
}

/** One group: its header, its rows, and the two Add buttons. Groups past `inlineDepth` are a row that pushes their own page. */
function GroupView({ props, at, level }: { props: BuilderProps; at: readonly number[]; level: number }) {
  const { draft, path, place, scope, inlineDepth, policyKey } = props;
  const { document, rule, write } = useRule(draft, path, policyKey);
  const ctx = useNameContext(document);
  const { open, setOpen } = useContext(OpenRow);
  const env = useDraftEnvironment(document);
  const push = usePush();
  const group = groupAt(rule, at);
  if (!group) return null;
  const root = at.length === 0, rows = group.items.length;
  const keyOf = (index: number) => `${at.join('.')}:${index}`;
  const setGroup = (next: Group | undefined, base?: typeof document) => write(replaceGroupAt(rule, at, next), base);
  const setItems = (items: Predicate[], base?: typeof document) => setGroup({ ...group, items }, base);
  const replaceItem = (index: number, next: Predicate, base?: typeof document, typing?: string) =>
    write(replaceGroupAt(rule, at, { ...group, items: group.items.map((item, i) => i === index ? next : item) }), base, typing);
  const addProblem = growProblem(rule, scope, 'condition', rows, level), groupProblem = growProblem(rule, scope, 'group', rows, level);
  const own = (index: number) => (first: readonly MenuCommand[]): readonly MenuCommand[] => [
    ...first,
    { label: words.duplicate, run: () => setItems([...group.items.slice(0, index + 1), structuredClone(group.items[index]), ...group.items.slice(index + 1)]), disabled: Boolean(addProblem) },
    { label: words.moveUp, run: () => setItems(moveItem(group.items, index, -1)), disabled: index === 0 },
    { label: words.moveDown, run: () => setItems(moveItem(group.items, index, 1)), disabled: index === rows - 1 },
    { label: words.moveIntoGroup, run: () => setItems(group.items.map((item, i) => i === index ? groupPredicate({ mode: 'all', items: [item] }) : item)), disabled: Boolean(groupProblem) },
    { label: words.removeCondition, run: () => setItems(group.items.filter((_, i) => i !== index)), danger: true, separatorBefore: true },
  ];
  const parent = root ? undefined : groupAt(rule, at.slice(0, -1)), index = at.at(-1) ?? 0;
  const headerCommands: MenuCommand[] = [
    ...(rows === 1 ? [{ label: words.turnIntoSingle, run: () => root ? write(group.items[0]) : write(replaceGroupAt(rule, at.slice(0, -1), { ...parent!, items: parent!.items.map((item, i) => i === index ? group.items[0] : item) })) }] : []),
    ...(root ? [] : [
      { label: words.duplicate, run: () => write(replaceGroupAt(rule, at.slice(0, -1), { ...parent!, items: [...parent!.items.slice(0, index + 1), structuredClone(parent!.items[index]), ...parent!.items.slice(index + 1)] })) },
      { label: words.removeGroup, run: () => setGroup(undefined), danger: true, separatorBefore: true },
    ]),
  ];
  const limitId = `w2-expr-limit-${level}-${at.join('-')}`;
  return <div className={root ? 'w2-expr-group w2-expr-root' : 'w2-expr-group w2-expr-nested'} role="group" aria-label={`${groupSentence[group.mode]}, level ${level}, ${conditionCount(groupPredicate(group))} ${conditionCount(groupPredicate(group)) === 1 ? 'condition' : 'conditions'}`} data-level={level}>
    <div className="w2-expr-grouphead">
      <div className="w2-expr-modepick"><SelectMenu label={root ? 'All, Any or None' : `Group ${index + 1}: All, Any or None`} value={group.mode} options={[{ value: 'all', label: words.all }, { value: 'any', label: words.any }, { value: 'none', label: words.none }]}
        onChange={mode => setGroup({ ...group, mode: mode as Group['mode'] })}/></div>
      <span className="w2-expr-ofthese">{words.ofTheseAreTrue}</span>
      {headerCommands.length > 0 && <MoreMenu label={`More for ${root ? 'this group' : `group ${index + 1}`}`} commands={headerCommands}/>}
    </div>
    <ul className="w2-expr-rows">
      {group.items.map((item, at2) => {
        const inner = groupOf(item);
        if (inner && level + 1 > inlineDepth) {
          const tri = env ? evaluatePredicate(item, env) : undefined, text = groupCount(inner.mode, conditionCount(item));
          return <li key={at2} className="w2-expr-row"><div className="w2-expr-rowhead"><button type="button" className="w2-expr-rowbtn w2-expr-grouprow"
            aria-label={`Group: ${text.charAt(0).toLowerCase()}${text.slice(1)}. ${resultText('rule', tri) || 'Result unknown'}. Opens a page.`}
            onClick={() => push?.push({ title: groupTitle(inner.mode), body: <GroupPage props={props} at={[...at, at2]}/> })}>
            <Marker kind={markerOf(tri)} size={18}/><span className="w2-expr-sentence"><strong>{text}</strong></span><ChevronRight size={16} aria-hidden/></button></div></li>;
        }
        if (inner) return <li key={at2} className="w2-expr-row"><GroupView props={props} at={[...at, at2]} level={level + 1}/></li>;
        return <ConditionRow key={at2} draft={draft} item={item} index={at2} ctx={ctx} label={words.condition} open={open === keyOf(at2)}
          onOpen={next => setOpen(next ? keyOf(at2) : undefined)} onChange={(next, base, typing) => replaceItem(at2, next, base, typing)} onCommands={own(at2)}/>;
      })}
    </ul>
    <div className="w2-expr-addrow">
      {!addProblem && <AddButton draft={draft} label={words.addCondition} onPicked={picked => { setItems([...group.items, defaultFor(picked)], picked.document); setOpen(keyOf(rows)); }}/>}
      {addProblem && <button type="button" className="w2-expr-add" disabled aria-describedby={limitId}>{words.addCondition}</button>}
      {!groupProblem && <AddButton draft={draft} label={words.addGroup} onPicked={picked => { setItems([...group.items, groupPredicate({ mode: 'all', items: [defaultFor(picked)] })], picked.document); setOpen(`${[...at, rows].join('.')}:0`); }}/>}
      {groupProblem && <button type="button" className="w2-expr-add" disabled aria-describedby={limitId}>{words.addGroup}</button>}
    </div>
    {(addProblem || groupProblem) && <p id={limitId} className="w2-caption">{groupProblem ?? addProblem}</p>}
  </div>;
}

/** The page a level-3 group pushes: that group is the root of its own page, and the draft is still the one the whole editor works on. */
function GroupPage({ props, at }: { props: BuilderProps; at: readonly number[] }) {
  const [open, setOpen] = useState<string | undefined>();
  return <OpenRow.Provider value={{ open, setOpen }}><div className="w2-expr-page" data-testid="group-page"><GroupView props={props} at={at} level={1}/></div></OpenRow.Provider>;
}

/** The Logic editor (spec "The condition editor: Logic"): groups of conditions, two levels in place and a third on a pushed page. */
export default function LogicBuilder(props: Omit<BuilderProps, 'inlineDepth'> & { inlineDepth?: number }) {
  const [open, setOpen] = useState<string | undefined>();
  return <OpenRow.Provider value={{ open, setOpen }}><div className="w2-expr-logic" data-testid="logic-builder"><GroupView props={{ inlineDepth: 2, ...props }} at={[]} level={1}/></div></OpenRow.Provider>;
}
