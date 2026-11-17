import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  asksFirst, evaluateOperand, evaluatePredicate, isEnabled, pickAction, resolveAction, resolveBadge, resolveFill, resolveSymbol, resolveText, resolveTone, tabOnShow, tileFaces, tileProgress,
  type Environment, type ReadResult,
} from '../src/shared/composition/evaluator';
import type { Operand, Predicate } from '../src/shared/composition/expression';
import { layoutStack } from '../src/shared/composition/stack-layout';
import { answerChart } from './chart-corpus';
import { layoutGauge, type GaugeInput } from '../src/shared/composition/gauge-math';
import { answerArc, answerDial } from './dial-corpus';
import type { Json } from '../src/shared/types';

/**
 * The expression evaluation corpus (`contract/corpus/evaluation`): an operand or a condition, an environment and the exact answer, hand-written in
 * `scripts/generate-expression-corpus.ts`. The native app runs the same files with its own evaluator and must agree byte for byte.
 */
const directory = path.resolve(__dirname, '../contract/corpus/evaluation');
type Subject = Record<string, any>;
interface Case {
  format: number; name: string; note: string; subject: Subject;
  env: { reads?: Record<string, ReadResult>; /** What `readRaw` gives per source id; a source not listed has no entity. */ raw?: Record<string, ReadResult>; viewer?: Environment['viewer']; clock?: Environment['clock']; item?: Json; index?: number; params?: Record<string, Json>; flow?: boolean;
    /** The locale the date styles are pinned to; the Studio draws `en_US` only and the app uses its formatters for others. */ locale?: string; undrawnSymbols?: string[] };
  expected: Record<string, any>;
}
/** The kinds of subject a case can have: each is answered by one function of the shared evaluator. */
const subjectKinds = ['operand', 'condition', 'fill', 'symbol', 'text', 'badge', 'enabled', 'faces', 'action', 'asks', 'progress', 'tab', 'tone', 'stack', 'chart', 'gauge', 'dial', 'arc'] as const;
const files = readdirSync(directory).filter(name => name.endsWith('.json')).sort();
const cases: Case[] = files.map(name => JSON.parse(readFileSync(path.join(directory, name), 'utf8')));
const environmentOf = (entry: Case): Environment => ({
  read: (sourceId, segments) => entry.env.reads?.[`${sourceId}/${segments.join('/')}`] ?? { status: 'unavailable' },
  readRaw: sourceId => entry.env.raw?.[sourceId] ?? { status: 'unavailable' },
  viewer: entry.env.viewer, clock: entry.env.clock, item: entry.env.item, index: entry.env.index, flow: entry.env.flow,
  hasSymbol: entry.env.undrawnSymbols ? name => !entry.env.undrawnSymbols!.includes(name) : undefined,
  params: entry.env.params ? { get: name => entry.env.params![name] } : undefined,
});

/** The answer the shared evaluator gives for a case, in the shape the case file records. */
function answer(entry: Case, env: Environment): unknown {
  const { subject } = entry;
  if (subject.condition) return { tri: evaluatePredicate(subject.condition, env) };
  if (subject.operand) return evaluateOperand(subject.operand as Operand, env);
  if (subject.fill) return resolveFill(subject.fill, env, subject.role);
  if (subject.symbol) return resolveSymbol(subject.symbol, env);
  if (subject.text) return resolveText(subject.text, env);
  if (subject.badge) return resolveBadge(subject.badge, env);
  if (subject.enabled) return { enabled: isEnabled(subject.enabled, env, subject.previous) };
  if (subject.faces) return { faces: tileFaces(subject.faces, env) };
  if (subject.action) {
    const picked = subject.action.type === 'conditional' ? pickAction(subject.action, env) : 'plain';
    const runs = resolveAction(subject.action, env);
    return { pick: picked, runs: runs?.type ?? 'none' };
  }
  if (subject.tone) return { tone: resolveTone(subject.tone, env) };
  if (subject.stack) {
    return { stack: layoutStack(subject.stack) };
  }
  if (subject.chart) return { chart: answerChart(subject.chart, env) };
  if (subject.gauge) return { gauge: layoutGauge(subject.gauge as GaugeInput) };
  if (subject.dial) return { dial: answerDial(subject.dial) };
  if (subject.arc) return { arc: answerArc(subject.arc) };
  if (subject.progress) return { progress: tileProgress(subject.progress as Operand, env) };
  if (subject.tab) return { tab: tabOnShow(subject.tab.tabs, subject.tab.requested, subject.tab.fallback, env) };
  return { asks: asksFirst(subject.asks.when as Predicate | undefined, env) };
}

describe('expression evaluation corpus', () => {
  it('has a file per case, named by the case, with a condition or an operand', () => {
    expect(cases.length).toBeGreaterThanOrEqual(160);
    expect(cases.map(entry => `${entry.name}.json`)).toEqual(files);
    for (const entry of cases) {
      expect(entry.format).toBe(1);
      expect(entry.note.length).toBeGreaterThan(10);
      expect(subjectKinds.filter(kind => entry.subject[kind] !== undefined)).toHaveLength(1);
    }
  });
  it('covers yes, no and unknown for conditions, and value, loading and unavailable for operands', () => {
    const tri = new Set(cases.filter(entry => entry.expected.tri).map(entry => entry.expected.tri));
    const status = new Set(cases.filter(entry => entry.expected.status).map(entry => entry.expected.status));
    expect([...tri].sort()).toEqual(['no', 'unknown', 'yes']);
    expect([...status].sort()).toEqual(['loading', 'unavailable', 'value']);
  });
  it.each(cases.map(entry => [entry.name, entry] as const))('%s gives its recorded answer', (_name, entry) => {
    expect(answer(entry, environmentOf(entry))).toEqual(entry.expected);
  });
});
