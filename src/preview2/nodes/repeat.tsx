import { useContext, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { PipelineInputs } from '../../shared/composition/pipeline';
import { spacePoints } from '../../shared/composition/stack-layout';
import type { Json } from '../../shared/types';
import { CopyContext, ListContext, pageSizeOf, textStepOf, type RecordsAnswer } from '../flow-records';
import { RenderCtx, useRender } from '../render-context';
import { useElementWidth } from '../useElementWidth';
import { Children } from './Children';
import type { NodeOf } from './shared';
import './repeat.css';

/** The width from which a window counts as regular for paging (`paging.regular`): an iPad or a wide landscape window, not a phone. */
const REGULAR_WIDTH = 600;
type Child = NodeOf<'repeat'>['children'][number];

/** One cell of a repeat: its template drawn with `item` and `index` set, in a context of its own so the cell's rules and kept values never mix with a sibling's. */
function Cell({ child, item, index, copy }: { child: Child; item: Json; index: number; copy: boolean }) {
  const base = useContext(RenderCtx)!;
  const scoped = useMemo(() => ({
    ...base, env: { ...base.env, item, index }, scope: { item, index }, previous: new Map<string, boolean>(), kept: new Map<string, unknown>(),
    run: (action: Parameters<typeof base.run>[0], control?: Json) => base.run(action, control, { item, index }),
  }), [base, item, index]);
  return <RenderCtx.Provider value={scoped}><CopyContext.Provider value={copy}>
    <div className="sh-repeat-cell" data-index={index}><Children nodes={[child]}/></div>
  </CopyContext.Provider></RenderCtx.Provider>;
}

/** The cells in pages: a row that snaps a page at a time, with the page indicator and the previous and next buttons when the paging asks for them. */
function Pages({ cells, node, size, regular }: { cells: React.ReactNode[]; node: NodeOf<'repeat'>; size: number; regular: boolean }) {
  const paging = node.props.paging!;
  const track = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(cells.length / size));
  const gap = spacePoints(node.props.spacing);
  const go = (to: number) => { const next = Math.max(0, Math.min(pages - 1, to)); setPage(next); const el = track.current; if (el) el.scrollLeft = next * el.clientWidth; };
  const onScroll = () => { const el = track.current; if (el && el.clientWidth > 0) setPage(Math.round(el.scrollLeft / el.clientWidth)); };
  const slices = Array.from({ length: pages }, (_, at) => cells.slice(at * size, (at + 1) * size));
  const buttons = paging.buttons === 'regular-width' && regular && pages > 1;
  return <div className="sh-repeat-paged" data-regular={regular ? '' : undefined}>
    <div className="sh-repeat-track" ref={track} onScroll={onScroll} role="group" aria-label={paging.label ?? node.title} data-testid="repeat-track">
      {slices.map((slice, at) => <div key={at} className="sh-repeat-page" data-page={at} style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`, gap }}>{slice}</div>)}
    </div>
    {(paging.indicator || buttons) && pages > 1 && <div className="sh-repeat-footer">
      {buttons && <button type="button" className="sh-repeat-button" aria-label="Previous page" disabled={page === 0} onClick={() => go(page - 1)}><ChevronLeft size={16} aria-hidden="true"/></button>}
      {paging.indicator && <div className="sh-repeat-dots" role="img" aria-label={`Page ${page + 1} of ${pages}`} data-testid="repeat-dots">
        {slices.map((_, at) => <i key={at} data-current={at === page ? '' : undefined}/>)}</div>}
      {buttons && <button type="button" className="sh-repeat-button" aria-label="Next page" disabled={page === pages - 1} onClick={() => go(page + 1)}><ChevronRight size={16} aria-hidden="true"/></button>}
    </div>}
  </div>;
}

/** What the repeat draws for an answer: its template once for each record, or its placeholder, or its words. */
function RepeatBody({ node, answer }: { node: NodeOf<'repeat'>; answer: RecordsAnswer }) {
  const { mode, statePreview, textScale } = useRender();
  const { props, children } = node;
  const host = useRef<HTMLDivElement>(null);
  const width = useElementWidth(host);
  const regular = width >= REGULAR_WIDTH;
  const forced = mode === 'edit' && statePreview?.nodeId === node.id ? statePreview.state : undefined;
  const state = forced === 'loading' || forced === 'empty' || forced === 'error' || forced === 'unavailable' ? forced : answer.state;
  const stale = forced === 'stale' || (answer.stale === true && state === 'ready');
  const [cell, ghost] = children;
  const limit = props.limit ?? 100;
  const shown = state === 'ready' || forced === 'stale' ? answer.records.slice(0, limit) : [];
  const horizontal = props.axis === 'horizontal';
  const gap = spacePoints(props.spacing);
  const word = state === 'loading' ? props.loadingText : state === 'empty' ? props.emptyText : state === 'error' ? props.errorText : props.unavailableText;
  let cells: React.ReactNode[] = [];
  let ghosts = false;
  if (shown.length > 0) cells = shown.map((record, at) => <Cell key={at} child={cell} item={record} index={at} copy={at > 0}/>);
  else if (state === 'loading' && ghost && props.placeholder) { ghosts = true; cells = Array.from({ length: props.placeholder.count }, (_, at) => <Cell key={at} child={ghost} item={null} index={at} copy={at > 0}/>); }
  const paged = horizontal && props.paging !== undefined && cells.length > 0;
  const size = props.paging ? pageSizeOf(props.paging, regular, textStepOf(textScale)) : 1;
  const style = { '--sh-repeat-gap': `${gap}px` } as CSSProperties;
  return <ListContext.Provider value={shown}><div ref={host} className="sh-repeat" role="group" aria-label={node.title} aria-busy={state === 'loading' ? true : undefined} data-axis={props.axis} data-state={forced ?? (stale ? 'stale' : state)}
    data-placeholder={ghosts ? '' : undefined} style={style}>
    {cells.length > 0
      ? paged ? <Pages cells={cells} node={node} size={size} regular={regular}/> : <div className="sh-repeat-flow" data-axis={props.axis}>{cells}</div>
      : <div className="sh-list-state" role="status"><strong className="sh-list-state-title" data-testid="repeat-word">{word}</strong></div>}
    {cells.length > 0 && ghosts && <span className="sh-repeat-word" role="status" data-testid="repeat-word">{props.loadingText}</span>}
    {stale && <p className="sh-list-footnote" data-testid="repeat-stale">{props.staleText}</p>}
  </div></ListContext.Provider>;
}

/** The flow a repeat reads, run by the host: a component of its own so the host's hook runs for the same flow on every render. */
function Fed({ node, sourceId, inputs, use }: { node: NodeOf<'repeat'>; sourceId: string; inputs: PipelineInputs; use: (id: string, inputs: PipelineInputs) => RecordsAnswer }) {
  return <RepeatBody node={node} answer={use(sourceId, inputs)}/>;
}

/**
 * `repeat` (`sh.repeat@1`): its first child drawn once for each record of a records flow, with `item` and `index` set to that record and its position. The flow
 * is run by the host (the Studio runs it over a sample, a live run or demo data); with no host, or no flow of that id, the repeat draws as loading. A horizontal
 * repeat may page (`paging`), counting a page by the window and the text size. Edit draws every record but selects the first copy only; the other copies are
 * inert and carry no `data-sel`. While the flow has not answered the second child is drawn `placeholder.count` times, with `index` and no record.
 */
export function RepeatNode({ node }: { node: NodeOf<'repeat'> }) {
  const { records } = useRender();
  const source = records?.sources.find((entry: CompositionDocument['dataSources'][number]) => entry.id === node.props.providerId);
  const inputs = source && source.kind === 'model' && source.model === 'pipeline@1' ? source.inputs as PipelineInputs : undefined;
  if (records && inputs) return <Fed node={node} sourceId={node.props.providerId} inputs={inputs} use={records.use}/>;
  return <RepeatBody node={node} answer={{ state: 'loading', records: [] }}/>;
}
