// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { playReflow, planReflow, type Measured } from '../src/preview2/reflow';

const at = (x: number, y: number, width = 100, height = 50, parent?: string, leaf = true): Measured => ({ frame: { x, y, width, height }, parent, leaf });

describe('planning a reflow', () => {
  it('moves what changed frame and leaves what did not', () => {
    const before = new Map([['a', at(0, 0)], ['b', at(120, 0)]]);
    const after = new Map([['a', at(0, 0)], ['b', at(0, 60)]]);
    expect(planReflow(before, after)).toEqual([{ id: 'b', dx: 120, dy: -60 }]);
  });

  it('starts an element at its old place: the translation is old minus new', () => {
    const [move] = planReflow(new Map([['t', at(10, 20)]]), new Map([['t', at(110, 220)]]));
    expect(move).toEqual({ id: 't', dx: -100, dy: -200 });
  });

  it('resizes only an element with no node inside it, so text is never drawn scaled and a container does not thrash its grid', () => {
    const before = new Map([['tile', at(0, 0, 200, 80)], ['box', at(0, 100, 400, 80, undefined, false)]]);
    const after = new Map([['tile', at(0, 0, 100, 80)], ['box', at(0, 100, 200, 80, undefined, false)]]);
    expect(planReflow(before, after)).toEqual([{ id: 'tile', dx: 0, dy: 0, width: { from: 200, to: 100 }, height: { from: 80, to: 80 } }]);
  });

  it('measures a child against its parent, because it rides in the parent\'s own movement', () => {
    const before = new Map([['section', at(0, 0, 400, 300, undefined, false)], ['tile', at(0, 40, 100, 50, 'section')]]);
    const after = new Map([['section', at(420, 0, 400, 300, undefined, false)], ['tile', at(420, 40, 100, 50, 'section')]]);
    // The section moves 420 across; the tile, inside it, moves nothing of its own.
    expect(planReflow(before, after)).toEqual([{ id: 'section', dx: -420, dy: 0 }]);
  });

  it('ignores sub-half-point differences and elements that exist in only one of the two', () => {
    const before = new Map([['a', at(0, 0)], ['gone', at(5, 5)]]);
    const after = new Map([['a', at(0.3, -0.4, 100.2, 50)], ['new', at(9, 9)]]);
    expect(planReflow(before, after)).toEqual([]);
  });
});

/** An element whose `animate` returns what the test hands out, and the events it hears. */
function listened(animation: () => unknown) {
  const element = document.createElement('div');
  (element as unknown as { animate: unknown }).animate = animation;
  const heard: string[] = [];
  element.addEventListener('sh-reflow-start', () => heard.push('start'));
  element.addEventListener('sh-reflow-end', () => heard.push('end'));
  return { element, heard };
}
const token = { ms: 300, ease: 'ease' };
const move = [{ id: 'a', dx: 10, dy: 0 }];
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('playing a reflow says when each move starts and ends', () => {
  it('sends one start, then one end, when the move finishes', async () => {
    let finish!: () => void;
    const { element, heard } = listened(() => ({ finished: new Promise<void>(resolve => { finish = resolve; }) }));
    playReflow(move, new Map([['a', element]]), token);
    expect(heard).toEqual(['start']);
    finish(); await flush();
    expect(heard).toEqual(['start', 'end']);
  });

  it('sends the end when the move is cancelled or interrupted (finished rejects)', async () => {
    let cancel!: (reason: unknown) => void;
    const { element, heard } = listened(() => ({ finished: new Promise<void>((_, reject) => { cancel = reject; }) }));
    playReflow(move, new Map([['a', element]]), token);
    cancel(new DOMException('cancelled', 'AbortError')); await flush();
    expect(heard).toEqual(['start', 'end']);
  });

  it('sends neither when there is no way to know the end (no finished), so a start is never left open', async () => {
    const { element, heard } = listened(() => ({}));
    expect(playReflow(move, new Map([['a', element]]), token)).toHaveLength(1);
    await flush();
    expect(heard).toEqual([]);
  });

  it('sends one pair for each move', async () => {
    const heard: string[] = [];
    const make = (name: string) => {
      const { element } = listened(() => ({ finished: Promise.resolve() }));
      element.addEventListener('sh-reflow-start', () => heard.push(`${name}:start`)); element.addEventListener('sh-reflow-end', () => heard.push(`${name}:end`));
      return element;
    };
    playReflow([{ id: 'a', dx: 1, dy: 0 }, { id: 'b', dx: 2, dy: 0 }], new Map([['a', make('a')], ['b', make('b')]]), token);
    await flush();
    expect(heard.sort()).toEqual(['a:end', 'a:start', 'b:end', 'b:start']);
  });
});
