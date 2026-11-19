import type { GraphDiagnostic, LogicAnchor, StudioCanvasMetadata } from '../graph/types';
import { canonicalOfBounded } from '../json';
import { atPointer, record, resolveLogicAnchor, type ResolvedLogicAnchor } from './anchors';
import { studioCanvasMetadataSchema } from './schemas';

export type LayoutWarning = Pick<GraphDiagnostic, 'severity' | 'code' | 'message' | 'pointer'>;
export interface DraftCanvasLayout {
  readonly present: boolean;
  readonly raw?: unknown;
  readonly metadata?: StudioCanvasMetadata;
  readonly warnings: readonly LayoutWarning[];
}
const warning: LayoutWarning = { severity: 'warning', code: 'invalid_layout', message: "Saved layout can't be used.", pointer: '/studioCanvas' };

function layoutRoot(document: Record<string, unknown>, anchor: LogicAnchor): ResolvedLogicAnchor | undefined {
  if (anchor.kind !== 'document' || anchor.field !== '') return resolveLogicAnchor(document, anchor);
  const { studioCanvas: _layout, ...semantic } = document;
  // Whole-document lift excludes layout from its fingerprint and defaults its anchor ID to "document".
  return (anchor.id === document.id || anchor.id === 'document') && canonicalOfBounded(semantic) === anchor.fingerprint
    ? { value: document, pointer: '', owner: { value: document, pointer: '' } } : undefined;
}

function originPrefixes(root: ResolvedLogicAnchor, origin: string): string[] {
  if (!root.owner.pointer) return [root.pointer];
  const path = origin.split('/').slice(1), collection = root.owner.pointer.split('/')[1];
  const index = (part: string | undefined) => part !== undefined && /^(?:0|[1-9]\d*)$/.test(part);
  if (path[0] !== collection || !index(path[1])) return [];
  const ends: number[] = [];
  if (!root.node) ends.push(2);
  else {
    let end = 2;
    if (collection === 'componentLibrary') {
      if (path[end++] !== 'node') return [];
    } else if (path[end++] !== 'components' || !index(path[end++])) return [];
    ends.push(end);
    while (true) {
      if (path[end] === 'children' && index(path[end + 1])) end += 2;
      else if ((path[end] === 'tabs' || path[end] === 'blocks') && index(path[end + 1]) && path[end + 2] === 'children' && index(path[end + 3])) end += 4;
      else break;
      ends.push(end);
    }
  }
  // The anchor resolved the stable owner/node above; these are only its historical array addresses.
  const field = root.pointer.slice((root.node ?? root.owner).pointer.length);
  return ends.map(end => `/${path.slice(0, end).join('/')}${field}`);
}

function relativeOrigins(root: ResolvedLogicAnchor, origins: readonly string[]): string[][] {
  const relative = origins.map(origin => {
    const matches = new Set<string>();
    if (atPointer(root.value, origin) !== undefined) matches.add(origin);
    for (const prefix of originPrefixes(root, origin)) {
      const local = origin === prefix || origin.startsWith(`${prefix}/`) ? origin.slice(prefix.length) : undefined;
      if (local !== undefined && atPointer(root.value, local) !== undefined) matches.add(local);
    }
    return matches.size === 1 ? [...matches][0] : undefined;
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
