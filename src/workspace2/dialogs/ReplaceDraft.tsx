import { useState } from 'react';
import { toastManager } from '../toasts';
import type { Workspace2 } from '../useWorkspace2';

/** The two commands that replace the whole draft, each asking first. */
const copy = {
  'start-published': {
    message: 'Replaces this draft with the layout your apps load now. The current draft is kept as a backup.',
    confirm: 'Replace Draft', done: 'Started from Published', log: 'Started the draft from the published layout',
  },
  'restore-draft': {
    message: 'Brings back the draft kept before the last replacement. This draft is kept as a backup.',
    confirm: 'Restore Draft', done: 'Restored', log: 'Restored the previous draft',
  },
} as const;

/**
 * Project > Start from Published and Restore Previous Draft: a confirm, then the server replaces the draft (it keeps the old one
 * as a backup, reads Home Assistant only, and never publishes). Unsaved edits are saved first so the backup holds them.
 */
export default function ReplaceDraft({ kind, ws, close }: { kind: keyof typeof copy; ws: Workspace2; close: () => void }) {
  const words = copy[kind];
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [failed, setFailed] = useState(false);
  const run = async () => {
    setBusy(true); setError(''); setFailed(false);
    try {
      if (ws.studio.dirty && !(await ws.persist())) throw new Error(ws.studio.error || 'Save the draft first.');
      const ok = await (kind === 'start-published' ? ws.studio.startFromPublished() : ws.studio.restorePreviousDraft());
      if (ok) { toastManager.add({ title: words.done }); ws.log(words.log); close(); }
      else setFailed(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <>
    <p>{words.message}</p>
    {(error || (failed && ws.studio.error)) && <p role="alert" className="w2-error-text">{error || ws.studio.error}</p>}
    <div className="w2-actions">
      <button type="button" disabled={busy} onClick={close}>Cancel</button>
      <button type="button" className="w2-primary" disabled={busy} onClick={() => void run()}>{busy ? 'Replacing…' : words.confirm}</button>
    </div>
  </>;
}
