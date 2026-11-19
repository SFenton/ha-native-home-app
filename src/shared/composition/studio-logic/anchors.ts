import type { LogicAnchor } from '../graph/types';
import { segments } from '../graph/json';
import { canonicalOfBounded, pointer } from '../json';

export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function atPointer(value: unknown, at: string): unknown {
  for (const part of segments(at)) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = Reflect.get(value, part);
  }
  return value;
}

export function replacePointer(value: unknown, at: string, replacement: unknown): unknown {
  const path = segments(at);
  const visit = (current: unknown, index: number): unknown => {
    if (index === path.length) return replacement;
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, path[index])) throw new Error('Missing checked draft binding');
    if (Array.isArray(current)) return current.map((item, own) => String(own) === path[index] ? visit(item, index + 1) : item);
    return { ...current, [path[index]]: visit(Reflect.get(current, path[index]), index + 1) };
  };
  return visit(value, 0);
}

interface Located { value: Record<string, unknown>; pointer: string }
export interface ResolvedLogicAnchor {
  readonly value: unknown;
  readonly pointer: string;
  readonly node?: Located;
  readonly owner: Located;
}

function nodes(value: unknown, at: string): Located[] {
  if (!record(value) || typeof value.type !== 'string' || typeof value.id !== 'string') return [];
  const result: Located[] = [{ value, pointer: at }];
  const children = (list: unknown, base: string) => {
    if (Array.isArray(list)) list.forEach((child, index) => result.push(...nodes(child, pointer(base, index))));
  };
  children(value.children, pointer(at, 'children'));
  if (value.type === 'local-tabs') for (const key of ['tabs', 'blocks']) {
    const list = value[key];
    if (Array.isArray(list)) list.forEach((tab, index) => {
      if (record(tab)) children(tab.children, `${pointer(pointer(at, key), index)}/children`);
    });
  }
  return result;
}

/** Owner and node IDs are resolved afresh; a remembered array index is never an identity. */
export function resolveLogicAnchor(document: unknown, anchor: LogicAnchor): ResolvedLogicAnchor | undefined {
  if (!record(document)) return undefined;
  let owner: Located;
  if (anchor.kind === 'document') {
    if (document.id !== anchor.id) return undefined;
    const value = atPointer(document, anchor.field);
    if (value === undefined || canonicalOfBounded(value) !== anchor.fingerprint) return undefined;
    return { value, pointer: anchor.field, owner: { value: document, pointer: '' } };
  }
  const key = { page: 'pages', modal: 'modals', component: 'componentLibrary', logic: 'logicLibrary', flow: 'dataSources' }[anchor.kind];
  const list = document[key];
  if (!Array.isArray(list)) return undefined;
  const matches = list.flatMap((value, index): Located[] => record(value) && value.id === anchor.id ? [{ value, pointer: `/${key}/${index}` }] : []);
  if (matches.length !== 1) return undefined;
  owner = matches[0];
  let node: Located | undefined;
  if (anchor.nodeId !== undefined) {
    const candidates = anchor.kind === 'component' ? nodes(owner.value.node, `${owner.pointer}/node`)
      : (anchor.kind === 'page' || anchor.kind === 'modal') && Array.isArray(owner.value.components)
        ? owner.value.components.flatMap((value, index) => nodes(value, `${owner.pointer}/components/${index}`)) : [];
    const found = candidates.filter(candidate => candidate.value.id === anchor.nodeId);
    if (found.length !== 1) return undefined;
    node = found[0];
  }
  const base = node ?? owner, value = atPointer(base.value, anchor.field);
  return value === undefined ? undefined : { value, pointer: `${base.pointer}${anchor.field}`, node, owner };
}
