export type TileArrangement = 'row' | 'anchored-bottom' | 'centered-stack' | 'stacked-top';

// UIKit's largest normal subheadline is 21pt; the first accessibility size is 25pt.
export const isAccessibilityText = (scale: number): boolean => scale >= 25 / 15;

export function nativeTileMetrics(arrangement: TileArrangement, scale: number, navigation: boolean) {
  const resolved = arrangement === 'row' && isAccessibilityText(scale) ? 'anchored-bottom' : arrangement;
  const content = { row: 48, 'anchored-bottom': 72, 'centered-stack': 60, 'stacked-top': 88 }[resolved];
  return {
    arrangement: resolved,
    minimumHeight: Math.max(content * scale, navigation && resolved === 'anchored-bottom' ? (24 + 8 + 40) * scale : 0) + 24,
    titleReserve: navigation && resolved === 'anchored-bottom' ? 40 * scale : undefined,
  };
}

export interface NativeGridItem { span?: number; minimumWidth?: number }
export interface NativeGridPlacement { row: number; column: number; span: number; width: number }
export interface NativeGridLayout { columns: number; trackWidth: number; shared: boolean; placements: NativeGridPlacement[] }

export function solveNativeGrid(width: number, items: NativeGridItem[], options: { minimumWidth: number; gap?: number; maximumColumns?: number; fill?: boolean }): NativeGridLayout {
  const available = Math.max(1, width), gap = options.gap ?? 12;
  const columns = Math.max(1, Math.min(options.maximumColumns ?? 4, Math.floor((available + gap) / (options.minimumWidth + gap))));
  const trackWidth = Math.max(1, (available - gap * (columns - 1)) / columns);
  const spans = items.map(item => Math.min(columns, Math.max(item.span ?? 1, Math.ceil(((item.minimumWidth ?? 0) - .01 + gap) / (trackWidth + gap)), 1)));
  const rows: number[][] = [];
  let used = 0;
  spans.forEach((span, index) => {
    if (!rows.length || used + span > columns) { rows.push([]); used = 0; }
    rows.at(-1)!.push(index); used += span;
  });
  const fill = options.fill !== false;
  if (fill && rows.length === 1 && used < columns) {
    const bases = spans.map(span => span * trackWidth + (span - 1) * gap);
    let remaining = available - gap * (bases.length - 1), pending = bases.map((_, index) => index);
    const widths = [...bases];
    while (pending.length) {
      const share = remaining / pending.length, fixed = pending.filter(index => bases[index]! > share);
      if (!fixed.length) { pending.forEach(index => { widths[index] = share; }); break; }
      fixed.forEach(index => { remaining -= bases[index]!; });
      pending = pending.filter(index => !fixed.includes(index));
    }
    return { columns, trackWidth, shared: true, placements: spans.map((span, column) => ({ row: 1, column: column + 1, span, width: widths[column]! })) };
  }
  const placements: NativeGridPlacement[] = [];
  rows.forEach((row, rowIndex) => {
    let spare = columns - row.reduce((sum, index) => sum + spans[index]!, 0);
    while (fill && spare-- > 0) {
      const narrowest = row.reduce((chosen, index) => spans[index]! <= spans[chosen]! ? index : chosen);
      spans[narrowest]! += 1;
    }
    let column = 1;
    row.forEach(index => {
      const span = spans[index]!;
      placements[index] = { row: rowIndex + 1, column, span, width: span * trackWidth + (span - 1) * gap };
      column += span;
    });
  });
  return { columns, trackWidth, shared: false, placements };
}

export function nativeSectionColumns(width: number, scale: number): number {
  return Math.max(1, Math.min(2, Math.floor((width + 24) / (Math.max(340, 340 * scale) + 24))));
}

export function placeFoldSections(entries: { side: string; height: number; order?: number }[], columns: { leading: number; trailing: number; gap: number }, gap: number, accessibility: boolean) {
  let top = 0;
  const frames = entries.map(() => ({ left: 0, top: 0, width: 0 }));
  entries.forEach((entry, index) => {
    if (entry.side !== 'rail' || accessibility) return;
    frames[index] = { left: 0, top, width: columns.leading + columns.gap + columns.trailing };
    top += entry.height + gap;
  });
  let leading = top, trailing = top;
  entries.map((entry, index) => ({ entry, index })).sort((a, b) => (a.entry.order ?? 0) - (b.entry.order ?? 0) || a.index - b.index).forEach(({ entry, index }) => {
    if (entry.side === 'rail' && !accessibility) return;
    const right = entry.side === 'trailing';
    frames[index] = { left: right ? columns.leading + columns.gap : 0, top: right ? trailing : leading, width: right ? columns.trailing : columns.leading };
    if (right) trailing += entry.height + gap; else leading += entry.height + gap;
  });
  return { frames, height: Math.max(0, leading - gap, trailing - gap) };
}

export function duoGeometry(posture: 'closed' | 'partial' | 'open', orientation: 'portrait' | 'landscape') {
  const landscape = orientation === 'landscape', cover = posture === 'closed';
  const width = cover ? landscape ? 678 : 466 : landscape ? 951 : 669;
  const height = cover ? landscape ? 466 : 678 : landscape ? 669 : 951;
  const trailingControls = cover || landscape;
  // 83pt is the browser safe-area approximation, not a measured hardware inset.
  const controlRail = trailingControls ? 83 : 0, freeWidth = width - controlRail;
  const hinge = posture === 'partial' && landscape ? { start: 455.3, end: 495.7 } : undefined;
  return {
    width, height, freeWidth, controlRail, trailingControls,
    contentWidth: freeWidth - 32,
    hinge,
    foldColumns: hinge ? { leading: hinge.start - 32, trailing: freeWidth - hinge.end - 32, gap: hinge.end - hinge.start + 32 } : undefined,
    sheetWidth: landscape ? Math.floor((hinge ? hinge.start : (freeWidth - 1) / 2) - 8) : width - 16,
    fullHeightSheet: cover || landscape,
    horizontalFoldUnverified: posture === 'partial' && !landscape,
  };
}
