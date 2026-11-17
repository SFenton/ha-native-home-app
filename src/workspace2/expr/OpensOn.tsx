import { ChevronRight, Plus } from 'lucide-react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Predicate } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import EditorRow from '../editors/EditorRow';
import { useDraftDocument, type Draft } from '../editors/draft';
import { usePush } from '../kit';
import { useRows } from '../rowsContext';
import { SelectMenu } from '../SelectMenu';
import ConditionEditor from './ConditionEditor';
import { sentence } from './condition';
import { useNameContext } from './useExpr';
import { words } from './words';

interface Automatic { tabId: string; selectedWhen?: Predicate }
interface TabsNode { tabs: { id: string; label: string }[]; props: { automatic?: Automatic[]; fallbackTabId?: string } }
const MAX_AUTOMATIC = 5;

/** The page of one "Opens on" rule: the condition, and the tab it opens. */
function RuleOnPage({ draft, nodePath, index }: { draft: Draft; nodePath: EditorPath; index: number }) {
  const document = useDraftDocument(draft), push = usePush();
  const node = valueAt(document, nodePath) as TabsNode | undefined, entry = node?.props.automatic?.[index];
  if (!node || !entry) return null;
  const list = [...node.props.automatic!];
  const write = (next: Automatic[]) => draft.set(replaceAt(draft.get(), [...nodePath, 'props', 'automatic'], next as unknown as Json));
  return <div className="w2-expr-rulepage" data-testid="opens-on-rule">
    <div className="w2-expr-pagehead"><span className="w2-expr-grouplabel">{words.ifWord}</span></div>
    <ConditionEditor draft={draft} path={[...nodePath, 'props', 'automatic', index, 'selectedWhen']} place="rule" scope="rule"/>
    <hr className="w2-menu-sep"/>
    <div className="w2-row-segment"><span className="w2-row-label">{words.then}</span>
      <div className="w2-expr-control"><SelectMenu label="Opens tab" value={entry.tabId} options={node.tabs.map(tab => ({ value: tab.id, label: tab.label }))}
        onChange={tabId => { list[index] = { ...entry, tabId }; write(list); }}/></div></div>
    <button type="button" className="w2-editor-remove w2-expr-removerule" onClick={() => { write(list.filter((_, i) => i !== index)); push?.pop(); }}>{words.removeRule}</button>
  </div>;
}

/** The editor body: the rules in order, then Add Rule. The first rule that is true opens its tab; none true opens the one the container chooses. */
function OpensOnBody({ draft, nodePath }: { draft: Draft; nodePath: EditorPath }) {
  const document = useDraftDocument(draft), push = usePush(), ctx = useNameContext(document);
  const node = valueAt(document, nodePath) as TabsNode | undefined;
  if (!node) return null;
  const list = node.props.automatic ?? [];
  const label = (id: string) => node.tabs.find(tab => tab.id === id)?.label ?? id;
  const add = () => {
    const used = new Set(list.map(item => item.tabId)), tab = node.tabs.find(item => !used.has(item.id)) ?? node.tabs[0];
    draft.set(replaceAt(draft.get(), [...nodePath, 'props', 'automatic'], [...list, { tabId: tab.id }] as unknown as Json));
    push?.push({ title: `Rule ${list.length + 1}`, body: <RuleOnPage draft={draft} nodePath={nodePath} index={list.length}/> });
  };
  return <div className="w2-expr-editor" data-testid="opens-on">
    <p className="w2-caption">{words.firstRuleTrue}</p>
    <ol className="w2-expr-rules">{list.map((entry, index) => <li key={index} className="w2-expr-rule">
      <button type="button" className="w2-expr-rulebtn" aria-label={`Rule ${index + 1} of ${list.length}: if ${entry.selectedWhen ? sentence(entry.selectedWhen, ctx) : 'no condition yet'}, then ${label(entry.tabId)}.`}
        onClick={() => push?.push({ title: `Rule ${index + 1}`, body: <RuleOnPage draft={draft} nodePath={nodePath} index={index}/> })}>
        <span className="w2-expr-num">{index + 1}</span>
        <span className="w2-expr-ruletext"><span className="w2-expr-line1">{words.ifWord} {entry.selectedWhen ? sentence(entry.selectedWhen, ctx) : '…'}</span><span className="w2-expr-line2">{words.then} {label(entry.tabId)}</span></span>
        <ChevronRight size={16} aria-hidden/></button></li>)}</ol>
    <button type="button" className="w2-expr-add" disabled={list.length >= MAX_AUTOMATIC} onClick={add}><Plus size={14} aria-hidden/>{words.addRule}</button>
  </div>;
}

/** "Opens on" (spec "A modal's default tab"): rules over a tab container's tabs, stored as `automatic[]`. */
export function OpensOn({ path, itemName }: { path: EditorPath; itemName: string }) {
  const { document, onChange } = useRows();
  const node = valueAt(document, path) as TabsNode | undefined;
  if (!node) return null;
  const count = node.props.automatic?.length ?? 0;
  const blocked = (doc: typeof document) => {
    const next = valueAt(doc, path) as TabsNode | undefined;
    return next?.props.automatic?.some(item => !item.selectedWhen) ? words.ruleNeedsCondition : undefined;
  };
  return <EditorRow label={words.opensOn} summary={count ? `${count} rule${count === 1 ? '' : 's'}` : words.firstTab} itemName={itemName} document={document} onApply={onChange} path={path.join('/')} blocked={blocked}>
    {draft => <OpensOnBody draft={draft} nodePath={path}/>}
  </EditorRow>;
}

/** "If that tab is hidden" (`fallbackTabId`): the first tab shown, or one tab. */
export function FallbackTab({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const node = valueAt(document, path) as TabsNode | undefined;
  if (!node) return null;
  const current = node.props.fallbackTabId ?? '';
  return <div className="w2-row-segment" data-field-path={`${path.join('/')}/props/fallbackTabId`}><span className="w2-row-label">{words.ifTabHidden}</span>
    <div className="w2-expr-control"><SelectMenu label={words.ifTabHidden} value={current} options={[{ value: '', label: words.firstTabShown }, ...node.tabs.map(tab => ({ value: tab.id, label: tab.label }))]}
      onChange={next => {
        const { fallbackTabId: _gone, ...rest } = node.props;
        onChange(replaceAt(document, [...path, 'props'], next ? { ...rest, fallbackTabId: next } : rest));
      }}/></div></div>;
}
