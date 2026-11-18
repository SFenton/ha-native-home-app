import { describe, expect, it } from 'vitest';
import { cameraCutout, type Turn } from '../src/preview2/duo-pose';
import { HELD, RAIL } from '../src/preview2/rail-constants';
import { moreMenuBox, railLayout, statusStack, type RailEntry, type RailInput } from '../src/preview2/rail-layout';
import { duoWindow, railCentre, railSideOf } from '../src/preview2/windows';

/** The Duo's rail against the numbers measured from the owner's native screenshots (`build/research/studio-sim-rails.md` 3.3, verdict A1 to A11). */
const entry = (key: string, priority: RailEntry['priority'] = 'normal'): RailEntry => ({ key, priority });
const shell = { id: 'shell', shared: true, items: [entry('links'), entry('profile')] };

/** The layout of the closed Duo at a turn with `tabs` tabs. */
function at(turn: Turn, tabs: number, groups: RailInput['groups'] = [shell]) {
  const win = duoWindow({ turn, fold: 'closed' });
  return railLayout({ width: win.width, length: win.height, side: railSideOf(win), tabs, groups, camera: { end: win.camera!.corner.vertical, reach: win.camera!.reach } });
}
const near = (value: number | undefined, expected: number, tolerance = 2) => expect(Math.abs((value ?? Infinity) - expected), `${value} against ${expected}`).toBeLessThanOrEqual(tolerance);

describe('the rail layout at the three native poses', () => {
  it('folded portrait (turn 0, camera top-right): the header pill under the keep-clear region and the tab pill 22 pt above the bottom (native probe), no More', () => {
    const rail = at(0, 5);
    expect(rail.compressed).toBe(false);
    near(rail.centre, 418);
    near(rail.header!.top, 175); near(rail.header!.bottom, 273);
    near(rail.tabs.top, 395); near(rail.tabs.bottom, 656); near(rail.tabs.height, 260.7);
    expect(rail.more).toBeUndefined();
  });

  it('camera top-left (turn 270, 5 tabs): everything folds into More, 12 pt above the tab pill, the pair 24 pt from the bottom', () => {
    const rail = at(270, 5);
    expect(rail.compressed).toBe(true);
    expect(rail.header).toBeUndefined();
    near(rail.centre, 48);
    near(rail.more!.top, 120.3); near(rail.tabs.top, 179.7); near(rail.tabs.bottom, 441.7);
    expect(rail.folded).toEqual(['profile', 'links']);
  });

  it('camera bottom-right (turn 90, 5 tabs): More over the tab pill, the pair ending at the keep-clear edge, the order not flipped', () => {
    const rail = at(90, 5);
    expect(rail.compressed).toBe(true);
    near(rail.centre, 630);
    near(rail.more!.top, 62); near(rail.tabs.top, 122); near(rail.tabs.bottom, 384.1, 2.5); // the verdict accepts 384 observed against 382 by the rule
    expect(rail.more!.top).toBeLessThan(rail.tabs.top);
  });
});

describe('the compression rule at 3, 4 and 5 tabs (interim: R1 has not observed 3 and 4)', () => {
  it('compresses at 5 tabs and not at 3 or 4 on a quarter turn', () => {
    expect([3, 4, 5].map(tabs => at(270, tabs).compressed)).toEqual([false, false, true]);
    expect([3, 4, 5].map(tabs => at(90, tabs).compressed)).toEqual([false, false, true]);
  });
  it('never compresses in portrait at turn 0 with 5 tabs, and the uncompressed camera-bottom poses anchor to the keep-clear region (A3)', () => {
    expect([3, 4, 5].map(tabs => at(0, tabs).compressed)).toEqual([false, false, false]);
    const t180 = at(180, 5);
    expect(t180.header!.top).toBe(24);
    expect(t180.tabs.bottom).toBe(678 - 170 - 5);
    expect(t180.centre).toBe(48);
  });
  it('folds one item at a time, lowest priority first, then the bottom item among equals; a required item stays', () => {
    const groups = [shell, { id: 'extra', shared: false, items: [entry('a', 'low'), entry('b', 'normal'), entry('c', 'required')] }];
    const rail = at(270, 4, groups);
    expect(rail.folded.slice(0, 2)).toEqual(['a', 'b']);
    expect(rail.folded).not.toContain('c');
  });
  it('keeps the tabs when nothing is left to fold', () => {
    const rail = at(270, 8, [{ id: 'g', shared: true, items: [entry('c', 'required')] }]);
    expect(rail.folded).toEqual([]);
    expect(rail.header).toBeDefined();
  });
});

describe('the held pill', () => {
  it('is 76 wide, 311 tall at 5 tabs (pitch 60, native), with its bottom at L - 14 (664 of 678), 8 pt below the resting bottom', () => {
    const rail = at(0, 5);
    expect([rail.held.width, rail.held.height]).toEqual([HELD.pill, 311]);
    near(rail.held.bottom, 664, 0.01); near(rail.held.top, 353, 0.01);
  });
  it('never moves into the keep-clear region when the camera is at the bottom', () => {
    const rail = at(90, 5);
    expect(rail.held.bottom).toBe(466 - 84);
  });
});

describe('the More menu box', () => {
  it('is 250 wide and 19 + 42 per row, on the More circle top corner on the rail side, growing inward', () => {
    const leading = at(270, 5), trailing = at(90, 5);
    const l = moreMenuBox(leading, 'leading', 2)!, t = moreMenuBox(trailing, 'trailing', 2)!;
    expect([l.width, l.height, t.height]).toEqual([250, 103, 103]);
    near(l.left, 23.75, 0.01); expect(l.top).toBe(leading.more!.top);
    near(t.left + t.width, 630 + RAIL.circle / 2, 0.01);
    expect(moreMenuBox(at(0, 5), 'trailing', 2)).toBeUndefined();
  });
});

describe('the status stack and the camera keep-clear', () => {
  it('draws time and mark only at the portrait turns, at the A1 and A3 centres', () => {
    expect(statusStack(0, 678)).toEqual({ time: 92.5, wifi: 130 });
    expect(statusStack(180, 678)).toEqual({ time: 552, wifi: 590 });
    expect(statusStack(90, 466)).toBeUndefined();
    expect(statusStack(270, 466)).toBeUndefined();
  });
  it('keeps clear 170 pt along the rail at turns 0 and 180 and 84 at 90 and 270, with the rail on the camera centre line', () => {
    expect(([0, 90, 180, 270] as const).map(turn => cameraCutout(turn).reach)).toEqual([170, 84, 170, 84]);
    for (const turn of [0, 90, 180, 270] as const) near(railCentre(duoWindow({ turn, fold: 'closed' })), cameraCutout(turn).x, 0.5);
  });
});
