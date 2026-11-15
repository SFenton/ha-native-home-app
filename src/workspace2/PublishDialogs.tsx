import { Modal } from './kit';
import type { Workspace2 } from './useWorkspace2';
import { toastManager } from './toasts';

/** Publish to the app (spec 9): confirm, publishing, failed. One dialog; the buttons change with the phase. */
export function PublishDialog({ ws }: { ws: Workspace2 }) {
  const { phase, liveRevision, problemCount, publishError } = ws;
  const open = phase !== 'idle';
  const busy = phase === 'publishing';
  const blocked = problemCount > 0;
  const text = busy ? 'Publishing…'
    : phase === 'failed' ? publishError || 'Publishing did not finish.'
      : blocked ? `Fix ${problemCount} problem${problemCount === 1 ? '' : 's'} to publish.`
        : liveRevision ? `Revision ${liveRevision + 1} replaces revision ${liveRevision}. The app updates right away.` : 'This is the first published layout.';
  return <Modal open={open} onOpenChange={next => { if (!next && !busy) ws.closePublish(); }} size="s" dismissable={!busy}
    title={phase === 'failed' ? 'Publishing Failed' : 'Publish to the App?'}
    footer={<>
      <button type="button" disabled={busy} onClick={ws.closePublish}>Cancel</button>
      <button type="button" className="w2-primary" disabled={busy || blocked} onClick={async () => { if (await ws.publish()) toastManager.add({ title: 'Published' }); }}>{phase === 'failed' ? 'Try Again' : 'Publish'}</button>
    </>}>
    <p className="w2-dialog-text" role={busy || phase === 'failed' ? 'status' : undefined} data-phase={phase}>{text}</p>
  </Modal>;
}

/** The conflict dialog (spec 9): the draft changed somewhere else. "Decide Later" leaves the tag at Not Saved. */
export function ConflictDialog({ ws }: { ws: Workspace2 }) {
  const { studio } = ws;
  const open = studio.conflict && !ws.conflictDecided;
  return <Modal open={open} onOpenChange={() => {}} dismissable={false} size="s" title="This Draft Changed Somewhere Else" description="Choose which version to keep."
    footer={<>
      <button type="button" disabled={studio.busy} onClick={ws.decideLater}>Decide Later</button>
      <button type="button" disabled={studio.busy} onClick={() => void studio.reload()}>Use the Server Version</button>
      <button type="button" className="w2-primary" disabled={studio.busy} onClick={() => void ws.persist(false, true)}>Keep Mine</button>
    </>}/>;
}
