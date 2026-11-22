import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../api';
import { useCompositionStudio } from '../useCompositionStudio';
import { useHouseStates } from '../preview2/useHouseStates';
import { previewSources } from '../preview2/component-library';
import { sheetForLevel, survivingSelection, survivingSurface } from './selection';
import { buildDocumentIndex, parseSelectionKey, selectionKey, type DocumentIndex, type SelectionKey } from '../preview2/model';
import { canonicalCompositionJSON } from '../shared/composition/json';
import type { CompositionDocument } from '../shared/composition/schema';
import type { HaPublicationSummary } from '../ha-publication';
import { useChecks } from './useChecks';
import type { PreviewSurface } from './preview';
import type { AlertSpec } from '../preview2/alert';
import type { StatePreview } from '../preview2/render-context';
import { createEnvironment } from '../preview2/projections';
import { triedOverlay, useTryValues, withoutTries } from './expr/useTryValues';
import { useLinkedGate } from './useLinkedGate';
import { plainDocument } from './data/logic/logicPlain';
import { useRepeats } from './repeats/useRepeats';

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
export type PanelKind = 'tabs' | 'header' | 'wallpaper' | 'styles';
/** What the properties surface shows. */
export type PropertiesTarget =
  | { kind: 'node' | 'page' | 'modal'; key: SelectionKey; path: (string | number)[] }
  | { kind: PanelKind; key?: SelectionKey }
  /** An area of a tab container (`local-tab` in the index), shown in the inspector with its tabs and rule. */
  | { kind: 'area'; key: SelectionKey; path: (string | number)[] }
  /** A Data Flow open in the inspector (studio-ux2, L-data): opening one deselects the node, selecting a node closes it. */
  | { kind: 'flow'; id: string }
  /** A template open in the inspector (studio-tpl-ux): opened from its row or its badge; selecting anything else closes it. */
  | { kind: 'template'; id: string }
  /** Any other data source (an entity, an app topic or a model) open in the inspector the same way, so its fields stay reachable on a wide window. */
  | { kind: 'source'; id: string }
  /** A repeated piece's proposal (templates spec 5): open in the inspector while the Repeated Pieces level is, so the canvas can mark the piece beside it. */
  | { kind: 'repeat'; id: string }
  /** A logic template open in the inspector, from the Data panel's Logic Templates group. */
  | { kind: 'logic'; id: string };

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
  const documentRef = useRef(document);
  documentRef.current = document;
  const index: DocumentIndex | undefined = useMemo(() => document ? buildDocumentIndex(document) : undefined, [document]);
  // Checks run once the edits pause, so a keystroke never waits on them; saving and publishing wait for them (see `useChecks`).
  const scheduled = useChecks(document);
  const { checks, settled, flush: flushChecks } = scheduled;
  const problemCount = checks.problems.length;
  // The preview follows the newest document at once, problems or not: a problem is a thing to fix before Save and Publish, never
  // a reason to hold the screen back from the next edit. A document the preview cannot draw falls back to `lastGoodDocument`
  // (see `PreviewGuard`), so a half-typed edit never blanks it.
  const previewDocument = useMemo(() => plainDocument(document), [document]);
  const lastGoodDocument = useMemo(() => plainDocument(scheduled.lastGood), [scheduled.lastGood]);

  // Repeated pieces: the walk runs while the level is open, a surface at a time, off the typing path (see `useRepeats`).
  const repeats = useRepeats(document);
  const { pick: pickRepeat } = repeats;

  const [mode, setMode] = useState<'edit' | 'use'>('edit');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [surfaceState, setSurfaceState] = useState<PreviewSurface>();
  const [selection, setSelectionState] = useState<SelectionKey>();
  const [panel, setPanel] = useState<PanelKind>();
  const [flowId, setFlowId] = useState<string>();
  /** The logic template open in the inspector. */
  const [logicId, setLogicId] = useState<string>();
  /** The template open in the inspector. */
  const [templateId, setTemplateId] = useState<string>();
  /** The template whose Uses level the Components panel shows. */
  const [usesId, setUsesId] = useState<string>();
  /** The page a logic template was opened from, for the editor's back button. */
  const [logicFrom, setLogicFrom] = useState<{ key: SelectionKey; title: string }>();
  const [revealKey, setRevealKey] = useState<SelectionKey>();
  /** The alert the simulator draws while a field of the Ask First page has focus. */
  const [alertPreview, setAlertPreview] = useState<AlertSpec>();
  /** The state "Show state" forces on a state tile in the simulator; it applies only while that tile is selected. */
  const [statePreview, setStatePreview] = useState<StatePreview>();
  const surface = useMemo<PreviewSurface | undefined>(() => {
    if (!document) return undefined;
    return survivingSurface(surfaceState, document) ?? firstSurface(document);
  }, [document, surfaceState]);
  const select = useCallback((next: SelectionKey | undefined) => { setSelectionState(next); setPanel(undefined); setFlowId(undefined); setLogicId(undefined); setTemplateId(undefined); if (next) { setRevealKey(next); pickRepeat(undefined); } }, [pickRepeat]);
  /** Opens a Data Flow in the inspector; the node selection ends (spec "Selection"). */
  const openFlow = useCallback((id: string | undefined) => { setSelectionState(undefined); setPanel(undefined); setLogicId(undefined); setTemplateId(undefined); setFlowId(id); }, []);
  const openTemplate = useCallback((id: string | undefined) => { setSelectionState(undefined); setPanel(undefined); setLogicId(undefined); setFlowId(undefined); setTemplateId(id); }, []);
  /** Opens a logic template in the inspector; `from` names the page it was opened from, so the editor can offer a way back. */
  const openLogic = useCallback((id: string | undefined, from?: { key: SelectionKey; title: string }) => { setSelectionState(undefined); setPanel(undefined); setFlowId(undefined); setTemplateId(undefined); setLogicId(id); setLogicFrom(id ? from : undefined); }, []);
  // A change that removes the selected node (Undo of an add) ends the selection; any other change keeps it.
  useEffect(() => { setSelectionState(held => survivingSelection(held, index)); }, [index]);
  /**
   * The simulator moved (Use navigation, a tab tap, Back out of a level). In Edit a selection that is no longer drawn ends with it, so no edit lands on a node
   * nobody can see; a selection still on show (the sheet a Back returned to, a tab) stays.
   */
  const changeSurface = useCallback((next: PreviewSurface) => {
    setSurfaceState(next);
    if (modeRef.current !== 'edit') return;
    const shown = new Set<string>([`${next.kind}:${next.id}`, ...(next.kind === 'level' && next.sheetId ? [`modal:${next.sheetId}`] : [])]);
    setSelectionState(held => {
      const entry = held ? buildDocumentIndex(documentRef.current!).get(held) : undefined;
      const home = entry?.kind === 'page' || entry?.kind === 'modal' || entry?.kind === 'level' ? held : entry?.surface;
      return held && home && !shown.has(home) ? undefined : held;
    });
  }, []);
  /** Use keeps a selection made in the library (L-mark: the simulator marks it); it still closes panels such as Tabs and the open Data Flow. */
  const changeMode = useCallback((next: 'edit' | 'use') => { setMode(next); if (next === 'use') { setPanel(undefined); setFlowId(undefined); setLogicId(undefined); } }, []);

  // The canvas goes to the place of the piece on show: its page or sheet, its tab and its row, with the mark on it.
  const mark = repeats.mark;
  useEffect(() => { if (mark) { setSurfaceState({ kind: mark.surface.kind, id: mark.surface.id }); setRevealKey(mark.key); } }, [mark?.key, mark?.surface.id, mark?.surface.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // The edit question: every edit that reaches a saved component other places use is held until the person answers (see `useLinkedGate`).
  const linked = useLinkedGate({ studio, document, index, selection, surface, select, templateId });
  const gatedStudio = useMemo(() => ({ ...studio, apply: linked.apply }), [studio, linked.apply]);

  const target = useMemo<PropertiesTarget | undefined>(() => {
    if (panel) return { kind: panel };
    if (templateId && document?.componentLibrary?.some(entry => entry.id === templateId)) return { kind: 'template', id: templateId };
    if (logicId && document?.logicLibrary?.some(entry => entry.id === logicId)) return { kind: 'logic', id: logicId };
    const open = flowId ? document?.dataSources.find(source => source.id === flowId) : undefined;
    if (open) return { kind: open.kind === 'model' && open.model === 'pipeline@1' ? 'flow' : 'source', id: open.id };
    if (repeats.selected && repeats.where === 'inspector') return { kind: 'repeat', id: repeats.selected.id };
    if (!selection || !index) return undefined;
    const entry = index.get(selection);
    if (!entry) return undefined;
    if (entry.kind === 'node' || entry.kind === 'page' || entry.kind === 'modal') return { kind: entry.kind, key: selection, path: entry.path };
    if (entry.kind === 'tab') return { kind: 'tabs', key: selection };
    if (entry.kind === 'local-tab') return { kind: 'area', key: selection, path: entry.path };
    if (entry.kind === 'chrome-group' || entry.kind === 'chrome-item') return { kind: 'header', key: selection };
    return undefined;
  }, [panel, flowId, logicId, templateId, document, selection, index, repeats.selected, repeats.where]);

  // --- Autosave -----------------------------------------------------------------------------------------------
  const [failedFor, setFailedFor] = useState<CompositionDocument>();
  const [savedAt, setSavedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [saveReason, setSaveReason] = useState('');
  const { save: saveDraft, whenIdle, latestDocument, isSaved, dirty, busy, conflict } = studio;
  const persist = useCallback(async (publish: boolean | 'home-assistant' = false, keepLocal = false) => {
    // A save already under way is not this call's failure: wait for it, then save (or publish) what is newest.
    await whenIdle();
    // A publish acts on a checked document: the checks of the newest edit are settled first, and problems stop it.
    if (publish && flushChecks().problems.length > 0) return false;
    const sent = latestDocument() ?? studio.document;
    const ok = await saveDraft(publish, keepLocal);
    if (ok) { setFailedFor(undefined); setSaveReason(''); setSavedAt(Date.now()); }
    // A publish that fails after the draft saved is a failed publish, not a failed save: "Not Saved" is only for the draft.
    else if (publish && isSaved()) { setFailedFor(undefined); setSavedAt(Date.now()); }
    else setFailedFor(sent);
    return ok;
  }, [saveDraft, whenIdle, latestDocument, isSaved, studio.document, flushChecks]);
  const latest = useRef({ persist, dirty, busy, conflict, problemCount, document });
  latest.current = { persist, dirty, busy, conflict, problemCount, document };
  // Autosave waits for the checks of the document it would save.
  useEffect(() => {
    if (!active || !document || !dirty || busy || conflict || !settled || problemCount > 0 || failedFor === document) return;
    const timer = setTimeout(() => { void latest.current.persist(); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [active, document, dirty, busy, conflict, settled, problemCount, failedFor]);
  const saveNow = useCallback(() => {
    const current = latest.current;
    if (!current.dirty || current.busy || current.conflict || flushChecks().problems.length > 0) return;
    void current.persist();
  }, [flushChecks]);
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
  const { refreshBackup } = studio;
  useEffect(() => { if (active) void refreshBackup(); }, [active, refreshBackup]);
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
  const openPublish = useCallback(() => { flushChecks(); setPublishError(''); setPhase('confirm'); void refreshPublication(); }, [refreshPublication, flushChecks]);
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

  // The house is read for the sources the places of a template own as well as the document's.
  const readDocument = useMemo(() => previewDocument ? { dataSources: previewSources(previewDocument) } : undefined, [previewDocument]);
  const house = useHouseStates(readDocument, { enabled: active });
  // Try Values (D8): the overrides of the open editor reach the simulator through the overlay; nothing is written to the document.
  const tried = useTryValues();
  const houseStates = useMemo<typeof house>(() => {
    if (!tried.count) return house;
    const merged = triedOverlay(house.overlay, tried);
    return {
      ...house, overlay: merged, environment: createEnvironment(readDocument ?? { dataSources: [] }, house.house, merged),
      setOverlay: next => house.setOverlay(withoutTries(next, merged, tried)),
    };
  }, [house, tried, readDocument]);

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
    studio: gatedStudio, linked, document, previewDocument, lastGoodDocument, index, checks, problemCount,
    mode, setMode: changeMode, surface, setSurface: changeSurface,
    repeats, selection, select, panel, setPanel, flowId, openFlow, logicId, logicFrom, openLogic, templateId, openTemplate, usesId, setUsesId, target, revealKey, alertPreview, setAlertPreview, statePreview, setStatePreview,
    status, saveNow, persist, failedSave: failedFor !== undefined && failedFor === document, saveReason,
    retrySave: () => { setFailedFor(undefined); studio.setError(''); setSaveReason(''); },
    publication, publicationError, liveRevision, refreshPublication, publishedJson, phase, publishError, openPublish, closePublish, publish,
    conflictDecided, decideLater: () => setConflictDecided(true), reopenConflict: () => setConflictDecided(false),
    activity, log, houseStates, simulated, flash, tried,
    /** Moves the preview to the surface a selection key lives on, then selects it. */
    selectAnywhere: (key: SelectionKey) => {
      const entry = index?.get(key);
      const owner = entry?.kind === 'page' || entry?.kind === 'modal' || entry?.kind === 'level' ? key : entry?.surface;
      const parsed = owner ? parseSelectionKey(owner) : undefined;
      if (parsed && (parsed.kind === 'page' || parsed.kind === 'modal')) setSurfaceState({ kind: parsed.kind, id: parsed.id });
      // A level keeps the sheet it is shown in while it stays on show; otherwise the preview picks the sheet that opens it.
      else if (parsed?.kind === 'level' && document) {
        // Name the sheet the level is shown in, so a level that is deleted afterwards falls back to its sheet (`survivingSurface`).
        // The sheet already open wins when it reaches the level, else the first sheet that does.
        setSurfaceState(held => {
          if (held?.kind === 'level' && held.id === parsed.id && held.sheetId !== undefined) return held;
          const sheetId = sheetForLevel(held, document, parsed.id);
          return { kind: 'level', id: parsed.id, ...(sheetId ? { sheetId } : {}) };
        });
      }
      select(key);
    },
    selectionKey,
  };
}
export type Workspace2 = ReturnType<typeof useWorkspace2>;
