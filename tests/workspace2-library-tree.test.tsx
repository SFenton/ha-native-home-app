// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';
import LibraryPanel from '../src/workspace2/LibraryPanel';
import { useLibrary } from '../src/workspace2/useLibrary';
import { useLibraryTrail } from '../src/workspace2/useLibraryTrail';
import type { Category } from '../src/workspace2/layout';
import { Project } from './support/workspace2-surfaces';
import { copyOf, voiceIssues } from './support/copy';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({})) }));

const home = homeDomains.document as unknown as CompositionDocument;
beforeEach(() => localStorage.clear());
afterEach(cleanup);

/** The panel on one rail item, over a workspace whose calls are spies; `keep` is what the flyout tier uses to keep the panel open. */
function Harness({ ws, category, tier = 'docked', keep = () => {}, mode = 'edit' }: { ws: Workspace2; category: Category; tier?: 'docked' | 'flyout'; keep?: (key: string) => void; mode?: 'edit' | 'use' }) {
  const stored = useLibrary(tier, 1440), trailApi = useLibraryTrail();
  const [current, setCurrent] = useState(category);
  const live = useMemo(() => ({ ...ws, mode }) as Workspace2, [ws, mode]);
  return <LibraryPanel ws={live} document={home} tier={tier} category={current} open shown library={{ ...stored, category: current, open: true }} trailApi={trailApi} onCategory={setCurrent} onKeepPanel={keep as never} onError={() => {}} onClose={() => {}}/>;
}
const stub = () => Project.workspace(home);
const rows = () => screen.getAllByRole('treeitem');
const titles = () => rows().map(row => row.querySelector('.w2-tree-title')?.textContent);
const row = (name: string) => rows().find(item => item.querySelector('.w2-tree-title')?.textContent === name)!;

describe('the root lists', () => {
  it('Tabs is a tree of the tab rows in order, each with a triangle, a More and a handle that moves it', () => {
    render(<Harness ws={stub()} category="tabs"/>);
    expect(titles()).toEqual(['Home', 'Security', 'Climate']);
    expect(rows().map(item => item.getAttribute('aria-level'))).toEqual(['1', '1', '1']);
    expect(rows().every(item => item.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(within(row('Home')).getByRole('button', { name: 'More for Home' })).toBeTruthy();
    expect(within(row('Home')).getByRole('button', { name: 'Move Home' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Tabs');
  });

  it('Sheets has no handle column, and the page on show is the current row', () => {
    render(<Harness ws={stub()} category="sheets"/>);
    expect(screen.queryAllByRole('button', { name: /^Move / })).toHaveLength(0);
    render(<Harness ws={stub()} category="tabs"/>);
    expect(row('Home').getAttribute('aria-current')).toBe('page');
    expect(row('Security').getAttribute('aria-current')).toBeNull();
  });

  it('keeps the DOM order of the rows the reading order of the screen: header, search, list, add', () => {
    const { container } = render(<Harness ws={stub()} category="tabs"/>);
    const order = ['.w2-lib-titles', 'input[type=search]', '[role=tree]', '.w2-lib-foot'].map(selector => container.querySelector(selector)!);
    for (let at = 1; at < order.length; at += 1) expect(order[at - 1].compareDocumentPosition(order[at]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('clicking a top-level row (the owner\'s G9 change)', () => {
  it('shows its surface and opens it in place to its first-level children only, without going in', () => {
    const ws = stub();
    render(<Harness ws={ws} category="tabs"/>);
    fireEvent.click(row('Home'));
    expect(ws.setSurface).toHaveBeenCalledWith({ kind: 'page', id: 'page-home' });
    expect(titles()).toEqual(['Home', 'Status', 'Weather', 'Conditional content', 'Cameras', 'Security', 'Climate']);
    expect(row('Status').getAttribute('aria-level')).toBe('2');
    expect(row('Home').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Tabs');
  });

  it('a second click on the one on show closes it again', () => {
    render(<Harness ws={stub()} category="tabs"/>);
    fireEvent.click(row('Home'));
    fireEvent.click(row('Home'));
    expect(titles()).toEqual(['Home', 'Security', 'Climate']);
  });

  it('the triangle opens and closes a row in place without showing the surface or selecting', () => {
    const ws = stub();
    render(<Harness ws={ws} category="tabs"/>);
    fireEvent.click(within(row('Security')).getByRole('button', { name: 'Show what is in Security' }));
    expect(row('Security').getAttribute('aria-expanded')).toBe('true');
    expect(ws.setSurface).not.toHaveBeenCalled();
    expect(ws.selectAnywhere).not.toHaveBeenCalled();
    fireEvent.click(within(row('Security')).getByRole('button', { name: 'Hide what is in Security' }));
    expect(row('Security').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('a child row goes into its level', () => {
  const into = (ws: Workspace2, keep = vi.fn(), tier: 'docked' | 'flyout' = 'docked') => {
    render(<Harness ws={ws} category="tabs" tier={tier} keep={keep}/>);
    fireEvent.click(row('Home'));
    fireEvent.click(row('Status'));
    return keep;
  };

  it('opens the child\'s level with Back, the path as the subtitle and the child selected for the inspector', () => {
    const ws = stub(), keep = into(ws);
    expect(ws.selectAnywhere).toHaveBeenCalledWith('node:hc-status-rail');
    expect(keep).toHaveBeenCalledWith('node:hc-status-rail');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Status');
    expect(screen.getByRole('button', { name: 'Back to Home' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Path' }).textContent).toContain('Tabs');
    expect(titles()).toEqual(['Lights', 'Security', 'Climate', 'Occupancy', 'Contact Sensors', 'Air Quality']);
  });

  it('tells the workspace to keep the panel, which is how the flyout stays in the panel while the child is selected', () => {
    const keep = into(stub(), vi.fn(), 'flyout');
    expect(keep).toHaveBeenCalledOnce();
    expect(screen.getByRole('complementary')).toBeTruthy();
  });

  it('Back steps out one level, to the surface\'s list with the surface still open', () => {
    into(stub());
    fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Tabs');
    expect(row('Home').getAttribute('aria-expanded')).toBe('true');
    expect(titles()).toContain('Status');
  });

  it('the first crumb returns to the root list', () => {
    into(stub());
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Path' })).getAllByRole('button')[0]);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Tabs');
    expect(titles()).toEqual(['Home', 'Status', 'Weather', 'Conditional content', 'Cameras', 'Security', 'Climate']);
  });

  it('a leaf child is selected in place and the level does not change', () => {
    const ws = stub();
    render(<Harness ws={ws} category="tabs"/>);
    fireEvent.click(row('Home'));
    fireEvent.click(row('Weather'));
    expect(ws.selectAnywhere).toHaveBeenCalledWith('node:hc-weather-summary');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Tabs');
  });
});

describe('the keyboard', () => {
  it('Right Arrow opens a closed row, then moves to its first child; Down and Up move between rows; Home and End reach the ends', () => {
    render(<Harness ws={stub()} category="tabs"/>);
    row('Home').focus();
    fireEvent.keyDown(row('Home'), { key: 'ArrowRight' });
    expect(row('Home').getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(row('Home'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(row('Status'));
    fireEvent.keyDown(row('Status'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row('Weather'));
    fireEvent.keyDown(row('Weather'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(row('Status'));
    fireEvent.keyDown(row('Status'), { key: 'End' });
    expect(document.activeElement).toBe(row('Climate'));
    fireEvent.keyDown(row('Climate'), { key: 'Home' });
    expect(document.activeElement).toBe(row('Home'));
  });

  it('Left Arrow closes an open row, and on a child goes to its parent', () => {
    render(<Harness ws={stub()} category="tabs"/>);
    fireEvent.click(row('Home'));
    row('Status').focus();
    fireEvent.keyDown(row('Status'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(row('Home'));
    fireEvent.keyDown(row('Home'), { key: 'ArrowLeft' });
    expect(row('Home').getAttribute('aria-expanded')).toBe('false');
  });

  it('Enter does what a click does', () => {
    const ws = stub();
    render(<Harness ws={ws} category="tabs"/>);
    row('Security').focus();
    fireEvent.keyDown(row('Security'), { key: 'Enter' });
    expect(ws.setSurface).toHaveBeenCalledWith({ kind: 'page', id: 'page-security' });
  });

  it('Enter on a tab\'s handle picks it up and the arrow keys move it, as one change on drop', () => {
    const apply = vi.fn(), ws = Project.workspace(home, undefined, {}, apply);
    render(<Harness ws={ws} category="tabs"/>);
    const grip = within(row('Home')).getByRole('button', { name: 'Move Home' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ' });
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    fireEvent.keyDown(grip, { key: ' ' });
    expect(apply).toHaveBeenCalledOnce();
    expect((apply.mock.calls[0][0] as CompositionDocument).navigation.tabs.map(tab => tab.id)).toEqual(['hc-tab-security', 'hc-tab-home', 'hc-tab-climate']);
  });
});

describe('searching and Use mode', () => {
  it('searching inside a level finds a nested row with its path, and choosing it selects it', () => {
    const ws = stub();
    render(<Harness ws={ws} category="tabs"/>);
    fireEvent.click(row('Home'));
    fireEvent.click(row('Status'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'air' } });
    expect(screen.getByRole('tree', { name: 'Results in Status' })).toBeTruthy();
    fireEvent.click(row('Air Quality'));
    expect(ws.selectAnywhere).toHaveBeenLastCalledWith('node:hc-chip-5');
  });

  it('says so when nothing matches', () => {
    render(<Harness ws={stub()} category="tabs"/>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No tabs match.')).toBeTruthy();
  });

  it('in Use the rows still show, the handles stay disabled, and More holds only Change List Icon…', async () => {
    render(<Harness ws={stub()} category="tabs" mode="use"/>);
    expect((within(row('Home')).getByRole('button', { name: 'Move Home' }) as HTMLButtonElement).disabled).toBe(true);
    const more = within(row('Home')).getByRole('button', { name: 'More for Home' }) as HTMLButtonElement;
    expect(more.disabled).toBe(false);
    fireEvent.click(more);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map(item => item.textContent)).toEqual(['Change List Icon…', 'Switch to Edit to change the rest.']);
    expect(items[1].getAttribute('aria-disabled')).toBe('true');
  });

  it('a right-click on a tab row opens its menu', async () => {
    render(<Harness ws={stub()} category="tabs"/>);
    fireEvent.contextMenu(row('Home'));
    expect((await screen.findAllByRole('menuitem')).map(item => item.textContent)).toContain('Tab Settings');
  });
});

describe('copy', () => {
  it('writes the words of a level, of a search and of an empty search to snapshots and holds them to the voice rules', async () => {
    const { container } = render(<Harness ws={stub()} category="tabs"/>);
    const panel = () => container.querySelector('[data-testid=library-panel]') ?? container;
    fireEvent.click(row('Home'));
    fireEvent.click(row('Status'));
    await expect(copyOf(panel())).toMatchFileSnapshot('./snapshots/copy/library-level.txt');
    const issues = [voiceIssues(panel())];
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'air' } });
    await expect(copyOf(panel())).toMatchFileSnapshot('./snapshots/copy/library-search.txt');
    issues.push(voiceIssues(panel()));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    await expect(copyOf(panel())).toMatchFileSnapshot('./snapshots/copy/library-level-empty.txt');
    issues.push(voiceIssues(panel()));
    expect(issues.flat()).toEqual([]);
  });
});
