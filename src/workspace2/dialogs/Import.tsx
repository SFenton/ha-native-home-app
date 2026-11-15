import { useRef, useState } from 'react';
import { importCompositionText } from '../../composition-editor';
import { CompositionValidationError, MAX_COMPOSITION_ENVELOPE_BYTES } from '../../shared/composition/json';
import { formatCompositionIssue } from '../../shared/composition/workspace';
import { Field } from '../../ui';
import { Modal } from '../kit';
import { useRows } from '../rows';
import { toastManager } from '../toasts';
import type { Workspace2 } from '../useWorkspace2';

/** Project > Import (spec 5.7): a file or pasted JSON through one Import button, or the house config from Home Assistant. */
export default function Import({ ws, close }: { ws: Workspace2; close: () => void }) {
  const { document, onChange } = useRows();
  const [text, setText] = useState(''), [error, setError] = useState(''), [replace, setReplace] = useState<ReturnType<typeof importCompositionText>>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const parse = () => {
    try { setReplace(importCompositionText(text, document.id)); setError(''); }
    catch (reason) { setError(reason instanceof CompositionValidationError ? reason.issues.map(formatCompositionIssue).join('\n') : reason instanceof Error ? reason.message : String(reason)); }
  };
  const fromHome = async () => {
    setBusy(true); setError('');
    try {
      if (ws.studio.dirty && !(await ws.persist())) throw new Error(ws.studio.error || 'Save the draft first.');
      if (await ws.studio.importHouse()) { toastManager.add({ title: 'Imported' }); ws.log('Imported from Home Assistant'); close(); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <>
    <Field label="Paste JSON"><textarea className="w2-code" value={text} onChange={event => { setText(event.target.value); setError(''); }}/></Field>
    <input ref={file} hidden type="file" accept=".json,application/json" aria-label="Choose File" onChange={async event => {
      const picked = event.target.files?.[0]; event.target.value = '';
      if (!picked) return;
      if (picked.size > MAX_COMPOSITION_ENVELOPE_BYTES) { setError('That file is too large to import.'); return; }
      setText(await picked.text());
    }}/>
    {error && <pre role="alert" className="w2-error-text w2-pre">{error}</pre>}
    <div className="w2-actions">
      <button type="button" onClick={() => file.current?.click()}>Choose File…</button>
      <button type="button" className="w2-primary" disabled={!text.trim()} onClick={parse}>Import</button>
    </div>
    <section className="w2-group" aria-label="From Home Assistant">
      <div className="w2-actions"><button type="button" disabled={busy} onClick={() => void fromHome()}>From Home Assistant</button></div>
      <p className="w2-caption">Adds the rooms and chores pages this draft does not have yet.</p>
    </section>
    <Modal open={Boolean(replace)} onOpenChange={open => { if (!open) setReplace(undefined); }} size="s" title="Replace the Draft?" description="Undo brings it back."
      footer={<><button type="button" onClick={() => setReplace(undefined)}>Cancel</button><button type="button" className="w2-primary" onClick={() => { if (replace) { onChange(replace); toastManager.add({ title: 'Imported' }); ws.log('Imported a document'); } setReplace(undefined); close(); }}>Replace</button></>}/>
  </>;
}
