import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { SelectMenu } from '../SelectMenu';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { entityOfSource, operandName } from './condition';
import { useDraftEnvironment, useNameContext } from './useExpr';
import { words } from './words';
import type { Tried } from './useTryValues';
import { scalarText } from '../../preview2/evaluate';

const COMMON = ['on', 'off', 'home', 'not_home', 'open', 'closed', 'locked', 'unlocked'];

/**
 * Try Values (D8): a fold at the foot of a page. One line per input the expression reads, by name, with a pop-up showing its value now;
 * an overridden line has the amber wash. The simulator uses the overrides until the page closes; nothing is saved or sent.
 */
export default function TryValues({ document, inputs }: { document: CompositionDocument; inputs: readonly { sourceId: string; path: string[] }[] }) {
  const [open, setOpen] = useState(false);
  const { tried, entities } = useWorkspaceData();
  const env = useDraftEnvironment(document), ctx = useNameContext(document);
  const body = useId();
  if (!inputs.length) return null;
  return <section className="w2-expr-try" aria-label={words.tryValues}>
    <button type="button" className="w2-expr-foldhead" aria-expanded={open} aria-controls={body} onClick={() => setOpen(value => !value)}>
      <span className="w2-row-label">{words.tryValues}</span><ChevronRight size={16} aria-hidden className="w2-expr-chev" data-open={open || undefined}/>
    </button>
    {open && <div id={body} className="w2-expr-try-body">
      {inputs.map(input => {
        const entity = entityOfSource(ctx, input.sourceId), state = input.path.length === 1 && input.path[0] === 'state';
        const name = operandName({ type: 'read', from: { type: 'source', sourceId: input.sourceId, path: input.path }, as: 'string', missing: 'unavailable' }, ctx);
        const now = env?.read(input.sourceId, input.path);
        const shown = now?.status === 'value' ? scalarText(now.value) ?? '' : now?.status === 'loading' ? words.loading : words.unavailable;
        const key = `${input.sourceId}|${input.path.join('/')}`;
        if (!entity || !state) return <div key={key} className="w2-expr-tryline"><span>{name}</span><span className="w2-expr-muted">{shown} · the simulator's</span></div>;
        const current = tried.overrides.get(entity);
        const live = entities.find(row => row.entityId === entity)?.state?.split(' ')[0];
        const value = !current ? 'live' : current.kind === 'value' ? `v:${current.value}` : current.kind;
        const states = [...new Set([...(live ? [live] : []), ...COMMON])];
        const options = [{ value: 'live', label: `Live${live ? ` (${live})` : ''}` }, ...states.map(item => ({ value: `v:${item}`, label: item })), ...(current?.kind === 'value' && !states.includes(current.value) ? [{ value: `v:${current.value}`, label: current.value }] : []),
          { value: 'unavailable', label: words.unavailable }, { value: 'loading', label: words.loading }];
        const choose = (next: string) => { tried.set(entity, next === 'live' ? undefined : next === 'unavailable' || next === 'loading' ? { kind: next } as Tried : { kind: 'value', value: next.slice(2) }); };
        return <div key={key} className="w2-expr-tryline" data-overridden={current ? '' : undefined}><span>{name}</span>
          <div className="w2-expr-trycontrol"><SelectMenu label={`${name} for Try Values`} value={value} options={options} onChange={choose}/></div></div>;
      })}
      <button type="button" className="w2-expr-reset" disabled={!tried.count} onClick={tried.reset}>{words.resetToLive}</button>
      <p className="w2-caption">{words.tryNote}</p>
    </div>}
  </section>;
}
