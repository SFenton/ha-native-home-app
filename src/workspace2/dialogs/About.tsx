import { useState } from 'react';
import { apiUrl } from '../../api';
import { toastManager } from '../toasts';
import { copyText } from '../util';
import type { Workspace2 } from '../useWorkspace2';

/** Project > About (spec 5.7): the identifiers and the preview address, each copyable, and "Freeze a Local Revision". */
export default function About({ ws }: { ws: Workspace2 }) {
  const envelope = ws.studio.envelope;
  const [frozen, setFrozen] = useState<number>();
  const address = new URL(apiUrl('/native/api/published'), window.location.href).href;
  const row = (label: string, value: string) => <div className="w2-row w2-about-row"><span className="w2-row-label">{label}</span><code>{value}</code>
    <button type="button" aria-label={`Copy ${label}`} onClick={async () => { if (await copyText(value)) toastManager.add({ title: 'Copied' }); }}>Copy</button></div>;
  return <>
    {row('Publisher ID', envelope?.publisherId ?? '')}{row('Document ID', ws.document?.id ?? '')}{row('Preview address', address)}
    {row('Capabilities', (envelope?.capabilities ?? []).join(', '))}{row('Manifest', envelope?.assetManifestSha256 ?? '')}
    <div className="w2-actions"><button type="button" disabled={ws.problemCount > 0 || ws.studio.busy} onClick={async () => {
      if (await ws.persist(true)) { setFrozen(ws.studio.envelope?.revision); ws.log('Froze a local revision'); }
    }}>Freeze a Local Revision</button></div>
    {frozen !== undefined && <p role="status" className="w2-caption">Frozen as revision {frozen}.</p>}
  </>;
}
