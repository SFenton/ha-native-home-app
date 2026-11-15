// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { buildDocumentIndex, type SelectionKey } from '../src/preview2/model';
import { drawnTypes } from '../src/preview2/nodes/registry';
import { renderProbe } from '../src/preview2/probe';
import { emptyOverlay, houseFrom, type House, type Overlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props, type PreviewSurface } from '../src/preview2/Preview2';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { compositionChildren } from '../src/shared/composition/schema';

afterEach(() => { cleanup(); renderProbe.onNode = undefined; });

const corpus = path.resolve(__dirname, '../contract/corpus/accept');
const corpusDocuments = readdirSync(corpus).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(path.join(corpus, name), 'utf8')).document as CompositionDocument);
const home = homeDomains.document as unknown as CompositionDocument;

function walk(document: CompositionDocument, visit: (node: CompositionNode) => void) {
  const each = (node: CompositionNode) => { visit(node); compositionChildren(node).forEach(each); };
  [...document.pages, ...document.modals].forEach(surface => surface.components.forEach(each));
}
/** The first node of `type` anywhere in the corpus or the home fixture, with the document it lives in. */
function find(type: string): { document: CompositionDocument; node: CompositionNode } | undefined {
  for (const document of [home, ...corpusDocuments]) {
    let node: CompositionNode | undefined;
    walk(document, candidate => { if (!node && candidate.type === type) node = candidate; });
    if (node) return { document, node };
  }
}
/** A one-page document holding `components`, with the sources and local state of `from`. */
function pageOf(from: CompositionDocument, components: CompositionNode[], extra: Partial<CompositionDocument> = {}): CompositionDocument {
  const base = from.pages[0];
  return { ...from, navigation: { ...from.navigation, tabs: [], initialPageId: base.id, initialTabId: null }, pages: [{ ...base, toolbar: { type: 'inherit' }, components }], modals: [], ...extra };
}
function props(document: CompositionDocument, over: Partial<Preview2Props> = {}): Preview2Props {
  return {
    document, mode: 'edit', surface: { kind: 'page', id: document.pages[0].id }, onSurfaceChange: vi.fn(), onSelect: vi.fn(), window: previewWindows[0], bezel: false,
    house: demoHouse(document), overlay: emptyOverlay, onOverlayChange: vi.fn(), ...over,
  };
}
const mount = (document: CompositionDocument, over: Partial<Preview2Props> = {}) => { const p = props(document, over); return { ...render(<Preview2 {...p}/>), props: p }; };
const nodeEl = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;

/** The shell's job in a test: it keeps the selection and the surface and passes them back down. */
function Shell({ document, mode = 'edit', start, house, onCall }: { document: CompositionDocument; mode?: 'edit' | 'use'; start?: PreviewSurface; house?: House; onCall?: (summary: string) => void }) {
  const [selection, setSelection] = useState<SelectionKey>();
  const [surface, setSurface] = useState<PreviewSurface>(start ?? { kind: 'page', id: document.pages[0].id });
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
  return <>
    <output data-testid="selection">{selection ?? 'none'}</output><output data-testid="surface">{surface.kind}:{surface.id}</output><output data-testid="overlay">{JSON.stringify(overlay.entities)}</output>
    <Preview2 document={document} mode={mode} surface={surface} onSurfaceChange={setSurface} selection={selection} onSelect={setSelection} window={previewWindows[0]} bezel={false}
      house={house ?? demoHouse(document)} overlay={overlay} onOverlayChange={setOverlay} onSimulatedCall={onCall}/>
  </>;
}

const phaseOne = ['tile-grid', 'section', 'status-rail', 'room-section', 'paged-row', 'local-tabs', 'text', 'info-box', 'status-pill', 'row', 'settings-link', 'primary-button',
  'navigation-tile', 'action-tile', 'status-chip', 'room-overview-tile', 'light-group-tile', 'room-card', 'room-chip', 'camera-tile', 'bound-control', 'local-control'] as const;

describe('Preview2 node registry', () => {
  it('draws every phase-1 node type from a fixture node, and no placeholder for it', () => {
    expect([...drawnTypes].sort()).toEqual([...phaseOne, 'account-header'].sort());
    for (const type of phaseOne) {
      const hit = find(type);
      expect(hit, `a fixture node of type ${type}`).toBeDefined();
      const { container } = mount(pageOf(hit!.document, [hit!.node]));
      const frame = nodeEl(container, hit!.node.id);
      expect(frame, type).not.toBeNull();
      expect(frame.getAttribute('data-type')).toBe(type);
      expect(frame.querySelector(':scope > .sh-placeholder'), `${type} is not a placeholder`).toBeNull();
      cleanup();
    }
  });

  it('draws the account header with its fallback name', () => {
    const base = find('text')!.document;
    const node = { id: 'who', title: 'Who', type: 'account-header', layout: { span: 1 }, binding: { sourceId: 'x', projection: 'profile-account@1' },
      props: { fallbackName: 'Sam', loadingText: 'Loading', unavailableText: 'Unavailable' } } as CompositionNode;
    mount(pageOf(base, [node]));
    expect(screen.getByText('Sam')).toBeTruthy();
  });

  it('draws a tile-shaped placeholder with the title, the type and the tag for a type it cannot draw', () => {
    const hit = find('weather-panel')!;
    const { container } = mount(pageOf(hit.document, [hit.node]));
    const frame = nodeEl(container, hit.node.id);
    const placeholder = frame.querySelector('.sh-placeholder')!;
    expect(within(placeholder as HTMLElement).getByText(hit.node.title)).toBeTruthy();
    expect(within(placeholder as HTMLElement).getByText('weather-panel')).toBeTruthy();
    expect(within(placeholder as HTMLElement).getByText('Shown in the App')).toBeTruthy();
  });

  it('shows the state of a status chip and the title of a tile from the house', () => {
    const hit = find('status-chip')!;
    const { container } = mount(pageOf(hit.document, [hit.node]));
    expect(nodeEl(container, hit.node.id).textContent).not.toBe('');
  });
});

describe('Preview2 selection', () => {
  const chips = () => { const hit = find('status-chip')!; return { document: home, id: hit.node.id }; };

  it('a click in Edit selects the data-sel key and does not run the node', () => {
    const { document, id } = chips();
    const { container, props: p } = mount(document, { surface: { kind: 'page', id: 'page-home' } });
    fireEvent.click(nodeEl(container, id));
    expect(p.onSelect).toHaveBeenCalledWith(`node:${id}`);
    expect(p.onSurfaceChange).not.toHaveBeenCalled();
  });

  it('a click on the page title or the wallpaper selects the page; a header button selects its chrome item', () => {
    const { container, props: p } = mount(home, { surface: { kind: 'page', id: 'page-home' } });
    fireEvent.click(container.querySelector('.sh-large-title')!);
    expect(p.onSelect).toHaveBeenLastCalledWith('page:page-home');
    fireEvent.click(container.querySelector('.sh-wall')!);
    expect(p.onSelect).toHaveBeenLastCalledWith('page:page-home');
    fireEvent.click(screen.getByRole('button', { name: 'Sections' }));
    expect(p.onSelect).toHaveBeenLastCalledWith('chrome-item:fixture-menu');
  });

  it('a tab tap in Edit selects the tab and opens its page', () => {
    const { props: p } = mount(home, { surface: { kind: 'page', id: 'page-home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    expect(p.onSelect).toHaveBeenCalledWith('tab:hc-tab-security');
    expect(p.onSurfaceChange).toHaveBeenCalledWith({ kind: 'page', id: 'page-security' });
  });

  it('draws the ring and an empty handle slot on the selected node only', () => {
    const { id } = chips();
    const { container } = render(<Shell document={home} start={{ kind: 'page', id: 'page-home' }}/>);
    fireEvent.click(nodeEl(container, id));
    const frame = nodeEl(container, id);
    expect(frame.hasAttribute('data-selected')).toBe(true);
    const slot = frame.querySelector('.sh-handle-slot');
    expect(slot).not.toBeNull();
    expect(slot!.childNodes).toHaveLength(0);
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(1);
    expect(container.querySelectorAll('.sh-handle-slot')).toHaveLength(1);
  });

  it('Esc selects the parent, then the page, then nothing', () => {
    const { id } = chips();
    const { container } = render(<Shell document={home} start={{ kind: 'page', id: 'page-home' }}/>);
    fireEvent.click(nodeEl(container, id));
    const selection = () => screen.getByTestId('selection').textContent;
    const esc = () => fireEvent.keyDown(container.querySelector('.sh-layer')!, { key: 'Escape' });
    expect(selection()).toBe(`node:${id}`);
    esc(); expect(selection()).toBe('node:hc-status-rail');
    esc(); expect(selection()).toBe('page:page-home');
    esc(); expect(selection()).toBe('none');
  });

  it('Use does not select and draws no ring', () => {
    const { id } = chips();
    const { container, props: p } = mount(home, { mode: 'use', surface: { kind: 'page', id: 'page-home' }, selection: `node:${id}` });
    fireEvent.click(nodeEl(container, id));
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('[data-selected]')).toBeNull();
  });

  it('shows the local tab that holds the selection', () => {
    const index = buildDocumentIndex(home);
    const tabs = [...index.entries.values()].find(entry => entry.node?.type === 'local-tabs')!;
    const node = tabs.node as Extract<CompositionNode, { type: 'local-tabs' }>;
    const last = node.tabs.at(-1)!;
    const inner = last.children[0];
    const page = index.get(`node:${inner.id}`)!.surface!.replace(/^[a-z]+:/, '');
    const { container } = mount(home, { surface: { kind: tabs.surface!.startsWith('modal:') ? 'modal' : 'page', id: page }, selection: `node:${inner.id}` });
    expect(container.querySelector(`[data-sel="node:${tabs.id}"] [data-tab="${last.id}"]`)).not.toBeNull();
    expect(nodeEl(container, inner.id).hasAttribute('data-selected')).toBe(true);
  });

  it('scrolls the reveal target above a narrow sheet', () => {
    const scrollTo = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollTo });
    const { id } = chips();
    mount(home, { surface: { kind: 'page', id: 'page-home' }, revealKey: `node:${id}`, bottomInset: 320 });
    expect(scrollTo).toHaveBeenCalled();
    expect(scrollTo.mock.calls[0][0].top).toBeGreaterThan(0);
    // @ts-expect-error restore the jsdom default of no Element.scrollTo
    delete Element.prototype.scrollTo;
  });
});

describe('Preview2 rules', () => {
  const rule = (entityId: string) => ({ type: 'state' as const, sourceId: 'lamp', path: ['state'], in: ['on'] });
  function ruled() {
    const hit = find('navigation-tile')!;
    const node = { ...hit.node, id: 'ruled', title: 'Kitchen lamp', visibleWhen: rule('light.demo_kitchen'), whenUnknown: 'hide' } as CompositionNode;
    const lamp = { id: 'lamp', kind: 'ha-entity', entityId: { type: 'literal', value: 'light.demo_kitchen' } } as CompositionDocument['dataSources'][number];
    const document = pageOf(hit.document, [node], { dataSources: [...hit.document.dataSources, lamp] });
    const house = (state: string) => houseFrom({ states: [{ entityId: 'light.demo_kitchen', name: 'Kitchen', state }] });
    return { document, house };
  }

  it('draws a node hidden by its rule at 45% with a dashed edge and the tag in Edit', () => {
    const { document, house } = ruled();
    const { container } = mount(document, { house: house('off') });
    const frame = nodeEl(container, 'ruled');
    expect(frame.hasAttribute('data-hidden')).toBe(true);
    expect(within(frame).getByText('Hidden by Rule')).toBeTruthy();
  });

  it('hides it in Use, and shows it once the rule holds', () => {
    const { document, house } = ruled();
    const hidden = mount(document, { mode: 'use', house: house('off') });
    expect(nodeEl(hidden.container, 'ruled')).toBeNull();
    cleanup();
    const shown = mount(document, { mode: 'use', house: house('on') });
    expect(nodeEl(shown.container, 'ruled')).not.toBeNull();
    expect(nodeEl(shown.container, 'ruled').hasAttribute('data-hidden')).toBe(false);
  });

  it('applies whenUnknown while the house is loading', () => {
    const { document } = ruled();
    const { container } = mount(document, { mode: 'use', house: undefined });
    expect(nodeEl(container, 'ruled')).toBeNull();
  });
});

describe('Preview2 Use actions', () => {
  const light = { entityId: 'light.demo_kitchen', name: 'Kitchen', state: 'off' };
  function button() {
    const hit = find('primary-button')!;
    const node = { ...hit.node, id: 'go', title: 'Lights on', action: { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: { type: 'literal', value: 'light.demo_kitchen' } } } } as CompositionNode;
    return pageOf(hit.document, [node]);
  }

  it('resolves a call-service into the overlay and a simulated line, never a service', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onOverlayChange = vi.fn(), onSimulatedCall = vi.fn();
    mount(button(), { mode: 'use', house: houseFrom({ states: [light] }), onOverlayChange, onSimulatedCall });
    fireEvent.click(screen.getByRole('button', { name: 'Lights on' }));
    expect(onOverlayChange).toHaveBeenCalledWith({ entities: { 'light.demo_kitchen': { state: 'on' } }, local: {} });
    expect(onSimulatedCall).toHaveBeenCalledWith('Kitchen: turn on');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing in Edit', () => {
    const onOverlayChange = vi.fn(), onSimulatedCall = vi.fn();
    mount(button(), { mode: 'edit', house: houseFrom({ states: [light] }), onOverlayChange, onSimulatedCall });
    fireEvent.click(screen.getByRole('button', { name: 'Lights on' }));
    expect(onOverlayChange).not.toHaveBeenCalled();
    expect(onSimulatedCall).not.toHaveBeenCalled();
  });

  it('runs a bound toggle through its on and off actions and shows the new state', () => {
    const hit = find('bound-control')!;
    const document = pageOf(hit.document, [{
      id: 'toggle', title: 'Kitchen', type: 'bound-control', layout: { span: 1 }, props: { kind: 'toggle', isOn: { type: 'state', sourceId: 'lamp', path: ['state'], in: ['on'] }, unavailableText: 'Unavailable' },
      onAction: { type: 'call-service', domain: 'light', service: 'turn_on', target: { entity_id: { type: 'literal', value: 'light.demo_kitchen' } } },
      offAction: { type: 'call-service', domain: 'light', service: 'turn_off', target: { entity_id: { type: 'literal', value: 'light.demo_kitchen' } } },
    } as CompositionNode], { dataSources: [{ id: 'lamp', kind: 'ha-entity', entityId: { type: 'literal', value: 'light.demo_kitchen' } }] });
    const calls: string[] = [];
    render(<Shell document={document} mode="use" house={houseFrom({ states: [light] })} onCall={line => calls.push(line)}/>);
    const toggle = screen.getByRole('switch', { name: 'Kitchen' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(calls).toEqual(['Kitchen: turn on']);
    expect(screen.getByRole('switch', { name: 'Kitchen' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('switch', { name: 'Kitchen' }));
    expect(calls).toEqual(['Kitchen: turn on', 'Kitchen: turn off']);
  });

  it('writes a set-local control into the overlay and shows it', () => {
    const hit = find('local-control')!;
    const field = hit.document.localState?.find(item => item.type === 'boolean');
    expect(field).toBeDefined();
    const node = { id: 'flag', title: 'Flag', type: 'local-control', layout: { span: 1 }, props: { stateId: field!.id, kind: 'toggle', placeholder: '' } } as CompositionNode;
    const onOverlayChange = vi.fn();
    mount(pageOf(hit.document, [node]), { mode: 'use', onOverlayChange });
    fireEvent.click(screen.getByRole('switch', { name: 'Flag' }));
    expect(onOverlayChange).toHaveBeenCalledWith({ entities: {}, local: { [field!.id]: { type: 'boolean', value: !(field as { initial: boolean }).initial } } });
  });

  it('navigates in Use: a tile pushes its page, back returns, a sheet opens and closes, and the surface is reported', () => {
    render(<Shell document={home} mode="use" start={{ kind: 'page', id: 'page-home' }}/>);
    const surface = () => screen.getByTestId('surface').textContent;
    expect(surface()).toBe('page:page-home');
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    expect(surface()).toBe('page:page-security');
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(surface()).toBe('page:page-home');
    const chip = document_chip();
    fireEvent.click(chip);
    expect(surface()).toBe('modal:hc-overview-lights');
    expect(screen.getByRole('dialog', { name: 'Lights' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(surface()).toBe('page:page-home');
  });

  function document_chip() {
    const chip = screen.getAllByRole('button').find(item => item.closest('[data-sel="node:hc-chip-0"]'));
    return chip!;
  }
});

describe('Preview2 same-frame edits', () => {
  it('re-renders the edited node and not its siblings', () => {
    const hit = find('navigation-tile')!;
    const tile = (id: string) => ({ ...hit.node, id, title: id }) as CompositionNode;
    const [a, b, c] = [tile('a'), tile('b'), tile('c')];
    const before = pageOf(hit.document, [a, b, c]);
    const seen: string[] = [];
    renderProbe.onNode = id => seen.push(id);
    const p = props(before);
    const { rerender } = render(<Preview2 {...p}/>);
    expect(seen.sort()).toEqual(['a', 'b', 'c']);
    seen.length = 0;
    const edited = { ...b, title: 'Renamed' } as CompositionNode;
    const after = { ...before, pages: [{ ...before.pages[0], components: [a, edited, c] }, ...before.pages.slice(1)] };
    rerender(<Preview2 {...p} document={after}/>);
    expect(seen).toEqual(['b']);
    expect(screen.getByText('Renamed')).toBeTruthy();
  });
});

describe('Preview2 over the home fixture', () => {
  it('renders every page and every sheet in Edit and Use without throwing', () => {
    const surfaces: PreviewSurface[] = [...home.pages.map(page => ({ kind: 'page' as const, id: page.id })), ...home.modals.map(modal => ({ kind: 'modal' as const, id: modal.id }))];
    for (const surface of surfaces) {
      for (const mode of ['edit', 'use'] as const) {
        const { container, unmount } = render(<Preview2 {...props(home, { mode, surface })}/>);
        expect(container.querySelector(surface.kind === 'page' ? '.sh-page[data-current]' : '.sh-sheet'), `${mode} ${surface.kind} ${surface.id}`).not.toBeNull();
        unmount();
      }
    }
  });

  it('draws the page title, the header buttons from chrome and the tab bar from navigation tabs', () => {
    const { container } = mount(home, { surface: { kind: 'page', id: 'page-security' } });
    expect(container.querySelector('.sh-page[data-current] .sh-large-title')!.textContent).toBe('Security');
    expect(screen.getByRole('button', { name: 'Sections' })).toBeTruthy();
    const tabs = within(screen.getByRole('navigation', { name: 'Tabs' })).getAllByRole('button');
    expect(tabs.map(tab => tab.textContent)).toEqual(['Home', 'Security', 'Climate']);
    expect(tabs[1].getAttribute('aria-current')).toBe('page');
  });

  it('draws a presented sheet over its presenting page, and a sheet nothing presents over an empty base', () => {
    const over = mount(home, { surface: { kind: 'modal', id: 'hc-overview-lights' } });
    expect(over.container.querySelector('.sh-page[data-page="page-home"]')).not.toBeNull();
    expect(over.container.querySelector('.sh-screen')!.hasAttribute('data-covered')).toBe(true);
    cleanup();
    const orphan = { ...home, pages: home.pages.map(page => ({ ...page, components: [] })) };
    const empty = mount(orphan, { surface: { kind: 'modal', id: 'hc-overview-lights' } });
    expect(empty.container.querySelector('.sh-page')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows a fitted sheet and a full sheet by their height attribute', () => {
    const fitted = structuredClone(home);
    fitted.modals[0].presentation.height = { type: 'fitted', follows: 'root', firstOpen: 'canonical@1' };
    const { container } = mount(fitted, { surface: { kind: 'modal', id: fitted.modals[0].id } });
    expect(container.querySelector('.sh-sheet')!.getAttribute('data-height')).toBe('fitted');
  });
});
