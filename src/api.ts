export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export const apiUrl = (path: string) => `./${path.replace(/^\/+/, '')}`;

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), { ...init, headers: { ...(init?.body === undefined || init.body === null ? {} : { 'Content-Type': 'application/json' }), ...init?.headers } });
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; }
  catch { throw new ApiError(`The server returned an unreadable response (${response.status}).`, response.status); }
  if (!response.ok) {
    const details = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const message = Array.isArray(details.errors) ? details.errors.join('\n') : typeof details.error === 'string' ? details.error : typeof details.message === 'string' ? details.message : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}
