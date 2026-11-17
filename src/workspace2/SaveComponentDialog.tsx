import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { valueAt } from '../composition-editor';
import type { CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { captureText, linkedInside, nameTaken, nameValid } from './linked';
import type { LinkedGate } from './useLinkedGate';
import { useHeld } from './useHeld';

/**
 * Save as Template (studio-linked spec): one field holding the node's title, all selected, the line that says what is captured, and Cancel and Save.
 * Save is the default; Return saves. Nothing here changes another place.
 */
export default function SaveComponentDialog({ gate, document }: { gate: LinkedGate; document: CompositionDocument | undefined }) {
  const request = gate.saving;
  const node = request && document ? valueAt(document, request.path) as CompositionNode | undefined : undefined;
  const shown = useHeld(request && node && document ? { request, node, document } : undefined);
  return <Dialog.Root open={Boolean(request && node)} onOpenChange={next => { if (!next) gate.closeSave(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="w2-backdrop"/>
      <Dialog.Viewport className="w2-dialog-viewport">{shown && <Body key={shown.request.key} gate={gate} document={shown.document} node={shown.node}/>}</Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}

function Body({ gate, document, node }: { gate: LinkedGate; document: CompositionDocument; node: CompositionNode }) {
  const [name, setName] = useState(node.type === 'component-ref' ? '' : node.title);
  const field = useRef<HTMLInputElement>(null), errorId = useId();
  // The menu that opened this dialog returns focus to its own button as it closes; the field takes it back once that is done.
  useEffect(() => { const frame = window.requestAnimationFrame(() => { field.current?.focus(); field.current?.select(); }); return () => window.cancelAnimationFrame(frame); }, []);
  const taken = nameValid(name) && nameTaken(document, name);
  const ok = nameValid(name) && !taken;
  return <Dialog.Popup className="w2-scope w2-dialog w2-dialog-s" data-modal data-testid="save-component" initialFocus={field}>
    <header className="w2-dialog-head"><Dialog.Title>Save as Template</Dialog.Title><Dialog.Close className="w2-icon-button" aria-label="Close"><X size={18} aria-hidden/></Dialog.Close></header>
    <form onSubmit={event => { event.preventDefault(); if (ok) gate.confirmSave(name.trim()); }}>
      <div className="w2-dialog-body">
        <label className="field"><span>Name</span>
          <input ref={field} value={name} maxLength={80} onChange={event => setName(event.target.value)} aria-invalid={taken || undefined} aria-describedby={taken ? errorId : undefined}/></label>
        {taken && <p id={errorId} role="alert" className="w2-field-error">{`A template named ${name.trim()} already exists.`}</p>}
        <Dialog.Description className="w2-dialog-text">{captureText(node, linkedInside(node))}</Dialog.Description>
      </div>
      <footer className="w2-dialog-foot">
        <button type="button" onClick={gate.closeSave}>Cancel</button>
        <button type="submit" className="w2-primary" disabled={!ok}>Save</button>
      </footer>
    </form>
  </Dialog.Popup>;
}
