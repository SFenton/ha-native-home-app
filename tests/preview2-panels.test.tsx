// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compositionChildren, compositionNodeSchema, type CompositionDocument, type CompositionNode } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { hiddenNodeTypes } from '../src/preview2/model';
import { drawnTypes } from '../src/preview2/nodes/registry';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
const corpus = path.resolve(__dirname, '../contract/corpus/accept');
const documents = [homeDomains.document as unknown as CompositionDocument, ...readdirSync(corpus).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(path.join(corpus, name), 'utf8')).document as CompositionDocument)];

/** Every node of every type in the fixtures: the first one found, with its document. */
function firstOf(type: string): { document: CompositionDocument; node: CompositionNode } | undefined {
  for (const document of documents) {
    let node: CompositionNode | undefined;
    const each = (candidate: CompositionNode) => { if (!node && candidate.type === type) node = candidate; compositionChildren(candidate).forEach(each); };
    [...document.pages, ...document.modals].forEach(surface => surface.components.forEach(each));
    if (node) return { document, node };
  }
}
/** `camera-video` and `camera-controls` have no fixture of their own; they share the viewer's props. */
function nodeFor(type: string) {
  if (type !== 'camera-video' && type !== 'camera-controls') return firstOf(type);
  const viewer = firstOf('camera-viewer')!;
  const shared = (viewer.node as { props: unknown }).props as { sourceId: string };
  const props = type === 'camera-video' ? { sourceId: shared.sourceId } : (viewer.node as { props: unknown }).props;
  return { document: viewer.document, node: { ...viewer.node, id: `demo_${type}`, type, props } as unknown as CompositionNode };
}
function mount(document: CompositionDocument, node: CompositionNode, mode: 'edit' | 'use' = 'edit') {
  const base = document.pages[0];
  const page = { ...document, navigation: { ...document.navigation, tabs: [], initialPageId: base.id, initialTabId: null }, pages: [{ ...base, toolbar: { type: 'inherit' as const }, components: [node] }], modals: [] } as CompositionDocument;
  return render(<Preview2 document={page} mode={mode} surface={{ kind: 'page', id: base.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={previewWindows[0]} bezel={false}
    house={demoHouse(page)} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
}

const mine = ['weather-panel', 'alarm-panel', 'door-tile', 'room-navigation-grid', 'room-device-control', 'bedroom-control', 'camera-video', 'camera-controls', 'camera-viewer',
  'row-collection', 'collection', 'form', 'recipe-part', 'pinned-actions', 'bootstrap-message'];

/** The `type` literal of every member of `compositionNodeSchema`. */
function schemaTypes(): string[] {
  const lazy = (compositionNodeSchema as unknown as { _zod: { def: { getter(): { options: { shape: { type: { value: string } } }[] } } } })._zod.def.getter();
  return lazy.options.map(option => option.shape.type.value);
}

describe('node types of the panels, rooms, cameras and records', () => {
  for (const type of mine) {
    it(`draws ${type} from a fixture node, in Edit and Use, and not as a placeholder`, () => {
      const hit = nodeFor(type);
      expect(hit, `a fixture node of type ${type}`).toBeDefined();
      for (const mode of ['edit', 'use'] as const) {
        const { container, unmount } = mount(hit!.document, hit!.node, mode);
        const frame = container.querySelector<HTMLElement>(`[data-sel="node:${hit!.node.id}"]`)!;
        expect(frame.getAttribute('data-type')).toBe(type);
        expect(frame.querySelector('.sh-placeholder'), `${type} in ${mode}`).toBeNull();
        expect(frame.children.length).toBeGreaterThan(0);
        unmount();
      }
    });
  }

  it('draws the alarm panel in the state its source reports, with the four modes', () => {
    const hit = firstOf('alarm-panel')!;
    const { container } = mount(hit.document, hit.node);
    const modes = container.querySelectorAll('.sh-alarm-mode');
    expect(modes).toHaveLength(hit.node.type === 'alarm-panel' ? hit.node.props.modes.length : 0);
    expect(container.querySelectorAll('.sh-alarm-mode[data-chosen]')).toHaveLength(1);
    expect(container.querySelectorAll('.sh-alarm-mode[data-selected]')).toHaveLength(0);
  });
  it('draws a camera as a poster frame and never opens a stream', () => {
    const hit = nodeFor('camera-viewer')!;
    const { container } = mount(hit.document, hit.node);
    expect(container.querySelector('video, iframe, img')).toBeNull();
    expect(container.querySelector('.sh-cam-poster')).not.toBeNull();
    expect(container.querySelectorAll('.sh-cam-control').length).toBeGreaterThan(0);
  });
  it('draws every room of the navigation source as a tile of an equal-height grid, 150 wide and at most 4 across', () => {
    const hit = firstOf('room-navigation-grid')!;
    const open = structuredClone(hit.document);
    for (const source of open.dataSources) if (source.kind === 'model' && source.model === 'room-navigation@1') source.items.forEach(item => { delete item.visibility; });
    const { container } = mount(open, hit.node);
    const grid = container.querySelector<HTMLElement>('.sh-room-grid')!;
    expect(grid.hasAttribute('data-equal')).toBe(true);
    expect(grid.style.getPropertyValue('--min')).toBe('150px');
    expect(grid.style.getPropertyValue('--max')).toBe('4');
    expect(grid.children.length).toBeGreaterThan(0);
    expect(screen.getByText('Demo A')).toBeTruthy();
  });
  it('leaves out a room whose visibility source reports another state', () => {
    const hit = firstOf('room-navigation-grid')!;
    const hidden = structuredClone(hit.document);
    for (const source of hidden.dataSources) if (source.kind === 'model' && source.model === 'room-navigation@1') source.items.forEach(item => { if (item.visibility) item.visibility.states = ['never_this_state']; });
    const { container } = mount(hidden, hit.node);
    expect(container.querySelector('.sh-room-grid')!.children).toHaveLength(0);
  });
  it('draws the bootstrap message with its title and text', () => {
    const hit = firstOf('bootstrap-message')!;
    mount(hit.document, hit.node);
    expect(screen.getByText((hit.node as { title: string }).title)).toBeTruthy();
  });
  it('draws a form field for every field it declares', () => {
    const hit = firstOf('form')!;
    const { container } = mount(hit.document, hit.node);
    expect(container.querySelectorAll('.sh-form-row')).toHaveLength(hit.node.type === 'form' ? hit.node.props.fields.length : -1);
  });
});

describe('every node type the schema accepts', () => {
  it('is drawn or hidden by the Studio; none falls back to the placeholder', () => {
    const types = schemaTypes();
    expect(types.length).toBeGreaterThan(40);
    // A component reference is expanded into its body by `Children`, so it never reaches the registry.
    expect(types.filter(type => type !== 'component-ref' && !drawnTypes.includes(type) && !hiddenNodeTypes.includes(type))).toEqual([]);
    expect(hiddenNodeTypes.every(type => types.includes(type))).toBe(true);
  });
});
