import { describe, expect, it } from 'vitest';
import { putControlsOnTop, setOverlayPosition, takeOffOverlay } from '../src/workspace2/nodeActions';

const tile = { id: 'tile-a', title: 'Tile', type: 'text', layout: {}, props: { value: { type: 'literal', value: 'A' }, style: 'body', unavailableText: 'x' } };
const control = { ...tile, id: 'tile-b', title: 'Control' };
const doc = (children: unknown[]) => ({ pages: [{ id: 'home', title: 'Home', children }] }) as never;

describe('overlay commands', () => {
  it('wraps a node as the base of an overlay and takes it off again', () => {
    const wrapped = putControlsOnTop(doc([tile]), ['pages', 0, 'children', 0]) as never as { pages: { children: { type: string; children: { id: string }[] }[] }[] };
    expect(wrapped.pages[0].children[0].type).toBe('overlay');
    expect(wrapped.pages[0].children[0].children[0].id).toBe('tile-a');
    const back = takeOffOverlay(wrapped as never, ['pages', 0, 'children', 0]) as never as typeof wrapped;
    expect((back.pages[0].children[0] as unknown as { id: string }).id).toBe('tile-a');
  });
  it('positions a control with the Medium inset by default and keeps a chosen one', () => {
    const overlay = { id: 'o', title: 'Overlay', type: 'overlay', layout: {}, props: { anchors: [] }, children: [tile, control] };
    const placed = setOverlayPosition(doc([overlay]), ['pages', 0, 'children', 0], 'tile-b', 'center') as never as { pages: { children: { props: { anchors: unknown[] } }[] }[] };
    expect(placed.pages[0].children[0].props.anchors).toEqual([{ childId: 'tile-b', anchor: 'center', inset: { type: 'points', value: 12 } }]);
    const again = setOverlayPosition(placed as never, ['pages', 0, 'children', 0], 'tile-b', 'top-leading', 24) as never as typeof placed;
    expect(again.pages[0].children[0].props.anchors).toEqual([{ childId: 'tile-b', anchor: 'top-leading', inset: { type: 'points', value: 24 } }]);
  });
});
