import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { basePageId, currentSurface, initialNav, isNavAction, navigateTo, presenterOf, reduceNavigation, tabStack, type NavAction, type NavState } from '../src/preview2/navigation';
import fixture from '../src/preview2/fixtures/home-domains.json';

const document: CompositionDocument = compileCompositionDocument(structuredClone(fixture.document)).document;
const push = (pageId: string) => ({ type: 'push' as const, pageId, arguments: {}, origin: 'sender' as const, duplicate: 'reuse-nearest' as const });
const present = (modalId: string, ifPresented: 'reject' | 'replace' = 'reject'): NavAction => ({ type: 'present', modalId, arguments: {}, ifPresented });
const run = (state: NavState, ...actions: NavAction[]) => actions.reduce((now, action) => reduceNavigation(document, now, action), state);
const start = initialNav(document);
const DETAIL = 'hc-lights-demo-room-1-detail';

describe('preview 2 navigation', () => {
  it('starts on the initial tab at its root page', () => {
    expect(start.tabId).toBe('hc-tab-home');
    expect(tabStack(document, start)).toEqual(['page-home']);
    expect(currentSurface(document, start)).toEqual({ kind: 'page', id: 'page-home' });
  });

  it('pushes onto the selected tab only, and pops back to a page already on the stack', () => {
    const pushed = run(start, push(DETAIL));
    expect(tabStack(document, pushed)).toEqual(['page-home', DETAIL]);
    expect(pushed.motion).toBe('push');
    const other = run(pushed, { type: 'select-tab', tabId: 'hc-tab-security' });
    expect(tabStack(document, other)).toEqual(['page-security']);
    expect(tabStack(document, run(other, { type: 'select-tab', tabId: 'hc-tab-home' }))).toEqual(['page-home', DETAIL]);
    const again = run(pushed, push('page-home'));
    expect(tabStack(document, again)).toEqual(['page-home']);
    expect(again.motion).toBe('pop');
    expect(run(pushed, push(DETAIL))).toBe(pushed);
  });

  it('ignores a push to a page that does not exist', () => {
    expect(run(start, push('nowhere'))).toBe(start);
  });

  it('draws a presented sheet over the page that presents it and dismisses it', () => {
    const sheet = run(start, present('hc-overview-lights'));
    expect(sheet.sheets).toEqual([{ modalId: 'hc-overview-lights', pages: [] }]);
    expect(basePageId(document, sheet)).toBe('page-home');
    expect(currentSurface(document, sheet)).toEqual({ kind: 'modal', id: 'hc-overview-lights' });
    expect(run(sheet, { type: 'dismiss', scope: 'current-modal' }).sheets).toEqual([]);
  });

  it('rejects or replaces a sheet that is already on top', () => {
    const open = run(start, present('hc-overview-lights'), push(DETAIL));
    expect(currentSurface(document, open)).toEqual({ kind: 'page', id: DETAIL });
    expect(run(open, present('hc-overview-lights', 'reject'))).toBe(open);
    const replaced = run(open, present('hc-overview-lights', 'replace'));
    expect(replaced.sheets).toEqual([{ modalId: 'hc-overview-lights', pages: [] }]);
    expect(run(start, present('missing'))).toBe(start);
  });

  it('pushes inside the open sheet, and back pops it before closing anything', () => {
    const inside = run(start, present('hc-overview-lights'), push(DETAIL));
    expect(tabStack(document, inside)).toEqual(['page-home']);
    expect(inside.sheets[0].pages).toEqual([DETAIL]);
    const back = run(inside, { type: 'back' });
    expect(back.sheets[0].pages).toEqual([]);
    expect(run(back, { type: 'back' })).toBe(back);
  });

  it('rejects a tab switch while a sheet is open', () => {
    const sheet = run(start, present('hc-overview-lights'));
    expect(run(sheet, { type: 'select-tab', tabId: 'hc-tab-security' })).toBe(sheet);
  });

  it('pops to the root and scrolls to the top when the selected tab is selected again', () => {
    const deep = run(start, push(DETAIL));
    const reselected = run(deep, { type: 'select-tab', tabId: 'hc-tab-home' });
    expect(tabStack(document, reselected)).toEqual(['page-home']);
    expect(reselected.scrollTop).toBe(1);
    expect(run(start, { type: 'select-tab', tabId: 'hc-tab-home' }).motion).toBe('none');
  });

  it('dismiss-then-push closes the sheet and then pushes on the page beneath', () => {
    const result = run(start, present('hc-overview-lights'), { type: 'dismiss-then-push', destination: push(DETAIL) });
    expect(result.sheets).toEqual([]);
    expect(tabStack(document, result)).toEqual(['page-home', DETAIL]);
  });

  it('back pops a tab stack and stops at its root', () => {
    const deep = run(start, push(DETAIL));
    const back = run(deep, { type: 'back' });
    expect(tabStack(document, back)).toEqual(['page-home']);
    expect(back.motion).toBe('pop');
    expect(run(back, { type: 'back' })).toBe(back);
  });

  it('recognises only the six navigation actions', () => {
    expect(isNavAction({ type: 'back' })).toBe(true);
    expect(isNavAction({ type: 'call-service' })).toBe(false);
    expect(isNavAction({ type: 'set-local' })).toBe(false);
  });

  it('finds the page that presents a sheet and falls back to an empty base', () => {
    expect(presenterOf(document, 'hc-overview-lights')).toBe('page-home');
    expect(presenterOf(document, 'no-such-sheet')).toBeUndefined();
    const orphan = { ...document, pages: document.pages.map(page => ({ ...page, components: [] })) };
    expect(navigateTo(orphan, initialNav(orphan), { kind: 'modal', id: 'hc-overview-lights' }).emptyBase).toBe(true);
  });

  it('shows a surface the shell picks: a tab root selects its tab, another page is pushed, a sheet opens over its page', () => {
    const tab = navigateTo(document, start, { kind: 'page', id: 'page-security' });
    expect(tab.tabId).toBe('hc-tab-security');
    expect(tabStack(document, tab)).toEqual(['page-security']);
    const page = navigateTo(document, start, { kind: 'page', id: DETAIL });
    expect(tabStack(document, page)).toEqual(['page-home', DETAIL]);
    const sheet = navigateTo(document, tab, { kind: 'modal', id: 'hc-overview-lights' });
    expect(sheet.tabId).toBe('hc-tab-home');
    expect(currentSurface(document, sheet)).toEqual({ kind: 'modal', id: 'hc-overview-lights' });
    expect(navigateTo(document, start, { kind: 'page', id: 'nowhere' })).toBe(start);
  });
});
