import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkPipelineSource, evaluatePipeline, inferShapeFromSamples, newFacts, typeSteps, type FlowContext, type PipelineInputs, type Shape,
} from '../src/shared/composition/pipeline';
import type { Json } from '../src/shared/types';

/**
 * The Data Flow evaluation corpus (`contract/corpus/pipelines`): data, steps and the exact answer, hand-written in
 * `scripts/generate-pipeline-corpus.ts`. The native app runs the same files with its own evaluator.
 */
const directory = path.resolve(__dirname, '../contract/corpus/pipelines');
interface Case {
  format: number; name: string; note: string; inputs: PipelineInputs; response: Json; compiles: boolean; budget?: number; expectedShape?: Shape;
  context: { clock: { now: string; utcOffsetMinutes: number }; viewer?: FlowContext['viewer']; reads?: Record<string, Json> };
  expected: { status: 'ok' | 'over-budget'; output?: Json; visits?: number };
}
const files = readdirSync(directory).filter(name => name.endsWith('.json')).sort();
const cases: Case[] = files.map(name => JSON.parse(readFileSync(path.join(directory, name), 'utf8')));
const contextOf = (entry: Case): FlowContext => ({
  clock: entry.context.clock, viewer: entry.context.viewer,
  read: (sourceId, segments) => {
    let current: Json | undefined = entry.context.reads?.[sourceId];
    for (const segment of segments) current = current !== null && typeof current === 'object' && !Array.isArray(current) ? current[segment] : undefined;
    return current;
  },
});

describe('pipeline evaluation corpus', () => {
  it('has a file per case, named by the case', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(cases.map(entry => `${entry.name}.json`)).toEqual(files);
    for (const entry of cases) { expect(entry.format).toBe(1); expect(entry.note.length).toBeGreaterThan(10); }
  });

  it.each(cases.map(entry => [entry.name, entry] as const))('%s evaluates to its recorded answer', (_name, entry) => {
    const result = evaluatePipeline(entry.inputs, entry.response, contextOf(entry), entry.budget);
    expect(result.status).toBe(entry.expected.status);
    if (result.status === 'ok') {
      expect(result.output).toStrictEqual(entry.expected.output);
      if (entry.expected.visits !== undefined) expect(result.visits).toBe(entry.expected.visits);
    }
  });

  it.each(cases.map(entry => [entry.name, entry] as const))('%s is a flow the compiler accepts, unless it runs a step the compiler refuses', (_name, entry) => {
    const found = checkPipelineSource({ id: 'case', kind: 'model', model: 'pipeline@1', inputs: entry.inputs }, '');
    if (entry.compiles) expect(found.issues).toEqual([]);
    else expect(found.issues.length).toBeGreaterThan(0);
  });

  it.each(cases.filter(entry => entry.expectedShape).map(entry => [entry.name, entry] as const))('%s has the recorded shape after its steps', (_name, entry) => {
    const facts = newFacts();
    const kinds = new Map(entry.inputs.parameters.map(parameter => [parameter.name, parameter.type]));
    const shapes = typeSteps(entry.inputs.steps, inferShapeFromSamples([entry.response]), kinds, '', facts);
    expect(facts.issues).toEqual([]);
    expect(shapes.at(-1)).toEqual(entry.expectedShape);
  });
});
