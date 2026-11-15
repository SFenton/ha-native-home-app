import { randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { once } from 'node:events';
import { stringify } from 'yaml';
import { z } from 'zod/v4';
import { actionSchema, assertJsonBounds, DocumentValidationError, MAX_DOCUMENT_BYTES, studioDocumentSchema, validateDocument } from '../src/shared/schema';
import type { ServerConfig } from './config';
import { HomeAssistantClient } from './ha';
import { HttpError, StudioStore } from './store';
import { readEndpointQuery } from './read-endpoints';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { validateCompositionPublication } from './composition';
import { canonicalCompositionJSON, CompositionValidationError, MAX_COMPOSITION_ENVELOPE_BYTES, parseCompositionJSON } from '../src/shared/composition/json';
import { compositionDocumentSchema } from '../src/shared/composition/schema';
import { MAX_COMPOSITION_ASSET_BYTES } from './composition-assets';
import { importHouseLayout } from '../src/shared/composition/house-import';
import { formatCompositionIssue } from '../src/shared/composition/workspace';

const revision = z.number().int().positive();
const documentRequestLimit = MAX_DOCUMENT_BYTES + 64 * 1024;
const writeSchema = z.object({ document: z.unknown(), expectedRevision: revision }).strict();
const publishSchema = z.object({ expectedRevision: revision }).strict();
const feedbackSchema = z.object({
  kind: z.enum(['report-issue', 'request-feature']),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(10000),
}).strict();
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
  if ((config.production || config.haToken || config.supervisorToken || config.readEndpoints?.length) && !config.authToken && !config.ingress) throw new Error('Production, credentialed HA connections and registered read endpoints require STUDIO_AUTH_TOKEN or verified Supervisor Ingress');
  const app = express();
  const ha = new HomeAssistantClient(config);
  const sessions = new Map<string, number>();
  const rateLimits = new Map<string, { count: number; until: number }>();
  const authenticated = (req: Request) => {
    const header = req.get('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const cookie = req.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith('studio_session='))?.slice('studio_session='.length);
    return Boolean((config.authToken && bearer && equalSecret(bearer, config.authToken)) ||
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
  app.use(['/api/draft', '/api/validate'], express.json({ limit: documentRequestLimit, strict: true }));
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
    if (authenticated(req) || (!config.production && !config.authToken && !config.ingress)) { next(); return; }
    if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api/') && !req.path.startsWith('/native/api/')) {
      const nonce = randomBytes(16).toString('base64');
      res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`);
      res.status(401).type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Native Home Studio - Sign in</title><style>body{font:16px system-ui;max-width:28rem;margin:15vh auto;padding:24px}input,button{box-sizing:border-box;font:inherit;padding:12px;width:100%;margin:8px 0}</style><h1>Native Home Studio</h1><p>Enter the authoring token configured by your administrator.</p><form><label for="token">Authoring token</label><input id="token" type="password" autocomplete="current-password" required><button>Sign in</button><p id="error" role="alert"></p></form><script nonce="${nonce}">document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();try{const r=await fetch('./api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:document.querySelector('input').value})});if(!r.ok)throw Error('Sign-in failed');location.reload()}catch(e){document.querySelector('#error').textContent=e.message}})</script></html>`);
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
  app.get('/api/draft', (_req, res) => { res.json(store.getDraft()); });
  app.put('/api/draft', async (req, res) => {
    const body = writeSchema.parse(req.body);
    res.json(await store.save(validateDocument(body.document), body.expectedRevision));
  });
  app.post('/api/validate', (req, res) => {
    const body = z.object({ document: z.unknown() }).strict().parse(req.body);
    try { validateDocument(body.document); res.json({ valid: true, errors: [] }); }
    catch (error) {
      if (!(error instanceof DocumentValidationError)) throw error;
      res.json({ valid: false, errors: error.errors });
    }
  });
  // The schema-1 workspace is a design-only preview now: the app reads no schema-1 document, so nothing here publishes one.
  app.get('/api/export', (req, res) => {
    const query = z.object({ format: z.enum(['json', 'yaml']).default('json'), source: z.literal('draft').default('draft') }).strict().parse(req.query);
    const envelope = store.getDraft();
    res.set('Content-Disposition', `attachment; filename="native-home-${query.source}.${query.format === 'yaml' ? 'yaml' : 'json'}"`);
    res.type(query.format === 'yaml' ? 'application/yaml' : 'application/json').send(query.format === 'yaml' ? stringify(envelope.document) : `${JSON.stringify(envelope.document, null, 2)}\n`);
  });
  app.get('/api/health', async (_req, res) => {
    res.json({ status: 'ok', mode: ha.configured ? 'live' : 'sample', haConnected: await ha.probe(), draftRevision: store.getDraft().revision, liveActionsEnabled: config.enableLiveActions, feedbackMode: 'local-queue', schemaVersion: '1.0' });
  });
  app.get('/api/schema', (_req, res) => {
    res.json({ ...z.toJSONSchema(studioDocumentSchema, { target: 'draft-7' }), 'x-semantic-validation': 'POST api/validate additionally checks references, uniqueness, safe URLs and bounded nesting.' });
  });
  app.get('/api/native-home', async (req, res) => {
    if (!authenticated(req)) throw new HttpError(401, 'Authentication required');
    const cancelled = new AbortController();
    const close = () => { if (!res.writableEnded) cancelled.abort(); };
    res.once('close', close);
    try { res.json(await ha.nativeHome(cancelled.signal)); }
    finally { res.removeListener('close', close); }
  });
  app.get('/api/native-wallpaper', async (req, res) => {
    if (!authenticated(req)) throw new HttpError(401, 'Authentication required');
    const { image, type } = await ha.wallpaper();
    res.type(type).send(image);
  });
  app.use('/api/cameras', (req, _res, next) => {
    if (!authenticated(req)) throw new HttpError(401, 'Authentication required');
    const release = req.method === 'DELETE' && /^\/streams\/[a-f0-9]{32}$/.test(req.path);
    if (req.method !== 'GET' && !release) throw new HttpError(405, 'Camera reads require GET; leases may be released with DELETE');
    if (!sameOrigin(req, config)) throw new HttpError(403, 'Cross-origin camera reads are not allowed');
    if (Object.keys(req.query).length || req.get('range')) throw new HttpError(400, 'Camera reads do not accept query parameters or ranges');
    next();
  });
  const readWithCancellation = async (res: Response, read: (signal: AbortSignal) => Promise<void>) => {
    const cancelled = new AbortController();
    const close = () => { if (!res.writableEnded) cancelled.abort(); };
    res.once('close', close);
    try { await read(cancelled.signal); }
    finally { res.removeListener('close', close); }
  };
  app.get('/api/cameras/:entityId/stream', async (req, res) => {
    await readWithCancellation(res, async signal => { res.json(await ha.cameras.open(req.params.entityId, signal)); });
  });
  app.get('/api/cameras/:entityId/mjpeg', async (req, res) => {
    await readWithCancellation(res, async signal => { res.json(await ha.cameras.open(req.params.entityId, signal, 'mjpeg')); });
  });
  app.delete('/api/cameras/streams/:streamId', (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json({ released: ha.cameras.release(req.params.streamId) });
  });
  app.get('/api/cameras/streams/:streamId/live.mjpeg', async (req, res) => {
    await readWithCancellation(res, async signal => {
      for await (const part of ha.cameras.mjpeg(req.params.streamId, signal)) {
        if (!res.headersSent) res.set({
          'Content-Type': 'multipart/x-mixed-replace; boundary=studio-camera',
          'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no',
        });
        if (!res.write(part)) await once(res, 'drain', { signal: AbortSignal.any([signal, ha.cameras.signal, AbortSignal.timeout(20_000)]) });
      }
      res.end();
    });
  });
  const cameraMedia = async (req: Request, res: Response, segment = false) => {
    await readWithCancellation(res, async signal => {
      const file = `${segment ? 'segment/' : ''}${req.params.file}`;
      const media = await ha.cameras.read(String(req.params.streamId), file, signal);
      res.set('Cache-Control', 'private, no-store').type(media.type).send(media.body);
    });
  };
  app.get('/api/cameras/streams/:streamId/:file', (req, res) => cameraMedia(req, res));
  app.get('/api/cameras/streams/:streamId/segment/:file', (req, res) => cameraMedia(req, res, true));
  app.get('/api/data/:id', async (req, res) => {
    const query = readEndpointQuery(req.query);
    const source = store.getDraft().document.dataSources.find((item) => item.id === req.params.id);
    if (!source) throw new HttpError(404, 'Unknown data source');
    if (source.kind === 'endpoint' && req.method !== 'GET') throw new HttpError(405, 'Read endpoints require GET');
    if ((source.kind === 'endpoint' || ['house-states', 'house-profile'].includes(source.endpoint ?? '')) && !authenticated(req)) throw new HttpError(401, 'Authentication required');
    await readWithCancellation(res, async signal => { res.json(await ha.data(source, query, signal)); });
  });
  app.all('/api/data/:id', (req, _res, next) => {
    const source = store.getDraft().document.dataSources.find(item => item.id === req.params.id);
    if (source?.kind === 'endpoint') {
      if (!authenticated(req)) throw new HttpError(401, 'Authentication required');
      throw new HttpError(405, 'Read endpoints require GET');
    }
    next();
  });
  app.use('/api/read-endpoints', (req, _res, next) => {
    if (!authenticated(req)) throw new HttpError(401, 'Authentication required');
    if (req.method !== 'GET') throw new HttpError(405, 'Read endpoint discovery requires GET');
    if (Object.keys(req.query).length) throw new HttpError(400, 'Read endpoint discovery does not accept query parameters');
    next();
  });
  app.get('/api/read-endpoints', (_req, res) => { res.json(ha.readEndpoints.metadata()); });
  app.post('/api/actions/execute', async (req, res) => {
    assertJsonBounds(req.body);
    const body = z.object({ action: actionSchema, confirmed: z.boolean().optional() }).strict().parse(req.body);
    const document = store.getDraft().document;
    // Reuse document semantics to check references and service targets for ad-hoc preview actions.
    document.pages[0].toolbar = [{ id: `execute-${randomBytes(8).toString('hex')}`, label: 'Execute', icon: 'Play', placement: 'trailing', action: body.action }];
    validateDocument(document);
    if (body.action.type === 'service') { res.json(await ha.execute(body.action, body.confirmed === true)); return; }
    res.json({ mode: 'simulated', executed: false, actionType: body.action.type });
  });
  app.post('/api/feedback', async (req, res) => {
    res.status(201).json(await store.queueFeedback(feedbackSchema.parse(req.body)));
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Unknown API endpoint' }); });

  const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.destroyed) return;
    if (res.headersSent) { res.end(); return; }
    if (error instanceof CompositionValidationError) {
      res.status(422).json({ error: error.message, issues: error.issues, errors: error.issues.map(formatCompositionIssue) }); return;
    }
    if (error instanceof DocumentValidationError) { res.status(422).json({ error: error.message, errors: error.errors }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid request', errors: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: error.message, ...(error.details && typeof error.details === 'object' ? error.details : {}) }); return; }
    if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large') {
      const limit = 'limit' in error && error.limit === MAX_COMPOSITION_ASSET_BYTES ? '8 MiB'
        : 'limit' in error && error.limit === MAX_COMPOSITION_ENVELOPE_BYTES ? '2 MiB plus 64 KiB of envelope space'
        : 'limit' in error && error.limit === documentRequestLimit ? '1 MiB plus 64 KiB of envelope space' : '1 MiB';
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
