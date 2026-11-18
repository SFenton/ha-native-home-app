// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { copyScrolls, elementAt, pathTo, visibleCopy } from '../src/preview2/twin-scroll';

/** Two copies of the same tree, each in a clip, as the partly folded Duo draws them. */
function copies(markup = '<div class="s"><p>a</p><div class="scroll"><i>1</i><i id="deep">2</i></div></div>') {
  document.body.innerHTML = `<div id="a" class="sh-clip"><div class="host">${markup}</div></div><div id="b" class="sh-clip"><div class="host">${markup}</div></div>`;
  const hosts = [...document.querySelectorAll('.host')];
  return { a: hosts[0], b: hosts[1], clipA: document.getElementById('a')!, clipB: document.getElementById('b')! };
}
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const place = (element: Element, box: DOMRect) => { element.getBoundingClientRect = () => box; };
afterEach(() => { document.body.innerHTML = ''; });

describe('the child-index path between two copies of a screen', () => {
  it('names an element by its child indexes below the root, and finds the same one in the other copy', () => {
    const { a, b } = copies();
    const deepA = a.querySelector('#deep')!, deepB = b.querySelector('#deep')!;
    expect(pathTo(a, deepA)).toEqual([0, 1, 1]);
    expect(elementAt(b, pathTo(a, deepA)!)).toBe(deepB);
    expect(pathTo(a, a)).toEqual([]);
    expect(elementAt(b, [])).toBe(b);
  });

  it('has no path for an element outside the root, and no element for a path that runs out', () => {
    const { a, b } = copies();
    expect(pathTo(a, b.querySelector('p')!)).toBeUndefined();
    expect(elementAt(b, [0, 9])).toBeUndefined();
    expect(elementAt(b, [0, 0, 0, 0])).toBeUndefined();
  });
});

describe('copying scroll offsets', () => {
  it('gives the second copy the first copy\'s offsets at every depth, and leaves equal ones alone', () => {
    const { a, b } = copies();
    const scrolled = a.querySelector('.scroll') as HTMLElement;
    scrolled.scrollTop = 40; scrolled.scrollLeft = 7;
    copyScrolls(a, b);
    const other = b.querySelector('.scroll') as HTMLElement;
    expect([other.scrollTop, other.scrollLeft]).toEqual([40, 7]);
    expect(() => copyScrolls(a, b)).not.toThrow();
  });

  it('stops where the trees differ in shape', () => {
    const { a, b } = copies();
    b.querySelector('.scroll')!.remove();
    expect(() => copyScrolls(a, b)).not.toThrow();
  });
});

describe('which copy of an element is the one a person can see', () => {
  it('is the only copy when there is one, and nothing when there is none', () => {
    const { a } = copies();
    expect(visibleCopy([a])).toBe(a);
    expect(visibleCopy([])).toBeUndefined();
  });

  it('is the copy whose half shows the element\'s centre, across a vertical hinge', () => {
    const { a, b, clipA, clipB } = copies();
    place(clipA, rect(0, 0, 400, 600)); place(clipB, rect(400, 0, 400, 600));
    const tileA = a.querySelector('p')!, tileB = b.querySelector('p')!;
    // A tile in the second half: its copy in the first half sits outside that half's clip.
    place(tileA, rect(500, 100, 100, 40)); place(tileB, rect(500, 100, 100, 40));
    expect(visibleCopy([tileA, tileB])).toBe(tileB);
    place(tileA, rect(100, 100, 100, 40)); place(tileB, rect(100, 100, 100, 40));
    expect(visibleCopy([tileA, tileB])).toBe(tileA);
  });

  it('judges by the hinge\'s axis only: a node scrolled below its clip still belongs to the half it is in', () => {
    const { a, b, clipA, clipB } = copies();
    place(clipA, rect(0, 0, 400, 600)); place(clipB, rect(400, 0, 400, 600));
    const tileA = a.querySelector('p')!, tileB = b.querySelector('p')!;
    place(tileA, rect(500, 1500, 100, 40)); place(tileB, rect(500, 1500, 100, 40));
    expect(visibleCopy([tileA, tileB])).toBe(tileB);
  });

  it('judges by y across a horizontal hinge', () => {
    const { a, b, clipA, clipB } = copies();
    place(clipA, rect(0, 0, 600, 400)); place(clipB, rect(0, 400, 600, 400));
    const tileA = a.querySelector('p')!, tileB = b.querySelector('p')!;
    place(tileA, rect(10, 450, 100, 40)); place(tileB, rect(10, 450, 100, 40));
    expect(visibleCopy([tileA, tileB])).toBe(tileB);
    place(tileA, rect(10, 50, 100, 40)); place(tileB, rect(10, 50, 100, 40));
    expect(visibleCopy([tileA, tileB])).toBe(tileA);
  });

  it('falls back to the first copy when neither half shows it, and takes a copy outside any clip', () => {
    const { a, b, clipA, clipB } = copies();
    place(clipA, rect(0, 0, 400, 600)); place(clipB, rect(400, 0, 400, 600));
    const tileA = a.querySelector('p')!, tileB = b.querySelector('p')!;
    place(tileA, rect(2000, 0, 10, 10)); place(tileB, rect(2000, 0, 10, 10));
    expect(visibleCopy([tileA, tileB])).toBe(tileA);
    const loose = document.createElement('div'), other = document.createElement('div');
    expect(visibleCopy([loose, other])).toBe(loose);
  });
});

