// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, loadDraft, publishDraft, request, saveDraft, validateDocument } from '../src/api';
import { useStudio } from '../src/useStudio';
import { createSampleDocument } from '../src/shared/sample';
import type { DraftEnvelope } from '../src/shared/types';

vi.mock('../src/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/api')>(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  publishDraft: vi.fn(),
  validateDocument: vi.fn(),
  request: vi.fn(),
}));
class FakeEventSource extends EventTarget { close() {} }
const timestamp = '2026-11-12T12:00:00.000Z';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.mocked(loadDraft).mockResolvedValue({ document: createSampleDocument(), revision: 1, updatedAt: timestamp });
  vi.mocked(request).mockResolvedValue({ mode: 'sample', publishedRevision: null });
  vi.mocked(saveDraft).mockImplementation(async (document, expectedRevision) => ({ document, revision: expectedRevision + 1, updatedAt: timestamp }));
  vi.mocked(publishDraft).mockImplementation(async expectedRevision => ({ document: createSampleDocument(), revision: expectedRevision, updatedAt: timestamp, publishedAt: timestamp, capabilities: [] }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('server-backed editor persistence', () => {
  it('saves dirty work before publishing exactly the returned revision', async () => {
    const { result } = renderHook(useStudio);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.apply(document => { document.name = 'Edited household'; }));
    await act(async () => { await result.current.publish(); });
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ name: 'Edited household' }), 1);
    expect(publishDraft).toHaveBeenCalledWith(2);
    expect(vi.mocked(saveDraft).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(publishDraft).mock.invocationCallOrder[0]);
    expect(result.current.dirty).toBe(false);
    expect(result.current.publishedRevision).toBe(2);
  });

  it('preserves edits made while an earlier snapshot is saving', async () => {
    let finish!: (envelope: DraftEnvelope) => void;
    vi.mocked(saveDraft).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(useStudio);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.apply(document => { document.name = 'Saving snapshot'; }));
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.save(); });
    await act(async () => { await result.current.reload(); });
    expect(loadDraft).toHaveBeenCalledTimes(1);
    const snapshot = vi.mocked(saveDraft).mock.calls[0][0];
    act(() => result.current.apply(document => { document.name = 'Newer unsaved edit'; }));
    await act(async () => {
      finish({ document: snapshot, revision: 2, updatedAt: timestamp });
      await pending;
    });
    expect(result.current.document?.name).toBe('Newer unsaved edit');
    expect(result.current.revision).toBe(2);
    expect(result.current.dirty).toBe(true);
  });

  it('keeps new edits and undo history when a delayed reload completes, and serializes server operations', async () => {
    const { result } = renderHook(useStudio);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const originalName = result.current.document!.name;
    let finish!: (envelope: DraftEnvelope) => void;
    vi.mocked(loadDraft).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.reload(); });
    act(() => result.current.apply(document => { document.name = 'Edited during reload'; }));
    await act(async () => {
      expect(await result.current.save()).toBe(false);
      await result.current.publish();
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(publishDraft).not.toHaveBeenCalled();
    await act(async () => {
      finish({ document: { ...createSampleDocument(), name: 'Server version' }, revision: 7, updatedAt: timestamp });
      await pending;
    });
    expect(result.current.document?.name).toBe('Edited during reload');
    expect(result.current.revision).toBe(1);
    expect(result.current.dirty).toBe(true);
    expect(result.current.notices.some(notice => notice.message.includes('Reload cancelled'))).toBe(true);
    act(() => result.current.undo());
    expect(result.current.document?.name).toBe(originalName);
    act(() => result.current.redo());
    expect(result.current.document?.name).toBe('Edited during reload');
  });

  it('retains the local document on conflict and only overwrites after explicit keep-local', async () => {
    vi.mocked(saveDraft).mockRejectedValueOnce(new ApiError('Draft revision conflict', 409));
    const { result } = renderHook(useStudio);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.apply(document => { document.name = 'Local work'; }));
    await act(async () => { await result.current.publish(); });
    expect(result.current.conflict).toBe(true);
    expect(result.current.document?.name).toBe('Local work');
    expect(result.current.dirty).toBe(true);
    expect(publishDraft).not.toHaveBeenCalled();
    vi.mocked(loadDraft).mockResolvedValue({ document: createSampleDocument(), revision: 7, updatedAt: timestamp });
    await act(async () => { await result.current.keepLocal(); });
    expect(saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Local work' }), 7);
    expect(result.current.revision).toBe(8);
    expect(result.current.conflict).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('rejects invalid imports without replacing the document or undo history', async () => {
    vi.mocked(validateDocument).mockResolvedValue({ valid: false, errors: ['pages: at least one page is required'] });
    const { result } = renderHook(useStudio);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.apply(document => { document.name = 'Keep this draft'; }));
    await act(async () => {
      await expect(result.current.importDocument({ pages: [] })).rejects.toThrow('at least one page');
    });
    expect(result.current.document?.name).toBe('Keep this draft');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.dirty).toBe(true);
  });
});
