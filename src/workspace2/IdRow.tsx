import { copyText } from './util';
import { toastManager } from './toasts';

/** The ID row of an Advanced page: read-only, with a Copy button. */
export default function IdRow({ id, path }: { id: string; path: string }) {
  return <div className="w2-row w2-id-row" data-field-path={path}><span className="w2-row-label">ID</span><code>{id}</code>
    <button type="button" onClick={async () => { if (await copyText(id)) toastManager.add({ title: 'Copied' }); }}>Copy</button></div>;
}
