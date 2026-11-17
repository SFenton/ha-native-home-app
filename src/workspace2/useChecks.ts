import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';
import { runChecks, type Checks } from './checks';

/** Checks wait this long after the last edit before they run, so typing never waits on them. */
export const CHECKS_QUIET_MS = 200;

const none: Checks = { problems: [], suggestions: [] };

/** What {@link useChecks} gives the workspace. */
export interface ScheduledChecks {
  /** The checks of the newest document that was checked; they trail the document by at most one quiet period. */
  checks: Checks;
  /** Whether `checks` are for the document on screen. Publishing and saving act only on a settled answer. */
  settled: boolean;
  /** The last document that was checked and had no problems: what the preview falls back on when the newest one has some. */
  lastGood: CompositionDocument | undefined;
  /** Checks the document now, if it is not already checked, and gives the answer. */
  flush(): Checks;
}

/**
 * The Checks of a document, run off the typing path. The first document is checked at once; after an edit the checks run once
 * the edits pause ({@link CHECKS_QUIET_MS}), and every action that needs a true answer (autosave, Save, Publish) waits for
 * `settled` or calls `flush`, so no document is saved or published unchecked.
 * `run` is the check itself; it is a parameter so a test can count calls.
 */
export function useChecks(document: CompositionDocument | undefined, run: (document: CompositionDocument) => Checks = runChecks): ScheduledChecks {
  const [, render] = useState(0);
  const newest = useRef(document);
  newest.current = document;
  const held = useRef<{ document: CompositionDocument; checks: Checks }>(undefined);
  const good = useRef<CompositionDocument | undefined>(undefined);
  // The first document is checked as it is loaded, so the screen never shows a project whose problems are not yet known.
  if (document && !held.current) held.current = { document, checks: run(document) };

  const check = useCallback((target: CompositionDocument): Checks => {
    if (held.current?.document === target) return held.current.checks;
    held.current = { document: target, checks: run(target) };
    render(count => count + 1);
    return held.current.checks;
  }, [run]);

  // After an edit the checks run once the edits pause.
  useEffect(() => {
    if (!document || held.current?.document === document) return;
    const timer = setTimeout(() => { if (newest.current) check(newest.current); }, CHECKS_QUIET_MS);
    return () => clearTimeout(timer);
  }, [document, check]);

  const settled = Boolean(document && held.current?.document === document);
  if (settled && held.current!.checks.problems.length === 0) good.current = held.current!.document;
  const flush = useCallback((): Checks => newest.current ? check(newest.current) : none, [check]);
  return { checks: held.current?.checks ?? none, settled, lastGood: good.current, flush };
}
