import { checkedBody, derivedId, expandRef, expandSources, isSourceKey, ownedSources, type DocumentSource, type NodePath } from './components';
import type { ComponentRefNode, CompositionDocument } from './schema';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A reader's location in its expanded scope and owning object, before UI-specific naming. */
export interface DependencyReader { path: NodePath; value: RecordValue }
export interface CompositionDependency {
  target: { type: 'source' | 'entity'; id: string };
  path: NodePath;
  reader: DependencyReader;
  /** Source whose definition contains this edge; literal entity definitions are not independent readers. */
  from?: string;
  /** Arguments retain sources without reading them; literal definitions are followed only by a reader. */
  kind: 'read' | 'argument' | 'definition';
}
export interface CompositionDependencies { edges: CompositionDependency[] }

/**
 * The pruning reference walk, with dependency edges and reader locations. Pass logic-expanded fields before component
 * namespaces, as the compiler does; editable logic samples are evaluated separately in their original global scope.
 * The entire document is walked, not a list of rendering surfaces. Only library scope and argument expansion are special.
 */
export function compositionDependencies(plain: CompositionDocument, samples = plain.logicLibrary ?? []): CompositionDependencies {
  const edges: CompositionDependency[] = [];
  type Scope = { reader: DependencyReader; from?: string; locked?: boolean; literalDefinitions?: boolean };
  const fill = (value: unknown, args: RecordValue): unknown => {
    if (Array.isArray(value)) return value.map(item => fill(item, args));
    if (!record(value)) return value;
    if (value.type === 'hole' && typeof value.name === 'string') return args[value.name] ?? value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, fill(child, args)]));
  };
  const edge = (type: 'source' | 'entity', id: string, path: NodePath, scope: Scope, kind: CompositionDependency['kind'] = 'read') => {
    if (type === 'entity' && (scope.literalDefinitions || !scope.reader.path.length)) kind = 'definition';
    edges.push({ target: { type, id }, path, reader: scope.reader, ...(scope.from ? { from: scope.from } : {}), kind });
  };
  const walk = (value: unknown, path: NodePath, scope: Scope, args: RecordValue = {}, stack = new Set<string>(), field = ''): void => {
    if (typeof value === 'string' && (/entity_?ids?$/i.test(field) || field === 'copySourceId') && /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value)) edge('entity', value, path, scope);
    if (Array.isArray(value)) { value.forEach((item, at) => walk(item, [...path, at], scope, args, stack, field)); return; }
    if (!record(value)) return;
    if (!scope.locked && typeof value.id === 'string' && ('type' in value || 'title' in value || 'label' in value || value.kind === 'ha-entity' || value.kind === 'model')) {
      scope = { ...scope, reader: { path, value } };
    }
    if (typeof value.id === 'string' && (value.kind === 'ha-entity' || value.kind === 'model')) {
      scope = { ...scope, from: value.id, locked: true, literalDefinitions: value.kind === 'ha-entity' || value.model !== 'pipeline@1' };
    }
    if (value.type === 'component-ref') {
      const entry = plain.componentLibrary?.find(entry => entry.id === value.componentId);
      if (entry) {
        const ref = value as ComponentRefNode;
        for (const param of entry.params ?? []) {
          const id = ref.args?.[param.name];
          if (param.kind === 'source-id' && typeof id === 'string') edge('source', id, [...path, 'args', param.name], scope, 'argument');
        }
        walk(expandRef(ref, entry), path, scope, args, stack);
        expandSources(ref, entry).forEach((source, at) => walk(source, [...path, 'sources', at], scope, args, stack));
      }
      return;
    }
    if (value.type === 'logic-ref') {
      const entry = samples.find(entry => entry.id === value.logicId);
      if (entry && !stack.has(entry.id)) walk(entry.body, path, scope, record(value.args) ? fill(value.args, args) as RecordValue : {}, new Set([...stack, entry.id]), field);
      return;
    }
    if (value.type === 'hole') {
      if (typeof value.name === 'string' && args[value.name] !== undefined) walk(args[value.name], path, scope, {}, stack, field);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const at = [...path, key];
      const resolved = isSourceKey(key) || /(?:source|provider)Ids$/i.test(key) ? fill(child, args) : child;
      if (isSourceKey(key) && typeof resolved === 'string') edge('source', resolved, at, scope);
      else if (/(?:source|provider)Ids$/i.test(key) && Array.isArray(resolved)) {
        resolved.forEach((id, index) => { if (typeof id === 'string') edge('source', id, [...at, index], scope); });
      }
      walk(child, at, scope, args, stack, key === 'value' ? value.type === 'entity-id' ? 'entityId' : field : key);
    }
  };
  const { componentLibrary, logicLibrary: _logicLibrary, ...rest } = plain;
  walk(rest, [], { reader: { path: [], value: rest } });
  componentLibrary?.forEach((entry, at) => {
    const path: NodePath = ['componentLibrary', at], scope = { reader: { path, value: entry }, locked: true };
    walk(checkedBody(entry), [...path, 'node'], scope);
    // Like the compiler's privateSources, only the definition's id changes; reads inside it retain their global scope.
    ownedSources(entry).forEach((source, index) => {
      const namespaced: DocumentSource = { ...source, id: derivedId(entry.id, source.id) };
      const sourceCount = entry.sources?.length ?? 0;
      const field = index < sourceCount ? 'sources' : 'flows', offset = index < sourceCount ? index : index - sourceCount;
      walk(namespaced, [...path, field, offset], scope);
    });
  });
  samples.forEach((entry, at) => {
    const path: NodePath = ['logicLibrary', at];
    walk({ type: 'logic-ref', logicId: entry.id, args: Object.fromEntries(entry.params.filter(param => param.sample !== undefined).map(param => [param.name, param.sample])) }, path, { reader: { path, value: entry }, locked: true });
  });
  return { edges };
}
