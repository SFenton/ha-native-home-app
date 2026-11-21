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
import { goesToChoices, goesToValue, parseGoesTo } from '../src/workspace2/editors/goesTo';

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
function Surface({ document: first, path }: { document: CompositionDocument; path: EditorPath }) {
  const [document, setDocument] = useState(first);
  return <RowsProvider value={{ document, onChange: setDocument, onError: () => {} }}>
    <PushStack rootTitle="Tile" root={<>
      <ActionRow label="When tapped" path={path} schema={schemaAt(document, path)} optional itemName="Tile"/>
      <output data-testid="doc">{JSON.stringify(valueAt(document, path))}</output>
    </>}/>
  </RowsProvider>;
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
