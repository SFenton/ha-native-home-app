import { useSyncExternalStore } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { textEditPath, UNDO_COALESCE_MS } from '../../useCompositionStudio';

/**
 * The copy of the document an editor works on. Edits go here; "Done" hands the whole copy back as one change (one undo step),
 * and closing without it drops the copy. It lives outside React state so a pushed page (which unmounts the page below) keeps it.
 * The copy keeps its own history (spec "Undo"): Undo and Redo inside a pushed editor step the draft, never the document.
 */
export interface Draft {
  get(): CompositionDocument;
  /** Replaces the copy. A `typing` key joins the step it began while the same field keeps being typed into. */
  set(next: CompositionDocument, typing?: string): void;
  subscribe(listener: () => void): () => void;
  /** Whether the copy differs from what the editor opened with. */
  dirty(): boolean;
  /** Asks to leave; shows the discard prompt when there are changes and returns whether it may close now. */
  tryLeave(): boolean;
  /** The discard prompt's state, for the surface that draws it. */
  prompt: { get(): boolean; set(open: boolean): void; subscribe(listener: () => void): () => void };
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** What this editor's Undo is called in a tooltip, set by the editor ("Undo Only Show When on Guest Room"). */
  name: string;
}

/** Most steps a draft remembers. */
export const DRAFT_HISTORY = 100;

const store = <T,>(initial: T) => {
  let value = initial;
  const listeners = new Set<() => void>();
  return { get: () => value, set(next: T) { if (next !== value) { value = next; listeners.forEach(listener => listener()); } }, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
};

/** Starts a draft from the current document. `now` is the clock, for the typing window (tests replace it). */
export function createDraft(initial: CompositionDocument, now: () => number = Date.now): Draft {
  const doc = store(initial), prompt = store(false);
  let past: CompositionDocument[] = [], future: CompositionDocument[] = [];
  let typed: { at: string; time: number } | undefined;
  return {
    get: doc.get, subscribe: doc.subscribe, name: '',
    set(next, typing) {
      const before = doc.get();
      if (next === before) return;
      const path = typing ? `${typing}|${textEditPath(before, next) ?? ''}` : undefined;
      const joins = path !== undefined && typed?.at === path && now() - typed.time < UNDO_COALESCE_MS && past.length > 0;
      if (!joins) { past = [...past, before].slice(-DRAFT_HISTORY); }
      typed = path !== undefined ? { at: path, time: now() } : undefined;
      future = [];
      doc.set(next);
    },
    dirty: () => doc.get() !== initial,
    tryLeave() { if (doc.get() === initial) return true; prompt.set(true); return false; },
    prompt,
    undo() { const last = past.at(-1); if (!last) return; past = past.slice(0, -1); future = [...future, doc.get()]; typed = undefined; doc.set(last); },
    redo() { const next = future.at(-1); if (!next) return; future = future.slice(0, -1); past = [...past, doc.get()]; typed = undefined; doc.set(next); },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
/** The draft's document, re-reading when it changes. */
export const useDraftDocument = (draft: Draft) => useSyncExternalStore(draft.subscribe, draft.get);
/** Whether the discard prompt is up. */
export const useDiscardPrompt = (draft: Draft) => useSyncExternalStore(draft.prompt.subscribe, draft.prompt.get);

// MARK: The open draft

const open: Draft[] = [];
const openListeners = new Set<() => void>();
const notify = () => openListeners.forEach(listener => listener());
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
const onKey = (event: KeyboardEvent) => {
  const draft = open.at(-1);
  if (!draft || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || isTyping(event.target)) return;
  event.preventDefault();
  if (event.shiftKey) draft.redo(); else draft.undo();
};
/** Makes `draft` the one the top bar's Undo and Redo and Command-Z act on, until the returned function is called. */
export function openDraft(draft: Draft): () => void {
  if (!open.length) window.addEventListener('keydown', onKey);
  open.push(draft); notify();
  let closed = false;
  return () => {
    if (closed) return; closed = true;
    const at = open.indexOf(draft);
    if (at >= 0) open.splice(at, 1);
    if (!open.length) window.removeEventListener('keydown', onKey);
    notify();
  };
}
/** The draft of the editor open now, if any; the top bar's Undo and Redo follow it, and re-read when it changes. */
export function useOpenDraft(): Draft | undefined {
  const draft = useSyncExternalStore(listener => { openListeners.add(listener); return () => { openListeners.delete(listener); }; }, () => open.at(-1));
  useSyncExternalStore(draft?.subscribe ?? (() => () => {}), () => draft?.get());
  return draft;
}

/** Ends the editor `draft` belongs to without its Done (the page that held it is gone), so the top bar's Undo stops following it. */
export function releaseDraft(draft: Draft): void {
  const at = open.indexOf(draft);
  if (at < 0) return;
  open.splice(at, 1);
  if (!open.length) window.removeEventListener('keydown', onKey);
  notify();
}

// MARK: Named steps

/** A step an editor's Done made, so the top bar can say what Undo and Redo do ("Undo Only Show When on Guest Room"). */
interface NamedStep { name: string; before: CompositionDocument; after: CompositionDocument }
let lastStep: NamedStep | undefined;
const stepListeners = new Set<() => void>();
/** Remembers the step an editor's Done applied. */
export function recordStep(name: string, before: CompositionDocument, after: CompositionDocument): void {
  lastStep = { name, before, after };
  stepListeners.forEach(listener => listener());
}
/** The name of the step Undo takes back (when the document is the result of the last named one), and of the one Redo brings back. */
export function useStepNames(document: CompositionDocument | undefined): { undo?: string; redo?: string } {
  const step = useSyncExternalStore(listener => { stepListeners.add(listener); return () => { stepListeners.delete(listener); }; }, () => lastStep);
  if (!step || !document) return {};
  return { undo: step.after === document ? step.name : undefined, redo: step.before === document ? step.name : undefined };
}
