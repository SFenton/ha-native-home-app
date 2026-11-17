import type { Workspace2 } from './useWorkspace2';
import LinkedQuestion from './LinkedQuestion';
import SaveComponentDialog from './SaveComponentDialog';

/**
 * Mounts what templates need once per workspace: the edit question, the Save as Template dialog and the one visually hidden status line
 * their results are announced in (`role="status"`, shared with every command that says what it did).
 */
export default function LinkedHost({ ws }: { ws: Workspace2 }) {
  return <>
    <LinkedQuestion gate={ws.linked}/>
    <SaveComponentDialog gate={ws.linked} document={ws.document}/>
    <div className="w2-sr" role="status" aria-live="polite" data-testid="linked-status">{ws.linked.status}</div>
  </>;
}
