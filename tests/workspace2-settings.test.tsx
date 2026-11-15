// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compilerIssues } from '../src/workspace2/checks';
import { PushStack } from '../src/workspace2/kit';
import SurfaceSettings from '../src/workspace2/navigation/PageSettings';
import { suggestPath } from '../src/workspace2/navigation/Links';
import { RowsProvider } from '../src/workspace2/rows';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
const base = homeDomains.document as unknown as CompositionDocument;

/** Renders the settings of one surface against a document the test can read back. */
function Harness({ kind, id, seen, initial = base }: { kind: 'page' | 'modal'; id: string; seen: (document: CompositionDocument) => void; initial?: CompositionDocument }) {
  const [document, setDocument] = useState(initial);
  const at = (kind === 'page' ? document.pages : document.modals).findIndex(item => item.id === id);
  const ws = { studio: { setError: vi.fn() } } as unknown as Workspace2;
  return <RowsProvider value={{ document, onChange: next => { seen(next); setDocument(next); }, onError: vi.fn() }}>
    <PushStack rootTitle="Settings" root={<SurfaceSettings ws={ws} kind={kind} path={[kind === 'page' ? 'pages' : 'modals', at]} onGo={vi.fn()}/>}/>
  </RowsProvider>;
}

describe('Page settings', () => {
  it('turns on opening pages beside this one, with its caption and empty-side text, and compiles', () => {
    let last = base;
    render(<Harness kind="page" id="page-home" seen={next => { last = next; }}/>);
    const split = screen.getByRole('switch', { name: 'Open pages beside this one' }) as HTMLInputElement;
    expect(split.checked).toBe(false);
    expect(screen.queryByText('Used when the window is wide enough for two.')).not.toBeNull();
    fireEvent.click(split);
    expect(last.pages.find(page => page.id === 'page-home')?.navigation).toMatchObject({ type: 'navigation-columns', standalone: false });
    expect(compilerIssues(last)).toEqual([]);
    expect(screen.getByLabelText('Empty side text')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Open pages beside this one' }));
    expect(last.pages.find(page => page.id === 'page-home')?.navigation).toEqual({ type: 'stack' });
  });

  it('keeps "Start with one pane" and "Start a new column set here" under Advanced, only for a columns page', () => {
    render(<Harness kind="page" id="page-home" seen={() => {}}/>);
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.queryByText('Start with one pane')).toBeNull();
    cleanup();
    const columns = { ...base, pages: base.pages.map(page => page.id === 'page-home' ? { ...page, navigation: { type: 'navigation-columns', placeholder: 'x', standalone: false } } : page) } as CompositionDocument;
    render(<Harness kind="page" id="page-home" seen={() => {}} initial={columns}/>);
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.getByText('Start with one pane')).toBeTruthy();
    expect(screen.getByText('Start a new column set here')).toBeTruthy();
  });

  it('counts the links that open from outside the app and lists what opens the page', () => {
    render(<Harness kind="page" id="page-home" seen={() => {}}/>);
    expect(screen.getByRole('button', { name: /Opens from outside the app/ }).textContent).toContain('0');
    const opened = screen.getByRole('region', { name: 'Opened from' });
    expect(within(opened).getByText('Home')).toBeTruthy();
  });
});

describe('Sheet settings', () => {
  it('disables "Open beside the list" with the reason while Full screen is on, and turns it off when Full screen goes on', () => {
    let last = base;
    render(<Harness kind="modal" id="hc-weather-sheet" seen={next => { last = next; }}/>);
    const beside = () => screen.getByRole('switch', { name: 'Open beside the list when there is room' }) as HTMLInputElement;
    fireEvent.click(beside());
    expect(last.modals.find(modal => modal.id === 'hc-weather-sheet')?.presentation.adaptive).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Full screen' }));
    const presentation = last.modals.find(modal => modal.id === 'hc-weather-sheet')!.presentation;
    expect(presentation).toMatchObject({ fullScreen: true, adaptive: false, height: { type: 'full' } });
    expect(compilerIssues(last)).toEqual([]);
    expect(beside().disabled).toBe(true);
    expect(screen.getByText('Not with Full screen.')).toBeTruthy();
  });

  it('leaves Full screen when the height goes back to Fitted', () => {
    let last = base;
    render(<Harness kind="modal" id="hc-weather-sheet" seen={next => { last = next; }}/>);
    fireEvent.click(screen.getByRole('switch', { name: 'Full screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fitted' }));
    expect(last.modals.find(modal => modal.id === 'hc-weather-sheet')?.presentation).toMatchObject({ fullScreen: false, height: { type: 'fitted' } });
    expect(compilerIssues(last)).toEqual([]);
  });
});

describe('links', () => {
  it('suggests a path from a page name that no link uses', () => {
    expect(suggestPath('Demo Room 1', new Set())).toBe('demo-room-1');
    expect(suggestPath('Home', new Set(['home']))).toBe('home-2');
    expect(suggestPath('2nd Floor', new Set())).toBe('page-2nd-floor');
    expect(suggestPath('!!!', new Set())).toMatch(/^page/);
  });
});
