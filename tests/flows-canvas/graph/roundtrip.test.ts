import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../../../src/shared/composition/compiler';
import { evaluateOperand, evaluatePredicate, type Environment } from '../../../src/shared/composition/evaluator';
import { operandBase, predicateBase, type Operand, type Predicate } from '../../../src/shared/composition/expression';
import { canonicalCompositionJSON, CompositionValidationError, parseCompositionJSON } from '../../../src/shared/composition/json';
import { decodeCompositionPublication } from '../../../server/composition';
import { expandLogic, type LogicEntry } from '../../../src/shared/composition/logic-library';
import { autoLayout, lift, liftJSON, lower, measureBudget, portType, projectGraph, semanticFingerprint, type LogicGraph } from '../../../src/shared/composition/graph';
import type { Json } from '../../../src/shared/types';
import { exampleA, exampleB, immutable, predicateBudgetFixtures, sourceParameterTemplate, tooWarmWarning } from './fixtures';
import { expressionChildren } from '../../../src/shared/composition/graph/grammar';
import { atPointer, record, replaceAt } from '../../../src/shared/composition/graph/json';
import { checkPipelineSource } from '../../../src/shared/composition/pipeline/compile';
import { pipelineSourceSchema } from '../../../src/shared/composition/pipeline/schema';

const clone = (value: unknown): Json => JSON.parse(JSON.stringify(value));
function roundtrip(value: Json, kind?: 'operand' | 'condition' | 'flow' | 'document' | 'fragment', scope?: NonNullable<Parameters<typeof lift>[1]>['scope']) {
  const before = canonicalCompositionJSON(value);
  const lifted = lift(value, { kind, scope });
  const result = lower(lifted.graph);
  expect(result.ok, JSON.stringify(result.ok ? [] : result.errors.slice(0, 5).map(({ code, pointer, message }) => ({ code, pointer, message })))).toBe(true);
  if (!result.ok) throw new Error('Round trip refused.');
  expect(canonicalCompositionJSON(result.ast)).toBe(before);
  expect(canonicalCompositionJSON(value)).toBe(before);
  expect(autoLayout(lifted.graph)).toEqual(lifted.graph);
  expect(lift(value, { kind, scope }).graph).toEqual(lifted.graph);
  const pointers: string[] = [];
  const collect = (candidate: Json, at: string) => {
    pointers.push(at);
    if (candidate !== null && typeof candidate === 'object') Object.entries(candidate).forEach(([key, inner]) => collect(inner, `${at}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`));
  };
  collect(value, '');
  expect(result.sourceMap.filter(entry => entry.stage !== 'expanded').map(entry => entry.pointer).sort()).toEqual(pointers.sort());
  return result;
}

describe('G-roundtrip worked examples, templates and opaque buffers', () => {
  const duplicate: LogicEntry = {
    id: 'duplicate', name: 'Duplicate', kind: 'operand', params: [{ name: 'value', kind: 'operand' }],
    body: { type: 'math', op: 'add', args: Array.from({ length: 8 }, () => ({ type: 'hole', name: 'value' })) },
  };
  it('maps an over-budget duplicated argument to its responsible block and use', () => {
    const ast: Json = { type: 'logic-ref', logicId: 'duplicate', args: { value: { type: 'math', op: 'add', args: Array.from({ length: 8 }, () => ({ type: 'literal', value: 1 })) } } };
    const graph = lift(ast, { kind: 'operand' }).graph;
    const argument = graph.nodes.find(node => node.origins[0] === '/args/value')!;
    const result = lower(graph, { library: [duplicate] });
    expect(result).toMatchObject({
      ok: false, errors: expect.arrayContaining([expect.objectContaining({
        code: 'limit_exceeded', pointer: '/args/7', nodeId: argument.id, portId: 'value', usePointer: '', authoredPointer: '/args/value',
      })]),
    });
  });
  it('retains separate per-use source locations for every duplicated argument landing', () => {
    const use = (value: number): Json => ({ type: 'logic-ref', logicId: 'duplicate', args: { value: { type: 'literal', value } } });
    const ast: Json = { logicLibrary: [duplicate], first: use(1), second: use(2) };
    const graph = lift(ast, { kind: 'fragment' }).graph, result = lower(graph);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected valid template uses.');
    const copies = result.sourceMap.filter(location => location.stage === 'expanded' && /^\/(first|second)\/args\/\d$/.test(location.pointer));
    expect(copies).toHaveLength(16);
    for (const name of ['first', 'second']) {
      const argument = graph.nodes.find(node => node.origins[0] === `/${name}/args/value`)!;
      expect(copies.filter(location => location.usePointer === `/${name}`)).toHaveLength(8);
      for (let i = 0; i < 8; i++) expect(copies).toContainEqual(expect.objectContaining({
        pointer: `/${name}/args/${i}`, nodeId: argument.id, authoredPointer: `/${name}/args/value`, usePointer: `/${name}`,
      }));
    }
  });
  it('retains A and B including refs, flow prefixes, format options and missing properties', () => {
    roundtrip(clone(exampleA), 'fragment');
    roundtrip(clone(exampleB), 'fragment');
    roundtrip(clone({ logicLibrary: [sourceParameterTemplate], output: { type: 'logic-ref', logicId: 'is-on', args: { source: 'light-a' } } }), 'fragment');
  });
  it('has exact example costs and uses the existing evaluator', () => {
    const result = roundtrip(clone(tooWarmWarning), 'condition');
    expect(result.budgets[0]).toMatchObject({ nodes: null, depth: null, accepted: true });
    const reads: Record<string, Json> = { 'living-temperature': 23.6, 'bedroom-temperature': 21.9, thermostat: 22, window: 'off' };
    const env: Environment = { read: id => Object.hasOwn(reads, id) ? { status: 'value', value: reads[id] } : { status: 'unavailable' } };
    const condition = predicateBase.parse(result.ast);
    expect(evaluatePredicate(condition, env)).toBe('no');
    reads['bedroom-temperature'] = 25;
    expect(evaluatePredicate(condition, env)).toBe('yes');
    reads.window = 'on';
    expect(evaluatePredicate(condition, env)).toBe('no');
    delete reads['bedroom-temperature']; reads.window = 'off';
    expect(evaluatePredicate(condition, env)).toBe('unknown');
  });
  it('preserves future fragments exactly while allowing compatible buffer surroundings to change', () => {
    const future = { type: 'future', option: { unknown: [1, null] } };
    const ast = { type: 'math', op: 'add', args: [future, { type: 'literal', value: 2 }] };
    const lifted = lift(ast, { kind: 'operand' });
    expect(lifted.opaqueRegions).toHaveLength(1);
    expect(lifted.opaqueRegions[0]).toMatchObject({ pointer: '/args/0', original: future });
    const literal = lifted.graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal')!;
    const graph: LogicGraph = {
      ...lifted.graph, nodes: lifted.graph.nodes.map(node => node.id === literal.id ? { ...node, provenance: 'authored', payload: { kind: 'operand', value: { type: 'literal', value: 3 } } } : node),
    };
    expect(projectGraph(graph).ast).toEqual({ ...ast, args: [future, { type: 'literal', value: 3 }] });
    expect(lower(graph)).toMatchObject({ ok: false, original: ast });
    expect(lift({ type: 'math', op: 'future', args: [], extra: true }, { kind: 'operand' }).opaqueRegions[0].pointer).toBe('');
  });
  it('treats malformed layout as a warning, not semantic behavior', () => {
    const plain = lift(clone(tooWarmWarning), { kind: 'condition' });
    const bad = lift(clone(tooWarmWarning), { kind: 'condition', metadata: { version: 400, canvases: [] } });
    expect(bad.graph).toEqual(plain.graph);
    expect(bad.warnings[0]).toMatchObject({ code: 'invalid_layout' });
    expect(lower(bad.graph).ok).toBe(true);
  });
  it('retains root layout losslessly while semantic fingerprints ignore only that root field', () => {
    const plain = { output: { type: 'literal', value: { studioCanvas: { keep: true } } } };
    const withLayout = { ...plain, studioCanvas: { version: 400, invalid: 'retain' } };
    const graph = lift(withLayout, { kind: 'document' });
    expect(graph.warnings[0]).toMatchObject({ code: 'invalid_layout' });
    expect(projectGraph(graph.graph).ast).toEqual(withLayout);
    expect(semanticFingerprint(graph.graph)).toBe(semanticFingerprint(lift(plain, { kind: 'document' }).graph));
    expect(semanticFingerprint(graph.graph)).toContain('"keep":true');
  });
  it('uses the bounded parser before duplicate or reserved keys can be hidden', () => {
    expect(() => liftJSON(new TextEncoder().encode('{"type":"literal","value":1,"value":2}'))).toThrow();
    expect(() => liftJSON(new TextEncoder().encode('{"type":"literal","value":{"__proto__":1}}'))).toThrow();
  });
  it('keeps stable saved positions and warns instead of retargeting reordered entries', () => {
    const anchor = { kind: 'logic' as const, id: 'list', field: '/body' };
    const ast: Operand = { type: 'list', items: [{ type: 'literal', value: 1 }, { type: 'literal', value: 2 }] };
    const initial = lift(ast, { kind: 'operand', anchor });
    const saved = initial.graph.nodes.map((node, i) => ({ id: node.id, origins: node.origins, x: i * 500, y: 1200 }));
    const metadata = { version: 1, canvases: [{ id: 'list', roots: [anchor], nodes: saved }] };
    expect(lift(ast, { kind: 'operand', anchor, metadata }).graph.nodes.map(node => node.position)).toEqual(saved.map(({ x, y }) => ({ x, y })));
    const changed = lift({ ...ast, items: [...ast.items].reverse() }, { kind: 'operand', anchor, metadata });
    expect(changed.warnings.some(warning => warning.code === 'invalid_layout')).toBe(true);
    expect(changed.graph.nodes.every(node => node.position?.y !== 1200)).toBe(true);
  });
  it('can reopen its own root layout without changing the saved anchor or node identities', () => {
    const ast = { output: { type: 'literal', value: 1 } }, initial = lift(ast, { kind: 'document' }).graph;
    const saved = initial.nodes.map((node, i) => ({ id: node.id, origins: [...node.origins], x: i * 500, y: 1200 }));
    const reopened = lift({ ...ast, studioCanvas: { version: 1, canvases: [{ id: 'saved', roots: initial.roots.map(root => root.anchor), nodes: saved }] } }, { kind: 'document' });
    expect(reopened.warnings).toEqual([]);
    expect(reopened.graph.nodes.map(node => node.position)).toEqual(saved.map(({ x, y }) => ({ x, y })));
    const positioned = lift(clone(exampleB), { kind: 'document' }).graph.nodes.map(node => `${node.position?.x}:${node.position?.y}`);
    expect(new Set(positioned).size).toBe(positioned.length);
  });
  it('returns separately typed atomic replacements and budgets for multiple roots', () => {
    const graph = lift({ type: 'list', items: [{ type: 'literal', value: 1 }, { type: 'literal', value: 'ready' }] }, { kind: 'operand' }).graph;
    const roots = graph.nodes.filter(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal');
    const result = lower({
      ...graph,
      roots: roots.map((node, i) => ({
        nodeId: node.id, portId: 'value',
        anchor: { kind: 'logic', id: `out-${i}`, field: '/body' },
        destination: { kind: 'operand', type: portType(i ? { kind: 'string' } : { kind: 'number' }) },
      })),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replacements).toHaveLength(2);
      expect(result.budgets.map(budget => budget.accepted)).toEqual([true, true]);
    }
  });
});

describe('G-roundtrip deterministic bounded grammar properties', () => {
  let state = 0x5eed;
  const next = (max: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
  const operations = ['add', 'subtract', 'multiply', 'divide'] as const;
  const number = (depth: number): Operand => depth <= 1 || next(3) === 0 ? { type: 'literal', value: next(200) - 100 }
    : { type: 'math', op: operations[next(4)], args: [number(depth - 1), number(depth - 1)] };
  const predicate = (depth: number): Predicate => depth <= 1 || next(3) === 0 ? { type: 'compare', op: 'above', left: number(2), right: number(2) }
    : next(2) ? { type: 'not', of: predicate(depth - 1) } : { type: next(2) ? 'all' : 'any', of: [predicate(depth - 1), predicate(depth - 1)] };
  const env: Environment = { read: () => ({ status: 'unavailable' }) };
  it.each(Array.from({ length: 300 }, (_, i) => i))('round-trips bounded arithmetic/rules with evaluator equivalence, seed case %i', index => {
      state = 0x5eed ^ index;
      const ast: Operand = index % 3 ? number(4) : { type: 'choose', cases: [{ when: predicate(2), then: number(2) }], otherwise: number(2) };
      const check = (candidate: Operand) => {
        const result = roundtrip(clone(immutable(candidate)), 'operand');
        expect(evaluateOperand(operandBase.parse(result.ast), env)).toEqual(evaluateOperand(candidate, env));
      };
      try { check(ast); }
      catch (cause) {
        let minimal = ast, reduced = true;
        while (reduced) {
          reduced = false;
          for (const child of expressionChildren(minimal, 'operand')) {
            const parsed = operandBase.safeParse(child.value);
            if (!parsed.success) continue;
            try { check(parsed.data); }
            catch { minimal = parsed.data; reduced = true; break; }
          }
        }
        throw new Error(`Property seed 0x5eed, case ${index}, shrunk operand ${canonicalCompositionJSON(minimal)}`, { cause });
      }
  });
  it.each(Array.from({ length: 80 }, (_, i) => i))('round-trips nullable flow operands and nested refs/holes, seed case %i', index => {
      state = 0x5eed ^ index;
      const values: Json[] = Array.from({ length: next(8) }, () => next(3) ? next(100) : null);
      roundtrip({
        id: `flow-${index}`, kind: 'model', model: 'pipeline@1',
        inputs: {
          title: 'Nullable values', parameters: [],
          request: { type: 'none', value: { type: 'literal', value: values } },
          steps: [{ id: 'reduce', op: index % 2 ? 'sum' : 'min', value: { type: 'item', path: [] } }],
          output: { kind: 'scalar' }, schema: { kind: 'number' },
          ...(index % 2 ? { clock: { zone: 'home' } } : {}),
        },
      }, 'flow');
      roundtrip({
        logicLibrary: [
          { id: 'base', name: 'Base', kind: 'operand', params: [{ name: 'input', kind: 'operand', sample: { type: 'literal', value: index } }], body: { type: 'math', op: 'add', args: [{ type: 'hole', name: 'input' }, { type: 'literal', value: 1 }] } },
          { id: 'nested', name: 'Nested', kind: 'operand', params: [{ name: 'input', kind: 'operand' }], body: { type: 'logic-ref', logicId: 'base', args: { input: { type: 'hole', name: 'input' } } } },
        ],
        result: { type: 'logic-ref', logicId: 'nested', args: { input: { type: 'literal', value: index } } },
      }, 'fragment');
  });
});

describe('G-roundtrip shared contract corpus', () => {
  const directory = path.resolve(__dirname, '../../../contract/corpus');
  const read = (file: string): Json => JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
  const index: { cases: { file: string; outcome: string; pending?: boolean; studioIssue?: unknown }[] } = JSON.parse(readFileSync(path.join(directory, 'index.json'), 'utf8'));
  const cases = index.cases.filter(entry => entry.outcome === 'accept' || entry.pending && !entry.studioIssue);
  it.each(index.cases.filter(entry => entry.outcome === 'reject' && (!entry.pending || entry.studioIssue)))('retains the compiler rejection boundary for $file', entry => {
    const bytes = readFileSync(path.join(directory, entry.file));
    let envelope: unknown;
    try { envelope = parseCompositionJSON(bytes); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      try { liftJSON(bytes); throw new Error('Rejected bytes were accepted.'); }
      catch (actual) {
        if (!(actual instanceof CompositionValidationError)) throw actual;
        expect(actual.issues[0]).toEqual(error.issues[0]);
      }
      return;
    }
    if (!record(envelope)) throw new Error('Expected publication envelope.');
    let native: CompositionValidationError | undefined;
    try { compileCompositionDocument(envelope.document); }
    catch (error) { if (!(error instanceof CompositionValidationError)) throw error; native = error; }
    if (!native) {
      // Envelope versions, manifests and capability declarations are publication checks, not document grammar.
      expect(() => decodeCompositionPublication(bytes)).toThrow(CompositionValidationError);
      return;
    }
    const document = envelope.document, result = lower(lift(document, { kind: 'document' }).graph);
    const expected = { ...native.issues[0], pointer: native.issues[0].pointer.replace(/^\/document(?=\/|$)/, '') };
    expect(result.ok, entry.file).toBe(false);
    if (result.ok) throw new Error('Rejected document was accepted.');
    expect(result.errors[0]).toMatchObject(expected);
    const budget = measureBudget(document, { kind: 'document', id: 'document', field: '', fingerprint: '' }, { kind: 'document' });
    expect(budget.accepted).toBe(false);
    expect(budget.compilerIssues[0]).toEqual(expected);
  });
  it('cannot bypass document validation by removing a required discriminator', () => {
    const envelope = read('accept/tile-look-all.json');
    if (!record(envelope) || !record(envelope.document)) throw new Error('Expected document.');
    const { schemaVersion: _version, ...document } = envelope.document;
    const result = lower(lift(document, { kind: 'document' }).graph);
    expect(result).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'missing_required', pointer: '/schemaVersion' })]) });
    expect(measureBudget(document, { kind: 'document', id: 'document', field: '', fingerprint: '' }, { kind: 'document' })).toMatchObject({
      accepted: false, compilerIssues: expect.arrayContaining([expect.objectContaining({ code: 'missing_required', pointer: '/schemaVersion' })]),
    });
    expect(lower(lift({ output: { type: 'literal', value: 1 } }, { kind: 'fragment' }).graph).ok).toBe(true);
    expect(lower(lift({ output: { type: 'literal', value: 1 } }, { kind: 'document' }).graph).ok).toBe(false);
  });
  it.each([[128, true], [129, false]] as const)('uses the document compiler for %i flow sources, accepted=%s', (count, accepted) => {
    const envelope = read('accept/tile-look-all.json');
    if (!record(envelope) || !record(envelope.document) || !Array.isArray(envelope.document.dataSources)) throw new Error('Expected document sources.');
    const document = {
      ...envelope.document, dataSources: [...envelope.document.dataSources, ...Array.from({ length: count }, (_, i) => ({
        id: `counter-${i}`, kind: 'model', model: 'pipeline@1',
        inputs: { title: 'Counter', parameters: [], request: { type: 'none', value: { type: 'literal', value: [] } }, steps: [{ id: 'count', op: 'count' }], output: { kind: 'scalar' }, schema: { kind: 'number' } },
      }))],
    };
    const budget = measureBudget(document, { kind: 'document', id: 'document', field: '', fingerprint: '' }, { kind: 'document' });
    expect(budget.accepted).toBe(accepted);
    expect(budget.nodes).toBeNull();
    if (!accepted) expect(budget.firstExceedingPointer).toBe('/dataSources/133');
  });
  it.each(['visibleWhen', 'activeWhen', 'filledWhen', 'errorWhen', 'conditional-look'] as const)('meter matches compiler nested-Choose behavior in %s', field => {
    for (const name of ['base', 'early'] as const) {
      const envelope = read(field === 'conditional-look' ? 'accept/rules-conditional-look.json' : 'accept/tile-look-all.json');
      if (!record(envelope)) throw new Error('Expected envelope.');
      const ast = clone(predicateBudgetFixtures[name]), document = envelope.document, nodePath = '/pages/2/components/0';
      const node = atPointer(document, nodePath);
      if (!record(node)) throw new Error('Expected component.');
      const edited = field === 'conditional-look' ? replaceAt(document, `${nodePath}/props/states/0/appearance/fill/cases/0/when`, ast)
        : replaceAt(document, nodePath, { ...node, [field]: ast });
      let native: CompositionValidationError | undefined;
      try { compileCompositionDocument(edited); }
      catch (error) { if (!(error instanceof CompositionValidationError)) throw error; native = error; }
      const result = lower(lift(edited, { kind: 'document' }).graph);
      expect(result.ok).toBe(name === 'base');
      expect(native === undefined).toBe(name === 'base');
      const first = native?.issues.find(issue => issue.code === 'limit_exceeded')?.pointer.replace(/^\/document(?=\/|$)/, '');
      expect(result.budgets[0].firstExceedingPointer).toBe(first);
      expect(result.budgets[0].accepted).toBe(name === 'base');
      expect(result.budgets[0].compilerIssues).toEqual(native?.issues.map(issue => ({ ...issue, pointer: issue.pointer.replace(/^\/document(?=\/|$)/, '') })) ?? []);
      if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ code: 'limit_exceeded', pointer: first }));
    }
  });
  it('ignores malformed root layout for native validation but preserves it in the authored replacement', () => {
    const envelope = read(cases[0].file);
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Expected envelope.');
    const document = envelope.document;
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Expected document.');
    const withLayout = { ...document, studioCanvas: { version: 400, invalid: 'retain' } };
    expect(lift(withLayout, { kind: 'document' }).warnings).toContainEqual(expect.objectContaining({ code: 'invalid_layout' }));
    roundtrip(withLayout, 'document');
  });
  it.each(cases)('preserves $file', entry => {
    const envelope = read(entry.file);
    if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Expected publication envelope.');
    const document = envelope.document;
    const graph = lift(document, { kind: 'document' });
    const result = lower(graph.graph, { targetCapabilities: compileCompositionDocument(document).capabilities });
    expect(result.ok, `${entry.file}: ${JSON.stringify(result.ok ? [] : result.errors.slice(0, 3).map(({ code, pointer }) => ({ code, pointer })))}`).toBe(true);
    if (result.ok) expect(canonicalCompositionJSON(result.ast)).toBe(canonicalCompositionJSON(document));
  });
  it.each(readdirSync(path.join(directory, 'pipelines')).filter(name => name.endsWith('.json')))('preserves pipeline evaluation input %s independently of compiles:false acceptance', file => {
      const entry = read(`pipelines/${file}`);
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Expected pipeline case.');
      const source: Json = { id: 'case', kind: 'model', model: 'pipeline@1', inputs: entry.inputs };
      const graph = lift(source, { kind: 'flow' });
      expect(projectGraph(graph.graph).ast, file).toEqual(source);
      if (entry.compiles === true) {
        const result = lower(graph.graph, { targetCapabilities: checkPipelineSource(pipelineSourceSchema.parse(source), '').capabilities });
        expect(result.ok, `${file}: ${JSON.stringify(result.ok ? [] : result.errors.map(({ code, pointer }) => ({ code, pointer })))}`).toBe(true);
      }
  });
  it.each(readdirSync(path.join(directory, 'evaluation')).filter(name => name.endsWith('.json')))('retains evaluation subject %s without declaring rejected inputs accepted', file => {
      const entry = read(`evaluation/${file}`);
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Expected evaluation case.');
      const graph = lift(entry.subject, { kind: 'document' });
      expect(projectGraph(graph.graph).ast, file).toEqual(entry.subject);
  });
});
