import { derivedId, type DocumentSource, type NodePath } from './components';
import type { CompositionDocument } from './schema';
import type { CompositionIssue } from './json';
import type { ExpressionFacts } from './expression';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const entityId = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const steps = (pointer: string): NodePath => pointer.replace(/^\/document\/?/, '').split('/').filter(Boolean)
  .map(step => /^\d+$/.test(step) ? Number(step) : step.replace(/~1/g, '/').replace(/~0/g, '~'));

export interface DependencyReader { path: NodePath; value: RecordValue }
export interface CompositionDependency {
  target: { type: 'source' | 'entity'; id: string };
  path: NodePath;
  reader: DependencyReader;
  from?: string;
  kind: 'read' | 'argument' | 'definition';
  /** Editable saved logic is the one intentional addition to published compiler references. */
  sample?: true;
}
export interface CompositionDependencies { edges: CompositionDependency[]; issues: CompositionIssue[]; complete: boolean }

/**
 * The compiler's source lookup. Its callers are the typed reference checks, not a second field-name walk.
 * Entity endpoints project already-typed source definitions; literals are opaque except in entity-ID slots.
 */
export class CompositionReferences {
  private readonly seen = new Set<string>();
  readonly graph: CompositionDependencies;
  constructor(private readonly document: CompositionDocument, private readonly sources: ReadonlyMap<string, DocumentSource>, private readonly recording?: CompositionDependencies) {
    this.graph = recording ?? { edges: [], issues: [], complete: false };
  }

  private location(pointer: string): { path: NodePath; reader: DependencyReader; from?: string } {
    const path = steps(pointer);
    if (path[0] === 'componentLibrary' && typeof path[1] === 'number') {
      const entry = this.document.componentLibrary?.[path[1]];
      if (entry) {
        const source = (path[2] === 'sources' ? entry.sources : path[2] === 'flows' ? entry.flows : undefined)?.[Number(path[3])];
        return { path, reader: { path: path.slice(0, 2), value: entry }, ...(source ? { from: derivedId(entry.id, source.id) } : {}) };
      }
    }
    if (path[0] === 'dataSources' && typeof path[1] === 'number') {
      const source = this.document.dataSources[path[1]];
      if (source) return { path, reader: { path: path.slice(0, 2), value: source }, from: source.id };
    }
    let reader: DependencyReader = { path: [], value: this.document };
    let value: unknown = this.document;
    for (let at = 0; at < path.length; at++) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, path[at])) break;
      value = Reflect.get(value, path[at]);
      if (record(value) && typeof value.id === 'string' && ('type' in value || 'title' in value || 'label' in value)) reader = { path: path.slice(0, at + 1), value };
    }
    return { path, reader };
  }

  add(edge: CompositionDependency): void {
    if (!this.recording) return;
    const key = JSON.stringify([edge.target, edge.path, edge.from, edge.kind, edge.sample]);
    if (!this.seen.has(key)) { this.seen.add(key); this.graph.edges.push(edge); }
  }

  source(id: string, pointer: string, kind: CompositionDependency['kind'] = 'read'): DocumentSource | undefined {
    if (this.recording) this.add({ target: { type: 'source', id }, ...this.location(pointer), kind });
    return this.sources.get(id);
  }

  entity(id: string, pointer: string): void {
    if (this.recording && entityId.test(id)) this.add({ target: { type: 'entity', id }, ...this.location(pointer), kind: 'read' });
  }

  editable(facts: ExpressionFacts, reader: DependencyReader): void {
    for (const ref of facts.references) this.add({
      target: { type: 'source', id: ref.sourceId }, reader, kind: 'read', sample: true,
      path: steps(ref.pointer + (ref.kind === undefined ? '/sourceId' : '/from/sourceId')),
    });
  }

  define(source: DocumentSource, pointer: string, owner?: DependencyReader, requests: { id: string; path: string }[] = []): void {
    if (!this.recording) return;
    const reader = owner ?? this.location(pointer).reader;
    if (source.kind === 'model' && source.model === 'pipeline@1') {
      for (const { id, path } of requests) if (entityId.test(id)) this.add({ target: { type: 'entity', id }, path: steps(path), reader, from: source.id, kind: 'read' });
      return;
    }
    const visit = (value: unknown, path: NodePath, field = ''): void => {
      const endpoint = (id: unknown) => {
        if (typeof id === 'string' && entityId.test(id)) this.add({ target: { type: 'entity', id }, path, reader, from: source.id, kind: 'definition' });
      };
      const entitySlot = /entity_?ids?$/i.test(field) || field === 'copySourceId';
      if (typeof value === 'string' && entitySlot) endpoint(value);
      if (Array.isArray(value)) { value.forEach((item, at) => visit(item, [...path, at], field)); return; }
      if (!record(value)) return;
      if (value.type === 'literal') {
        if (entitySlot) Array.isArray(value.value) ? value.value.forEach(endpoint) : endpoint(value.value);
        return;
      }
      for (const [key, child] of Object.entries(value)) visit(child, [...path, key], key === 'value' && value.type === 'entity-id' ? 'entityId' : key);
    };
    visit(source, steps(pointer));
  }

  merge(graph: CompositionDependencies, names = new Map<string, string>()): void {
    for (const edge of graph.edges) this.add({
      ...edge, target: { ...edge.target, id: names.get(edge.target.id) ?? edge.target.id },
      ...(edge.from ? { from: names.get(edge.from) ?? edge.from } : {}),
    });
  }
}
