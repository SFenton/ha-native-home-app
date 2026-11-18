// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDocumentIndex } from '../src/preview2/model';
import { duoWindow } from '../src/preview2/windows';
import { previewWindows } from '../src/preview2/Preview2';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { blankPage, blankSheet } from '../src/workspace2/navigation/edit';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { runChecks } from '../src/workspace2/checks';
import { fold, resetAdvancedFold } from './support/fold-sides-helpers';
import {
  automaticSideAt, isTopLevelPageComponent, overrideCount, pagesWithoutSides, partlyFoldedWindow, resetSides, setFoldSide, setPageSides, showsPartlyFolded, twoSidesOnEveryPage,
} from '../src/workspace2/layout/fold-sides-edit';
import * as foldEdit from '../src/workspace2/layout/fold-sides-edit';
import { NESTED_CAPTION, PINNED_CAPTION, SIDE_CAPTION, SIDES_CAPTION, WAITING_CAPTION } from '../src/workspace2/layout/FoldSides';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import { SimulatorWindowContext } from '../src/workspace2/simulatorWindow';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { resetAdvancedFold(); fold.clearOffer(); });
const home = homeDomains.document as unknown as CompositionDocument;
const homeIndex = home.pages.findIndex(page => page.id === 'page-home');
const on = (document: CompositionDocument, pageIndex = homeIndex) => setPageSides(document, ['pages', pageIndex], true);
const keyOf = (document: CompositionDocument, id: string) => [...buildDocumentIndex(document).entries.values()].find(entry => entry.node?.id === id)!;

/** The properties surface for a node (or a page) of `document`, kept live so an edit shows; `seen` hears every document the surface applies. */
function Surface({ document, target, seen, simulator }: { document: CompositionDocument; target: { kind: 'node'; id: string } | { kind: 'page'; id: string }; seen?: (next: CompositionDocument) => void; simulator?: { window: ReturnType<typeof duoWindow>; move: (next: ReturnType<typeof duoWindow>) => void } }) {
  return <SimulatorWindowContext.Provider value={simulator}><Project.Live document={document} seen={seen}>{ws => {
    const entry = target.kind === 'node' ? keyOf(ws.document!, target.id) : buildDocumentIndex(ws.document!).get(`page:${target.id}`)!;
    return <PropertiesPanel ws={{ ...ws, target: target.kind === 'node' ? { kind: 'node', key: entry.key, path: entry.path } : { kind: 'page', key: entry.key } } as never} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>;
  }}</Project.Live></SimulatorWindowContext.Provider>;
}
const select = () => screen.getByLabelText('Partly Folded') as HTMLSelectElement;

describe('the pure edits', () => {
  it('knows the top level of a page', () => {
    expect(isTopLevelPageComponent(['pages', 0, 'components', 2])).toBe(true);
    expect(isTopLevelPageComponent(['pages', 0, 'components', 2, 'children', 0])).toBe(false);
    expect(isTopLevelPageComponent(['modals', 0, 'components', 0])).toBe(false);
    expect(isTopLevelPageComponent(['pages', 0])).toBe(false);
  });
  it('writes and removes a side, leaving the width alone', () => {
    const path = ['pages', homeIndex, 'components', 1];
    const pinned = setFoldSide(home, path, 'trailing');
    expect(pinned.pages[homeIndex].components[1].layout).toEqual({ span: 1, foldSide: 'trailing' });
    expect(setFoldSide(pinned, path, undefined).pages[homeIndex].components[1].layout).toEqual({ span: 1 });
    expect(home.pages[homeIndex].components[1].layout).toEqual({ span: 1 });
  });
  it('turns the switch on and off', () => {
    const switched = on(home);
    expect(switched.pages[homeIndex].layout.foldSides).toBe('auto');
    expect('foldSides' in setPageSides(switched, ['pages', homeIndex], false).pages[homeIndex].layout).toBe(false);
  });
  it('names the side Automatic gives: the strip spans and the sections take turns, with the component\'s own word left out', () => {
    const document = setFoldSide(on(home), ['pages', homeIndex, 'components', 2], 'leading');
    const at = (index: number) => automaticSideAt(document, ['pages', homeIndex, 'components', index]);
    expect([at(0), at(1), at(2), at(3)]).toEqual(['span', 'leading', 'trailing', 'leading']);
    expect(automaticSideAt(document, ['pages', homeIndex, 'components', 3, 'children', 0])).toBeUndefined();
  });
  it('resets every side on the page in one document, and leaves the switch', () => {
    const pinned = setFoldSide(setFoldSide(on(home), ['pages', homeIndex, 'components', 1], 'trailing'), ['pages', homeIndex, 'components', 3], 'leading');
    expect(overrideCount(pinned.pages[homeIndex])).toBe(2);
    const reset = resetSides(pinned, ['pages', homeIndex]);
    expect(overrideCount(reset.pages[homeIndex])).toBe(0);
    expect(reset.pages[homeIndex].layout.foldSides).toBe('auto');
    expect(resetSides(reset, ['pages', homeIndex])).toBe(reset);
  });
  it('turns the switch on for every page that lacks it, once, in one document', () => {
    const some = on(home);
    expect(pagesWithoutSides(some)).not.toContain(homeIndex);
    const all = twoSidesOnEveryPage(some);
    expect(pagesWithoutSides(all)).toEqual([]);
    expect(all.pages.every(page => page.layout.foldSides === 'auto')).toBe(true);
    expect(twoSidesOnEveryPage(all).pages).toEqual(all.pages);
  });
  it('moves the simulator to the Duo partly folded with a vertical hinge', () => {
    const iPhone = previewWindows.find(item => item.name === 'iPhone')!;
    expect(partlyFoldedWindow(iPhone)).toEqual(duoWindow({ turn: 0, fold: 'partly' }));
    expect(partlyFoldedWindow(duoWindow({ turn: 180, fold: 'closed' }))).toEqual(duoWindow({ turn: 180, fold: 'partly' }));
    expect(partlyFoldedWindow(duoWindow({ turn: 90, fold: 'open' }))).toEqual(duoWindow({ turn: 0, fold: 'partly' }));
    expect(showsPartlyFolded(duoWindow({ turn: 0, fold: 'partly' }))).toBe(true);
    expect(showsPartlyFolded(duoWindow({ turn: 90, fold: 'partly' }))).toBe(false);
    expect(showsPartlyFolded(duoWindow({ turn: 0, fold: 'open' }))).toBe(false);
  });
  it('gives a new page no switch while the app has not shipped the id, so a publication is never refused for it', () => {
    expect(foldEdit.foldSidesShipped()).toBe(false);
    expect('foldSides' in blankPage(home, 'New').layout).toBe(false);
    // A copy of a first page that has the switch does not carry it over either.
    expect('foldSides' in blankPage(on(home), 'New').layout).toBe(false);
    const document = { ...home, pages: [...home.pages, blankPage(home, 'New')] } as CompositionDocument;
    expect(compileCompositionDocument(document).capabilities).not.toContain('sh.fold-sides@1');
  });
  it('gives a new page the switch once the id has shipped, and a new sheet none', () => {
    expect(blankPage(home, 'New', true).layout.foldSides).toBe('auto');
    vi.spyOn(foldEdit, 'foldSidesShipped').mockReturnValue(true);
    expect(blankPage(home, 'New').layout.foldSides).toBe('auto');
    expect('foldSides' in blankSheet(home, 'Sheet', 'fitted').layout).toBe(false);
    const document = { ...home, pages: [...home.pages, blankPage(home, 'New', true)], modals: [...home.modals, blankSheet(home, 'Sheet', 'fitted')] } as CompositionDocument;
    expect(() => compileCompositionDocument(document)).not.toThrow();
  });
});

describe('the component row', () => {
  const doc = on(home);
  it('reads "Automatic (Leading)" for the first section of an automatic page, with the caption', () => {
    render(<Surface document={doc} target={{ kind: 'node', id: 'hc-weather-summary' }}/>);
    expect(within(select()).getAllByRole('option').map(option => option.textContent)).toEqual(['Automatic (Leading)', 'Across the Top', 'Leading Side', 'Trailing Side']);
    expect(select().value).toBe('auto');
    expect(screen.getByText(SIDE_CAPTION, { exact: false })).toBeTruthy();
    expect(select().disabled).toBe(false);
  });
  it('reads "Automatic (Across the Top)" for the strip and "Automatic (Trailing)" for the next section', () => {
    render(<Surface document={doc} target={{ kind: 'node', id: 'hc-status-rail' }}/>);
    expect(within(select()).getAllByRole('option')[0].textContent).toBe('Automatic (Across the Top)');
    cleanup();
    render(<Surface document={doc} target={{ kind: 'node', id: 'hc-home-guests-visible' }}/>);
    expect(within(select()).getAllByRole('option')[0].textContent).toBe('Automatic (Trailing)');
  });
  it('writes the side the person picks and Automatic takes it off again', () => {
    const seen = vi.fn();
    render(<Surface document={doc} target={{ kind: 'node', id: 'hc-home-cameras' }} seen={seen}/>);
    fireEvent.change(select(), { target: { value: 'trailing' } });
    expect(seen).toHaveBeenCalledTimes(1);
    const next = seen.mock.calls[0][0] as CompositionDocument;
    expect(next.pages[homeIndex].components[3].layout).toEqual({ span: 1, foldSide: 'trailing' });
    expect(select().value).toBe('trailing');
    // The words of the other choices do not change with it; Automatic still says what it would give.
    expect(within(select()).getAllByRole('option')[0].textContent).toBe('Automatic (Leading)');
    fireEvent.change(select(), { target: { value: 'auto' } });
    expect((seen.mock.calls[1][0] as CompositionDocument).pages[homeIndex].components[3].layout).toEqual({ span: 1 });
  });
  it('is dimmed on a component that is not at the top of a page, and says why', () => {
    const grid = home.pages[homeIndex].components.find(item => item.type === 'section')!;
    const child = (grid as { children: { id: string }[] }).children[0];
    render(<Surface document={doc} target={{ kind: 'node', id: child.id }}/>);
    expect(select().disabled).toBe(true);
    expect(screen.getByText(NESTED_CAPTION)).toBeTruthy();
    expect(screen.queryByText(SIDE_CAPTION)).toBeNull();
    expect(NESTED_CAPTION).toBe('Only a page’s top-level sections take a side.');
  });
  it('says a bar pinned over the page takes none', () => {
    const pinned = structuredClone(doc);
    pinned.pages[homeIndex].components.push({ id: 'bar', title: 'Bar', type: 'pinned-actions', layout: { span: 1 }, props: { items: [] }, children: [] } as never);
    render(<Surface document={pinned} target={{ kind: 'node', id: 'bar' }}/>);
    expect(select().disabled).toBe(true);
    expect(screen.getByText(PINNED_CAPTION)).toBeTruthy();
  });
  it('offers Show Partly Folded while the simulator is in another pose, and moves it there', () => {
    const move = vi.fn();
    render(<Surface document={doc} target={{ kind: 'node', id: 'hc-weather-summary' }} simulator={{ window: duoWindow({ turn: 0, fold: 'open' }), move }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Show Partly Folded' }));
    expect(move).toHaveBeenCalledWith(duoWindow({ turn: 0, fold: 'partly' }));
  });
  it('offers it from the iPhone too, and not while the Duo already shows partly folded sideways', () => {
    render(<Surface document={doc} target={{ kind: 'node', id: 'hc-weather-summary' }} simulator={{ window: previewWindows[0], move: vi.fn() }}/>);
    expect(screen.getByRole('button', { name: 'Show Partly Folded' })).toBeTruthy();
    cleanup();
    render(<Surface document={doc} target={{ kind: 'node', id: 'hc-weather-summary' }} simulator={{ window: duoWindow({ turn: 0, fold: 'partly' }), move: vi.fn() }}/>);
    expect(screen.queryByRole('button', { name: 'Show Partly Folded' })).toBeNull();
  });
  it('shows the compiler\'s message under the row itself, not only in Checks', () => {
    const late = setFoldSide(on(home), ['pages', homeIndex, 'components', 2], 'span');
    render(<Surface document={late} target={{ kind: 'node', id: 'hc-home-guests-visible' }}/>);
    const message = document.querySelector('[data-field-problem$="/layout/foldSide"]');
    expect(message?.textContent).toMatch(/Across the Top has to come before the first section that takes a side/);
  });
  it('says plain "Automatic" on a page that would stay one column', () => {
    expect(automaticSideAt(home, ['pages', homeIndex, 'components', 1])).toBeUndefined();
    render(<Surface document={home} target={{ kind: 'node', id: 'hc-weather-summary' }}/>);
    expect(within(select()).getAllByRole('option')[0].textContent).toBe('Automatic');
  });
  it('shows the compiler\'s message on the row for Across the Top after a section', () => {
    const late = setFoldSide(on(home), ['pages', homeIndex, 'components', 2], 'span');
    const problem = runChecks(late).problems.find(row => row.fieldPath?.endsWith('/layout/foldSide'));
    expect(problem?.sentence).toMatch(/Across the Top has to come before the first section that takes a side/);
    let issue: { code: string; pointer: string } | undefined;
    try { compileCompositionDocument(late); } catch (error) { if (error instanceof CompositionValidationError) issue = error.issues[0]; }
    expect(issue).toMatchObject({ code: 'invalid_combination', pointer: `/document/pages/${homeIndex}/components/2/layout/foldSide` });
  });
});

describe('the page row', () => {
  it('is Two Sides or One Column and writes the switch', () => {
    const seen = vi.fn();
    render(<Surface document={home} target={{ kind: 'page', id: 'page-home' }} seen={seen}/>);
    expect(screen.getByText(SIDES_CAPTION, { exact: false })).toBeTruthy();
    const one = screen.getByRole('button', { name: 'One Column' }), two = screen.getByRole('button', { name: 'Two Sides' });
    expect(one.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(two);
    expect((seen.mock.calls[0][0] as CompositionDocument).pages[homeIndex].layout.foldSides).toBe('auto');
    expect(screen.getByRole('button', { name: 'Two Sides' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'One Column' }));
    expect('foldSides' in (seen.mock.calls[1][0] as CompositionDocument).pages[homeIndex].layout).toBe(false);
  });
  it('resets every side in one step, and is dimmed when there is none', () => {
    const seen = vi.fn();
    const pinned = setFoldSide(setFoldSide(on(home), ['pages', homeIndex, 'components', 1], 'trailing'), ['pages', homeIndex, 'components', 3], 'leading');
    render(<Surface document={pinned} target={{ kind: 'page', id: 'page-home' }} seen={seen}/>);
    const reset = screen.getByRole('button', { name: 'Reset Sides' }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(overrideCount((seen.mock.calls[0][0] as CompositionDocument).pages[homeIndex])).toBe(0);
    expect((screen.getByRole('button', { name: 'Reset Sides' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('says the app cannot show it yet, and does not offer "Use Two Sides on Every Page", while the id is pending', () => {
    render(<Surface document={home} target={{ kind: 'page', id: 'page-home' }}/>);
    expect(screen.getByText(WAITING_CAPTION, { exact: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use Two Sides on Every Page' })).toBeNull();
    cleanup();
    render(<Surface document={on(home)} target={{ kind: 'node', id: 'hc-weather-summary' }}/>);
    expect(screen.getByText(WAITING_CAPTION, { exact: false })).toBeTruthy();
  });
  it('offers "Use Two Sides on Every Page" once the id has shipped, once, as one change to every page', () => {
    vi.spyOn(foldEdit, 'foldSidesShipped').mockReturnValue(true);
    expect(screen.queryByText(WAITING_CAPTION)).toBeNull();
    const seen = vi.fn();
    render(<Surface document={home} target={{ kind: 'page', id: 'page-home' }} seen={seen}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Use Two Sides on Every Page' }));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(pagesWithoutSides(seen.mock.calls[0][0] as CompositionDocument)).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Use Two Sides on Every Page' })).toBeNull();
    // Remembered: it is not offered again, even to a page that lacks the switch.
    cleanup();
    render(<Surface document={home} target={{ kind: 'page', id: 'page-home' }}/>);
    expect(screen.queryByRole('button', { name: 'Use Two Sides on Every Page' })).toBeNull();
  });
  it('is not offered when every page already has the switch', () => {
    render(<Surface document={twoSidesOnEveryPage(home)} target={{ kind: 'page', id: 'page-home' }}/>);
    expect(screen.queryByRole('button', { name: 'Use Two Sides on Every Page' })).toBeNull();
  });
});
