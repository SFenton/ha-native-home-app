import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  analyseRepeat, defaultUnchecked, planRepeat, repeatSteps, type RepeatAnalysis, type RepeatClass, type RepeatPlan, type RepeatPlace, type RepeatResult,
} from '../../shared/composition/repeats';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { SelectionKey } from '../../preview2/model';
import { markText } from './repeatWords';

/** The walk waits this long after an edit before it runs again, so typing never waits on it (as the Checks do). */
export const REPEATS_QUIET_MS = 300;
/** One task of the walk reads surfaces for about this long, then gives the main thread back. */
export const REPEATS_SLICE_MS = 8;

/** Where the proposal shows: in the inspector (wide) or pushed in the phone sheet. */
export type RepeatsWhere = 'inspector' | 'sheet';

/** What the canvas marks. */
export interface RepeatMark { key: SelectionKey; label: string; surface: { kind: 'page' | 'modal'; id: string } }

/** The repeated pieces' state, held by the workspace. */
export interface Repeats {
  /** Whether the level (wide) or the sheet (phone) is open. The walk runs while it is. */
  open: boolean;
  setOpen(open: boolean): void;
  /** `working` while the walk reads the document; `ready` once it has an answer for the document on show. */
  status: 'idle' | 'working' | 'ready';
  /** The line after a save ("Saved Light Grid. 14 places use it."), shown until the next piece is opened; empty otherwise. */
  note: string;
  setNote(text: string): void;
  /** The newest answer, which stays on show while the next walk runs. */
  result: RepeatResult | undefined;
  /** The class whose proposal is open, and where it shows. */
  selected: RepeatClass | undefined;
  where: RepeatsWhere | undefined;
  /** Opens the proposal of a class (or closes it with `undefined`). */
  pick(id: string | undefined, where?: RepeatsWhere): void;
  /** What differs between the places of the selected class; undefined until the walk is fresh for the document. */
  analysis: RepeatAnalysis | undefined;
  /** What saving would do with the groups left unchecked. */
  plan: RepeatPlan | undefined;
  unchecked: ReadonlySet<string>;
  /** Checks or unchecks a group. */
  setChecked(groupId: string, checked: boolean): void;
  /** The place the canvas shows: an index of the plan's kept places. */
  placeAt: number;
  /** The place the canvas shows. */
  place: RepeatPlace | undefined;
  /** Shows another place (by node id). */
  setPlace(nodeId: string): void;
  /** The canvas's mark, for the place on show. */
  mark: RepeatMark | undefined;
}

interface Pick { id?: string; where?: RepeatsWhere; unchecked?: ReadonlySet<string>; place?: string }
const none: ReadonlySet<string> = new Set();

/**
 * The repeated pieces of the document (templates spec 5, option B). The walk runs while the level is open, once the edits pause and a surface at
 * a time, giving the main thread back between slices, so no keystroke or drag waits on it. Opening a class runs the comparison for that class
 * alone. The proposal's choices (which groups are checked, which place the canvas shows) live here so the canvas mark and the inspector agree.
 */
export function useRepeats(document: CompositionDocument | undefined): Repeats {
  const [open, setOpenState] = useState(false);
  const [done, setDone] = useState<{ document: CompositionDocument; value: RepeatResult }>();
  const [chosen, setChosen] = useState<Pick>({});
  const [note, setNote] = useState('');
  const fresh = Boolean(document && done?.document === document);

  useEffect(() => {
    if (!open || !document || done?.document === document) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined;
    const run = repeatSteps(document);
    const slice = () => {
      if (cancelled) return;
      const started = performance.now();
      let next = run.next();
      while (!next.done && performance.now() - started < REPEATS_SLICE_MS) next = run.next();
      if (next.done) setDone({ document, value: next.value });
      else timer = setTimeout(slice, 0);
    };
    timer = setTimeout(slice, done ? REPEATS_QUIET_MS : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, document, done]);

  const result = done?.value;
  const selected = useMemo(() => result?.classes.find(item => item.id === chosen.id), [result, chosen.id]);
  // A piece that is no longer there (saved, edited away) closes its proposal.
  useEffect(() => { if (chosen.id && fresh && !selected) setChosen({}); }, [chosen.id, fresh, selected]);

  const analysis = useMemo(() => fresh && document && selected ? analyseRepeat(document, selected) : undefined, [fresh, document, selected]);
  const unchecked = useMemo(() => chosen.unchecked ?? (analysis ? defaultUnchecked(analysis) : none), [chosen.unchecked, analysis]);
  const plan = useMemo(() => analysis ? planRepeat(analysis, unchecked) : undefined, [analysis, unchecked]);
  const placeAt = plan ? Math.max(0, plan.kept.findIndex(at => analysis!.cls.places[at].nodeId === chosen.place)) : 0;
  const place = plan && analysis ? analysis.cls.places[plan.kept[placeAt]] : undefined;
  const mark = useMemo<RepeatMark | undefined>(() => place && plan ? { key: `node:${place.nodeId}` as SelectionKey, label: markText(placeAt, plan.kept.length), surface: { kind: place.surface.kind, id: place.surface.id } } : undefined,
    [place, plan, placeAt]);

  const setOpen = useCallback((next: boolean) => { setOpenState(next); if (!next) setChosen(held => Object.keys(held).length ? {} : held); }, []);
  const pick = useCallback((id: string | undefined, where: RepeatsWhere = 'inspector') => { setChosen(held => id === undefined ? (Object.keys(held).length ? {} : held) : { id, where }); if (id !== undefined) setNote(''); }, []);
  const setChecked = useCallback((groupId: string, checked: boolean) => setChosen(held => {
    const base = new Set(held.unchecked ?? unchecked);
    if (checked) base.delete(groupId); else base.add(groupId);
    return { ...held, unchecked: base };
  }), [unchecked]);
  const setPlace = useCallback((nodeId: string) => setChosen(held => ({ ...held, place: nodeId })), []);

  return {
    open, setOpen, note, setNote, status: !open ? (done ? 'ready' : 'idle') : fresh ? 'ready' : 'working', result, selected, where: selected ? chosen.where : undefined, pick,
    analysis, plan, unchecked, setChecked, placeAt, place, setPlace, mark,
  };
}
