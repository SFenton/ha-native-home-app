// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { APPEARANCE_KEY, appearanceWords, parseAppearance, readAppearance, reloadAppearance, setAppearance } from '../src/workspace2/appearance';
import { AppearancePage } from '../src/workspace2/AppearanceChoices';
import { deriveTheme } from '../src/workspace2/theme';
import { useStudioTheme } from '../src/workspace2/useStudioTheme';
import { previewWindows } from '../src/workspace2/preview';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({ epoch: 'e', current: null, history: [], storedAssets: 0 })) }));
const home = homeDomains.document as unknown as CompositionDocument;

beforeEach(() => { localStorage.clear(); reloadAppearance(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** A system that prefers `dark` or not. */
const system = (dark: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-color-scheme: dark') ? dark : false, addEventListener() {}, removeEventListener() {}, media: query }));
function Probe() { const theme = useStudioTheme(true); return <output data-testid="theme" data-dark={String(theme.dark)}>{theme.variables['--w2-card']}</output>; }

describe('pick 8: Studio Appearance', () => {
  it('stores follow, light or dark, and treats anything else as follow', () => {
    expect(parseAppearance('dark')).toBe('dark');
    expect(parseAppearance('light')).toBe('light');
    expect(parseAppearance('follow')).toBe('follow');
    expect(parseAppearance('sepia')).toBe('follow');
    expect(parseAppearance(null)).toBe('follow');
    localStorage.setItem(APPEARANCE_KEY, 'neon');
    expect(readAppearance()).toBe('follow');
    setAppearance('dark');
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark');
  });

  it('words the follow choice by where the Studio runs', () => {
    expect(appearanceWords('follow', false)).toBe('Follow System');
    expect(appearanceWords('follow', true)).toBe('Follow Home Assistant');
    expect(appearanceWords('light', true)).toBe('Light');
    expect(appearanceWords('dark', false)).toBe('Dark');
    // Outside a frame the Studio cannot read a theme, so a stored follow reads "Follow System".
    expect(appearanceWords('follow')).toBe('Follow System');
  });

  it('follows the system by default, and Light and Dark ignore it', () => {
    system(true);
    const { unmount } = render(<Probe/>);
    expect(screen.getByTestId('theme').dataset.dark).toBe('true');
    unmount();
    system(false);
    const light = render(<Probe/>);
    expect(screen.getByTestId('theme').dataset.dark).toBe('false');
    expect(screen.getByTestId('theme').textContent).toBe(deriveTheme({}, false).variables['--w2-card']);
    act(() => setAppearance('dark'));
    expect(screen.getByTestId('theme').dataset.dark).toBe('true');
    expect(screen.getByTestId('theme').textContent).toBe(deriveTheme({}, true).variables['--w2-card']);
    light.unmount();
    system(true);
    render(<Probe/>);
    act(() => setAppearance('light'));
    expect(screen.getByTestId('theme').dataset.dark).toBe('false');
  });

  it('is read before the first paint: a stored dark is dark on the first render', () => {
    localStorage.setItem(APPEARANCE_KEY, 'dark'); reloadAppearance();
    system(false);
    const seen: string[] = [];
    function First() { const theme = useStudioTheme(true); seen.push(String(theme.dark)); return null; }
    render(<First/>);
    expect(seen[0]).toBe('true');
    expect(new Set(seen)).toEqual(new Set(['true']));
  });

  it('draws three radio rows on the narrow page, checking the current one, and remembers a choice', () => {
    render(<AppearancePage/>);
    const rows = screen.getAllByRole('radio');
    expect(rows.map(row => row.textContent)).toEqual(['Follow System', 'Light', 'Dark']);
    expect(rows[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(rows[2]);
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
  });

  it('is the first row of the wide Project menu, above Tabs, with the current choice, and opens a submenu of three', async () => {
    const ws = Project.workspace(home);
    const noop = () => {};
    const { default: ProjectMenu } = await import('../src/workspace2/ProjectMenu');
    render(<ProjectMenu ws={ws} narrow={false} window={previewWindows[0]} onWindow={noop} onError={noop} onPanel={noop} onGo={noop} open onOpenChange={noop} dialog={undefined} onDialog={noop}/>);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    const items = (await screen.findAllByRole('menuitem')).map(item => item.textContent);
    const at = items.findIndex(text => text?.startsWith('Studio Appearance'));
    expect(items[at]).toBe('Studio AppearanceFollow System');
    expect(items[at + 1]).toBe('Tabs');
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Studio Appearance/ })); });
    const radios = await screen.findAllByRole('menuitemradio');
    expect(radios.map(radio => radio.textContent)).toEqual(['Follow System', 'Light', 'Dark']);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    await act(async () => { fireEvent.click(radios[1]); });
    await waitFor(() => expect(localStorage.getItem(APPEARANCE_KEY)).toBe('light'));
  });
});
