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
import LinkedQuestion from '../src/workspace2/LinkedQuestion';
import { fieldTypeWords, LinkLossQuestion, type LinkLoss } from '../src/workspace2/LinkLossQuestion';
import { logicWords } from '../src/workspace2/data/logic/logicWords';
import SavedComponents from '../src/workspace2/SavedComponents';
import { componentReferences } from '../src/shared/composition/components';
import { newStateTile } from '../src/shared/composition/state-style-library';
import { replaceAt } from '../src/composition-editor';
import { endOf } from '../src/workspace2/add/insert';
import { insertPlace, saveAsComponent } from '../src/workspace2/linked';
import { setPerPlace } from '../src/workspace2/params';
import { resetTemplateFold } from '../src/workspace2/TemplateFold';
import { copyOf, voiceIssues } from './support/copy';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import firstSlice from './fixtures/composition-first-slice.json';

vi.mock('../src/api', () => ({
  apiUrl: (path: string) => path,
  fetchHaEntities: async () => [],
  fetchEntityAreas: async () => ({ areas: [], entities: [] }),
  request: vi.fn(async (path: string) => path.endsWith('/assets') ? [] : { epoch: 'e', current: null, history: [], storedAssets: 0 }),
}));

const document_body = () => window.document.body;
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
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
  it('the words held for the picture-with-regions Map: Picture, Region and Regions', async () => {
    const { container } = render(<ul><li>Picture</li><li>Region</li><li>Regions</li></ul>);
    await check('words-regions', container);
  });

  it('the top bar, wide and narrow, with the Project menu', async () => {
    const wide = Project.workspace(home);
    const { container, unmount } = render(<ToastHost><TopBar ws={wide} narrow={false} window={previewWindows[0]} onWindow={() => {}} pagesOpen={false} onPagesOpen={() => {}} projectOpen={false} onProjectOpen={() => {}} dialog={undefined} onDialog={() => {}} onPanel={() => {}} onError={() => {}} onChecks={() => {}} onGo={() => {}}/></ToastHost>);
    await check('top-bar-wide', container);
    unmount();
    const narrow = render(<ToastHost><TopBar ws={wide} narrow window={previewWindows[0]} onWindow={() => {}} pagesOpen={false} onPagesOpen={() => {}} projectOpen={false} onProjectOpen={() => {}} dialog={undefined} onDialog={() => {}} onPanel={() => {}} onError={() => {}} onChecks={() => {}} onGo={() => {}}/></ToastHost>);
    await check('top-bar-narrow', narrow.container);
  });

  it('the phone bars: the status line, the Project sheet\'s first row and the bottom bar, saved, with problems and in Use', async () => {
    const { PhoneBottomBar, PhoneTopBar } = await import('../src/workspace2/phone/PhoneBars');
    const topProps = { window: previewWindows[0], onWindow: () => {}, pagesOpen: false, onPagesOpen: () => {}, projectOpen: false, onProjectOpen: () => {}, dialog: undefined, onDialog: () => {}, onPanel: () => {}, onError: () => {}, onChecks: () => {}, onGo: () => {}, narrow: true } as const;
    const parts: [string, React.ReactNode][] = [
      ['top bar', <PhoneTopBar ws={Project.workspace(home)} {...topProps}/>],
      ['top bar, two problems', <PhoneTopBar ws={Project.workspace(home, undefined, { extra: { problemCount: 2 } })} {...topProps}/>],
      ['top bar, not saved', <PhoneTopBar ws={Project.workspace(home, undefined, { extra: { status: { text: 'Not Saved', tone: 'error' } } })} {...topProps}/>],
      ['bottom bar', <PhoneBottomBar ws={Project.workspace(home)} onThisPage={() => {}}/>],
      ['bottom bar, Use', <PhoneBottomBar ws={Project.workspace(home, undefined, { extra: { mode: 'use' } })} onThisPage={() => {}}/>],
    ];
    let text = '', issues: string[] = [];
    for (const [name, body] of parts) {
      const view = render(<ToastHost>{body}</ToastHost>);
      text += `${text ? '\n' : ''}[${name}]\n${copyOf(view.container)}`;
      issues = issues.concat(voiceIssues(view.container));
      view.unmount();
    }
    surfaces.push({ name: 'phone-bars', text, issues });
    await expect(text).toMatchFileSnapshot(`${dir}/phone-bars.txt`);
  });

  it('This Page on a phone, at the root and one level down', async () => {
    const { default: LevelSheet } = await import('../src/workspace2/phone/LevelSheet');
    const ws = Project.workspace(home);
    render(<ToastHost><LevelSheet ws={ws} open onOpenChange={() => {}} onError={() => {}}/></ToastHost>);
    const sheet = await screen.findByTestId('level-sheet');
    await check('this-page-root', sheet);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Conditional content/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Guests Staying Over/ })); });
    await check('this-page-level', screen.getByTestId('level-sheet'));
  });

  it('the Project menu, wide and as the narrow sheet list', async () => {
    const ws = Project.workspace(home);
    const noop = () => {};
    const props = { ws, window: previewWindows[0], onWindow: noop, onError: noop, onPanel: noop, onGo: noop, open: false, onOpenChange: noop, dialog: undefined, onDialog: noop } as const;
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
        // The voice rules hold the fold itself; a picker's face above it shows a value (an icon's name), not a button's words.
        surfaces.push({ name: `properties-${entry.node.type}`, text, issues: voiceIssues(container.querySelector('.w2-advanced-body') ?? container) });
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

  it('a placed template: its settings and closed row, the open row with Set Per Place, the phone Add sheet\'s Templates, and the edit question', async () => {
    resetTemplateFold();
    // A template of two state tiles (invented entities), placed twice; the first field set per place.
    const base = structuredClone(slice) as unknown as { pages: { id: string; components: unknown[] }[] } & CompositionDocument;
    const lamp = (id: string) => ({ ...newStateTile('switch.demo_lamp', id, undefined, undefined)!, id, title: id.replace(/(^|-)([a-z])/g, (_, dash: string, letter: string) => `${dash ? ' ' : ''}${letter.toUpperCase()}`) });
    base.pages[2].components = [{ id: 'demo-row', title: 'Demo Row', type: 'section', layout: { span: 1 }, props: { header: 'S', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children: [lamp('demo-first'), lamp('demo-second')] }];
    const saved = saveAsComponent(base, ['pages', 2, 'components', 0], 'Lamp Row');
    const entry = saved.document.componentLibrary![0];
    const placed = insertPlace(saved.document, entry.id, endOf(saved.document, `page:${base.pages[2].id}`)!).document;
    const set = setPerPlace(placed, entry.id, (entry.node as unknown as { children: { id: string }[] }).children[0].id, 'binding/entityId');
    // The places' ids are made at random: fixed ones keep the snapshots the same on every run.
    const renamed = replaceAt(set, ['componentLibrary', 0, 'node', 'id'], 'demo-body');
    const document = componentReferences(renamed).reduce((current, use, at) => replaceAt(current, use.path, { ...use.ref, id: `demo-place-${at + 1}` }), renamed);
    const root = 'demo-place-1';
    const linked = { session: undefined, say: () => {} };
    const place = (key: string) => { const found = buildDocumentIndex(document).get(key as never)!; return Project.workspace(document, { kind: 'node', key: found.key, path: found.path } as never, { extra: { linked } as never }); };
    const closed = render(<PropertiesPanel ws={place(`node:${root}`)} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
    await check('template-place', closed.container);
    await act(async () => { fireEvent.click(closed.container.querySelector<HTMLElement>('.w2-template-row')!); });
    await check('template-fold', closed.container);
    closed.unmount();
    const inner = render(<PropertiesPanel ws={place(`node:${root}~${(entry.node as unknown as { children: { id: string }[] }).children[1].id}`)} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
    // The tile's own fields are held to the voice by their own snapshot; this one holds the banner, the Parameters and the per-place line.
    const perPlaceText = copyOf(inner.container);
    surfaces.push({ name: 'template-per-place', text: perPlaceText, issues: [inner.container.querySelector('[data-testid="linked-line"]'), inner.container.querySelector('[data-testid="component-parameters"]'), inner.container.querySelector('[data-testid="per-place-line"]')].flatMap(part => part ? voiceIssues(part) : []) });
    await expect(perPlaceText).toMatchFileSnapshot(`${dir}/template-per-place.txt`);
    inner.unmount();
    const group = render(<SavedComponents ws={place(`node:${root}`)} query="" disabled={false}/>);
    await check('template-group', group.container);
    group.unmount();
    const destination = { owner: `page:${document.navigation.initialPageId}`, list: ['pages', 0, 'components'], index: 0 } as never;
    const sheet = render(<AddPicker document={document} destination={destination} onChoose={() => {}} onClose={() => {}} templates={query => <SavedComponents ws={place(`node:${root}`)} query={query} disabled={false} onAdd={() => {}}/>}/>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Templates' })); });
    await check('add-picker-templates', sheet.container);
    sheet.unmount();
    const question = { name: 'Light Button', places: ['Home', 'Kitchen', 'Office', 'Hall'], count: 4, step: 'ask' as const, suggested: 'Light Button 2', taken: () => false };
    const gate = { question, update: () => {}, toName: () => {}, cancel: () => {}, saveNew: () => {} } as never;
    const ask = render(<LinkedQuestion gate={gate}/>);
    await check('template-question', document_body());
    ask.unmount();
    const named = render(<LinkedQuestion gate={{ question: { ...question, step: 'name' }, update: () => {}, toName: () => {}, cancel: () => {}, saveNew: () => {} } as never}/>);
    await check('template-question-name', document_body());
    named.unmount();
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

  it('the States group and the State Styles pages', async () => {
    const { addStateTile, newStateTile } = await import('../src/shared/composition/state-style-library');
    const { builtInStyle } = await import('../src/shared/composition/state-styles');
    const { RowsProvider } = await import('../src/workspace2/rows');
    const { StylesPanel } = await import('../src/workspace2/styles/StylesPanel');
    const { StylePage } = await import('../src/workspace2/styles/StylePage');
    const { RulePage } = await import('../src/workspace2/styles/RulePage');
    const { RequestPage } = await import('../src/workspace2/styles/RequestPage');
    const { NewFromEntity } = await import('../src/workspace2/styles/NewFromEntity');
    const tile = { ...newStateTile('lock.demo_front', 'Front lock', undefined, undefined)!, id: 'demo-front-lock' };
    const saved = { ...builtInStyle('lock')!, id: 'house-lock', name: 'House lock', base: 'lock' as const };
    const document = { ...addStateTile(home, home.pages[0].id, { ...tile, binding: { ...tile.binding, styleId: 'house-lock', overrides: [{ state: 'locked', text: 'Secured' }] } }), stateStyles: { type: 'state-styles@1' as const, styles: [saved] } } as CompositionDocument;
    const entry = buildDocumentIndex(document).entries.get('node:demo-front-lock')!;
    const ws = Project.workspace(document, { kind: 'node', key: entry.key, path: entry.path });
    const panel = render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
    let text = copyOf(panel.container);
    const advanced = panel.container.querySelector<HTMLElement>('.w2-advanced-row');
    if (advanced) { await act(async () => { fireEvent.click(advanced); }); text += `\n[advanced]\n${copyOf(panel.container)}`; }
    surfaces.push({ name: 'properties-state-tile', text, issues: voiceIssues(panel.container.querySelector('.w2-advanced-body') ?? panel.container) });
    await expect(text).toMatchFileSnapshot(`${dir}/properties-state-tile.txt`);
    panel.unmount();
    const pages: [string, React.ReactNode][] = [
      ['state-styles', <StylesPanel/>], ['state-style', <StylePage id="house-lock"/>], ['state-style-built-in', <StylePage id="lock"/>],
      ['state-style-state', <RulePage id="house-lock" index={4}/>], ['state-style-request', <RequestPage id="house-lock"/>], ['state-style-new', <NewFromEntity/>],
    ];
    for (const [name, body] of pages) {
      const view = render(<RowsProvider value={{ document, onChange: () => {}, onError: () => {} }}><PushStack rootTitle="State Styles" root={body}/></RowsProvider>);
      await check(name, view.container);
      view.unmount();
    }
  });

  it('Swipe to Adjust and State Words: the row, its page in each state, and the open fold', async () => {
    const { tilecontractStory } = await import('../src/preview2/fixtures/tilecontract-story');
    const { RowsProvider } = await import('../src/workspace2/rows');
    const { default: SwipePage } = await import('../src/workspace2/layout/SwipePage');
    const document = tilecontractStory().document;
    const entry = (id: string) => buildDocumentIndex(document).entries.get(`node:${id}` as never)!;
    // The row of each state: off (a plain light), on (a light, a cover) and the fold closed, then open.
    for (const [name, id] of [['swipe-row-off', 'tc-light-plain'], ['swipe-row-light', 'tc-light-swipe'], ['swipe-row-cover', 'tc-cover']] as const) {
      const ws = Project.workspace(document, { kind: 'node', key: entry(id).key, path: entry(id).path });
      const view = render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
      await expect(copyOf(view.container)).toMatchFileSnapshot(`${dir}/${name}.txt`);
      view.unmount();
    }
    const words = Project.workspace(document, { kind: 'node', key: entry('tc-w2-lamp').key, path: entry('tc-w2-lamp').path });
    const panel = render(<PropertiesPanel ws={words} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
    await expect(copyOf(panel.container)).toMatchFileSnapshot(`${dir}/state-words-closed.txt`);
    await act(async () => { fireEvent.click(panel.container.querySelector<HTMLElement>('.w2-disclosure-head[aria-expanded="false"]')!.closest('[data-disclosure$="props/words"]')!.querySelector('button')!); });
    await expect(copyOf(panel.container)).toMatchFileSnapshot(`${dir}/state-words-open.txt`);
    panel.unmount();
    // Group by State: the row, and its page off, on, and full.
    {
      const { default: GroupsPage } = await import('../src/workspace2/layout/GroupsPage');
      const grouped = (id: string) => { const copy = structuredClone(document) as CompositionDocument; const grid = buildDocumentIndex(copy).entries.get(`node:${id}` as never)!.node as { props: Record<string, unknown> }; return { copy, grid }; };
      const row = Project.workspace(document, { kind: 'node', key: entry('tc-groups-grid').key, path: entry('tc-groups-grid').path });
      const rowView = render(<PropertiesPanel ws={row} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
      await expect(copyOf(rowView.container)).toMatchFileSnapshot(`${dir}/groups-row-on.txt`);
      rowView.unmount();
      const off = grouped('tc-groups-grid'); delete off.grid.props.groups;
      const full = grouped('tc-groups-grid'); full.grid.props.groups = { by: 'state', items: [{ id: 'a', title: 'On', states: ['active'] }, { id: 'b', title: 'Off', states: ['idle'] }, { id: 'c', title: 'Unavailable', states: ['unavailable'] }] };
      for (const [name, doc] of [['groups-page-on', document], ['groups-page-off', off.copy], ['groups-page-full', full.copy]] as const) {
        const target = buildDocumentIndex(doc).entries.get('node:tc-groups-grid' as never)!;
        const view = render(<RowsProvider value={{ document: doc, onChange: () => {}, onError: () => {} }}><PushStack rootTitle="Group by State" root={<GroupsPage path={target.path as never}/>}/></RowsProvider>);
        await expect(copyOf(view.container)).toMatchFileSnapshot(`${dir}/${name}.txt`);
        view.unmount();
      }
    }
    for (const [name, id] of [['swipe-page-off', 'tc-light-plain'], ['swipe-page-light', 'tc-light-swipe'], ['swipe-page-cover', 'tc-cover'], ['swipe-page-climate', 'tc-climate'], ['swipe-page-dead', 'tc-light-dead']] as const) {
      if (!entry(id)) continue;
      const view = render(<RowsProvider value={{ document, onChange: () => {}, onError: () => {} }}><PushStack rootTitle="Swipe to Adjust" root={<SwipePage path={entry(id).path as never}/>}/></RowsProvider>);
      await check(name, view.container);
      view.unmount();
    }
  });

  it('the questions before a change removes linked values: Remove Setting and a type change, one and many', async () => {
    const asks: [string, LinkLoss][] = [
      ['remove-setting', { title: logicWords.removeSettingTitle('Source'), text: logicWords.removeSettingText(1), confirm: logicWords.removeSetting }],
      ['remove-setting', { title: logicWords.removeSettingTitle('Source'), text: logicWords.removeSettingText(3), confirm: logicWords.removeSetting }],
      ['change-type', { title: fieldTypeWords.title('Tile', 'Text'), text: fieldTypeWords.text(1, 0, 'Text'), confirm: fieldTypeWords.confirm }],
      ['change-type', { title: fieldTypeWords.title('Tile', 'Text'), text: fieldTypeWords.text(0, 1, 'Text'), confirm: fieldTypeWords.confirm }],
      ['change-type', { title: fieldTypeWords.title('Tile', 'Text'), text: fieldTypeWords.text(1, 1, 'Text'), confirm: fieldTypeWords.confirm }],
      ['change-type', { title: fieldTypeWords.title('', 'Text'), text: fieldTypeWords.text(3, 2, 'Text'), confirm: fieldTypeWords.confirm }],
    ];
    for (const name of ['remove-setting', 'change-type']) {
      let text = '';
      const issues: string[] = [];
      for (const [, asking] of asks.filter(([key]) => key === name)) {
        const view = render(<LinkLossQuestion asking={asking} onCancel={() => {}} onConfirm={() => {}}/>);
        const question = await screen.findByTestId('link-loss-question');
        text += `${text ? '\n' : ''}${copyOf(question)}`; issues.push(...voiceIssues(question));
        view.unmount();
      }
      surfaces.push({ name: `link-loss-${name}`, text, issues });
      await expect(text).toMatchFileSnapshot(`${dir}/link-loss-${name}.txt`);
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

describe('deeper icon fields', () => {
  it('read "Icon" in every node kind that nests one, never a free "Name" field', async () => {
    const { readFileSync } = await import('node:fs');
    for (const name of ['status-chip', 'alarm-panel', 'door-tile', 'room-overview-tile']) {
      const lines = readFileSync(`tests/snapshots/copy/properties-${name}.txt`, 'utf8').split('\n');
      expect(lines, name).toContain('Icon');
      expect(lines, name).not.toContain('Name');
    }
  });
});
