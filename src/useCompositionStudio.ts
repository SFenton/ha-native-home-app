import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, request } from './api';
import { compileCompositionDocument } from './shared/composition/compiler';
import { canonicalCompositionJSON, CompositionValidationError } from './shared/composition/json';
import type { CompositionDocument, CompositionPublication } from './shared/composition/schema';
import type { HaPublishResult } from './HomeAssistantPublication';
import { formatCompositionIssue, type CompositionDraft } from './shared/composition/workspace';

/** What the server's import of house-config layout did: what it added, what the draft already authored, what it could not express. */
export interface HouseImportReport {
  revision: number; added: string[]; kept: string[]; dropped: { path: string; reason: string }[];
}

export function useCompositionStudio() {
  const [document, setDocument] = useState<CompositionDocument>();
  const current = useRef<CompositionDocument | undefined>(undefined);
  const [envelope, setEnvelope] = useState<CompositionDraft>();
  const metadata = useRef<CompositionDraft | undefined>(undefined);
  const saved = useRef('');
  const past = useRef<CompositionDocument[]>([]);
  const future = useRef<CompositionDocument[]>([]);
  const [busy, setBusy] = useState(false), locked = useRef(false);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [conflict, setConflict] = useState(false);
  const [publishedRevision, setPublishedRevision] = useState<number>();
  const [homeAssistant, setHomeAssistant] = useState<HaPublishResult>();
  const [houseImport, setHouseImport] = useState<HouseImportReport>();
  const report = useCallback((reason: unknown) => {
    if (reason instanceof ApiError && reason.status === 409) setConflict(true);
    setError(reason instanceof CompositionValidationError
      ? reason.issues.map(formatCompositionIssue).join('\n')
      : reason instanceof Error ? reason.message : String(reason));
  }, []);
  const reload = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    const snapshot = current.current;
    try {
      const next = await request<CompositionDraft>('/native/api/draft');
      if (current.current !== snapshot) throw new Error('Reload cancelled because local work changed while loading');
      compileCompositionDocument(next.document);
      metadata.current = next; saved.current = canonicalCompositionJSON(next.document);
      current.current = next.document; past.current = []; future.current = [];
      setEnvelope(next); setDocument(next.document); setConflict(false); setStatus(`Loaded native draft revision ${next.revision}`);
    } catch (reason) { report(reason); }
    finally { locked.current = false; setBusy(false); }
  }, [report]);
  useEffect(() => { void reload(); }, [reload]);
  const apply = useCallback((next: CompositionDocument) => {
    if (!current.current || canonicalCompositionJSON(next) === canonicalCompositionJSON(current.current)) return;
    past.current = [...past.current.slice(-59), current.current]; future.current = [];
    current.current = next; setDocument(next); setStatus('');
  }, []);
  const persist = useCallback(async (expected: number) => {
    if (!current.current) throw new Error('Load the native workspace first');
    const snapshot = compileCompositionDocument(current.current).document;
    const next = await request<CompositionDraft>('/native/api/draft', { method: 'PUT', body: JSON.stringify({ document: snapshot, expectedRevision: expected }) });
    metadata.current = next; saved.current = canonicalCompositionJSON(next.document); setEnvelope(next); setConflict(false);
    return next;
  }, []);
  const save = useCallback(async (publish: boolean | 'home-assistant' = false, keepLocal = false) => {
    if (locked.current || !metadata.current || !current.current) return false;
    locked.current = true; setBusy(true); setError(''); setStatus('');
    try {
      let expected = metadata.current.revision;
      if (keepLocal) expected = (await request<CompositionDraft>('/native/api/draft')).revision;
      let next = metadata.current;
      if (keepLocal || canonicalCompositionJSON(current.current) !== saved.current) next = await persist(expected);
      if (publish === 'home-assistant') {
        const result = await request<HaPublishResult>('/native/api/ha/publish', { method: 'POST', body: JSON.stringify({ expectedRevision: next.revision }) });
        setHomeAssistant(result);
        setStatus(`Published to Home Assistant as revision ${result.revision} (draft ${next.revision}).`);
      } else if (publish) {
        const published = await request<CompositionPublication>('/native/api/publish', { method: 'POST', body: JSON.stringify({ expectedRevision: next.revision }) });
        setPublishedRevision(published.revision);
        setStatus(`Published revision ${published.revision}.`);
      } else setStatus(`Saved draft revision ${next.revision}`);
      return true;
    } catch (reason) { report(reason); return false; }
    finally { locked.current = false; setBusy(false); }
  }, [persist, report]);
  /** Adds the layout parts missing from the saved draft from the live house config, then reloads the draft. */
  const importHouse = useCallback(async () => {
    if (locked.current || !metadata.current) return false;
    locked.current = true; setBusy(true); setError(''); setStatus('');
    try {
      const report = await request<HouseImportReport>('/native/api/import-house-config', { method: 'POST', body: JSON.stringify({ expectedRevision: metadata.current.revision }) });
      const next = await request<CompositionDraft>('/native/api/draft');
      compileCompositionDocument(next.document);
      metadata.current = next; saved.current = canonicalCompositionJSON(next.document);
      current.current = next.document; past.current = []; future.current = [];
      setEnvelope(next); setDocument(next.document); setConflict(false); setHouseImport(report);
      setStatus(`Imported from house config: ${report.added.length} added, ${report.kept.length} already authored, ${report.dropped.length} not expressible.`);
      return true;
    } catch (reason) { report(reason); return false; }
    finally { locked.current = false; setBusy(false); }
  }, [report]);
  const undo = () => {
    const next = past.current.pop();
    if (next && current.current) { future.current.push(current.current); current.current = next; setDocument(next); }
  };
  const redo = () => {
    const next = future.current.pop();
    if (next && current.current) { past.current.push(current.current); current.current = next; setDocument(next); }
  };
  const dirty = Boolean(document && canonicalCompositionJSON(document) !== saved.current);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  return {
    document, envelope, publishedRevision, homeAssistant, houseImport, importHouse, setStatus, busy, error, status, conflict, dirty,
    canUndo: past.current.length > 0, canRedo: future.current.length > 0,
    apply, save, reload, undo, redo, setError, report,
  };
}
