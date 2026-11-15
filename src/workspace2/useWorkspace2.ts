import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../api';
import { useCompositionStudio } from '../useCompositionStudio';
import { useHouseStates } from '../preview2/useHouseStates';
import { buildDocumentIndex, parseSelectionKey, selectionKey, type DocumentIndex, type SelectionKey } from '../preview2/model';
import { canonicalCompositionJSON } from '../shared/composition/json';
import type { CompositionDocument } from '../shared/composition/schema';
import type { HaPublicationSummary } from '../ha-publication';
import { runChecks, type Checks } from './checks';
import type { PreviewSurface } from './preview';

/** Autosave waits this long after the last edit (spec 9). */
export const AUTOSAVE_MS = 1500;
/** "Draft · Saved" stays this long after a save before the tag settles on the publish state. */
export const SAVED_TAG_MS = 4000;
/** A simulated call stays in the Checks pill this long. */
export const SIMULATED_FLASH_MS = 4000;

/** What the top bar's status tag says and how it is toned. */
export type StatusTag = { text: string; tone: 'neutral' | 'success' | 'warning' | 'error' };
export type PublishPhase = 'idle' | 'confirm' | 'publishing' | 'failed';
/** One line of Project > Activity. */
export interface ActivityEntry { id: number; text: string }
/** The panels the Project menu and a selection open in the properties surface. */
export type PanelKind = 'tabs' | 'header' | 'wallpaper';
/** What the properties surface shows. */
export type PropertiesTarget =
  | { kind: 'node' | 'page' | 'modal'; key: SelectionKey; path: (string | number)[] }
  | { kind: PanelKind; key?: SelectionKey };

const firstSurface = (document: CompositionDocument): PreviewSurface => {
  const tab = document.navigation.tabs.find(item => item.id === document.navigation.initialTabId) ?? document.navigation.tabs[0];
  return { kind: 'page', id: tab?.pageId ?? document.navigation.initialPageId };
};

/**
 * The 2.0 workspace's state: the composition studio plus autosave, the status tag, Publish, Checks, the selection and
 * what the properties surface shows. It wraps `useCompositionStudio`.
 */
export function useWorkspace2(active: boolean) {
  const studio = useCompositionStudio();
  const { document } = studio;
  const index: DocumentIndex | undefined = useMemo(() => document ? buildDocumentIndex(document) : undefined, [document]);
  const checks: Checks = useMemo(() => document ? runChecks(document) : { problems: [], suggestions: [] }, [document]);
  const problemCount = checks.problems.length;
  // The preview shows the last document that compiled, so a half-typed edit never blanks it.
  const compiled = useRef<CompositionDocument | undefined>(undefined);
  if (document && problemCount === 0) compiled.current = document;
  const previewDocument = compiled.current ?? document;

  const [mode, setMode] = useState<'edit' | 'use'>('edit');
  const [surfaceState, setSurfaceState] = useState<PreviewSurface>();
  const [selection, setSelectionState] = useState<SelectionKey>();
  const [panel, setPanel] = useState<PanelKind>();
  const [revealKey, setRevealKey] = useState<SelectionKey>();
  const surface = useMemo<PreviewSurface | undefined>(() => {
    if (!document) return undefined;
    const exists = surfaceState && (surfaceState.kind === 'page' ? document.pages : document.modals).some(item => item.id === surfaceState.id);
    return exists ? surfaceState : firstSurface(document);
  }, [document, surfaceState]);
  const select = useCallback((next: SelectionKey | undefined) => { setSelectionState(next); setPanel(undefined); if (next) setRevealKey(next); }, []);
  const changeSurface = useCallback((next: PreviewSurface) => { setSurfaceState(next); }, []);
  const changeMode = useCallback((next: 'edit' | 'use') => { setMode(next); if (next === 'use') { setSelectionState(undefined); setPanel(undefined); } }, []);

  const target = useMemo<PropertiesTarget | undefined>(() => {
    if (panel) return { kind: panel };
    if (!selection || !index) return undefined;
    const entry = index.get(selection);
    if (!entry) return undefined;
    if (entry.kind === 'node' || entry.kind === 'page' || entry.kind === 'modal') return { kind: entry.kind, key: selection, path: entry.path };
    if (entry.kind === 'tab') return { kind: 'tabs', key: selection };
    if (entry.kind === 'chrome-group' || entry.kind === 'chrome-item') return { kind: 'header', key: selection };
    return undefined;
  }, [panel, selection, index]);

  // --- Autosave -----------------------------------------------------------------------------------------------
  const [failedFor, setFailedFor] = useState<CompositionDocument>();
  const [savedAt, setSavedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [saveReason, setSaveReason] = useState('');
  const { save: saveDraft, whenIdle, latestDocument, isSaved, dirty, busy, conflict } = studio;
  const persist = useCallback(async (publish: boolean | 'home-assistant' = false, keepLocal = false) => {
    // A save already under way is not this call's failure: wait for it, then save (or publish) what is newest.
    await whenIdle();
    const sent = latestDocument() ?? studio.document;
    const ok = await saveDraft(publish, keepLocal);
    if (ok) { setFailedFor(undefined); setSaveReason(''); setSavedAt(Date.now()); }
    // A publish that fails after the draft saved is a failed publish, not a failed save: "Not Saved" is only for the draft.
    else if (publish && isSaved()) { setFailedFor(undefined); setSavedAt(Date.now()); }
    else setFailedFor(sent);
    return ok;
  }, [saveDraft, whenIdle, latestDocument, isSaved, studio.document]);
  const latest = useRef({ persist, dirty, busy, conflict, problemCount, document });
  latest.current = { persist, dirty, busy, conflict, problemCount, document };
  useEffect(() => {
    if (!active || !document || !dirty || busy || conflict || problemCount > 0 || failedFor === document) return;
    const timer = setTimeout(() => { void latest.current.persist(); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [active, document, dirty, busy, conflict, problemCount, failedFor]);
  const saveNow = useCallback(() => { const current = latest.current; if (current.dirty && !current.busy && !current.conflict && current.problemCount === 0) void current.persist(); }, []);
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveNow(); }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [active, saveNow]);
  useEffect(() => {
    if (!savedAt) return;
    const timer = setTimeout(() => setNow(Date.now()), SAVED_TAG_MS + 50);
    return () => clearTimeout(timer);
  }, [savedAt]);
  useEffect(() => { if (studio.error && !saveReason && failedFor !== undefined) setSaveReason(studio.error); }, [studio.error, saveReason, failedFor]);

  // --- Publication state --------------------------------------------------------------------------------------
  const [publication, setPublication] = useState<HaPublicationSummary>();
  const [publishedJson, setPublishedJson] = useState<{ json: string; revision: number }>();
  const [publicationError, setPublicationError] = useState('');
  const refreshPublication = useCallback(async () => {
    try {
      const next = await request<HaPublicationSummary>('/native/api/ha/publication');
      setPublication(next); setPublicationError('');
      // A roll back, or a publish from elsewhere, changes what the app serves: what this session published no longer counts.
      setPublishedJson(held => held && next.current && held.revision !== next.current.revision ? undefined : held);
      return next;
    } catch (reason) { setPublicationError(reason instanceof Error ? reason.message : String(reason)); return undefined; }
  }, []);
  useEffect(() => { if (active) void refreshPublication(); }, [active, refreshPublication]);
  const liveRevision = publication?.current?.revision;
  const [phase, setPhase] = useState<PublishPhase>('idle');
  const [publishError, setPublishError] = useState('');
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const log = useCallback((text: string) => setActivity(list => [{ id: (list[0]?.id ?? 0) + 1, text }, ...list].slice(0, 100)), []);
  // A simulated call shows in the Checks pill for this long; Project > Activity keeps the line.
  // Each call restarts the 4 s, even when the line is the same as the last.
  const [flash, setFlash] = useState(''), [flashes, setFlashes] = useState(0);
  const simulated = useCallback((summary: string) => {
    log(summary); setFlash(summary); setFlashes(count => count + 1);
  }, [log]);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(''), SIMULATED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash, flashes]);
  const openPublish = useCallback(() => { setPublishError(''); setPhase('confirm'); void refreshPublication(); }, [refreshPublication]);
  const closePublish = useCallback(() => setPhase(current => current === 'publishing' ? current : 'idle'), []);
  const publish = useCallback(async (): Promise<boolean> => {
    setPhase('publishing'); setPublishError('');
    const json = latest.current.document ? canonicalCompositionJSON(latest.current.document) : '';
    const ok = await persist('home-assistant');
    if (ok) {
      const next = await refreshPublication();
      setPublishedJson({ json, revision: next?.current?.revision ?? (liveRevision ?? 0) + 1 });
      log(`Published revision ${next?.current?.revision ?? (liveRevision ?? 0) + 1}`);
      setPhase('idle');
      return true;
    }
    setPhase('failed');
    return false;
  }, [persist, refreshPublication, liveRevision, log]);
  useEffect(() => { if (phase === 'failed' || phase === 'publishing') setPublishError(studio.error); }, [phase, studio.error]);
  useEffect(() => { if (conflict) setPhase(current => current === 'publishing' || current === 'confirm' || current === 'failed' ? 'idle' : current); }, [conflict]);
  useEffect(() => { if (dirty === false && savedAt) log('Saved'); }, [savedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const [conflictDecided, setConflictDecided] = useState(false);
  useEffect(() => { if (!conflict) setConflictDecided(false); }, [conflict]);

  const houseStates = useHouseStates(previewDocument, { enabled: active });

  const status = useMemo<StatusTag>(() => {
    if (!document) return { text: 'Draft · Saved', tone: 'neutral' };
    if (conflict || failedFor === document || (dirty && problemCount > 0)) return { text: 'Not Saved', tone: 'error' };
    if (busy || dirty) return { text: 'Saving…', tone: 'neutral' };
    if (savedAt && now < savedAt + SAVED_TAG_MS && Date.now() < savedAt + SAVED_TAG_MS) return { text: 'Draft · Saved', tone: 'neutral' };
    if (publishedJson && publishedJson.json === canonicalCompositionJSON(document)) return { text: `Published · ${publishedJson.revision}`, tone: 'success' };
    // After a reload the server says whether the saved draft is what the app serves.
    if (publication?.draftIsLive && publication.current && publication.draftRevision === studio.envelope?.revision) return { text: `Published · ${publication.current.revision}`, tone: 'success' };
    if (!publication) return { text: 'Draft · Saved', tone: 'neutral' };
    return { text: 'Not Published', tone: 'warning' };
  }, [document, conflict, failedFor, dirty, problemCount, busy, savedAt, now, publishedJson, publication, studio.envelope?.revision]);

  return {
    studio, document, previewDocument, index, checks, problemCount,
    mode, setMode: changeMode, surface, setSurface: changeSurface,
    selection, select, panel, setPanel, target, revealKey,
    status, saveNow, persist, failedSave: failedFor !== undefined && failedFor === document, saveReason,
    retrySave: () => { setFailedFor(undefined); studio.setError(''); setSaveReason(''); },
    publication, publicationError, liveRevision, refreshPublication, publishedJson, phase, publishError, openPublish, closePublish, publish,
    conflictDecided, decideLater: () => setConflictDecided(true), reopenConflict: () => setConflictDecided(false),
    activity, log, houseStates, simulated, flash,
    /** Moves the preview to the surface a selection key lives on, then selects it. */
    selectAnywhere: (key: SelectionKey) => {
      const entry = index?.get(key);
      const owner = entry?.kind === 'page' || entry?.kind === 'modal' ? key : entry?.surface;
      const parsed = owner ? parseSelectionKey(owner) : undefined;
      if (parsed && (parsed.kind === 'page' || parsed.kind === 'modal')) setSurfaceState({ kind: parsed.kind, id: parsed.id });
      select(key);
    },
    selectionKey,
  };
}
export type Workspace2 = ReturnType<typeof useWorkspace2>;
