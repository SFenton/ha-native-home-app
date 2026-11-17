import { apiUrl } from '../api';

/** Where the Studio's server serves one `image` or `camera` entity's picture (`GET /api/live/picture/:entityId`). */
export const PICTURE_PATH = 'api/live/picture';

/**
 * Reads one picture through the Studio's own server, which holds the Home Assistant token: the page never talks to Home Assistant. Answers
 * `undefined` when the server has no picture (not connected, an entity the draft does not name); throws when the request itself fails, so the
 * caller keeps the last picture it has. Pass it as `Preview2`'s `mapPicture` only while the live state stream is open.
 */
export async function fetchPicture(entityId: string, signal: AbortSignal): Promise<ArrayBuffer | undefined> {
  const response = await fetch(apiUrl(`${PICTURE_PATH}/${encodeURIComponent(entityId)}`), { signal, cache: 'no-store' });
  if (response.status === 404 || response.status === 503) return undefined;
  if (!response.ok) throw new Error(`The picture could not be loaded (${response.status}).`);
  return response.arrayBuffer();
}
