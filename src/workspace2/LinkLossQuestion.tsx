import { useRef } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';

/** What a change that drops linked values asks first: what it is, what loses its link, and the change by name. */
export interface LinkLoss {
  readonly title: string;
  readonly text: string;
  readonly confirm: string;
  /** `plain` draws the change's button in the ordinary primary style, for a question that removes nothing. Default: the danger style. */
  readonly tone?: 'plain';
}

/**
 * The question before a change that removes linked values (Remove Setting, a field's type). Cancel changes nothing; the change
 * runs only from its own button, as one undo step.
 */
export function LinkLossQuestion({ asking, onCancel, onConfirm }: { asking: LinkLoss | undefined; onCancel: () => void; onConfirm: () => void }) {
  // The question stays drawn while it closes, so its closing animation runs to the end and nothing is left over the page.
  const last = useRef(asking);
  if (asking) last.current = asking;
  const shown = asking ?? last.current;
  return <AlertDialog.Root open={Boolean(asking)} onOpenChange={next => { if (!next) onCancel(); }}>
    <AlertDialog.Portal><AlertDialog.Backdrop className="w2-backdrop"/><AlertDialog.Viewport className="w2-dialog-viewport">
      {shown && <AlertDialog.Popup className="w2-scope w2-dialog w2-dialog-s w2-linked-question" data-testid="link-loss-question" data-modal>
        <header className="w2-dialog-head"><AlertDialog.Title>{shown.title}</AlertDialog.Title></header>
        <AlertDialog.Description className="w2-dialog-text">{shown.text}</AlertDialog.Description>
        <div className="w2-linked-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className={shown.tone === 'plain' ? 'w2-primary' : 'w2-danger-button'} onClick={onConfirm}>{shown.confirm}</button>
        </div>
      </AlertDialog.Popup>}
    </AlertDialog.Viewport></AlertDialog.Portal>
  </AlertDialog.Root>;
}

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
/** What a field's type change says when it removes linked values or saved canvas layouts. */
export const fieldTypeWords = {
  title: (label: string, type: string) => label ? `Change ${label} to ${type}?` : `Change to ${type}?`,
  text: (bindings: number, layouts: number, type: string) => {
    const parts = [bindings ? counted(bindings, 'linked value') : '', layouts ? counted(layouts, 'saved canvas layout') : ''].filter(Boolean);
    return `${parts.join(' and ')} can't carry over to ${type}, so ${bindings + layouts === 1 ? 'it' : 'they'} will be removed.`;
  },
  confirm: 'Change Type',
} as const;
