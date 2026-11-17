// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/api';
import fixture from '../src/preview2/fixtures/home-domains.json';
import { replaceAt } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { canonicalCompositionJSON } from '../src/shared/composition/json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { CompositionDraft } from '../src/shared/composition/workspace';
import { buildDocumentIndex } from '../src/preview2/model';
import { CHECKS_QUIET_MS } from '../src/workspace2/useChecks';
import { useWorkspace2 } from '../src/workspace2/useWorkspace2';

vi.mock('../src/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/api')>(), request: vi.fn() }));
// Counting the whole-document passes is the budget: a keystroke must not pay for one.
vi.mock('../src/shared/composition/compiler', async importOriginal => {
  const original = await importOriginal<typeof import('../src/shared/composition/compiler')>();
  return { ...original, compileCompositionDocument: vi.fn(original.compileCompositionDocument) };
});
vi.mock('../src/shared/composition/json', async importOriginal => {
  const original = await importOriginal<typeof import('../src/shared/composition/json')>();
  return { ...original, canonicalCompositionJSON: vi.fn(original.canonicalCompositionJSON) };
});

const compile = vi.mocked(compileCompositionDocument);
const serialise = vi.mocked(canonicalCompositionJSON);

function envelope(): CompositionDraft {
  const document = structuredClone(fixture.document) as unknown as CompositionDocument;
  return { envelopeVersion: '2.0', publisherId: 'demo_publisher', revision: 1, updatedAt: '2026-11-13T10:00:00Z', document, capabilities: fixture.capabilities, assetManifestSha256: 'a'.repeat(64) } as CompositionDraft;
}

beforeEach(() => { vi.mocked(request).mockReset(); });
afterEach(cleanup);

async function loaded() {
  vi.mocked(request).mockResolvedValueOnce(envelope());
  const hook = renderHook(() => useWorkspace2(false));
  await waitFor(() => expect(hook.result.current.document).toBeDefined());
  return hook;
}
/** The first tile that has a title of its own, and the path of that title. */
const firstTitle = (document: CompositionDocument) => {
  const index = buildDocumentIndex(document);
  const key = index.keys.find(item => item.startsWith('node:') && index.get(item)?.node?.title)!;
  return [...index.get(key)!.path, 'title'];
};

describe('typing in a field', () => {
  it('compiles and serialises nothing while the characters go in, and compiles once when they pause', async () => {
    const { result } = await loaded();
    const path = firstTitle(result.current.document!);
    // Loading checked the document once; the rest is counted from here.
    compile.mockClear(); serialise.mockClear();
    for (let at = 1; at <= 20; at++) {
      act(() => result.current.studio.apply(replaceAt(result.current.studio.latestDocument()!, path, `Demo ${'x'.repeat(at)}`)));
    }
    expect(compile).toHaveBeenCalledTimes(0);
    expect(serialise).toHaveBeenCalledTimes(0);
    // The checks have not caught up with the newest edit; the preview already shows it.
    expect(result.current.previewDocument).toBe(result.current.document);
    await waitFor(() => expect(compile).toHaveBeenCalledTimes(1), { timeout: CHECKS_QUIET_MS * 10 });
    expect(serialise).toHaveBeenCalledTimes(0);
  });

  it('keeps typing one undo step, and the document unsaved', async () => {
    const { result } = await loaded();
    const before = result.current.document!;
    const path = firstTitle(before);
    for (let at = 1; at <= 20; at++) act(() => result.current.studio.apply(replaceAt(result.current.studio.latestDocument()!, path, `Demo ${'y'.repeat(at)}`)));
    expect(result.current.studio.dirty).toBe(true);
    act(() => result.current.studio.undo());
    expect(result.current.document).toBe(before);
    expect(result.current.studio.dirty).toBe(false);
  });

  it('checks the newest edit before a publish acts on it', async () => {
    const { result } = await loaded();
    const path = firstTitle(result.current.document!);
    act(() => result.current.studio.apply(replaceAt(result.current.studio.latestDocument()!, path, 'Demo one')));
    compile.mockClear();
    // Publish does not wait for the quiet period: it settles the checks itself, once.
    act(() => result.current.openPublish());
    expect(compile).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('confirm');
  });
});

describe('taking back a drop the compiler refused', () => {
  it('restores the document before the drop, leaves nothing to redo, and only while the drop is the newest edit', async () => {
    const { result } = await loaded();
    const before = result.current.document!;
    const path = firstTitle(before);
    const dropped = replaceAt(before, path, 'Demo dropped');
    act(() => result.current.studio.apply(dropped));
    let taken = false;
    act(() => { taken = result.current.studio.revert(dropped); });
    expect(taken).toBe(true);
    expect(result.current.document).toBe(before);
    expect(result.current.studio.canRedo).toBe(false);
    act(() => { taken = result.current.studio.revert(dropped); });
    expect(taken).toBe(false);
  });
});
