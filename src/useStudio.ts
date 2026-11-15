import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, loadDraft, request, saveDraft, validateDocument } from './api';
import type { DataSource, DraftEnvelope, StudioDocument } from './shared/types';
import type { Edit } from './editor';

export type Notice = { id: number; message: string; tone: 'success' | 'error' | 'info' };
export function useStudio() {
  const [document, setDocument] = useState<StudioDocument>();
  const current = useRef<StudioDocument | undefined>(undefined);
  const revision = useRef(0);
  const saved = useRef('');
  const past = useRef<StudioDocument[]>([]);
  const future = useRef<StudioDocument[]>([]);
  const editGeneration = useRef(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [serverMode, setServerMode] = useState('sample');
  const [savedDataSources, setSavedDataSources] = useState<DataSource[]>([]);
  const busyRef = useRef(false);
  const notify = useCallback((message: string, tone: Notice['tone'] = 'info') => {
    setNotices(previous => [...previous.slice(-3), { id: Date.now() + Math.random(), message, tone }]);
  }, []);
  const install = useCallback((envelope: DraftEnvelope) => {
    current.current = envelope.document; revision.current = envelope.revision; saved.current = JSON.stringify(envelope.document);
    setSavedDataSources(envelope.document.dataSources);
    past.current = []; future.current = [];
    setDocument(envelope.document); setUpdatedAt(envelope.updatedAt); setConflict(false); setError(''); setHistoryVersion(value => value + 1);
  }, []);
  const reload = useCallback(async () => {
    if (busyRef.current) { notify('Wait for the current server operation before reloading.', 'info'); return; }
    busyRef.current = true; setBusy(true); setLoading(true);
    const generation = editGeneration.current;
    try {
      const envelope = await loadDraft();
      if (generation !== editGeneration.current) {
        notify('Reload cancelled because the draft changed while loading. Your local edits and undo history were kept.', 'info');
      } else install(envelope);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (current.current) notify(message, 'error');
      else setError(message);
    } finally { busyRef.current = false; setBusy(false); setLoading(false); }
  }, [install, notify]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    request<{ mode?: string; live?: boolean }>('/api/health').then(health => {
      setServerMode(health.mode ?? (health.live ? 'live' : 'sample'));
    }).catch(reason => notify(`Server health unavailable: ${String(reason)}`, 'error'));
  }, [notify]);
  const apply = useCallback((edit: Edit) => {
    if (!current.current) return;
    const next = structuredClone(current.current);
    try { edit(next); }
    catch (reason) { notify(reason instanceof Error ? reason.message : String(reason), 'error'); return; }
    if (JSON.stringify(next) === JSON.stringify(current.current)) return;
    editGeneration.current += 1;
    past.current = [...past.current.slice(-79), current.current]; future.current = [];
    current.current = next; setDocument(next); setHistoryVersion(value => value + 1);
  }, [notify]);
  const replace = useCallback((next: StudioDocument) => {
    editGeneration.current += 1;
    if (current.current) past.current = [...past.current.slice(-79), current.current];
    future.current = []; current.current = next; setDocument(next); setHistoryVersion(value => value + 1);
  }, []);
  const undo = useCallback(() => {
    const next = past.current.pop();
    if (!next || !current.current) return;
    editGeneration.current += 1;
    future.current.push(current.current); current.current = next; setDocument(next); setHistoryVersion(value => value + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !current.current) return;
    editGeneration.current += 1;
    past.current.push(current.current); current.current = next; setDocument(next); setHistoryVersion(value => value + 1);
  }, []);
  const persist = useCallback(async (): Promise<DraftEnvelope> => {
    if (!current.current) throw new Error('Open a project before saving.');
    const snapshot = structuredClone(current.current);
    const result = await saveDraft(snapshot, revision.current);
    saved.current = JSON.stringify(result.document); revision.current = result.revision;
    setSavedDataSources(result.document.dataSources);
    setUpdatedAt(result.updatedAt); setConflict(false); setHistoryVersion(value => value + 1);
    return result;
  }, []);
  const save = useCallback(async () => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true);
    try { const result = await persist(); notify(`Draft saved · revision ${result.revision}`, 'success'); return true; }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) setConflict(true);
      notify(reason instanceof Error ? reason.message : String(reason), 'error');
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  }, [persist, notify]);
  const importDocument = useCallback(async (value: unknown) => {
    const validation = await validateDocument(value);
    if (!validation.valid) throw new Error(validation.errors.join('\n'));
    replace(value as StudioDocument);
    notify('Document imported into your draft. Save when you are ready.', 'success');
  }, [replace, notify]);
  const keepLocal = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const latest = await loadDraft();
      revision.current = latest.revision;
      const result = await persist();
      notify(`Your local document replaced server revision ${latest.revision}; saved as revision ${result.revision}.`, 'success');
    } catch (reason) { notify(reason instanceof Error ? reason.message : String(reason), 'error'); }
    finally { busyRef.current = false; setBusy(false); }
  }, [notify, persist]);
  const dirty = Boolean(document && JSON.stringify(document) !== saved.current);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  void historyVersion;
  return { document, revision: revision.current, updatedAt, loading, busy, error, conflict, notices, serverMode, savedDataSources, dirty, canUndo: past.current.length > 0, canRedo: future.current.length > 0, apply, undo, redo, save, reload, keepLocal, importDocument, notify, dismissNotice: (id: number) => setNotices(previous => previous.filter(notice => notice.id !== id)) };
}
