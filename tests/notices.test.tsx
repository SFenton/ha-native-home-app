// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDraft, request } from '../src/api';
import { NOTICE_LIFETIME_MS, useStudio } from '../src/useStudio';
import { createSampleDocument } from '../src/shared/sample';

vi.mock('../src/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/api')>(),
  loadDraft: vi.fn(), saveDraft: vi.fn(), validateDocument: vi.fn(), request: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadDraft).mockResolvedValue({ document: createSampleDocument(), revision: 1, updatedAt: '2026-11-12T12:00:00.000Z' });
  vi.mocked(request).mockResolvedValue({ mode: 'sample' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('notice lifetime', () => {
  it('removes info and success notices after the lifetime and keeps errors until dismissed', async () => {
    const { result } = renderHook(useStudio);
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    act(() => { result.current.notify('Saved', 'success'); result.current.notify('FYI', 'info'); result.current.notify('Broken', 'error'); });
    expect(result.current.notices.map(notice => notice.message)).toEqual(['Saved', 'FYI', 'Broken']);
    act(() => { vi.advanceTimersByTime(NOTICE_LIFETIME_MS - 1); });
    expect(result.current.notices).toHaveLength(3);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.notices.map(notice => notice.message)).toEqual(['Broken']);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current.notices).toHaveLength(1);
    act(() => result.current.dismissNotice(result.current.notices[0].id));
    expect(result.current.notices).toHaveLength(0);
  });

  it('does not toast on load when StrictMode runs the reload effect twice', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(useStudio, { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notices).toEqual([]);
  });
});
