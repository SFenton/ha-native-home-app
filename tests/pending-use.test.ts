import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { pendingCapabilitiesUsed, pendingUseWords } from '../src/workspace2/pendingUse';
import { runChecks } from '../src/workspace2/checks';
import { setPageSides } from '../src/workspace2/layout/fold-sides-edit';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

const home = homeDomains.document as unknown as CompositionDocument;
const homeIndex = home.pages.findIndex(page => page.id === 'page-home');
/** The shared first-slice document with one page that opens beside its parent (`sh.page-wide-open@1`, still pending). */
const wideOpen = (): CompositionDocument => {
  const document = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  document.pages[1].wideOpen = 'full';
  return document as CompositionDocument;
};

describe('warning about a project the app cannot read yet', () => {
  it('names nothing for a project that uses no pending capability, and adds no Check', () => {
    expect(pendingCapabilitiesUsed(home)).toEqual([]);
    expect(pendingUseWords(home)).toBeUndefined();
    expect(runChecks(home).suggestions.find(row => row.id === 'pending-capabilities')).toBeUndefined();
  });
  it('does not warn about Partly Folded: the app lists sh.fold-sides@1', () => {
    const on = setPageSides(home, ['pages', homeIndex], true);
    expect(pendingCapabilitiesUsed(on)).toEqual([]);
    expect(pendingUseWords(on)).toBeUndefined();
    expect(runChecks(on).suggestions.find(row => row.id === 'pending-capabilities')).toBeUndefined();
  });
  it('names a pending capability once a page uses it, in Checks and for the Publish dialog', () => {
    const on = wideOpen();
    expect(pendingCapabilitiesUsed(on)).toContain('sh.page-wide-open@1');
    const words = pendingUseWords(on)!;
    expect(words).toMatch(/Page Wide Open/);
    expect(words).toMatch(/the app does not have yet/);
    expect(words).toMatch(/until the app updates\.$/);
    expect(runChecks(on).suggestions.find(row => row.id === 'pending-capabilities')?.sentence).toBe(words);
    // A problem is not a warning: it blocks publishing on its own.
    expect(runChecks(on).problems).toEqual([]);
  });
});
