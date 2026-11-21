import type { GraphDiagnostic, GraphNode, LogicAnchor, StudioCanvasMetadata } from '../graph/types';
import { canonicalOfBounded, CompositionValidationError } from '../json';
import { atPointer, record, resolveLogicAnchor, type ResolvedLogicAnchor } from './anchors';
import { canvasAnnotationSchema, studioCanvasMetadataSchema, type StoredStudioCanvasMetadata } from './schemas';

export type LayoutWarning = Pick<GraphDiagnostic, 'severity' | 'code' | 'message' | 'pointer'>;
export interface DraftCanvasLayout {
  readonly present: boolean;
  readonly raw?: unknown;
  readonly metadata?: StudioCanvasMetadata;
  readonly warnings: readonly LayoutWarning[];
}
type GraphCanvas = StudioCanvasMetadata['canvases'][number];
export interface CanvasLayoutInput extends Pick<GraphCanvas, 'id' | 'viewport' | 'groups'> {
  readonly roots: readonly { readonly anchor: LogicAnchor; readonly nodes: readonly (GraphCanvas['nodes'][number] & NonNullable<GraphNode['annotation']>)[] }[];
}
const warning: LayoutWarning = { severity: 'warning', code: 'invalid_layout', message: "Saved layout can't be used.", pointer: '/studioCanvas' };

export function normalizeAnnotation(input: GraphNode['annotation']): GraphNode['annotation'] {
  const invalid = () => new CompositionValidationError([{ code: 'invalid_value', pointer: '/studioCanvas' }]);
  if (input === undefined) return undefined;
  for (const value of [input.label, input.note]) {
    if (value !== undefined && (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value))) throw invalid();
  }
  const label = input.label?.trim(), note = input.note?.trim();
  const parsed = canvasAnnotationSchema.safeParse({ ...(label ? { label } : {}), ...(note ? { note } : {}) });
  if (!parsed.success) throw invalid();
  return parsed.data.label || parsed.data.note ? parsed.data : undefined;
}

function layoutRoot(document: Record<string, unknown>, anchor: LogicAnchor): ResolvedLogicAnchor | undefined {
  if (anchor.kind !== 'document' || anchor.field !== '') return resolveLogicAnchor(document, anchor);
  const { studioCanvas: _layout, ...semantic } = document;
  return (anchor.id === document.id || anchor.id === 'document') && canonicalOfBounded(semantic) === anchor.fingerprint
    ? { value: document, pointer: '', owner: { value: document, pointer: '' } } : undefined;
}
const rootId = (anchor: LogicAnchor, ownerId: string) =>
  canonicalOfBounded([anchor.kind, anchor.id, 'nodeId' in anchor ? anchor.nodeId ?? null : null, anchor.field, ownerId]);
const canvasNodeId = (root: string, node: string) => canonicalOfBounded([root, node]);

/** Stored frames are explicit; the graph core still consumes its root-local, in-memory v1 metadata. */
function graphMetadata(document: Record<string, unknown>, stored: StoredStudioCanvasMetadata): StudioCanvasMetadata | undefined {
  const canvasIds = new Set<string>(), rootIds = new Set<string>();
  const canvases: GraphCanvas[] = [];
  for (const canvas of stored.canvases) {
    if (canvasIds.has(canvas.id)) return undefined;
    canvasIds.add(canvas.id);
    const roots = new Map<string, { anchor: LogicAnchor; value: unknown }>();
    for (const root of canvas.roots) {
      const resolved = layoutRoot(document, root.anchor);
      if (!resolved || resolved.owner.value.id !== root.ownerId || root.id !== rootId(root.anchor, root.ownerId) || rootIds.has(root.id)) return undefined;
      rootIds.add(root.id);
      roots.set(root.id, { anchor: root.anchor, value: resolved.value });
    }
    const nodes = new Map<string, typeof canvas.nodes[number]>();
    for (const node of canvas.nodes) {
      const root = roots.get(node.rootId);
      if (!root || nodes.has(node.id) || node.id !== canvasNodeId(node.rootId, node.nodeId)
        || node.origins.some(origin => atPointer(root.value, origin) === undefined)) return undefined;
      nodes.set(node.id, node);
    }
    const groupIds = new Set<string>();
    for (const group of canvas.groups ?? []) {
      if (groupIds.has(group.id) || group.nodeIds.some(id => !nodes.has(id))) return undefined;
      groupIds.add(group.id);
    }
    for (const [id, root] of roots) {
      const own = canvas.nodes.filter(node => node.rootId === id);
      canvases.push({
        id: canonicalOfBounded([canvas.id, id]), roots: [root.anchor],
        nodes: own.map(node => ({ id: node.nodeId, origins: node.origins, x: node.x, y: node.y,
          ...(node.label ? { label: node.label } : {}), ...(node.note ? { note: node.note } : {}),
        })),
        ...(canvas.viewport ? { viewport: canvas.viewport } : {}),
        ...(canvas.groups ? { groups: canvas.groups.flatMap(group => {
          const nodeIds = group.nodeIds.flatMap(nodeId => {
            const node = nodes.get(nodeId);
            return node?.rootId === id ? [node.nodeId] : [];
          });
          return nodeIds.length ? [{ ...group, nodeIds }] : [];
        }) } : {}),
      });
    }
  }
  return { version: 1, canvases, ...(stored.bundles ? { bundles: stored.bundles } : {}) };
}

/** Inputs contain anchor-relative origins. Groups refer to the encoded canvas-wide node IDs. */
export function encodeStudioCanvas(
  document: unknown, canvases: readonly CanvasLayoutInput[], bundles?: StudioCanvasMetadata['bundles'],
): StoredStudioCanvasMetadata {
  const invalid = () => new CompositionValidationError([{ code: 'invalid_value', pointer: '/studioCanvas' }]);
  if (!record(document)) throw invalid();
  const encoded = {
    version: 2,
    canvases: canvases.map(canvas => {
      const roots = canvas.roots.map(({ anchor }) => {
        const resolved = layoutRoot(document, anchor), ownerId = resolved?.owner.value.id;
        if (typeof ownerId !== 'string') throw invalid();
        return { id: rootId(anchor, ownerId), anchor, ownerId, originFrame: 'anchor-relative' };
      });
      return {
        id: canvas.id, roots,
        nodes: canvas.roots.flatMap((root, index) => root.nodes.map(node => ({
          ...node, id: canvasNodeId(roots[index].id, node.id), rootId: roots[index].id, nodeId: node.id,
        }))),
        ...(canvas.viewport ? { viewport: canvas.viewport } : {}),
        ...(canvas.groups ? { groups: canvas.groups } : {}),
      };
    }),
    ...(bundles ? { bundles } : {}),
  };
  const parsed = studioCanvasMetadataSchema.safeParse(encoded);
  if (!parsed.success || !graphMetadata(document, parsed.data)) throw invalid();
  return parsed.data;
}

/** Noncanonical metadata never acquires an inferred frame. Raw data is retained for explicit reset/export. */
export function readStudioCanvas(document: unknown): DraftCanvasLayout {
  if (!record(document) || !Object.hasOwn(document, 'studioCanvas')) return { present: false, warnings: [] };
  const raw = document.studioCanvas, parsed = studioCanvasMetadataSchema.safeParse(raw);
  const metadata = parsed.success ? graphMetadata(document, parsed.data) : undefined;
  return metadata ? { present: true, raw, metadata, warnings: [] } : { present: true, raw, warnings: [warning] };
}
