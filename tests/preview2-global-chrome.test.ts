import { describe, expect, it } from 'vitest';
import { chromeGroups, hidesTabs } from '../src/preview2/chrome-hide';
import { currentSurface, initialNav, reduceNavigation, tabStack, type NavAction, type NavState } from '../src/preview2/navigation';
import { arrangeWide, leadingButton, wideOpenOf } from '../src/preview2/wide-open';
import { tabsAtTop } from '../src/preview2/split';
import { previewWindows } from '../src/preview2/windows';
import { demoDocument, push } from './preview2-gc-fixture';

const document = demoDocument();
const present = (modalId: string): NavAction => ({ type: 'present', modalId, arguments: {}, ifPresented: 'reject' });
const run = (state: NavState, ...actions: NavAction[]) => actions.reduce((now, action) => reduceNavigation(document, now, action), state);
const start = initialNav(document);
const ids = (groups: ReturnType<typeof chromeGroups>) => groups.flatMap(group => group.items.map(item => item.id));

describe('a push from a sheet (proposal section 3)', () => {
  it('to an entry of pages[] closes every level and the sheet, then pushes on the tab stack; Back returns to the page under the sheet', () => {
    const inLevels = run(start, present('demo_sheet'), push('demo_level_a'), push('demo_level_b'));
    expect(inLevels.sheets).toEqual([{ modalId: 'demo_sheet', pages: ['demo_level_a', 'demo_level_b'] }]);
    const landed = run(inLevels, push('demo_plain'));
    expect(landed.sheets).toEqual([]);
    expect(tabStack(document, landed)).toEqual(['page-home', 'demo_plain']);
    expect(landed.motion).toBe('push');
    expect(currentSurface(document, landed)).toEqual({ kind: 'page', id: 'demo_plain' });
    const back = run(landed, { type: 'back' });
    expect(tabStack(document, back)).toEqual(['page-home']);
    expect(back.sheets).toEqual([]);
  });

  it('from the sheet itself does the same, with no level open', () => {
    const landed = run(start, present('demo_sheet'), push('demo_plain'));
    expect(landed.sheets).toEqual([]);
    expect(tabStack(document, landed)).toEqual(['page-home', 'demo_plain']);
  });

  it('to an entry of levels[] stays in the sheet, with Back and Close: Back pops the level, Close closes the sheet', () => {
    const inside = run(start, present('demo_sheet'), push('demo_level_a'));
    expect(tabStack(document, inside)).toEqual(['page-home']);
    expect(inside.sheets[0].pages).toEqual(['demo_level_a']);
    expect(inside.motion).toBe('push');
    // A level is part of its sheet: the shell is told the sheet is showing.
    expect(currentSurface(document, inside)).toEqual({ kind: 'modal', id: 'demo_sheet' });
    expect(run(inside, { type: 'back' }).sheets[0].pages).toEqual([]);
    expect(run(inside, { type: 'dismiss', scope: 'current-modal' }).sheets).toEqual([]);
    expect(run(inside, push('demo_level_a'))).toBe(inside);
  });

  it('refuses a level from a page: only a sheet or a level reaches one', () => {
    expect(run(start, push('demo_level_a'))).toBe(start);
  });

  it('keeps a push inside the sheet in a document that declares no levels', () => {
    const { levels: _levels, ...plain } = document;
    const inside = reduceNavigation(plain, reduceNavigation(plain, start, present('demo_sheet')), push('demo_plain'));
    expect(inside.sheets[0].pages).toEqual(['demo_plain']);
  });
});

describe('what a page hides (proposal section 2)', () => {
  const pageWith = (hides: { tabs?: boolean; items?: string[] }, replace = false) => {
    const page = demoDocument({ demo_plain: { hides } }).pages.find(item => item.id === 'demo_plain')!;
    return replace ? { ...page, toolbar: { type: 'replace' as const, groups: [{ id: 'own', placement: 'trailing' as const, horizontal: 'separate-circles@1' as const, vertical: 'shared@1' as const, items: [document.navigation.chrome.groups[1].items[0]] }] } } : page;
  };

  it('hides the tabs while the page is on top, at any depth, and for root-only on a pushed page', () => {
    expect(hidesTabs({ tabs: true }, undefined, 0)).toBe(true);
    expect(hidesTabs({ tabs: true }, 'always', 3)).toBe(true);
    expect(hidesTabs(undefined, 'always', 2)).toBe(false);
    expect(hidesTabs({ tabs: false }, undefined, 2)).toBe(false);
    expect(hidesTabs(undefined, 'root-only', 0)).toBe(false);
    expect(hidesTabs(undefined, 'root-only', 1)).toBe(true);
    expect(hidesTabs({ tabs: false, items: [] }, 'root-only', 4)).toBe(true);
  });

  it('draws every item at the root and drops the app\'s first-page-only item on a pushed page', () => {
    const plain = demoDocument().pages.find(item => item.id === 'demo_plain')!;
    expect(ids(chromeGroups(document, plain, 0))).toEqual(['fixture-menu', 'demo_btn_always', 'demo_btn_first', 'demo_btn_hidden', 'demo_header']);
    expect(ids(chromeGroups(document, plain, 1))).toEqual(['fixture-menu', 'demo_btn_always', 'demo_btn_hidden', 'demo_header']);
  });

  it('hides an item when the app or the page says so, and only hides', () => {
    const page = pageWith({ items: ['demo_btn_hidden', 'demo_btn_first', 'demo_header'] });
    expect(ids(chromeGroups(document, page, 0))).toEqual(['fixture-menu', 'demo_btn_always']);
    expect(ids(chromeGroups(document, page, 2))).toEqual(['fixture-menu', 'demo_btn_always']);
    // A page cannot show what the app hides: naming an item that is not there changes nothing.
    expect(ids(chromeGroups(document, pageWith({ items: ['nothing'] }), 1))).toEqual(['fixture-menu', 'demo_btn_always', 'demo_btn_hidden', 'demo_header']);
  });

  it('never hides the shell menu, and drops a group left empty', () => {
    const page = pageWith({ items: ['fixture-menu', 'demo_btn_always', 'demo_btn_first', 'demo_btn_hidden', 'demo_header'] });
    const groups = chromeGroups(document, page, 0);
    expect(ids(groups)).toEqual(['fixture-menu']);
    expect(groups.map(group => group.id)).toEqual(['fixture-leading']);
  });

  it('has nothing to drop on a page that replaces the toolbar, which draws its own items', () => {
    const page = pageWith({ items: ['demo_btn_always'] }, true);
    expect(ids(chromeGroups(document, page, 0))).toEqual(['demo_btn_always']);
  });
});

describe('the tabs at the top (proposal section 1)', () => {
  it('belong to the full-screen iPad in both orientations, and to no other frame', () => {
    expect(previewWindows.map(win => `${win.name}: ${tabsAtTop(win)}`)).toEqual([
      'iPhone: false', 'Duo folded: false', 'Duo open, upright: false', 'Duo open, sideways: false', 'iPad upright: true', 'iPad sideways: true', 'Duo folded, sideways: false',
    ]);
  });
});

describe('wide windows (proposal section 5)', () => {
  const wide = (doc: typeof document, ...stack: string[]) => arrangeWide(doc, stack);

  it('reads the setting from the page: Automatic by default, Full width for a standalone columns page', () => {
    const pages = demoDocument().pages;
    expect(wideOpenOf(pages.find(item => item.id === 'demo_plain')!)).toBe('automatic');
    expect(wideOpenOf(pages.find(item => item.id === 'demo_full')!)).toBe('full');
    expect(wideOpenOf(pages.find(item => item.id === 'demo_beside')!)).toBe('beside');
    const standalone = { ...pages.find(item => item.id === 'demo_settings')!, navigation: { type: 'navigation-columns' as const, placeholder: '', standalone: true } };
    expect(wideOpenOf(standalone)).toBe('full');
    expect(wideOpenOf({ ...standalone, wideOpen: 'automatic' })).toBe('automatic');
  });

  it('Automatic from a page that does not open pages beside it is full width (Home, Master Bedroom)', () => {
    expect(wide(document, 'page-home')).toEqual({ type: 'single', index: 0 });
    expect(wide(document, 'page-home', 'demo_plain')).toEqual({ type: 'single', index: 1 });
  });

  it('Automatic from a columns page opens beside it, and a columns page alone shows its own two panes (Settings, Vacation)', () => {
    expect(wide(document, 'demo_settings')).toEqual({ type: 'columns', leading: 0, start: 0 });
    expect(wide(document, 'demo_settings', 'demo_vacation')).toEqual({ type: 'columns', leading: 0, trailing: 1, start: 0 });
  });

  it('cascades: opening from the trailing column moves it leading and opens the new page trailing (Settings, Vacation, Solo trip)', () => {
    expect(wide(document, 'demo_settings', 'demo_vacation', 'demo_trip')).toEqual({ type: 'columns', leading: 1, trailing: 2, start: 0 });
    expect(wide(document, 'demo_settings', 'demo_vacation', 'demo_trip', 'demo_plain')).toEqual({ type: 'columns', leading: 2, trailing: 3, start: 0 });
  });

  it('Back reverses the cascade because the layout is a function of the stack', () => {
    const stack = ['demo_settings', 'demo_vacation', 'demo_trip'];
    expect(arrangeWide(document, stack.slice(0, 2))).toEqual({ type: 'columns', leading: 0, trailing: 1, start: 0 });
    expect(arrangeWide(document, stack.slice(0, 1))).toEqual({ type: 'columns', leading: 0, start: 0 });
  });

  it('Full width pushes over the columns on the stack; Back returns to them as they were', () => {
    expect(wide(document, 'demo_settings', 'demo_full')).toEqual({ type: 'single', index: 1 });
    expect(wide(document, 'demo_settings', 'demo_vacation', 'demo_full')).toEqual({ type: 'single', index: 2 });
    expect(wide(document, 'demo_settings', 'demo_vacation', 'demo_full', 'demo_plain')).toEqual({ type: 'single', index: 3 });
    expect(wide(document, 'demo_settings', 'demo_vacation')).toEqual({ type: 'columns', leading: 0, trailing: 1, start: 0 });
  });

  it('Beside from a page with no columns gives the origin the leading half (Home, Master Bedroom set to Beside)', () => {
    expect(wide(document, 'page-home', 'demo_beside')).toEqual({ type: 'columns', leading: 0, trailing: 1, start: 0 });
    expect(wide(document, 'page-home', 'demo_beside', 'demo_plain')).toEqual({ type: 'columns', leading: 1, trailing: 2, start: 0 });
    expect(wide(document, 'page-home', 'demo_beside', 'demo_full')).toEqual({ type: 'single', index: 2 });
  });

  it('a columns page that starts on demand is one pane until something opens beside it', () => {
    const onDemand = demoDocument({ demo_settings: { columns: 'on-demand' } });
    expect(arrangeWide(onDemand, ['demo_settings'])).toEqual({ type: 'single', index: 0 });
    expect(arrangeWide(onDemand, ['demo_settings', 'demo_vacation'])).toEqual({ type: 'columns', leading: 0, trailing: 1, start: 0 });
  });

  it('a columns page opened full width lands with its own panes (an empty side), and its first page beside is trailing', () => {
    expect(wide(document, 'page-home', 'demo_settings')).toEqual({ type: 'columns', leading: 1, start: 1 });
    expect(wide(document, 'page-home', 'demo_settings', 'demo_vacation')).toEqual({ type: 'columns', leading: 1, trailing: 2, start: 1 });
  });

  it('a push from the leading column replaces the trailing one: the stack is cut back to the sender first', () => {
    const open = run(initialNav(demoDocument()), push('demo_settings'), push('demo_vacation'));
    expect(tabStack(document, open)).toEqual(['page-home', 'demo_settings', 'demo_vacation']);
    const replaced = reduceNavigation(document, open, push('demo_trip'), 'demo_settings');
    expect(tabStack(document, replaced)).toEqual(['page-home', 'demo_settings', 'demo_trip']);
    const cascaded = reduceNavigation(document, open, push('demo_trip'), 'demo_vacation');
    expect(tabStack(document, cascaded)).toEqual(['page-home', 'demo_settings', 'demo_vacation', 'demo_trip']);
  });

  it('leads with Close for the first page beside the host and Back from depth 2, by column depth', () => {
    const lead = (...stack: string[]) => leadingButton(arrangeWide(document, stack) as Extract<ReturnType<typeof arrangeWide>, { type: 'columns' }>);
    // A tab's first page that opens pages beside it: nothing leads, then Close, then Back (the owner's case).
    expect(lead('demo_settings')).toBe('none');
    expect(lead('demo_settings', 'demo_vacation')).toBe('close');
    expect(lead('demo_settings', 'demo_vacation', 'demo_trip')).toBe('back');
    // Beside from Home: Home is the host of the set.
    expect(lead('page-home', 'demo_beside')).toBe('close');
    expect(lead('page-home', 'demo_beside', 'demo_plain')).toBe('back');
    // A columns page that was itself pushed: the column rule is kept (the page's own Back when nothing is open yet).
    expect(lead('page-home', 'demo_settings')).toBe('back');
    expect(lead('page-home', 'demo_settings', 'demo_vacation')).toBe('close');
    expect(lead('page-home', 'demo_settings', 'demo_vacation', 'demo_trip')).toBe('back');
  });
});
