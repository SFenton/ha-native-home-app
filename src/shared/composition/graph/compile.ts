import { z } from 'zod/v4';
import type { Json } from '../../types';
import { absorbCompositionExpressionCapabilities, checkCompositionPipelineSource, compileCompositionDocumentWithOrigins, compositionCallShape, CompositionExpansionError, compositionDependencyIssues, parseCompositionShape } from '../compiler';
import { checkCallService, checkOperand, checkPredicate, operandBase, predicateBase, type BudgetAccountingEvent, type ItemScope } from '../expression';
import { assertCompositionBounds, CompositionValidationError, type CompositionIssue } from '../json';
import { expandBounded, type LogicEntry, type LogicOrigin } from '../logic-library';
import { graphInputsSchema, graphSourceSchema } from './capabilities';
import { grammarChildren, inferFragment, type FragmentKind } from './grammar';
import { atPointer, copy, join, record, replaceAt, segments, withoutCanvasMetadata } from './json';
import type { GraphDestination, GraphJSON } from './types';

export interface FragmentOptions {
  readonly kind?: FragmentKind;
  readonly context?: GraphDestination['context'];
  readonly itemScope?: ItemScope;
  readonly allowControl?: boolean;
  readonly sourceId?: string;
  readonly library?: readonly LogicEntry[];
}
export interface FragmentCompilation {
  /** Absent until the native entry point forwards the observer; never recovered by replaying a checker. */
  readonly accounting?: readonly BudgetAccountingEvent[];
  readonly expanded: Json;
  readonly origins: readonly LogicOrigin[];
  readonly capabilities: readonly string[];
  readonly issues: readonly CompositionIssue[];
  readonly documentIssues?: readonly CompositionIssue[];
  readonly expandedIssues?: readonly CompositionIssue[];
  readonly expandedDocumentIssues?: readonly CompositionIssue[];
  readonly dependencies: readonly { from: string; to: string; path: string }[];
}

export function contextualCompilation(compiled: FragmentCompilation, at: string, fallback: Json): FragmentCompilation {
  const relative = (issue: CompositionIssue): CompositionIssue => ({
    ...issue, pointer: issue.pointer === at || issue.pointer.startsWith(`${at}/`) ? issue.pointer.slice(at.length) : issue.pointer,
  });
  return {
    ...compiled,
    expanded: atPointer(compiled.expanded, at) === undefined ? fallback : copy(atPointer(compiled.expanded, at)!),
    origins: compiled.origins.filter(origin => origin.pointer === at || origin.pointer.startsWith(`${at}/`))
      .map(origin => ({ ...origin, pointer: origin.pointer.slice(at.length) })),
    issues: compiled.issues.map(relative),
    expandedIssues: compiled.expandedIssues?.map(relative),
  };
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
  if (options.context) {
    try { return contextualCompilation(compileGraphValue(consumingDocument(options.context, ast), { kind: 'document' }), options.context.pointer, ast); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      return { expanded: ast, origins: [], issues: error.issues, capabilities: [], dependencies: [] };
    }
  }
  const kind = inferFragment(ast, options.kind), issues: CompositionIssue[] = [], capabilities = new Set<string>();
  const dependencies: { from: string; to: string; path: string }[] = [];
  let expanded = ast, origins: readonly LogicOrigin[] = [];
  let documentIssues: readonly CompositionIssue[] | undefined, expandedDocumentIssues: readonly CompositionIssue[] | undefined, checking = false;
  try {
    if (kind === 'document') {
      const { compiled, origins: nativeOrigins } = compileCompositionDocumentWithOrigins(withoutCanvasMetadata(ast));
      compiled.capabilities.forEach(capability => capabilities.add(capability));
      expanded = compiled.expanded;
      origins = nativeOrigins;
    } else {
      assertCompositionBounds(ast);
      if (options.library) assertCompositionBounds(options.library);
      const input = kind === 'fragment' ? ast : options.library?.length ? { logicLibrary: options.library, value: ast } : { value: ast };
      const expansion = expandBounded(input);
      const result = expansion.document === input ? kind === 'fragment' ? ast : { value: ast } : parseCompositionShape(z.json(), expansion.document);
      if (kind === 'fragment') {
        expanded = result;
        origins = expansion.origins;
      } else {
        if (!record(result)) throw new Error('Logic expansion did not return an object.');
        expanded = result.value;
        origins = expansion.origins.map(origin => ({ ...origin, pointer: origin.pointer.replace(/^\/value(?=\/|$)/, '') }));
      }
      let pipelines = 0;
      const check = (value: GraphJSON, hint: FragmentKind, at = ''): void => {
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
              : checkCallService(parse(compositionCallShape), at, options.allowControl ?? false, options.itemScope);
          issues.push(...facts.issues);
          absorbCompositionExpressionCapabilities(facts, capabilities, found === 'call' ? 'call' : 'expression');
        } else if (found === 'flow' || found === 'flow-inputs') {
          const source = found === 'flow' ? parse(graphSourceSchema)
            : { id: options.sourceId ?? '', kind: 'model' as const, model: 'pipeline@1' as const, inputs: parse(graphInputsSchema) };
          const facts = checkCompositionPipelineSource(source, at, ++pipelines);
          const rebase = (path: string) => found === 'flow-inputs' && (path === `${at}/inputs` || path.startsWith(`${at}/inputs/`))
            ? at + path.slice(`${at}/inputs`.length) : path;
          issues.push(...facts.issues.map(issue => ({ ...issue, pointer: rebase(issue.pointer) })));
          // Inputs without an owner have no source identity to close dependencies against.
          if (found === 'flow' || options.sourceId !== undefined) dependencies.push(...facts.dependencies.map(dependency => ({ ...dependency, path: rebase(dependency.path) })));
          facts.capabilities.forEach(capability => capabilities.add(capability));
        } else if (found === 'slot') {
          issues.push({ code: 'missing_required', pointer: `${at}/destination/context` });
        } else {
          for (const child of grammarChildren(value, found)) check(child.value, child.kind, at + child.binding);
        }
      };
      checking = true;
      check(expanded, kind);
      issues.push(...compositionDependencyIssues(dependencies));
    }
  } catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    if (kind === 'document') documentIssues = error.issues;
    if (error instanceof CompositionExpansionError) {
      expanded = parseCompositionShape(z.json(), error.expanded);
      origins = error.origins;
      expandedDocumentIssues = error.expandedIssues;
    }
    issues.push(...error.issues.map(issue => ({
      ...issue,
      pointer: kind === 'document' ? issue.pointer.replace(/^\/document(?=\/|$)/, '')
          : kind === 'fragment' || checking ? issue.pointer : issue.pointer.replace(/^\/value(?=\/|$)/, ''),
    })));
  }
  return {
    expanded, origins, issues: kind !== 'document' && issues.length ? new CompositionValidationError(issues).issues : issues, documentIssues, expandedDocumentIssues, dependencies, capabilities: [...capabilities].sort(),
    expandedIssues: expandedDocumentIssues?.map(issue => ({ ...issue, pointer: issue.pointer.replace(/^\/document(?=\/|$)/, '') })),
  };
}
