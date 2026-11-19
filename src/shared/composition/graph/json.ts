import type { Json } from '../../types';
import { canonicalCompositionJSON, pointer } from '../json';
import { shapeSchema, type Shape } from '../pipeline/shape';
import type { GraphJSON, Immutable } from './types';

export const record = (value: unknown): value is Record<string, Json> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export function withoutCanvasMetadata(value: Json): Json {
  if (!record(value)) return value;
  const { studioCanvas: _layout, ...semantic } = value;
  return semantic;
}
export function copy(value: GraphJSON): Json {
  if (Array.isArray(value)) return value.map(copy);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, copy(inner)]));
  return value;
}
export function segments(at: string): string[] {
  if (at === '') return [];
  if (!/^(?:\/(?:[^~]|~[01])*)+$/.test(at)) throw new Error(`Invalid JSON pointer: ${at}`);
  return at.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}
export function atPointer(value: GraphJSON, at: string): GraphJSON | undefined {
  let current: GraphJSON | undefined = value;
  for (const part of segments(at)) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = Array.isArray(current) ? current[Number(part)] : (current as Readonly<Record<string, GraphJSON>>)[part];
  }
  return current;
}
export function replaceAt(value: Json, at: string, replacement: Json): Json {
  const path = segments(at);
  if (!path.length) return replacement;
  const visit = (current: Json, index: number): Json => {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, path[index])) throw new Error(`Missing AST binding ${at}`);
    const key = path[index];
    if (Array.isArray(current)) return current.map((item, own) => String(own) === key ? index === path.length - 1 ? replacement : visit(item, index + 1) : item);
    return Object.fromEntries(Object.entries(current).map(([own, item]) => [own, own === key ? index === path.length - 1 ? replacement : visit(item, index + 1) : item]));
  };
  return visit(value, 0);
}
/** Exact canonical content, rather than a collision-prone short hash, guards document-only anchors. */
export const fingerprint = (value: GraphJSON): string => canonicalCompositionJSON(value);
export const copyShape = (shape: Immutable<Shape>): Shape => shapeSchema.parse(shape);
export const join = (base: string, ...parts: (string | number)[]): string => parts.reduce<string>(pointer, base);
