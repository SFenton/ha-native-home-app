import type { GraphDiagnostic, StudioCanvasMetadata } from '../graph/types';
import { atPointer, record, resolveLogicAnchor } from './anchors';
import { studioCanvasMetadataSchema } from './schemas';

export type LayoutWarning = Pick<GraphDiagnostic, 'severity' | 'code' | 'message' | 'pointer'>;
export interface DraftCanvasLayout {
  readonly present: boolean;
  readonly raw?: unknown;
  readonly metadata?: StudioCanvasMetadata;
  readonly warnings: readonly LayoutWarning[];
}
const warning: LayoutWarning = { severity: 'warning', code: 'invalid_layout', message: "Saved layout can't be used.", pointer: '/studioCanvas' };

/** Raw metadata is retained even when the editor must fall back to auto layout. */
export function readStudioCanvas(document: unknown): DraftCanvasLayout {
  if (!record(document) || !Object.hasOwn(document, 'studioCanvas')) return { present: false, warnings: [] };
  const raw = document.studioCanvas, parsed = studioCanvasMetadataSchema.safeParse(raw);
  if (!parsed.success) return { present: true, raw, warnings: [warning] };
  const ids = new Set<string>(), roots = new Set<string>();
  const ambiguous = parsed.data.canvases.some(canvas => {
    if (ids.has(canvas.id)) return true;
    ids.add(canvas.id);
    const nodes = new Set<string>();
    return canvas.roots.some(anchor => {
      const resolved = resolveLogicAnchor(document, anchor);
      if (!resolved || roots.has(resolved.pointer)) return true;
      roots.add(resolved.pointer);
      return false;
    }) || canvas.nodes.some(node => {
      if (nodes.has(node.id) || node.origins.some(origin => atPointer(document, origin) === undefined)) return true;
      nodes.add(node.id);
      return false;
    });
  });
  return ambiguous ? { present: true, raw, warnings: [warning] } : { present: true, raw, metadata: parsed.data, warnings: [] };
}
