import type { GraphDiagnostic, LogicAnchor, StudioCanvasMetadata } from '../graph/types';
import { canonicalOfBounded } from '../json';
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

function layoutRoot(document: Record<string, unknown>, anchor: LogicAnchor) {
  if (anchor.kind !== 'document' || anchor.field !== '') return resolveLogicAnchor(document, anchor);
  const { studioCanvas: _layout, ...semantic } = document;
  // Whole-document lift excludes layout from its fingerprint and defaults its anchor ID to "document".
  return (anchor.id === document.id || anchor.id === 'document') && canonicalOfBounded(semantic) === anchor.fingerprint
    ? { value: document, pointer: '' } : undefined;
}

function relativeOrigins(root: { value: unknown; pointer: string }, origins: readonly string[]): string[][] {
  const relative = origins.map(origin => {
    const local = atPointer(root.value, origin) === undefined ? undefined : origin;
    const absolute = origin === root.pointer || origin.startsWith(`${root.pointer}/`) ? origin.slice(root.pointer.length) : undefined;
    const anchored = absolute !== undefined && atPointer(root.value, absolute) !== undefined ? absolute : undefined;
    if (local !== undefined && anchored !== undefined && local !== anchored) return undefined;
    return anchored ?? local;
  });
  return relative.every((origin): origin is string => origin !== undefined) ? [relative] : [];
}

/** Raw metadata is retained even when the editor must fall back to auto layout. */
export function readStudioCanvas(document: unknown): DraftCanvasLayout {
  if (!record(document) || !Object.hasOwn(document, 'studioCanvas')) return { present: false, warnings: [] };
  const raw = document.studioCanvas, parsed = studioCanvasMetadataSchema.safeParse(raw);
  if (!parsed.success) return { present: true, raw, warnings: [warning] };
  const ids = new Set<string>(), roots = new Set<string>();
  let ambiguous = false;
  const canvases = parsed.data.canvases.map(canvas => {
    const nodes = new Set<string>();
    const resolved = canvas.roots.flatMap(anchor => {
      const root = layoutRoot(document, anchor);
      if (!root || roots.has(root.pointer)) { ambiguous = true; return []; }
      roots.add(root.pointer);
      return [root];
    });
    const normalized = canvas.nodes.map(node => {
      const origins = resolved.flatMap(root => relativeOrigins(root, node.origins));
      if (nodes.has(node.id) || !node.origins.length || origins.length !== 1) ambiguous = true;
      nodes.add(node.id);
      return { ...node, origins: origins[0] ?? node.origins };
    });
    if (ids.has(canvas.id)) ambiguous = true;
    ids.add(canvas.id);
    return { ...canvas, nodes: normalized };
  });
  return ambiguous ? { present: true, raw, warnings: [warning] } : { present: true, raw, metadata: { ...parsed.data, canvases }, warnings: [] };
}
