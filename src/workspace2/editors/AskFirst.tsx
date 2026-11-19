import { useContext, useEffect, useRef, useState } from 'react';
import { ChevronRight, Lock } from 'lucide-react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { AlertBox } from '../../preview2/AlertOverlay';
import { alertOf } from '../../preview2/alert';
import { PreviewInkContext } from '../../preview2/ink';
import { Tag, useNarrow, usePush } from '../kit';
import { askOf, askProblem, askSummary, withAsk } from './action';
import { useAlertPreview } from './alertPreview';
import { LabeledRow, Switch, TextInput } from './controls';
import { useDraftDocument, type Draft } from './draft';
import { SelectMenu } from '../SelectMenu';
import ConditionEditor from '../expr/ConditionEditor';

/** How long the simulator keeps the alert after focus leaves the page's fields, so moving between fields does not blink. */
export const ALERT_LINGER_MS = 150;

/** The alert on a slice of wallpaper, 190 px high: the page's own picture, there where the simulator is hidden. */
export function AlertPicture({ path, draft }: { path: EditorPath; draft: Draft }) {
  const ink = useContext(PreviewInkContext);
  const doc = useDraftDocument(draft);
  const spec = alertOf(askOf(valueAt(doc, path) as never));
  if (!spec) return null;
  return <figure className="w2-alert-picture" aria-label="A picture of the alert">
    <div className="sh-preview2 w2-alert-picture-frame" data-ink={ink} aria-hidden="true"><div className="w2-alert-wall"/><AlertBox alert={spec}/></div>
  </figure>;
}

/**
 * The Ask First page (pick 5, A and B): the alert's Title, Message and Button, the red-button option, and a picture of the result.
 * While a field of the page has focus the simulator draws the same alert over its screen.
 */
export function AskFirstPage({ draft, path, itemName }: { draft: Draft; path: EditorPath; itemName: string }) {
  const doc = useDraftDocument(draft);
  const action = valueAt(doc, path) as { type: string } & Record<string, unknown>;
  const ask = askOf(action as never);
  const narrow = useNarrow();
  const publish = useAlertPreview();
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const set = (next: unknown) => draft.set(replaceAt(draft.get(), path, next));
  const change = (patch: Parameters<typeof withAsk>[1]) => set(withAsk(valueAt(draft.get(), path) as typeof action, patch, itemName));
  const field = (target: EventTarget | null) => target instanceof Element && target.closest('[data-ask-field]') !== null;
  const spec = ask ? alertOf(ask) : undefined;
  useEffect(() => { publish?.(focused && !narrow ? spec : undefined); }, [focused, narrow, spec?.title, spec?.message, spec?.confirmLabel, spec?.destructive, Boolean(spec)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { clearTimeout(timer.current); publish?.(undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="w2-editor-section w2-ask-first" data-testid="ask-first"
    onFocusCapture={event => { if (field(event.target)) { clearTimeout(timer.current); setFocused(true); } }}
    onBlurCapture={event => { if (field(event.target) && !field(event.relatedTarget)) { clearTimeout(timer.current); timer.current = setTimeout(() => setFocused(false), ALERT_LINGER_MS); } }}>
    <Switch label="Ask first" checked={Boolean(ask)} onChange={on => change(on ? 'on' : 'off')}/>
    {ask && <>
      {action.type === 'domain' && <AskWhen draft={draft} path={path} when={'when' in ask && Boolean((ask as { when?: unknown }).when)}/>}
      <div data-ask-field><LabeledRow label="Title"><TextInput label="Title" value={ask.title} maxLength={240} onCommit={text => change({ title: text })}/></LabeledRow>
        {!ask.title.trim() && <p className="w2-caption w2-field-error">Add a title.</p>}</div>
      <div data-ask-field><LabeledRow label="Message"><TextInput multiline label="Message" placeholder="Optional" value={ask.message ?? ''} maxLength={2000} onCommit={text => change({ message: text })}/></LabeledRow></div>
      <div data-ask-field><LabeledRow label="Button"><TextInput label="Button" value={ask.confirmLabel} maxLength={240} onCommit={text => change({ confirmLabel: text })}/></LabeledRow>
        {ask.title.trim() && !ask.confirmLabel.trim() && <p className="w2-caption w2-field-error">Add a button label.</p>}</div>
      <LabeledRow label="Cancel"><span className="w2-readonly" data-testid="ask-cancel"><span>Cancel</span><Lock size={14} aria-label="Fixed"/></span></LabeledRow>
      <p className="w2-caption">The app always says Cancel.</p>
      <div data-ask-field><Switch label="Red button" checked={ask.destructive} onChange={on => change({ destructive: on })}/></div>
      <AlertPicture path={path} draft={draft}/>
    </>}
  </div>;
}

/** "Ask": always, or only when a condition holds (`confirmation.when`; a condition that cannot be answered asks). */
function AskWhen({ draft, path, when }: { draft: Draft; path: EditorPath; when: boolean }) {
  const [on, setOn] = useState(when);
  const confirmation = [...path, 'confirmation'];
  const change = (next: string) => {
    setOn(next === 'when');
    if (next === 'when') return;
    const current = valueAt(draft.get(), confirmation) as Record<string, unknown> | undefined;
    if (current && 'when' in current) { const { when: _gone, ...rest } = current; draft.set(replaceAt(draft.get(), confirmation, rest)); }
  };
  return <div data-testid="ask-when">
    <LabeledRow label="Ask"><SelectMenu label="Ask" value={on ? 'when' : 'always'} options={[{ value: 'always', label: 'Always' }, { value: 'when', label: 'When…' }]} onChange={change}/></LabeledRow>
    {on && <ConditionEditor draft={draft} path={[...confirmation, 'when']} place="ask" scope="document"/>}
  </div>;
}

/** The "Ask first" row of a service call or an on-or-off action: its summary is "Off" or the alert's title, and it opens the page. */
export function AskFirstRow({ draft, path, itemName }: { draft: Draft; path: EditorPath; itemName: string }) {
  const push = usePush();
  const doc = useDraftDocument(draft);
  const action = valueAt(doc, path);
  const problem = askProblem(action as never);
  return <button type="button" className="w2-disclosure-head" data-disclosure="ask-first" onClick={() => push?.push({ title: 'Ask First', body: <AskFirstPage draft={draft} path={path} itemName={itemName}/> })}>
    <span className="w2-row-label">Ask first</span><span className="w2-summary">{askSummary(action as never)}</span>
    {problem && <Tag tone="warning">{problem}</Tag>}<ChevronRight size={16} aria-hidden/>
  </button>;
}
