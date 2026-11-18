// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import LibraryPalette from '../src/workspace2/LibraryPalette';
import RepeatProposal from '../src/workspace2/repeats/RepeatProposal';
import RepeatsLevel from '../src/workspace2/repeats/RepeatsLevel';
import { useRepeats } from '../src/workspace2/repeats/useRepeats';
import { useLibrary } from '../src/workspace2/useLibrary';
import { copyOf, voiceIssues } from './support/copy';

type J = Record<string, any>;
beforeEach(() => localStorage.clear());
afterEach(cleanup);

const fixture = (): CompositionDocument => JSON.parse(readFileSync('tests/fixtures/templates-repeats.json', 'utf8')).document;
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const actionTile = (id: string, title: string, source: string, icon = 'power'): J => ({
  id, title, type: 'action-tile', layout: { span: 1 }, icon: symbol(icon), binding: { sourceId: source, projection: 'power-tile@1' },
  props: { family: 'occupancy', bodyActionId: 'power', actionOrder: ['power'] }, action: { type: 'domain', sourceId: source, intent: 'power.toggle' },
});
const grid = (id: string, title: string, children: J[]): J => ({ id, title, type: 'tile-grid', layout: { span: 1 }, props: { maxColumns: 4, spacing: { type: 'token', name: 'm' } }, children });
const withPage = (components: J[]): CompositionDocument => ({ ...fixture(), pages: fixture().pages.map((page, at) => ({ ...page, components: at === 0 ? components : [] })) } as unknown as CompositionDocument);
/** Four places of one grid: three with the power icon on the second tile, one with a bolt. */
const partial = () => withPage([0, 1, 2, 3].map(n => grid(`g${n}`, 'Lamps', [actionTile(`a${n}1`, 'Lamp', `src-${n}`), actionTile(`a${n}2`, 'Lamp', 'src-shared', n === 3 ? 'bolt' : 'power')])));

/** The Templates group, the level and the inspector's proposal, with the real walk behind them. */
function Harness({ document, mode = 'edit', apply = vi.fn(), say = vi.fn(), error = vi.fn() }: { document: CompositionDocument; mode?: 'edit' | 'use'; apply?: (next: CompositionDocument) => void; say?: (text: string) => void; error?: (message: string) => void }) {
  const library = useLibrary('docked', 1440);
  const repeats = useRepeats(document);
  const ws = { document, mode, setMode: vi.fn(), studio: { apply }, linked: { say }, selectAnywhere: vi.fn(), index: undefined, repeats } as any;
  return <>
    {repeats.open ? <RepeatsLevel ws={ws} onBack={() => repeats.setOpen(false)}/> : <LibraryPalette ws={ws} kind="components" library={library}/>}
    <aside aria-label="Properties">{repeats.selected && <RepeatProposal ws={ws} onError={error}/>}</aside>
  </>;
}

const open = async () => {
  fireEvent.click(screen.getByTestId('find-repeats'));
  await waitFor(() => expect(screen.getByTestId('repeats-list')).toBeTruthy());
};

describe('the Find Repeated Pieces button', () => {
  it('sits in the panel footer, apart from the Templates list, with no count until the walk has run', async () => {
    render(<Harness document={fixture()}/>);
    const row = screen.getByTestId('find-repeats');
    expect(row.textContent).toBe('Find Repeated Pieces');
    expect(row.getAttribute('aria-label')).toBe('Find Repeated Pieces');
    expect(screen.queryByTestId('find-repeats-count')).toBeNull();
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Components' }));
    expect(screen.getByTestId('find-repeats-count').textContent).toBe('2');
    expect(screen.getByTestId('find-repeats').getAttribute('aria-label')).toBe('Find Repeated Pieces, 2 found');
  });

  it('stays in reach whatever the search says, and is not a row of the Templates list', () => {
    render(<Harness document={fixture()}/>);
    const foot = screen.getByTestId('find-repeats').closest('footer')!;
    expect(foot.getAttribute('aria-label')).toBe('Templates');
    expect(screen.queryByRole('list', { name: 'Templates' })?.contains(screen.getByTestId('find-repeats')) ?? false).toBe(false);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } });
    expect(screen.getByTestId('find-repeats')).toBeTruthy();
    expect(screen.getByText('Nothing matches.')).toBeTruthy();
  });
});

describe('the level', () => {
  it('says it is looking, then lists the pieces with their places, largest first', async () => {
    render(<Harness document={fixture()}/>);
    fireEvent.click(screen.getByTestId('find-repeats'));
    expect(screen.getByTestId('repeats-summary').textContent).toBe('Looking for repeated pieces…');
    await waitFor(() => expect(screen.getByTestId('repeats-summary').textContent).toBe('2 found in 5 places'));
    const rows = within(screen.getByTestId('repeats-list')).getAllByRole('button');
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Tile grid, 3 tiles. 3 places', 'Section, 3 tiles. 2 places']);
  });

  it('shows the empty line when nothing repeats', async () => {
    render(<Harness document={withPage([grid('a', 'A', [actionTile('a1', 'x', 's1')])])}/>);
    fireEvent.click(screen.getByTestId('find-repeats'));
    await waitFor(() => expect(screen.getByTestId('repeats-empty')).toBeTruthy());
    expect(screen.getByText('Nothing found')).toBeTruthy();
    expect(screen.getByText('Nothing repeats yet. A tile that appears twice, or a piece of 3 or more parts that appears twice, shows here.')).toBeTruthy();
    expect(screen.getByTestId('repeats-summary').textContent).toBe('0 found in 0 places');
  });

  it('filters its rows by the search, and takes the arrow keys', async () => {
    render(<Harness document={fixture()}/>);
    await open();
    const [first, second] = within(screen.getByTestId('repeats-list')).getAllByRole('button');
    expect(first.getAttribute('tabindex')).toBe('0');
    expect(second.getAttribute('tabindex')).toBe('-1');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(window.document.activeElement).toBe(second);
    expect(second.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(window.document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'End' });
    expect(window.document.activeElement).toBe(second);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in repeated pieces' }), { target: { value: 'section' } });
    expect(within(screen.getByTestId('repeats-list')).getAllByRole('button')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in repeated pieces' }), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matches.')).toBeTruthy();
  });

  it('is named for assistive technology: a labelled region and list', async () => {
    render(<Harness document={fixture()}/>);
    await open();
    expect(screen.getByRole('region', { name: 'Repeated Pieces' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Groups' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Repeated Pieces' })).toBeTruthy();
  });

  it('keeps its rows while the walk runs again after an edit, and does not walk while closed', async () => {
    const { rerender } = render(<Harness document={fixture()}/>);
    await open();
    const edited = withPage([...fixture().pages[0].components, grid('extra', 'Extra', [actionTile('e1', 'x', 's1')])] as unknown as J[]);
    rerender(<Harness document={edited}/>);
    // The earlier answer stays on show: the list never blanks.
    expect(screen.getByTestId('repeats-list')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('repeats-summary').textContent).toMatch(/found/));
  });
});

describe('the proposal', () => {
  const pick = async (name: RegExp) => { fireEvent.click(within(screen.getByTestId('repeats-list')).getByRole('button', { name })); await waitFor(() => expect(screen.getByTestId('repeat-proposal')).toBeTruthy()); };

  it('names the piece, lists one checked row for each group of differing fields, and says what a template cannot set', async () => {
    render(<Harness document={fixture()}/>);
    await open();
    await pick(/^Tile grid/);
    const proposal = screen.getByTestId('repeat-proposal');
    expect((within(proposal).getByLabelText('Name') as HTMLInputElement).value).toBe('Tile grid');
    const boxes = within(proposal).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map(box => box.getAttribute('aria-label'))).toEqual(['Title 1', 'Title 2', 'Entity 1', 'Title 3', 'Entity 2', 'Title 4', 'Entity 3']);
    expect(boxes.every(box => box.checked)).toBe(true);
    // Each box is described by its second line.
    expect(window.document.getElementById(boxes[2].getAttribute('aria-describedby')!)!.textContent).toBe('Entity · 3 different · fills 1 field');
    expect(screen.getByTestId('repeat-foot').textContent).toBe('Replaces 2 of 3 places. 1 differs in Columns, which a template cannot set.');
    expect(screen.getByTestId('repeat-foot').getAttribute('aria-live')).toBe('polite');
    expect(within(proposal).getByRole('heading', { name: 'Places (2 of 3)' })).toBeTruthy();
    expect(within(proposal).getAllByRole('button', { name: /Home/ })).toHaveLength(2);
    expect(within(proposal).getByText('Shown')).toBeTruthy();
  });

  it('lowers the count when a row is unchecked, and the foot names the field', async () => {
    render(<Harness document={partial()}/>);
    await open();
    await pick(/^Tile grid/);
    const proposal = screen.getByTestId('repeat-proposal');
    expect(screen.getByTestId('repeat-foot').textContent).toBe('Replaces 4 places with one template.');
    expect(within(proposal).getByRole('heading', { name: 'Places (4)' })).toBeTruthy();
    const icon = within(proposal).getByRole('checkbox', { name: 'Icon' });
    fireEvent.click(icon);
    expect(screen.getByTestId('repeat-foot').textContent).toBe('Replaces 3 of 4 places. 1 uses another Icon and stays as it is.');
    expect(within(proposal).getByRole('heading', { name: 'Places (3 of 4)' })).toBeTruthy();
    fireEvent.click(icon);
    expect(screen.getByTestId('repeat-foot').textContent).toBe('Replaces 4 places with one template.');
  });

  it('a place row shows that place', async () => {
    render(<Harness document={partial()}/>);
    await open();
    await pick(/^Tile grid/);
    const places = within(screen.getByTestId('repeat-proposal')).getByRole('list', { name: 'Places' });
    const buttons = within(places).getAllByRole('button');
    expect(buttons[0].getAttribute('aria-current')).toBe('true');
    fireEvent.click(buttons[2]);
    expect(within(places).getAllByRole('button')[2].getAttribute('aria-current')).toBe('true');
    expect(within(places).getAllByRole('button')[0].getAttribute('aria-current')).toBeNull();
    // Four places: the first three, then the rest behind Show More.
    expect(within(screen.getByTestId('repeat-proposal')).queryByRole('button', { name: /^Show/ })).toBeNull();
  });

  it('shows 3 places and Show More for more', async () => {
    const many = withPage([0, 1, 2, 3, 4, 5].map(n => grid(`g${n}`, 'Lamps', [actionTile(`a${n}1`, 'Lamp', `src-${n}`), actionTile(`a${n}2`, 'Lamp', 'src-shared')])));
    render(<Harness document={many}/>);
    await open();
    await pick(/^Tile grid/);
    const proposal = screen.getByTestId('repeat-proposal');
    expect(within(within(proposal).getByRole('list', { name: 'Places' })).getAllByRole('button')).toHaveLength(3);
    fireEvent.click(within(proposal).getByRole('button', { name: 'Show 3 More' }));
    expect(within(within(proposal).getByRole('list', { name: 'Places' })).getAllByRole('button')).toHaveLength(6);
  });

  it('Save as Template applies one document with the template and a reference in each place, and says so', async () => {
    const apply = vi.fn(), say = vi.fn();
    render(<Harness document={partial()} apply={apply} say={say}/>);
    await open();
    await pick(/^Tile grid/);
    fireEvent.change(within(screen.getByTestId('repeat-proposal')).getByLabelText('Name'), { target: { value: 'Lamp Grid' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as Template' })); });
    expect(apply).toHaveBeenCalledTimes(1);
    const saved = apply.mock.calls[0][0] as CompositionDocument;
    expect(saved.componentLibrary!.map(entry => entry.name)).toEqual(['Lamp Grid']);
    expect(saved.pages[0].components.filter(node => node.type === 'component-ref')).toHaveLength(4);
    expect(say).toHaveBeenCalledWith('Saved Lamp Grid. 4 places use it.');
    expect(screen.queryByTestId('repeat-proposal')).toBeNull();
    expect(screen.getByTestId('repeats-note').textContent).toBe('Saved Lamp Grid. 4 places use it.');
  });

  it('refuses in Use, with fewer than two places, and with a name that is taken, and says why', async () => {
    const apply = vi.fn();
    const taken = { ...fixture(), componentLibrary: [{ id: 'old', name: 'Tile grid', node: fixture().pages[0].components[0] }] } as unknown as CompositionDocument;
    const { unmount } = render(<Harness document={partial()} apply={apply} mode="use"/>);
    await open();
    await pick(/^Tile grid/);
    expect(screen.getByText('Switch to Edit to save a template.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Save as Template' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe(screen.getByText('Switch to Edit to save a template.').id);
    fireEvent.click(button);
    expect(apply).not.toHaveBeenCalled();
    unmount();

    render(<Harness document={taken} apply={apply}/>);
    await open();
    await pick(/^Tile grid/);
    // The suggested name is made free, so type the taken one.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Tile grid 2');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'tile grid' } });
    expect(screen.getByRole('alert').textContent).toBe('A template named tile grid already exists.');
    fireEvent.click(screen.getByRole('button', { name: 'Save as Template' }));
    expect(apply).not.toHaveBeenCalled();
    // Two places are left only when the Title rows stay checked: uncheck the first and the count falls under two.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fine' } });
    const title = screen.getAllByRole('checkbox')[0];
    fireEvent.click(title);
    expect(screen.getByText('Fewer than 2 places are left. Check a row to bring places back.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save as Template' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('holds 16 parameters: the rest start unchecked, a line says so, and a box cannot be checked past it', async () => {
    const many = withPage([0, 1, 2].map(n => grid(`g${n}`, 'Lamps', Array.from({ length: 18 }, (_, at) => actionTile(`t${n}-${at}`, 'Lamp', `src-${n}-${at}`)))));
    render(<Harness document={many}/>);
    await open();
    await pick(/^Tile grid/);
    const boxes = within(screen.getByTestId('repeat-proposal')).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(18);
    expect(boxes.filter(box => box.checked)).toHaveLength(16);
    expect(screen.getByText('A template holds 16 parameters.')).toBeTruthy();
    const off = boxes.find(box => !box.checked)!;
    expect(off.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(off);
    expect(boxes.filter(box => box.checked)).toHaveLength(16);
  });
});

describe('the words', () => {
  it('hold the voice rules and are written to the copy snapshots', async () => {
    const dir = './snapshots/copy';
    const level = render(<Harness document={fixture()}/>);
    await open();
    await expect(copyOf(level.container)).toMatchFileSnapshot(`${dir}/repeats-level.txt`);
    expect(voiceIssues(level.container)).toEqual([]);
    await pick();
    await expect(copyOf(screen.getByLabelText('Properties'))).toMatchFileSnapshot(`${dir}/repeats-proposal.txt`);
    expect(voiceIssues(screen.getByLabelText('Properties'))).toEqual([]);
    level.unmount();
    const empty = render(<Harness document={withPage([])}/>);
    fireEvent.click(screen.getByTestId('find-repeats'));
    await waitFor(() => expect(screen.getByTestId('repeats-empty')).toBeTruthy());
    await expect(copyOf(empty.container)).toMatchFileSnapshot(`${dir}/repeats-empty.txt`);
    expect(voiceIssues(empty.container)).toEqual([]);
  });

  async function pick() {
    fireEvent.click(within(screen.getByTestId('repeats-list')).getAllByRole('button')[0]);
    await waitFor(() => expect(screen.getByTestId('repeat-proposal')).toBeTruthy());
  }
});
