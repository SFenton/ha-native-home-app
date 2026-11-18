// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { componentReferences } from '../src/shared/composition/components';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { newStateTile } from '../src/shared/composition/state-style-library';
import { buildDocumentIndex } from '../src/preview2/model';
import { endOf } from '../src/workspace2/add/insert';
import { insertPlace, saveAsComponent } from '../src/workspace2/linked';
import { setPerPlace } from '../src/workspace2/params';
import AddPicker from '../src/workspace2/add/AddPicker';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import SavedComponents from '../src/workspace2/SavedComponents';
import { resetTemplateFold } from '../src/workspace2/TemplateFold';
import { Project } from './support/workspace2-surfaces';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({ epoch: 'e', current: null, history: [], storedAssets: 0 })) }));
afterEach(cleanup);
beforeEach(() => resetTemplateFold());
type J = Record<string, any>;

/** A template of two state tiles in a section (invented entities), placed twice. */
function template(params = false) {
  const base: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  const lamp = (id: string): J => ({ ...newStateTile('switch.demo_lamp', id, undefined, undefined)!, id });
  base.pages[2].components = [{
    id: 'demo-row', title: 'Demo Row', type: 'section', layout: { span: 1 },
    props: { header: 'S', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } },
    children: [lamp('demo-first'), lamp('demo-second')],
  }];
  const saved = saveAsComponent(base as CompositionDocument, ['pages', 2, 'components', 0], 'Lamp Row');
  const entry = saved.document.componentLibrary![0];
  const added = insertPlace(saved.document, entry.id, endOf(saved.document, `page:${base.pages[2].id}`)!);
  let document = added.document;
  if (params) document = setPerPlace(document, entry.id, (entry.node as J).children[0].id, 'binding/entityId');
  return { document, entry: document.componentLibrary![0], first: componentReferences(document)[0].ref.id, inner: (entry.node as J).children[0].id as string };
}

function mount(document: CompositionDocument, key: string, mode: 'edit' | 'use' = 'edit') {
  const index = buildDocumentIndex(document), entry = index.get(key as never)!;
  const apply = vi.fn();
  const ws = Project.workspace(document, { kind: 'node', key: entry.key, path: entry.path } as never, { extra: { mode, linked: { session: undefined, say: vi.fn() } } as never }, apply);
  const view = render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
  return { apply, view };
}

describe('a placed template (templates spec 3a-B)', () => {
  it('shows its settings first, then Width, then the template row closed, then Advanced', () => {
    const { document, first } = template(true);
    mount(document, `node:${first}`);
    const settings = screen.getByTestId('component-settings'), fold = screen.getByTestId('template-fold'), advanced = document_advanced();
    expect(settings.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fold.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(settings).getByRole('button', { name: 'Entity' })).toBeTruthy();
    expect(settings.querySelector('h3')).toBeNull();
    const head = within(fold).getByRole('button', { name: 'Lamp Row, template, used in 2 places' });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(head.textContent).toContain('Lamp Row');
    expect(head.textContent).toContain('Template · Used in 2 places');
    expect(screen.queryByTestId('component-parameters')).toBeNull();
  });

  it('names the header for the template, and the line says which template, then where', () => {
    const { document, first } = template(true);
    mount(document, `node:${first}`);
    const header = document_header();
    expect(within(header).getByRole('heading', { level: 2 }).textContent).toBe('Lamp Row');
    expect(header.textContent).toContain('Template ·');
  });

  it('opens to the line, the template\'s fields and the Parameters, and remembers it for the template', () => {
    const { document, first } = template(true);
    const { view } = mount(document, `node:${first}`);
    fireEvent.click(screen.getByRole('button', { name: /Lamp Row, template/ }));
    const fold = screen.getByTestId('template-fold');
    expect(within(fold).getByTestId('linked-line').textContent).toBe('A change here asks first.');
    expect(within(fold).getByTestId('component-parameters')).toBeTruthy();
    view.unmount();
    mount(document, `node:${first}`);
    expect(screen.getByRole('button', { name: /Lamp Row, template/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('with no settings there is no settings block and the template row is open', () => {
    const { document, first } = template(false);
    mount(document, `node:${first}`);
    expect(screen.queryByTestId('component-settings')).toBeNull();
    expect(screen.getByRole('button', { name: /Lamp Row, template/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('in Use the settings show and the template\'s fields wait for Edit', () => {
    const { document, first } = template(true);
    mount(document, `node:${first}`, 'use');
    expect(screen.getByTestId('component-settings')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Lamp Row, template/ }));
    expect(screen.queryByTestId('component-parameters')).toBeNull();
    expect(screen.queryByText('Set Per Place')).toBeNull();
  });

  it('an entity setting picks from every entity, with the default\'s domain chip pressed, and writes this place only', () => {
    const { document, first } = template(true);
    const { apply } = mount(document, `node:${first}`);
    const row = within(screen.getByTestId('component-settings')).getByRole('button', { name: 'Entity' });
    expect(row.textContent).toContain('switch.demo_lamp');
    expect(within(screen.getByTestId('component-settings')).queryByText('Demo Lamp')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('Set Per Place under a template\'s field', () => {
  const field = (document: CompositionDocument, inner: string, first: string) => `node:${first}~${inner}`;

  it('shows "Set Per Place" under an entity field of a node in a template, named for the field', () => {
    const { document, first, inner } = template(false);
    mount(document, field(document, inner, first));
    const button = screen.getByRole('button', { name: 'Set Per Place: Entity' });
    expect(button.textContent).toBe('Set Per Place');
    // WCAG 2.5.3: the accessible name starts with the visible words.
    expect(button.getAttribute('aria-label')!.startsWith(button.textContent!)).toBe(true);
  });

  it('creates the setting at once when there is none of that kind, as one write', () => {
    const { document, first, inner, entry } = template(false);
    const { apply } = mount(document, field(document, inner, first));
    fireEvent.click(screen.getByRole('button', { name: 'Set Per Place: Entity' }));
    expect(apply).toHaveBeenCalledTimes(1);
    const next = apply.mock.calls[0][0] as CompositionDocument;
    expect(next.componentLibrary![0].params).toEqual([{ name: 'entity', kind: 'entity-id', label: 'Entity' }]);
    expect(entry.params).toBeUndefined();
    expect(() => compileCompositionDocument(next)).not.toThrow();
  });

  it('with a setting of that kind it offers Use and New Setting', async () => {
    const { document, first, entry } = template(true);
    const second = (entry.node as J).children[1].id as string;
    const { apply } = mount(document, field(document, second, first));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Set Per Place: Entity' })); });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Use Entity', 'New Setting']);
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitem', { name: 'Use Entity' })); });
    const next = apply.mock.calls[0][0] as CompositionDocument;
    expect(next.componentLibrary![0].bindings).toHaveLength(2);
    expect(next.componentLibrary![0].params).toHaveLength(1);
  });

  it('once set it says so, and Same Everywhere writes the removal', () => {
    const { document, first, inner } = template(true);
    const { apply } = mount(document, field(document, inner, first));
    expect(screen.getByText('Set per place as Entity.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Same Everywhere: Entity' });
    expect(button.textContent).toBe('Same Everywhere');
    expect(button.getAttribute('aria-label')!.startsWith(button.textContent!)).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe(screen.getByText('Set per place as Entity.').id);
    fireEvent.click(button);
    expect((apply.mock.calls[0][0] as CompositionDocument).componentLibrary![0].params).toBeUndefined();
  });

  it('is not offered in Use, and not on a field that cannot be a setting', () => {
    const { document, first, inner } = template(false);
    mount(document, field(document, inner, first), 'use');
    expect(screen.queryByRole('button', { name: /per place/i })).toBeNull();
  });
});

describe('the parameters list', () => {
  it('a parameter opens in place to its label, what it fills and Remove Parameter, and a new label is written and shown', () => {
    const { document, first } = template(true);
    const { apply } = mount(document, `node:${first}`);
    fireEvent.click(screen.getByRole('button', { name: /Lamp Row, template/ }));
    const list = screen.getByTestId('component-parameters');
    fireEvent.click(within(list).getByRole('button', { name: /^Entity/ }));
    expect(within(list).getByText(/^Fills Entity of /)).toBeTruthy();
    const input = within(list).getByRole('textbox', { name: 'Label' });
    fireEvent.change(input, { target: { value: 'Light' } });
    fireEvent.blur(input);
    const next = apply.mock.calls[0][0] as CompositionDocument;
    expect(next.componentLibrary![0].params).toEqual([{ name: 'entity', kind: 'entity-id', label: 'Light' }]);
  });

  it('shows the label in the settings of a place', () => {
    const { document, first, entry } = template(true);
    const labelled = { ...document, componentLibrary: [{ ...entry, params: [{ name: 'entity', kind: 'entity-id', label: 'Light' }] }] } as CompositionDocument;
    mount(labelled, `node:${first}`);
    expect(within(screen.getByTestId('component-settings')).getByRole('button', { name: 'Light' })).toBeTruthy();
  });

  it('refuses a label over 80 characters and says why', () => {
    const { document, first } = template(true);
    const { apply } = mount(document, `node:${first}`);
    fireEvent.click(screen.getByRole('button', { name: /Lamp Row, template/ }));
    const list = screen.getByTestId('component-parameters');
    fireEvent.click(within(list).getByRole('button', { name: /^Entity/ }));
    const input = within(list).getByRole('textbox', { name: 'Label' }) as HTMLInputElement;
    expect(input.maxLength).toBe(80);
    fireEvent.change(input, { target: { value: 'a​b' } });
    expect(screen.getByRole('alert').textContent).toMatch(/1 to 80/);
    fireEvent.blur(input);
    expect(apply).not.toHaveBeenCalled();
  });
});

function document_advanced(): HTMLElement { return window.document.querySelector<HTMLElement>('.w2-advanced:not(.w2-template-fold)')!; }
function document_header(): HTMLElement { return window.document.querySelector<HTMLElement>('.w2-props-head')!; }

describe('the phone Add sheet\'s Templates segment', () => {
  const picker = (document: CompositionDocument, onAdd: (id: string) => void, withTemplates = true) => {
    const ws = Project.workspace(document, undefined, { extra: { linked: { session: undefined, say: vi.fn() } } as never });
    const destination = { owner: `page:${document.navigation.initialPageId}`, list: ['pages', 0, 'components'], index: 0 } as never;
    return render(<AddPicker document={document} destination={destination} onChoose={() => {}} onClose={() => {}}
      templates={withTemplates ? query => <SavedComponents ws={ws} query={query} disabled={false} onAdd={onAdd}/> : undefined}/>);
  };

  it('is the middle of three segments, lists the templates with their use count, and a tap adds a place', () => {
    const { document, entry } = template(false);
    const onAdd = vi.fn();
    picker(document, onAdd);
    const segment = screen.getByRole('group', { name: 'Kind' });
    expect(within(segment).getAllByRole('button').map(button => button.textContent)).toEqual(['Tiles', 'Templates', 'Entities']);
    expect(screen.getByRole('searchbox', { name: 'Search tiles, templates and entities' })).toBeTruthy();
    fireEvent.click(within(segment).getByRole('button', { name: 'Templates' }));
    const row = screen.getByTestId('saved-row');
    expect(row.textContent).toContain('Lamp Row');
    expect(within(row).getByTitle('Used in 2 places').textContent).toBe('2');
    expect(within(row).getByRole('button', { name: 'More for Lamp Row' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /Add Lamp Row/ })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: /^Lamp Row, template/ }));
    expect(onAdd).toHaveBeenCalledWith(entry.id);
  });

  it('shows the empty line with no templates, and "Nothing matches." for a search with no match', () => {
    const { document } = template(false);
    picker({ ...document, componentLibrary: undefined }, vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    expect(screen.getByTestId('saved-empty').textContent).toBe('No templates yet. Choose Save as Template from a component’s More menu.');
    cleanup();
    picker(document, vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matches.')).toBeTruthy();
  });

  it('is not there on a wide screen, where the library holds the templates', () => {
    const { document } = template(false);
    picker(document, vi.fn(), false);
    expect(screen.queryByRole('button', { name: 'Templates' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search tiles and entities' })).toBeTruthy();
  });
});

describe('the template editor in Use (studio-tpl-ux)', () => {
  function editor(mode: 'edit' | 'use') {
    const { document, entry } = template(true);
    const apply = vi.fn();
    const ws = Project.workspace(document, { kind: 'template', id: entry.id } as never, { extra: { mode, linked: { session: undefined, say: vi.fn() }, openTemplate: vi.fn(), setUsesId: vi.fn() } as never }, apply);
    render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
    return { apply, entry };
  }

  it.each(['edit', 'use'] as const)('draws no Partly Folded row for a template root in %s: only a page\'s sections take a side', mode => {
    editor(mode);
    const editorEl = screen.getByTestId('template-editor');
    expect(editorEl.querySelector('[data-fold-caption]')).toBeNull();
    expect(within(editorEl).queryByText('Partly Folded')).toBeNull();
  });

  it('reads only: Name, Add to Page, Delete and every field of the root are disabled, and nothing has been written', () => {
    const { apply } = editor('use');
    const editorEl = screen.getByTestId('template-editor');
    expect((within(editorEl).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).disabled).toBe(true);
    expect((within(editorEl).getByRole('button', { name: 'Add to Page' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(editorEl).getByRole('button', { name: 'Delete Template…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(editorEl).queryByRole('button', { name: 'Choose Fields…' })).toBeNull();
    const fields = editorEl.querySelector('fieldset.w2-tpl-editor-fields') as HTMLFieldSetElement;
    expect(fields.disabled).toBe(true);
    const controls = [...fields.querySelectorAll('input, textarea, select, button')];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.filter(control => !control.matches(':disabled'))).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
  });

  it('is editable in Edit, with Choose Fields in its own padded group', () => {
    editor('edit');
    const editorEl = screen.getByTestId('template-editor');
    expect((within(editorEl).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).disabled).toBe(false);
    expect((editorEl.querySelector('fieldset.w2-tpl-editor-fields') as HTMLFieldSetElement).disabled).toBe(false);
    expect(within(editorEl.querySelector('.w2-tpl-editor-choose') as HTMLElement).getByRole('button', { name: 'Choose Fields…' })).toBeTruthy();
  });
});
