import { createHash } from 'node:crypto';
import { compileCompositionDocument, supportedCompositionCapabilities, parseCompositionShape, legacyManifest } from '../src/shared/composition/compiler';
import { assertCompositionBounds, canonicalCompositionJSON, MAX_COMPOSITION_ENVELOPE_BYTES, parseCompositionJSON, reject } from '../src/shared/composition/json';
import { assertNoLogic } from '../src/shared/composition/logic-library';
import { compositionPublicationSchema, type CompositionDocument, type CompositionPublication } from '../src/shared/composition/schema';

export function compositionAssetManifestHash(assets: CompositionDocument['assets']): string {
  return createHash('sha256').update(canonicalCompositionJSON(assets)).digest('hex');
}

/** Server publication gate; the browser's document compiler never needs secure-context crypto. */
export function validateCompositionPublication(input: unknown): CompositionPublication {
  assertCompositionBounds(input);
  // The library is the draft's; a publication holds only what it worked out into.
  if (input && typeof input === 'object' && 'document' in input) assertNoLogic(input.document);
  if (input && typeof input === 'object' && 'envelopeVersion' in input && input.envelopeVersion !== '2.0') reject('unsupported_schema', '/envelopeVersion');
  if (input && typeof input === 'object' && 'document' in input && input.document && typeof input.document === 'object'
    && 'schemaVersion' in input.document && input.document.schemaVersion !== '2.0') reject('unsupported_schema', '/document/schemaVersion');
  const publication = parseCompositionShape(compositionPublicationSchema, input);
  const compiled = compileCompositionDocument(publication.document, { tileInkDefault: true });
  const timestamp = (value: string, path: string) => {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/.test(value) || value.startsWith('0000')) reject('invalid_value', path);
    const base = value.slice(0, 19), date = new Date(`${base}Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== base) reject('invalid_value', path);
    return base + (value.includes('.') ? value.slice(20, -1) : '').padEnd(20, '0');
  };
  if (timestamp(publication.updatedAt, '/updatedAt') > timestamp(publication.publishedAt, '/publishedAt')) reject('invalid_value', '/updatedAt');
  publication.capabilities.forEach((capability, i) => {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+@[1-9][0-9]*$/.test(capability)) reject('invalid_value', `/capabilities/${i}`);
    if (!supportedCompositionCapabilities.includes(capability)) reject('unsupported_capability', `/capabilities/${i}`, capability);
  });
  // The gate (`tile-ink-gate.ts`) decides what the Studio declares, not what it accepts: a manifest with the ink id and one without it both stay valid.
  const manifest = JSON.stringify(publication.capabilities);
  if (JSON.stringify(compiled.capabilities) !== manifest && JSON.stringify(legacyManifest(compiled.capabilities)) !== manifest) reject('capability_manifest_mismatch', '/capabilities');
  if (compositionAssetManifestHash(publication.document.assets) !== publication.assetManifestSha256) reject('asset_integrity', '/assetManifestSha256');
  const encoder = new TextEncoder();
  const total = encoder.encode(canonicalCompositionJSON(publication)).byteLength;
  const documentSize = encoder.encode(canonicalCompositionJSON(publication.document)).byteLength;
  if (total > MAX_COMPOSITION_ENVELOPE_BYTES || total - documentSize > 65536) reject('limit_exceeded', '');
  return publication;
}

/** The Studio's counterpart of the app's `ServerUICompositionPublication.decode(_:)`. */
export function decodeCompositionPublication(bytes: Uint8Array): CompositionPublication {
  return validateCompositionPublication(parseCompositionJSON(bytes));
}
