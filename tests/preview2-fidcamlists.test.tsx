// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { fakePicture } from '../src/preview2/fixtures/fake-picture';
import { FIDCAMLISTS_VIEWER, fidcamlistsStory } from '../src/preview2/fixtures/fidcamlists-story';
import { CAMERA_POLL_MS, cameraFace, pictureType } from '../src/preview2/nodes/camera-picture';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import type { CompositionDocument } from '../src/shared/composition/schema';

const base = homeDomains.document as unknown as CompositionDocument;
const story = fidcamlistsStory(base);

beforeEach(() => {
  let count = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:demo-${count++}`), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function mount(surface: { kind: 'page' | 'modal'; id: string }, over: Partial<Preview2Props> = {}, document = story.document) {
  const props: Preview2Props = { document, mode: 'use', surface, onSurfaceChange: vi.fn(), onSelect: vi.fn(), window: previewWindows[0], bezel: false,
    house: story.house, overlay: emptyOverlay, onOverlayChange: vi.fn(), ...over };
  return render(<Preview2 {...props}/>);
}
const frame = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;
const names = () => [...document.querySelectorAll('.sh-todo-section h3')].map(node => node.textContent);

describe('the camera tile draws the camera, not a poster with a hint (item 8)', () => {
  it('draws the latest still of the snapshot entity with the name capsule and a Snapshot mark, and never says Live', async () => {
    const picture = vi.fn(fakePicture);
    const { container } = mount({ kind: 'page', id: 'page-home' }, { mapPicture: picture });
    const tile = frame(container, 'hc-camera-0-tile');
    await waitFor(() => expect(tile.querySelector('img.sh-cam-still')).not.toBeNull());
    expect(picture).toHaveBeenCalledWith('camera.demo_entity_119', expect.anything());
    expect(tile.querySelector('[data-testid=camera-name]')!.textContent).toBe('Demo Camera');
    expect(tile.querySelector('[data-testid=camera-state]')!.textContent).toBe('Snapshot');
    expect(tile.textContent).not.toMatch(/Live/);
  });
  it('keeps "Opens the camera" as the accessibility hint only', () => {
    const { container } = mount({ kind: 'page', id: 'page-home' }, { mapPicture: fakePicture });
    const button = frame(container, 'hc-camera-0-tile').querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Demo Camera camera');
    const hint = document.getElementById(button.getAttribute('aria-describedby')!)!;
    expect(hint.hidden).toBe(true);
    expect(hint.textContent).toBe('Opens the camera');
    expect(screen.queryByText('Opens the camera', { ignore: '[hidden]' })).toBeNull();
  });
  it('draws the camera mark and the name, with no Snapshot mark, while there is no picture', () => {
    const { container } = mount({ kind: 'page', id: 'page-home' });
    const tile = frame(container, 'hc-camera-0-tile');
    expect(tile.querySelector('img')).toBeNull();
    expect(tile.querySelector('.sh-cam-mark')).not.toBeNull();
    expect(tile.querySelector('[data-testid=camera-name]')!.textContent).toBe('Demo Camera');
    expect(tile.querySelector('[data-testid=camera-state]')).toBeNull();
  });
  it('draws the same on the Security page', async () => {
    const { container } = mount({ kind: 'page', id: 'page-security' }, { mapPicture: fakePicture });
    const tile = frame(container, 'hc-security-hc-camera-0-tile');
    await waitFor(() => expect(tile.querySelector('img.sh-cam-still')).not.toBeNull());
    expect(tile.querySelector('[data-testid=camera-state]')!.textContent).toBe('Snapshot');
  });
  it('draws the still in the camera viewer of the modal too', async () => {
    const { container } = mount({ kind: 'modal', id: 'hc-camera-0-modal' }, { mapPicture: fakePicture });
    const viewer = frame(container, 'hc-camera-0-viewer');
    await waitFor(() => expect(viewer.querySelector('img.sh-cam-still')).not.toBeNull());
    expect(viewer.querySelector('[data-testid=camera-name]')!.textContent).toBe('Demo Camera');
    expect(viewer.querySelector('[data-testid=camera-state]')!.textContent).toBe('Snapshot');
    expect(viewer.querySelectorAll('.sh-cam-control').length).toBeGreaterThan(0);
  });
  it('reads a new still every few seconds in Use, keeps the last one when a read fails, and reads once in Edit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const picture = vi.fn(fakePicture);
    const { container, unmount } = mount({ kind: 'page', id: 'page-home' }, { mapPicture: picture });
    await vi.waitFor(() => expect(picture).toHaveBeenCalledTimes(1));
    picture.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(CAMERA_POLL_MS + 50); });
    expect(picture).toHaveBeenCalledTimes(2);
    expect(frame(container, 'hc-camera-0-tile').querySelector('img.sh-cam-still')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(CAMERA_POLL_MS + 50); });
    expect(picture).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(CAMERA_POLL_MS * 2); });
    expect(picture).toHaveBeenCalledTimes(3);
    cleanup();
    const once = vi.fn(fakePicture);
    mount({ kind: 'page', id: 'page-home' }, { mapPicture: once, mode: 'edit' });
    await vi.waitFor(() => expect(once).toHaveBeenCalledTimes(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(CAMERA_POLL_MS * 2); });
    expect(once).toHaveBeenCalledTimes(1);
  });
  it('knows the camera source labels and the picture type from its bytes', async () => {
    expect(cameraFace(base.dataSources, 'hc-camera-0')).toMatchObject({ entityId: 'camera.demo_entity_119', snapshot: 'Snapshot' });
    expect(cameraFace(base.dataSources, 'nothing')).toBeUndefined();
    expect(cameraFace(undefined, 'hc-camera-0')).toBeUndefined();
    expect(pictureType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(pictureType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(pictureType(new Uint8Array([0x47, 0x49, 0x46]))).toBe('image/gif');
    expect(pictureType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57]))).toBe('image/webp');
    expect(pictureType(new Uint8Array(await fakePicture('camera.demo_a')))).toBe('image/svg+xml');
  });
});

describe('the Chores collection draws the provider\'s sections (item 15)', () => {
  it('draws a heading and the open tasks of each list the viewer may see, and leaves out a list with nothing open', () => {
    const { container } = mount({ kind: 'page', id: 'page-fid-chores' });
    expect(names()).toEqual(['Past Due', 'Evening Tasks', 'Alex']);
    expect(container.querySelector('.sh-skel')).toBeNull();
    const sections = [...container.querySelectorAll('.sh-todo-section')];
    const rows = (index: number) => [...sections[index].querySelectorAll('.sh-todo-row .sh-row-primary')].map(row => row.textContent);
    expect(rows(0)).toEqual(['Replace the hallway bulb', 'Return the library books']);
    expect(rows(1)).toEqual(['Run the dishwasher', 'Set out the recycling', 'Lock the back gate']);
    expect(sections[1].querySelectorAll('.sh-todo-row[data-done]')).toHaveLength(1);
    expect(sections[0].querySelectorAll('.sh-todo-row[data-done]')).toHaveLength(0);
    expect(rows(2)).toEqual(['Water the herbs', 'Sort the mail']);
  });
  it('shows a due date under a task that has one', () => {
    const { container } = mount({ kind: 'page', id: 'page-fid-chores' });
    expect(container.querySelector('.sh-todo-row .sh-row-secondary')!.textContent).toMatch(/^Due Nov 9$/);
  });
  it('follows the viewer rule: another person sees their own list and not the first one', () => {
    const states = [...story.house.states!.values()];
    mount({ kind: 'page', id: 'page-fid-chores' }, { house: houseFrom({ states, currentUser: { id: 'demo-user-sam', name: 'Sam', isOwner: false, isAdmin: false } }) });
    expect(names()).toEqual(['Past Due', 'Evening Tasks', 'Sam']);
  });
  it('hides a viewer-gated list until the viewer is known', () => {
    mount({ kind: 'page', id: 'page-fid-chores' }, { house: houseFrom({ states: [...story.house.states!.values()] }) });
    expect(names()).toEqual(['Past Due', 'Evening Tasks']);
    expect(FIDCAMLISTS_VIEWER).toBe('demo-user-alex');
  });
  it('draws no heading when the provider hides them, and the provider\'s empty words when no list shows', () => {
    const document = structuredClone(story.document);
    const source = document.dataSources.find(item => item.id === 'fid-chores-source') as unknown as { inputs: { hideListHeaders: boolean } };
    source.inputs.hideListHeaders = true;
    const first = mount({ kind: 'page', id: 'page-fid-chores' }, {}, document);
    expect(names()).toEqual([]);
    expect(first.container.querySelectorAll('.sh-todo-section')).toHaveLength(3);
    first.unmount();
    const nothing = mount({ kind: 'page', id: 'page-fid-chores' }, { house: houseFrom({ states: [...story.house.states!.values()].map(state => state.todoList ? { ...state, todoList: { status: 'ready' as const, items: [] } } : state) }) });
    expect(nothing.container.querySelector('.sh-list-state-title')!.textContent).toBe('Nothing to Do');
    expect(nothing.container.querySelector('.sh-list-empty-message')!.textContent).toBe('Every list is finished.');
  });
  it('says so when a list could not be read, and keeps placeholders until the house arrives', () => {
    const states = [...story.house.states!.values()].map(state => state.entityId === 'todo.demo_evening' ? { ...state, todoList: { status: 'error' as const, message: 'Chores could not be loaded.' } } : state);
    mount({ kind: 'page', id: 'page-fid-chores' }, { house: houseFrom({ states }) });
    expect(screen.getByText('Chores could not be loaded.')).toBeTruthy();
    cleanup();
    const waiting = mount({ kind: 'page', id: 'page-fid-chores' }, { house: { get states() { return undefined; } } });
    expect(waiting.container.querySelectorAll('.sh-skel').length).toBeGreaterThan(0);
    expect(names()).toEqual([]);
  });
});
