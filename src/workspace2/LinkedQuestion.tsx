import { useEffect, useId, useRef, useState } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { placesText, nameValid } from './linked';
import type { LinkedGate } from './useLinkedGate';
import type { LinkedQuestion as Question } from './useLinkedGate';
import { useHeld } from './useHeld';

/**
 * The edit question (studio-linked spec): a change to a template that other places use asks before it is written. Two steps in one dialog,
 * `role="alertdialog"`: the choice (Update Template, Save as New Template…, Cancel, none of them the default, so a Return meant for the field does
 * nothing) and the name of the new template. Focus starts on the dialog itself; Escape and a click outside cancel.
 */
export default function LinkedQuestion({ gate }: { gate: LinkedGate }) {
  const question = gate.question;
  const shown = useHeld(question);
  return <AlertDialog.Root open={Boolean(question)} onOpenChange={next => { if (!next) gate.cancel(); }}>
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className="w2-backdrop"/>
      <AlertDialog.Viewport className="w2-dialog-viewport">
        {shown && (shown.step === 'ask' ? <Ask gate={gate} question={shown}/> : <NameStep gate={gate} question={shown}/>)}
      </AlertDialog.Viewport>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}

function Ask({ gate, question }: { gate: LinkedGate; question: Question }) {
  const popup = useRef<HTMLDivElement>(null);
  return <AlertDialog.Popup ref={popup} className="w2-scope w2-dialog w2-dialog-s w2-linked-question" data-testid="linked-question" tabIndex={-1} initialFocus={popup}>
    <header className="w2-dialog-head"><AlertDialog.Title>{`Update “${question.name}” everywhere?`}</AlertDialog.Title></header>
    <AlertDialog.Description className="w2-dialog-text">{placesText(question.places)}</AlertDialog.Description>
    <div className="w2-linked-actions">
      <button type="button" className="w2-tonal" onClick={gate.update}>Update Template</button>
      <button type="button" className="w2-tonal" onClick={gate.toName}>Save as New Template…</button>
      <button type="button" onClick={gate.cancel}>Cancel</button>
    </div>
  </AlertDialog.Popup>;
}

function NameStep({ gate, question }: { gate: LinkedGate; question: Question }) {
  const [name, setName] = useState(question.suggested);
  const field = useRef<HTMLInputElement>(null), errorId = useId();
  useEffect(() => { field.current?.select(); }, []);
  const taken = nameValid(name) && question.taken(name);
  const ok = nameValid(name) && !taken;
  const others = question.count;
  return <AlertDialog.Popup className="w2-scope w2-dialog w2-dialog-s w2-linked-question" data-testid="linked-name" initialFocus={field}>
    <header className="w2-dialog-head"><AlertDialog.Title>Save as New Template</AlertDialog.Title></header>
    <form onSubmit={event => { event.preventDefault(); if (ok) gate.saveNew(name.trim()); }}>
      <div className="w2-dialog-body">
        <label className="field"><span>Name</span>
          <input ref={field} value={name} maxLength={80} onChange={event => setName(event.target.value)} aria-invalid={taken || undefined} aria-describedby={taken ? errorId : undefined}/></label>
        {taken && <p id={errorId} role="alert" className="w2-field-error">{`A template named ${name.trim()} already exists.`}</p>}
        <AlertDialog.Description className="w2-dialog-text">
          {`This one is linked to the new template. ${others === 1 ? 'The other place keeps' : `The other ${others} places keep`} “${question.name}” as it was.`}
        </AlertDialog.Description>
      </div>
      <footer className="w2-dialog-foot">
        <button type="button" onClick={gate.cancel}>Cancel</button>
        <button type="submit" className="w2-primary" disabled={!ok}>Save</button>
      </footer>
    </form>
  </AlertDialog.Popup>;
}
