import { useEffect, useState } from 'react';
import { request } from '../../api';
import { Modal, Tag } from '../kit';
import { toastManager } from '../toasts';
import type { Workspace2 } from '../useWorkspace2';

const when = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); };

/** Project > Publish History (spec 5.7): revisions newest first, "Live" on the current one, "Roll Back" with a confirm. */
export default function History({ ws }: { ws: Workspace2 }) {
  const { publicationError, refreshPublication, log } = ws;
  // A page pushed on the narrow sheet keeps the workspace it was opened with, so the list holds the latest answer itself.
  const [latest, setLatest] = useState<Awaited<ReturnType<typeof refreshPublication>>>(ws.publication);
  const publication = latest ?? ws.publication, liveRevision = publication?.current?.revision;
  const refresh = async () => { const next = await refreshPublication(); setLatest(next); return next; };
  const [target, setTarget] = useState<number>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loaded, setLoaded] = useState(Boolean(publication));
  useEffect(() => { void refreshPublication().then(setLatest).finally(() => setLoaded(true)); }, [refreshPublication]);
  const entries = publication?.current ? [publication.current, ...publication.history] : [];
  const rollBack = async () => {
    if (target === undefined) return;
    setBusy(true); setError('');
    try {
      await request('/native/api/ha/rollback', { method: 'POST', body: JSON.stringify({ revision: target }) });
      toastManager.add({ title: 'Rolled back' }); log(`Rolled back to revision ${target}`); setTarget(undefined); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <div className="w2-history-body" data-state={!loaded ? 'loading' : publicationError && !publication ? 'failed' : entries.length === 0 ? 'empty' : 'ready'}>
    {!loaded ? <p className="w2-empty" role="status">Loading…</p>
      : publicationError && !publication ? <div className="w2-empty-block"><p role="alert" className="w2-error-text">{publicationError}</p><button type="button" onClick={() => void refresh()}>Try Again</button></div>
        : entries.length === 0 ? <p className="w2-empty">Nothing published yet.</p>
          : <ul className="w2-history">{entries.map(entry => <li key={entry.revision}>
            <div className="w2-history-text"><strong>Revision {entry.revision}</strong><time dateTime={entry.publishedAt}>{when(entry.publishedAt)}</time></div>
            {entry.revision === liveRevision ? <Tag tone="success">Live</Tag> : <button type="button" aria-label={`Roll Back to Revision ${entry.revision}`} disabled={busy} onClick={() => { setError(''); setTarget(entry.revision); }}>Roll Back</button>}
          </li>)}</ul>}
    {error && target === undefined && <p role="alert" className="w2-error-text">{error}</p>}
    <Modal open={target !== undefined} onOpenChange={open => { if (!open && !busy) { setError(''); setTarget(undefined); } }} size="s" title={`Roll Back to Revision ${target ?? ''}?`} dismissable={!busy}
      description="It becomes the live layout as a new revision. Your draft does not change."
      footer={<><button type="button" disabled={busy} onClick={() => { setError(''); setTarget(undefined); }}>Cancel</button><button type="button" className="w2-primary" disabled={busy} onClick={() => void rollBack()}>{error ? 'Try Again' : busy ? 'Rolling Back…' : 'Roll Back'}</button></>}>
      {error && <p role="alert" className="w2-error-text">{error}</p>}
    </Modal>
  </div>;
}
