import { z } from 'zod/v4';
import type { Json } from '../../types';
import { parseCompositionShape } from '../compiler';
import { expandKeepingHoles, logicLibrarySchema, type LogicEntry, type LogicOrigin } from '../logic-library';
import { atPointer, join, record } from './json';
import type { GraphJSON, GraphSourceLocation, LogicAnchor } from './types';

/** Project native expansion landings back to uses and arguments; never expand or count an AST here. */
export function expansionSourceMap(authored: Json, expanded: Json, origins: readonly LogicOrigin[], anchor: LogicAnchor, sourceMap: readonly GraphSourceLocation[], externalLibrary: readonly LogicEntry[] = []): GraphSourceLocation[] {
  if (!origins.length) return [];
  const library = logicLibrarySchema.parse(record(authored) && Array.isArray(authored.logicLibrary) ? authored.logicLibrary : externalLibrary);
  const entries = new Map(library.map(entry => [entry.id, entry]));
  const templates = new Map<string, Json>(), result: GraphSourceLocation[] = [];
  const authoredMap = sourceMap.filter(location => location.anchor === anchor && location.stage !== 'expanded').sort((a, b) => b.pointer.length - a.pointer.length);
  const add = (at: string, original: string, usePointer: string) => {
    const source = authoredMap.find(location => original === location.pointer || original.startsWith(`${location.pointer}/`));
    if (source) result.push({ ...source, pointer: at, authoredPointer: original, usePointer, stage: 'expanded' });
  };
  const argument = (syntax: GraphJSON, actual: GraphJSON, at: string, original: string, usePointer: string): void => {
    if (record(syntax) && syntax.type === 'logic-ref') { use(syntax, actual, at, original, usePointer); return; }
    add(at, original, usePointer);
    if (actual !== null && typeof actual === 'object') for (const [key, value] of Object.entries(actual)) {
      const child = atPointer(syntax, join('', key));
      argument(child === undefined ? value : child, value, join(at, key), join(original, key), usePointer);
    }
  };
  const use = (reference: Record<string, Json>, actual: GraphJSON, at: string, original: string, usePointer: string): void => {
    const entry = typeof reference.logicId === 'string' ? entries.get(reference.logicId) : undefined;
    if (!entry || !record(reference.args)) throw new Error('Native expansion provenance requires a checked template use.');
    let template = templates.get(entry.id);
    if (template === undefined) {
      template = parseCompositionShape(z.json(), expandKeepingHoles(library, entry.body, new Set(entry.params.map(param => param.name))));
      templates.set(entry.id, template);
    }
    const args = reference.args;
    const land = (syntax: GraphJSON, value: GraphJSON, target: string): void => {
      if (record(syntax) && syntax.type === 'hole' && typeof syntax.name === 'string' && Object.hasOwn(args, syntax.name)) {
        argument(args[syntax.name], value, target, join(original, 'args', syntax.name), usePointer);
        return;
      }
      add(target, original, usePointer);
      if (value !== null && typeof value === 'object') for (const [key, inner] of Object.entries(value)) {
        const child = atPointer(syntax, join('', key));
        land(child === undefined ? inner : child, inner, join(target, key));
      }
    };
    land(template, actual, at);
  };
  for (const origin of origins) {
    if (origins.some(parent => parent !== origin && origin.pointer.startsWith(`${parent.pointer}/`))) continue;
    const reference = atPointer(authored, origin.pointer), actual = atPointer(expanded, origin.pointer);
    if (record(reference) && actual !== undefined) use(reference, parseCompositionShape(z.json(), actual), origin.pointer, origin.pointer, origin.pointer);
  }
  return result;
}
