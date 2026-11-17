import { useIsSelected } from '../selection-store';
import { useRender } from '../render-context';
import type { SelectionKey } from '../model';

/**
 * What a `component-ref` draws when the saved component it names is gone (a document the compiler refuses): a tile that says so, selectable so the
 * person can delete it. Never a look-alike of the body.
 */
export function MissingComponent({ id, span }: { id: string; span: number }) {
  const ctx = useRender();
  const key: SelectionKey = `node:${id}`;
  const selected = useIsSelected(ctx.store, key) && ctx.mode === 'edit';
  return <div className="sh-node" data-sel={key} data-type="component-ref" style={{ gridColumn: `span ${span}` }} data-selected={selected ? '' : undefined}>
    <div className="sh-placeholder" role="group" aria-label="Missing component">
      <strong className="sh-placeholder-title">Missing component</strong>
      <span className="sh-tag">Not Previewed</span>
    </div>
  </div>;
}
