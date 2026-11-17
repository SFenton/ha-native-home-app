/**
 * Where a `chart` reads records instead of points written in the document (`sh.chart@1`, a `source` series), checked against the Data Flow it names.
 *
 * A source series names a records Data Flow (`sh.repeat@1`, lane WG-S2) and reads each point's label (`x.label`) and value (`y`) from the item with `item`
 * operands. Without a `providerId` the chart sits in the cell of a `repeat` and reads that repeat's own list. The first issue of each refusal is pinned by a
 * `reject/chart-source-*` corpus case:
 * - no `providerId` outside the template of a repeat (or in its placeholder, which has no list): `invalid_combination` at `<node>/props/series`;
 * - a `providerId` naming no source: `invalid_reference` at `<node>/props/series/providerId`;
 * - a `providerId` naming a source that is not a Data Flow, or a Data Flow whose output is not `records`: `binding_type` there;
 * - an `item` path in `x.label` or `y` that the flow's `schema` does not give: `invalid_reference` at that `path`;
 * - an `item` path of the wrong kind (`y` not a number, `x.label` not text): `binding_type` at the operand.
 */
import type { CompositionIssue } from './json';
import { pointer as join } from './json';
import type { ItemScope, Operand } from './expression';
import type { ChartSeries } from './schema';
import type { PipelineInputs } from './pipeline/schema';
import { evaluateOperand, type Environment } from './evaluator';
import type { Json } from '../types';
import { ANY, elementOf, kindsOf, shapeAt, withoutNull, type Shape } from './pipeline/shape';

/** What a chart needs to know of a document's data source. */
export interface ChartSourceLookup { get(id: string): { kind: string; model?: string; inputs?: unknown } | undefined }
/** A `source` series and where it stands, as the compiler hands it over. */
export interface ChartSourceRef { series: Extract<ChartSeries, { type: 'source' }>; path: string }

/** Whether a flow gives records, the list of typed items a chart or a repeat reads. */
export function isRecordsOutput(output: PipelineInputs['output']): boolean {
  return output.kind === 'records';
}

/**
 * Checks one `source` series. `scope` is the repeat the chart sits in, if any. Returns the issues found about the series itself and the shape of one record,
 * which the compiler then walks `x.label` and `y` with (`ANY` when the records cannot be known, so the operands are still walked). The operands' own
 * `item` paths are checked by that walk; their kinds by `checkChartOperandKind`.
 */
export function checkChartSource(ref: ChartSourceRef, sources: ChartSourceLookup, scope?: ItemScope): { issues: CompositionIssue[]; shape: Shape } {
  const { series, path } = ref;
  if (series.providerId === undefined) {
    if (scope === undefined || (scope !== 'lenient' && scope.placeholder)) return { issues: [{ code: 'invalid_combination', pointer: path }], shape: ANY };
    return { issues: [], shape: scope === 'lenient' ? ANY : scope.shape };
  }
  const at = join(path, 'providerId');
  const source = sources.get(series.providerId);
  if (!source) return { issues: [{ code: 'invalid_reference', pointer: at }], shape: ANY };
  if (source.kind !== 'model' || source.model !== 'pipeline@1') return { issues: [{ code: 'binding_type', pointer: at }], shape: ANY };
  const inputs = source.inputs as PipelineInputs;
  if (!isRecordsOutput(inputs.output)) return { issues: [{ code: 'binding_type', pointer: at }], shape: ANY };
  return { issues: [], shape: elementOf(inputs.schema) ?? ANY };
}

/**
 * The kind rule of a chart's `x.label` (text) and `y` (a number, or null for an unknown value). Only an `item` operand has a kind that comes from the
 * records' shape: when its path exists but its kinds cannot be the wanted one, the operand is `binding_type`. Other operands are judged by the compiler's
 * own operand kinds.
 */
export function checkChartOperandKind(operand: Operand, shape: Shape, want: 'string' | 'number', pointer: string): CompositionIssue[] {
  if (operand.type !== 'item') return [];
  const leaf = shapeAt(shape, operand.path);
  if (!leaf) return [];
  const have = kindsOf(withoutNull(leaf));
  return have.size && !have.has(want) ? [{ code: 'binding_type', pointer }] : [];
}

/** One point of a chart as drawn: the label under it and its value, `null` where the value is not known. */
export interface ChartPoint { label: string; value: number | null }

/**
 * The points a `source` series draws from the records of its flow: at most `limit` of them from the first, each read with `item` set to the record and
 * `index` to its position. A label is the text of `x.label` (a number is written as it is; anything else is empty), and a value the number `y` gives: a
 * number, or text that is one, else `null`, so an unknown value is a stub in a bar chart and a break in a line, as for a literal series.
 */
export function sourcePoints(series: Extract<ChartSeries, { type: 'source' }>, records: readonly Json[], env: Environment): ChartPoint[] {
  return records.slice(0, series.limit).map((record, index) => {
    const at = { ...env, item: record, index };
    const label = evaluateOperand(series.x.label, at);
    const number = evaluateOperand(series.y, at);
    const raw = label.status === 'value' ? label.value : undefined;
    const known = number.status === 'value' ? number.value : undefined;
    const value = typeof known === 'number' && Number.isFinite(known) ? known : typeof known === 'string' && known.trim() !== '' && Number.isFinite(Number(known)) ? Number(known) : null;
    return { label: typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '', value };
  });
}
