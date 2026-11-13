// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DevicePreview, { initialPreview, NativeComponents } from '../src/DevicePreview';
import { ConditionEditor } from '../src/ActionEditor';
import { Icon, JsonField, NumberField } from '../src/ui';
import { createComponent } from '../src/shared/catalog';
import { createSampleDocument } from '../src/shared/sample';
import { duoGeometry } from '../src/shared/native-layout';
import type { Component } from '../src/shared/types';

afterEach(cleanup);
function context(editing = false) {
  const document = createSampleDocument();
  return { document, variables: { guestMode: false }, entities: {}, editing, onSelect: vi.fn(), onAction: vi.fn(), dataModes: {} };
}
describe('document-driven browser preview', () => {
  it('renders walking-person aliases as a person rather than an activity waveform or missing icon', () => {
    const names = ['figure.walk', 'figure.walk.fill', 'person.walk'];
    const { container } = render(<>{names.map(name => <Icon key={name} name={name}/>)}</>);
    for (const glyph of container.querySelectorAll('svg')) {
      expect(glyph.classList.contains('lucide-walking-person')).toBe(true);
      expect(glyph.hasAttribute('data-icon-missing')).toBe(false);
    }
    expect(container.querySelectorAll('svg')).toHaveLength(names.length);
  });
  it('keeps the originating tab highlighted through shared child pages and modal destinations', () => {
    const preview = context(), [home, food] = preview.document.pages;
    const child = { ...structuredClone(home), id: 'shared-child', title: 'Child', components: [] };
    preview.document.pages.push(child);
    const route = () => ({ ...createComponent('action-tile'), action: { type: 'navigate' as const, pageId: child.id } });
    home.components.push(route()); food.components.push(route());
    const props = { ...preview, target: { kind: 'page' as const, id: home.id }, previewPage: home.id, onDismiss: vi.fn(), settings: initialPreview, onSettings: vi.fn(), onTarget: vi.fn() };
    const { container, rerender } = render(<DndContext><DevicePreview {...props}/></DndContext>);
    const selected = () => container.querySelector('.native-tabbar [aria-current="page"]')?.textContent;
    expect(selected()).toBe('Home');
    rerender(<DndContext><DevicePreview {...props} previewPage={food.id}/></DndContext>);
    expect(selected()).toBe('Food');
    rerender(<DndContext><DevicePreview {...props} previewPage={child.id}/></DndContext>);
    expect(selected()).toBe('Food');
    rerender(<DndContext><DevicePreview {...props} previewPage={child.id} previewModal={preview.document.modals[0].id}/></DndContext>);
    expect(selected()).toBe('Food');
    rerender(<DndContext><DevicePreview {...props} previewPage={home.id}/></DndContext>);
    expect(selected()).toBe('Home');
    rerender(<DndContext><DevicePreview {...props} previewPage={child.id}/></DndContext>);
    expect(selected()).toBe('Home');
  });
  it('passes prerequisite eligibility into specialized controls and opens their configured remote actions', () => {
    const preview = context(), control = createComponent('action-tile');
    control.title = 'TV'; control.props = { presentation: 'control', controlKind: 'media', entityId: 'media_player.tv', enabledEntityId: 'input_boolean.ready', enabledState: 'on' };
    control.action = { type: 'modal', modalId: preview.document.modals[0].id };
    control.binding = { sourceId: 'controls' };
    preview.document.dataSources.push({ id: 'controls', name: 'Controls', kind: 'static', sample: [{ entityId: 'media_player.tv', state: 'paused', supportedFeatures: 513 }], refreshSeconds: 30 });
    const { rerender } = render(<NativeComponents components={[control]} context={preview}/>);
    expect(screen.getByRole('button', { name: 'Open TV remote' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(preview.onAction).not.toHaveBeenCalled();
    rerender(<NativeComponents components={[control]} context={{ ...preview, entities: { 'input_boolean.ready': 'on' } }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Open TV remote' }));
    expect(preview.onAction).toHaveBeenLastCalledWith(control.action);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(preview.onAction).toHaveBeenLastCalledWith(expect.objectContaining({ service: 'media_play' }));
    preview.onAction.mockClear();
    for (const blocked of [{ dataModes: { controls: 'error' } }, { surfaceActive: false }]) {
      rerender(<NativeComponents components={[control]} context={{ ...preview, entities: { 'input_boolean.ready': 'on' }, ...blocked }}/>);
      expect(screen.getByRole('button', { name: 'Pause' }).hasAttribute('disabled')).toBe(true);
      expect(screen.getByRole('button', { name: 'Open TV remote' }).hasAttribute('disabled')).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      fireEvent.click(screen.getByRole('button', { name: 'Open TV remote' }));
      expect(preview.onAction).not.toHaveBeenCalled();
    }
    rerender(<NativeComponents components={[control]} context={{ ...preview, entities: { 'input_boolean.ready': 'on' } }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(preview.onAction).toHaveBeenCalledOnce();
  });
  it.each(['disabled', 'readOnly'])('propagates %s through remote volume keys and nested vacuum settings without changing configuration', flag => {
    const preview = context();
    const volume: Component = { id: 'volume', type: 'section', title: 'Volume', binding: { sourceId: 'controls' },
      props: { presentation: 'remote-volume', entityId: 'media_player.tv', remoteMediaEntityId: 'media_player.tv', [flag]: true },
      children: ['volumeMute', 'volumeDown', 'volumeUp'].map(key => ({ id: key, type: 'action-tile', title: key,
        binding: { sourceId: 'controls' }, props: { presentation: 'remote-key', remoteKey: key, remoteMediaEntityId: 'media_player.tv' },
        action: { type: 'service', domain: 'remote', service: 'send_command', entityId: 'remote.tv', data: { command: key } } })) };
    const vacuum: Component = { id: 'vacuum', type: 'section', title: 'Robot', binding: { sourceId: 'controls' },
      props: { presentation: 'vacuum-sheet', entityId: 'vacuum.hall', [flag]: true },
      children: [{ id: 'controls', type: 'section', title: 'Controls', props: { vacuumTab: 'controls' },
        children: [{ id: 'settings', type: 'section', title: 'Cleaning Settings', props: {}, children: [
          { id: 'occupied', type: 'action-tile', title: 'Occupied Only', binding: { sourceId: 'controls' },
            props: { presentation: 'control', controlKind: 'toggle', entityId: 'input_boolean.occupied', checkRow: true } },
        ] }] }] };
    preview.document.dataSources.push({ id: 'controls', name: 'Controls', kind: 'static', refreshSeconds: 30, sample: [
      { entityId: 'media_player.tv', state: 'playing', volumeLevel: .35, supportedFeatures: 4 },
      { entityId: 'vacuum.hall', state: 'docked', supportedFeatures: 8220 },
      { entityId: 'input_boolean.occupied', state: 'off' },
    ] });
    const before = JSON.stringify([volume, vacuum]);
    const { rerender } = render(<NativeComponents components={[volume, vacuum]} context={preview}/>);
    expect(screen.getByRole('slider', { name: 'Volume' }).hasAttribute('disabled')).toBe(true);
    for (const name of [/^volumeMute$/, /^volumeDown$/, /^volumeUp$/, /^Occupied Only/]) {
      const button = screen.getByRole('button', { name });
      expect(button.hasAttribute('disabled')).toBe(true);
      fireEvent.click(button);
    }
    expect(preview.onAction).not.toHaveBeenCalled();
    expect(JSON.stringify([volume, vacuum])).toBe(before);
    rerender(<NativeComponents components={[volume, vacuum].map(component => ({ ...component, props: { ...component.props, [flag]: false } }))} context={preview}/>);
    fireEvent.click(screen.getByRole('button', { name: 'volumeUp' }));
    fireEvent.click(screen.getByRole('button', { name: /^Occupied Only/ }));
    expect(preview.onAction).toHaveBeenCalledTimes(2);
  });
  it('hides an inactive vacuum selector outside the mounted modal scroller and restores its local tab', () => {
    const preview = context();
    const vacuum: Component = { id: 'robot', type: 'section', title: 'Robot', binding: { sourceId: 'controls' },
      props: { presentation: 'vacuum-sheet', entityId: 'vacuum.hall' }, children: [
        { id: 'controls', type: 'section', title: 'Controls', props: { vacuumTab: 'controls' } },
        { id: 'rooms', type: 'section', title: 'Rooms', props: { vacuumTab: 'zones' },
          children: [{ id: 'hall', type: 'action-tile', title: 'Hall', props: { nativeKind: 'vacuum-room' } }] },
      ] };
    preview.document.dataSources.push({ id: 'controls', name: 'Controls', kind: 'static', refreshSeconds: 30,
      sample: [{ entityId: 'vacuum.hall', state: 'docked', supportedFeatures: 8220 }] });
    const view = (active: boolean) => <div className="native-modal"><div className="native-modal-scroll" hidden={!active}>
      <NativeComponents components={[vacuum]} context={{ ...preview, surfaceActive: active }}/>
    </div></div>;
    const { rerender, container } = render(view(true));
    fireEvent.click(screen.getByRole('tab', { name: 'Rooms' }));
    expect(screen.getByRole('tablist').parentElement?.className).toBe('native-modal');
    const scroll = container.querySelector('.native-modal-scroll')!;
    scroll.scrollTop = 95;
    rerender(view(false));
    expect(screen.queryByRole('tablist')).toBeNull();
    scroll.scrollTop = 0;
    rerender(view(true));
    expect(screen.getByRole('tab', { name: 'Rooms' }).getAttribute('aria-selected')).toBe('true');
    expect(scroll.scrollTop).toBe(95);
    expect(preview.onAction).not.toHaveBeenCalled();
  });
  it('gates resident profile tabs by the authenticated user ID, not a matching display name', () => {
    const preview = context(), tabs = createComponent('section'), profile = createComponent('section'), chores = createComponent('section');
    profile.title = 'Profile'; chores.title = 'My Chores';
    chores.props = { requiresResident: true, profileSourceId: 'native-profile', people: [{ haUserId: 'resident-id', name: 'Same Name' }] };
    chores.children = [{ ...createComponent('text'), title: 'Resident content' }];
    tabs.props.presentation = 'tabs'; tabs.children = [profile, chores];
    preview.document.dataSources.push({ id: 'native-profile', name: 'Identity', kind: 'static', sample: { id: 'guest-id', name: 'Same Name' }, refreshSeconds: 30 });
    const { rerender } = render(<NativeComponents components={[tabs]} context={preview}/>);
    expect(screen.queryByRole('tab', { name: 'My Chores' })).toBeNull();
    preview.document.dataSources.at(-1)!.sample = { id: 'resident-id', name: 'Different Name' };
    rerender(<NativeComponents components={[tabs]} context={preview}/>);
    fireEvent.click(screen.getByRole('tab', { name: 'My Chores' }));
    expect(screen.getByText('Resident content')).toBeTruthy();
    preview.document.dataSources.at(-1)!.sample = null;
    rerender(<NativeComponents components={[tabs]} context={preview}/>);
    expect(screen.queryByRole('tab', { name: 'My Chores' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'Profile' }).hasAttribute('hidden')).toBe(false);
    expect(screen.queryByText('Resident content')).toBeNull();
    rerender(<NativeComponents components={[tabs]} context={{ ...preview, editing: true }}/>);
    expect(screen.getByRole('tab', { name: 'My Chores' })).toBeTruthy();
  });
  it('opens shared room drilldowns directly and does not render entity snapshots as missing collection records', () => {
    const preview = context();
    const stack = createComponent('section'), root = createComponent('section'), detail = createComponent('section');
    stack.props.presentation = 'navigation-stack'; root.title = 'Rooms'; detail.title = 'Office';
    detail.children = [{ ...createComponent('text'), title: 'Lamp controls' }];
    stack.children = [root, detail];
    const list = createComponent('list');
    list.title = 'Recipes'; list.props = { collectionKind: 'recipes', requiredData: 'recipes', unavailableText: 'Recipes unavailable' };
    list.binding = { sourceId: 'renamed-native-states' };
    preview.document.dataSources.push({ id: 'renamed-native-states', name: 'Entities', kind: 'static', sample: [{ entityId: 'light.private', state: 'on', name: 'Not a recipe' }], refreshSeconds: 30 });
    const { rerender } = render(<NativeComponents components={[stack, list]} context={{ ...preview, initialDestinationId: detail.id }}/>);
    expect(screen.getByText('Lamp controls')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back in sheet' })).toBeTruthy();
    expect(screen.getByText('Recipes unavailable')).toBeTruthy();
    expect(screen.queryByText(/Not a recipe/)).toBeNull();
    rerender(<NativeComponents components={[stack, list]} context={{ ...preview, initialDestinationId: root.id }}/>);
    expect(screen.queryByRole('button', { name: 'Back in sheet' })).toBeNull();
    rerender(<NativeComponents components={[stack, list]} context={{ ...preview, initialDestinationId: detail.id }}/>);
    expect(screen.getByRole('button', { name: 'Back in sheet' })).toBeTruthy();
  });
  it('overrides device appearance without editing the document and tracks the collapsing header', () => {
    const preview = context(), page = preview.document.pages[0], settings = { ...initialPreview, appearance: 'light' as const }, onSettings = vi.fn();
    const before = JSON.stringify(preview.document);
    const { container } = render(<DndContext><DevicePreview {...preview} target={{ kind: 'page', id: page.id }} previewPage={page.id} onDismiss={vi.fn()} settings={settings} onSettings={onSettings} onTarget={vi.fn()}/></DndContext>);
    expect(container.querySelector('.native-app.appearance-light')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Device theme'), { target: { value: 'dark' } });
    expect(onSettings).toHaveBeenLastCalledWith({ ...settings, appearance: 'dark' });
    const scroll = container.querySelector<HTMLElement>('.native-scroll')!;
    fireEvent.scroll(scroll, { target: { scrollTop: 26 } });
    expect(scroll.style.getPropertyValue('--header-progress')).toBe('0.5');
    fireEvent.scroll(scroll, { target: { scrollTop: 100 } });
    expect(scroll.style.getPropertyValue('--header-progress')).toBe('1');
    fireEvent.scroll(scroll, { target: { scrollTop: 0 } });
    expect(scroll.style.getPropertyValue('--header-progress')).toBe('0');
    expect(JSON.stringify(preview.document)).toBe(before);
  });

  it('uses the sheet navigation title and back control for configured room subpages', () => {
    const preview = context(), modal = preview.document.modals[0], stack = createComponent('section');
    stack.props.presentation = 'navigation-stack';
    const root = createComponent('section'), detail = createComponent('section'), link = createComponent('navigation-tile');
    root.title = 'Rooms'; detail.title = 'Office Lights'; link.title = 'Office'; link.props.destinationId = detail.id;
    root.children = [link]; detail.children = [{ ...createComponent('text'), title: 'Lamp controls' }];
    stack.children = [root, detail]; modal.components = [stack];
    render(<DndContext><DevicePreview {...preview} target={{ kind: 'page', id: preview.document.pages[0].id }} previewPage={preview.document.pages[0].id} previewModal={modal.id} onDismiss={vi.fn()} settings={initialPreview} onSettings={vi.fn()} onTarget={vi.fn()}/></DndContext>);
    fireEvent.click(screen.getByRole('button', { name: 'Office' }));
    expect(screen.getByRole('heading', { name: 'Office Lights', level: 1 })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Office Lights', level: 2 })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back in sheet' }));
    expect(screen.getByRole('button', { name: 'Office' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back in sheet' })).toBeNull();
  });

  it('simulates configured alarm modes inside the native panel without mutating live readings', () => {
    const preview = context(), panel = createComponent('section');
    const reading = { entityId: 'alarm_control_panel.demo', state: 'armed_home', name: 'Security' };
    preview.document.dataSources.push({ id: 'alarm-state', name: 'Alarm', kind: 'static', refreshSeconds: 30, sample: [reading] });
    panel.title = 'Security System'; panel.props = { presentation: 'alarm-panel', entityId: reading.entityId }; panel.binding = { sourceId: 'alarm-state' };
    panel.children = ['Home', 'Away'].map(mode => ({
      ...createComponent('action-tile'), title: mode, binding: panel.binding,
      props: { entityId: reading.entityId, modeState: `armed_${mode.toLowerCase()}`, showState: false },
      action: { type: 'service', domain: 'alarm_control_panel', entityId: reading.entityId, service: `alarm_arm_${mode.toLowerCase()}` },
    }));
    const before = JSON.stringify(preview.document);
    render(<NativeComponents components={[panel]} context={preview}/>);
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(preview.onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Away' }));
    expect(screen.getByRole('button', { name: 'Away' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Armed Away')).toBeTruthy();
    expect(preview.onAction).toHaveBeenCalledWith(panel.children[1].action);
    expect(JSON.stringify(preview.document)).toBe(before);
  });
  it.each(['heading', 'text', 'status-chip', 'progress'] as const)('executes %s actions with pointer and keyboard, but not while editing', type => {
    const preview = context(true);
    const component = createComponent(type);
    component.title = 'Open destination';
    component.action = { type: 'navigate', pageId: preview.document.pages[1].id };
    const { rerender } = render(<NativeComponents components={[component]} context={preview}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Select Open destination' }));
    expect(preview.onAction).not.toHaveBeenCalled();
    rerender(<NativeComponents components={[component]} context={{ ...preview, editing: false }}/>);
    const control = screen.getByRole('button', { name: 'Open destination' });
    fireEvent.click(control);
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(preview.onAction).toHaveBeenCalledTimes(2);
    expect(preview.onAction).toHaveBeenLastCalledWith(component.action);
  });

  it('keeps hidden nodes editable but removes them in Interact mode', () => {
    const component = createComponent('action-tile');
    component.title = 'Conditional control';
    component.visibility = { source: 'variable', key: 'guestMode', operator: 'truthy' };
    const preview = context(true);
    const { rerender } = render(<NativeComponents components={[component]} context={preview}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Select Conditional control' }));
    expect(preview.onSelect).toHaveBeenCalledWith(component.id);
    expect(preview.onAction).not.toHaveBeenCalled();
    rerender(<NativeComponents components={[component]} context={{ ...preview, editing: false }}/>);
    expect(screen.queryByText('Conditional control')).toBeNull();
    rerender(<NativeComponents components={[component]} context={{ ...preview, editing: false, variables: { guestMode: true } }}/>);
    expect(screen.getByText('Conditional control')).toBeTruthy();
  });

  it('dispatches a variable toggle and renders false/zero bound settings honestly', () => {
    const toggle = createComponent('toggle');
    toggle.props.variable = 'guestMode';
    const setting = createComponent('settings-row');
    setting.binding = { sourceId: 'test-data', path: 'count' };
    const preview = context();
    preview.document.dataSources.push({ id: 'test-data', name: 'Test source', kind: 'static', refreshSeconds: 60, sample: { count: 0 } });
    render(<NativeComponents components={[toggle, setting]} context={preview}/>);
    fireEvent.click(screen.getByRole('switch'));
    expect(preview.onAction).toHaveBeenCalledWith({ type: 'toggle', variable: 'guestMode' });
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText('sample')).toBeNull();
  });

  it('renders each configured component once across folded regions', () => {
    const preview = context();
    const page = preview.document.pages[0];
    page.components = [createComponent('text'), createComponent('text')];
    page.components[0].title = 'Primary pane content';
    page.components[1].title = 'Secondary pane content';
    render(<DndContext><DevicePreview {...preview} target={{ kind: 'page', id: page.id }} previewPage={page.id} onDismiss={vi.fn()} settings={{ ...initialPreview, device: 'duo', fold: 90 }} onSettings={vi.fn()} onTarget={vi.fn()}/></DndContext>);
    expect(screen.getAllByText('Primary pane content')).toHaveLength(1);
    expect(screen.getAllByText('Secondary pane content')).toHaveLength(1);
    expect(screen.getAllByRole('navigation', { name: 'App tabs' })).toHaveLength(1);
  });

  it('preserves local component state across Duo posture and orientation changes without a notch', () => {
    const preview = context();
    const page = preview.document.pages[0];
    const list = createComponent('list');
    list.props.showChecks = true; list.binding = { sourceId: 'items' };
    page.components = [list];
    preview.document.dataSources.push({ id: 'items', name: 'Items', kind: 'static', refreshSeconds: 60, sample: [{ id: 'first', title: 'Keep checked' }] });
    const renderDevice = (fold: number, landscape: boolean) => <DndContext><DevicePreview {...preview} target={{ kind: 'page', id: page.id }} previewPage={page.id} onDismiss={vi.fn()} settings={{ ...initialPreview, device: 'duo', fold, landscape }} onSettings={vi.fn()} onTarget={vi.fn()}/></DndContext>;
    const { container, rerender } = render(renderDevice(180, false));
    fireEvent.click(screen.getByRole('button', { name: 'Keep checked' }));
    for (const fold of [0, 90, 180]) for (const landscape of [false, true]) {
      rerender(renderDevice(fold, landscape));
      expect(screen.getAllByRole('button', { name: 'Keep checked' })).toHaveLength(1);
      expect(container.querySelectorAll('.record-check.checked')).toHaveLength(1);
      expect(container.querySelector('.hardware-notch,.hardware-island')).toBeNull();
      expect(container.querySelectorAll('.duo-cover-camera')).toHaveLength(fold === 0 ? 1 : 0);
      const geometry = duoGeometry(fold === 0 ? 'closed' : fold === 90 ? 'partial' : 'open', landscape ? 'landscape' : 'portrait');
      const model = container.querySelector<HTMLElement>('.device-model')!;
      expect(model.style.width).toBe(`${geometry.width + 28}px`);
      expect(model.style.height).toBe(`${geometry.height + 28}px`);
      expect(model.dataset.layout).toBe(geometry.trailingControls ? 'side-controls' : 'bottom-controls');
    }
  });

  it('exposes loading and unavailable states without replacing the last preview data', () => {
    const preview = context();
    preview.document.dataSources.push({ id: 'room', name: 'Room', kind: 'static', refreshSeconds: 60, sample: '21 °C' });
    const chip = createComponent('status-chip');
    chip.title = 'Room temperature'; chip.binding = { sourceId: 'room' };
    chip.action = { type: 'navigate', pageId: preview.document.pages[1].id };
    const { container, rerender } = render(<NativeComponents components={[chip]} context={{ ...preview, contentState: 'loading' }}/>);
    expect(container.querySelector('[aria-busy=true]')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading Room temperature');
    fireEvent.click(screen.getByRole('button', { name: 'Room temperature' }));
    expect(preview.onAction).not.toHaveBeenCalled();
    rerender(<NativeComponents components={[chip]} context={{ ...preview, dataModes: { room: 'error' } }}/>);
    expect(screen.getByText('21 °C')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Data unavailable');
    expect(container.querySelector('[aria-busy=true]')).toBeNull();
  });

  it('gates skeletons for 150ms so fast reads do not flash loading surfaces', () => {
    vi.useFakeTimers();
    try {
      const preview = context();
      const chip = createComponent('status-chip');
      chip.binding = { sourceId: 'room' };
      preview.document.dataSources.push({ id: 'room', name: 'Room', kind: 'static', refreshSeconds: 30, sample: '21 C' });
      const { container, rerender } = render(<NativeComponents components={[chip]} context={{ ...preview, contentState: 'loading' }}/>);
      act(() => vi.advanceTimersByTime(149));
      expect(container.querySelector('.native-loading')).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(container.querySelector('.native-loading')).toBeTruthy();
      rerender(<NativeComponents components={[chip]} context={preview}/>);
      expect(container.querySelector('.native-loading')).toBeNull();
      expect(screen.getByText('21 C')).toBeTruthy();
    } finally { cleanup(); vi.useRealTimers(); }
  });

  it('renders a bound camera stream as video, using the image only as its poster', () => {
    const preview = context();
    preview.document.dataSources.push({ id: 'camera', name: 'Camera', kind: 'static', refreshSeconds: 60, sample: { url: '/camera.mp4', imageUrl: '/poster.jpg' } });
    const camera = createComponent('camera-feed');
    camera.binding = { sourceId: 'camera' };
    const { rerender } = render(<NativeComponents components={[camera]} context={preview}/>);
    const video = screen.getByLabelText(camera.title);
    expect(video.tagName).toBe('VIDEO');
    expect(video.getAttribute('src')).toBe('/camera.mp4');
    expect(video.getAttribute('poster')).toBe('/poster.jpg');
    preview.document.dataSources.at(-1)!.sample = { imageUrl: '/still.jpg' };
    rerender(<NativeComponents components={[camera]} context={preview}/>);
    expect(screen.getByAltText(camera.title).getAttribute('src')).toBe('/still.jpg');
  });

  it('resolves native entity bindings by ID and preserves zero weather temperatures', () => {
    const preview = context();
    preview.document.dataSources.push({ id: 'native', name: 'Native', kind: 'static', refreshSeconds: 30, sample: [
      { entityId: 'sensor.unrelated', state: '99', name: 'Other' },
      { entityId: 'weather.test', state: 'snowy', name: 'Test', temperature: 0, unit: 'C' },
    ] });
    const weather = createComponent('weather-summary');
    weather.props.entityId = 'weather.test'; weather.binding = { sourceId: 'native' };
    const { rerender } = render(<NativeComponents components={[weather]} context={preview}/>);
    expect(screen.getByText('0°')).toBeTruthy();
    expect(screen.getByText('Snow')).toBeTruthy();
    expect(screen.queryByText('Forecast and briefing not connected')).toBeNull();
    preview.document.dataSources.at(-1)!.sample = [];
    rerender(<NativeComponents components={[weather]} context={preview}/>);
    expect(screen.queryByText('0°')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('keeps checked records associated with their source across paging and sorting', () => {
    const preview = context();
    preview.document.dataSources.push({ id: 'items', name: 'Items', kind: 'static', refreshSeconds: 60, sample: [{ title: 'A' }, { title: 'B' }] });
    const carousel = createComponent('carousel');
    carousel.binding = { sourceId: 'items' };
    carousel.props = { columns: 1, rows: 1, showChecks: true, sortBy: 'title' };
    const { container, rerender } = render(<NativeComponents components={[carousel]} context={preview}/>);
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(container.querySelectorAll('.record-check.checked')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Next collection page' }));
    expect(screen.getByRole('button', { name: 'B' })).toBeTruthy();
    expect(container.querySelectorAll('.record-check.checked')).toHaveLength(0);
    carousel.props.sortDirection = 'desc';
    rerender(<NativeComponents components={[carousel]} context={preview}/>);
    expect(screen.getByRole('button', { name: 'A' })).toBeTruthy();
    expect(container.querySelectorAll('.record-check.checked')).toHaveLength(1);
  });

  it('recognizes saved status rails as scrolling through all normal sizes, wrapping only at accessibility sizes', () => {
    const preview = context(true), rail = createComponent('section');
    rail.props = { presentation: 'status-rail', columns: 4 };
    rail.children = [createComponent('status-chip'), createComponent('status-chip')];
    rail.children[0].title = 'A long configured title that must not be ellipsized';
    preview.document.theme.fontScale = 1.4;
    const { container, rerender } = render(<DndContext><NativeComponents components={[rail]} context={preview}/></DndContext>);
    expect(container.querySelector('.presentation-status-rail')?.getAttribute('data-rail-layout')).toBe('scroll');
    const scroller = container.querySelector<HTMLElement>('.presentation-status-rail>.native-layout')!;
    scroller.scrollLeft = 100;
    fireEvent.pointerDown(scroller, { pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.scroll(scroller);
    expect(scroller.scrollLeft).toBe(100);
    expect(preview.onAction).not.toHaveBeenCalled();
    expect(screen.getByText('A long configured title that must not be ellipsized')).toBeTruthy();
    preview.document.theme.fontScale = 1.7;
    rerender(<DndContext><NativeComponents components={[rail]} context={preview}/></DndContext>);
    expect(container.querySelector('.presentation-status-rail')?.getAttribute('data-rail-layout')).toBe('wrap');
  });

  it('does not activate pointer DnD from a legacy status rail scrollbar but retains explicit drag handles', () => {
    class SyntheticPointerEvent extends MouseEvent { isPrimary = true; pointerId = 1; pointerType = 'mouse'; }
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', SyntheticPointerEvent);
    try {
      const preview = context(true), rail = createComponent('section'), started = vi.fn();
      rail.title = 'Status';
      rail.props = { presentation: 'status-rail', columns: 6 };
      rail.children = [createComponent('status-chip'), createComponent('status-chip')];
      const { container } = render(<DndContext onDragStart={started}><NativeComponents components={[rail]} context={preview}/></DndContext>);
      const scroller = container.querySelector<HTMLElement>('.presentation-status-rail>.native-layout')!;
      fireEvent.pointerDown(scroller, { button: 0, buttons: 1, clientX: 40, clientY: 20 });
      fireEvent.pointerMove(document, { clientX: 140, clientY: 20 });
      fireEvent.pointerUp(document);
      expect(started).not.toHaveBeenCalled();
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Drag Status on canvas' }), { button: 0, buttons: 1, clientX: 40, clientY: 20 });
      expect(started).toHaveBeenCalledTimes(1);
    } finally { fireEvent.pointerUp(document); cleanup(); act(() => vi.runOnlyPendingTimers()); vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it('wires native grid placements and tile metrics without truncating configured text', () => {
    const preview = context(), grid = createComponent('section');
    grid.props = { adaptive: true, minimumWidth: 150, columns: 4 };
    grid.children = Array.from({ length: 7 }, (_, index) => ({ ...createComponent('navigation-tile'), title: `Configured room ${index} with a wrapping title` }));
    const { container, rerender } = render(<NativeComponents components={[grid]} context={{ ...preview, layoutWidth: 636 }}/>);
    const layout = container.querySelector('.native-group>.native-layout')!;
    expect(layout.getAttribute('data-native-columns')).toBe('4');
    const cards = layout.querySelectorAll<HTMLElement>(':scope>.native-node');
    expect(cards[6].style.gridColumn).toBe('3 / span 2');
    const tile = cards[0].querySelector<HTMLElement>('.native-tile')!;
    expect(tile.style.minHeight).toBe('96px');
    expect(tile.style.getPropertyValue('--title-reserve')).toBe('40px');
    expect(tile.textContent).toContain('Configured room 0 with a wrapping title');
    preview.document.theme.fontScale = 1.7;
    grid.children![0].props.arrangement = 'row';
    rerender(<NativeComponents components={[grid]} context={{ ...preview, layoutWidth: 636 }}/>);
    expect(container.querySelector('.native-tile')?.classList.contains('arrangement-anchored-bottom')).toBe(true);
  });

  it.each([[637, 1, '1'], [703, 1, '1'], [704, 1, '2'], [704, 1.4, '1']])('uses actual section thresholds at width %s and text scale %s', (width, scale, columns) => {
    const preview = context(), grid = createComponent('section');
    preview.document.theme.fontScale = Number(scale);
    grid.props = { adaptive: true, columns: 4 };
    grid.children = [createComponent('section'), createComponent('section')];
    const { container } = render(<NativeComponents components={[grid]} context={{ ...preview, layoutWidth: Number(width) }}/>);
    const layout = container.querySelector<HTMLElement>('.adaptive-group>.native-layout')!;
    expect(layout.dataset.nativeColumns).toBe(columns);
    expect(layout.style.gap).toBe('24px');
  });

  it('retains checked state through configured in-sheet drilldowns and Back without persisting it', () => {
    const preview = context();
    preview.document.dataSources.push({ id: 'checklist', name: 'Checklist', kind: 'static', refreshSeconds: 60, sample: [{ title: 'Preview-only check' }] });
    const list = createComponent('list');
    list.binding = { sourceId: 'checklist' }; list.props.showChecks = true;
    const detail: Component = { id: 'detail', type: 'section', title: 'Study', props: { columns: 1 }, children: [list] };
    const stack: Component = { id: 'stack', type: 'section', title: '', props: { presentation: 'navigation-stack' }, children: [
      { id: 'overview', type: 'section', title: 'Rooms', props: {}, children: [{ id: 'opener', type: 'navigation-tile', title: 'Study', props: { destinationId: 'detail', arrangement: 'row' } }] },
      detail,
    ] };
    const before = JSON.stringify(preview.document);
    const { container } = render(<div className="native-modal-scroll"><NativeComponents components={[stack]} context={preview}/></div>);
    const scroll = container.firstElementChild!;
    scroll.scrollTop = 123;
    fireEvent.click(screen.getByRole('button', { name: 'Study' }));
    expect(scroll.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Preview-only check' }));
    scroll.scrollTop = 234;
    fireEvent.click(screen.getByRole('button', { name: 'Back in sheet' }));
    expect(scroll.scrollTop).toBe(123);
    fireEvent.click(screen.getByRole('button', { name: 'Study' }));
    expect(scroll.scrollTop).toBe(234);
    expect(container.querySelectorAll('.record-check.checked')).toHaveLength(1);
    expect(preview.onAction).not.toHaveBeenCalled();
    expect(JSON.stringify(preview.document)).toBe(before);
  });

  it('keeps configured Climate tabs mounted and out of accessibility while inactive', () => {
    const preview = context();
    const list = createComponent('list');
    list.props.showChecks = true; list.binding = { sourceId: 'checklist' };
    preview.document.dataSources.push({ id: 'checklist', name: 'Checklist', kind: 'static', refreshSeconds: 60, sample: [{ title: 'Keep tab state' }] });
    const tabs: Component = { id: 'tabs', type: 'section', title: 'Advanced Controls', props: { presentation: 'tabs' }, children: [
      { id: 'rooms-tab', type: 'section', title: 'Rooms', props: {}, children: [list] },
      { id: 'automation-tab', type: 'section', title: 'Automation', props: {}, children: [{ id: 'auto-info', type: 'text', title: 'Automatic Thermostat', props: {} }] },
      { id: 'tracking-tab', type: 'section', title: 'Tracking', props: {}, children: [] },
    ] };
    const { container } = render(<div className="native-modal-scroll"><NativeComponents components={[tabs]} context={preview}/></div>);
    const scroll = container.firstElementChild!;
    scroll.scrollTop = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Keep tab state' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Automation' }));
    expect(scroll.scrollTop).toBe(0);
    scroll.scrollTop = 70;
    expect(screen.queryByRole('button', { name: 'Keep tab state' })).toBeNull();
    expect(screen.getByText('Automatic Thermostat')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Automation' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Rooms' }).getAttribute('aria-selected')).toBe('true');
    expect(scroll.scrollTop).toBe(200);
    expect(container.querySelectorAll('.record-check.checked')).toHaveLength(1);
  });

  it('repartitions room overview sections from current state instead of persisting an import-time grouping', () => {
    const preview = context();
    preview.document.dataSources.push({ id: 'states', name: 'States', kind: 'static', refreshSeconds: 30, sample: [{ entityId: 'light.study', state: 'on' }] });
    const section: Component = { id: 'lights', type: 'section', title: '', props: { presentation: 'state-groups', adaptive: true, activeTitle: 'Lights On', inactiveTitle: 'Lights Off', unavailableTitle: 'Unavailable' }, children: [
      { id: 'study', type: 'navigation-tile', title: 'Study', props: { members: ['light.study'], tone: 'light' }, binding: { sourceId: 'states' } },
    ] };
    const { rerender } = render(<NativeComponents components={[section]} context={preview}/>);
    expect(screen.getByText('Lights On')).toBeTruthy();
    preview.document.dataSources.at(-1)!.sample = [{ entityId: 'light.study', state: 'off' }];
    rerender(<NativeComponents components={[section]} context={preview}/>);
    expect(screen.queryByText('Lights On')).toBeNull();
    expect(screen.getByText('Lights Off')).toBeTruthy();
    preview.document.dataSources.at(-1)!.sample = [];
    rerender(<NativeComponents components={[section]} context={preview}/>);
    expect(screen.queryByText('Lights Off')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Unavailable' })).toBeTruthy();
  });

  it('renders configured camera controls without consent or media requests and keeps capture simulated', () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const preview = context(), camera = createComponent('camera-feed');
      camera.props = { entityId: 'camera.example', viewer: true, controls: ['snapshot', 'sound', 'record'], aspectRatio: 4 / 3 };
      render(<NativeComponents components={[camera]} context={preview}/>);
      expect(screen.getByText('Live camera reads are off. Enable live data to connect.')).toBeTruthy();
      expect(screen.getByLabelText('Live camera camera.example').getAttribute('src')).toBeNull();
      expect(screen.getByRole('button', { name: 'Unmute camera sound' }).hasAttribute('disabled')).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Snapshot (simulated)' }));
      act(() => vi.advanceTimersByTime(350));
      expect(screen.getByText('Snapshot simulated. No actual photo was saved.')).toBeTruthy();
      expect(fetch).not.toHaveBeenCalled();
    } finally { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it('renders legacy mapped camera cards and viewers without rewriting them or enabling media reads', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const preview = context();
      const card: Component = { id: 'legacy-camera-card', type: 'camera-button', title: 'Door', props: { presentation: 'camera-card', entityId: 'camera.example', aspectRatio: 4 / 3 }, action: { type: 'modal', modalId: 'legacy-viewer' } };
      const viewer: Component = { id: 'legacy-camera-viewer', type: 'camera-feed', title: 'Door', props: { entityId: 'camera.example', aspectRatio: 4 / 3, rtcStreamId: 'door' } };
      const before = JSON.stringify([card, viewer]);
      const { container, rerender } = render(<NativeComponents components={[card, viewer]} context={preview}/>);
      fireEvent.click(screen.getByRole('button', { name: 'Open Door' }));
      expect(preview.onAction).toHaveBeenCalledWith(card.action);
      expect(container.querySelector('.native-camera-card .camera-media-viewer')).toBeNull();
      expect(container.querySelector('.native-camera-viewer .camera-media-viewer')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Snapshot (simulated)' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Unmute camera sound' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Record (simulated)' })).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      expect(JSON.stringify([card, viewer])).toBe(before);
      rerender(<NativeComponents components={[{ ...viewer, props: { ...viewer.props, controls: [] } }]} context={preview}/>);
      expect(screen.queryByRole('button', { name: 'Snapshot (simulated)' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Unmute camera sound' })).toBeNull();
      rerender(<NativeComponents components={[{ ...viewer, props: { ...viewer.props, viewer: false } }]} context={preview}/>);
      expect(container.querySelector('.camera-media-viewer')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Snapshot (simulated)' })).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally { cleanup(); vi.unstubAllGlobals(); }
  });

  it('exposes contact state accessibly without inventing an actuator or redundant visible subtitle', () => {
    const preview = context();
    preview.document.dataSources.push({ id: 'contacts', name: 'Contacts', kind: 'static', refreshSeconds: 30, sample: [{ entityId: 'binary_sensor.window', state: 'off' }] });
    const tile: Component = { id: 'contact', type: 'action-tile', title: 'Window', props: { readOnly: true, entityId: 'binary_sensor.window', nativeKind: 'contact', suppressNormalState: true }, binding: { sourceId: 'contacts' } };
    const { rerender } = render(<NativeComponents components={[tile]} context={preview}/>);
    expect(screen.getByLabelText('Window, Closed')).toBeTruthy();
    expect(screen.queryByText('Closed')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    preview.document.dataSources.at(-1)!.sample = [];
    rerender(<NativeComponents components={[tile]} context={preview}/>);
    expect(screen.getByText('Unavailable')).toBeTruthy();
  });

  it('surfaces invalid local destinations and shows selected editable subpage content', () => {
    const preview = context();
    const opener: Component = { id: 'open', type: 'navigation-tile', title: 'Open Study', props: { destinationId: 'detail' } };
    const { rerender } = render(<NativeComponents components={[opener]} context={preview}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Open Study' }));
    expect(screen.getByRole('alert').textContent).toContain('outside a configured navigation stack');
    const stack: Component = { id: 'stack', type: 'section', title: '', props: { presentation: 'navigation-stack' }, children: [
      { id: 'root', type: 'section', title: '', props: {}, children: [opener] },
      { id: 'detail', type: 'section', title: 'Study', props: {}, children: [{ id: 'leaf', type: 'text', title: 'Editable detail', props: {} }] },
    ] };
    rerender(<NativeComponents components={[stack]} context={{ ...preview, editing: true, selection: 'leaf' }}/>);
    expect(screen.getByRole('button', { name: 'Select Editable detail' })).toBeTruthy();
  });

  it('requires confirmation for a simulated Disarm without changing a bound alarm state', () => {
    const preview = context();
    preview.document.dataSources.push({ id: 'alarm', name: 'Alarm', kind: 'static', refreshSeconds: 30, sample: [{ entityId: 'alarm_control_panel.example', state: 'armed_away' }] });
    const disarm = createComponent('action-tile');
    disarm.title = 'Disarm'; disarm.binding = { sourceId: 'alarm' };
    disarm.props = { entityId: 'alarm_control_panel.example', modeState: 'disarmed', confirmation: 'Disarm the security system? Simulation only.' };
    disarm.action = { type: 'service', domain: 'alarm_control_panel', service: 'alarm_disarm', entityId: 'alarm_control_panel.example' };
    const before = JSON.stringify(preview.document);
    const away = structuredClone(disarm);
    away.id = 'away'; away.title = 'Away'; away.props = { ...away.props, modeState: 'armed_away', confirmation: '' };
    away.action = { ...disarm.action, service: 'alarm_arm_away' };
    render(<NativeComponents components={[disarm, away]} context={preview}/>);
    fireEvent.click(screen.getByRole('button', { name: /Away Armed Away/ }));
    expect(preview.onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Disarm Armed Away/ }));
    expect(preview.onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disarm' }));
    expect(preview.onAction).toHaveBeenCalledWith(disarm.action);
    expect(JSON.stringify(preview.document)).toBe(before);
  });
});

describe('inspector validation', () => {
  it('supplies a typed comparison value when changing from truthy to numeric', () => {
    const onChange = vi.fn();
    render(<ConditionEditor document={createSampleDocument()} condition={{ source: 'variable', key: 'guestMode', operator: 'truthy' }} onChange={onChange}/>);
    fireEvent.change(screen.getByLabelText('Comparison'), { target: { value: 'greater-than' } });
    expect(onChange).toHaveBeenLastCalledWith({ source: 'variable', key: 'guestMode', operator: 'greater-than', value: 0 });
  });

  it('rejects invalid object shapes without changing stored properties', () => {
    const onChange = vi.fn();
    render(<JsonField label="Properties" value={{ value: true }} shape="object" onChange={onChange}/>);
    const field = screen.getByLabelText(/Properties/);
    fireEvent.change(field, { target: { value: '[]' } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter a JSON object with named keys.')).toBeTruthy();
    fireEvent.change(field, { target: { value: '{"value":false}' } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledWith({ value: false });
  });

  it('reports an out-of-range or fractional column count rather than coercing it', () => {
    const onChange = vi.fn();
    render(<NumberField label="Columns" value={2} min={1} max={12} onChange={onChange}/>);
    const field = screen.getByLabelText(/Columns/);
    fireEvent.change(field, { target: { value: '13' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(field, { target: { value: '1.5' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
