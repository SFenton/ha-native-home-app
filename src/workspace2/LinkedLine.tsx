import { Link2 } from 'lucide-react';
import { componentUses } from '../shared/composition/components';
import type { CompositionDocument } from '../shared/composition/schema';
import type { IndexEntry } from '../preview2/model';
import type { LinkedSession } from './useLinkedGate';

/**
 * The line under a template place's header (studio-linked spec, "The badge"): the lasting sign of what an edit will do, for the root and for
 * anything inside. `role="note"`; when the session opens it reads "Editing …" inside a polite live region.
 */
export default function LinkedLine({ document, entry, session, compact }: { document: CompositionDocument; entry: IndexEntry; session?: LinkedSession; /** Only the sentence, for the open template row: its header already names the template. */ compact?: boolean }) {
  const component = document.componentLibrary?.find(item => item.id === entry.component);
  if (!component) return null;
  const places = componentUses(document, component.id).length;
  const editing = session && session.entryId === component.id && entry.instance === `node:${session.refId}`;
  if (compact) return <p className="w2-template-note" role="note" data-testid="linked-line" aria-live="polite">{editing ? `Editing ${component.name}. Changes apply in all ${places} places.` : places > 1 ? 'A change here asks first.' : 'Used only here.'}</p>;
  const title = editing ? `Editing ${component.name}` : `Linked to ${component.name}`;
  const line = editing ? `Changes apply in all ${places} places.` : places > 1 ? `Used in ${places} places. A change here asks first.` : 'Used only here.';
  return <div className="w2-linked-line" role="note" data-testid="linked-line">
    <Link2 size={16} aria-hidden/>
    <div aria-live="polite"><strong>{title}</strong><span>{line}</span></div>
  </div>;
}
