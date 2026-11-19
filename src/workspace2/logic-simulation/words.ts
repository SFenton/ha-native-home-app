import type { SimulationResult } from '../../shared/composition/graph/types';
export function resultText(result: SimulationResult | undefined): string {
  if (!result) return 'Not observed';
  if (result.kind === 'condition') return result.answer === 'yes' ? 'Yes' : result.answer === 'no' ? 'No' : "Can't Tell";
  if (result.answer.status === 'loading') return 'Loading';
  if (result.answer.status === 'unavailable') return 'Unavailable';
  return typeof result.answer.value === 'string' ? result.answer.value : JSON.stringify(result.answer.value);
}
