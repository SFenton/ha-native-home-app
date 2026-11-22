import { useId, useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import type { Json } from '../../shared/types';
import type { PipelineInputs } from '../../shared/composition/pipeline';
import { SAMPLE_LIMIT, clearSample, keepSample, setHideValues } from './samples';
import { requestKind } from './flow';
import { useFlowData } from './useFlowData';
import { emptyLiveHint, emptyLiveSummary, runNotice, type RunData } from './runSummary';

/** The words of the run bar: its first line, its second, and a tone for the dot. */
export interface RunWords { head: string; note: string; tone: 'live' | 'sample' | 'demo' | 'none' }
const clock = (iso: string) => { const date = new Date(iso); return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`; };
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
const count = (items: number | undefined, noun = 'items') => items === undefined ? '' : ` · ${items} ${items === 1 ? noun.replace(/s$/, '') : noun}`;

/**
 * A live empty output says what the request read and which step emptied it. A group and a live list follow Home Assistant without a Run button;
 * only Nothing has no request to run. Offline samples and demo values keep their own labels.
 */
export function runWords(inputs: PipelineInputs, data: RunData): RunWords {
  const kind = requestKind(inputs.request), items = data.items;
  const answered = data.source === 'live' && data.run?.at ? `Home Assistant answered at ${new Date(data.run.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` : undefined;
  const asking = (note: string) => data.run?.running ? (answered ? 'Refreshing from Home Assistant…' : 'Asking Home Assistant…') : note;
  if (kind === 'none') return { head: 'Live', note: 'Worked out on the phone. Nothing to run.', tone: 'live' };
  const notice = runNotice(inputs, data), empty = emptyLiveSummary(inputs, data);
  if (notice && notice.state !== 'stale') return { head: notice.head, note: notice.note, tone: 'none' };
  if (empty) return {
    head: empty,
    note: notice?.note ?? asking(answered ?? 'Follows Home Assistant. Changes show here as they happen.'),
    tone: notice?.state === 'stale' ? 'none' : 'live',
  };
  if (kind === 'group') {
    const total = inputs.request.type === 'entities' ? inputs.request.entityIds.length : 0;
    return data.source === 'live' ? { head: typeof data.output === 'number' ? `Live · ${data.output}` : items === undefined ? 'Live' : `Live · ${items}`, note: notice?.note ?? `Follows ${total} ${total === 1 ? 'entity' : 'entities'}. Changes show here as they happen.`, tone: 'live' }
      : { head: `Demo Data${count(items)}`, note: 'Made-up values, not yours. Follows the entities when Home Assistant is connected.', tone: 'demo' };
  }
  if (kind === 'live-list' && data.source === 'live') return { head: `Live${count(items)}`, note: notice?.note ?? asking(`${answered ?? 'Follows Home Assistant.'} Changes show here as they happen.`), tone: 'live' };
  if (kind === 'live-list') return { head: `Demo Data${count(items)}`, note: 'Home Assistant sends changes as they happen. The Studio draws made-up items.', tone: 'demo' };
  if (data.source === 'live') return { head: `Live${count(items)}`, note: notice?.note ?? (kind === 'service' ? asking(answered ?? 'Home Assistant answered.') : 'Follows the entity.'), tone: 'live' };
  if (data.source === 'sample' && data.sample) {
    const cut = data.sample.trimmed ? `First ${data.sample.trimmed.shown} of each list · ` : '';
    return { head: `Sample${data.sample.trimmed ? ` · ${data.sample.trimmed.shown} of ${data.sample.trimmed.of} items` : count(items)}`, note: `Kept on ${clock(data.sample.at)} · ${cut}${size(data.sample.bytes)}`, tone: 'sample' };
  }
  if (data.source === 'demo') return { head: `Demo Data${count(items)}`, note: asking('Made-up values, not yours. Paste a sample to use your own.'), tone: 'demo' };
  return { head: 'No data yet', note: 'Paste a sample to try your steps.', tone: 'none' };
}

/** "Paste a Sample…": JSON up to 256 KB, kept beside the draft in this browser. It also teaches the flow the shape of the answer. */
function PasteSample({ flowId, onPasted, onClose }: { flowId: string; onPasted: (json: Json) => void; onClose: () => void }) {
  const [text, setText] = useState(''), [problem, setProblem] = useState('');
  const id = useId();
  const keep = () => {
    let json: Json;
    try { json = JSON.parse(text) as Json; } catch { setProblem('That is not JSON.'); return; }
    if (new TextEncoder().encode(text).length > SAMPLE_LIMIT) { setProblem('A sample is 256 KB at most.'); return; }
    if (!keepSample(flowId, json)) { setProblem('A sample is 256 KB at most.'); return; }
    onPasted(json); onClose();
  };
  return <div className="w2-data-paste">
    <label htmlFor={id} className="w2-row-label">Sample JSON</label>
    <textarea id={id} rows={5} value={text} placeholder='{"items": []}' aria-invalid={problem ? true : undefined} aria-describedby={`${id}-note`} onChange={event => { setText(event.target.value); setProblem(''); }}/>
    <p id={`${id}-note`} className={problem ? 'w2-error-text' : 'w2-caption'} role={problem ? 'alert' : undefined}>{problem || 'Samples stay in this Studio. They are never published or exported.'}</p>
    <div className="w2-data-paste-actions"><button type="button" onClick={onClose}>Cancel</button><button type="button" className="w2-primary" disabled={!text.trim()} onClick={keep}>Keep Sample</button></div>
  </div>;
}

/**
 * The run bar: a dot, what the data is ("Live · 18"), a line under it, and, for a service or an attribute, "Paste a Sample…". `role="status"`, so a change is
 * announced once. With Home Assistant connected, a service and a live list run on their own (read only, see `liveRun.ts`); "Paste a Sample…" stays for when it is not.
 */
export default function RunBar({ flowId, inputs, onSample }: { flowId: string; inputs: PipelineInputs; onSample: (json: Json) => void }) {
  const data = useFlowData(flowId, inputs);
  const [pasting, setPasting] = useState(false);
  const details = { ...data, output: data.result?.status === 'ok' ? data.result.output : undefined, run: { at: data.run.answer?.at, running: data.run.running, error: data.run.error } };
  const words = runWords(inputs, details);
  const empty = emptyLiveSummary(inputs, details);
  const kind = requestKind(inputs.request);
  const pastes = kind === 'service' || kind === 'attribute';
  return <div className="w2-data-run" data-tone={words.tone} data-testid="run-bar">
    <div className="w2-data-run-line" role="status" aria-live="polite" aria-label={`${words.head}. ${words.note}`}>
      <span className="w2-data-dot" aria-hidden/><span className="w2-data-run-text"><strong>{words.head}</strong><span>{words.note}</span></span>
    </div>
    {empty && <p className="w2-caption" data-testid="empty-live-hint">{emptyLiveHint}</p>}
    {data.run.error && <p className="w2-error-text w2-data-run-error" role="alert" data-testid="run-error">{data.run.error}</p>}
    {pastes && !pasting && <div className="w2-data-run-actions">
      <button type="button" onClick={() => setPasting(true)}><ClipboardPaste size={14} aria-hidden/>Paste a Sample…</button>
      {data.sample && <button type="button" onClick={() => clearSample(flowId)}>Clear the Sample</button>}
      <label className="w2-data-hide"><input type="checkbox" checked={data.hide} onChange={event => setHideValues(event.target.checked)}/>Hide Values</label>
    </div>}
    {pasting && <PasteSample flowId={flowId} onPasted={onSample} onClose={() => setPasting(false)}/>}
  </div>;
}
