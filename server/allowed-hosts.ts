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
