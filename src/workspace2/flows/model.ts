import { buildDocumentIndex, type SelectionKey } from '../../preview2/model';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { LogicEntry } from '../../shared/composition/logic-library';
import { operandBase, operandKind, predicateBase } from '../../shared/composition/expression';
import { labelText } from '../labels';
import { operandName, sentence, type NameContext } from '../expr/condition';
import { expandDocument, ownedSources, readField } from '../../shared/composition/components';
import { dataReferences, type Source } from '../dialogs/sources';
import { workedOut } from '../data/logic/logicModel';

export type OutputKind = 'boolean' | 'number' | 'words' | 'list' | 'time';
export const outputWords: Record<OutputKind, string> = { boolean: 'Yes or No', number: 'Number', words: 'Words', list: 'List', time: 'Time' };
export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const matches = (query: string, ...texts: string[]) => query.toLowerCase().split(/\s+/).filter(Boolean).every(word => texts.join(' ').toLowerCase().includes(word));
const nodeLike = (value: unknown) => record(value) && typeof value.id === 'string' && typeof value.type === 'string' && ('props' in value || 'layout' in value);

export function outputKind(value: unknown, document: CompositionDocument, params: LogicEntry['params'] = [], seen = new Set<string>()): OutputKind {
  if (!record(value)) return 'words';
  if (value.type === 'expr' || value.type === 'literal' && record(value.value) && value.value.type === 'hole') return outputKind(value.value, document, params, seen);
  if (value.type === 'hole') {
    const param = params.find(item => item.name === value.name);
    return param?.display === 'time' ? 'time' : param?.kind === 'number' ? 'number' : param?.kind === 'condition' ? 'boolean' : param?.kind === 'operand' ? outputKind(param.sample, document, [], seen) : 'words';
  }
  if (value.type === 'logic-ref' && typeof value.logicId === 'string' && !seen.has(value.logicId)) {
    seen.add(value.logicId);
    const entry = document.logicLibrary?.find(item => item.id === value.logicId);
    return entry?.kind === 'condition' ? 'boolean' : outputKind(entry?.body, document, entry?.params, seen);
  }
  if (value.type === 'last-changed' || value.type === 'clock' || value.type === 'date') return 'time';
  if (['math', 'count', 'list-count', 'index'].includes(String(value.type))) return 'number';
  if (value.type === 'list' || value.type === 'object') return 'list';
  if (value.type === 'choose' || value.type === 'map') return outputKind(value.otherwise, document, params, seen);
  if (predicateBase.safeParse(value).success || predicateBase.safeParse(workedOut(document, value)).success) return 'boolean';
  const parsed = operandBase.safeParse(value);
  const kind = parsed.success ? operandKind(parsed.data) : undefined;
  return kind === 'boolean' ? 'boolean' : kind === 'number' ? 'number' : kind === 'structure' ? 'list' : 'words';
}

export interface FieldLogic { id: string; key?: SelectionKey; templateId?: string; title: string; field: string; path: string; value: unknown; kind: OutputKind }

/** One row per authored field, not per nested operand or condition. Child components own their own rows. */
export function fieldsWithLogic(document: CompositionDocument): FieldLogic[] {
  const index = buildDocumentIndex(document), out: FieldLogic[] = [];
  const scan = (node: Record<string, unknown>, base: (string | number)[], key?: SelectionKey, templateId?: string, prefix = '') => {
    const visit = (value: unknown, path: (string | number)[]) => {
      if (Array.isArray(value)) { value.forEach((item, at) => visit(item, [...path, at])); return; }
      if (!record(value) || nodeLike(value)) return;
      const predicate = predicateBase.safeParse(value);
      const single = predicate.success && (predicate.data.type === 'state' || predicate.data.type === 'numeric' && (!predicate.data.above || predicate.data.above.type === 'literal') && (!predicate.data.below || predicate.data.below.type === 'literal')
        || (predicate.data.type === 'compare' && (predicate.data.left.type === 'read' && predicate.data.right.type === 'literal' || predicate.data.right.type === 'read' && predicate.data.left.type === 'literal')));
      const operand = operandBase.safeParse(value);
      const plain = predicate.success || operand.success ? value : workedOut(document, value);
      const hasLogic = !single && (predicate.success || predicateBase.safeParse(plain).success || value.type === 'logic-ref' || Array.isArray(value.cases)
        || (value.type === 'expr' && record(value.value) && value.value.type !== 'literal') || value.type === 'read' && record(value.from)
        || ((operand.success || operandBase.safeParse(plain).success) && !['literal', 'control', 'item', 'param', 'index'].includes(String(value.type))));
      if (hasLogic) {
        const labelPath = path.at(-1) === 'condition' ? path.slice(0, -1) : path;
        const full = [...base, ...path].join('/');
        out.push({ id: `${key ?? templateId}:${full}`, key, templateId, title: `${prefix}${String(node.title ?? 'Component')}`,
          field: labelText(String(node.type), labelPath), path: full, value, kind: outputKind(value, document) });
        return;
      }
      // A simple check isn't a flow, including its read operand.
      if (single) return;
      for (const [name, child] of Object.entries(value)) visit(child, [...path, name]);
    };
    for (const [name, value] of Object.entries(node)) visit(value, [name]);
  };
  for (const key of index.keys) {
    const entry = index.get(key);
    if (entry?.kind === 'node' && entry.node) scan(entry.node, entry.bodyPath ?? entry.path, key);
  }
  // Saved components with no places are still editable, but have no canvas selection key.
  document.componentLibrary?.forEach((entry, at) => {
    if (index.keys.some(key => index.get(key)?.component === entry.id)) return;
    const visit = (value: unknown, path: (string | number)[]) => {
      if (Array.isArray(value)) { value.forEach((item, i) => visit(item, [...path, i])); return; }
      if (!record(value)) return;
      if (nodeLike(value)) scan(value, path, undefined, entry.id, `${entry.name} · `);
      for (const [name, child] of Object.entries(value)) visit(child, [...path, name]);
    };
    visit(entry.node, ['componentLibrary', at, 'node']);
  });
  return out;
}

export function fieldSummary(value: unknown, document: CompositionDocument, entityNames: ReadonlyMap<string, string>): string {
  const context: NameContext = { document, entityName: id => entityNames.get(id), logic: { library: document.logicLibrary ?? [] } };
  if (!record(value)) return 'Field logic';
  if (value.type === 'expr') return fieldSummary(value.value, document, entityNames);
  if (value.type === 'logic-ref') return `Uses ${document.logicLibrary?.find(entry => entry.id === value.logicId)?.name ?? 'a logic template'}`;
  if (value.type === 'conditional') return 'Chooses a look by rule';
  const predicate = predicateBase.safeParse(value);
  if (predicate.success) return sentence(predicate.data, context);
  const operand = operandBase.safeParse(value);
  return operand.success ? operandName(operand.data, context) : 'Field logic';
}

/** Named readers, including transitive source dependencies and saved templates. Entity sources alone aren't readers. */
export function entityReaders(document: CompositionDocument): Map<string, Set<string>> {
  const sources = new Map(expandDocument(document).dataSources.map(source => [source.id, source]));
  const result = new Map<string, Set<string>>();
  const entitiesIn = (value: unknown, found: Set<string>, available: ReadonlyMap<string, Source>, seen = new Set<string>()): void => {
    const refs = dataReferences(document, value);
    refs.entities.forEach(id => found.add(id));
    for (const id of refs.sources) {
      const source = available.get(id);
      if (!source || seen.has(id)) continue;
      seen.add(id);
      entitiesIn(source, found, available, seen);
    }
  };
  const add = (name: string, value: unknown, available: ReadonlyMap<string, Source> = sources) => {
    const found = new Set<string>(); entitiesIn(value, found, available);
    for (const id of found) { const readers = result.get(id) ?? new Set<string>(); readers.add(name); result.set(id, readers); }
  };
  const index = buildDocumentIndex(document);
  for (const key of index.keys) {
    const entry = index.get(key);
    if (!entry || entry.kind === 'source' || entry.kind === 'chrome-group') continue;
    const value = entry.node ?? readField(document, entry.path.join('/'));
    if (!record(value)) continue;
    const own = Object.fromEntries(Object.entries(value).filter(([key]) => !['components', 'children', 'tabs', 'blocks', 'toolbar'].includes(key)));
    const surface = entry.surface && index.get(entry.surface);
    const surfaceValue = surface && readField(document, surface.path.join('/'));
    const name = typeof value.title === 'string' ? value.title : typeof value.label === 'string' ? value.label
      : record(surfaceValue) && typeof surfaceValue.title === 'string' ? `${surfaceValue.title} toolbar` : 'App toolbar';
    add(name, own);
  }
  for (const source of document.dataSources) if (source.kind === 'model' && source.model === 'pipeline@1') {
    const { id: _id, ...body } = source;
    add(source.inputs.title, body);
  }
  for (const entry of document.logicLibrary ?? []) add(entry.name, { type: 'logic-ref', logicId: entry.id, args: Object.fromEntries(entry.params.filter(param => param.sample !== undefined).map(param => [param.name, param.sample])) });
  for (const entry of document.componentLibrary ?? []) add(entry.name, entry.node, new Map([...sources, ...ownedSources(entry).map(source => [source.id, source] as const)]));
  return result;
}
