import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument, INK_DEFAULT_CAPABILITY } from '../src/shared/composition/compiler';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { expandDocument } from '../src/shared/composition/components';
import {
  globalChromeCapabilities, lowerSheetLevels, PAGE_CHROME_HIDE_CAPABILITY, PAGE_WIDE_OPEN_CAPABILITY, SHEET_LEVELS_CAPABILITY, TABS_VISIBILITY_CAPABILITY,
} from '../src/shared/composition/global-chrome';
import { chromeCapabilityWarnings, compositionWarnings } from '../src/shared/composition/lints';
import { standaloneToWideOpen } from '../src/shared/composition/migrate';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import type { CompositionDocument } from '../src/shared/composition/schema';

type J = Record<string, any>;

// MARK: - Helpers

/** The shared first-slice document: pages `page-orbit`, `page-lattice`, `page-echo`, the sheet `modal-swatch` (its second tile pushes `page-echo`), header button ids `chrome-inspect` and `chrome-palette`, and the shell menu `chrome-menu`. */
const base = (): J => JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
const push = (pageId: string): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
/** A level: the shared page `page-echo` as a surface that has no route style. */
const level = (document: J, id: string, components?: J[]): J => {
  const { navigation: _navigation, ...surface } = structuredClone(document.pages[2]);
  const copy = { ...surface.components[0], id: `${id}_text` };
  return { ...surface, id, title: id, toolbar: { type: 'replace', groups: [] }, components: components ?? [copy] };
};
const tile = (id: string, action: J): J => ({
  id, type: 'navigation-tile', title: id, icon: { type: 'sf-symbol', name: 'info.circle', rendering: 'canonical', unavailable: 'fallback' }, layout: { span: 1 },
  props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: 'Open' } }, action,
});
/** The sheet holds a tile that pushes `demo_level_a`; the level holds a tile that pushes `page-echo`. */
function withLevels(): J {
  const document = base();
  document.levels = [level(document, 'demo_level_a', [tile('demo_tile_out', push('page-echo'))])];
  document.modals[0].components[1] = tile('demo_tile_in', push('demo_level_a'));
  return document;
}
const issues = (document: J): CompositionIssue[] => {
  try { compileCompositionDocument(document); return []; }
  catch (error) { if (error instanceof CompositionValidationError) return error.issues; throw error; }
};
const first = (document: J) => { const [issue] = issues(document); return issue && { code: issue.code, pointer: issue.pointer }; };
const capabilities = (document: J) => compileCompositionDocument(document).capabilities;
const OLD = ['sh.composition@1'];
const NEW = [...OLD, ...globalChromeCapabilities];

// MARK: - The native corpus

describe('global-chrome corpus cases', () => {
  const directory = path.resolve(__dirname, '../contract/corpus');
  const index: { cases: { file: string; issue?: J; studioIssue?: J; pending?: boolean }[] } = JSON.parse(readFileSync(path.join(directory, 'index.json'), 'utf8'));
  const cases = index.cases.filter(item => item.file.includes('global-chrome'));
  const documentOf = (file: string): J => JSON.parse(readFileSync(path.join(directory, file), 'utf8')).document;

  it('carries all 37 native cases, each pending, each refused by the shipped list for a global-chrome id', () => {
    expect(cases).toHaveLength(37);
    for (const item of cases) {
      expect(item.pending).toBe(true);
      expect(item.issue?.code).toBe('unsupported_capability');
      expect(globalChromeCapabilities).toContain(item.issue?.capability);
    }
  });

  it.each(cases.filter(item => item.studioIssue && item.studioIssue.code !== 'capability_manifest_mismatch'))('the document of $file is refused as $studioIssue.code at $studioIssue.pointer', item => {
    expect(first(documentOf(item.file))).toEqual(item.studioIssue);
  });

  // The twelve whose envelope the Studio refuses (`capability_manifest_mismatch`) hold a header button with a drawn badge, which the Studio lists `sh.badge-nodes@1` for.
  it.each(cases.filter(item => !item.studioIssue || item.studioIssue.code === 'capability_manifest_mismatch'))('the document of $file compiles, to the declared list plus shipped ink and the badge id', item => {
    const declared: string[] = JSON.parse(readFileSync(path.join(directory, item.file), 'utf8')).capabilities;
    expect(capabilities(documentOf(item.file)).filter(name => name !== 'sh.badge-nodes@1')).toEqual([...new Set([...declared, INK_DEFAULT_CAPABILITY])].sort());
  });

  it('names the pending capabilities in the Studio list', () => {
    for (const id of globalChromeCapabilities) expect(pendingCompositionCapabilities).toContain(id);
  });
});

// MARK: - Levels

describe('levels (sh.sheet-levels@1)', () => {
  it('compiles a sheet that pushes a level that pushes a page, and declares the capability', () => {
    const document = withLevels();
    expect(issues(document)).toEqual([]);
    expect(capabilities(document)).toContain(SHEET_LEVELS_CAPABILITY);
  });

  it('declares the capability for an empty list, and none for a document with no `levels`', () => {
    const empty = base(); empty.levels = [];
    expect(capabilities(empty)).toContain(SHEET_LEVELS_CAPABILITY);
    expect(capabilities(base())).not.toContain(SHEET_LEVELS_CAPABILITY);
  });

  it('lets a level push another level, and two sheets share a level', () => {
    const document = withLevels();
    document.levels.push(level(document, 'demo_level_b'));
    document.levels[0].components[0] = tile('demo_tile_deeper', push('demo_level_b'));
    document.modals.push({ ...structuredClone(document.modals[0]), id: 'demo_sheet_b', components: [tile('demo_tile_b', push('demo_level_a'))] });
    expect(document.modals).toHaveLength(2);
    expect(issues(document)).toEqual([]);
  });

  it('keeps a push from a sheet to a real page as it is', () => {
    expect(issues(base())).toEqual([]);
    expect(capabilities(base())).not.toContain(SHEET_LEVELS_CAPABILITY);
  });

  it.each([
    ['a page', (d: J) => { d.pages[1].components[1] = tile('demo_tile_p', push('demo_level_a')); }, 'invalid_combination', '/document/pages/1/components/1/action/pageId'],
    ['a header button', (d: J) => { d.navigation.chrome.groups[0].items[1].action = push('demo_level_a'); }, 'invalid_combination', '/document/navigation/chrome/groups/0/items/1/action/pageId'],
    ['a dismiss-then-push', (d: J) => { d.modals[0].components[1] = tile('demo_tile_d', { type: 'dismiss-then-push', destination: push('demo_level_a') }); }, 'invalid_combination', '/document/modals/0/components/1/action/destination/pageId'],
    ['a tab', (d: J) => { d.navigation.tabs[1].pageId = 'demo_level_a'; }, 'invalid_reference', '/document/navigation/tabs/1/pageId'],
    ['the first page', (d: J) => { d.navigation.initialPageId = 'demo_level_a'; }, 'invalid_reference', '/document/navigation/initialPageId'],
    ['a present', (d: J) => { d.navigation.chrome.groups[1].items[0].action = { type: 'present', modalId: 'demo_level_a', arguments: {}, ifPresented: 'reject' }; }, 'invalid_reference', '/document/navigation/chrome/groups/1/items/0/action/modalId'],
  ])('refuses a level reached from %s', (_name, change, code, pointer) => {
    const document = withLevels();
    change(document);
    expect(first(document)).toEqual({ code, pointer });
  });

  it('refuses a push to an id that is neither a page nor a level', () => {
    const document = withLevels();
    document.modals[0].components[1] = tile('demo_tile_x', push('demo_missing'));
    expect(first(document)).toEqual({ code: 'invalid_reference', pointer: '/document/modals/0/components/1/action/pageId' });
  });

  it('refuses a level that inherits the toolbar, as a sheet does', () => {
    const document = withLevels();
    document.levels[0].toolbar = { type: 'inherit' };
    expect(first(document)).toEqual({ code: 'invalid_combination', pointer: '/document/levels/0/toolbar' });
  });

  it.each(['navigation', 'hides', 'wideOpen', 'presentation'])('refuses `%s` on a level: it is not a page', field => {
    const document = withLevels();
    document.levels[0][field] = field === 'navigation' ? { type: 'stack' } : field === 'hides' ? { tabs: true } : field === 'wideOpen' ? 'full' : {};
    expect(first(document)).toEqual({ code: 'unknown_field', pointer: `/document/levels/0/${field}` });
  });

  it.each([
    ['a page', 'page-echo', '/document/levels/1/id'],
    ['a sheet', 'modal-swatch', '/document/levels/1/id'],
    ['a level', 'demo_level_a', '/document/levels/0/id'],
  ])('refuses a level with the id of %s', (_name, id, pointer) => {
    const document = withLevels();
    document.levels.push(level(document, id));
    expect(first(document)).toEqual({ code: 'duplicate_id', pointer });
  });

  it('counts levels in the 512-surface limit', () => {
    const document = base();
    document.levels = Array.from({ length: 256 }, (_, index) => level(document, `demo_level_${index}`));
    document.pages = Array.from({ length: 256 }, (_, index) => ({ ...structuredClone(document.pages[0]), id: `demo_page_${index}` }));
    document.pages[0].id = 'page-orbit';
    document.navigation.tabs = document.navigation.tabs.map((tab: J) => ({ ...tab, pageId: 'page-orbit' }));
    expect(issues(document).map(issue => issue.code)).toContain('limit_exceeded');
  });

  it('checks a saved component that takes a page argument by where it is used', () => {
    const entry = { id: 'demo_open', name: 'Open', params: [{ name: 'target', kind: 'page-id' }], bindings: [{ param: 'target', nodeId: 'demo_open_tile', field: 'action/pageId' }], node: tile('demo_open_tile', push('page-echo')) };
    const use = (id: string) => ({ id, type: 'component-ref', componentId: 'demo_open', layout: { span: 1 }, args: { target: 'demo_level_a' } });
    const inSheet = withLevels();
    inSheet.componentLibrary = [entry];
    inSheet.modals[0].components[1] = use('demo_use');
    expect(issues(inSheet)).toEqual([]);
    const onPage = withLevels();
    onPage.componentLibrary = [entry];
    onPage.pages[1].components[1] = use('demo_use');
    expect(first(onPage)).toEqual({ code: 'invalid_combination', pointer: '/document/pages/1/components/1/args/target' });
  });

  it('expands the saved components inside a level', () => {
    const document = withLevels();
    document.componentLibrary = [{ id: 'demo_note', name: 'Note', node: tile('demo_note_tile', push('page-echo')) }];
    document.levels[0].components = [{ id: 'demo_use', type: 'component-ref', componentId: 'demo_note', layout: { span: 1 } }];
    expect(expandDocument(document as CompositionDocument).levels![0].components[0].type).toBe('navigation-tile');
  });

  it('limits the toolbar a sheet and the level it reaches share', () => {
    const document = withLevels();
    const button = (index: number) => ({ id: `demo_button_${index}`, type: 'button', label: 'Go', menuLabel: 'Go', icon: document.navigation.chrome.groups[1].items[0].icon, visibility: 'always', priority: 'normal', rail: 'eligible', badge: { type: 'none' }, action: push('page-echo') });
    document.levels[0].toolbar = { type: 'replace', groups: [{ id: 'demo_group', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: Array.from({ length: 12 }, (_, index) => button(index)) }] };
    expect(first(document)).toEqual({ code: 'limit_exceeded', pointer: '/document/levels/0/toolbar' });
  });
});

// MARK: - Page chrome

describe('hides (sh.page-chrome-hide@1)', () => {
  it('accepts the tab bar, items, both, and an empty object, and declares the capability for each', () => {
    for (const hides of [{ tabs: true }, { items: ['chrome-inspect', 'chrome-palette'] }, { tabs: true, items: ['chrome-inspect'] }, {}]) {
      const document = base(); document.pages[1].hides = hides;
      expect(issues(document)).toEqual([]);
      expect(capabilities(document)).toContain(PAGE_CHROME_HIDE_CAPABILITY);
    }
    expect(capabilities(base())).not.toContain(PAGE_CHROME_HIDE_CAPABILITY);
  });

  it.each([
    ['an unknown item', { items: ['demo_missing'] }, 'invalid_reference', '/document/pages/1/hides/items/0'],
    ['the shell menu', { items: ['chrome-menu'] }, 'invalid_combination', '/document/pages/1/hides/items/0'],
    ['an item named twice', { items: ['chrome-inspect', 'chrome-inspect'] }, 'duplicate_id', '/document/pages/1/hides/items/1'],
    ['items that are not a list', { items: 'chrome-inspect' }, 'invalid_value', '/document/pages/1/hides/items'],
    ['a flag that is not a boolean', { tabs: 'yes' }, 'invalid_value', '/document/pages/1/hides/tabs'],
    ['a field it does not have', { footer: true }, 'unknown_field', '/document/pages/1/hides/footer'],
  ])('refuses %s', (_name, hides, code, pointer) => {
    const document = base(); document.pages[1].hides = hides;
    expect(first(document)).toEqual({ code, pointer });
  });

  it('refuses items on a page that replaces the toolbar, and lets it hide the tab bar', () => {
    const document = base();
    document.pages[2].toolbar = { type: 'replace', groups: [] };
    document.pages[2].hides = { tabs: true, items: ['chrome-inspect'] };
    expect(first(document)).toEqual({ code: 'invalid_combination', pointer: '/document/pages/2/hides/items' });
    document.pages[2].hides = { tabs: true };
    expect(issues(document)).toEqual([]);
  });

  it('refuses `hides` on a sheet', () => {
    const document = base(); document.modals[0].hides = { tabs: true };
    expect(first(document)).toEqual({ code: 'unknown_field', pointer: '/document/modals/0/hides' });
  });
});

describe('wideOpen (sh.page-wide-open@1)', () => {
  it.each(['automatic', 'full', 'beside'])('accepts `%s` and declares the capability', value => {
    const document = base(); document.pages[1].wideOpen = value;
    expect(issues(document)).toEqual([]);
    expect(capabilities(document)).toContain(PAGE_WIDE_OPEN_CAPABILITY);
  });

  it('accepts it on a columns page, beside `standalone`', () => {
    const document = base();
    document.pages[1].navigation = { type: 'navigation-columns', placeholder: 'Pick one', standalone: true, onDemand: false };
    document.pages[1].wideOpen = 'beside';
    expect(issues(document)).toEqual([]);
  });

  it('declares nothing for a page without it', () => {
    expect(capabilities(base())).not.toContain(PAGE_WIDE_OPEN_CAPABILITY);
  });

  it('refuses an unknown value, and the field on a sheet', () => {
    const unknown = base(); unknown.pages[1].wideOpen = 'wide';
    expect(first(unknown)).toEqual({ code: 'unknown_variant', pointer: '/document/pages/1/wideOpen' });
    const sheet = base(); sheet.modals[0].wideOpen = 'full';
    expect(first(sheet)).toEqual({ code: 'unknown_field', pointer: '/document/modals/0/wideOpen' });
  });
});

describe('tabsVisibility (sh.tabs-visibility@1)', () => {
  it.each(['always', 'root-only'])('accepts `%s` and declares the capability, even for the default', value => {
    const document = base(); document.navigation.tabsVisibility = value;
    expect(issues(document)).toEqual([]);
    expect(capabilities(document)).toContain(TABS_VISIBILITY_CAPABILITY);
  });

  it('declares nothing when absent (absent is `always`)', () => {
    expect(capabilities(base())).not.toContain(TABS_VISIBILITY_CAPABILITY);
  });

  it('refuses an unknown value', () => {
    const document = base(); document.navigation.tabsVisibility = 'sometimes';
    expect(first(document)).toEqual({ code: 'unknown_variant', pointer: '/document/navigation/tabsVisibility' });
  });
});

// MARK: - Lowering

describe('lowering for a build without sh.sheet-levels@1', () => {
  const lowered = (document: J, target: string[] = OLD) => lowerSheetLevels(document as CompositionDocument, target);

  it('hands back the same document for a build that has the capability', () => {
    const document = withLevels() as CompositionDocument;
    const result = lowerSheetLevels(document, NEW);
    expect(result.document).toBe(document);
    expect(result.changes).toEqual([]);
  });

  it('writes a push from a sheet to a page as dismiss-then-push, and leaves a push to a level a push', () => {
    const document = withLevels();
    document.modals[0].components.push(tile('demo_tile_page', push('page-echo')));
    const result = lowered(document);
    const sheet = result.document.modals[0].components as J[];
    expect(sheet[1].action).toEqual(push('demo_level_a'));
    expect(sheet[3].action).toEqual({ type: 'dismiss-then-push', destination: push('page-echo') });
    expect(result.changes).toContain('dismiss then push at /document/modals/0/components/3/action');
  });

  it('hands back a document without `levels` as it is: its in-sheet push keeps its meaning', () => {
    const document = base() as CompositionDocument;
    const result = lowerSheetLevels(document, OLD);
    expect(result.document).toBe(document);
    expect(result.changes).toEqual([]);
    expect(result.unlowered).toEqual([]);
  });

  it('lowers a document with an empty `levels` list: it declares the rule', () => {
    const document = base(); document.levels = [];
    expect((lowered(document).document.modals[0].components[1] as J).action).toEqual({ type: 'dismiss-then-push', destination: push('page-echo') });
  });

  it('writes each level as a stack page after the pages, and its push to a page as dismiss-then-push', () => {
    const result = lowered(withLevels());
    expect(result.document.levels).toBeUndefined();
    expect(result.document.pages.map(page => page.id)).toEqual(['page-orbit', 'page-lattice', 'page-echo', 'demo_level_a']);
    expect(result.document.pages[3].navigation).toEqual({ type: 'stack' });
    expect((result.document.pages[3].components[0] as J).action).toEqual({ type: 'dismiss-then-push', destination: push('page-echo') });
    expect(result.changes).toEqual(['dismiss then push at /document/levels/0/components/0/action', 'write 1 level as pages']);
  });

  it('gives a document the old build compiles, with no sheet-levels id', () => {
    const result = lowered(withLevels());
    const manifest = compileCompositionDocument(result.document).capabilities;
    expect(manifest).not.toContain(SHEET_LEVELS_CAPABILITY);
    expect(manifest).toContain('sh.actions.navigation@1');
  });

  it('does not rewrite a push from a page, the header or a tab, nor one already inside a dismiss-then-push', () => {
    const document = base();
    document.modals[0].components[1] = tile('demo_tile_d', { type: 'dismiss-then-push', destination: push('page-echo') });
    const result = lowered(document);
    expect(result.document.modals[0].components[1]).toEqual(document.modals[0].components[1]);
    expect(result.document.pages).toEqual(document.pages);
    expect(result.document.navigation).toEqual(document.navigation);
    expect(result.changes).toEqual([]);
  });

  it('does not change its input', () => {
    const document = withLevels();
    const before = JSON.stringify(document);
    lowered(document);
    expect(JSON.stringify(document)).toBe(before);
  });

  it('keeps the other global-chrome fields: they need the newer build and are not lowered', () => {
    const document = withLevels();
    document.pages[1].hides = { tabs: true };
    expect(lowered(document).document.pages[1].hides).toEqual({ tabs: true });
  });

  it('names a saved component used in a sheet that pushes a page, and leaves it as it is', () => {
    const document = withLevels();
    document.componentLibrary = [{ id: 'demo_note', name: 'Note', node: tile('demo_note_tile', push('page-echo')) }];
    document.modals[0].components[1] = { id: 'demo_use', type: 'component-ref', componentId: 'demo_note', layout: { span: 1 } };
    const result = lowered(document);
    expect(result.unlowered).toEqual(['/document/modals/0/components/1']);
    expect(result.document.modals[0].components[1]).toEqual(document.modals[0].components[1]);
    const harmless = withLevels();
    harmless.componentLibrary = [{ id: 'demo_text', name: 'Text', node: document.pages[1].components[0] }];
    harmless.modals[0].components[1] = { id: 'demo_use', type: 'component-ref', componentId: 'demo_text', layout: { span: 1 } };
    expect(lowered(harmless).unlowered).toEqual([]);
  });
});

// MARK: - Migration

describe('standaloneToWideOpen', () => {
  const columns = (standalone: boolean, extra: J = {}): J => ({ id: 'demo_columns', navigation: { type: 'navigation-columns', placeholder: 'Pick', standalone }, ...extra });

  it('writes `wideOpen: "full"` for a standalone columns page, and keeps `standalone`', () => {
    const { document, changes } = standaloneToWideOpen({ pages: [{ id: 'demo_stack', navigation: { type: 'stack' } }, columns(true)] });
    expect((document as J).pages[1].wideOpen).toBe('full');
    expect((document as J).pages[1].navigation.standalone).toBe(true);
    expect((document as J).pages[0].wideOpen).toBeUndefined();
    expect(changes).toEqual(['write wideOpen full at /pages/1/wideOpen']);
  });

  it('leaves a page that is not standalone, or that already says how it opens', () => {
    const input = { pages: [columns(false), columns(true, { wideOpen: 'beside' })] };
    const { document, changes } = standaloneToWideOpen(input);
    expect(document).toEqual(input);
    expect(changes).toEqual([]);
  });

  it('is idempotent, does not change its input, and ignores a value that is not a document', () => {
    const input = { pages: [columns(true)] };
    const once = standaloneToWideOpen(input);
    expect((input.pages[0] as J).wideOpen).toBeUndefined();
    expect(standaloneToWideOpen(once.document)).toEqual({ document: once.document, changes: [] });
    expect(standaloneToWideOpen(null)).toEqual({ document: null, changes: [] });
    expect(standaloneToWideOpen({ pages: 'none' })).toEqual({ document: { pages: 'none' }, changes: [] });
  });

  it('gives a document that compiles, and needs the page-wide-open capability', () => {
    const document = base();
    document.pages[1].navigation = { type: 'navigation-columns', placeholder: 'Pick one', standalone: true };
    const migrated = standaloneToWideOpen(document).document as J;
    expect(issues(migrated)).toEqual([]);
    expect(capabilities(migrated)).toContain(PAGE_WIDE_OPEN_CAPABILITY);
  });
});

// MARK: - Lints

describe('"Needs a newer app" lints', () => {
  const used = (): J => {
    const document = withLevels();
    document.pages[1].hides = { tabs: true };
    document.pages[2].wideOpen = 'beside';
    document.navigation.tabsVisibility = 'root-only';
    return document;
  };

  it('names each setting the target build lacks, with its pointer and capability', () => {
    const warnings = chromeCapabilityWarnings(used() as CompositionDocument, OLD);
    expect(warnings.map(warning => [warning.pointer, warning.capability])).toEqual([
      ['/document/pages/1/hides', PAGE_CHROME_HIDE_CAPABILITY],
      ['/document/pages/2/wideOpen', PAGE_WIDE_OPEN_CAPABILITY],
      ['/document/navigation/tabsVisibility', TABS_VISIBILITY_CAPABILITY],
    ]);
    for (const warning of warnings) expect(warning.message.startsWith('Needs a newer app.')).toBe(true);
  });

  it('is silent for the capability the target has, one at a time', () => {
    const target = (id: string) => chromeCapabilityWarnings(used() as CompositionDocument, [...OLD, id]).map(warning => warning.capability);
    expect(target(PAGE_CHROME_HIDE_CAPABILITY)).toEqual([PAGE_WIDE_OPEN_CAPABILITY, TABS_VISIBILITY_CAPABILITY]);
    expect(target(PAGE_WIDE_OPEN_CAPABILITY)).toEqual([PAGE_CHROME_HIDE_CAPABILITY, TABS_VISIBILITY_CAPABILITY]);
    expect(target(TABS_VISIBILITY_CAPABILITY)).toEqual([PAGE_CHROME_HIDE_CAPABILITY, PAGE_WIDE_OPEN_CAPABILITY]);
    expect(chromeCapabilityWarnings(used() as CompositionDocument, NEW)).toEqual([]);
  });

  it('says nothing for levels (they are lowered), nor for a document that uses none of it', () => {
    expect(chromeCapabilityWarnings(withLevels() as CompositionDocument, OLD)).toEqual([]);
    expect(chromeCapabilityWarnings(base() as CompositionDocument, OLD)).toEqual([]);
  });

  it('warns about a saved component in a sheet that cannot be lowered', () => {
    const document = withLevels();
    document.componentLibrary = [{ id: 'demo_note', name: 'Note', node: tile('demo_note_tile', push('page-echo')) }];
    document.modals[0].components[1] = { id: 'demo_use', type: 'component-ref', componentId: 'demo_note', layout: { span: 1 } };
    const warnings = chromeCapabilityWarnings(document as CompositionDocument, OLD);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].pointer).toBe('/document/modals/0/components/1');
    expect(chromeCapabilityWarnings(document as CompositionDocument, NEW)).toEqual([]);
  });

  it('joins the authoring warnings only when the target is given', () => {
    expect(compositionWarnings(used())).toEqual([]);
    expect(compositionWarnings(used(), { target: OLD })).toHaveLength(3);
    expect(compositionWarnings(used(), { target: NEW })).toEqual([]);
    expect(compositionWarnings({ pages: 'none' }, { target: OLD })).toEqual([]);
    expect(compositionWarnings(null, { target: OLD })).toEqual([]);
  });
});
