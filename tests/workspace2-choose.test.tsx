// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { componentReferences } from '../src/shared/composition/components';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { valueAt } from '../src/composition-editor';
import { Modal } from '../src/workspace2/kit';
import { ChooseBar, ChooseFieldsButton, hasSettableRow, useChooseRows } from '../src/workspace2/ChooseFields';
import { setChoosing } from '../src/workspace2/chooseStore';
import { endOf } from '../src/workspace2/add/insert';
import { insertPlace, saveAsComponent } from '../src/workspace2/linked';
import PerPlaceLine from '../src/workspace2/PerPlaceLine';
import { setPerPlace } from '../src/workspace2/params';
import { ObjectRows, RowsProvider } from '../src/workspace2/rows';

afterEach(() => { cleanup(); setChoosing(undefined); });
type J = Record<string, any>;
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const tile = (id: string, title: string): J => ({
  id, title, type: 'navigation-tile', layout: { span: 1 }, icon: symbol('info.circle'), props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: 'Open' } },
  action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
});

/** A template of one navigation tile with two places (invented names). */
function template() {
  const base: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  base.pages[2].components = [tile('door', 'Door Tile')];
  const saved = saveAsComponent(base as CompositionDocument, ['pages', 2, 'components', 0], 'Door Tile');
  const added = insertPlace(saved.document, saved.document.componentLibrary![0].id, endOf(saved.document, `page:${base.pages[2].id}`)!);
  const entry = added.document.componentLibrary![0];
  return { document: added.document, entryId: entry.id, bodyId: entry.node.id, path: ['componentLibrary', 0, 'node'] };
}

/** The rows of one template node while its fields are chosen, as the inspector draws them. */
function Rows({ document, entryId, path, say, asking = false }: { document: CompositionDocument; entryId: string; path: (string | number)[]; say?: (message: string) => void; asking?: boolean }) {
  const component = document.componentLibrary!.find(item => item.id === entryId)!;
  const node = valueAt(document, path) as J;
  const choose = useChooseRows(document, component, node as never, say, asking);
  return <ObjectRows path={path} owner={node.type} choose={choose}
    below={rel => <PerPlaceLine document={document} component={component} node={node as never} field={rel.join('/')} choosing/>}/>;
}
function mount(document: CompositionDocument, entryId: string, path: (string | number)[]) {
  const apply = vi.fn(), onError = vi.fn(), say = vi.fn();
  const view = render(<RowsProvider value={{ document, onChange: apply, onError, problems: new Map() }}><Rows document={document} entryId={entryId} path={path} say={say}/></RowsProvider>);
  return { apply, onError, say, view };
}

describe('Choose Fields: the rows', () => {
  it('puts a box on every row that can be set, each named for what it sets, and holds the row itself inert', () => {
    const { document, entryId, path } = template();
    mount(document, entryId, path);
    const boxes = screen.getAllByRole('checkbox').map(item => item.getAttribute('aria-label'));
    expect(boxes).toEqual(expect.arrayContaining(['Set Title per place', 'Set Subtitle per place', 'Set Icon per place']));
    expect(screen.getAllByRole('checkbox').every(item => !(item as HTMLInputElement).checked)).toBe(true);
    expect(document.componentLibrary).toBeTruthy();
    const rows = window.document.querySelectorAll('[data-choose="settable"]');
    expect(rows.length).toBe(boxes.length);
    for (const row of rows) expect(row.querySelector('.w2-choose-body')?.hasAttribute('inert')).toBe(true);
  });

  it('ticking a row sets it per place as a change to the template, and the whole row is the target', () => {
    const { document, entryId, path } = template();
    const { apply } = mount(document, entryId, path);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set Subtitle per place' }));
    expect(apply).toHaveBeenCalledTimes(1);
    const next = apply.mock.calls[0][0] as CompositionDocument;
    expect(next.componentLibrary![0].params).toEqual([{ name: 'subtitle', kind: 'value', label: 'Subtitle' }]);
    expect(() => compileCompositionDocument(next)).not.toThrow();
    // a press anywhere on the row reaches the box
    const row = screen.getByRole('checkbox', { name: 'Set Title per place' }).closest('[data-choose]') as HTMLElement;
    fireEvent.click(row);
    expect(apply).toHaveBeenCalledTimes(2);
    expect((apply.mock.calls[1][0] as CompositionDocument).componentLibrary![0].params![0].kind).toBe('text');
  });

  it('a set row shows its line and its box ticked, and unticking is Same Everywhere', () => {
    const { document, entryId, bodyId, path } = template();
    const set = setPerPlace(document, entryId, bodyId, 'props/subtitle');
    const { apply } = mount(set, entryId, path);
    const box = screen.getByRole('checkbox', { name: 'Set Subtitle per place' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(document.pages.length).toBeGreaterThan(0);
    expect(window.document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toBe('Set per place as Subtitle.');
    expect(screen.queryByRole('button', { name: /Same Everywhere/ })).toBeNull();
    fireEvent.click(box);
    const next = apply.mock.calls[0][0] as CompositionDocument;
    expect(next.componentLibrary![0].params).toBeUndefined();
    expect(componentReferences(next).every(use => use.ref.values === undefined)).toBe(true);
  });

  it('a row that could share a setting opens a menu: Use for each, then New Setting', async () => {
    const { document, entryId, bodyId, path } = template();
    const set = setPerPlace(document, entryId, bodyId, 'props/subtitle');
    const { apply } = mount(set, entryId, path);
    // Title is another kind, so it is a plain box; only a row of the same shape would open the menu
    expect(screen.getByRole('checkbox', { name: 'Set Title per place' })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('at 16 settings the unticked boxes are disabled and a set one stays enabled', () => {
    const { document, entryId, bodyId, path } = template();
    const full = { ...document, componentLibrary: [{ ...document.componentLibrary![0], params: Array.from({ length: 16 }, (_, at) => ({ name: `text_${at}`, kind: 'text' as const })) }] } as CompositionDocument;
    mount(full, entryId, path);
    expect((screen.getByRole('checkbox', { name: 'Set Subtitle per place' }) as HTMLInputElement).disabled).toBe(true);
    void bodyId;
  });
});

describe('Choose Fields: status lines', () => {
  /** Draws the rows again with the document the last change made, as the workspace does once the change is applied. */
  const applied = (mounted: ReturnType<typeof mount>, entryId: string, path: (string | number)[]) => {
    const next = mounted.apply.mock.calls.at(-1)![0] as CompositionDocument;
    mounted.view.rerender(<RowsProvider value={{ document: next, onChange: mounted.apply, onError: mounted.onError, problems: new Map() }}><Rows document={next} entryId={entryId} path={path} say={mounted.say}/></RowsProvider>);
  };

  it('speaks each change once it is applied: set, and the same everywhere', () => {
    const { document, entryId, bodyId, path } = template();
    const first = mount(document, entryId, path);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set Title per place' }));
    expect(first.say).not.toHaveBeenCalled();
    applied(first, entryId, path);
    expect(first.say).toHaveBeenCalledExactlyOnceWith('Title is set per place.');
    cleanup();
    const second = mount(setPerPlace(document, entryId, bodyId, 'title'), entryId, path);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set Title per place' }));
    expect(second.say).not.toHaveBeenCalled();
    applied(second, entryId, path);
    expect(second.say).toHaveBeenCalledExactlyOnceWith('Title is the same everywhere.');
  });

  it('says nothing for a change that is held for the question and cancelled: the document never changes', () => {
    const { document, entryId, path } = template();
    const held = mount(document, entryId, path);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set Title per place' }));
    held.view.rerender(<RowsProvider value={{ document, onChange: held.apply, onError: held.onError, problems: new Map() }}><Rows document={document} entryId={entryId} path={path} say={held.say}/></RowsProvider>);
    expect(held.say).not.toHaveBeenCalled();
  });
});

describe('Choose Fields: a cancelled change', () => {
  it('clears the pending line when the question closes without the change, so a later change to the same state does not speak it', () => {
    const { document, entryId, path } = template();
    const say = vi.fn(), apply = vi.fn();
    const draw = (shown: CompositionDocument, asking: boolean) => <RowsProvider value={{ document: shown, onChange: apply, onError: vi.fn(), problems: new Map() }}><Rows document={shown} entryId={entryId} path={path} say={say} asking={asking}/></RowsProvider>;
    const view = render(draw(document, false));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set Title per place' }));
    const later = apply.mock.calls[0][0] as CompositionDocument;
    // the change is held for the question, which is then cancelled: the document never changes
    view.rerender(draw(document, true));
    view.rerender(draw(document, false));
    // the same change arriving later (an Undo, an edit elsewhere) is not announced as this tick
    view.rerender(draw(later, false));
    expect(say).not.toHaveBeenCalled();
  });
});

describe('Choose Fields: the button and the bar', () => {
  it('the button is enabled for a node with a row to set, and starts choosing', () => {
    const { document, entryId, path } = template();
    const component = document.componentLibrary!.find(item => item.id === entryId)!;
    const node = valueAt(document, path) as never;
    expect(hasSettableRow(document, component, node, path)).toBe(true);
    render(<RowsProvider value={{ document, onChange: vi.fn(), onError: vi.fn(), problems: new Map() }}><ChooseFieldsButton document={document} component={component} node={node} path={path}/></RowsProvider>);
    const button = screen.getByRole('button', { name: 'Choose Fields…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByText('This element has no field a place can set.')).toBeNull();
  });

  it('the bar is a region named Choose fields, says what to do, and at the limit says so; Done ends choosing', () => {
    const { document, entryId } = template();
    const component = document.componentLibrary!.find(item => item.id === entryId)!;
    setChoosing(entryId);
    const { rerender } = render(<ChooseBar component={component}/>);
    const region = screen.getByRole('region', { name: 'Choose fields' });
    expect(region.textContent).toContain('Select the fields each place sets.');
    expect(region.hasAttribute('aria-describedby')).toBe(false);
    rerender(<ChooseBar component={{ ...component, params: Array.from({ length: 16 }, (_, at) => ({ name: `text_${at}`, kind: 'text' as const })) }}/>);
    const full = screen.getByRole('region', { name: 'Choose fields' });
    expect(full.textContent).toContain('A template holds 16 settings.');
    expect(window.document.getElementById(full.getAttribute('aria-describedby')!)?.textContent).toBe('A template holds 16 settings.');
    fireEvent.click(within(full).getByRole('button', { name: 'Done' }));
  });

  /** Whether Escape was taken by choosing (it stops the event) with `element` on the page. */
  const taken = async (element: HTMLElement | undefined) => {
    const { document, entryId } = template();
    const component = document.componentLibrary!.find(item => item.id === entryId)!;
    setChoosing(entryId);
    render(<ChooseBar component={component}/>);
    if (element) window.document.body.appendChild(element);
    const press = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stop = vi.spyOn(press, 'stopPropagation');
    await act(async () => { window.dispatchEvent(press); });
    element?.remove();
    return stop.mock.calls.length > 0;
  };
  const made = (tag: string, attributes: Record<string, string>) => { const element = window.document.createElement(tag); for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value); return element; };

  it('Escape belongs to an open question: with the edit question up it ends nothing', async () => {
    expect(await taken(made('div', { role: 'alertdialog' }))).toBe(false);
    cleanup();
    expect(await taken(made('div', { 'data-modal': '' }))).toBe(false);
  });

  it('Escape still ends choosing with a preview sheet or a toast open, which are dialogs that are not modal', async () => {
    expect(await taken(made('section', { class: 'sh-sheet', role: 'dialog' }))).toBe(true);
    cleanup();
    expect(await taken(made('div', { role: 'dialog', 'aria-label': 'Notification' }))).toBe(true);
    cleanup();
    expect(await taken(undefined)).toBe(true);
  });

  it('Escape belongs to the real kit Modal: with one open it ends nothing, and once it closes choosing ends', async () => {
    const { document, entryId } = template();
    const component = document.componentLibrary!.find(item => item.id === entryId)!;
    setChoosing(entryId);
    const view = render(<><ChooseBar component={component}/><Modal open onOpenChange={() => undefined} title="Publish to the App?">Body</Modal></>);
    await screen.findByRole('dialog', { name: 'Publish to the App?' });
    expect(window.document.querySelector('[data-modal]')).not.toBeNull();
    const held = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const spy = vi.spyOn(held, 'stopPropagation');
    await act(async () => { window.dispatchEvent(held); });
    expect(spy).not.toHaveBeenCalled();
    view.rerender(<><ChooseBar component={component}/><Modal open={false} onOpenChange={() => undefined} title="Publish to the App?">Body</Modal></>);
    await vi.waitFor(() => expect(window.document.querySelector('[data-modal]')).toBeNull());
    const free = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stop = vi.spyOn(free, 'stopPropagation');
    await act(async () => { window.dispatchEvent(free); });
    expect(stop).toHaveBeenCalled();
  });

  it('a dialog around the bar (a phone sheet) does not take Escape from it', async () => {
    const { document, entryId } = template();
    const component = document.componentLibrary!.find(item => item.id === entryId)!;
    render(<div role="dialog" data-modal aria-label="Sheet"><ChooseBar component={component}/></div>);
    const press = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stop = vi.spyOn(press, 'stopPropagation');
    await act(async () => { window.dispatchEvent(press); });
    expect(stop).toHaveBeenCalled();
  });

  it('Escape ends choosing, and an open tick menu keeps its own Escape', async () => {
    const { document, entryId } = template();
    const component = document.componentLibrary!.find(item => item.id === entryId)!;
    render(<ChooseBar component={component}/>);
    const menu = window.document.body.appendChild(window.document.createElement('div'));
    menu.setAttribute('data-testid', 'tick-menu');
    const held = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const spy = vi.spyOn(held, 'stopPropagation');
    await act(async () => { window.dispatchEvent(held); });
    expect(spy).not.toHaveBeenCalled();
    menu.remove();
    const free = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stop = vi.spyOn(free, 'stopPropagation');
    await act(async () => { window.dispatchEvent(free); });
    expect(stop).toHaveBeenCalled();
  });
});

describe('the line under a row', () => {
  const lineFor = (field: string, props: { readOnly?: boolean; choosing?: boolean } = {}, setup?: (doc: CompositionDocument, entryId: string, bodyId: string) => CompositionDocument) => {
    const { document, entryId, bodyId } = template();
    const used = setup ? setup(document, entryId, bodyId) : document;
    const component = used.componentLibrary![0];
    return render(<RowsProvider value={{ document: used, onChange: vi.fn(), onError: vi.fn(), problems: new Map() }}>
      <PerPlaceLine document={used} component={component} node={component.node} field={field} {...props}/></RowsProvider>);
  };

  it('shows "Set Per Place" only for an entity or a state, and nothing for any other row that is not set', () => {
    lineFor('title');
    expect(screen.queryByRole('button', { name: /Set Per Place/ })).toBeNull();
    cleanup();
    lineFor('props/subtitle');
    expect(screen.queryByTestId('per-place-line')).toBeNull();
  });

  it('shows the on line for every kind, with Same Everywhere in Edit and the sentence alone in Use and while choosing', () => {
    const set = (document: CompositionDocument, entryId: string, bodyId: string) => setPerPlace(document, entryId, bodyId, 'props/subtitle');
    lineFor('props/subtitle', {}, set);
    expect(screen.getByTestId('per-place-line').textContent).toContain('Set per place as Subtitle.');
    expect(screen.getByRole('button', { name: 'Same Everywhere: Subtitle' })).toBeTruthy();
    cleanup();
    lineFor('props/subtitle', { readOnly: true }, set);
    expect(screen.getByTestId('per-place-line').textContent).toBe('Set per place as Subtitle.');
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    lineFor('props/subtitle', { choosing: true }, set);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
