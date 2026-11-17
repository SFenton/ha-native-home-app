import { describe, expect, it } from 'vitest';
import { tabBarOf } from '../src/shared/composition/layout-blocks';
import { sheetFrame } from '../src/preview2/sheet-frame';
import { docksAtBottom, sheetReachesBottom } from '../src/preview2/tab-dock';
import { previewWindows } from '../src/preview2/windows';

const win = (name: string) => previewWindows.find(item => item.name === name)!;
const form = { width: 'form' } as const;
const tabs = (props: object) => props as Parameters<typeof tabBarOf>[0];

describe('where a tab bar sits (native: pinned alone decides)', () => {
  it('heads the content when the container is not pinned, in every window', () => {
    expect(docksAtBottom(tabBarOf(tabs({ stateId: 's' })))).toBe(false);
  });
  it('docks at the bottom when pinned, and when tabBar says bottom', () => {
    expect(docksAtBottom(tabBarOf(tabs({ stateId: 's', pinned: true })))).toBe(true);
    expect(docksAtBottom(tabBarOf(tabs({ stateId: 's', pinned: true, tabBar: { placement: 'bottom', labels: 'icons' } })))).toBe(true);
  });
  it('follows an explicit top setting even with labels', () => {
    expect(docksAtBottom(tabBarOf(tabs({ stateId: 's', tabBar: { placement: 'top', labels: 'titles' } })))).toBe(false);
  });
});

describe('the bottom safe area a sheet sees', () => {
  it('is the window\'s home indicator when the sheet reaches the bottom edge: the iPhone card, the Duo flat upright and the folded Duo', () => {
    for (const name of ['iPhone', 'Duo folded', 'Duo open, upright']) expect(sheetReachesBottom(sheetFrame(win(name), form)), name).toBe(true);
  });
  it('is none for a sheet that floats clear of it: the iPad form sheet and the Duo\'s leading half', () => {
    for (const name of ['iPad upright', 'iPad sideways', 'Duo open, sideways']) expect(sheetReachesBottom(sheetFrame(win(name), form)), name).toBe(false);
  });
  it('is the window\'s for a full-screen sheet', () => {
    expect(sheetReachesBottom(sheetFrame(win('iPad upright'), { width: 'form', fullScreen: true }))).toBe(true);
  });
});
