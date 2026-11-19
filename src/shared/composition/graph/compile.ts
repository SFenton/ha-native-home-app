import { z } from 'zod/v4';
import type { Json } from '../../types';
import { absorbCompositionExpressionCapabilities, compileCompositionDocumentWithOrigins, compositionDependencyIssues, parseCompositionShape } from '../compiler';
import { callServiceSchema, checkCallService, checkOperand, checkPredicate, operandBase, predicateBase, type ItemScope } from '../expression';
import { assertCompositionBounds, CompositionValidationError, type CompositionIssue } from '../json';
import { expandLogic, type LogicEntry, type LogicOrigin } from '../logic-library';
import { checkGraphPipeline, graphInputsSchema, graphSourceSchema } from './capabilities';
import { describeGrammar, inferFragment, type FragmentKind } from './grammar';
import { atPointer, copy, join, record, replaceAt, segments, withoutCanvasMetadata } from './json';
import type { GraphDestination } from './types';

export interface FragmentOptions {
  readonly kind?: FragmentKind;
  readonly context?: GraphDestination['context'];
  readonly itemScope?: ItemScope;
  readonly allowControl?: boolean;
  readonly library?: readonly LogicEntry[];
}
export interface FragmentCompilation {
  readonly expanded: Json;
  readonly origins: readonly LogicOrigin[];
  readonly capabilities: readonly string[];
  readonly issues: readonly CompositionIssue[];
  readonly documentIssues?: readonly CompositionIssue[];
  readonly dependencies: readonly { from: string; to: string; path: string }[];
}

/** Projection into an actual native destination, without guessing its schema or semantics. */
export function consumingDocument(context: NonNullable<GraphDestination['context']>, value: Json): Json {
  assertCompositionBounds(context.document);
  const invalid = () => { throw new CompositionValidationError([{ code: 'invalid_reference', pointer: '/destination/context/pointer' }]); };
  if (context.pointer === '') return value;
  if (!/^(?:\/(?:[^~]|~[01])*)+$/.test(context.pointer)) return invalid();
  const path = segments(context.pointer), key = path.pop()!, parent = join('', ...path);
  const owner = atPointer(context.document, parent);
  if (Array.isArray(owner)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > owner.length) return invalid();
    const items = owner.map(copy);
    items[Number(key)] = value;
    return replaceAt(copy(context.document), parent, items);
  }
  if (!record(owner)) return invalid();
  return replaceAt(copy(context.document), parent, { ...owner, [key]: value });
}

export function compileGraphValue(ast: Json, options: FragmentOptions = {}): FragmentCompilation {
  const kind = inferFragment(ast, options.kind), issues: CompositionIssue[] = [], capabilities = new Set<string>();
  const dependencies: { from: string; to: string; path: string }[] = [];
  let expanded = ast, origins: readonly LogicOrigin[] = [];
  let documentIssues: readonly CompositionIssue[] | undefined, checking = false;
  const contextPrefix = options.context ? `/document${options.context.pointer}` : undefined;
  try {
    if (kind === 'document' || options.context) {
      const input = options.context ? consumingDocument(options.context, ast) : ast;
      const { compiled, origins: nativeOrigins } = compileCompositionDocumentWithOrigins(withoutCanvasMetadata(input));
      compiled.capabilities.forEach(capability => capabilities.add(capability));
      if (kind === 'document' && !options.context) {
        expanded = compiled.expanded;
        origins = nativeOrigins;
      }
    } else {
      assertCompositionBounds(ast);
      const expansion = expandLogic(kind === 'fragment' ? ast : { logicLibrary: options.library ?? [], value: ast });
      const result = parseCompositionShape(z.json(), expansion.document);
      if (kind === 'fragment') {
        expanded = result;
        origins = expansion.origins;
      } else {
        if (!record(result)) throw new Error('Logic expansion did not return an object.');
        expanded = result.value;
        origins = expansion.origins.map(origin => ({ ...origin, pointer: origin.pointer.replace(/^\/value(?=\/|$)/, '') }));
      }
      const check = (value: Json, hint: FragmentKind, at = ''): void => {
        const found = inferFragment(value, hint);
        const parse = <T>(schema: z.ZodType<T>): T => {
          try { return parseCompositionShape(schema, value); }
          catch (error) {
            if (!(error instanceof CompositionValidationError)) throw error;
            throw new CompositionValidationError(error.issues.map(issue => ({ ...issue, pointer: at + issue.pointer })));
          }
        };
        if (found === 'operand' || found === 'condition' || found === 'call') {
          const facts = found === 'operand'
            ? checkOperand(parse(operandBase), at, options.allowControl, false, options.itemScope)
            : found === 'condition'
              ? checkPredicate(parse(predicateBase), at, false, options.itemScope)
              : checkCallService(parse(callServiceSchema), at, options.allowControl ?? false, options.itemScope);
          issues.push(...facts.issues);
          absorbCompositionExpressionCapabilities(facts, capabilities, found === 'call' ? 'call' : 'expression');
        } else if (found === 'flow' || found === 'flow-inputs') {
          const source = found === 'flow' ? parse(graphSourceSchema)
            : { id: 'graph-flow', kind: 'model' as const, model: 'pipeline@1' as const, inputs: parse(graphInputsSchema) };
          const facts = checkGraphPipeline(source, at);
          issues.push(...facts.issues); dependencies.push(...facts.dependencies);
          facts.capabilities.forEach(capability => capabilities.add(capability));
        } else if (found === 'slot') {
          issues.push({ code: 'missing_required', pointer: `${at}/destination/context` });
        } else {
          for (const child of describeGrammar(value, found).children) check(child.value, child.kind, at + child.binding);
        }
      };
      checking = true;
      check(expanded, kind);
      issues.push(...compositionDependencyIssues(dependencies));
    }
  } catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    if (kind === 'document' || options.context) documentIssues = error.issues;
    issues.push(...error.issues.map(issue => ({
      ...issue,
      pointer: contextPrefix ? issue.pointer === contextPrefix || issue.pointer.startsWith(`${contextPrefix}/`) ? issue.pointer.slice(contextPrefix.length) : issue.pointer.replace(/^\/document(?=\/|$)/, '')
        : kind === 'document' ? issue.pointer.replace(/^\/document(?=\/|$)/, '')
          : kind === 'fragment' || checking ? issue.pointer : issue.pointer.replace(/^\/value(?=\/|$)/, ''),
    })));
  }
  return { expanded, origins, issues, documentIssues, dependencies, capabilities: [...capabilities].sort() };
}
