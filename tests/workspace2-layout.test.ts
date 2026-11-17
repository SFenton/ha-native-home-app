import { describe, expect, it } from 'vitest';
import { checksPillShown, defaultOpen, exclusive, inspectorWidth, layoutTier, railUnder, resolveLayout } from '../src/workspace2/layout';

/** The tier, widths, exclusivity and canvas width the L-wide spec fixes (studio-ux2, spec2.md). */
describe('layoutTier', () => {
  it('is phone under 600 wide, or 500 tall or less, and flyout from 600 to 870, docked from 871', () => {
    expect(layoutTier(599, 900)).toBe('phone');
    expect(layoutTier(600, 900)).toBe('flyout');
    expect(layoutTier(870, 900)).toBe('flyout');
    expect(layoutTier(871, 900)).toBe('docked');
    expect(layoutTier(1440, 500)).toBe('phone');
    expect(layoutTier(1440, 501)).toBe('docked');
  });
});

describe('widths and exclusivity at the boundaries', () => {
  it('sizes the inspector by tier and width', () => {
    expect(inspectorWidth('phone', 390)).toBe(0);
    expect(inspectorWidth('flyout', 600)).toBe(288);
    expect(inspectorWidth('flyout', 743)).toBe(288);
    expect(inspectorWidth('flyout', 744)).toBe(320);
    expect(inspectorWidth('flyout', 870)).toBe(320);
    expect(inspectorWidth('docked', 871)).toBe(320);
    expect(inspectorWidth('docked', 1279)).toBe(320);
    expect(inspectorWidth('docked', 1280)).toBe(344);
  });
  it('keeps the panel and the inspector exclusive under 1100 and in the flyout', () => {
    for (const width of [600, 870, 871, 1099]) expect(exclusive(layoutTier(width, 900), width), `${width}`).toBe(true);
    for (const width of [1100, 1199, 1200, 1279, 1280]) expect(exclusive(layoutTier(width, 900), width), `${width}`).toBe(false);
  });
  it('opens the docked library by default from 1200 only', () => {
    expect(defaultOpen('docked', 1199)).toBe(false);
    expect(defaultOpen('docked', 1200)).toBe(true);
    expect(defaultOpen('flyout', 870)).toBe(false);
    expect(defaultOpen('flyout', 1200)).toBe(false);
  });
  it('turns the simulator rail under the device below 420 px of canvas and hides the Checks pill below 560', () => {
    expect(railUnder(419)).toBe(true); expect(railUnder(420)).toBe(false);
    expect(checksPillShown(559)).toBe(false); expect(checksPillShown(560)).toBe(true);
  });
});

/** Every row of the spec's canvas-width table: idle, panel open, inspector open, both. */
describe('canvas width', () => {
  const table: [number, number, number, number, number, number | 'exclusive'][] = [
    [1440, 900, 1104, 1104, 760, 760],
    [1180, 820, 1116, 844, 796, 524],
    [951, 669, 887, 615, 567, 'exclusive'],
    [820, 1180, 756, 520, 436, 'exclusive'],
    [669, 951, 605, 369, 317, 'exclusive'],
  ];
  for (const [width, height, idle, panel, inspector, both] of table) {
    it(`${width} x ${height}`, () => {
      // 1440 opens its panel by default, so its "idle" is the panel open; the table's idle column is the rail alone only below 1200.
      const rail = (panelOn: boolean, selected: boolean) => resolveLayout(width, height, panelOn, selected).canvas;
      if (width >= 1200) expect(rail(true, false)).toBe(idle); else expect(rail(false, false)).toBe(idle);
      expect(rail(true, false)).toBe(panel);
      expect(rail(width >= 1200, true)).toBe(inspector); // at 1440 the panel is open by default, so the inspector joins it
      if (both === 'exclusive') {
        const layout = resolveLayout(width, height, true, true);
        expect(layout.inspector).toBe(false);
        expect(layout.panel).toBe(true);
      } else expect(rail(true, true)).toBe(both);
    });
  }
  it('never drops under 248 px, at 600 wide with the inspector', () => {
    expect(resolveLayout(600, 900, false, true).canvas).toBe(248);
  });
  it('a flyout covers the rail: the canvas starts at 300, and a docked panel starts after the rail', () => {
    expect(resolveLayout(820, 1180, true, false).left).toBe(300);
    expect(resolveLayout(1440, 900, true, false).left).toBe(64 + 272);
    expect(resolveLayout(1440, 900, false, false).left).toBe(64);
  });
  it('a phone has no rail, panel or inspector column', () => {
    expect(resolveLayout(390, 844, true, true)).toEqual({ tier: 'phone', panel: false, inspector: false, inspectorWidth: 0, left: 0, canvas: 390 });
  });
});
