import { fieldPointer, pointerPath } from '../logic-fields/registry';

interface Branch {
  readonly children: Map<string, Branch>;
  /** Keys that read only this value's presence and kind, then its children separately (a change here or above reaches them). */
  readonly exact: Set<string>;
  /** Keys that depend on everything at or below this value. */
  readonly subtree: Set<string>;
  /** Every key registered at or below this value. */
  readonly descendants: Set<string>;
}
const branch = (): Branch => ({ children: new Map(), exact: new Set(), subtree: new Set(), descendants: new Set() });

/**
 * A per-revision map from document pointers to the reconciliation work that reads them. A changed pointer reaches every key
 * registered at or below it, and every subtree key registered above it. Group keys stand for shared reads (one owner's ID
 * scan, say) and expand to their members, so a page scan is recorded once rather than once per binding on that page.
 */
export class EditDependencies {
  private readonly root = branch();
  private readonly members = new Map<string, Set<string>>();

  add(pointer: string, keys: string | readonly string[], exact = false): void {
    const list = typeof keys === 'string' ? [keys] : keys;
    let node = this.root;
    for (const key of list) node.descendants.add(key);
    for (const part of pointerPath(pointer)) {
      let child = node.children.get(String(part));
      if (!child) { child = branch(); node.children.set(String(part), child); }
      node = child;
      for (const key of list) node.descendants.add(key);
    }
    for (const key of list) (exact ? node.exact : node.subtree).add(key);
  }

  /** `key` is in scope whenever `group` is. */
  join(group: string, key: string): void {
    let members = this.members.get(group);
    if (!members) { members = new Set(); this.members.set(group, members); }
    members.add(key);
  }

  intersect(pointer: string, into: Set<string>): void {
    let node: Branch | undefined = this.root;
    for (const part of pointerPath(pointer)) {
      for (const key of node.subtree) into.add(key);
      node = node.children.get(String(part));
      if (!node) return;
    }
    for (const key of node.descendants) into.add(key);
  }

  /** Add the members of every group in `scope` (groups do not nest). */
  expand(scope: Set<string>): void {
    for (const key of [...scope]) for (const member of this.members.get(key) ?? []) scope.add(member);
  }

  /**
   * Record every property the canonical resolver reads (including absent fields and ID/uniqueness scans) against `keys`.
   * Reads go through a proxy over the real document, so the dependency set is the resolver's own, not a restatement of it.
   */
  observe<T extends object>(document: T, keys: readonly string[], read: (document: T) => unknown): void {
    const proxies = new Map<string, object>();
    const wrap = (value: object, path: readonly (string | number)[]): object => {
      const pointer = fieldPointer([...path]), existing = proxies.get(pointer);
      if (existing) return existing;
      const proxy = new Proxy(Array.isArray(value) ? [...value] : { ...value }, {
        get: (_target, key) => {
          const child = Reflect.get(value, key);
          if (typeof key !== 'string' || typeof child === 'function') return child;
          const at = [...path, key], object = child !== null && typeof child === 'object';
          this.add(fieldPointer(at), keys, object);
          return object ? wrap(child, at) : child;
        },
        has: (target, key) => {
          if (typeof key === 'string') this.add(fieldPointer([...path, key]), keys, true);
          return Reflect.has(target, key);
        },
        getOwnPropertyDescriptor: (target, key) => {
          if (typeof key === 'string') this.add(fieldPointer([...path, key]), keys, true);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        ownKeys: target => { this.add(pointer, keys); return Reflect.ownKeys(target); },
      });
      proxies.set(pointer, proxy);
      return proxy;
    };
    read(wrap(document, []) as T);
  }
}

/**
 * Visit every pointer where `after` differs from `before` by identity. Unchanged immutable branches are proofs, not a
 * classification of "simple" fields: anything rebuilt is visited, even when it looks equal.
 */
export function changedPaths(before: unknown, after: unknown, visit: (pointer: string) => void, path: (string | number)[] = []): void {
  if (before === after) return;
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object'
    || Array.isArray(before) !== Array.isArray(after) || Array.isArray(before) && Array.isArray(after) && before.length !== after.length) {
    visit(fieldPointer(path)); return;
  }
  let retained = true;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (Object.hasOwn(before, key) !== Object.hasOwn(after, key)) { retained = false; visit(fieldPointer([...path, key])); }
    else if (Reflect.get(before, key) !== Reflect.get(after, key)) {
      retained = false;
      changedPaths(Reflect.get(before, key), Reflect.get(after, key), visit, [...path, key]);
    }
  }
  // Equal-looking rebuilt containers still need provenance; equality cannot certify their identity.
  if (retained) visit(fieldPointer(path));
}
