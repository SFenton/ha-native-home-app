import type { CompositionNode } from '../schema';
import type { LogicUseBinding } from '../graph/types';
import { segments } from '../graph/json';
import { CompositionValidationError, pointer, reject, type CompositionIssue } from '../json';
import { logicLibrarySchema } from './library-schema';
import { fieldSteps } from '../components';
import { identifierSchema } from '../../validation';
import { atPointer, record, replacePointer, resolveLogicAnchor } from './anchors';
import { logicUseBindingsSchema, type StoredLogicUseBinding } from './schemas';

/** Only source-valued tile fields from the existing component definitions participate. */
export const tileSourceFields: Readonly<Partial<Record<CompositionNode['type'], readonly string[]>>> = {
  'action-tile': ['/binding/sourceId'],
  'navigation-tile': ['/props/titleProviderId', '/props/alarm/sourceId'],
  'room-card': ['/binding/sourceId'],
  'room-chip': ['/binding/sourceId'],
  'door-tile': ['/props/sourceId'],
  'light-group-tile': ['/props/sourceId'],
  'camera-tile': ['/props/sourceId'],
  'room-overview-tile': ['/props/sourceId', '/props/powerSourceId'],
  'climate-control': ['/props/sourceId'],
  'bedroom-control': ['/props/sourceId'],
};

export interface ResolvedUseBinding {
  readonly pointer: string;
  readonly usePointer: string;
  readonly argument: string;
  readonly sourcePointer: string;
  readonly sourceId: string;
  readonly componentBindingPointer?: string;
}
export interface UseBindingResolution {
  readonly document: unknown;
  readonly bindings: readonly ResolvedUseBinding[];
}

function parseBindings(value: unknown): StoredLogicUseBinding[] {
  const parsed = logicUseBindingsSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new CompositionValidationError(parsed.error.issues.flatMap((issue): CompositionIssue[] => {
    const at = issue.path.reduce<string>((base, key) => pointer(base, String(key)), '/logicUseBindings');
    if (issue.code === 'unrecognized_keys') return issue.keys.map(key => ({ code: 'unknown_field' as const, pointer: pointer(at, key) }));
    return [{ code: issue.code === 'too_big' ? 'limit_exceeded' as const : 'invalid_value' as const, pointer: at }];
  }));
}

/** Resolve against the addressed tile, not a preview lens or a cached explicit argument. */
export function resolveLogicUseBindings(input: unknown): UseBindingResolution {
  if (!record(input) || !Object.hasOwn(input, 'logicUseBindings')) return { document: input, bindings: [] };
  const bindings = parseBindings(input.logicUseBindings);
  const library = logicLibrarySchema.safeParse(input.logicLibrary ?? []);
  if (!library.success) reject('invalid_value', '/logicLibrary');
  let document: unknown = input;
  const resolved: ResolvedUseBinding[] = [], targets = new Set<string>();
  bindings.forEach((binding, index) => {
    const at = `/logicUseBindings/${index}`, target = resolveLogicAnchor(document, binding.use);
    if (!target?.node || !record(target.value) || target.value.type !== 'logic-ref') reject('invalid_reference', `${at}/use`);
    const use = target.value, node = target.node;
    if (use.logicId !== binding.logicId) reject('invalid_reference', `${at}/logicId`);
    // A tile can only supply its own fields; a pointer through children is not a tile context.
    if (segments(binding.use.field).some(part => ['children', 'tabs', 'blocks'].includes(part))) reject('invalid_reference', `${at}/use`);
    const key = `${target.pointer}/args/${binding.argument}`;
    if (targets.has(key)) reject('invalid_combination', at);
    targets.add(key);
    const entry = library.data.filter(item => item.id === use.logicId);
    const params = entry.length === 1 ? entry[0].params.filter(param => param.name === binding.argument) : [];
    if (params.length !== 1 || params[0].kind !== 'source-id') reject('binding_type', `${at}/argument`);
    if (!record(use.args) || !Object.hasOwn(use.args, binding.argument)
      || !identifierSchema.safeParse(use.args[binding.argument]).success) reject('binding_type', `${target.pointer}/args/${binding.argument}`);
    const fields = Object.entries(tileSourceFields).find(([kind]) => kind === node.value.type)?.[1];
    const sourceId = atPointer(node.value, binding.from.field);
    if (!fields?.includes(binding.from.field) || typeof sourceId !== 'string' || !identifierSchema.safeParse(sourceId).success) reject('binding_type', `${at}/from/field`);
    document = replacePointer(document, key, sourceId);
    let componentBindingPointer: string | undefined;
    if (binding.use.kind === 'component') {
      const raw = atPointer(document, `${target.owner.pointer}/bindings`);
      if (raw !== undefined && !Array.isArray(raw)) reject('binding_type', `${target.owner.pointer}/bindings`);
      const existing: unknown[] = Array.isArray(raw) ? raw : [];
      const sameField = (field: unknown, expected: string) => typeof field === 'string' && fieldSteps(field).join('/') === fieldSteps(expected).join('/');
      const sourceBindings = existing.filter(item => record(item) && item.nodeId === node.value.id && sameField(item.field, binding.from.field));
      if (sourceBindings.length > 1) reject('invalid_combination', `${at}/from/field`);
      const field = `${binding.use.field}/args/${binding.argument}`;
      const previous = existing.filter(item => record(item) && item.nodeId === node.value.id && sameField(item.field, field));
      if (!sourceBindings.length && previous.length) reject('invalid_combination', at);
      if (sourceBindings.length) {
        const source = sourceBindings[0];
        if (!record(source)) throw new Error('Missing checked component binding');
        if (previous.some(item => !record(item) || item.param !== source.param)) reject('invalid_combination', at);
        if (!previous.length) {
          const owner = atPointer(document, target.owner.pointer);
          if (!record(owner)) throw new Error('Missing checked component owner');
          componentBindingPointer = `${target.owner.pointer}/bindings/${existing.length}`;
          document = replacePointer(document, target.owner.pointer, {
            ...owner,
            bindings: [...existing, { param: source.param, nodeId: node.value.id, field: field.slice(1) }],
          });
        }
      }
    }
    resolved.push({
      pointer: at, usePointer: target.pointer, argument: binding.argument, sourcePointer: `${node.pointer}${binding.from.field}`, sourceId,
      ...(componentBindingPointer ? { componentBindingPointer } : {}),
    });
  });
  return { document, bindings: resolved };
}

/** Return one immutable authoring transaction, including the resolved explicit argument. */
export function bindLogicUse(document: unknown, binding: LogicUseBinding): unknown {
  if (!record(document)) reject('invalid_value', '');
  const bindings = Object.hasOwn(document, 'logicUseBindings') ? parseBindings(document.logicUseBindings) : [];
  const target = resolveLogicAnchor(document, binding.use);
  if (!target || !record(target.value) || target.value.type !== 'logic-ref') reject('invalid_reference', '/logicUseBindings/use');
  const next = { ...document, logicUseBindings: [...bindings, { ...binding, logicId: target.value.logicId }] };
  const resolved = resolveLogicUseBindings(next).bindings.at(-1);
  if (!resolved) throw new Error('Missing checked use binding');
  return replacePointer(next, `${resolved.usePointer}/args/${resolved.argument}`, resolved.sourceId);
}

/** Removing automatic fill materializes its current value without touching any other use. */
export function unbindLogicUse(document: unknown, index: number): unknown {
  if (!record(document) || !Number.isInteger(index)) reject('invalid_value', '/logicUseBindings');
  const bindings = parseBindings(document.logicUseBindings);
  if (index < 0 || index >= bindings.length) reject('invalid_reference', `/logicUseBindings/${index}`);
  const resolved = resolveLogicUseBindings(document).bindings[index];
  const materialized = replacePointer(document, `${resolved.usePointer}/args/${resolved.argument}`, resolved.sourceId);
  if (!record(materialized)) throw new Error('Missing checked draft document');
  return { ...materialized, logicUseBindings: bindings.filter((_, at) => at !== index) };
}
