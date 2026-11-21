// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { compileCompositionDocument, type CompiledComposition } from '../src/shared/composition/compiler';
import { evaluateOperand, evaluatePredicate, resolveText, ruleHolds } from '../src/shared/composition/evaluator';
import { record, segments } from '../src/shared/composition/graph/json';
import { lift } from '../src/shared/composition/graph/lift';
import { CompositionValidationError } from '../src/shared/composition/json';
import { evaluatePipeline } from '../src/shared/composition/pipeline/evaluate';
import { entityRows } from '../src/shared/composition/pipeline/sources';
import { compositionChildren, type CompositionDocument, type CompositionNode } from '../src/shared/composition/schema';
import { previewTile } from '../src/shared/composition/state-style-preview';
import { resolveTileStyle } from '../src/shared/composition/state-styles';
import type { NativeState } from '../src/shared/native-state';
import type { Json } from '../src/shared/types';
import { TodoSections, todoSource } from '../src/preview2/nodes/panels/todo-sections';
import { createEnvironment, emptyOverlay, houseFrom } from '../src/preview2/projections';
import { RenderCtx, type RenderContext } from '../src/preview2/render-context';
import { createSelectionStore } from '../src/preview2/selection-store';
import { runSimulation } from '../src/workspace2/logic-simulation/engine';
import { createSimulationProgram, flowFingerprint } from '../src/workspace2/logic-simulation/program';

const clock = { now: '2026-11-16T12:00:00', utcOffsetMinutes: -480 };
const capturedAt = '2026-11-16T20:00:00Z';
const todoItem = z.strictObject({
  uid: z.string(), summary: z.string(), status: z.enum(['needs_action', 'completed']), due: z.string().optional(),
});
const entityInput = z.strictObject({
  state: z.string(),
  attributes: z.record(z.string(), z.json()).optional(),
  todoList: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('ready'), items: z.array(todoItem) }),
    z.strictObject({ status: z.enum(['unavailable', 'error']), message: z.string() }),
  ]).optional(),
});
const starterSchema = z.strictObject({
  id: z.string(), title: z.string().min(1), purpose: z.string().min(1), where: z.string().min(1),
  construct: z.enum(['binding', 'operand', 'flow', 'template', 'visibility']),
  entities: z.array(z.strictObject({ id: z.string(), provenance: z.literal('synthetic-demo'), replaceWith: z.string().min(1) })).min(1),
  capabilities: z.array(z.string()),
  changes: z.array(z.strictObject({ op: z.enum(['add', 'replace']), pointer: z.string().startsWith('/'), value: z.json() })).min(1),
  simulation: z.array(z.strictObject({
    name: z.string().min(1),
    inputs: z.strictObject({
      entities: z.record(z.string(), entityInput),
      response: z.json().optional(), requestError: z.string().optional(), previousText: z.string().optional(),
    }),
    expect: z.json(),
  })).min(1),
  notes: z.array(z.string()).min(1),
});
type Starter = z.infer<typeof starterSchema>;
type Inputs = Starter['simulation'][number]['inputs'];
const directory = path.resolve(__dirname, '../scripts/examples/starters');
const files = readdirSync(directory).filter(file => /^\d+-.*\.json$/.test(file)).sort();
const starters = files.map(file => starterSchema.parse(JSON.parse(readFileSync(path.join(directory, file), 'utf8'))));
const json = (input: unknown): Json => z.json().parse(input);

function fixture(starter: Starter): CompositionDocument {
  const file = starter.id === 'bedroom-volume' ? 'remote-composition.json'
    : starter.id === 'selected-lights-on' ? 'home-primitives.json' : 'composition-first-slice.json';
  const envelope = z.object({ document: z.json() }).parse(JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures', file), 'utf8')));
  const document = structuredClone(compileCompositionDocument(envelope.document).document);
  const detailTitle: Record<string, string> = {
    'predictive-pc-heat': 'Predictive Comfort', 'effective-away': 'Whole Home', 'past-due-tasks': 'Chores',
  };
  if (detailTitle[starter.id]) document.pages[2].title = detailTitle[starter.id];
  if (starter.id === 'office-pc' || starter.id === 'office-windows') document.pages[0].title = 'Office';
  if (starter.id === 'bedroom-volume') document.pages[0].title = 'Bedroom 1';
  if (starter.id === 'office-windows') {
    const grid = document.pages[0].components[0];
    if (grid.type !== 'tile-grid') throw new Error('Expected fixture tile grid');
    grid.children.push({
      id: 'office-windows-tile', title: 'Office Windows', type: 'state-tile', layout: { span: 1 },
      icon: { type: 'sf-symbol', name: 'window.horizontal', rendering: 'canonical', unavailable: 'fallback' },
      binding: { entityId: 'binary_sensor.demo_office_2', builtIn: 'notice' }, props: {},
    });
  }
  return document;
}

function applyChanges(document: Json, changes: Starter['changes']): Json {
  const copy = structuredClone(document);
  for (const change of changes) {
    const parts = segments(change.pointer), key = parts.pop();
    if (key === undefined) throw new Error('Starter changes must address a document field');
    let parent = copy;
    for (const part of parts) {
      if (Array.isArray(parent) && /^(0|[1-9]\d*)$/.test(part) && Number(part) < parent.length) parent = parent[Number(part)];
      else if (record(parent) && Object.hasOwn(parent, part)) parent = parent[part];
      else throw new Error(`Missing change parent: ${change.pointer}`);
    }
    if (Array.isArray(parent)) {
      const index = key === '-' && change.op === 'add' ? parent.length : /^(0|[1-9]\d*)$/.test(key) ? Number(key) : -1;
      if (index < 0 || index > parent.length || (change.op === 'replace' && index === parent.length)) throw new Error(`Invalid array change: ${change.pointer}`);
      if (change.op === 'add') parent.splice(index, 0, structuredClone(change.value));
      else parent[index] = structuredClone(change.value);
    } else if (record(parent) && !['__proto__', 'prototype', 'constructor'].includes(key)) {
      if (change.op === 'replace' && !Object.hasOwn(parent, key)) throw new Error(`Missing replacement: ${change.pointer}`);
      parent[key] = structuredClone(change.value);
    } else throw new Error(`Invalid change target: ${change.pointer}`);
  }
  return copy;
}

function compile(starter: Starter): CompiledComposition {
  try { return compileCompositionDocument(applyChanges(json(fixture(starter)), starter.changes)); }
  catch (error) {
    if (error instanceof CompositionValidationError) throw new Error(`${starter.id}: ${JSON.stringify(error.issues)}`, { cause: error });
    throw error;
  }
}

function nodeById(document: CompositionDocument, id: string): CompositionNode {
  const find = (nodes: CompositionNode[]): CompositionNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const child = find(compositionChildren(node));
      if (child) return child;
    }
    return undefined;
  };
  for (const page of document.pages) {
    const found = find(page.components);
    if (found) return found;
  }
  throw new Error(`Missing starter consumer: ${id}`);
}

function environment(document: CompositionDocument, inputs: Inputs) {
  const states: NativeState[] = Object.entries(inputs.entities).map(([entityId, input]) => ({
    entityId, name: entityId, state: input.state, todoList: input.todoList,
    ...Object.fromEntries(Object.entries(input.attributes ?? {}).map(([key, value]) => [
      key.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase()), value,
    ])),
  }));
  const house = houseFrom({ states });
  return { house, env: createEnvironment(document, house, emptyOverlay, undefined, clock) };
}

function simulate(starter: Starter, document: CompositionDocument, inputs: Inputs): unknown {
  const { house, env } = environment(document, inputs);
  switch (starter.id) {
    case 'office-pc': {
      const node = nodeById(document, 'office-pc');
      if (node.type !== 'state-tile' || !node.props.subtitle) throw new Error('Expected PC binding and helper caption');
      const style = resolveTileStyle(node.binding, document.stateStyles);
      if (!style) throw new Error('Expected PC state style');
      const look = previewTile(style, house.states?.get(node.binding.entityId)?.state, node.binding.overrides);
      return { visible: ruleHolds(node, env), stateText: look.text, stateClass: look.stateClass, subtitle: resolveText(node.props.subtitle, env) };
    }
    case 'predictive-pc-heat':
    case 'effective-away':
    case 'bedroom-volume': {
      const id = starter.id === 'predictive-pc-heat' ? 'pc-heat-explanation' : starter.id === 'effective-away' ? 'effective-away-notice' : 'demo-volume';
      const node = nodeById(document, id);
      if ((node.type !== 'text' && node.type !== 'remote-control') || !node.visibleWhen) throw new Error('Expected starter visibility rule');
      const power = starter.id === 'bedroom-volume' ? nodeById(document, 'demo-pad') : undefined;
      if (power && power.type !== 'remote-control') throw new Error('Expected separate remote power keys');
      return {
        answer: evaluatePredicate(node.visibleWhen, env), visible: ruleHolds(node, env),
        ...(power ? { powerVisible: ruleHolds(power, env) } : {}),
      };
    }
    case 'office-windows': {
      const node = nodeById(document, 'office-windows-tile');
      if (node.type !== 'state-tile' || node.props.subtitle?.type !== 'expr') throw new Error('Expected contact caption operand');
      return {
        answer: evaluateOperand(node.props.subtitle.value, env),
        text: resolveText(node.props.subtitle, env, inputs.previousText), visible: ruleHolds(node, env),
      };
    }
    case 'selected-lights-on':
    case 'past-due-tasks': {
      const node = nodeById(document, starter.id === 'selected-lights-on' ? 'selected-lights-on-list' : 'past-due-list');
      if (node.type !== 'row-collection') throw new Error('Expected visible rows consumer');
      const source = document.dataSources.find(source => source.id === node.props.providerId);
      if (source?.kind !== 'model' || source.model !== 'pipeline@1') throw new Error('Expected consumed pipeline');
      const response = source.inputs.request.type === 'entities'
        ? entityRows(source.inputs.request, id => {
          const entity = inputs.entities[id];
          return entity ? { state: entity.state, attributes: entity.attributes ?? {} } : undefined;
        }) : inputs.response;
      const program = createSimulationProgram([lift(json(source), { sourceId: source.id }).graph]);
      const run = runSimulation(program, {
        at: capturedAt, ...(inputs.requestError ? { error: inputs.requestError } : {}),
        base: {
          clock, reads: [], previousText: [],
          flowResponses: response === undefined ? [] : [{
            sourceId: source.id, requestFingerprint: flowFingerprint(source.inputs), response, at: capturedAt, trimmed: false,
          }],
        },
      }, { clock, observe: false });
      expect(run.issues).toEqual([]);
      expect(run.outputs).toHaveLength(1);
      const output = run.outputs[0];
      if (response === undefined) {
        expect(output.flow).toBeUndefined();
        expect(output.result).toBeUndefined();
        return { answered: false, issues: output.issues };
      }
      const evaluated = evaluatePipeline(source.inputs, response, { clock });
      expect(evaluated.status).toBe('ok');
      if (evaluated.status !== 'ok') throw new Error('Starter exceeded pipeline budget');
      expect(output.issues).toEqual([]);
      expect(output.result).toEqual({ kind: 'operand', answer: { status: 'value', value: evaluated.output } });
      if (!Array.isArray(evaluated.output)) throw new Error('Expected rows output');
      return { answered: true, rows: evaluated.output, emptyText: evaluated.output.length === 0 ? node.props.emptyText : null };
    }
    case 'groceries': {
      const node = nodeById(document, 'node-open-echo'), collection = nodeById(document, 'grocery-items');
      if (node.type !== 'navigation-tile' || node.props.subtitle.type !== 'expr' || collection.type !== 'collection') throw new Error('Expected grocery link and collection');
      const source = todoSource(document.dataSources, collection.props.providerId);
      if (!source) throw new Error('Expected consumed grocery checklist provider');
      const context: RenderContext = {
        mode: 'edit', env, house, overlay: emptyOverlay, sources: document.dataSources, previous: new Map(),
        field: () => undefined, local: () => undefined,
        run: () => { throw new Error('Starter simulations must never execute actions'); },
        store: createSelectionStore(),
      };
      const { container } = render(createElement(RenderCtx.Provider, { value: context },
        createElement(TodoSections, { nodeId: collection.id, source, emptyText: collection.props.emptyText })));
      return {
        answer: evaluateOperand(node.props.subtitle.value, env), text: resolveText(node.props.subtitle, env), visible: ruleHolds(node, env),
        checklist: {
          items: [...container.querySelectorAll('.sh-row-primary')].map(row => row.textContent),
          listVisible: container.querySelector('section[aria-label="Grocery List"]') !== null,
          message: container.querySelector('[role="status"]')?.textContent ?? null,
        },
      };
    }
    default: throw new Error(`No simulation adapter for ${starter.id}`);
  }
}

const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Starter simulations must not use the network'));
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(capturedAt)); });
afterEach(cleanup);
afterAll(() => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); }
  finally { fetchSpy.mockRestore(); vi.useRealTimers(); }
});

it('delivers exactly the eight independently applicable research starters', () => {
  expect(files.map(file => Number(file.split('-')[0]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(new Set(starters.map(starter => starter.id)).size).toBe(8);
});

for (const starter of starters) describe(starter.title, () => {
  let compiled: CompiledComposition;
  beforeAll(() => { compiled = compile(starter); });

  it('compiles the changes and derives the exact declared capability manifest', () => {
    expect(compiled.capabilities).toEqual(starter.capabilities);
    expect(compiled.expanded.logicLibrary).toBeUndefined();
    if (starter.id === 'bedroom-volume') {
      const base = fixture(starter), actual = nodeById(compiled.expanded, 'demo-volume');
      const original = nodeById(base, 'demo-volume');
      if (actual.type !== 'remote-control' || original.type !== 'remote-control') throw new Error('Expected remote volume node');
      expect(actual.binding).toEqual(original.binding);
      expect(actual.props).toEqual(original.props);
      expect(nodeById(compiled.expanded, 'demo-pad')).toEqual(nodeById(base, 'demo-pad'));
    }
    if (starter.id === 'groceries') {
      const link = nodeById(compiled.expanded, 'node-open-echo'), original = nodeById(fixture(starter), 'node-open-echo');
      if (link.type !== 'navigation-tile' || original.type !== 'navigation-tile') throw new Error('Expected grocery navigation');
      expect(link.action).toEqual(original.action);
    }
  });

  for (const simulation of starter.simulation) it(simulation.name, () => {
    expect(simulate(starter, compiled.expanded, simulation.inputs)).toEqual(simulation.expect);
  });
});
