import { useId } from 'react';
import type { GraphNode } from '../../shared/composition/graph';
import { normalizeAnnotation } from '../../shared/composition/studio-logic/layout';

export interface AnnotationDraft {
  readonly nodeId: string;
  readonly label: string;
  readonly note: string;
  readonly location: 'inline' | 'inspector';
  readonly error?: string;
  readonly dirty?: boolean;
}
export function annotationError(label: string, note: string): string | undefined {
  if (/[\r\n]/.test(label + note)) return 'Use a single paragraph; line breaks are not supported.';
  try { normalizeAnnotation({ label, note }); }
  catch {
    if (/[\p{Cc}\p{Cf}]/u.test(label + note)) return 'Control characters are not supported.';
    return 'Label must be at most 60 characters and Description at most 280 characters.';
  }
}
export default function AnnotationEditor({ node, draft, change, reject, apply, cancel }: {
  node: GraphNode; draft?: AnnotationDraft; change: (label: string, note: string) => void; reject: (error: string) => void; apply: () => void; cancel: () => void;
}) {
  const id = useId(), label = draft?.label ?? node.annotation?.label ?? '', note = draft?.note ?? node.annotation?.note ?? '';
  return <form className="w2-canvas-annotation" aria-label="Block details" onSubmit={event => { event.preventDefault(); apply(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  }}>
    <label htmlFor={`${id}-label`}>Label<input id={`${id}-label`} value={label} aria-describedby={draft?.error ? `${id}-error` : undefined} aria-invalid={Boolean(draft?.error)} onChange={event => change(event.target.value, note)}
      onPaste={event => { if (/[\r\n]/.test(event.clipboardData.getData('text'))) { event.preventDefault(); reject('Use a single paragraph; line breaks are not supported.'); } }}/></label>
    <label htmlFor={`${id}-note`}>Description<textarea id={`${id}-note`} rows={3} value={note} aria-describedby={draft?.error ? `${id}-error` : undefined} aria-invalid={Boolean(draft?.error)} onChange={event => change(label, event.target.value)}
      onPaste={event => { if (/[\r\n]/.test(event.clipboardData.getData('text'))) { event.preventDefault(); reject('Use a single paragraph; line breaks are not supported.'); } }}/></label>
    {draft?.error && <p id={`${id}-error`} role="alert" className="w2-canvas-error">{draft.error}</p>}
    <div className="w2-canvas-actions"><button type="submit">Apply details</button><button type="button" onClick={cancel}>Cancel</button></div>
  </form>;
}
