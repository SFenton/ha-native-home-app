// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fidtilesStory } from '../src/preview2/fixtures/fidtiles-story';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import { PreviewInkContext, type PreviewInk } from '../src/preview2/ink';

afterEach(cleanup);

const story = fidtilesStory();
function mount(over: Partial<Preview2Props> = {}, ink?: PreviewInk) {
  const props: Preview2Props = { document: story.document, mode: 'use', surface: { kind: 'page', id: story.document.navigation.initialPageId }, onSurfaceChange: vi.fn(), onSelect: vi.fn(),
    window: previewWindows[0], bezel: false, house: story.house, overlay: emptyOverlay, onOverlayChange: vi.fn(), ...over };
  const preview = <Preview2 {...props}/>;
  return render(ink ? <PreviewInkContext.Provider value={ink}>{preview}</PreviewInkContext.Provider> : preview).container.querySelector<HTMLElement>('[data-preview-root]')!;
}

describe('the tile ink gate in the simulator (sh.tile-ink-default@1)', () => {
  it('draws the shipped primary ink by default', () => {
    expect(mount().dataset.ink).toBe('primary');
  });
  it('draws the primary ink when asked explicitly', () => {
    expect(mount({ ink: 'primary' }).dataset.ink).toBe('primary');
  });
  it('lets a caller ask for the grey explicitly', () => {
    expect(mount({ ink: 'muted' }).dataset.ink).toBe('muted');
  });
  it('inherits the saved workspace ink', () => {
    expect(mount({}, 'muted').dataset.ink).toBe('muted');
  });
  it('keeps an explicit harness override ahead of the workspace ink', () => {
    expect(mount({ ink: 'primary' }, 'muted').dataset.ink).toBe('primary');
  });
});
