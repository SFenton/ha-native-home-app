// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { buildDocumentIndex } from '../src/preview2/model';
import { focusMapControl } from '../src/preview2/map-control-focus';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { locateButton, type SurfaceButton, type SurfaceControls } from '../src/shared/composition/surface-controls';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';
import { vacuumDocument } from './fixtures/vacuum';
import { Project } from './support/workspace2-surfaces';

/**
 * vacuum-map-ctl: what the simulator draws for the orientation and the corner groups (with the app's numbers), and the inspector's add, reorder by
 * keyboard, Move to Corner and remove.
 */
afterEach(() => { cleanup(); focusMapControl(undefined); });

const icon = { type: 'sf-symbol', name: 'star', rendering: 'canonical', unavailable: 'fallback' } as const;
const toggle = { type: 'call-service', domain: 'light', service: 'toggle', target: { entity_id: { type: 'literal', value: 'light.demo_kitchen' } } } as const;
const button = (id: string, label = id, action: SurfaceButton['action'] = toggle): SurfaceButton => ({ id, icon, label, action });
const group = (corner: SurfaceControls[number]['corner'], axis: 'row' | 'column', ...buttons: SurfaceButton[]): SurfaceControls[number] => ({ corner, axis, buttons });

function mapDocument(controls?: SurfaceControls, locateOn = false, flips?: { flipHorizontal: boolean; flipVertical: boolean }): CompositionDocument {
  const document = vacuumDocument({ kind: 'map', overlay: 'rooms', height: 300, runtimeHeight: 400, label: 'Demo map', loadingText: 'Loading', unavailableText: 'Unavailable', locate: locateOn, ...(controls ? { controls } : {}) });
  const source = document.dataSources[0];
  if (source.kind === 'model' && source.model === 'vacuum@1' && flips) source.inputs.orientation = flips;
  return document as CompositionDocument;
}

// The preview measures the layer the groups sit in; jsdom lays nothing out, so give it the card's size.
let width = 343;
beforeEach(() => {
  width = 343;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('sh-dv-ctl-layer') ? width : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('sh-dv-ctl-layer') ? 300 : 0; } });
});

function draw(document: CompositionDocument, mode: 'edit' | 'use' = 'use', state = 'docked') {
  const page = document.pages[0];
  return render(<Preview2 document={document} mode={mode} surface={{ kind: 'page', id: page.id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={previewWindows[0]} bezel={false}
    house={houseFrom({ states: [{ entityId: 'vacuum.demo_robot', name: 'Robot', state }] })} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
}
const groupAt = (container: HTMLElement, corner: string) => container.querySelector<HTMLElement>(`.sh-dv-ctl[data-corner="${corner}"]`);

describe('the preview of the corner groups', () => {
  it('draws today\'s map at the defaults: Locate alone at the top leading corner, 44 pt, 8 pt in', () => {
    const { container } = draw(mapDocument(undefined, true));
    const all = container.querySelectorAll('.sh-dv-ctl');
    expect(all.length).toBe(1);
    const locateGroup = all[0] as HTMLElement;
    expect(locateGroup.dataset.corner).toBe('top-leading');
    expect(locateGroup.classList.contains('sh-dv-locate')).toBe(true);
    expect(locateGroup.style.getPropertyValue('--ctl-size')).toBe('44px');
    expect(locateGroup.style.getPropertyValue('--ctl-inset')).toBe('8px');
    expect(within(locateGroup).getByRole('button', { name: 'Locate' })).toBeTruthy();
    expect(container.querySelector('.sh-dv-map')!.getAttribute('data-flip')).toBeNull();
    expect(container.querySelector<HTMLElement>('.sh-dv-rooms')!.style.transform).toBe('');
    expect(container.querySelector('.sh-dv-map-tag')!.getAttribute('data-at')).toBeNull();
  });
  it('draws no group when `locate` is false and nothing is authored', () => {
    expect(draw(mapDocument(undefined, false)).container.querySelector('.sh-dv-ctl')).toBeNull();
  });
  it('draws a row of three at top trailing as one capsule', () => {
    const { container } = draw(mapDocument([group('top-trailing', 'row', button('a'), button('b'), button('c'))]));
    const row = groupAt(container, 'top-trailing')!;
    expect(row.dataset.axis).toBe('row');
    expect(row.style.getPropertyValue('--ctl-n')).toBe('3');
    expect([...row.querySelectorAll('button')].map(item => item.getAttribute('aria-label'))).toEqual(['a', 'b', 'c']);
  });
  it('draws a column of two at bottom leading, and moves the Live map tag to the bottom centre', () => {
    const { container } = draw(mapDocument([group('bottom-leading', 'column', button('a'), button('b'))]));
    expect(groupAt(container, 'bottom-leading')!.dataset.axis).toBe('column');
    expect(container.querySelector('.sh-dv-map-tag')!.getAttribute('data-at')).toBe('center');
  });
  it('mirrors the schematic on each flip, and never the buttons', () => {
    for (const [flips, name, transform] of [[{ flipHorizontal: true, flipVertical: false }, 'horizontal', 'scale(-1, 1)'], [{ flipHorizontal: false, flipVertical: true }, 'vertical', 'scale(1, -1)'],
      [{ flipHorizontal: true, flipVertical: true }, 'both', 'scale(-1, -1)']] as const) {
      const { container, unmount } = draw(mapDocument([group('top-leading', 'column', button('a'))], false, flips));
      expect(container.querySelector('.sh-dv-map')!.getAttribute('data-flip')).toBe(name);
      expect(container.querySelector<HTMLElement>('.sh-dv-rooms')!.style.transform).toBe(transform);
      expect(groupAt(container, 'top-leading')!.style.transform).toBe('');
      unmount();
    }
  });
  it('puts what does not fit behind More, last in its group, by the shared fit rule', () => {
    const { container } = draw(mapDocument([group('top-trailing', 'row', ...Array.from({ length: 8 }, (_, i) => button(`b${i}`, `Button ${i + 1}`)))]));
    const row = groupAt(container, 'top-trailing')!;
    expect(row.dataset.shown).toBe('6');
    expect(row.dataset.more).toBe('2');
    expect(row.style.getPropertyValue('--ctl-n')).toBe('7');
    expect(within(row).getByRole('button', { name: 'More Map Controls' })).toBeTruthy();
  });
  it('dims a source command while the robot cannot take it, and keeps a button\'s place when a rule hides it in Edit', () => {
    const { container } = draw(mapDocument([group('top-leading', 'row', button('dock', 'Dock', { type: 'source-command', command: 'dock' }))]), 'use', 'unavailable');
    const dock = within(groupAt(container, 'top-leading')!).getByRole('button', { name: 'Dock' });
    expect(dock.hasAttribute('data-dimmed')).toBe(true);
    expect(dock.getAttribute('aria-disabled')).toBe('true');
    expect(dock.getAttribute('aria-description')).toBe('Robot unavailable');
  });
  it('rings the button whose page is open', () => {
    const document = mapDocument([group('top-trailing', 'row', button('a'), button('b'))]);
    const { container } = draw(document);
    const nodeId = document.pages[0].components[0].id;
    act(() => focusMapControl({ nodeId, buttonId: 'b' }));
    expect(container.querySelector('[data-control="b"]')!.hasAttribute('data-ringed')).toBe(true);
    expect(container.querySelector('[data-control="a"]')!.hasAttribute('data-ringed')).toBe(false);
  });
});

// MARK: Inspector

function inspector(start: CompositionDocument) {
  const seen = { document: start };
  const nodeId = start.pages[0].components[0].id;
  render(<Project.Live document={start} seen={next => { seen.document = next; }}>{ws => {
    const entry = [...buildDocumentIndex(ws.document!).entries.values()].find(item => item.node?.id === nodeId)!;
    return <PropertiesPanel ws={{ ...ws, target: { kind: 'node', key: entry.key, path: entry.path } } as Workspace2} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>;
  }}</Project.Live>);
  const primitive = () => (seen.document.pages[0].components[0] as unknown as { props: { primitive: { locate: boolean; controls?: SurfaceControls } } }).props.primitive;
  const source = () => { const item = seen.document.dataSources[0]; return item.kind === 'model' && item.model === 'vacuum@1' ? item.inputs : undefined; };
  const order = () => (primitive().controls ?? []).map(item => `${item.corner}:${item.buttons.map(entry => entry.id).join(',')}`);
  return { primitive, source, order, seen };
}
const press = async (target: HTMLElement) => { await act(async () => { fireEvent.pointerDown(target, { button: 0, pointerType: 'mouse' }); fireEvent.mouseDown(target); fireEvent.click(target); }); };

describe('the Orientation group', () => {
  it('writes the flips to the vacuum source, and both off removes the object', async () => {
    const { source } = inspector(mapDocument(undefined, true));
    expect(screen.getByText('Applies everywhere this vacuum\'s map shows. Badges and buttons never mirror.')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Flip Horizontally' }));
    expect(source()!.orientation).toEqual({ flipHorizontal: true, flipVertical: false });
    fireEvent.click(screen.getByRole('switch', { name: 'Flip Vertically' }));
    expect(source()!.orientation).toEqual({ flipHorizontal: true, flipVertical: true });
    fireEvent.click(screen.getByRole('switch', { name: 'Flip Horizontally' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Flip Vertically' }));
    expect(source()!.orientation).toBeUndefined();
  });
  it('names the source it edits with a Linked tag, and keeps the rotation beside the flips', () => {
    inspector(mapDocument(undefined, true, { flipHorizontal: true, flipVertical: false }));
    expect(screen.getByText(/Linked:/)).toBeTruthy();
    expect((screen.getByRole('spinbutton', { name: 'Rotation' }) as HTMLInputElement).value).toBe('90');
    expect((screen.getByRole('switch', { name: 'Flip Horizontally' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('the Map Buttons group', () => {
  it('shows the four corners in screen order, with the default Locate at top leading', () => {
    inspector(mapDocument(undefined, true));
    expect(screen.getAllByRole('group').filter(item => /^(Top|Bottom) (Leading|Trailing)$/.test(item.getAttribute('aria-label') ?? '')).map(item => item.getAttribute('aria-label')))
      .toEqual(['Top Leading', 'Top Trailing', 'Bottom Leading', 'Bottom Trailing']);
    expect(within(screen.getByRole('group', { name: 'Top Leading' })).getByRole('button', { name: 'Locate: Locate' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Top Trailing' })).getByText('Empty')).toBeTruthy();
  });
  it('adds a button last in a corner and opens its page', async () => {
    const { primitive, order } = inspector(mapDocument([group('top-leading', 'column', button('a'))]));
    await press(screen.getByRole('button', { name: 'Add a button to Top Trailing' }));
    await press(await screen.findByRole('menuitem', { name: 'Service Call' }));
    expect(order()).toEqual(['top-leading:a', 'top-trailing:service']);
    expect(primitive().controls![1].axis).toBe('column');
    await waitFor(() => expect(screen.getByTestId('map-button-page')).toBeTruthy());
  });
  it('dims Locate in the Add menu once it is on the map', async () => {
    inspector(mapDocument(undefined, true));
    await press(screen.getByRole('button', { name: 'Add a button to Top Trailing' }));
    const item = await screen.findByRole('menuitem', { name: /Locate/ });
    expect(item.textContent).toContain('Already on the map');
    expect(item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('data-disabled')).toBe(true);
  });
  it('reorders by keyboard: Space lifts, the arrows move, Space drops, and a polite line says so', () => {
    const { order } = inspector(mapDocument([group('top-leading', 'column', button('a', 'Alpha'), button('b', 'Beta'), button('c', 'Gamma'))]));
    const grips = () => screen.getAllByRole('button', { name: /drag to move/ });
    fireEvent.keyDown(grips()[0], { key: ' ' });
    fireEvent.keyDown(grips()[0], { key: 'ArrowDown' });
    expect(order()).toEqual(['top-leading:b,a,c']);
    fireEvent.keyDown(grips()[1], { key: 'ArrowDown' });
    expect(order()).toEqual(['top-leading:b,c,a']);
    fireEvent.keyDown(grips()[2], { key: ' ' });
    expect(screen.getByRole('status').textContent).toBe('Alpha dropped.');
    fireEvent.keyDown(grips()[0], { key: ' ' });
    fireEvent.keyDown(grips()[0], { key: 'ArrowDown' });
    expect(screen.getByRole('status').textContent).toBe('Beta moved to Top Leading, position 2 of 3.');
  });
  it('moves a button to another corner from its More menu, last, and says where it landed', async () => {
    const { order } = inspector(mapDocument([group('top-leading', 'column', button('a', 'Alpha'), button('b', 'Beta')), group('bottom-leading', 'row', button('c', 'Gamma'))]));
    await press(screen.getByRole('button', { name: 'More for Alpha' }));
    await press(await screen.findByRole('menuitem', { name: 'Move to Bottom Leading' }));
    expect(order()).toEqual(['top-leading:b', 'bottom-leading:c,a']);
    expect(screen.getByRole('status').textContent).toBe('Alpha moved to Bottom Leading, position 2 of 2.');
  });
  it('removes a button, and a corner with its last one leaves the section Empty', async () => {
    const { order } = inspector(mapDocument([group('top-leading', 'column', button('a', 'Alpha')), group('bottom-leading', 'row', button('c', 'Gamma'))]));
    await press(screen.getByRole('button', { name: 'More for Alpha' }));
    await press(await screen.findByRole('menuitem', { name: 'Remove Button' }));
    expect(order()).toEqual(['bottom-leading:c']);
    expect(within(screen.getByRole('group', { name: 'Top Leading' })).getByText('Empty')).toBeTruthy();
  });
  it('shows the Row and Column choice only from two buttons, and writes it', () => {
    const { primitive } = inspector(mapDocument([group('top-leading', 'column', button('a')), group('top-trailing', 'column', button('b'), button('c'))]));
    expect(within(screen.getByRole('group', { name: 'Top Leading' })).queryByRole('radiogroup')).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Top Trailing' })).getByRole('radio', { name: 'Row' }));
    expect(primitive().controls![1].axis).toBe('row');
  });
  it('keeps `locate` truthful as Locate is removed, and drops `controls` once nothing but the default is left', async () => {
    const { primitive } = inspector(mapDocument([group('top-leading', 'column', locateButton, button('a', 'Alpha'))], true));
    expect(primitive().locate).toBe(true);
    await press(screen.getByRole('button', { name: 'More for Alpha' }));
    await press(await screen.findByRole('menuitem', { name: 'Remove Button' }));
    expect(primitive().controls).toBeUndefined();
    expect(primitive().locate).toBe(true);
  });
  it('opens a button\'s page with the label, the action and the place, and edits the label', async () => {
    const { primitive } = inspector(mapDocument([group('top-leading', 'column', button('a', 'Alpha'), button('b', 'Beta'))]));
    await press(screen.getByRole('button', { name: /^Beta:/ }));
    const page = await screen.findByTestId('map-button-page');
    fireEvent.change(within(page).getByRole('textbox', { name: 'Label' }), { target: { value: 'Gamma' } });
    expect(primitive().controls![0].buttons[1].label).toBe('Gamma');
    expect(within(page).getByText('2 of 2')).toBeTruthy();
    fireEvent.click(within(page).getByRole('button', { name: 'Move Up' }));
    expect(primitive().controls![0].buttons.map(item => item.id)).toEqual(['b', 'a']);
  });
  it('warns, never refuses, when a family needs More', () => {
    inspector(mapDocument([group('top-trailing', 'row', ...Array.from({ length: 8 }, (_, i) => button(`b${i}`)))]));
    expect(screen.getByTestId('map-overflow').textContent).toBe('On the smallest iPhone, 2 buttons move into More (Top Trailing).');
  });
});
