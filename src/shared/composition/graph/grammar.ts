import type { Json } from '../../types';
import { callServiceSchema, operandBase, predicateBase, type Operand } from '../expression';
import { logicEntrySchema, logicHoleSchema, logicRefSchema } from '../logic-library';
import { outputSchema, pipelineInputsSchema, pipelineSourceSchema, requestSchema, stepSchema } from '../pipeline/schema';
import type { GraphJSON, GraphPayload } from './types';
import { atPointer, copy, join, record, replaceAt } from './json';
import { graphInputsSchema, graphSourceSchema, graphStepSchema } from './capabilities';
import { identifierSchema } from '../../validation';

export type FragmentKind = 'operand' | 'condition' | 'call' | 'source-selection' | 'flow' | 'flow-inputs' | 'request' | 'step' | 'output' | 'logic-entry' | 'slot' | 'document' | 'fragment' | 'auto';
export interface ChildBinding<T = Json> { readonly binding: string; readonly kind: FragmentKind; readonly value: T }
export interface GrammarDescription { readonly payload: GraphPayload; readonly key: string; readonly children: readonly ChildBinding[] }
const operandNames = new Set(['literal', 'read', 'control', 'viewer', 'format', 'raw-state', 'last-changed', 'list-count', 'list-includes', 'count', 'map', 'math', 'object', 'list', 'item', 'param', 'clock', 'date', 'index', 'choose']);
const predicateNames = new Set(['state', 'numeric', 'viewer', 'viewer-person', 'all', 'any', 'not', 'compare', 'in', 'exists']);
const literal: Operand = { type: 'literal', value: 0 };
const condition = { type: 'compare' as const, op: 'eq' as const, left: literal, right: literal };

export function inferFragment(value: GraphJSON, hint: FragmentKind = 'auto'): FragmentKind {
  if (hint !== 'auto') return hint;
  if (!record(value)) return 'document';
  if (value.kind === 'model' && value.model === 'pipeline@1') return 'flow';
  if (typeof value.type === 'string') {
    if (value.type === 'call-service') return 'call';
    if (value.type === 'literal' && !Object.hasOwn(value, 'value')) return 'document';
    if (value.type === 'state' && !Object.hasOwn(value, 'sourceId')) return 'document';
    if (value.type === 'map' && !Object.hasOwn(value, 'of')) return 'document';
    if (value.type === 'count' && !Object.hasOwn(value, 'of')) return 'document';
    if (value.type === 'read' && (Object.hasOwn(value, 'fallback') || Object.hasOwn(value, 'whenUnavailable'))) return 'slot';
    if (['expr', 'conditional', 'bound-symbol'].includes(value.type)) return 'slot';
    if (value.type === 'viewer') return 'field' in value ? 'operand' : 'condition';
    if (operandNames.has(value.type)) return 'operand';
    if (predicateNames.has(value.type)) return 'condition';
    if (value.type === 'logic-ref' || value.type === 'hole') return 'operand';
  }
  return 'document';
}

export function expressionChildren(value: Readonly<Record<string, GraphJSON>>, kind: 'operand' | 'condition'): ChildBinding<GraphJSON>[] {
  if (value.type === 'literal') return [];
  const found: ChildBinding<GraphJSON>[] = [];
  const take = (path: string, childKind: FragmentKind = 'operand') => {
    const child = atPointer(value, path);
    if (child !== undefined) found.push({ binding: path, kind: childKind, value: child });
  };
  const array = (key: string, childKind: FragmentKind = 'operand') => {
    if (Array.isArray(value[key])) value[key].forEach((_, i) => take(join('', key, i), childKind));
  };
  const fields = (key: string) => {
    if (record(value[key])) Object.keys(value[key]).forEach(name => take(join('', key, name)));
  };
  switch (value.type) {
    case 'math': array('args'); break;
    case 'format': fields('args'); break;
    case 'object': fields('fields'); break;
    case 'list': array('items'); break;
    case 'date': take('/from'); take('/to'); break;
    case 'list-includes': case 'exists': take('/value'); break;
    case 'numeric': take('/above'); take('/below'); break;
    case 'compare': take('/left'); take('/right'); break;
    case 'in': take('/value'); array('in'); break;
    case 'all': case 'any': array('of', 'condition'); break;
    case 'not': take('/of', 'condition'); break;
    case 'count':
      if (Array.isArray(value.of)) value.of.forEach((_, i) => take(join('', 'of', i, 'test'), 'condition'));
      break;
    case 'choose': case 'map':
      if (value.type === 'map') take('/of');
      if (Array.isArray(value.cases)) value.cases.forEach((_, i) => {
        if (value.type === 'choose') take(join('', 'cases', i, 'when'), 'condition');
        take(join('', 'cases', i, 'then'));
      });
      take('/otherwise');
      break;
    case 'logic-ref':
      if (record(value.args)) Object.entries(value.args).forEach(([name, arg]) => { if (record(arg)) take(join('', 'args', name), inferFragment(arg)); });
      break;
  }
  // Primitive template holes are bindings too, but literal data is never interpreted as grammar.
  const holes = (candidate: GraphJSON, path: string) => {
    if (!record(candidate) || value.type === 'literal' || found.some(child => child.binding === path)) return;
    for (const [key, inner] of Object.entries(candidate)) {
      if (record(inner) && inner.type === 'hole' && !found.some(child => child.binding === join(path, key))) found.push({ binding: join(path, key), kind, value: inner });
      else if (record(inner)) holes(inner, join(path, key));
    }
  };
  holes(value, '');
  return found;
}

/** Discover structural bindings without parsing or typing their enclosing subtrees. */
export function grammarChildren(value: GraphJSON, hint: FragmentKind = 'auto'): ChildBinding<GraphJSON>[] {
  const kind = inferFragment(value, hint), children: ChildBinding<GraphJSON>[] = [];
  if (kind === 'source-selection' || record(value) && (value.type === 'hole' || value.type === 'literal' && kind === 'operand')) return children;
  const take = (binding: string, childKind: FragmentKind) => {
    const child = atPointer(value, binding);
    if (child !== undefined) children.push({ binding, kind: childKind, value: child });
  };
  if (record(value)) {
    if (value.type === 'hole') return children;
    if (value.type === 'logic-ref') return expressionChildren(value, 'operand');
    if (kind === 'operand' || kind === 'condition') {
      children.push(...expressionChildren(value, kind));
      const sourcePath = value.type === 'read' || value.type === 'list-count' || value.type === 'list-includes' ? '/from/sourceId'
        : ['state', 'numeric', 'raw-state', 'last-changed'].includes(String(value.type)) ? '/sourceId' : undefined;
      if (sourcePath) {
        const index = children.findIndex(child => child.binding === sourcePath);
        if (index < 0) take(sourcePath, 'source-selection');
        else children[index] = { ...children[index], kind: 'source-selection' };
      }
    } else if (kind === 'flow') take('/inputs', 'flow-inputs');
    else if (kind === 'call') {
      take('/data', 'operand');
      if (record(value.target)) Object.keys(value.target).forEach(key => take(join('', 'target', key), 'operand'));
      take('/confirmation/when', 'condition');
    } else if (kind === 'flow-inputs') {
      if (Array.isArray(value.parameters)) value.parameters.forEach((_, i) => take(join('', 'parameters', i, 'value'), 'operand'));
      take('/request', 'request');
      if (Array.isArray(value.steps)) value.steps.forEach((_, i) => take(join('', 'steps', i), 'step'));
      take('/output', 'output');
    } else if (kind === 'request') {
      if (value.type === 'none') take('/value', 'operand');
      if (value.type === 'service-response') {
        if (record(value.target)) Object.keys(value.target).forEach(key => take(join('', 'target', key), 'operand'));
        take('/data', 'operand');
      }
    } else if (kind === 'step') {
      for (const key of ['key', 'value', 'by']) {
        if (key === 'by' && Array.isArray(value.by)) value.by.forEach((_, i) => take(join('', 'by', i, 'value'), 'operand'));
        else if (record(value[key])) take(join('', key), 'operand');
      }
      take('/where', 'condition');
      if (record(value.fields)) Object.keys(value.fields).forEach(key => take(join('', 'fields', key, ...(value.op === 'annotate' ? ['value'] : [])), 'operand'));
    } else if (kind === 'output') {
      if (record(value.row)) Object.keys(value.row).forEach(key => take(join('', 'row', key), 'operand'));
    } else if (kind === 'logic-entry') take('/body', value.kind === 'condition' ? 'condition' : 'operand');
    else if (kind === 'slot') {
      if (value.type === 'expr' || value.type === 'bound-symbol') take('/value', 'operand');
      if (value.type === 'conditional' && Array.isArray(value.cases)) {
        value.cases.forEach((branch, i) => {
          take(join('', 'cases', i, 'when'), 'condition');
          if (record(branch) && Object.hasOwn(branch, 'then')) take(join('', 'cases', i, 'then'), record(branch.then) && branch.then.type === 'call-service' ? 'call' : 'slot');
        });
        if (Object.hasOwn(value, 'otherwise')) take('/otherwise', record(value.otherwise) && value.otherwise.type === 'call-service' ? 'call' : 'slot');
      }
    }
  }
  if (kind !== 'document' && kind !== 'fragment') return children;
  const scan = (candidate: GraphJSON, path: string): void => {
    if (Array.isArray(candidate)) { candidate.forEach((inner, i) => scan(inner, join(path, i))); return; }
    if (!record(candidate)) return;
    const detected = inferFragment(candidate);
    if (detected !== 'document') { children.push({ binding: path, kind: detected, value: candidate }); return; }
    for (const [key, inner] of Object.entries(candidate)) {
      if (key === 'studioCanvas' || key === 'logicUseBindings' || key === 'schema' || key === 'responseShape') continue;
      if (key === 'logicLibrary' && Array.isArray(inner)) inner.forEach((entry, i) => children.push({ binding: join(path, key, i), kind: 'logic-entry', value: entry }));
      else scan(inner, join(path, key));
    }
  };
  if (Array.isArray(value)) value.forEach((inner, i) => scan(inner, join('', i)));
  else if (record(value)) Object.entries(value).forEach(([key, inner]) => {
    if (key === 'logicLibrary' && Array.isArray(inner)) inner.forEach((entry, i) => children.push({ binding: join('', key, i), kind: 'logic-entry', value: entry }));
    else if (!['studioCanvas', 'logicUseBindings', 'schema', 'responseShape'].includes(key)) scan(inner, join('', key));
  });
  return children;
}

export function describeGrammar(value: Json, hint: FragmentKind = 'auto'): GrammarDescription {
  const kind = inferFragment(value, hint), children = grammarChildren(value, hint).map(child => ({ ...child, value: copy(child.value) }));
  const opaque = (reason: string): GrammarDescription => ({ payload: { kind: 'opaque', value, pointer: '', reason }, key: 'opaque', children: [] });
  if (hint === 'source-selection' && typeof value === 'string') {
    return identifierSchema.safeParse(value).success ? { payload: { kind: 'source-selection', value }, key: 'selection.source', children: [] } : opaque("Can't show this as blocks: invalid source ID.");
  }
  if (record(value) && value.type === 'logic-ref') {
    const parsed = logicRefSchema.safeParse(value);
    if (!parsed.success) return opaque("Can't show this as blocks: invalid template reference.");
    return { payload: { kind: 'logic-ref', value: parsed.data, representation: kind === 'condition' ? 'condition' : 'operand' }, key: `template.logic-ref.${kind === 'condition' ? 'condition' : 'operand'}`, children };
  }
  if (record(value) && value.type === 'hole') {
    const parsed = logicHoleSchema.safeParse(value);
    return parsed.success ? { payload: { kind: 'hole', value: parsed.data }, key: 'template.hole.value', children: [] } : opaque("Can't show this as blocks: invalid template setting.");
  }
  if (kind === 'operand' || kind === 'condition') {
    if (!record(value)) return opaque("Can't show this as blocks: expected an expression.");
    let skeleton = value as Json;
    for (const child of children) {
      const primitive = record(child.value) && child.value.type === 'hole' && !['/of', '/value', '/above', '/below', '/left', '/right', '/from', '/to', '/otherwise'].includes(child.binding)
        && !/^\/(args|items|cases|fields)\//.test(child.binding);
      skeleton = replaceAt(skeleton, child.binding, primitive || child.kind === 'source-selection' ? 'graph-setting' : child.kind === 'condition' ? condition : literal);
    }
    if (kind === 'operand') {
      const parsed = operandBase.safeParse(skeleton);
      if (!parsed.success) return opaque("Can't show this as blocks: unknown operand variant, option or field.");
      const operand = parsed.data;
      const variant = operand.type === 'literal' ? operand.value === null ? 'null' : typeof operand.value === 'number' ? 'number' : typeof operand.value === 'boolean' ? 'boolean' : typeof operand.value === 'string' ? 'text' : 'structured'
        : 'op' in operand ? operand.op : operand.type === 'clock' ? operand.part : 'value';
      return { payload: { kind, value: operand }, key: `operand.${operand.type}.${variant}`, children };
    }
    const parsed = predicateBase.safeParse(skeleton);
    return parsed.success ? { payload: { kind, value: parsed.data }, key: `predicate.${parsed.data.type}.${'op' in parsed.data ? parsed.data.op : 'value'}`, children } : opaque("Can't show this as blocks: unknown condition variant, option or field.");
  }
  if (kind === 'flow' && record(value)) {
    // Validate the structural envelope independently of future fragments inside it.
    const parsed = graphSourceSchema.safeParse({ ...value, inputs: { title: 'Graph', parameters: [], request: { type: 'none', value: literal }, steps: [], output: { kind: 'scalar' }, schema: { kind: 'number' } } });
    if (!parsed.success || !Object.hasOwn(value, 'inputs')) return opaque("Can't show this as blocks: invalid flow envelope.");
    return { payload: { kind, value: parsed.data }, key: 'flow', children };
  }
  if (kind === 'call' && record(value)) {
    let skeleton: Json = value;
    for (const child of children) skeleton = replaceAt(skeleton, child.binding, child.kind === 'condition' ? condition : child.binding === '/data' ? { type: 'object', fields: {} } : { type: 'literal', value: 'light.demo_graph' });
    const parsed = callServiceSchema.safeParse(skeleton);
    return parsed.success ? { payload: { kind, value: parsed.data }, key: 'call', children } : opaque("Can't show this as blocks: invalid service call.");
  }
  if (kind === 'flow-inputs' && record(value)) {
    let skeleton: Json = value;
    for (const child of children) skeleton = replaceAt(skeleton, child.binding, child.kind === 'operand' ? literal : child.kind === 'request' ? { type: 'none', value: literal } : child.kind === 'step' ? { id: record(child.value) && typeof child.value.id === 'string' ? child.value.id : 'step', op: 'first' } : { kind: 'scalar' });
    const parsed = graphInputsSchema.safeParse(skeleton);
    return parsed.success ? { payload: { kind, value: parsed.data }, key: 'flow-inputs', children } : opaque("Can't show this as blocks: invalid flow inputs.");
  }
  if (kind === 'request' && record(value)) {
    let skeleton: Json = value;
    for (const child of children) skeleton = replaceAt(skeleton, child.binding, child.binding === '/data' ? { type: 'object', fields: {} } : literal);
    const parsed = requestSchema.safeParse(skeleton);
    return parsed.success ? { payload: { kind, value: parsed.data }, key: parsed.data.type === 'ha-subscription' ? `request.ha-subscription.${parsed.data.kind}` : `request.${parsed.data.type}`, children } : opaque("Can't show this as blocks: unknown request variant or field.");
  }
  if (kind === 'step' && record(value)) {
    let skeleton: Json = value;
    for (const child of children) skeleton = replaceAt(skeleton, child.binding, child.kind === 'condition' ? condition : literal);
    const parsed = graphStepSchema.safeParse(skeleton);
    return parsed.success ? { payload: { kind, value: parsed.data }, key: `step.${parsed.data.op}`, children } : opaque("Can't show this as blocks: unknown flow step variant or field.");
  }
  if (kind === 'output' && record(value)) {
    let skeleton: Json = value;
    for (const child of children) skeleton = replaceAt(skeleton, child.binding, literal);
    const parsed = outputSchema.safeParse(skeleton);
    return parsed.success ? { payload: { kind, value: parsed.data }, key: `output.${parsed.data.kind}`, children } : opaque("Can't show this as blocks: unknown flow output variant or field.");
  }
  if (kind === 'logic-entry' && record(value)) {
    const parsed = logicEntrySchema.safeParse(value);
    if (!parsed.success) return opaque("Can't show this as blocks: invalid logic entry.");
    return { payload: { kind, value: parsed.data }, key: 'logic-entry', children };
  }
  if (kind === 'slot' && record(value)) {
    return { payload: { kind, value }, key: value.type === 'conditional' ? 'destination.look-rules' : value.type === 'bound-symbol' ? 'destination.bound-symbol' : 'destination.text', children };
  }
  if (kind !== 'document' && kind !== 'fragment') return opaque("Can't show this as blocks: unsupported fragment.");
  return { payload: { kind: 'document', value }, key: 'document', children };
}
