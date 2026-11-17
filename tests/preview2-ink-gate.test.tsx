// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fidtilesStory } from '../src/preview2/fixtures/fidtiles-story';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import { tileInkDefault } from '../src/shared/composition/tile-ink-gate';

afterEach(cleanup);

const story = fidtilesStory();
function mount(over: Partial<Preview2Props> = {}) {
  const props: Preview2Props = { document: story.document, mode: 'use', surface: { kind: 'page', id: story.document.navigation.initialPageId }, onSurfaceChange: vi.fn(), onSelect: vi.fn(),
    window: previewWindows[0], bezel: false, house: story.house, overlay: emptyOverlay, onOverlayChange: vi.fn(), ...over };
  return render(<Preview2 {...props}/>).container.querySelector<HTMLElement>('[data-preview-root]')!;
}

describe('the tile ink gate in the simulator (sh.tile-ink-default@1)', () => {
  it('is off today, so the preview draws the muted grey of an app that predates the id', () => {
    expect(tileInkDefault).toBe(false);
    expect(mount().dataset.ink).toBe('muted');
  });
  it('draws the primary ink when asked, which is what the gate does once it is on', () => {
    expect(mount({ ink: 'primary' }).dataset.ink).toBe('primary');
  });
  it('lets a caller ask for the grey explicitly', () => {
    expect(mount({ ink: 'muted' }).dataset.ink).toBe('muted');
  });
});
