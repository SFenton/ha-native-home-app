import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex } from '../src/preview2/model';
import { cueFor, locateOnCanvas } from '../src/workspace2/dnd/geometry';
import { endOf } from '../src/workspace2/add/insert';

const doc = (JSON.parse(readFileSync(new URL('../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument }).document;
const index = buildDocumentIndex(doc);
const grid = [...index.entries.values()].find(entry => entry.node?.type === 'tile-grid')!;
const tiles = index.children(grid.key);

type Rect = [number, number, number, number];
/** A minimal DOM stand-in: elements with `getBoundingClientRect`, `children`, `parentElement` and the few queries geometry makes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function element(rect: Rect, attrs: Record<string, string> = {}, children: any[] = []): any {
  const node: any = {
    attrs, children, parentElement: undefined,
    getBoundingClientRect: () => ({ left: rect[0], top: rect[1], width: rect[2], height: rect[3], right: rect[0] + rect[2], bottom: rect[1] + rect[3] }),
    getAttribute: (name: string) => attrs[name] ?? null,
    contains: (other: unknown): boolean => other === node || children.some((child: any) => child.contains(other)),
    querySelectorAll: (selector: string) => {
      const out: any[] = [];
      const walk = (item: any) => { for (const child of item.children) { if (selector.includes('.sh-add-slot') && child.attrs.class === 'sh-add-slot') out.push(child); if (selector === '[data-sel]' && child.attrs['data-sel']) out.push(child); walk(child); } };
      walk(node); return out;
    },
  };
  children.forEach((child: any) => { child.parentElement = node; });
  return node;
}

describe('where a pointer would drop', () => {
  const tileElements = tiles.map((key, at) => element([at * 160, 0, 150, 100], { 'data-sel': key }));
  const slot = element([0, 110, 100, 30], { class: 'sh-add-slot', 'data-add-for': grid.key });
  const host = element([0, 0, 320, 150], {}, [...tileElements, slot]);
  const root = element([0, 0, 400, 300], {}, [host]);
  const dragged = index.children(grid.key)[0];

  it('finds the container under the pointer and the slot by reading order', () => {
    const hit = locateOnCanvas(root, doc, dragged, 300, 50);
    expect(hit?.destination.owner).toBe(grid.key);
    expect(hit?.destination.index).toBeGreaterThanOrEqual(0);
    expect(hit?.cue.vertical).toBe(true);
    expect(hit?.cue.name).toBeTruthy();
  });

  it('finds nothing when the pointer is outside every container', () => {
    expect(locateOnCanvas(root, doc, dragged, 390, 290)).toBeUndefined();
  });

  it('draws the cue for a keyboard slot from the drawn container', () => {
    const end = endOf(doc, grid.key)!;
    const cue = cueFor(root, doc, end);
    expect(cue?.line.width).toBeGreaterThan(0);
  });
});
