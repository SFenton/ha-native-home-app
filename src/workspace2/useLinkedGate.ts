import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorPath } from '../composition-editor';
import { componentReferences, libraryById } from '../shared/composition/components';
import type { CompositionDocument } from '../shared/composition/schema';
import type { DocumentIndex, SelectionKey } from '../preview2/model';
import { buildDocumentIndex } from '../preview2/model';
import type { PreviewSurface } from './preview';
import { toastManager } from './toasts';
import {
  freeName, insidePlace, otherPlaces, placeName, placeOf, saveAsComponent, settleHeld, touchedEntries, unlinkPlace,
} from './linked';
import type { useCompositionStudio } from '../useCompositionStudio';

type Studio = ReturnType<typeof useCompositionStudio>;

/** What is held while the question is open: the edit that was not written, and where focus was. */
interface Held {
  next: CompositionDocument; group?: string; entryId: string; refId: string;
  /** The control that had focus when the edit arrived; it gets focus back, the caret at the end of a text field. */
  focus: HTMLElement | null;
}
/** The open question as the dialog draws it. */
export interface LinkedQuestion {
  name: string; places: string[]; count: number; step: 'ask' | 'name';
  /** The name the second step starts with (the first free number). */
  suggested: string;
  /** Whether a component with this name already exists. */
  taken(name: string): boolean;
}
/** A session of editing one place: the person said Update Template, so further edits there go through without a question (until the selection leaves). */
export interface LinkedSession { refId: string; entryId: string; name: string; places: number }
/** What the Save as Template dialog needs. */
export interface SaveRequest { path: EditorPath; key: SelectionKey }

/** The words a visually hidden status line says. */
export const linkedStatus = {
  saved: (name: string) => `Saved ${name} as a template.`,
  updated: (name: string, places: number) => `Updated ${name} in ${places} places.`,
  forked: (name: string) => `Saved ${name}. This place is linked to it.`,
  unlinked: (name: string) => `Unlinked from ${name}.`,
} as const;

/**
 * The edit question's gate (studio-linked spec, "The edit question"). Every edit in the Studio ends in `studio.apply(next)`; `apply` here wraps it. It
 * compares `next` with the current document entry by entry (identity first), and when an entry that two or more places use has changed, and the
 * person has not already said Update Template for this place, it holds the edit, writes nothing and opens the question. Undo and redo never come
 * through here: they restore documents.
 *
 * The session belongs to one place and lasts while the selection is that place or anything inside it.
 */
export function useLinkedGate({ studio, document, index, selection, surface, select }: {
  studio: Studio; document: CompositionDocument | undefined; index: DocumentIndex | undefined; selection: SelectionKey | undefined;
  surface: PreviewSurface | undefined; select: (key: SelectionKey | undefined) => void;
}) {
  const [held, setHeld] = useState<Held>();
  const [step, setStep] = useState<'ask' | 'name'>('ask');
  const [session, setSession] = useState<LinkedSession>();
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState<SaveRequest>();
  const latest = useRef({ studio, document, selection, session, held });
  latest.current = { studio, document, selection, session, held };

  const apply = useCallback((next: CompositionDocument, group?: string) => {
    const { studio: current, selection: selected, session: open } = latest.current;
    const before = current.latestDocument() ?? current.document;
    const touched = before ? touchedEntries(before, next) : [];
    if (!before || !touched.length) { current.apply(next, group); return; }
    if (touched.length > 1) {
      toastManager.add({ title: 'Change one template at a time' });
      return;
    }
    const entryId = touched[0];
    const uses = componentReferences(before).filter(use => use.ref.componentId === entryId);
    // A component with no other use asks nothing (D7).
    if (uses.length < 2) { current.apply(next, group); return; }
    const own = placeOf(before, selected);
    const place = (own && uses.some(use => use.ref.id === own) ? own : undefined) ?? uses[0].ref.id;
    if (open && open.refId === place && open.entryId === entryId) { current.apply(next, group); return; }
    const active = window.document.activeElement;
    setStep('ask');
    setHeld({ next, group, entryId, refId: place, focus: active instanceof HTMLElement && active !== window.document.body ? active : null });
  }, []);

  // The session ends when the selection leaves the place, or the preview shows another surface.
  useEffect(() => { if (session && !insidePlace(selection, session.refId)) setSession(undefined); }, [selection, session]);
  const surfaceId = surface ? `${surface.kind}:${surface.id}` : '';
  useEffect(() => { setSession(undefined); }, [surfaceId]);

  const restore = (focus: HTMLElement | null) => {
    if (!focus || !focus.isConnected) return;
    window.requestAnimationFrame(() => {
      focus.focus();
      if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement) { try { const end = focus.value.length; focus.setSelectionRange(end, end); } catch { /* a type with no caret */ } }
    });
  };

  const question = useMemo<LinkedQuestion | undefined>(() => {
    if (!held || !document) return undefined;
    const entry = libraryById(document).get(held.entryId);
    if (!entry) return undefined;
    const others = otherPlaces(document, held.entryId, held.refId);
    return { name: entry.name, places: others.map(placeName), count: others.length, step, suggested: freeName(document, entry.name), taken: name => (document.componentLibrary ?? []).some(item => item.name.trim().toLowerCase() === name.trim().toLowerCase()) };
  }, [held, document, step]);

  const update = useCallback(() => {
    const open = latest.current.held, doc = latest.current.document;
    if (!open || !doc) return;
    const entry = libraryById(doc).get(open.entryId);
    const places = componentReferences(doc).filter(use => use.ref.componentId === open.entryId).length;
    setHeld(undefined);
    latest.current.studio.apply(open.next, open.group);
    if (entry) {
      setSession({ refId: open.refId, entryId: open.entryId, name: entry.name, places });
      setStatus(linkedStatus.updated(entry.name, places));
    }
    restore(open.focus);
  }, []);
  const toName = useCallback(() => setStep('name'), []);
  const cancel = useCallback(() => {
    const open = latest.current.held;
    setHeld(undefined); setStep('ask');
    if (open) restore(open.focus);
  }, []);
  const saveNew = useCallback((name: string) => {
    const open = latest.current.held, { studio: current, selection: selected } = latest.current;
    const before = current.latestDocument() ?? current.document;
    if (!open || !before) return;
    const docs = settleHeld(before, open.next, open.refId, { kind: 'new', name });
    const oldPath = selected ? buildDocumentIndex(before).get(selected)?.path : undefined;
    setHeld(undefined); setStep('ask');
    docs.forEach((next, at) => current.apply(next, at === docs.length - 1 ? open.group : undefined));
    const result = docs.at(-1)!;
    // The selection follows to the same node in the new component, by its place in the body; the root is the place itself.
    const created = result.componentLibrary?.findIndex(entry => entry.name === name.trim()) ?? -1;
    const root: SelectionKey = `node:${open.refId}`;
    if (selected && oldPath && oldPath[0] === 'componentLibrary' && created >= 0) {
      const relative = oldPath.slice(2);
      select(buildDocumentIndex(result).keyAt(['componentLibrary', created, ...relative], root) ?? root);
    }
    setSession(undefined);
    setStatus(linkedStatus.forked(name.trim()));
    restore(open.focus);
  }, [select]);

  const requestSave = useCallback((path: EditorPath, key: SelectionKey) => setSaving({ path, key }), []);
  const closeSave = useCallback(() => setSaving(undefined), []);
  const confirmSave = useCallback((name: string) => {
    const doc = latest.current.document;
    if (!doc || !saving) return;
    const result = saveAsComponent(doc, saving.path, name);
    latest.current.studio.apply(result.document);
    setSaving(undefined); select(result.key);
    setStatus(linkedStatus.saved(name.trim()));
  }, [saving, select]);
  const unlink = useCallback((path: EditorPath) => {
    const doc = latest.current.document;
    if (!doc) return;
    const ref = componentReferences(doc).find(use => use.path.join('/') === path.join('/'));
    const name = ref ? libraryById(doc).get(ref.ref.componentId)?.name ?? '' : '';
    latest.current.studio.apply(unlinkPlace(doc, path));
    setSession(undefined);
    setStatus(linkedStatus.unlinked(name));
  }, []);
  /** Says a line to the status region (a rename, a delete). */
  const say = useCallback((text: string) => setStatus(text), []);

  return { apply, question, session, status, saving, update, toName, cancel, saveNew, requestSave, closeSave, confirmSave, unlink, say };
}
export type LinkedGate = ReturnType<typeof useLinkedGate>;
