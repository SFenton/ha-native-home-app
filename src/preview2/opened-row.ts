import type { CompositionDocument } from '../shared/composition/schema';

/**
 * The ids of the nodes of a page whose action pushes `openedId`: the rows that open the trailing column, which stay selected while it is open
 * ("Persistently highlight the current selection in each pane leading to a detail view", HIG, Split views). A node is any object with a `type` and an `id`;
 * an action is attributed to the nearest node around it.
 */
export function openedNodes(page: CompositionDocument['pages'][number], openedId: string): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, node: string | undefined): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, node)); return; }
    const record = value as Record<string, unknown>;
    if ((record.type === 'push' || record.type === 'dismiss-then-push') && node) {
      const target = record.type === 'push' ? record.pageId : (record.destination as { pageId?: unknown } | undefined)?.pageId;
      if (target === openedId) found.add(node);
    }
    const own = typeof record.id === 'string' && typeof record.type === 'string' && 'props' in record ? record.id : node;
    Object.values(record).forEach(item => visit(item, own));
  };
  visit(page.components, undefined);
  return [...found];
}
