import { randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod/v4';
import { isLoopbackHost, localDevelopment, type ServerConfig } from './config';
import { HomeAssistantClient } from './ha';
import { HttpError, StudioStore } from './store';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { validateCompositionPublication } from './composition';
import { canonicalCompositionJSON, CompositionValidationError, MAX_COMPOSITION_ENVELOPE_BYTES, parseCompositionJSON } from '../src/shared/composition/json';
import { compositionDocumentSchema } from '../src/shared/composition/schema';
import { MAX_COMPOSITION_ASSET_BYTES } from './composition-assets';
import { importHouseLayout } from '../src/shared/composition/house-import';
import { formatCompositionIssue } from '../src/shared/composition/workspace';

const revision = z.number().int().positive();
const writeSchema = z.object({ document: z.unknown(), expectedRevision: revision }).strict();
const publishSchema = z.object({ expectedRevision: revision }).strict();
function equalSecret(actual: string, expected: string) {
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
function normalizeAddress(address: string | undefined) { return address?.replace(/^::ffff:/, ''); }
function validIngress(req: Request, config: ServerConfig) {
  const ingress = config.ingress;
  return Boolean(ingress && normalizeAddress(req.socket.remoteAddress) === normalizeAddress(ingress.proxyAddress) &&
    req.get('X-Ingress-Path')?.replace(/\/$/, '') === ingress.path &&
    /^[A-Za-z0-9_-]{1,128}$/.test(req.get('X-Remote-User-Id') ?? '') &&
    req.get('X-Remote-User-Groups')?.split(',').map((group) => group.trim()).includes('system-admin'));
}
function sameOrigin(req: Request, config: ServerConfig) {
  const origin = req.get('origin');
  if (origin === 'null') return false;
  if (!origin) return !req.get('sec-fetch-site') || req.get('sec-fetch-site') === 'same-origin';
  try {
    const url = new URL(origin);
    const host = validIngress(req, config) ? (req.get('x-forwarded-host') ?? req.get('host')) : req.get('host');
    return ['http:', 'https:'].includes(url.protocol) && url.host === host && (!req.get('sec-fetch-site') || req.get('sec-fetch-site') === 'same-origin');
  } catch { return false; }
}

export function createApp(store: StudioStore, config: ServerConfig) {
  const localDev = localDevelopment(config);
  const credentialed = Boolean(config.haToken);
  if ((config.production || config.supervisorToken || (credentialed && !localDev)) && !config.authToken && !config.ingress) throw new Error('Production and credentialed HA connections require STUDIO_AUTH_TOKEN or verified Supervisor Ingress');
  // Local development has no sign-in, so a server holding credentials must not be reachable from the network.
  if (localDev && credentialed && !isLoopbackHost(config.host)) throw new Error('Local development without STUDIO_AUTH_TOKEN with HA credentials must bind to a loopback HOST (for example 127.0.0.1), or set STUDIO_AUTH_TOKEN');
  const app = express();
  const ha = new HomeAssistantClient(config);
  const sessions = new Map<string, number>();
  const rateLimits = new Map<string, { count: number; until: number }>();
  const authenticated = (req: Request) => {
    const header = req.get('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const cookie = req.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith('studio_session='))?.slice('studio_session='.length);
    return localDev || Boolean((config.authToken && bearer && equalSecret(bearer, config.authToken)) ||
      (cookie && (sessions.get(cookie) ?? 0) > Date.now()) || validIngress(req, config));
  };
  let stopping = false;
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
    if (stopping) { res.status(503).json({ error: 'Server is shutting down' }); return; }
    // Encoded separators and traversal have no legitimate use in the Studio API.
    if (/%(?:2f|5c|00|2e)/i.test(req.originalUrl.split('?')[0]) || req.path.split('/').some((part) => part === '..' || part === '.') || req.path.includes('\\')) {
      res.status(400).json({ error: 'Invalid request path' }); return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!sameOrigin(req, config)) { res.status(403).json({ error: 'Cross-origin writes are not allowed' }); return; }
      const nativeImage = req.method === 'POST' && req.path === '/native/api/assets' && (req.is('image/png') || req.is('image/jpeg'));
      if (!req.is('application/json') && !nativeImage) { res.status(415).json({ error: 'Writes require application/json (native image uploads require image/png or image/jpeg)' }); return; }
      const now = Date.now();
      for (const [key, limit] of rateLimits) if (limit.until <= now) rateLimits.delete(key);
      const login = req.path === '/api/auth' || req.path === '/native/api/auth';
      const key = `${login ? 'login' : 'write'}:${normalizeAddress(req.socket.remoteAddress) ?? 'unknown'}`;
      let limit = rateLimits.get(key);
      if (!limit) {
        if (rateLimits.size >= 1024) { res.status(429).json({ error: 'Too many active writers' }); return; }
        limit = { count: 0, until: now + 60000 };
        rateLimits.set(key, limit);
      }
      limit.count += 1;
      if (limit.count > (login ? 10 : 180)) { res.set('Retry-After', '60').status(429).json({ error: 'Too many requests; retry in one minute' }); return; }
    }
    next();
  });
  app.use('/native/api/assets', express.raw({ type: ['image/png', 'image/jpeg'], limit: MAX_COMPOSITION_ASSET_BYTES }));
  app.use('/native/api', express.raw({ type: 'application/json', limit: MAX_COMPOSITION_ENVELOPE_BYTES }));
  app.use(express.json({ limit: '1mb', strict: true }));
  app.post(['/api/auth', '/native/api/auth'], (req, res) => {
    if (Buffer.isBuffer(req.body)) req.body = parseCompositionJSON(req.body);
    if (!config.authToken || typeof req.body?.token !== 'string' || !equalSecret(req.body.token, config.authToken)) { res.status(401).json({ error: 'Invalid authoring token' }); return; }
    const id = randomBytes(32).toString('hex');
    const now = Date.now();
    for (const [key, expires] of sessions) if (expires < now) sessions.delete(key);
    if (sessions.size >= 100) { res.status(429).json({ error: 'Too many active authoring sessions' }); return; }
    sessions.set(id, now + 8 * 60 * 60 * 1000);
    const secure = ('encrypted' in req.socket && Boolean(req.socket.encrypted)) || req.get('origin')?.startsWith('https://');
    res.cookie('studio_session', id, { httpOnly: true, sameSite: 'strict', secure: Boolean(secure), path: '/', maxAge: 8 * 60 * 60 * 1000 });
    res.json({ authenticated: true });
  });
  app.use((req, res, next) => {
    if (authenticated(req)) { next(); return; }
    if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api/') && !req.path.startsWith('/native/api/')) {
      const nonce = randomBytes(16).toString('base64');
      res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`);
      res.status(401).type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>S+H Studio - Sign in</title><style>body{font:16px system-ui;max-width:28rem;margin:15vh auto;padding:24px}input,button{box-sizing:border-box;font:inherit;padding:12px;width:100%;margin:8px 0}</style><h1>S+H Studio</h1><p>Enter the authoring token configured by your administrator.</p><form><label for="token">Authoring token</label><input id="token" type="password" autocomplete="current-password" required><button>Sign in</button><p id="error" role="alert"></p></form><script nonce="${nonce}">document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();try{const r=await fetch('./api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:document.querySelector('input').value})});if(!r.ok)throw Error('Sign-in failed');location.reload()}catch(e){document.querySelector('#error').textContent=e.message}})</script></html>`);
      return;
    }
    res.status(401).json({ error: 'Authentication required' });
  });
  app.use('/native/api', (req, _res, next) => {
    if (!authenticated(req)) throw new HttpError(401, 'Authentication required for native composition');
    if (Buffer.isBuffer(req.body) && req.is('application/json')) req.body = parseCompositionJSON(req.body);
    next();
  });
  app.get('/native/api/draft', (_req, res) => { res.json(store.native.getDraft()); });
  app.put('/native/api/draft', async (req, res) => {
    const body = writeSchema.parse(req.body);
    res.json(await store.native.save(body.document, body.expectedRevision));
  });
  // Adds the layout house configuration used to carry (chores pages, rooms) to the draft: only what the draft does not yet
  // author, and a list of every house-config behaviour the publication cannot express. Reads house config; writes only the draft.
  app.post('/native/api/import-house-config', async (req, res) => {
    const { expectedRevision } = publishSchema.parse(req.body);
    const draft = store.native.getDraft();
    if (draft.revision !== expectedRevision) throw new HttpError(409, 'The draft changed; reload and import again');
    const imported = importHouseLayout(compositionDocumentSchema.parse(draft.document), await ha.houseConfig());
    const saved = imported.added.length > 0 ? await store.native.save(imported.document, expectedRevision) : draft;
    res.json({ revision: saved.revision, added: imported.added, kept: imported.kept, dropped: imported.dropped });
  });
  app.post('/native/api/validate', (req, res) => {
    const body = z.strictObject({ document: z.unknown() }).parse(req.body);
    const { capabilities } = compileCompositionDocument(body.document);
    res.json({ valid: true, capabilities });
  });
  app.post('/native/api/publish', async (req, res) => {
    res.json(await store.native.publish(publishSchema.parse(req.body).expectedRevision));
  });
  // Publish to Home Assistant (`fenton_home` integration): the production delivery path. The Studio's own
  // /native/api/published stays only as the DEBUG publication preview; nothing authenticates a native reader to it.
  app.get('/native/api/ha/publication', async (_req, res) => { res.json(await ha.publication.get()); });
  // The services Home Assistant offers, for the Studio's service picker. Read only, reduced server-side (no credentials, no examples).
  app.get('/native/api/ha/services', async (req, res) => {
    const cancelled = new AbortController();
    res.once('close', () => { if (!res.writableEnded) cancelled.abort(); });
    res.json(await ha.services(cancelled.signal));
  });
  app.post('/native/api/ha/publish', async (req, res) => {
    const { expectedRevision } = publishSchema.parse(req.body);
    const published = await store.native.publish(expectedRevision);
    res.json(await ha.publication.publish(published, name => store.native.readAsset(name)));
  });
  app.post('/native/api/ha/rollback', async (req, res) => {
    res.json(await ha.publication.rollback(z.strictObject({ revision: revision }).parse(req.body).revision));
  });
  app.get('/native/api/published', (req, res) => {
    const published = store.native.getPublished();
    const etag = `"native-${published.publisherId}-${published.revision}"`;
    res.set({ ETag: etag, 'Cache-Control': 'private, no-cache' });
    if (req.get('if-none-match')?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')) {
      res.status(304).end(); return;
    }
    res.json(published);
  });
  app.get('/native/api/schema', (_req, res) => {
    res.json(z.toJSONSchema(compositionDocumentSchema, { target: 'draft-7' }));
  });
  app.get('/native/api/export', (req, res) => {
    const { source } = z.strictObject({ source: z.enum(['draft', 'published']).default('draft') }).parse(req.query);
    const envelope = source === 'draft' ? store.native.getDraft() : store.native.getPublished();
    res.set('Content-Disposition', `attachment; filename="native-composition-${source}.json"`);
    res.type('application/json').send(`${canonicalCompositionJSON(envelope.document)}\n`);
  });
  app.get('/native/api/assets', async (_req, res) => { res.json(await store.native.listAssets()); });
  app.post('/native/api/assets', async (req, res) => {
    if (!Buffer.isBuffer(req.body) || (!req.is('image/png') && !req.is('image/jpeg'))) throw new HttpError(415, 'Upload raw image/png or image/jpeg bytes');
    res.status(201).json(await store.native.upload(req.body, req.is('image/png') ? 'image/png' : 'image/jpeg'));
  });
  app.get('/native/api/assets/:name', async (req, res) => {
    const { asset, bytes } = await store.native.readAsset(req.params.name);
    const etag = `"${asset.sha256}"`;
    res.set({ ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' });
    if (req.get('if-none-match')?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')) {
      res.status(304).end(); return;
    }
    res.type(asset.mimeType).send(bytes);
  });
  app.use('/native/api', (_req, res) => { res.status(404).json({ error: 'Unknown native API endpoint' }); });
  app.get('/api/health', async (_req, res) => {
    res.json({ status: 'ok', mode: ha.configured ? 'live' : 'sample', haConnected: await ha.probe(), draftRevision: store.native.getDraft().revision });
  });
  app.get('/api/native-home', async (req, res) => {
    if (!authenticated(req)) throw new HttpError(401, 'Authentication required');
    const cancelled = new AbortController();
    const close = () => { if (!res.writableEnded) cancelled.abort(); };
    res.once('close', close);
    try { res.json(await ha.nativeHome(cancelled.signal)); }
    finally { res.removeListener('close', close); }
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Unknown API endpoint' }); });

  const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.destroyed) return;
    if (res.headersSent) { res.end(); return; }
    if (error instanceof CompositionValidationError) {
      res.status(422).json({ error: error.message, issues: error.issues, errors: error.issues.map(formatCompositionIssue) }); return;
    }
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid request', errors: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: error.message, ...(error.details && typeof error.details === 'object' ? error.details : {}) }); return; }
    if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large') {
      const limit = 'limit' in error && error.limit === MAX_COMPOSITION_ASSET_BYTES ? '8 MiB'
        : 'limit' in error && error.limit === MAX_COMPOSITION_ENVELOPE_BYTES ? '2 MiB plus 64 KiB of envelope space' : '1 MiB';
      res.status(413).json({ error: `Request body exceeds ${limit}` }); return;
    }
    if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: 'Malformed JSON request' }); return; }
    console.error('Studio request failed:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'Internal server error; see server logs' });
  };
  return {
    app, errorHandler,
    close() {
      stopping = true;
      ha.close();
      sessions.clear();
      rateLimits.clear();
    },
  };
}
