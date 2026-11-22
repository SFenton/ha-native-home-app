/**
 * What a publication to the app is written as. The app build on the other end is the shipped one: `contract/corpus/capabilities.json`, which is the Studio's supported list less its
 * pending ids. There is no per-target lookup (the orchestrator's decision, recorded in `build/decisions/parity-loop.md`: no second source, so promoting an id is one change in `pending.ts`).
 */
import type { CompositionDocument } from './schema';
import { compileCompositionDocument, supportedCompositionCapabilities } from './compiler';
import { lowerSheetLevels } from './global-chrome';
import { publishedDocument } from './logic-library';
import { unloweredWords } from './lints';
import { pendingCompositionCapabilities } from './pending';

export { unloweredWords };

/** The capability ids the shipped app lists: supported, less the pending ones. Derived, so promoting an id (removing it from `pending.ts`) is the only change. */
export const shippedCompositionCapabilities: readonly string[] = supportedCompositionCapabilities.filter(id => !pendingCompositionCapabilities.includes(id));

/** A document written for the target build, and where it could not be. */
export interface ServedDocument<T> {
  document: T;
  /** Pointers of saved-component uses that push from inside a sheet or a level: they cannot be lowered, so a publication that has one is refused ({@link unloweredWords}). */
  unlowered: string[];
}

/**
 * The document the app is served: every logic use worked out, then the sheet levels lowered when the target build lacks `sh.sheet-levels@1`
 * ({@link lowerSheetLevels}; a build that has it, and a document with no `levels`, are served as they are). Throws what `publishedDocument` throws.
 * Only this copy is lowered: the saved draft keeps its levels.
 */
export function servedDocument<T>(document: T, target: readonly string[] = shippedCompositionCapabilities): ServedDocument<T> {
  const lowered = lowerSheetLevels(publishedDocument(document) as CompositionDocument, target);
  return { document: lowered.document as T, unlowered: lowered.unlowered };
}

/** The capability manifest of a served document: what its own text needs, as a draft's is worked out. */
export const servedCapabilities = (document: CompositionDocument): string[] => compileCompositionDocument(document).capabilities;
