import { useSyncExternalStore } from 'react';
import type { CompositionDocument } from '../../shared/composition/schema';

/**
 * The copy of the document an editor works on. Edits go here; "Done" hands the whole copy back as one change (one undo step),
 * and closing without it drops the copy. It lives outside React state so a pushed page (which unmounts the page below) keeps it.
 */
export interface Draft {
  get(): CompositionDocument;
  set(next: CompositionDocument): void;
  subscribe(listener: () => void): () => void;
  /** Whether the copy differs from what the editor opened with. */
  dirty(): boolean;
  /** Asks to leave; shows the discard prompt when there are changes and returns whether it may close now. */
  tryLeave(): boolean;
  /** The discard prompt's state, for the surface that draws it. */
  prompt: { get(): boolean; set(open: boolean): void; subscribe(listener: () => void): () => void };
}

const store = <T,>(initial: T) => {
  let value = initial;
  const listeners = new Set<() => void>();
  return { get: () => value, set(next: T) { if (next !== value) { value = next; listeners.forEach(listener => listener()); } }, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
};

/** Starts a draft from the current document. */
export function createDraft(initial: CompositionDocument): Draft {
  const doc = store(initial), prompt = store(false);
  return {
    get: doc.get, set: doc.set, subscribe: doc.subscribe,
    dirty: () => doc.get() !== initial,
    tryLeave() { if (doc.get() === initial) return true; prompt.set(true); return false; },
    prompt,
  };
}
/** The draft's document, re-reading when it changes. */
export const useDraftDocument = (draft: Draft) => useSyncExternalStore(draft.subscribe, draft.get);
/** Whether the discard prompt is up. */
export const useDiscardPrompt = (draft: Draft) => useSyncExternalStore(draft.prompt.subscribe, draft.prompt.get);
