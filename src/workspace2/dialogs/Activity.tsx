import type { Workspace2 } from '../useWorkspace2';

/** Project > Activity (spec 5.7): simulated calls and saves, newest first. */
export default function Activity({ ws }: { ws: Workspace2 }) {
  return ws.activity.length === 0 ? <p className="w2-empty">Nothing yet.</p> : <ul className="w2-activity">{ws.activity.map(entry => <li key={entry.id}>{entry.text}</li>)}</ul>;
}
