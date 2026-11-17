// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/api';
import type { CompositionDocument } from '../src/shared/composition/schema';
import OpenFromPublished from '../src/workspace2/OpenFromPublished';
import { ToastHost } from '../src/workspace2/toasts';
import { Project } from './support/workspace2-surfaces';
import { copyOf, isSentenceCase, voiceIssues } from './support/copy';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn() }));
const home = homeDomains.document as unknown as CompositionDocument;
afterEach(cleanup);
beforeEach(() => { vi.mocked(request).mockReset(); });

const answer = (action: 'start' | 'ask' | 'keep', reason = 'x', draftRevision = 3) => vi.mocked(request).mockResolvedValueOnce({ action, reason, draftRevision });
function open(studio: Record<string, unknown> = {}, active = true) {
  const startFromPublished = vi.fn(async () => true);
  const ws = Project.workspace(home, undefined, { extra: { studio: { startFromPublished, isSaved: () => true, ...studio } } });
  const view = render(<ToastHost><OpenFromPublished ws={ws} active={active}/></ToastHost>);
  return { ws, startFromPublished, view };
}
const dialog = () => screen.queryByRole('dialog', { name: 'Start from Published?' });

describe('opening the Studio starts from published', () => {
  it('replaces a draft with no unpublished edits, silently: no dialog, no toast, one entry in the activity log', async () => {
    answer('start', 'no-unpublished-edits');
    const { ws, startFromPublished } = open();
    await waitFor(() => expect(startFromPublished).toHaveBeenCalledTimes(1));
    expect(dialog()).toBeNull();
    expect(screen.queryByText('Started from Published')).toBeNull();
    await waitFor(() => expect(ws.log).toHaveBeenCalledWith('Started the draft from the published layout'));
    expect(request).toHaveBeenCalledWith('/native/api/ha/open-check');
  });

  it.each(['not-connected', 'unreachable', 'nothing-published', 'already-published'])('keeps the draft and says nothing when the server says %s', async reason => {
    answer('keep', reason);
    const { startFromPublished } = open();
    await waitFor(() => expect(request).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(startFromPublished).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('keeps the draft and says nothing when the check itself fails', async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error('offline'));
    const { startFromPublished } = open();
    await waitFor(() => expect(request).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(startFromPublished).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('never replaces work begun while the check ran', async () => {
    answer('start');
    const { startFromPublished } = open({ isSaved: () => false });
    await waitFor(() => expect(request).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(startFromPublished).not.toHaveBeenCalled();
  });

  it('waits until the draft has loaded, and checks once', async () => {
    answer('keep');
    const startFromPublished = vi.fn(async () => true);
    const ws = Project.workspace(home, undefined, { extra: { studio: { startFromPublished, isSaved: () => true, envelope: undefined } } });
    const { rerender } = render(<ToastHost><OpenFromPublished ws={ws} active/></ToastHost>);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(request).not.toHaveBeenCalled();
    const loaded = Project.workspace(home, undefined, { extra: { studio: { startFromPublished, isSaved: () => true } } });
    rerender(<ToastHost><OpenFromPublished ws={loaded} active/></ToastHost>);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    rerender(<ToastHost><OpenFromPublished ws={Project.workspace(home, undefined, { extra: { studio: { startFromPublished, isSaved: () => true } } })} active/></ToastHost>);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('a draft with unpublished edits asks', () => {
  it('offers Start from Published as the default and Keep My Draft, and Keep My Draft changes nothing', async () => {
    answer('ask', 'unpublished-edits');
    const { startFromPublished } = open();
    const box = await screen.findByRole('dialog', { name: 'Start from Published?' });
    expect(box.textContent).toContain('Start from Published?');
    const primary = screen.getByRole('button', { name: 'Start from Published' });
    expect(primary.className).toContain('w2-primary');
    await waitFor(() => expect(document.activeElement).toBe(primary));
    fireEvent.click(screen.getByRole('button', { name: 'Keep My Draft' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(startFromPublished).not.toHaveBeenCalled();
  });

  it('closing the dialog keeps the draft too', async () => {
    answer('ask');
    const { startFromPublished } = open();
    await screen.findByRole('dialog', { name: 'Start from Published?' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(startFromPublished).not.toHaveBeenCalled();
  });

  it('Start from Published replaces the draft, says so, and closes', async () => {
    answer('ask');
    const { startFromPublished, ws } = open();
    await screen.findByRole('dialog', { name: 'Start from Published?' });
    fireEvent.click(screen.getByRole('button', { name: 'Start from Published' }));
    await waitFor(() => expect(startFromPublished).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(await screen.findByText('Started from Published')).toBeTruthy();
    expect(ws.log).toHaveBeenCalled();
  });

  it('stays open with the reason when the replacement fails', async () => {
    answer('ask');
    const { startFromPublished } = open({ startFromPublished: vi.fn(async () => false), error: 'The draft changed; reload and try again' });
    void startFromPublished;
    await screen.findByRole('dialog', { name: 'Start from Published?' });
    fireEvent.click(screen.getByRole('button', { name: 'Start from Published' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The draft changed; reload and try again');
    expect(dialog()).not.toBeNull();
  });

  it('is in the Studio\'s voice: Title Case buttons, a sentence-case message', async () => {
    answer('ask');
    open();
    const box = await screen.findByRole('dialog', { name: 'Start from Published?' });
    const message = box.querySelector('.w2-dialog-text')!.textContent!;
    for (const sentence of message.split(/(?<=\.)\s+/)) expect(isSentenceCase(sentence.replace(/\.$/, ''))).toBe(true);
    await expect(copyOf(box)).toMatchFileSnapshot('./snapshots/copy/open-from-published.txt');
    expect(voiceIssues(box)).toEqual([]);
  });
});
