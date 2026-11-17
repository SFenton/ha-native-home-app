import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../api';
import { Modal } from './kit';
import { toastManager } from './toasts';
import type { Workspace2 } from './useWorkspace2';

/**
 * What the server says the Studio should do with the draft it just opened (`GET /native/api/ha/open-check`).
 * `start`: the draft has no edits the app lacks. `ask`: it has unpublished edits. `keep`: leave it and say nothing.
 */
export interface OpenCheck { action: 'start' | 'ask' | 'keep'; reason: string; draftRevision: number; publishedRevision?: number }

/**
 * Opening the Studio starts from the published layout (studio-ux2 "Start from Published on open").
 *
 * - A draft with no unpublished edits is replaced by the layout the app serves now, silently. The old draft is kept as a backup
 *   (the newest five), so Project > Restore Previous Draft still brings it back.
 * - A draft with unpublished edits asks first: Start from Published (the default) or Keep My Draft.
 * - With no Home Assistant connected or reachable, or nothing published, or a draft that already is the published layout, the
 *   draft stays as it is and nothing is said.
 *
 * It checks once, when the draft first loads. The server only reads Home Assistant; nothing is published.
 */
export default function OpenFromPublished({ ws, active }: { ws: Workspace2; active: boolean }) {
  const { studio } = ws;
  const checked = useRef(false);
  const [asking, setAsking] = useState<OpenCheck>();
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const start = studio.startFromPublished;
  const loaded = Boolean(studio.envelope);
  const revision = studio.envelope?.revision;
  useEffect(() => {
    if (!active || !loaded || checked.current) return;
    checked.current = true;
    void (async () => {
      let answer: OpenCheck;
      try { answer = await request<OpenCheck>('/native/api/ha/open-check'); } catch { return; }
      if (!answer || answer.action === 'keep') return;
      // Work begun while the check ran is never replaced behind the person's back.
      if (!studio.isSaved() || answer.draftRevision !== revision) return;
      if (answer.action === 'ask') { setAsking(answer); return; }
      if (await start()) ws.log('Started the draft from the published layout');
      else studio.setError('');
    })();
  }, [active, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = useCallback(() => { setAsking(undefined); setFailure(''); }, []);
  const replace = async () => {
    setBusy(true); setFailure('');
    try {
      if (studio.dirty && !(await ws.persist())) throw new Error(studio.error || 'Save the draft first.');
      if (await start()) { toastManager.add({ title: 'Started from Published' }); ws.log('Started the draft from the published layout'); setAsking(undefined); }
      else setFailure(studio.error || 'The draft was not replaced.');
    } catch (reason) { setFailure(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const primary = useRef<HTMLButtonElement>(null);
  return <Modal open={asking !== undefined} onOpenChange={next => { if (!next && !busy) keep(); }} size="s" dismissable={!busy} title="Start from Published?" initialFocus={primary}
    description="This draft has changes that are not published. Start from the layout your apps load now, or keep working on your draft. The draft is kept as a backup if you start over."
    footer={<>
      <button type="button" disabled={busy} onClick={keep}>Keep My Draft</button>
      <button type="button" ref={primary} className="w2-primary" disabled={busy} onClick={() => void replace()}>{busy ? 'Starting…' : 'Start from Published'}</button>
    </>}>
    {failure && <p role="alert" className="w2-error-text">{failure}</p>}
  </Modal>;
}
