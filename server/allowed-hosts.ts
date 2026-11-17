import { isIP } from 'node:net';

/**
 * Hosts the development Vite server accepts besides localhost and IP addresses
 * (which Vite always allows). A leading dot matches the domain and its subdomains.
 */
export const DEFAULT_DEV_ALLOWED_HOSTS: readonly string[] = ['.ts.net'];

/**
 * Builds Vite's `server.allowedHosts` list: Tailscale MagicDNS names plus any
 * comma-separated names from `STUDIO_ALLOWED_HOSTS`. Never returns `true`.
 */
export function buildAllowedHosts(env: string | undefined = process.env.STUDIO_ALLOWED_HOSTS): string[] {
  const extra = (env ?? '').split(',').map((host) => host.trim()).filter((host) => host && host !== '*');
  return [...new Set([...DEFAULT_DEV_ALLOWED_HOSTS, ...extra])];
}

/** Names that always resolve to this machine; `.localhost` matches every subdomain. */
const LOOPBACK_NAMES: readonly string[] = ['localhost', '.localhost'];

function hostMatches(hostname: string, entry: string) {
  const name = entry.toLowerCase();
  return name.startsWith('.') ? hostname === name.slice(1) || hostname.endsWith(name) : hostname === name;
}

/**
 * Whether a `Host` header names a host the Studio serves: loopback names, any IP literal (a rebound
 * name resolves to an IP only after the browser already trusted the name, so a literal cannot be rebound),
 * and the shared `buildAllowedHosts()` list that Vite's own guard uses. A missing or malformed header is refused.
 */
export function isAllowedHostHeader(header: string | undefined, allowed: readonly string[] = buildAllowedHosts()): boolean {
  if (!header || /[\s@/?#\\]/.test(header)) return false;
  let hostname: string;
  try { hostname = new URL(`http://${header}`).hostname.toLowerCase(); } catch { return false; }
  if (!hostname) return false;
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return true;
  return [...LOOPBACK_NAMES, ...allowed].some((entry) => hostMatches(hostname, entry));
}
