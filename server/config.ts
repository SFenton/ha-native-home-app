import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { loadReadEndpoints, type RegisteredReadEndpoint } from './read-endpoints';

export interface ServerConfig {
  production: boolean;
  port: number;
  host: string;
  dataDir: string;
  authToken?: string;
  haUrl?: string;
  haToken?: string;
  supervisorToken?: string;
  enableLiveActions: boolean;
  ingress?: { proxyAddress: string; path: string };
  readEndpoints?: readonly RegisteredReadEndpoint[];
}

/**
 * Local development: not production, no Supervisor Ingress, no Supervisor credential and no `STUDIO_AUTH_TOKEN`.
 * Every route works without signing in; setting a token (or running behind Ingress or in production) turns protection on.
 */
export function localDevelopment(config: Pick<ServerConfig, 'production' | 'ingress' | 'authToken' | 'supervisorToken'>) {
  return !config.production && !config.ingress && !config.authToken && !config.supervisorToken;
}

/** True for a loopback bind address (`localhost`, `127.0.0.0/8`, `::1`, or the IPv4-mapped form). */
export function isLoopbackHost(host: string) {
  const bare = host.replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '').toLowerCase();
  return bare === 'localhost' || bare === '::1' || /^127(?:\.\d{1,3}){3}$/.test(bare);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT ?? 4800);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
  if (env.STUDIO_AUTH_TOKEN && env.STUDIO_AUTH_TOKEN.length < 24) throw new Error('STUDIO_AUTH_TOKEN must contain at least 24 characters');
  if (env.HA_TOKEN && !env.HA_URL) throw new Error('HA_TOKEN requires HA_URL');
  let haUrl: string | undefined;
  if (env.HA_URL) {
    let url: URL;
    try { url = new URL(env.HA_URL); }
    catch { throw new Error('HA_URL must be a valid HTTP(S) origin'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('HA_URL must be an HTTP(S) origin without credentials or paths');
    haUrl = url.origin;
  }
  return {
    production, port, host: env.HOST ?? '0.0.0.0', dataDir: env.DATA_DIR ?? './data',
    authToken: env.STUDIO_AUTH_TOKEN || undefined,
    haUrl, haToken: env.HA_TOKEN,
    supervisorToken: env.SUPERVISOR_TOKEN,
    enableLiveActions: env.ENABLE_LIVE_ACTIONS === 'true',
    readEndpoints: loadReadEndpoints(env.STUDIO_READ_ENDPOINTS_FILE, env, [env.HA_TOKEN ?? '', env.SUPERVISOR_TOKEN ?? '', env.STUDIO_AUTH_TOKEN ?? '']),
  };
}

export async function discoverIngress(config: ServerConfig): Promise<ServerConfig> {
  if (!config.supervisorToken) return config;
  const response = await fetch('http://supervisor/addons/self/info', {
    headers: { Authorization: `Bearer ${config.supervisorToken}` },
    signal: AbortSignal.timeout(5000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Supervisor refused app metadata discovery');
  const result: unknown = await response.json();
  const ingressUrl = typeof result === 'object' && result !== null && 'data' in result && typeof result.data === 'object' && result.data !== null && 'ingress_url' in result.data ? result.data.ingress_url : undefined;
  if (typeof ingressUrl !== 'string' || !/^\/api\/hassio_ingress\/[A-Za-z0-9_-]+\/?$/.test(ingressUrl)) throw new Error('Supervisor did not provide a valid Ingress path; refusing header-only authentication');
  const { address } = await lookup('supervisor', { family: 4 });
  if (!isIP(address)) throw new Error('Supervisor proxy address could not be verified');
  return { ...config, ingress: { proxyAddress: address, path: ingressUrl.replace(/\/$/, '') } };
}
