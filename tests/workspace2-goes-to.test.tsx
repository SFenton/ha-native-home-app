// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { valueAt, type EditorPath } from '../src/composition-editor';
import { PushStack } from '../src/workspace2/kit';
import { RowsProvider, schemaAt } from '../src/workspace2/rows';
import { ActionRow } from '../src/workspace2/editors/ActionEditor';
import { goesToChoices, goesToTitle, goesToValue, parseGoesTo, showTarget } from '../src/workspace2/editors/goesTo';
import { SurfaceActionsContext } from '../src/workspace2/editors/surfaceActions';
import { summarize } from '../src/workspace2/rows';
import type { NavSurface } from '../src/preview2/navigation';

afterEach(cleanup);

type J = Record<string, any>;
const push = (pageId: string): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const tile = (id: string, action: J): J => ({
  id, type: 'navigation-tile', title: id, icon: { type: 'sf-symbol', name: 'info.circle', rendering: 'canonical', unavailable: 'fallback' }, layout: { span: 1 },
  props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: 'Open' } }, action,
});
const level = (document: J, id: string, title: string): J => {
  const { navigation: _navigation, ...surface } = structuredClone(document.pages[2]);
  return { ...surface, id, title, toolbar: { type: 'replace', groups: [] }, components: [{ ...surface.components[0], id: `${id}_text` }] };
};

/**
 * The first-slice document with two sheets: Palette (levels Demo Level A, which opens Demo Level B) and Gallery (level Demo Level G), a level Demo Level C no sheet reaches, a full-screen
 * modal Demo Modal, and a tile on a page, in Palette, in Gallery and in Demo Level A that each push somewhere.
 */
function fixture(): { document: CompositionDocument; paths: Record<'page' | 'palette' | 'gallery' | 'levelA', EditorPath> } {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  document.levels = [level(document, 'demo_level_a', 'Demo Level A'), level(document, 'demo_level_b', 'Demo Level B'), level(document, 'demo_level_g', 'Demo Level G'), level(document, 'demo_level_c', 'Demo Level C')];
  document.levels[0].components.push(tile('demo_in_a', push('demo_level_b')));
  const gallery = structuredClone(document.modals[0]);
  gallery.id = 'demo_gallery'; gallery.title = 'Gallery'; gallery.components = [tile('demo_in_gallery', push('demo_level_g'))];
  const modal = structuredClone(document.modals[0]);
  modal.id = 'demo_modal'; modal.title = 'Demo Modal'; modal.presentation.fullScreen = true; modal.components = [];
  document.modals[0].components = [tile('demo_in_palette', push('demo_level_a'))];
  document.modals.push(gallery, modal);
  document.pages[0].components = [tile('demo_on_page', push('page-echo'))];
  return { document: document as CompositionDocument, paths: { page: ['pages', 0, 'components', 0, 'action'], palette: ['modals', 0, 'components', 0, 'action'], gallery: ['modals', 1, 'components', 0, 'action'], levelA: ['levels', 0, 'components', 1, 'action'] } };
}

/** The "When tapped" row for the action at `path`, with the document live so each Done shows in the next render. */
function Surface({ document: first, path, current, shown, applied }: { document: CompositionDocument; path: EditorPath; current?: NavSurface; shown?: NavSurface[]; applied?: CompositionDocument[] }) {
  const [document, setDocument] = useState(first);
  return <SurfaceActionsContext.Provider value={shown ? { current, show: surface => shown.push(surface) } : undefined}>
    <RowsProvider value={{ document, onChange: next => { applied?.push(next); setDocument(next); }, onError: () => {} }}>
      <PushStack rootTitle="Tile" root={<>
        <ActionRow label="When tapped" path={path} schema={schemaAt(document, path)} optional itemName="Tile"/>
        <output data-testid="doc">{JSON.stringify(valueAt(document, path))}</output>
      </>}/>
    </RowsProvider>
  </SurfaceActionsContext.Provider>;
}
const saved = () => JSON.parse(screen.getByTestId('doc').textContent!);
const open = () => { fireEvent.click(screen.getByRole('button', { name: /When tapped/ })); fireEvent.click(screen.getByRole('button', { name: 'Goes to' })); };
const groupsShown = () => screen.getAllByRole('group').filter(group => group.classList.contains('w2-choice-group')).map(group => [group.getAttribute('aria-label'), within(group).getAllByRole('option').map(option => option.textContent)]);

describe('the Goes to choices', () => {
  const { document, paths } = fixture();

  it('a tile on a page offers Pages, Sheets and Modals, and no Levels', () => {
    expect(goesToChoices(document, paths.page).map(choice => [choice.group, choice.label])).toEqual([
      ['Pages', 'Canvas'], ['Pages', 'Shelf'], ['Pages', 'Sample Detail'], ['Sheets', 'Palette'], ['Sheets', 'Gallery'], ['Modals', 'Demo Modal'],
    ]);
  });

  it('a tile in a sheet offers that sheet\'s levels and the levels no sheet reaches, never another sheet\'s', () => {
    expect(goesToChoices(document, paths.palette).filter(choice => choice.group === 'Levels').map(choice => choice.label)).toEqual(['Demo Level A', 'Demo Level B', 'Demo Level C']);
    expect(goesToChoices(document, paths.gallery).filter(choice => choice.group === 'Levels').map(choice => choice.label)).toEqual(['Demo Level G', 'Demo Level C']);
  });

  it('a tile in a level offers the levels of the sheet that holds it', () => {
    expect(goesToChoices(document, paths.levelA).filter(choice => choice.group === 'Levels').map(choice => choice.label)).toEqual(['Demo Level A', 'Demo Level B', 'Demo Level C']);
  });

  it('the groups come in the order Pages, Levels, Sheets, Modals', () => {
    expect([...new Set(goesToChoices(document, paths.palette).map(choice => choice.group))]).toEqual(['Pages', 'Levels', 'Sheets', 'Modals']);
  });

  it('keeps a level a page link names, so a wrong link still shows where it goes', () => {
    const wrong = structuredClone(document) as CompositionDocument;
    (wrong.pages[0].components[0] as J).action = push('demo_level_g');
    const value = goesToValue(wrong, (wrong.pages[0].components[0] as J).action);
    expect(value).toBe('level:demo_level_g');
    expect(goesToChoices(wrong, paths.page, value).filter(choice => choice.group === 'Levels').map(choice => choice.label)).toEqual(['Demo Level G']);
  });

  it('names the value of a push, a present and an empty action, and parses it back', () => {
    expect(goesToValue(document, push('page-echo'))).toBe('page:page-echo');
    expect(goesToValue(document, push('demo_level_a'))).toBe('level:demo_level_a');
    expect(goesToValue(document, { type: 'present', modalId: 'demo_gallery' })).toBe('modal:demo_gallery');
    expect(goesToValue(document, undefined)).toBe('');
    expect(goesToValue(document, { type: 'back' })).toBe('');
    expect(parseGoesTo('modal:demo_gallery')).toEqual({ kind: 'modal', target: 'demo_gallery' });
  });
});

describe('the Goes to row', () => {
  it('lists the four groups under their headings for a tile inside a sheet', () => {
    const { document, paths } = fixture();
    render(<Surface document={document} path={paths.palette}/>);
    open();
    expect(groupsShown()).toEqual([
      ['Pages', ['Canvas', 'Shelf', 'Sample Detail']], ['Levels', ['Demo Level A', 'Demo Level B', 'Demo Level C']], ['Sheets', ['Palette', 'Gallery']], ['Modals', ['Demo Modal']],
    ]);
  });

  it('lists three groups, with no Levels, for a tile on a page', () => {
    const { document, paths } = fixture();
    render(<Surface document={document} path={paths.page}/>);
    open();
    expect(groupsShown().map(([name]) => name)).toEqual(['Pages', 'Sheets', 'Modals']);
  });

  it('picks a level as a push, and says it stays in the sheet', () => {
    const { document, paths } = fixture();
    render(<Surface document={document} path={paths.palette}/>);
    open();
    fireEvent.click(screen.getByRole('option', { name: 'Demo Level B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(saved()).toMatchObject({ type: 'push', pageId: 'demo_level_b' });
    fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));
    expect(document.levels).toBeDefined();
    expect(screen.getByRole('note').textContent).toBe('Stays in this sheet. Demo Level B is a level of Palette.');
  });

  it('picks a sheet as a present, which a push becomes, and a page back as a push', () => {
    const { document, paths } = fixture();
    render(<Surface document={document} path={paths.palette}/>);
    open();
    fireEvent.click(screen.getByRole('option', { name: 'Gallery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(saved()).toMatchObject({ type: 'present', modalId: 'demo_gallery', ifPresented: 'reject' });
    open();
    fireEvent.click(screen.getByRole('option', { name: 'Sample Detail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(saved()).toMatchObject({ type: 'push', pageId: 'page-echo', origin: 'sender' });
    expect(saved()).not.toHaveProperty('modalId');
  });

  it('picks a modal as a present, and says it opens full screen', () => {
    const { document, paths } = fixture();
    render(<Surface document={document} path={paths.page}/>);
    open();
    fireEvent.click(screen.getByRole('option', { name: 'Demo Modal' }));
    expect(screen.getByRole('note').textContent).toBe('Opens Demo Modal full screen.');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(saved()).toMatchObject({ type: 'present', modalId: 'demo_modal' });
  });
});

describe('Show on Goes to', () => {
  const edit = () => fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));

  it('names a level by its title in the closed row, not its id', () => {
    const { document, paths } = fixture();
    expect(summarize(document, 'action', push('demo_level_a'))).toBe('Opens Demo Level A');
    render(<Surface document={document} path={paths.palette}/>);
    expect(screen.getByRole('button', { name: /When tapped/ }).textContent).toContain('Opens Demo Level A');
    expect(screen.getByRole('button', { name: /When tapped/ }).textContent).not.toContain('demo_level_a');
  });

  it('is offered for a page, a level, a sheet and a modal, worded with the destination\'s name', () => {
    const { document, paths } = fixture();
    for (const [pick, name] of [['Canvas', 'Show Canvas'], ['Demo Level B', 'Show Demo Level B'], ['Gallery', 'Show Gallery'], ['Demo Modal', 'Show Demo Modal']]) {
      render(<Surface document={document} path={paths.palette} shown={[]}/>);
      open();
      fireEvent.click(screen.getByRole('option', { name: pick }));
      expect(screen.getByRole('button', { name })).toBeTruthy();
      cleanup();
    }
  });

  it('is not drawn when the link names nothing, or outside the workspace', () => {
    const { document, paths } = fixture();
    const nothing = structuredClone(document) as CompositionDocument;
    (nothing.modals[0].components[0] as J).action = push('');
    render(<Surface document={nothing} path={paths.palette} shown={[]}/>);
    edit();
    expect(screen.queryByRole('button', { name: /^Show / })).toBeNull();
    cleanup();
    render(<Surface document={document} path={paths.palette}/>);
    edit();
    expect(screen.queryByRole('button', { name: /^Show / })).toBeNull();
  });

  it('applies an unsaved pick as one change, then shows the level inside the tile\'s sheet', () => {
    const { document, paths } = fixture();
    const shown: NavSurface[] = [], applied: CompositionDocument[] = [];
    render(<Surface document={document} path={paths.palette} shown={shown} applied={applied}/>);
    open();
    fireEvent.click(screen.getByRole('option', { name: 'Demo Level B' }));
    expect(applied).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show Demo Level B' }));
    expect(saved()).toMatchObject({ type: 'push', pageId: 'demo_level_b' });
    expect(applied).toHaveLength(1);
    expect(shown).toEqual([{ kind: 'level', id: 'demo_level_b', sheetId: document.modals[0].id }]);
    expect(screen.queryByRole('button', { name: /^Show / })).toBeNull();
  });

  it('shows a link nothing changed without applying anything', () => {
    const { document, paths } = fixture();
    const shown: NavSurface[] = [], applied: CompositionDocument[] = [];
    render(<Surface document={document} path={paths.palette} shown={shown} applied={applied}/>);
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Show Demo Level A' }));
    expect(applied).toHaveLength(0);
    expect(shown).toEqual([{ kind: 'level', id: 'demo_level_a', sheetId: document.modals[0].id }]);
  });

  it('shows a page and a sheet with no sheet attached', () => {
    const { document, paths } = fixture();
    expect(showTarget(document, paths.page, 'page:page-echo')).toEqual({ kind: 'page', id: 'page-echo' });
    expect(showTarget(document, paths.page, 'modal:demo_gallery')).toEqual({ kind: 'modal', id: 'demo_gallery' });
    expect(showTarget(document, paths.page, 'page:nowhere')).toBeUndefined();
    expect(showTarget(document, paths.page, '')).toBeUndefined();
  });

  it('passes the tile\'s sheet for a level: from a level, the sheet on show when it holds the tile, else the first that does', () => {
    const { document, paths } = fixture();
    expect(showTarget(document, paths.levelA, 'level:demo_level_b')).toEqual({ kind: 'level', id: 'demo_level_b', sheetId: document.modals[0].id });
    expect(showTarget(document, paths.levelA, 'level:demo_level_b', { kind: 'level', id: 'demo_level_a', sheetId: document.modals[0].id })).toMatchObject({ sheetId: document.modals[0].id });
    expect(showTarget(document, paths.gallery, 'level:demo_level_g', { kind: 'modal', id: document.modals[0].id })).toMatchObject({ sheetId: 'demo_gallery' });
    expect(showTarget(document, paths.page, 'level:demo_level_c')).toEqual({ kind: 'level', id: 'demo_level_c' });
  });

  it('titles what a value opens, and nothing for an unknown one', () => {
    const { document } = fixture();
    expect(goesToTitle(document, 'level:demo_level_a')).toBe('Demo Level A');
    expect(goesToTitle(document, 'modal:demo_gallery')).toBe('Gallery');
    expect(goesToTitle(document, 'page:page-echo')).toBe('Sample Detail');
    expect(goesToTitle(document, 'level:missing')).toBe('');
  });

  it('works from the wide dialog too: Done and show', () => {
    const { document, paths } = fixture();
    const shown: NavSurface[] = [], applied: CompositionDocument[] = [];
    render(<SurfaceActionsContext.Provider value={{ show: surface => shown.push(surface) }}>
      <RowsProvider value={{ document, onChange: next => applied.push(next), onError: () => {} }}>
        <ActionRow label="When tapped" path={paths.palette} schema={schemaAt(document, paths.palette)} optional itemName="Tile"/>
      </RowsProvider>
    </SurfaceActionsContext.Provider>);
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Goes to' }));
    fireEvent.click(screen.getByRole('option', { name: 'Demo Level B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Demo Level B' }));
    expect(applied).toHaveLength(1);
    expect(shown).toEqual([{ kind: 'level', id: 'demo_level_b', sheetId: document.modals[0].id }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('by rule', () => {
    const lit = (value: unknown) => ({ type: 'literal', value });
    const byRule = (when?: J) => {
      const { document, paths } = fixture();
      (document.modals[0].components[0] as J).action = { type: 'conditional', cases: [{ ...(when ? { when } : {}), then: push('demo_level_b') }], otherwise: { type: 'none' } };
      return { document, paths };
    };
    const openRule = () => { edit(); fireEvent.click(screen.getByRole('button', { name: /^Rule 1 of 1/ })); };

    it('is disabled with Done\'s reason while a rule has no condition, and a click applies and shows nothing', () => {
      const { document, paths } = byRule();
      const shown: NavSurface[] = [], applied: CompositionDocument[] = [];
      render(<Surface document={document} path={paths.palette} shown={shown} applied={applied}/>);
      openRule();
      const show = screen.getByRole('button', { name: 'Show Demo Level B' }) as HTMLButtonElement;
      expect(show.disabled).toBe(true);
      expect(show.title).toBe('Every rule needs a condition.');
      fireEvent.click(show);
      expect(applied).toHaveLength(0);
      expect(shown).toHaveLength(0);
    });

    it('is enabled once the condition is set, and shows', () => {
      const { document, paths } = byRule({ type: 'compare', op: 'above', left: lit(1), right: lit(0) });
      const shown: NavSurface[] = [];
      render(<Surface document={document} path={paths.palette} shown={shown}/>);
      openRule();
      const show = screen.getByRole('button', { name: 'Show Demo Level B' }) as HTMLButtonElement;
      expect(show.disabled).toBe(false);
      expect(show.title).toBe('');
      fireEvent.click(show);
      expect(shown).toEqual([{ kind: 'level', id: 'demo_level_b', sheetId: document.modals[0].id }]);
    });
  });
});
