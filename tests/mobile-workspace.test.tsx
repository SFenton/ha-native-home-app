// @vitest-environment jsdom
import { useEffect, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobileWorkspace, { type EditorPane, type MobileWorkspaceHandle } from '../src/MobileWorkspace';
import { JsonField } from '../src/ui';
import type { WorkspaceView } from '../src/Sidebar';

afterEach(cleanup);
function resize(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  fireEvent(window, new Event('resize'));
}
function pane(name: string) {
  return document.querySelector<HTMLDivElement>(`[aria-label="${name} pane"]`)!;
}
function MountedDraft({ mounted }: { mounted: () => void }) {
  useEffect(mounted, [mounted]);
  return <JsonField label="Raw properties" value={{ title: 'Saved' }} onChange={vi.fn()}/>;
}
function Harness({ dragging = false, mounted = vi.fn(), onPaneChange }: { dragging?: boolean; mounted?: () => void; onPaneChange?: (pane: EditorPane) => void }) {
  const [view, setView] = useState<WorkspaceView>('design');
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [selected, setSelected] = useState(false);
  const workspace = useRef<MobileWorkspaceHandle>(null);
  return <MobileWorkspace ref={workspace} view={view} onView={setView} editing dragging={dragging}
    inspectorVisible={inspectorVisible} onInspectorVisible={setInspectorVisible} onPaneChange={onPaneChange}
    project={<><input aria-label="Project draft" defaultValue="Project"/><button onClick={() => setView('variables')}>Open variables</button></>}
    inspector={<><MountedDraft mounted={mounted}/><button onClick={() => workspace.current?.closeInspector()}>Close inspector</button></>}
    preview={<><button onClick={() => { setSelected(true); setInspectorVisible(true); }}>Select component</button><output aria-label="Selected component">{selected ? 'Text component' : 'None'}</output></>}
    toolbar={<button onClick={() => workspace.current?.toggleInspector()}>Toggle inspector</button>}
    status={<span>Services are simulated</span>}
    panels={{ data: <input aria-label="Data draft"/>, variables: <input aria-label="Variables draft"/>, navigation: <input aria-label="Navigation draft"/> }}
    insert={<><input aria-label="Search quick components"/><button>Insert text</button><button>Drag Text to canvas</button></>}/>;
}

describe('responsive configuration workspace', () => {
  it('keeps pane identities, invalid field drafts, and selection across pane and size switches', () => {
    resize(390);
    const mounted = vi.fn();
    render(<Harness mounted={mounted}/>);
    const raw = screen.getByLabelText(/^Raw properties/) as HTMLTextAreaElement;
    expect(pane('Preview').hidden).toBe(false);
    expect(pane('Inspect').hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select component' }));
    expect(pane('Preview').hidden).toBe(false);
    expect(pane('Inspect').hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    fireEvent.focus(raw);
    fireEvent.change(raw, { target: { value: '{ unfinished' } });
    fireEvent.blur(raw);
    expect(raw.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    for (const width of [320, 375, 420, 507, 694, 752, 820, 1024, 1180, 1440, 390]) resize(width);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(screen.getByLabelText(/^Raw properties/)).toBe(raw);
    expect(raw.value).toBe('{ unfinished');
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Selected component').textContent).toBe('Text component');
  });

  it('shows preview with a switchable sidepane at intermediate widths and three panes when wide', () => {
    resize(820);
    render(<Harness/>);
    expect(pane('Preview').hidden).toBe(false);
    expect(pane('Project').hidden).toBe(false);
    expect(pane('Inspect').hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(pane('Preview').hidden).toBe(false);
    expect(pane('Project').hidden).toBe(true);
    expect(pane('Inspect').hidden).toBe(false);
    resize(1440);
    expect(['Project', 'Preview', 'Inspect'].every(name => !pane(name).hidden)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(pane('Inspect').hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(pane('Inspect').hidden).toBe(false);
  });

  it('notifies drag invalidation only when the focused pane changes', () => {
    resize(1400);
    const changed = vi.fn();
    render(<Harness onPaneChange={changed}/>);
    act(() => screen.getByRole('textbox', { name: /^Raw properties/ }).focus());
    expect(changed).toHaveBeenLastCalledWith('inspect');
    resize(820);
    resize(390);
    expect(changed).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(changed).toHaveBeenLastCalledWith('project');
  });

  it('retains management drafts and returns to the project rather than the canvas', () => {
    resize(375);
    render(<Harness/>);
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open variables' }));
    expect(document.activeElement).toBe(pane('Project'));
    const draft = screen.getByLabelText('Variables draft') as HTMLInputElement;
    fireEvent.change(draft, { target: { value: 'Unapplied input' } });
    expect(pane('Preview').hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back to project' }));
    expect(pane('Project').hidden).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open variables' }));
    expect(screen.getByLabelText('Variables draft')).toBe(draft);
    expect(draft.value).toBe('Unapplied input');
  });

  it.each([false, true])('preserves the focused task on resize without needless focus redirects (previously blurred: %s)', droppedFocus => {
    resize(390);
    render(<Harness/>);
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    const projectDraft = screen.getByLabelText('Project draft');
    act(() => projectDraft.focus());
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(document.activeElement).toBe(pane('Preview'));
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(document.activeElement).toBe(projectDraft);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    resize(1440);
    const raw = screen.getByLabelText(/^Raw properties/);
    act(() => raw.focus());
    if (droppedFocus) act(() => raw.blur());
    resize(820);
    expect(pane('Inspect').hidden).toBe(false);
    expect(document.activeElement).toBe(droppedFocus ? document.body : raw);
    resize(390);
    expect(pane('Inspect').hidden).toBe(false);
    expect(document.activeElement).toBe(droppedFocus ? document.body : raw);
    expect(document.querySelector('[data-editor-layout]')?.getAttribute('data-editor-layout')).toBe('compact');
  });

  it('reveals a retained focused field after resizing without replacing its selection or draft', async () => {
    resize(1440);
    render(<Harness/>);
    const raw = screen.getByLabelText(/^Raw properties/) as HTMLTextAreaElement;
    const reveal = vi.fn();
    raw.scrollIntoView = reveal;
    act(() => raw.focus());
    fireEvent.change(raw, { target: { value: '{"unfinished":' } });
    raw.setSelectionRange(3, 8);
    resize(390);
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(reveal).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    expect(document.activeElement).toBe(raw);
    expect(raw.value).toBe('{"unfinished":');
    expect([raw.selectionStart, raw.selectionEnd]).toEqual([3, 8]);
  });

  it('keeps insertion sources and preview mounted together and preserves tray search on close', () => {
    resize(320);
    render(<Harness/>);
    const insert = screen.getByRole('button', { name: 'Insert' });
    fireEvent.click(insert);
    const search = screen.getByRole('textbox', { name: 'Search quick components' }) as HTMLInputElement;
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: 'Text' } });
    expect(screen.getByRole('button', { name: 'Select component' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Drag Text to canvas' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close insert tray' }));
    expect(document.activeElement).toBe(insert);
    fireEvent.click(insert);
    expect(screen.getByRole('textbox', { name: 'Search quick components' })).toBe(search);
    expect(search.value).toBe('Text');
  });

  it('handles back/Escape without consuming editable-input, menu, or active-drag Escape', () => {
    resize(390);
    const { rerender } = render(<Harness/>);
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.keyDown(screen.getByLabelText('Project draft'), { key: 'Escape' });
    expect(pane('Project').hidden).toBe(false);
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.append(menu);
    fireEvent.keyDown(pane('Project'), { key: 'Escape' });
    expect(pane('Project').hidden).toBe(false);
    menu.remove();
    rerender(<Harness dragging/>);
    fireEvent.keyDown(pane('Project'), { key: 'Escape' });
    expect(pane('Project').hidden).toBe(false);
    expect((screen.getByRole('button', { name: 'Inspect' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Harness/>);
    fireEvent.keyDown(pane('Project'), { key: 'Escape' });
    expect(pane('Preview').hidden).toBe(false);
  });

  it('focuses an already active pane when asked again and exposes named controls', () => {
    resize(390);
    render(<Harness/>);
    const navigation = screen.getByRole('navigation', { name: 'Editor panes' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Preview' }));
    expect(document.activeElement).toBe(pane('Preview'));
    const button = screen.getByRole('button', { name: 'Select component' });
    act(() => button.focus());
    fireEvent.click(within(navigation).getByRole('button', { name: 'Preview' }));
    expect(document.activeElement).toBe(button);
    expect(within(navigation).getByRole('button', { name: 'Preview' }).getAttribute('aria-pressed')).toBe('true');
  });
});
