import { fieldPointer, pointerPath } from '../logic-fields/registry';

interface Branch {
  children?: Map<string, Branch>;
  /** Keys that read only this value's presence and kind, then its children separately (a change here or above reaches them). */
  exact?: Set<string>;
  /** Keys that depend on everything at or below this value. */
  subtree?: Set<string>;
  /** Read tries registered here, each for its keys (see {@link EditDependencies.mount}). */
  mounts?: { readonly trie: ReadTrie; readonly keys: readonly string[] }[];
}
const into = (set: Set<string> | undefined, keys: readonly string[]): Set<string> => {
  const target = set ?? new Set<string>();
  for (const key of keys) target.add(key);
  return target;
};

/**
 * Reads relative to some value, as a trie that names no keys: a node exists where a read is at or below it, and `subtree`
 * marks a read of everything at and below that node (the rest read only presence and kind). Built once per committed
 * object it describes and shared, never changed after it is built: a revision mounts it wherever that object sits.
 */
export interface ReadTrie { readonly children: ReadonlyMap<string, ReadTrie>; readonly subtree: boolean }
interface OpenTrie { readonly children: Map<string, ReadTrie>; subtree: boolean }
const emptyTrie = (trie: ReadTrie) => !trie.subtree && !trie.children.size;
/** Copy `trie` into a fresh one, so reads can be added (only where a shared trie meets other reads at its root). */
const opened = (trie: ReadTrie): OpenTrie => ({ children: new Map(trie.children), subtree: trie.subtree });
/** The trie of `found` (relative pointers), with each of `shared` (relative paths, each holding nothing else) placed as is. */
export function readTrie(found: Reads, shared: readonly (readonly [path: readonly string[], trie: ReadTrie])[] = []): ReadTrie {
  const root: OpenTrie = { children: new Map(), subtree: false };
  const at = (path: readonly string[]): OpenTrie => {
    let node = root;
    for (const part of path) {
      let child = node.children.get(part) as OpenTrie | undefined;
      if (!child) { child = { children: new Map(), subtree: false }; node.children.set(part, child); }
      node = child;
    }
    return node;
  };
  for (const [pointer, exact] of found) if (!exact) at(pointerPath(pointer) as string[]).subtree = true;
  else at(pointerPath(pointer) as string[]);
  for (const [path, trie] of shared) {
    if (!path.length) throw new Error('A shared read trie needs a place below the root.');
    if (emptyTrie(trie)) continue;
    const parent = at(path.slice(0, -1)), last = path.at(-1)!, existing = parent.children.get(last);
    if (!existing || emptyTrie(existing)) { parent.children.set(last, trie); continue; }
    // Reads both here and in the shared trie: merge them into fresh nodes, leaving the shared one as it was.
    const merge = (left: ReadTrie, right: ReadTrie): ReadTrie => {
      const node = opened(left);
      node.subtree ||= right.subtree;
      for (const [key, child] of right.children) {
        const own = node.children.get(key);
        node.children.set(key, own ? merge(own, child) : child);
      }
      return node;
    };
    parent.children.set(last, merge(existing, trie));
  }
  return root;
}

/**
 * A per-revision map from document pointers to the reconciliation work that reads them. A changed pointer reaches every key
 * registered at or below it, and every subtree key registered above it. Group keys stand for shared reads (one owner's ID
 * scan, say) and expand to their members, so a page scan is recorded once rather than once per binding on that page.
 */
export class EditDependencies {
  private readonly root: Branch = {};
  private readonly members = new Map<string, Set<string>>();

  /** `pointer` may be given as its steps. */
  add(pointer: string | readonly string[], keys: string | readonly string[], exact = false): void {
    const list = typeof keys === 'string' ? [keys] : keys, node = this.walk(this.root, typeof pointer === 'string' ? pointerPath(pointer) as string[] : pointer);
    if (exact) node.exact = into(node.exact, list); else node.subtree = into(node.subtree, list);
  }

  /**
   * `add(at, keys, true)` for `base` and for each pointer from it down through `field`'s steps, in one walk. Returns the
   * last of those pointers.
   */
  addSteps(base: string, field: string, keys: readonly string[]): string {
    let node = this.walk(this.root, pointerPath(base) as string[]);
    node.exact = into(node.exact, keys);
    const steps = pointerPath(field) as string[];
    for (const part of steps) {
      node = this.walk(node, [part]);
      node.exact = into(node.exact, keys);
    }
    return `${base}${fieldPointer(steps)}`;
  }

  /** The branch at `parts` below `from`. */
  private walk(from: Branch, parts: readonly string[]): Branch {
    let node = from;
    for (const part of parts) {
      const children = node.children ??= new Map();
      let child = children.get(part);
      if (!child) { child = {}; children.set(part, child); }
      node = child;
    }
    return node;
  }

  /** `key` is in scope whenever `group` is. */
  join(group: string, key: string): void {
    let members = this.members.get(group);
    if (!members) { members = new Set(); this.members.set(group, members); }
    members.add(key);
  }

  /**
   * Register `keys` for every read in `trie`, taken relative to `pointer`: the same as adding each read below `pointer`,
   * without walking the trie now.
   */
  mount(pointer: string, trie: ReadTrie, keys: readonly string[]): void {
    if (emptyTrie(trie)) return;
    (this.walk(this.root, pointerPath(pointer) as string[]).mounts ??= []).push({ trie, keys });
  }

  /**
   * Add to `scope` every key `pointer` reaches: each registered at or below it (collected from its branch on demand, so
   * registering costs only the walk to its own place), and each subtree key above it.
   */
  intersect(pointer: string, scope: Set<string>): void {
    const parts = pointerPath(pointer) as string[];
    let node: Branch | undefined = this.root;
    for (let depth = 0; depth < parts.length; depth++) {
      for (const key of node.subtree ?? []) scope.add(key);
      // A mounted trie here: the changed pointer is below its place, so it reaches the trie's keys when it is at or above a
      // read there, or below a subtree read.
      for (const { trie, keys } of node.mounts ?? []) {
        let at: ReadTrie | undefined = trie;
        for (let below = depth; at && below < parts.length && !at.subtree; below++) at = at.children.get(parts[below]);
        if (at) for (const key of keys) scope.add(key);
      }
      node = node.children?.get(parts[depth]);
      if (!node) return;
    }
    const collect = (branch: Branch) => {
      for (const key of branch.exact ?? []) scope.add(key);
      for (const key of branch.subtree ?? []) scope.add(key);
      // Every mounted trie is non-empty: it reads something at or below its place.
      for (const { keys } of branch.mounts ?? []) for (const key of keys) scope.add(key);
      for (const child of branch.children?.values() ?? []) collect(child);
    };
    collect(node);
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
    for (const [pointer, exact] of reads(document, read)) this.add(pointer, keys, exact);
  }
}

/** A list of reads: each pointer, and whether it reads only that value's presence and kind (`exact`) or all of it. */
export type Reads = readonly (readonly [pointer: string, exact: boolean])[];
/**
 * The reads `read` makes of `document`, through a proxy over it. An object for which `opaque(value, pointer)` holds is
 * handed to `read` as is, unobserved: the read of it is recorded, nothing below it (the caller accounts for that).
 */
export function reads<T extends object>(document: T, read: (document: T) => unknown, opaque?: (value: object, pointer: string) => boolean): Reads {
  const found: [string, boolean][] = [], proxies = new Map<string, object>();
  const wrap = (value: object, path: readonly (string | number)[]): object => {
    const pointer = fieldPointer([...path]), existing = proxies.get(pointer);
    if (existing) return existing;
    const proxy = new Proxy(Array.isArray(value) ? [...value] : { ...value }, {
      get: (_target, key) => {
        const child = Reflect.get(value, key);
        if (typeof key !== 'string' || typeof child === 'function') return child;
        const at = [...path, key], object = child !== null && typeof child === 'object', childPointer = fieldPointer(at);
        found.push([childPointer, object]);
        if (!object) return child;
        return opaque?.(child, childPointer) ? child : wrap(child, at);
      },
      has: (target, key) => {
        if (typeof key === 'string') found.push([fieldPointer([...path, key]), true]);
        return Reflect.has(target, key);
      },
      getOwnPropertyDescriptor: (target, key) => {
        if (typeof key === 'string') found.push([fieldPointer([...path, key]), true]);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      ownKeys: target => { found.push([pointer, false]); return Reflect.ownKeys(target); },
    });
    proxies.set(pointer, proxy);
    return proxy;
  };
  read(wrap(document, []) as T);
  return found;
}

/**
 * Visit every pointer where `after` differs from `before` by identity. Unchanged immutable branches are proofs, not a
 * classification of "simple" fields: anything rebuilt is visited, even when it looks equal.
 *
 * `placed` sees every object `after` holds at a position where `before` held something else (or nothing), once per such
 * position, including everything inside newly introduced subtrees, so an object that now appears in a second place is
 * noticed. Newly placed subtrees are scanned whole: no object's registration is taken to cover what is below it. Positions
 * `before` and `after` share by identity are never walked, so the cost is proportional to what the edit placed.
 */
export function changedPaths(before: unknown, after: unknown, visit: (pointer: string) => void, placed: (value: object) => void = () => {}): void {
  const scan = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    placed(value);
    for (const child of Object.values(value)) scan(child);
  };
  const walk = (before: unknown, after: unknown, path: (string | number)[]): void => {
    if (before === after) return;
    if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) {
      visit(fieldPointer(path)); scan(after); return;
    }
    if (Array.isArray(before) && Array.isArray(after) && before.length !== after.length) {
      visit(fieldPointer(path));
      // Items still at their own index are not newly placed; every other item is.
      placed(after);
      after.forEach((item, at) => { if (item !== before[at]) scan(item); });
      return;
    }
    placed(after);
    let retained = true;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (Object.hasOwn(before, key) !== Object.hasOwn(after, key)) {
        retained = false; visit(fieldPointer([...path, key]));
        if (Object.hasOwn(after, key)) scan(Reflect.get(after, key));
      } else if (Reflect.get(before, key) !== Reflect.get(after, key)) {
        retained = false;
        walk(Reflect.get(before, key), Reflect.get(after, key), [...path, key]);
      }
    }
    // Equal-looking rebuilt containers still need provenance; equality cannot certify their identity.
    if (retained) visit(fieldPointer(path));
  };
  walk(before, after, []);
}
