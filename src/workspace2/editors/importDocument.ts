import { compileCompositionDocument } from '../../shared/composition/compiler';
import { CompositionValidationError, parseCompositionJSON } from '../../shared/composition/json';
import type { CompositionDocument } from '../../shared/composition/schema';
import { readStudioCanvas } from '../../shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../shared/composition/studio-logic/schemas';
import { valueAt, type EditorPath } from '../../composition-editor';
import { rebaseCanvasLayout } from '../logic-fields/layout';
import { pointerPath } from '../logic-fields/registry';

/**
 * `imported` (an exported `document` under this workspace's ID) with each saved document root that names the exported
 * document re-anchored to the new ID, as the boundary rebases a root for any edit (`rebaseCanvasLayout`): the content under
 * the new identity is lifted again and each saved node is carried, with its position and group, to the lifted node with its
 * origins. Owner-based roots are kept as saved. Throws, with the layout's issue, when a positioned node cannot be carried.
 */
function reanchoredLayout(document: CompositionDocument, imported: CompositionDocument): CompositionDocument {
  const stored = studioCanvasMetadataSchema.safeParse(document.studioCanvas);
  if (!stored.success) return imported;
  const affected = new Set(stored.data.canvases.flatMap(canvas => canvas.roots.filter(root => root.anchor.kind === 'document' && root.anchor.id === document.id).map(root => root.id)));
  if (!affected.size) return imported;
  const rejected = () => new CompositionValidationError([{ code: 'invalid_value', pointer: '/document/studioCanvas' }]);
  const locate = (pointer: string): EditorPath[] => { const at = pointerPath(pointer); return valueAt(imported, at) === undefined ? [] : [at]; };
  return rebaseCanvasLayout(document, imported, locate, { affected, deleted: () => false, refuse: () => { throw rejected(); } });
}
/**
 * Parses and checks a whole document for Import and Edit as JSON. Its links are taken as authored: they must pass the compiler
 * (which resolves every automatic binding and component parameter) and its saved canvas layout must fit its content. The
 * document takes this workspace's identity (`documentId`); a layout root that names the exported document itself is
 * re-anchored to that identity first, each node carried by its origins (`reanchoredLayout`), so a valid export from another
 * workspace keeps its layout and positions. A document whose layout cannot be carried, or still does not fit, is rejected
 * with its issues, never repaired. Applying it replaces the current document
 * (`replaceDocument` in `workspace2/editors/provenance`).
 */
export function importCompositionText(text: string, documentId: string): CompositionDocument {
  const parsed = parseCompositionJSON(new TextEncoder().encode(text));
  const { document } = compileCompositionDocument(parsed);
  const rejected = () => new CompositionValidationError([{ code: 'invalid_value', pointer: '/document/studioCanvas' }]);
  if (readStudioCanvas(document).warnings.length) throw rejected();
  // Import is explicitly content-only; publisher and document identity belong to this workspace.
  const renamed = { ...document, id: documentId };
  const imported = document.id === documentId ? renamed : reanchoredLayout(document, renamed);
  if (readStudioCanvas(imported).warnings.length) throw rejected();
  return imported;
}
