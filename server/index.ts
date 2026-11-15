import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { buildAllowedHosts } from './allowed-hosts';
import { createApp } from './app';
import { discoverIngress, loadConfig } from './config';
import { StudioStore } from './store';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = await discoverIngress(loadConfig());
const store = await StudioStore.open(config.dataDir);
let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
try {
  const application = createApp(store, config);
  const server = http.createServer(application.app);
  if (config.production) {
    application.app.use(express.static(path.join(root, 'dist'), { index: false, dotfiles: 'deny', maxAge: 0 }));
    application.app.get('/{*path}', async (req, res) => {
      if (path.extname(req.path)) { res.status(404).end(); return; }
      res.type('html').send(await readFile(path.join(root, 'dist', 'index.html'), 'utf8'));
    });
  } else {
    const { createServer } = await import('vite');
    vite = await createServer({ root, server: { middlewareMode: true, hmr: { server }, allowedHosts: buildAllowedHosts() }, appType: 'custom' });
    application.app.use(vite.middlewares);
    application.app.get('/{*path}', async (req, res) => {
      const template = await readFile(path.join(root, 'index.html'), 'utf8');
      res.type('html').send(await vite!.transformIndexHtml(req.originalUrl, template));
    });
  }
  application.app.use(application.errorHandler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => { server.off('error', reject); resolve(); });
  });
  console.log(`S+H Studio listening on ${config.host}:${config.port} (${config.production ? 'production' : 'development'})`);
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    application.close();
    const timeout = setTimeout(() => { server.closeAllConnections(); }, 5000);
    timeout.unref();
    const httpClosed = new Promise<void>((resolve) => { server.close(() => resolve()); server.closeIdleConnections(); });
    // HTTP shutdown alone does not close upgraded hot-reload sockets.
    await vite?.close();
    await httpClosed;
    clearTimeout(timeout);
    await store.close();
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void shutdown().catch(() => { console.error('Studio shutdown failed'); process.exitCode = 1; }); });
  }
} catch (error) {
  await vite?.close();
  await store.close();
  throw error;
}
