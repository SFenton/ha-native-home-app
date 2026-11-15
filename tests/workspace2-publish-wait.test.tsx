// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from '../src/api';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { createCompositionDocument, type CompositionDraft } from '../src/shared/composition/workspace';
import { useWorkspace2 } from '../src/workspace2/useWorkspace2';

vi.mock('../src/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/api')>(), request: vi.fn() }));

function envelope(revision = 1, name?: string): CompositionDraft {
  const document = createCompositionDocument('synthetic-document');
  if (name) document.name = name;
  return {
    envelopeVersion: '2.0', publisherId: 'synthetic-publisher', revision, updatedAt: '2026-11-13T10:00:00Z',
    document, capabilities: compileCompositionDocument(document).capabilities, assetManifestSha256: 'a'.repeat(64),
  };
}

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe('publishing while an autosave is in flight', () => {
  async function loaded() {
    vi.mocked(request).mockResolvedValueOnce(envelope());
    const hook = renderHook(() => useWorkspace2(false));
    await waitFor(() => expect(hook.result.current.document).toBeDefined());
    return hook;
  }
  it('waits for the save, then publishes, without reporting a failure', async () => {
    const { result } = await loaded();
    act(() => result.current.studio.apply({ ...result.current.document!, name: 'Edited' }));
    let finishSave!: (draft: CompositionDraft) => void;
    const calls: string[] = [];
    vi.mocked(request).mockImplementation((async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/native/api/draft' && init?.method === 'PUT') return new Promise<CompositionDraft>(resolve => { finishSave = resolve; });
      if (url === '/native/api/ha/publish') return { revision: 5 };
      return {};
    }) as typeof request);
    let autosave!: Promise<boolean>, publishing!: Promise<boolean>;
    act(() => { autosave = result.current.persist(); });
    await waitFor(() => expect(result.current.studio.busy).toBe(true));
    act(() => { publishing = result.current.publish(); });
    await Promise.resolve();
    expect(calls).toEqual(['PUT /native/api/draft']);
    await act(async () => { finishSave(envelope(2, 'Edited')); await autosave; });
    await act(async () => { expect(await publishing).toBe(true); });
    expect(calls).toEqual(['PUT /native/api/draft', 'POST /native/api/ha/publish', 'GET /native/api/ha/publication']);
    expect(result.current.failedSave).toBe(false);
    expect(result.current.phase).toBe('idle');
    expect(result.current.status.text).not.toBe('Not Saved');
  });
  it('shows the reason when the save it waited for fails for real and the retry fails too', async () => {
    const { result } = await loaded();
    act(() => result.current.studio.apply({ ...result.current.document!, name: 'Edited' }));
    let failSave!: (reason: unknown) => void;
    vi.mocked(request).mockImplementation((async (url: string, init?: RequestInit) => {
      if (url === '/native/api/draft' && init?.method === 'PUT') return new Promise((_, reject) => { failSave = reject; });
      return {};
    }) as typeof request);
    let autosave!: Promise<boolean>, publishing!: Promise<boolean>;
    act(() => { autosave = result.current.persist(); });
    await waitFor(() => expect(result.current.studio.busy).toBe(true));
    act(() => { publishing = result.current.publish(); });
    await act(async () => { failSave(new ApiError('The disk is full.', 500)); await autosave; });
    await waitFor(() => expect(failSave).toBeDefined());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { failSave(new ApiError('The disk is full.', 500)); expect(await publishing).toBe(false); });
    expect(result.current.phase).toBe('failed');
    expect(result.current.publishError).toBe('The disk is full.');
  });
});
