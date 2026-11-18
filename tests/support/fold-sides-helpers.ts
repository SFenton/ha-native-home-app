import { resetAdvancedFold } from '../../src/workspace2/AdvancedFold';

/** Test helpers of the Partly Folded rows. */
export { resetAdvancedFold };
export const fold = {
  /** Forgets that the one-time "Use Two Sides on Every Page" was offered. */
  clearOffer: () => { try { globalThis.localStorage?.removeItem('studio.foldSides.everyPageOffered'); } catch { /* none */ } },
};
