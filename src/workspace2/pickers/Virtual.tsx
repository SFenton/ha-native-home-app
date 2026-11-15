import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * A scrolling list that draws only the rows in view (and a few either side), so 5,000 entities scroll at the same cost as 50.
 * `height` is the viewport's height; rows are a fixed `rowHeight`. A row element carries `data-index`.
 */
export function VirtualList<T>({ items, rowHeight, height, render, label, empty, onActivate }: {
  items: readonly T[]; rowHeight: number; height?: number | string; render: (item: T, index: number) => ReactNode; label: string; empty?: ReactNode; onActivate?: (item: T) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: items.length, getScrollElement: () => scroller.current, estimateSize: () => rowHeight, overscan: 8, initialRect: { width: 360, height: typeof height === 'number' ? height : 480 } });
  if (items.length === 0 && empty) return <div className="w2-vlist w2-vlist-empty">{empty}</div>;
  return <div ref={scroller} className="w2-vlist" role="listbox" aria-label={label} tabIndex={0} style={{ height }} data-total={items.length}
    onKeyDown={event => {
      if (event.key === 'Enter' && onActivate) { const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-index]'); const at = focused ? Number(focused.dataset.index) : -1; if (items[at]) onActivate(items[at]); }
    }}>
    <div style={{ height: virtual.getTotalSize(), position: 'relative', width: '100%' }}>
      {virtual.getVirtualItems().map(row => <div key={row.key} data-index={row.index} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: row.size, transform: `translateY(${row.start}px)` }}>
        {render(items[row.index], row.index)}
      </div>)}
    </div>
  </div>;
}
