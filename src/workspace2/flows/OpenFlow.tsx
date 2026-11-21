import { useMemo } from 'react';
import type { PipelineSource } from '../../shared/composition/pipeline';
import type { Workspace2 } from '../useWorkspace2';
import ShapeOutline from '../data/ShapeOutline';
import { addStepAt, flowShapes, pointRowAt, stepForField, stepId, updateFlow } from '../data/flow';
import { setPickSlot, useFlowFocus } from '../data/focus';
import { valueAfterStep } from '../data/samples';
import { studioClock, useFlowData } from '../data/useFlowData';
import { emptyLiveHint, emptyLiveSummary, runNotice } from '../data/runSummary';

/** Keeps the existing typed outline beside the existing inspector; the panel doesn't choose an editor implementation. */
export default function OpenFlow({ ws, source, onError }: { ws: Workspace2; source: PipelineSource; onError: (message: string) => void }) {
  const inputs = source.inputs, focus = useFlowFocus();
  const step = focus.flowId === source.id ? focus.step : null;
  const data = useFlowData(source.id, inputs);
  const details = { ...data, run: { at: data.run.answer?.at, running: data.run.running, error: data.run.error } };
  const notice = runNotice(inputs, details), empty = emptyLiveSummary(inputs, details);
  const shapes = useMemo(() => flowShapes(inputs), [inputs]);
  const at = step !== null && step < shapes.after.length ? step : null;
  const shape = at === null ? shapes.final : shapes.after[at];
  const partial = useMemo(() => {
    if (data.response === undefined || data.result?.status !== 'ok' || notice && notice.state !== 'stale') return undefined;
    return at === null ? data.result.value : valueAfterStep(inputs, data.response, at, { clock: studioClock() });
  }, [at, data, inputs, notice?.state]);
  const size = notice && notice.state !== 'stale' ? undefined : at === null ? data.items : data.result?.status === 'ok' ? data.result.trace[at]?.size ?? undefined : undefined;
  const tag = notice?.head ?? (data.source === 'live' ? 'Live' : data.source === 'sample' ? 'Sample' : data.source === 'demo' ? 'Demo' : 'No data yet');
  const heading = at === null ? `Output${size !== undefined && size !== null ? ` · ${size} ${size === 1 ? 'item' : 'items'}` : ''}` : `After Step ${at + 1}${size !== undefined && size !== null ? ` · ${size} items` : ''}`;
  const edit = (change: (value: typeof inputs) => typeof inputs) => { try { ws.studio.apply(updateFlow(ws.document!, source.id, change)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  return <div className="w2-data-open">
    <p className="w2-data-point"><span>{heading}</span><span className="w2-data-tag" data-source={notice?.state ?? data.source}>{tag}</span></p>
    {at === null && empty && <p className="w2-caption" data-testid="empty-live-summary">{empty}</p>}
    {notice && <p className={notice.state === 'error' || notice.state === 'stale' ? 'w2-error-text' : 'w2-caption'} role={notice.state === 'error' || notice.state === 'stale' ? 'alert' : 'status'}>{notice.note}</p>}
    {at === null && empty && <p className="w2-caption">{emptyLiveHint}</p>}
    <ShapeOutline shape={shape} value={partial} hide={data.hide} label={heading} rows={inputs.output.kind === 'rows'}
      onStep={(op, path, kind) => { setPickSlot(undefined); edit(value => { const id = stepId(value.steps, op), where = at === null ? value.steps.length : at + 1; return addStepAt(value, stepForField(op, id, path, kind), where); }); }}
      onRow={(slot, path) => edit(value => pointRowAt(value, slot, path))}/>
  </div>;
}
