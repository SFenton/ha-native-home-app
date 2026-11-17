import { createContext, useContext } from 'react';
import type { PipelineInputs } from '../shared/composition/pipeline';
import type { Json } from '../shared/types';

/** Where a records flow stands for a repeat: no answer yet, records, an empty list, an answer that cannot be read, or a failed run. */
export type RecordsState = 'loading' | 'ready' | 'empty' | 'unavailable' | 'error';
/** What a repeat draws from: the state and the records of the flow (`sh.repeat@1`); `stale` is a later failure that kept the last records. */
export interface RecordsAnswer { state: RecordsState; records: Json[]; stale?: boolean }
/**
 * Runs the flow of a source and gives its records. A hook, supplied by the host (the Studio runs the flow over sample, live or demo data); it is called
 * for the same flow on every render of one repeat. The preview never fetches, so with no host a repeat draws its placeholder.
 */
export type UseRecords = (sourceId: string, inputs: PipelineInputs) => RecordsAnswer;

/** One drawn cell's place in a repeat: the record and its 0-based position. */
export interface ItemScope { item: Json; index: number }
/**
 * The records of the repeat the nearest node is drawn in (already cut to its `limit`), for a chart whose `source` series names no flow and so reads the list it
 * sits in (`sh.chart@1`). `undefined` outside a repeat.
 */
export const ListContext = createContext<readonly Json[] | undefined>(undefined);
/** True inside the copies of a repeat after the first: they carry no selection and no ids, so Edit selects the first copy only. */
export const CopyContext = createContext(false);
/** Whether the nearest node is a copy after the first in a repeat. */
export const useIsCopy = (): boolean => useContext(CopyContext);

/** The simulated text size's step, 0 to 3: the app's default and its three larger ones, from the preview's scale. */
export function textStepOf(scale: number | undefined): number {
  const value = scale ?? 1;
  return value < 1.1 ? 0 : value < 1.25 ? 1 : value < 1.4 ? 2 : 3;
}

/**
 * How many cells one page of a paged repeat holds (`paging`): the compact or regular count, times the factor of the text size, rounded down, never below
 * `minimum` (1 when absent) and never above the count itself.
 */
export function pageSizeOf(paging: { compact: number; regular: number; scaleByTextSize?: number[]; minimum?: number }, regular: boolean, step: number): number {
  const base = regular ? paging.regular : paging.compact;
  const scaled = Math.floor(base * (paging.scaleByTextSize?.[step] ?? 1) + 1e-9);
  return Math.max(paging.minimum ?? 1, Math.min(base, scaled));
}
