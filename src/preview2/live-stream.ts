import type { NativeState } from '../shared/native-state';
import { apiUrl } from '../api';

/** The part of `EventSource` the stream uses, so a test can supply a fake. */
export interface StreamSource {
  addEventListener(type: string, listener: (event: { data?: string }) => void): void;
  close(): void;
}
/** Opens the stream at a URL. */
export type OpenStream = (url: string) => StreamSource;

/** What the stream tells the page. */
export interface LiveStreamHandlers {
  /** The entities the page draws, as of now. */
  onSnapshot(states: NativeState[]): void;
  /** Entities that changed, and those Home Assistant removed. */
  onUpdate(states: NativeState[], removed: string[]): void;
  /** The server's own link to Home Assistant dropped or came back. The states stay as they are. */
  onLink?(connected: boolean): void;
  /** Whether this page's stream is open (`true` from the first frame, `false` while it retries). */
  onOpen?(open: boolean): void;
}

/** Where the stream lives, relative to the page (so a Home Assistant Ingress prefix keeps working). */
export const LIVE_STATES_PATH = 'api/live/states';

const defaultOpen: OpenStream = url => new EventSource(url) as unknown as StreamSource;
const parse = (event: { data?: string }): Record<string, unknown> | undefined => {
  try { const value: unknown = JSON.parse(event.data ?? ''); return value && typeof value === 'object' ? value as Record<string, unknown> : undefined; }
  catch { return undefined; }
};
const list = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

/**
 * Connects to the server's live stream and keeps it connected: when it drops (or the server answers it with an error, which
 * `EventSource` does not retry) it reopens with backoff, and what the page holds is never cleared. Returns the closer.
 */
export function connectLiveStates(handlers: LiveStreamHandlers, options: { open?: OpenStream; url?: string; backoffMs?: { initial: number; max: number } } = {}): () => void {
  // A browser without `EventSource` (and a test without one) keeps the snapshot read alone.
  if (!options.open && typeof EventSource === 'undefined') return () => undefined;
  const { open = defaultOpen, url = apiUrl(LIVE_STATES_PATH), backoffMs = { initial: 1000, max: 15_000 } } = options;
  let source: StreamSource | undefined, timer: ReturnType<typeof setTimeout> | undefined, closed = false, delay = backoffMs.initial;
  const connect = () => {
    if (closed) return;
    const current = open(url);
    source = current;
    const live = () => source === current && !closed;
    current.addEventListener('hello', () => { if (live()) { delay = backoffMs.initial; handlers.onOpen?.(true); } });
    current.addEventListener('snapshot', event => {
      const data = parse(event);
      if (!live() || !data) return;
      delay = backoffMs.initial; handlers.onOpen?.(true); handlers.onSnapshot(list<NativeState>(data.states));
      if (typeof data.connected === 'boolean') handlers.onLink?.(data.connected);
    });
    current.addEventListener('update', event => {
      const data = parse(event);
      if (live() && data) handlers.onUpdate(list<NativeState>(data.states), list<string>(data.removed));
    });
    current.addEventListener('status', event => {
      const data = parse(event);
      if (live() && data && typeof data.connected === 'boolean') handlers.onLink?.(data.connected);
    });
    current.addEventListener('error', () => {
      if (!live()) return;
      current.close(); source = undefined;
      handlers.onOpen?.(false);
      timer = setTimeout(connect, delay);
      delay = Math.min(backoffMs.max, delay * 2);
    });
  };
  connect();
  return () => { closed = true; clearTimeout(timer); source?.close(); source = undefined; };
}
