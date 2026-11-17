/**
 * Whether two JSON values are the same value, key order aside (the same answer as comparing their canonical text, without
 * writing either out). A branch both sides share is the same object, so an edit that rebuilt only its own path is settled by
 * walking that path, not the whole document.
 */
export function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const array = Array.isArray(left);
  if (array !== Array.isArray(right)) return false;
  if (array) {
    const other = right as unknown[];
    return (left as unknown[]).length === other.length && (left as unknown[]).every((item, at) => sameJson(item, other[at]));
  }
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameJson(a[key], b[key]));
}
