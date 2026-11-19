import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as Evaluator from '../../../src/shared/composition/evaluator';
import type { Json } from '../../../src/shared/types';
import type { PipelineInputs } from '../../../src/shared/composition/pipeline/schema';
import type { FlowContext } from '../../../src/shared/composition/pipeline/operands';

type E = typeof Evaluator;
type First<T extends (...args: never[]) => unknown> = Parameters<T>[0];
interface Subject {
  operand?: First<E['evaluateOperand']>; condition?: First<E['evaluatePredicate']>;
  fill?: First<E['resolveFill']>; role?: Parameters<E['resolveFill']>[2];
  symbol?: First<E['resolveSymbol']>; text?: First<E['resolveText']>; badge?: First<E['resolveBadge']>;
  enabled?: First<E['isEnabled']>; previous?: boolean; faces?: First<E['tileFaces']>;
  action?: First<E['resolveAction']>; asks?: { when?: First<E['evaluatePredicate']> };
  progress?: First<E['tileProgress']>; tone?: First<E['resolveTone']>;
  tab?: { tabs: First<E['tabOnShow']>; requested: Parameters<E['tabOnShow']>[1]; fallback: Parameters<E['tabOnShow']>[2] };
  stack?: Parameters<typeof import('../../../src/shared/composition/stack-layout').layoutStack>[0];
  chart?: Parameters<typeof import('../../chart-corpus').answerChart>[0];
  gauge?: Parameters<typeof import('../../../src/shared/composition/gauge-math').layoutGauge>[0];
  dial?: Parameters<typeof import('../../dial-corpus').answerDial>[0];
  arc?: Parameters<typeof import('../../dial-corpus').answerArc>[0];
  dialctl?: Parameters<typeof import('../../dial-corpus').answerDialCtl>[0];
  foldsides?: Parameters<typeof import('../../../src/shared/composition/fold-sides').foldSidesAnswer>[0];
}
interface CorpusCase {
  subject: Subject; inputs?: PipelineInputs; response: Json; budget?: number;
  env: {
    reads?: Record<string, Evaluator.ReadResult>; raw?: Record<string, Evaluator.ReadResult>; changed?: Record<string, Evaluator.ReadResult>;
    viewerPerson?: Evaluator.ReadResult; params?: Record<string, Json>; undrawnSymbols?: string[];
  } & Pick<Evaluator.Environment, 'viewer' | 'clock' | 'item' | 'index' | 'flow' | 'controlValue' | 'controlValues'>;
  context?: { clock: FlowContext['clock']; viewer?: FlowContext['viewer']; reads?: Record<string, Json> };
}
export async function corpusAnswers(root: string, observing: boolean) {
  const load = (file: string) => import(pathToFileURL(resolve(root, file)).href);
  const e: E = await load('src/shared/composition/evaluator.ts');
  const pipeline: typeof import('../../../src/shared/composition/pipeline/evaluate') = await load('src/shared/composition/pipeline/evaluate.ts');
  const chart: typeof import('../../chart-corpus') = await load('tests/chart-corpus.ts');
  const dial: typeof import('../../dial-corpus') = await load('tests/dial-corpus.ts');
  const stack: typeof import('../../../src/shared/composition/stack-layout') = await load('src/shared/composition/stack-layout.ts');
  const gauge: typeof import('../../../src/shared/composition/gauge-math') = await load('src/shared/composition/gauge-math.ts');
  const folds: typeof import('../../../src/shared/composition/fold-sides') = await load('src/shared/composition/fold-sides.ts');
  let events = 0;
  const observe: Evaluator.EvaluationObserver = () => { events++; };
  const answers: Record<string, string> = {};
  const corpus = resolve(process.cwd(), 'contract/corpus');
  for (const directory of ['pipelines', 'evaluation']) for (const file of readdirSync(resolve(corpus, directory)).filter(name => name.endsWith('.json')).sort()) {
    const entry: CorpusCase = JSON.parse(readFileSync(resolve(corpus, directory, file), 'utf8'));
    let result: unknown, cost = 0;
    const input = entry.env ?? {};
    const env: Evaluator.Environment = {
      ...input,
      read: (id, path) => input.reads?.[`${id}/${path.join('/')}`] ?? e.unavailable,
      readRaw: id => input.raw?.[id] ?? e.unavailable,
      readChanged: id => input.changed?.[id] ?? e.unavailable,
      ...(input.viewerPerson ? { viewerPersonState: () => input.viewerPerson! } : {}),
      params: input.params ? { get: name => input.params?.[name] } : undefined,
      hasSymbol: input.undrawnSymbols ? name => !input.undrawnSymbols!.includes(name) : undefined,
      spend: () => { cost++; }, ...(observing ? { observe } : {}),
    };
    const s = entry.subject;
    if (entry.inputs) {
      const context = entry.context!;
      result = pipeline.evaluatePipeline(entry.inputs, entry.response, {
        clock: context.clock, viewer: context.viewer,
        read: (id, path) => {
          let found: Json | undefined = context.reads?.[id];
          for (const part of path) found = found && typeof found === 'object' && !Array.isArray(found) ? found[part] : undefined;
          return found;
        },
        ...(observing ? { observe: { evaluation: observe, pipeline: () => { events++; } } } : {}),
      }, entry.budget);
    } else if (s.operand) result = e.evaluateOperand(s.operand, env);
    else if (s.condition) result = { tri: e.evaluatePredicate(s.condition, env) };
    else if (s.fill) result = e.resolveFill(s.fill, env, s.role);
    else if (s.symbol) result = e.resolveSymbol(s.symbol, env);
    else if (s.text) result = e.resolveText(s.text, env);
    else if (s.badge) result = e.resolveBadge(s.badge, env);
    else if (s.enabled) result = { enabled: e.isEnabled(s.enabled, env, s.previous) };
    else if (s.faces) result = { faces: e.tileFaces(s.faces, env) };
    else if (s.action) result = { pick: s.action.type === 'conditional' ? e.pickAction(s.action as Parameters<E['pickAction']>[0], env) : 'plain', runs: e.resolveAction(s.action, env)?.type ?? 'none' };
    else if (s.asks) result = { asks: e.asksFirst(s.asks.when, env) };
    else if (s.progress) result = { progress: e.tileProgress(s.progress, env) };
    else if (s.tone) result = { tone: e.resolveTone(s.tone, env) };
    else if (s.tab) result = { tab: e.tabOnShow(s.tab.tabs, s.tab.requested, s.tab.fallback, env) };
    else if (s.chart) result = { chart: chart.answerChart(s.chart, env) };
    else if (s.stack) result = { stack: stack.layoutStack(s.stack) };
    else if (s.gauge) result = { gauge: gauge.layoutGauge(s.gauge) };
    else if (s.dial) result = { dial: dial.answerDial(s.dial) };
    else if (s.arc) result = { arc: dial.answerArc(s.arc) };
    else if (s.dialctl) result = { dialctl: dial.answerDialCtl(s.dialctl) };
    else if (s.foldsides) result = { foldsides: folds.foldSidesAnswer(s.foldsides) };
    else throw new Error(`Uncovered corpus subject: ${file}`);
    answers[`${directory}/${file}`] = JSON.stringify({ result, cost });
  }
  return { answers, events };
}
if (process.argv[1]?.endsWith('corpus-runner.ts')) {
  const result = await corpusAnswers(process.argv[2], process.argv[3] === 'observe');
  process.stdout.write(JSON.stringify(result));
}
