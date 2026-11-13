export function createId(prefix: string): string {
  // getRandomValues is available on LAN HTTP; randomUUID requires a secure context.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
