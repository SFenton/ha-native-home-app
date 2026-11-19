import { createHash } from 'node:crypto';
import { compileCompositionDocumentWithOrigins } from '../../src/shared/composition/compiler';
import { canonicalCompositionJSON } from '../../src/shared/composition/json';

/** Read-only preparation for canvas preview/validation; never saves or publishes. */
export function prepareDraft(document: unknown) {
  const { compiled, origins, sourceMap, useBindings, layout } = compileCompositionDocumentWithOrigins(document);
  return {
    valid: true as const,
    document: compiled.document,
    expanded: compiled.expanded,
    capabilities: compiled.capabilities,
    origins, sourceMap, useBindings, layout,
    publicationDocumentSha256: createHash('sha256').update(canonicalCompositionJSON(compiled.expanded)).digest('hex'),
  };
}
