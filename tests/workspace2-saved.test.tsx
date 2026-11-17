// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import LibraryPalette from '../src/workspace2/LibraryPalette';
import { insertPlace, saveAsComponent } from '../src/workspace2/linked';
import { endOf } from '../src/workspace2/add/insert';
import { useLibrary } from '../src/workspace2/useLibrary';
import { targetOf, wordsFor } from '../src/workspace2/checkWords';
import { copyOf, voiceIssues } from './support/copy';

type J = Record<string, any>;
beforeEach(() => localStorage.clear());
afterEach(cleanup);

function documentWith(uses: number): { document: CompositionDocument; entryId: string } {
  const base: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  base.pages[2].components = [{ id: 'note', title: 'Note', type: 'text', layout: { span: 1 }, props: { value: { type: 'literal', value: 'Hello' }, style: 'body', unavailableText: 'None' } }];
  let { document } = saveAsComponent(base as CompositionDocument, ['pages', 2, 'components', 0], 'Door Note');
  const entryId = document.componentLibrary![0].id;
  for (let at = 1; at < uses; at++) document = insertPlace(document, entryId, endOf(document, `page:${base.pages[2].id}`)!).document;
  if (uses === 0) document = { ...document, pages: document.pages.map((page, at) => at === 2 ? { ...page, components: [] } : page) } as CompositionDocument;
  return { document, entryId };
}

function Harness({ document, mode = 'edit', apply, say }: { document: CompositionDocument; mode?: 'edit' | 'use'; apply: (next: CompositionDocument) => void; say: (text: string) => void }) {
  const library = useLibrary('docked', 1440);
  const ws = { document, mode, setMode: vi.fn(), studio: { apply }, linked: { say }, selectAnywhere: vi.fn(), index: undefined } as any;
  return <LibraryPalette ws={ws} kind="components" library={library}/>;
}

describe('the Templates group', () => {
  it('says how to save one when none exists', () => {
    const { document } = documentWith(1);
    render(<Harness document={{ ...document, componentLibrary: undefined }} apply={vi.fn()} say={vi.fn()}/>);
    expect(screen.getByTestId('saved-empty').textContent).toContain('No templates yet.');
  });

  it('lists a row with its name and its use count above the built-in groups', () => {
    const { document } = documentWith(2);
    render(<Harness document={document} apply={vi.fn()} say={vi.fn()}/>);
    const row = screen.getByTestId('saved-row');
    expect(row.textContent).toContain('Door Note');
    expect(row.textContent).toContain('2 places');
    expect(screen.getByRole('button', { name: /Templates/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Layout/ })).toBeTruthy();
  });

  it('filters both groups by the search', () => {
    const { document } = documentWith(1);
    render(<Harness document={document} apply={vi.fn()} say={vi.fn()}/>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } });
    expect(screen.getByText('Nothing matches.')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'door' } });
    expect(screen.getByTestId('saved-row')).toBeTruthy();
  });

  it('writes the voice rules for its words', () => {
    const { document } = documentWith(2);
    const { container } = render(<Harness document={document} apply={vi.fn()} say={vi.fn()}/>);
    expect(voiceIssues(container.querySelector('.w2-palette')!)).toEqual([]);
    expect(copyOf(container.querySelector('.w2-palette')!)).toContain('Door Note');
  });

  it('renames through the row with Done', async () => {
    const { document } = documentWith(2);
    const apply = vi.fn();
    render(<Harness document={document} apply={apply} say={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'More for Door Note' }));
    fireEvent.click(await screen.findByText('Rename'));
    const field = screen.getByRole('textbox', { name: 'Name of Door Note' });
    fireEvent.change(field, { target: { value: 'Front Door' } });
    fireEvent.click(screen.getByText('Done'));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].componentLibrary[0].name).toBe('Front Door');
  });

  it('deletes an unused component at once, and asks for a used one', async () => {
    const unused = documentWith(0);
    const apply = vi.fn(), say = vi.fn();
    const first = render(<Harness document={unused.document} apply={apply} say={say}/>);
    fireEvent.click(screen.getByRole('button', { name: 'More for Door Note' }));
    fireEvent.click(await screen.findByText('Delete'));
    expect(apply).toHaveBeenCalledTimes(1);
    first.unmount();
    const used = documentWith(2);
    const second = vi.fn();
    render(<Harness document={used.document} apply={second} say={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'More for Door Note' }));
    fireEvent.click(await screen.findByText('Delete'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete “Door Note”?');
    expect(dialog.textContent).toContain('It is used in 2 places. Each one stays where it is, unlinked.');
    expect(second).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByText('Delete Template'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0][0].componentLibrary ?? []).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('disables the rows in Use', () => {
    const { document } = documentWith(2);
    render(<Harness document={document} mode="use" apply={vi.fn()} say={vi.fn()}/>);
    expect(screen.getByRole('button', { name: /^Door Note\./ }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Checks words for a problem inside a template', () => {
  it('names the component and goes to its first use', () => {
    const { document } = documentWith(2);
    const target = targetOf(document, ['componentLibrary', 0, 'node', 'props', 'value', 'value']);
    expect(target.place).toBe('In the template Door Note');
    expect(target.select).toMatch(/^node:/);
    expect(typeof wordsFor).toBe('function');
  });
});
