// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex } from '../src/preview2/model';
import AddPicker from '../src/workspace2/add/AddPicker';
import ChecksPanel from '../src/workspace2/ChecksPanel';
import { runChecks } from '../src/workspace2/checks';
import { PushStack } from '../src/workspace2/kit';
import PagesPanel from '../src/workspace2/PagesPanel';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import { ConflictDialog, PublishDialog } from '../src/workspace2/PublishDialogs';
import TopBar from '../src/workspace2/TopBar';
import { DialogBody, dialogTitles, type DialogKey } from '../src/workspace2/projectDialogs';
import { CanvasState } from '../src/workspace2/Workspace2';
import { previewWindows } from '../src/workspace2/preview';
import { ToastHost } from '../src/workspace2/toasts';
import type { HaPublicationSummary } from '../src/ha-publication';
import { copyOf, voiceIssues } from './support/copy';
import { Project } from './support/workspace2-surfaces';
import homeDomains from './fixtures/home-domains.json';
import firstSlice from './fixtures/composition-first-slice.json';

vi.mock('../src/api', () => ({
  apiUrl: (path: string) => path,
  request: vi.fn(async (path: string) => path.endsWith('/assets') ? [] : { epoch: 'e', current: null, history: [], storedAssets: 0 }),
}));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });
const home = homeDomains.document as unknown as CompositionDocument;
const slice = (firstSlice as unknown as { document: CompositionDocument }).document;
const dir = './snapshots/copy';

/** Every surface's copy goes through here: it is written to a snapshot file and held to the voice rules. */
const surfaces: { name: string; text: string; issues: string[] }[] = [];
async function check(name: string, root: ParentNode) {
  const text = copyOf(root), issues = voiceIssues(root);
  surfaces.push({ name, text, issues });
  await expect(text).toMatchFileSnapshot(`${dir}/${name}.txt`);
}

describe('copy snapshots: the visible text of each surface (spec 10)', () => {
  it('the top bar, wide and narrow, with the Project menu', async () => {
    const wide = Project.workspace(home);
    const { container, unmount } = render(<ToastHost><TopBar ws={wide} narrow={false} window={previewWindows[0]} onWindow={() => {}} pagesOpen={false} onPagesOpen={() => {}} projectOpen={false} onProjectOpen={() => {}} dialog={undefined} onDialog={() => {}} onPanel={() => {}} onError={() => {}} onChecks={() => {}}/></ToastHost>);
    await check('top-bar-wide', container);
    unmount();
    const narrow = render(<ToastHost><TopBar ws={wide} narrow window={previewWindows[0]} onWindow={() => {}} pagesOpen={false} onPagesOpen={() => {}} projectOpen={false} onProjectOpen={() => {}} dialog={undefined} onDialog={() => {}} onPanel={() => {}} onError={() => {}} onChecks={() => {}}/></ToastHost>);
    await check('top-bar-narrow', narrow.container);
  });

  it('the Project menu, wide and as the narrow sheet list', async () => {
    const ws = Project.workspace(home);
    const noop = () => {};
    const props = { ws, window: previewWindows[0], onWindow: noop, onError: noop, onPanel: noop, open: false, onOpenChange: noop, dialog: undefined, onDialog: noop } as const;
    const { default: ProjectMenu } = await import('../src/workspace2/ProjectMenu');
    const wide = render(<ProjectMenu {...props} narrow={false}/>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Project' })); });
    wide.unmount();
    const open = render(<ProjectMenu {...props} narrow={false} open/>);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    await check('project-menu-wide', screen.getByRole('menu'));
    open.unmount();
    render(<ProjectMenu {...props} narrow open/>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Redo' })).toBeTruthy());
    await check('project-menu-narrow', document.querySelector('.w2-project-sheet')!);
  });

  it('the properties of every kind of node in the fixtures, with its Advanced page', async () => {
    const seen = new Set<string>(); let drawn = 0;
    for (const document of [home, slice]) {
      const index = buildDocumentIndex(document);
      for (const entry of index.entries.values()) {
        if (entry.kind !== 'node' || !entry.node || seen.has(entry.node.type)) continue;
        seen.add(entry.node.type);
        const ws = Project.workspace(document, { kind: 'node', key: entry.key, path: entry.path });
        const { container, unmount } = render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
        const advanced = container.querySelector<HTMLElement>('.w2-advanced-row');
        let text = copyOf(container);
        if (advanced) { await act(async () => { fireEvent.click(advanced); }); text += `\n[advanced]\n${copyOf(container)}`; }
        surfaces.push({ name: `properties-${entry.node.type}`, text, issues: voiceIssues(container) });
        await expect(text).toMatchFileSnapshot(`${dir}/properties-${entry.node.type}.txt`);
        unmount(); drawn++;
      }
    }
    expect(drawn).toBeGreaterThan(8);
  });

  it('page settings, sheet settings, Tabs, Header Buttons and Wallpaper', async () => {
    const index = buildDocumentIndex(home);
    const page = [...index.entries.values()].find(entry => entry.kind === 'page')!, sheet = [...index.entries.values()].find(entry => entry.kind === 'modal')!;
    for (const [name, target] of [['page-settings', { kind: 'page', key: page.key, path: page.path }], ['sheet-settings', { kind: 'modal', key: sheet.key, path: sheet.path }], ['tabs', { kind: 'tabs' }], ['header-buttons', { kind: 'header' }], ['wallpaper', { kind: 'wallpaper' }]] as const) {
      const ws = Project.workspace(home, target as never);
      const { container, unmount } = render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
      await waitFor(() => expect(container.querySelector('.w2-props-body')).not.toBeNull());
      await check(name, container);
      unmount();
    }
  });

  it('Pages, the Add picker and Checks', async () => {
    const ws = Project.workspace(home);
    const pages = render(<PushStack rootTitle="Pages" root={<PagesPanel ws={ws} document={home} current={{ kind: 'page', id: home.navigation.initialPageId }} onPick={() => {}} actions={{}}/>}/>);
    await check('pages', pages.container);
    pages.unmount();
    const destination = { owner: `page:${home.navigation.initialPageId}`, list: ['pages', 0, 'components'], index: 0 } as never;
    const add = render(<AddPicker document={home} destination={destination} onChoose={() => {}} onClose={() => {}}/>);
    await check('add-picker', add.container);
    add.unmount();
    const none = { problems: [], suggestions: [] } as ReturnType<typeof runChecks>;
    const broken = { ...home, navigation: { ...home.navigation, tabs: home.navigation.tabs.slice(0, 1) }, pages: [...home.pages, { ...home.pages[0], id: 'orphan', title: 'Orphan' }] } as CompositionDocument;
    for (const [name, checks, failure] of [['checks-empty', none, undefined], ['checks-rows', runChecks(broken), undefined], ['checks-save-failed', none, 'The draft changed.']] as const) {
      const rendered = render(<ChecksPanel checks={checks} saveFailure={failure} onRetry={() => {}} onPick={() => {}}/>);
      await check(name, rendered.container);
      rendered.unmount();
    }
  });

  it('the publish dialogs, in each phase, and the conflict dialog', async () => {
    const live: HaPublicationSummary = { epoch: 'e', current: { revision: 12, publishedAt: '2026-11-14T10:00:00Z', publishedBy: null, envelopeSha256: 'a'.repeat(64), capabilities: [] }, history: [], storedAssets: 0 };
    const cases: [string, Record<string, unknown>][] = [
      ['publish-confirm', { phase: 'confirm', publication: live, liveRevision: 12 }], ['publish-first', { phase: 'confirm' }], ['publish-publishing', { phase: 'publishing' }],
      ['publish-failed', { phase: 'failed', publishError: 'Home Assistant refused the publication.' }], ['publish-blocked', { phase: 'confirm', problemCount: 2 }],
    ];
    for (const [name, extra] of cases) {
      const { publication, ...rest } = extra as { publication?: HaPublicationSummary };
      const ws = Project.workspace(home, undefined, { publication, extra: rest });
      const { unmount } = render(<ToastHost><PublishDialog ws={ws}/></ToastHost>);
      await check(name, await screen.findByRole('dialog'));
      unmount();
    }
    const conflict = render(<ConflictDialog ws={Project.workspace(home, undefined, { extra: { studio: { conflict: true } } })}/>);
    await check('conflict', await screen.findByRole('dialog'));
    conflict.unmount();
  });

  it('the loading, sign-in and load-failed states', async () => {
    for (const [name, props] of [['state-loading', { loading: true, error: '' }], ['state-sign-in', { loading: false, error: 'Authentication required (401)' }], ['state-failed', { loading: false, error: 'The server is not answering.' }]] as const) {
      const rendered = render(<CanvasState {...props} onRetry={() => {}}/>);
      await check(name, rendered.container);
      rendered.unmount();
    }
  });

  const dialogs = Object.keys(dialogTitles).filter(key => key !== 'rename') as DialogKey[];
  for (const dialog of dialogs) it(`the ${dialog} dialog, with the rows it pushes`, async () => {
    const document = Project.withEverything(home);
    const publication: HaPublicationSummary = { epoch: 'e', current: { revision: 12, publishedAt: '2026-11-14T10:00:00Z', publishedBy: null, envelopeSha256: 'a'.repeat(64), capabilities: [] }, history: [{ revision: 11, publishedAt: '2026-11-13T10:00:00Z', publishedBy: null, envelopeSha256: 'b'.repeat(64), capabilities: [] }], storedAssets: 0 };
    const ws = Project.workspace(document, undefined, { publication, activity: [{ id: 3, text: 'Simulated light.turn_on' }, { id: 2, text: 'Saved' }, { id: 1, text: 'Published revision 12' }] });
    const { container } = render(<ToastHost><DialogBody dialog={dialog} ws={ws} close={() => {}} onError={() => {}}/></ToastHost>);
    await act(async () => { await Promise.resolve(); });
    let text = copyOf(container);
    const rows = container.querySelectorAll('[data-pushes]');
    if (rows.length) {
      await act(async () => { fireEvent.click(rows[0]); });
      text += `\n[first row]\n${copyOf(container)}`;
    }
    surfaces.push({ name: `dialog-${dialog}`, text, issues: voiceIssues(container) });
    await expect(text).toMatchFileSnapshot(`${dir}/dialog-${dialog}.txt`);
  });

  it('keeps every surface to the voice rules: sentence case labels, Title Case buttons, no dashes or AI-isms', () => {
    expect(surfaces.length).toBeGreaterThan(30);
    expect(surfaces.flatMap(surface => surface.issues.map(issue => `${surface.name}: ${issue}`))).toEqual([]);
  });

  it('says the preview note once, and only in Help', () => {
    const note = 'The preview approximates iOS. Taps are simulated and never reach your devices.';
    expect(surfaces.filter(surface => surface.text.includes(note)).map(surface => surface.name)).toEqual(['dialog-help']);
    expect(surfaces.filter(surface => /Native Home|1\.0 Editor|Open 1\.0/.test(surface.text))).toEqual([]);
  });
});
