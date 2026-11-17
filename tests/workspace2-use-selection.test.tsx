// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/api';
import fixture from '../src/preview2/fixtures/home-domains.json';
import { replaceAt } from '../src/composition-editor';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { CompositionDraft } from '../src/shared/composition/workspace';
import { buildDocumentIndex, type SelectionKey } from '../src/preview2/model';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import { useWorkspace2 } from '../src/workspace2/useWorkspace2';
import { Project } from './support/workspace2-surfaces';

vi.mock('../src/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/api')>(), request: vi.fn() }));
afterEach(cleanup);
beforeEach(() => { vi.mocked(request).mockReset(); });

const document = fixture.document as unknown as CompositionDocument;
const envelope = (value: CompositionDocument): CompositionDraft => ({ envelopeVersion: '2.0', publisherId: 'demo_publisher', revision: 1, updatedAt: '2026-11-13T10:00:00Z', document: value, capabilities: fixture.capabilities, assetManifestSha256: 'a'.repeat(64) } as CompositionDraft);
const index = buildDocumentIndex(document);
const key = index.keys.find(item => item.startsWith('node:') && index.get(item)!.node!.title)! as SelectionKey;

async function loaded() {
  vi.mocked(request).mockResolvedValueOnce(envelope(structuredClone(document)));
  const hook = renderHook(() => useWorkspace2(false));
  await waitFor(() => expect(hook.result.current.document).toBeDefined());
  return hook;
}

describe('Use keeps a selection made in the library (L-mark)', () => {
  it('keeps the selection when the mode switches to Use and back, and opens the inspector for it in both', async () => {
    const { result } = await loaded();
    act(() => result.current.select(key));
    expect(result.current.target).toMatchObject({ kind: 'node', key });
    act(() => result.current.setMode('use'));
    expect(result.current.selection).toBe(key);
    expect(result.current.target).toMatchObject({ kind: 'node', key });
    act(() => result.current.setMode('edit'));
    expect(result.current.selection).toBe(key);
  });

  it('still closes a panel such as Tabs when the mode switches to Use', async () => {
    const { result } = await loaded();
    act(() => result.current.setPanel('tabs'));
    expect(result.current.target).toMatchObject({ kind: 'tabs' });
    act(() => result.current.setMode('use'));
    expect(result.current.panel).toBeUndefined();
  });

  it('selects from the library in Use, reveals it, and a field edit applies', async () => {
    const { result } = await loaded();
    act(() => result.current.setMode('use'));
    act(() => result.current.selectAnywhere(key));
    expect(result.current.selection).toBe(key);
    expect(result.current.revealKey).toBe(key);
    const path = index.get(key)!.path;
    act(() => result.current.studio.apply(replaceAt(result.current.studio.latestDocument()!, [...path, 'title'], 'Renamed in Use')));
    expect(buildDocumentIndex(result.current.document!).get(key)!.node!.title).toBe('Renamed in Use');
  });

  it('ends the selection when it is closed', async () => {
    const { result } = await loaded();
    act(() => result.current.select(key));
    act(() => result.current.setMode('use'));
    act(() => result.current.select(undefined));
    expect(result.current.selection).toBeUndefined();
  });
});

describe('the inspector in Use', () => {
  const panel = (mode: 'edit' | 'use') => render(<PropertiesPanel ws={Project.workspace(document, { kind: 'node', key, path: index.get(key)!.path }, { extra: { mode } })} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
  it('keeps More in place but disabled, so Duplicate, Move and Delete cannot be reached', () => {
    panel('use');
    const more = screen.getByRole('button', { name: 'More' }) as HTMLButtonElement;
    expect(more.disabled).toBe(true);
    expect(more.title).toBe('Switch to Edit to change this.');
  });
  it('has the working More menu in Edit', () => {
    panel('edit');
    expect((screen.getByRole('button', { name: 'More' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
