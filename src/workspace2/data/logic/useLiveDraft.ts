import { useEffect, useMemo, useRef } from 'react';
import type { CompositionDocument } from '../../../shared/composition/schema';
import type { Draft } from '../../editors/draft';

/**
 * A draft that is the document itself: `get` reads the newest document, `set` applies it at once. The logic editor's settings are always valid, so they need no
 * Done; the pickers and fields they borrow only need something shaped like a draft.
 */
export function useLiveDraft(document: CompositionDocument, apply: (next: CompositionDocument) => void): Draft {
  const latest = useRef(document), send = useRef(apply), listeners = useRef(new Set<() => void>());
  latest.current = document; send.current = apply;
  useEffect(() => { listeners.current.forEach(listener => listener()); }, [document]);
  return useMemo<Draft>(() => {
    const prompt = { get: () => false, set: () => {}, subscribe: () => () => {} };
    return {
      get: () => latest.current,
      set: next => send.current(next),
      subscribe: listener => { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; },
      dirty: () => false, tryLeave: () => true, prompt,
      undo: () => {}, redo: () => {}, canUndo: () => false, canRedo: () => false, name: '',
    };
  }, []);
}
