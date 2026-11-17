// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { previewWindows } from '../src/preview2';
import ProjectMenu from '../src/workspace2/ProjectMenu';
import { DialogBody, dialogTitles, type DialogKey } from '../src/workspace2/projectDialogs';
import { ToastHost } from '../src/workspace2/toasts';
import { Project } from './support/workspace2-surfaces';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn() }));
afterEach(cleanup);
const home = homeDomains.document as unknown as CompositionDocument;

function dialog(kind: DialogKey, extra: Record<string, unknown> = {}, studio: Record<string, unknown> = {}, close = vi.fn()) {
  const ws = Project.workspace(home, undefined, { extra: { ...extra, studio } });
  render(<ToastHost><DialogBody dialog={kind} ws={ws} close={close} onError={() => {}}/></ToastHost>);
  return { ws, close };
}

describe('Start from Published', () => {
  it('asks first, in the agreed words, and does nothing on Cancel', () => {
    const startFromPublished = vi.fn(async () => true);
    const { close } = dialog('start-published', {}, { startFromPublished });
    expect(dialogTitles['start-published']).toBe('Start from Published?');
    expect(screen.getByText('Replaces this draft with the layout your apps load now. The current draft is kept as a backup.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalled();
    expect(startFromPublished).not.toHaveBeenCalled();
  });

  it('Replace Draft replaces once, then closes with a toast and an activity line', async () => {
    const startFromPublished = vi.fn(async () => true);
    const { ws, close } = dialog('start-published', {}, { startFromPublished });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Draft' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(startFromPublished).toHaveBeenCalledTimes(1);
    expect(ws.log).toHaveBeenCalledWith('Started the draft from the published layout');
  });

  it('saves unsaved edits first so the backup holds them', async () => {
    const order: string[] = [];
    const startFromPublished = vi.fn(async () => { order.push('replace'); return true; });
    const ws = Project.workspace(home, undefined, { extra: { persist: vi.fn(async () => { order.push('save'); return true; }), studio: { dirty: true, startFromPublished } } });
    render(<ToastHost><DialogBody dialog="start-published" ws={ws} close={() => {}} onError={() => {}}/></ToastHost>);
    fireEvent.click(screen.getByRole('button', { name: 'Replace Draft' }));
    await waitFor(() => expect(order).toEqual(['save', 'replace']));
  });

  it('keeps the dialog open and shows the reason when the server refuses', async () => {
    const startFromPublished = vi.fn(async () => false);
    const { close } = dialog('start-published', {}, { startFromPublished, error: 'Nothing has been published to Home Assistant yet' });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Draft' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nothing has been published to Home Assistant yet');
    expect(close).not.toHaveBeenCalled();
  });
});

describe('Restore Previous Draft', () => {
  it('asks first and restores on confirm', async () => {
    const restorePreviousDraft = vi.fn(async () => true);
    const { close } = dialog('restore-draft', {}, { restorePreviousDraft });
    expect(dialogTitles['restore-draft']).toBe('Restore Previous Draft?');
    fireEvent.click(screen.getByRole('button', { name: 'Restore Draft' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(restorePreviousDraft).toHaveBeenCalledTimes(1);
  });
});

describe('the Project menu', () => {
  async function menu(ws: ReturnType<typeof Project.workspace>) {
    const noop = () => {};
    render(<ProjectMenu ws={ws} window={previewWindows[0]} onWindow={noop} onError={noop} onPanel={noop} onGo={noop} open onOpenChange={noop} dialog={undefined} onDialog={noop} narrow={false}/>);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
  }
  const names = () => screen.queryAllByRole('menuitem').map(item => item.textContent);

  it('offers Start from Published only while Home Assistant is connected', async () => {
    await menu(Project.workspace(home, undefined, { extra: { houseStates: { status: 'ready' } } }));
    expect(names()).toContain('Start from Published');
    expect(names()).not.toContain('Restore Previous Draft');
    await act(async () => { cleanup(); });
    await menu(Project.workspace(home, undefined, { extra: { houseStates: { status: 'error' } } }));
    expect(names()).not.toContain('Start from Published');
  });

  it('offers Restore Previous Draft while a backup exists', async () => {
    await menu(Project.workspace(home, undefined, { extra: { houseStates: { status: 'error' }, studio: { backup: { createdAt: '2026-11-15T12:00:00.000Z', revision: 4 } } } }));
    expect(names()).toContain('Restore Previous Draft');
  });
});
