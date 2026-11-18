import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { pendingCapabilitiesUsed, pendingUseWords } from '../src/workspace2/pendingUse';
import { runChecks } from '../src/workspace2/checks';
import { setPageSides } from '../src/workspace2/layout/fold-sides-edit';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

const home = homeDomains.document as unknown as CompositionDocument;
const homeIndex = home.pages.findIndex(page => page.id === 'page-home');

describe('warning about a project the app cannot read yet', () => {
  it('names nothing for a project that uses no pending capability, and adds no Check', () => {
    expect(pendingCapabilitiesUsed(home)).not.toContain('sh.fold-sides@1');
    expect(pendingUseWords(setPageSides(home, ['pages', homeIndex], false))?.includes('Partly Folded') ?? false).toBe(false);
  });
  it('names Partly Folded once a page uses it, in Checks and for the Publish dialog', () => {
    const on = setPageSides(home, ['pages', homeIndex], true);
    expect(pendingCapabilitiesUsed(on)).toContain('sh.fold-sides@1');
    const words = pendingUseWords(on)!;
    expect(words).toMatch(/Partly Folded/);
    expect(words).toMatch(/the app does not have yet/);
    expect(words).toMatch(/until the app updates\.$/);
    expect(runChecks(on).suggestions.find(row => row.id === 'pending-capabilities')?.sentence).toBe(words);
    // A problem is not a warning: it blocks publishing on its own.
    expect(runChecks(on).problems).toEqual([]);
  });
});
