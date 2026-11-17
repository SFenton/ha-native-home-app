// @vitest-environment jsdom
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/api';
import fixture from '../src/preview2/fixtures/home-domains.json';
import { compilerIssuesOf, replaceAt, valueAt, type EditorPath } from '../src/composition-editor';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { CompositionDraft } from '../src/shared/composition/workspace';
import { buildDocumentIndex, type SelectionKey } from '../src/preview2/model';
import { demoHouse } from '../src/preview2/demo-house';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { endOf, insertType } from '../src/workspace2/add/insert';
import { CHECKS_QUIET_MS } from '../src/workspace2/useChecks';
import { useWorkspace2 } from '../src/workspace2/useWorkspace2';

vi.mock('../src/api', async importOriginal => ({ ...await importOriginal<typeof import('../src/api')>(), request: vi.fn() }));

/**
 * A problem is something to fix before Save and Publish, never a reason to hold back the next edit. For one node of each family
 * of node types, a second field is made invalid, then the title is edited: the document, the draft handed to the preview and the
 * preview's own drawing must all carry the edit, while the problem still stands in Checks.
 */
afterEach(cleanup);
beforeEach(() => { vi.mocked(request).mockReset(); });

const envelope = (document: CompositionDocument): CompositionDraft => ({ envelopeVersion: '2.0', publisherId: 'demo_publisher', revision: 1, updatedAt: '2026-11-13T10:00:00Z', document, capabilities: fixture.capabilities, assetManifestSha256: 'a'.repeat(64) } as CompositionDraft);
const start = () => structuredClone(fixture.document) as unknown as CompositionDocument;

/** A settings link added at the end of the Cameras section, the way the Add picker adds one. */
function withSettingsLink(): { document: CompositionDocument; key: SelectionKey } {
  const document = start();
  const destination = endOf(document, 'node:hc-home-cameras' as SelectionKey)!;
  return insertType(document, destination, 'settings-link');
}

/** The first text a person could blank in the node's props (not the title the test edits), that the compiler then objects to. */
function blankable(document: CompositionDocument, path: EditorPath, not: EditorPath): EditorPath {
  const baseline = compilerIssuesOf(document).length;
  const props = valueAt(document, [...path, 'props']) as Record<string, unknown> | undefined;
  const names = Object.keys(props ?? {}).filter(name => typeof props![name] === 'string');
  for (const name of names) if ([...path, 'props', name].join('/') !== not.join('/') && compilerIssuesOf(replaceAt(document, [...path, 'props', name], '')).length > baseline) return [...path, 'props', name];
  throw new Error(`No text of ${path.join('/')} can be made invalid`);
}

const readable = (container: HTMLElement) => `${container.textContent}\n${[...container.querySelectorAll('[aria-label]')].map(element => element.getAttribute('aria-label')).join('\n')}`;

/** One node per family: layout, tiles, content rows, panels, security, climate and cameras. */
const families: { family: string; type: string; id?: string; /** The field edited, below the node: the title unless the node draws other words. */ edit?: EditorPath;
  /** The field made invalid, below the node and its value: found by blanking each text unless named. */ invalid?: { at: EditorPath; value: unknown } }[] = [
  { family: 'layout', type: 'section', id: 'hc-home-cameras', edit: ['props', 'header'], invalid: { at: ['title'], value: '' } },
  { family: 'layout (rooms)', type: 'room-section', id: 'hc-home-guests-visible' },
  { family: 'tiles', type: 'action-tile', id: 'hc-home-guest-0' },
  { family: 'tiles (navigation)', type: 'navigation-tile', id: 'hc-open-rooms' },
  { family: 'tiles (lights)', type: 'light-group-tile', id: 'hc-lights-demo-room-1-item-0' },
  { family: 'content rows', type: 'row', id: 'hc-lights-demo-room-1-summary', edit: ['props', 'secondary', 'value'], invalid: { at: ['props', 'loadingText'], value: '' } },
  // The reported bug: Add Hint puts an empty hint on the link, which the compiler refuses until it is filled.
  { family: 'content (settings link)', type: 'settings-link', invalid: { at: ['props', 'hint'], value: '' } },
  { family: 'panels', type: 'weather-panel', id: 'hc-weather-summary' },
  { family: 'security', type: 'alarm-panel', id: 'hc-alarm-local-panel' },
  { family: 'security (doors)', type: 'door-tile', id: 'hc-door-1-tile' },
  { family: 'cameras', type: 'camera-tile', id: 'hc-camera-0-tile' },
  { family: 'climate', type: 'climate-control', id: 'hc-climate-room-demo-room-1-dial' },
  { family: 'rooms', type: 'room-overview-tile', id: 'hc-climate-demo-room-1-item-0' },
];

describe.each(families)('$family: a $type', ({ type, id, edit = ['title'], invalid: named }) => {
  it('takes a title edit into the draft, the preview document and the drawing while another field is invalid', async () => {
    const made = type === 'settings-link' ? withSettingsLink() : undefined;
    const original = made?.document ?? start();
    const key = (made?.key ?? `node:${id}`) as SelectionKey;
    const entry = buildDocumentIndex(original).get(key)!;
    expect(entry.node?.type).toBe(type);

    vi.mocked(request).mockResolvedValueOnce(envelope(original));
    const { result } = renderHook(() => useWorkspace2(false));
    await waitFor(() => expect(result.current.document).toBeDefined());

    // One field goes invalid, and the Checks say so.
    const invalid = named ? [...entry.path, ...named.at] : blankable(original, entry.path, [...entry.path, ...edit]);
    const invalidValue = named ? named.value : '';
    act(() => result.current.studio.apply(replaceAt(result.current.studio.latestDocument()!, invalid, invalidValue)));
    await waitFor(() => expect(result.current.problemCount).toBeGreaterThan(0), { timeout: CHECKS_QUIET_MS * 10 });
    await waitFor(() => expect(result.current.checks.problems.length).toBeGreaterThan(0));

    // Another field is edited: the title, or the words the node draws.
    const edited = `Edited ${type}`, editAt = [...entry.path, ...edit];
    act(() => result.current.studio.apply(replaceAt(result.current.studio.latestDocument()!, editAt, edited)));
    expect(valueAt(result.current.document, editAt)).toBe(edited);
    // At once, before the Checks have looked at the edit, and again after they have: the preview never trails the draft.
    expect(result.current.previewDocument).toBe(result.current.document);
    await new Promise(resolve => setTimeout(resolve, CHECKS_QUIET_MS * 3));
    await waitFor(() => expect(result.current.checks.problems.length).toBeGreaterThan(0));
    expect(result.current.previewDocument).toBe(result.current.document);
    expect(valueAt(result.current.previewDocument, editAt)).toBe(edited);
    expect(valueAt(result.current.previewDocument, invalid)).toBe(invalidValue);

    // The preview draws it, still with the problem standing.
    const shown = result.current.previewDocument!, surface = buildDocumentIndex(shown).get(key)!.surface!;
    const { container } = render(<Preview2 document={shown} mode="edit" surface={{ kind: surface.startsWith('modal:') ? 'modal' : 'page', id: surface.slice(surface.indexOf(':') + 1) }}
      onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={previewWindows[0]} bezel={false} house={demoHouse(shown)} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
    expect(readable(container)).toContain(edited);
    // Save and Publish stay held back: the problem is still there to fix.
    expect(result.current.problemCount).toBeGreaterThan(0);
  });
});
