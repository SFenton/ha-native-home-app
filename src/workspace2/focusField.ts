/** The editable control inside a field row, or the row's own button (a row that opens an editor). */
const control = (row: Element): HTMLElement | undefined =>
  row.matches('input, select, textarea, button') ? row as HTMLElement : row.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button') ?? undefined;

/** The field row for a document path, or for the nearest path above it the properties draw a row for. */
function rowFor(fieldPath: string): Element | undefined {
  const parts = fieldPath.split('/');
  for (let length = parts.length; length > 0; length--) {
    const wanted = parts.slice(0, length).join('/');
    const row = [...document.querySelectorAll('[data-field-path]')].find(item => item.getAttribute('data-field-path') === wanted && !item.closest('[data-preview-root]') && control(item));
    if (row) return row;
  }
  return undefined;
}

/**
 * Scrolls the field at a document path into view and focuses its control, once the surface that holds it has drawn (a sheet or card
 * that opens with the selection takes a few frames). It looks for about a second and gives up quietly. A closing overlay returns focus
 * to its trigger a moment after, so the focus is confirmed twice before it is left alone.
 */
export function focusField(fieldPath: string): void {
  const started = performance.now();
  const apply = (target: HTMLElement) => { if (document.activeElement !== target) target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'center', behavior: 'auto' }); };
  const look = () => {
    const found = rowFor(fieldPath);
    const target = found && control(found);
    if (target) {
      apply(target);
      for (const delay of [120, 400]) window.setTimeout(() => {
        const now = document.activeElement;
        // Someone who has already moved into another field is left there.
        if (target.isConnected && !(now && now !== target && /^(INPUT|TEXTAREA|SELECT)$/.test(now.tagName))) apply(target);
      }, delay);
      return;
    }
    if (performance.now() - started < 1000) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}
