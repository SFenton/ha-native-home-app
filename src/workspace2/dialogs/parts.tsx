import { useMemo, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { EditorPath } from '../../composition-editor';
import type { Workspace2 } from '../useWorkspace2';
import { PushStack, usePush } from '../kit';
import { RowsProvider, type RowsContext } from '../rowsContext';

/** One authored field row: its place in the document is what a test (and the reachability walk) finds it by. */
export function FieldRow({ path, children }: { path: EditorPath; children: ReactNode }) {
  return <div className="w2-row" data-field-path={path.join('/')}>{children}</div>;
}

/** A list row that pushes a page of its own fields: a name and a monospace id leading, tags, then a chevron. */
export function PushRow({ title, detail, plain, tags, onOpen }: { title: string; detail?: string; /** The detail is words, not an identifier. */ plain?: boolean; tags?: ReactNode; onOpen: () => void }) {
  return <li><button type="button" className="w2-list-row w2-push-row" data-pushes onClick={onOpen}>
    <span className="w2-page-text"><span className="w2-page-title">{title}</span>{detail && (plain ? <span className="w2-page-via">{detail}</span> : <code className="w2-page-via">{detail}</code>)}</span>
    {tags}<ChevronRight size={16} aria-hidden/>
  </button></li>;
}

/** What a dialog's rows read: the live document and its setters, the same wherever a page is pushed to. */
export function useProjectRows(ws: Workspace2, onError: (message: string) => void): RowsContext | undefined {
  const document = ws.document, apply = ws.studio.apply;
  return useMemo(() => document ? { document, onChange: apply, onError } : undefined, [document, apply, onError]);
}

/**
 * The frame of one dialog body: its rows, and a stack for the pages they push. Inside the narrow Project sheet the sheet's own
 * stack is used instead, so Back returns to the Project list.
 */
export function DialogFrame({ context, title, children }: { context: RowsContext; title: string; children: ReactNode }) {
  const outer = usePush();
  return <RowsProvider value={context}>{outer ? children : <PushStack rootTitle={title} root={<>{children}</>}/>}</RowsProvider>;
}
