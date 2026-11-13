import type { Component, Condition, Json, Primitive, StudioDocument } from './types';

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function evaluateCondition(
  condition: Condition | undefined,
  variables: Record<string, Primitive>,
  entities: Record<string, Primitive> = {},
): boolean {
  if (!condition) return true;
  const source = condition.source === 'variable' ? variables : entities;
  if (!Object.hasOwn(source, condition.key)) return false;
  const current = source[condition.key];
  switch (condition.operator) {
    case 'equals': return current === condition.value;
    case 'not-equals': return current !== condition.value;
    case 'truthy': return Boolean(current);
    case 'greater-than': return typeof current === 'number' && typeof condition.value === 'number' && current > condition.value;
    case 'less-than': return typeof current === 'number' && typeof condition.value === 'number' && current < condition.value;
    default: return false;
  }
}

export function readBindingPath(value: Json, path?: string): Json | undefined {
  if (!path) return value;
  let current: Json | undefined = value;
  for (const key of path.split('.')) {
    if (unsafeKeys.has(key) || !key || current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = Array.isArray(current) ? current[Number(key)] : current[key];
  }
  return current;
}

export function resolveBinding(component: Component, document: StudioDocument): Json | undefined {
  if (!component.binding) return undefined;
  const source = document.dataSources.find((item) => item.id === component.binding?.sourceId);
  return source ? readBindingPath(source.sample, component.binding.path) : undefined;
}
