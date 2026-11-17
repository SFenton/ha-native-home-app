// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replaceAt } from '../src/composition-editor';
import { buildDocumentIndex } from '../src/preview2/model';
import { componentReferences } from '../src/shared/composition/components';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { insertPlace, saveAsComponent } from '../src/workspace2/linked';
import { endOf } from '../src/workspace2/add/insert';
import LinkedQuestion from '../src/workspace2/LinkedQuestion';
import { useLinkedGate } from '../src/workspace2/useLinkedGate';

afterEach(cleanup);
type J = Record<string, any>;

/** The first-slice fixture with a saved text used in two places (invented ids only). */
function twoPlaces(): { document: CompositionDocument; entryId: string; first: string; second: string } {
  const base: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  base.pages[2].components = [{ id: 'note', title: 'Note', type: 'text', layout: { span: 1 }, props: { value: { type: 'literal', value: 'Hello' }, style: 'body', unavailableText: 'None' } }];
  const saved = saveAsComponent(base as CompositionDocument, ['pages', 2, 'components', 0], 'Note Text');
  const entryId = saved.document.componentLibrary![0].id;
  const page = endOf(saved.document, `page:${base.pages[2].id}`)!;
  const added = insertPlace(saved.document, entryId, page);
  return { document: added.document, entryId, first: 'note', second: added.key.slice(5) };
}
const edit = (document: CompositionDocument, value: string) => replaceAt(document, ['componentLibrary', 0, 'node', 'props', 'value', 'value'], value);

function setup() {
  const fixture = twoPlaces();
  let current = fixture.document;
  const applied: CompositionDocument[] = [];
  const studio = { get document() { return current; }, latestDocument: () => current, apply: vi.fn((next: CompositionDocument) => { current = next; applied.push(next); }) } as any;
  const select = vi.fn();
  const hook = renderHook(({ selection }) => useLinkedGate({ studio, document: current, index: buildDocumentIndex(current), selection, surface: undefined, select }), { initialProps: { selection: `node:${fixture.first}` as any } });
  return { ...fixture, hook, studio, applied, select, now: () => current };
}

describe('the edit question gate', () => {
  it('lets a change to a plain node through untouched', () => {
    const { hook, studio, document } = setup();
    act(() => hook.result.current.apply(replaceAt(document, ['name'], 'Other')));
    expect(studio.apply).toHaveBeenCalledTimes(1);
    expect(hook.result.current.question).toBeUndefined();
  });

  it('holds a change to a component used in two places and writes nothing', () => {
    const { hook, studio, document } = setup();
    act(() => hook.result.current.apply(edit(document, 'Changed')));
    expect(studio.apply).not.toHaveBeenCalled();
    expect(hook.result.current.question).toMatchObject({ name: 'Note Text', count: 1, step: 'ask' });
  });

  it('writes the held change on Update and lets later edits in that place through until the selection leaves', () => {
    const { hook, studio, document, now, second } = setup();
    act(() => hook.result.current.apply(edit(document, 'One')));
    act(() => hook.result.current.update());
    expect(studio.apply).toHaveBeenCalledTimes(1);
    expect(hook.result.current.session).toMatchObject({ name: 'Note Text', places: 2 });
    act(() => hook.result.current.apply(edit(now(), 'Two')));
    expect(studio.apply).toHaveBeenCalledTimes(2);
    hook.rerender({ selection: `node:${second}` as any });
    expect(hook.result.current.session).toBeUndefined();
    act(() => hook.result.current.apply(edit(now(), 'Three')));
    expect(studio.apply).toHaveBeenCalledTimes(2);
    expect(hook.result.current.question).toBeDefined();
  });

  it('writes nothing on Cancel', () => {
    const { hook, studio, document } = setup();
    act(() => hook.result.current.apply(edit(document, 'Nope')));
    act(() => hook.result.current.cancel());
    expect(studio.apply).not.toHaveBeenCalled();
    expect(hook.result.current.question).toBeUndefined();
  });

  it('forks on Save as New: two writes, the old component keeps its text, this place links to the new one', () => {
    const { hook, studio, document, now, first, entryId } = setup();
    act(() => hook.result.current.apply(edit(document, 'Forked')));
    act(() => hook.result.current.toName());
    expect(hook.result.current.question?.step).toBe('name');
    act(() => hook.result.current.saveNew('Note Text Two'));
    expect(studio.apply).toHaveBeenCalled();
    const library = now().componentLibrary!;
    expect(library.map(entry => entry.name)).toEqual(['Note Text', 'Note Text Two']);
    expect((library[0].node as J).props.value.value).toBe('Hello');
    expect((library[1].node as J).props.value.value).toBe('Forked');
    const place = componentReferences(now()).find(use => use.ref.id === first)!;
    expect(place.ref.componentId).toBe(library[1].id);
    expect(componentReferences(now()).filter(use => use.ref.componentId === entryId)).toHaveLength(1);
  });

  it('asks nothing for a component with one use', () => {
    const { hook, studio, document, second } = setup();
    const lone = replaceAt(document, ['pages', 2, 'components'], (document.pages[2].components as unknown[]).filter((item: any) => item.id !== second));
    studio.latestDocument = () => lone;
    act(() => hook.result.current.apply(edit(lone, 'Solo')));
    expect(studio.apply).toHaveBeenCalledTimes(1);
  });
});

describe('the edit question dialog', () => {
  function open() {
    const made = setup();
    const view = render(<LinkedQuestion gate={made.hook.result.current}/>);
    act(() => made.hook.result.current.apply(edit(made.document, 'Asked')));
    view.rerender(<LinkedQuestion gate={made.hook.result.current}/>);
    return { ...made, view };
  }

  it('is an alert dialog with three choices and no default focus on a button', async () => {
    const { hook } = open();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Update “Note Text” everywhere?');
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Update Template', 'Save as New Template…', 'Cancel']);
    expect(window.document.activeElement).not.toBeInstanceOf(HTMLButtonElement);
    expect(hook.result.current.question).toBeDefined();
  });

  it('Update Template writes the change', async () => {
    const { hook, studio, view } = open();
    fireEvent.click(await screen.findByText('Update Template'));
    expect(studio.apply).toHaveBeenCalledTimes(1);
    view.rerender(<LinkedQuestion gate={hook.result.current}/>);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('Cancel writes nothing', async () => {
    const { studio } = open();
    fireEvent.click(await screen.findByText('Cancel'));
    expect(studio.apply).not.toHaveBeenCalled();
  });
});
