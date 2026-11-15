import { useCallback, useEffect, useState } from 'react';
import { request } from './api';
import { Dialog } from './ui';

/** Shapes returned by the Studio's `/native/api/ha/*` endpoints (server/ha-publication.ts). */
export interface HaPublicationEntry { revision: number; publishedAt: string; publishedBy: string | null; envelopeSha256: string; capabilities: string[] }
export interface HaPublicationSummary { epoch: string; current: HaPublicationEntry | null; history: HaPublicationEntry[]; storedAssets: number }
export interface HaPublishResult { epoch: string; revision: number; envelopeSha256: string; uploadedAssets?: number; skippedAssets?: number }

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function Row({ entry, current, onRollback, disabled }: { entry: HaPublicationEntry; current?: boolean; onRollback?: () => void; disabled: boolean }) {
  return <tr>
    <th scope="row">r{entry.revision}{current && <span className="badge">current</span>}</th>
    <td><time dateTime={entry.publishedAt}>{when(entry.publishedAt)}</time></td>
    <td><code title={entry.publishedBy ?? undefined}>{entry.publishedBy ? entry.publishedBy.slice(0, 12) : 'unknown'}</code></td>
    <td>{onRollback && <button disabled={disabled} onClick={onRollback} aria-label={`Roll back to revision ${entry.revision}`}>Roll back</button>}</td>
  </tr>;
}

/**
 * The Home Assistant delivery panel: the revision the app follows, recent history and rollback.
 * `published` changes after each publish so the list reloads; the publish action itself lives in the header.
 */
export default function HomeAssistantPublication({ published, busy, onChange }: { published?: HaPublishResult; busy: boolean; onChange: (message: string) => void }) {
  const [summary, setSummary] = useState<HaPublicationSummary>();
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<HaPublicationEntry>();
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setSummary(await request<HaPublicationSummary>('/native/api/ha/publication')); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, published?.revision]);
  const rollback = async (entry: HaPublicationEntry) => {
    setLoading(true); setTarget(undefined);
    try {
      const result = await request<HaPublishResult>('/native/api/ha/rollback', { method: 'POST', body: JSON.stringify({ revision: entry.revision }) });
      onChange(`Rolled back to the content of revision ${entry.revision}; Home Assistant now serves revision ${result.revision}.`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
  };
  const disabled = busy || loading;
  return <section aria-label="Home Assistant publication">
    <p>The app follows what is published here. <strong>Publish</strong> uploads new images, then saves this draft as the next revision. The app updates live.</p>
    {published && <p>Last published from this session: revision {published.revision}
      {published.uploadedAssets !== undefined && ` (${published.uploadedAssets} image${published.uploadedAssets === 1 ? '' : 's'} uploaded, ${published.skippedAssets ?? 0} already stored)`}.</p>}
    {error && <div role="alert" className="inline-error">{error}</div>}
    <div className="composition-actions"><button disabled={disabled} onClick={() => void refresh()}>{loading ? 'Loading...' : 'Refresh history'}</button></div>
    {summary && (summary.current ? <table className="composition-history">
      <caption>History (last 6)</caption>
      <thead><tr><th scope="col">Revision</th><th scope="col">Published</th><th scope="col">Publisher</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
      <tbody>
        <Row entry={summary.current} current disabled={disabled}/>
        {summary.history.map(entry => <Row key={entry.revision} entry={entry} disabled={disabled} onRollback={() => setTarget(entry)}/>)}
      </tbody>
    </table> : <p>Nothing published yet.</p>)}
    {target && <Dialog title={`Roll back to revision ${target.revision}?`} onClose={() => setTarget(undefined)}>
      <p>Publishes revision {target.revision} again as a new revision. Apps update at once. Your draft is unchanged.</p>
      <div className="dialog-actions"><button onClick={() => setTarget(undefined)}>Keep current</button><button className="primary" onClick={() => void rollback(target)}>Roll back</button></div>
    </Dialog>}
  </section>;
}
