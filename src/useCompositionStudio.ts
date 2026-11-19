import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, request } from './api';
import { compileCompositionDocument } from './shared/composition/compiler';
import { CompositionValidationError } from './shared/composition/json';
import { normaliseFoldSides } from './shared/composition/fold-sides-normalise';
import { pruneEntitySources } from './workspace2/dialogs/sources';
import { sameJson } from './sameJson';
import type { CompositionDocument, CompositionPublication } from './shared/composition/schema';
import type { HaPublishResult } from './ha-publication';
import { formatCompositionIssue, type CompositionDraft } from './shared/composition/workspace';

/** What the server's import of house-config layout did: what it added, what the draft already authored, what it could not express. */
export interface HouseImportReport {
  revision: number; added: string[]; kept: string[]; dropped: { path: string; reason: string }[];
}

/** The draft the server kept before it was replaced: when, and the revision it had. */
export interface DraftBackup { createdAt: string; revision: number }

/** Typing within this long of the last keystroke into the same field stays one undo step. */
export const UNDO_COALESCE_MS = 1000;
/** Most undo steps kept. */
const UNDO_DEPTH = 60;

/**
 * The path of the one string that differs between two documents, or `undefined` when the edit is anything else
 * (several values, a structural change, a non-text value). Shared structure makes the walk cheap: unchanged branches are the same object.
 */
export function textEditPath(before: unknown, after: unknown, path = ''): string | undefined {
  if (before === after) return undefined;
  if (typeof before === 'string' && typeof after === 'string') return path;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) return undefined;
  const left = before as Record<string, unknown>, right = after as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return undefined;
  let found: string | undefined;
  for (const key of keys) {
    if (!(key in right)) return undefined;
    if (left[key] === right[key]) continue;
    if (found !== undefined) return undefined;
    found = textEditPath(left[key], right[key], `${path}/${key}`);
    if (found === undefined) return undefined;
  }
  return found;
}

export function useCompositionStudio() {
  const [document, setDocument] = useState<CompositionDocument>();
  const current = useRef<CompositionDocument | undefined>(undefined);
  const [envelope, setEnvelope] = useState<CompositionDraft>();
  const metadata = useRef<CompositionDraft | undefined>(undefined);
  /** The document the server holds as the draft: what the screen is compared with to tell unsaved work. */
  const saved = useRef<CompositionDocument | undefined>(undefined);
  const past = useRef<CompositionDocument[]>([]);
  /** The text field the last edit typed into, and when; a further keystroke in it joins that undo step. */
  const typing = useRef<{ path: string; at: number } | undefined>(undefined);
  const future = useRef<CompositionDocument[]>([]);
  const lastApplied = useRef<{ input: CompositionDocument; output: CompositionDocument } | undefined>(undefined);
  const [busy, setBusy] = useState(false), locked = useRef(false);
  /** Settles when the operation holding the lock ends, so a caller can wait its turn instead of failing. */
  const idle = useRef<Promise<void>>(Promise.resolve()), release = useRef<() => void>(() => {});
  const acquire = useCallback(() => { locked.current = true; idle.current = new Promise<void>(resolve => { release.current = resolve; }); }, []);
  const free = useCallback(() => { locked.current = false; release.current(); }, []);
  const whenIdle = useCallback(async () => { while (locked.current) await idle.current; }, []);
  const latestDocument = useCallback(() => current.current, []);
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
    acquire(); setBusy(true); setError('');
    const snapshot = current.current;
    try {
      const next = await request<CompositionDraft>('/native/api/draft');
      if (current.current !== snapshot) throw new Error('Reload cancelled because local work changed while loading');
      compileCompositionDocument(next.document);
      metadata.current = next; saved.current = next.document;
      current.current = next.document; past.current = []; future.current = [];
      setEnvelope(next); setDocument(next.document); setConflict(false); setStatus(`Loaded native draft revision ${next.revision}`);
    } catch (reason) { report(reason); }
    finally { free(); setBusy(false); }
  }, [report, acquire, free]);
  useEffect(() => { void reload(); }, [reload]);
  /**
   * Applies an edit as one undo step. With a `group`, every edit in it joins the step the group began (a color dragged in the
   * system picker), however long the drag lasts; any other edit, or leaving the field, ends the group.
   */
  const apply = useCallback((edit: CompositionDocument, group?: string) => {
    // A side of the hinge lives only on a page's top-level components: whatever the edit nested, moved or copied, it leaves none elsewhere (`sh.fold-sides@1`).
    const next = pruneEntitySources(normaliseFoldSides(edit));
    if (!current.current || sameJson(next, current.current)) return;
    const path = group ? `group:${group}` : textEditPath(current.current, next), at = Date.now();
    const joins = path !== undefined && typing.current?.path === path && (group !== undefined || at - typing.current.at < UNDO_COALESCE_MS) && past.current.length > 0;
    if (!joins) past.current = [...past.current.slice(-(UNDO_DEPTH - 1)), current.current];
    future.current = []; typing.current = path === undefined ? undefined : { path, at };
    lastApplied.current = { input: edit, output: next };
    current.current = next; setDocument(next); setStatus('');
  }, []);
  const persist = useCallback(async (expected: number) => {
    if (!current.current) throw new Error('Load the native workspace first');
    const snapshot = compileCompositionDocument(current.current).document;
    const next = await request<CompositionDraft>('/native/api/draft', { method: 'PUT', body: JSON.stringify({ document: snapshot, expectedRevision: expected }) });
    metadata.current = next; saved.current = next.document; setEnvelope(next); setConflict(false);
    return next;
  }, []);
  const save = useCallback(async (publish: boolean | 'home-assistant' = false, keepLocal = false) => {
    if (locked.current || !metadata.current || !current.current) return false;
    acquire(); setBusy(true); setError(''); setStatus('');
    try {
      let expected = metadata.current.revision;
      if (keepLocal) expected = (await request<CompositionDraft>('/native/api/draft')).revision;
      let next = metadata.current;
      if (keepLocal || !sameJson(current.current, saved.current)) next = await persist(expected);
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
    finally { free(); setBusy(false); }
  }, [persist, report, acquire, free]);
  /** Adds the layout parts missing from the saved draft from the live house config, then reloads the draft. */
  const importHouse = useCallback(async () => {
    if (locked.current || !metadata.current) return false;
    acquire(); setBusy(true); setError(''); setStatus('');
    try {
      const report = await request<HouseImportReport>('/native/api/import-house-config', { method: 'POST', body: JSON.stringify({ expectedRevision: metadata.current.revision }) });
      const next = await request<CompositionDraft>('/native/api/draft');
      compileCompositionDocument(next.document);
      metadata.current = next; saved.current = next.document;
      current.current = next.document; past.current = []; future.current = [];
      setEnvelope(next); setDocument(next.document); setConflict(false); setHouseImport(report);
      setStatus(`Imported from house config: ${report.added.length} added, ${report.kept.length} already authored, ${report.dropped.length} not expressible.`);
      return true;
    } catch (reason) { report(reason); return false; }
    finally { free(); setBusy(false); }
  }, [report]);
  /** The draft the server kept before the last replacement, if any; "Restore Previous Draft" brings it back. */
  const [backup, setBackup] = useState<DraftBackup | null>(null);
  const refreshBackup = useCallback(async () => {
    try { setBackup((await request<{ backup: DraftBackup | null }>('/native/api/ha/draft-backup')).backup); } catch { /* the command stays hidden */ }
  }, []);
  /**
   * Asks the server to replace the draft (from the published layout, or with the kept one), then loads the result as a fresh start:
   * undo history is cleared, because it belongs to the draft that was replaced.
   */
  const replaceDraft = useCallback(async (endpoint: string, summary: string) => {
    if (locked.current || !metadata.current) return false;
    acquire(); setBusy(true); setError(''); setStatus('');
    try {
      await request(endpoint, { method: 'POST', body: JSON.stringify({ expectedRevision: metadata.current.revision }) });
      const next = await request<CompositionDraft>('/native/api/draft');
      compileCompositionDocument(next.document);
      metadata.current = next; saved.current = next.document;
      current.current = next.document; past.current = []; future.current = []; typing.current = undefined;
      setEnvelope(next); setDocument(next.document); setConflict(false); setStatus(summary);
      await refreshBackup();
      return true;
    } catch (reason) { report(reason); return false; }
    finally { free(); setBusy(false); }
  }, [report, acquire, free, refreshBackup]);
  const startFromPublished = useCallback(() => replaceDraft('/native/api/ha/start-from-published', 'Started from the published layout.'), [replaceDraft]);
  const restorePreviousDraft = useCallback(() => replaceDraft('/native/api/ha/restore-draft', 'Restored the previous draft.'), [replaceDraft]);
  // Leaving a field ends its undo step.
  useEffect(() => {
    const blurred = () => { typing.current = undefined; };
    window.addEventListener('focusout', blurred);
    return () => window.removeEventListener('focusout', blurred);
  }, []);
  const undo = () => {
    typing.current = undefined;
    const next = past.current.pop();
    if (next && current.current) { future.current.push(current.current); current.current = next; setDocument(next); }
  };
  /** Takes back the edit that produced `applied`, leaving nothing to redo, when it is still the newest edit; false when it is not. */
  const revert = (applied: CompositionDocument) => {
    const before = past.current[past.current.length - 1];
    if (lastApplied.current?.input !== applied || current.current !== lastApplied.current.output || !before) return false;
    past.current.pop(); typing.current = undefined; current.current = before; setDocument(before);
    return true;
  };
  const redo = () => {
    typing.current = undefined;
    const next = future.current.pop();
    if (next && current.current) { past.current.push(current.current); current.current = next; setDocument(next); }
  };
  /** Whether the draft on the server is what is on screen: true after a save that went through, even if the publish after it failed. */
  const isSaved = useCallback(() => !current.current || sameJson(current.current, saved.current), []);
  // Compared once per document and per save or load (`envelope` changes with `saved`), not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dirty = useMemo(() => Boolean(document && !sameJson(document, saved.current)), [document, envelope]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  return {
    document, envelope, publishedRevision, homeAssistant, houseImport, importHouse, backup, refreshBackup, startFromPublished, restorePreviousDraft, setStatus, busy, error, status, conflict, dirty,
    canUndo: past.current.length > 0, canRedo: future.current.length > 0,
    apply, save, reload, undo, redo, revert, setError, report, whenIdle, latestDocument, isSaved,
  };
}
