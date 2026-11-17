import { ChevronRight } from 'lucide-react';
import type { SelectionKey } from '../../preview2/model';
import { useRows } from '../rowsContext';
import { usedBy, fieldWords } from './flow';

/** "Used By": the nodes that read the flow; a press shows the node in the simulator. With none, it says what to do. */
export default function UsedBy({ flowId, onGo }: { flowId: string; onGo: (key: SelectionKey) => void }) {
  const { document } = useRows();
  const uses = usedBy(document, flowId);
  return <section className="w2-group w2-data-section" aria-label="Used by" data-testid="used-by">
    <h3 className="w2-group-title">Used by</h3>
    {uses.length === 0 ? <p className="w2-caption">Nothing uses this Data Flow yet. Choose it in a List's “Rows from”, or pick its value in a text.</p>
      : <ul className="w2-data-uses">{uses.map(use => <li key={use.nodeId}><button type="button" className="w2-link-row" onClick={() => onGo(`node:${use.nodeId}` as SelectionKey)}>
        <span className="w2-page-title">{use.nodeTitle}</span><span className="w2-page-via">{use.fields.map(fieldWords).join(', ')}</span><ChevronRight size={16} aria-hidden/></button></li>)}</ul>}
  </section>;
}
