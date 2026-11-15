export type CompositionIssue = {
  code: 'unsupported_schema' | 'unknown_field' | 'unknown_variant' | 'missing_required' | 'invalid_value'
    | 'duplicate_key' | 'limit_exceeded' | 'duplicate_id' | 'invalid_reference' | 'binding_type'
    | 'invalid_combination' | 'capability_manifest_mismatch' | 'unsupported_capability' | 'asset_integrity';
  pointer: string;
  capability?: string;
};
export class CompositionValidationError extends Error {
  readonly issues: CompositionIssue[];
  constructor(issues: CompositionIssue[]) {
    super('Composition validation failed');
    this.name = 'CompositionValidationError';
    this.issues = issues.sort((a, b) => a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  }
}
export const MAX_COMPOSITION_BYTES = 2097152;
export const MAX_COMPOSITION_ENVELOPE_BYTES = MAX_COMPOSITION_BYTES + 65536;
export const pointer = (base: string, key: string | number) => `${base}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
export function reject(code: CompositionIssue['code'], at: string, capability?: string): never {
  throw new CompositionValidationError([{ code, pointer: at, ...(capability ? { capability } : {}) }]);
}
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
/**
 * Object keys are compared as the app compares them: Swift `String` equality is canonical equivalence, so two keys that
 * normalise to the same NFC form are one key. Lone surrogates have no normal form and are rejected by `unicode` first.
 */
const keyForm = (key: string) => key.normalize('NFC');
function unicode(value: string, path: string) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) reject('invalid_value', path);
    } else if (unit >= 0xdc00 && unit <= 0xdfff) reject('invalid_value', path);
  }
}

/** Reject cycles and excessive input before recursive schemas or canonicalization run. */
export function assertCompositionBounds(input: unknown): void {
  let count = 0;
  const ancestors = new Set<object>();
  function walk(value: unknown, path: string, depth: number) {
    if (++count > 100000 || depth > 40) reject('limit_exceeded', path);
    if (typeof value === 'string') { unicode(value, path); return; }
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || value === null || ancestors.has(value)) reject('invalid_value', path);
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) reject('invalid_value', path);
    const entries = Object.entries(value);
    if (entries.length > 1000 || (Array.isArray(value) && entries.length !== value.length)) reject('limit_exceeded', path);
    ancestors.add(value);
    const forms = new Set<string>();
    for (const [key, nested] of entries) {
      unicode(key, path);
      if (!Array.isArray(value)) {
        if (forms.has(keyForm(key))) reject('duplicate_key', pointer(path, key));
        forms.add(keyForm(key));
      }
      if (reserved.has(key)) reject('invalid_value', pointer(path, key));
      walk(nested, pointer(path, key), depth + 1);
    }
    ancestors.delete(value);
  }
  walk(input, '', 0);
}

/** JCS ordering/string/number serialization for validated JSON, including asset manifests. */
export function canonicalCompositionJSON(input: unknown): string {
  assertCompositionBounds(input);
  function encode(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${encode(child)}`).join(',')}}`;
  }
  return encode(input);
}

/** Bounds and duplicate decoded keys are checked before JSON.parse can erase duplicates. */
export function parseCompositionJSON(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_COMPOSITION_ENVELOPE_BYTES) reject('limit_exceeded', '');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { reject('invalid_value', ''); }
  let index = 0, count = 0;
  const whitespace = () => { while (/[ \t\r\n]/.test(text[index] ?? 'x')) index++; };
  function string(path: string): string {
    const start = index++;
    while (index < text.length) {
      const char = text[index++];
      if (char === '\\') index++;
      else if (char === '"') {
        try { return JSON.parse(text.slice(start, index)) as string; }
        catch { reject('invalid_value', path); }
      }
    }
    reject('invalid_value', path);
  }
  function scan(path: string, depth: number): void {
    whitespace();
    if (++count > 100000 || depth > 40) reject('limit_exceeded', path);
    const char = text[index];
    if (char === '"') { string(path); return; }
    if (char === '{' || char === '[') {
      index++; whitespace();
      const end = char === '{' ? '}' : ']';
      const keys = new Set<string>();
      let entries = 0;
      if (text[index] === end) { index++; return; }
      while (index < text.length) {
        let key = String(entries);
        if (++entries > 1000) reject('limit_exceeded', path);
        if (char === '{') {
          if (text[index] !== '"') reject('invalid_value', path);
          key = string(path);
          if (keys.has(keyForm(key))) reject('duplicate_key', pointer(path, key));
          keys.add(keyForm(key));
          whitespace();
          if (text[index++] !== ':') reject('invalid_value', path);
        }
        scan(pointer(path, key), depth + 1);
        whitespace();
        const separator = text[index++];
        if (separator === end) return;
        if (separator !== ',') reject('invalid_value', path);
        whitespace();
      }
      reject('invalid_value', path);
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(index));
    if (!token) reject('invalid_value', path);
    index += token[0].length;
  }
  scan('', 0); whitespace();
  if (index !== text.length) reject('invalid_value', '');
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { reject('invalid_value', ''); }
  assertCompositionBounds(parsed);
  return parsed;
}
