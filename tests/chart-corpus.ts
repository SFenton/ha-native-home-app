import {
  axisLevels, axisText, barMarks, ceilingDomain, labelCadence, labelIndices, pointMarks, scaledPercent, seriesText, twoStepDomain,
} from '../src/shared/composition/chart-math';
import { sourcePoints } from '../src/shared/composition/chart-source';
import type { Environment } from '../src/shared/composition/evaluator';

/**
 * The answer the shared chart arithmetic gives for an evaluation case's `chart` subject (`contract/corpus/evaluation/chart-*.json`): one `op` and its
 * inputs. The app's own chart view must give the same numbers; the cases are hand-written from the native tests, never computed by this module.
 */
type Subject = Record<string, any>;

export function answerChart(subject: Subject, env: Environment): Record<string, unknown> {
  switch (subject.op) {
    case 'domain': {
      const { domain, peak } = subject;
      return { domain: ceilingDomain(peak ?? undefined, domain.step, domain.min, domain.max) };
    }
    case 'two-step': return { ...twoStepDomain(subject.total ?? undefined, subject.minimumStep, subject.maximumFractionDigits, subject.factors) };
    case 'share': return { percent: scaledPercent(subject.value, subject.top, subject.base ?? 0) };
    case 'labels': {
      const cadence = labelCadence(subject.count, subject.plotWidth, subject.widestLabelWidth);
      return { cadence, indices: labelIndices(subject.count, cadence) };
    }
    case 'indices': return { indices: labelIndices(subject.count, subject.cadence) };
    case 'levels': {
      const values = axisLevels(subject.levels, subject.top, subject.base ?? 0);
      return { values, labels: values.map(value => axisText(subject.pattern, value, subject.digits)) };
    }
    case 'bars': return { bars: barMarks(subject.values, subject.top, subject.base ?? 0, subject.width, subject.height, subject.gap, subject.minimum).map(({ index: _index, ...mark }) => mark) };
    case 'points': return { points: pointMarks(subject.values, subject.top, subject.base ?? 0, subject.width, subject.height).map(({ x, y }) => ({ x, y })) };
    case 'spoken': return { spoken: seriesText(subject.points, subject.pattern, subject.digits, subject.unknownText) };
    case 'source-points': return { sourcePoints: sourcePoints(subject.series, subject.records, env) };
    default: throw new Error(`unknown chart op ${subject.op}`);
  }
}
