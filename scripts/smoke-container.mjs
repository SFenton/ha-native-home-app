import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { chromium } from '@playwright/test';

const image = process.argv[2] ?? 'native-home-studio:check';
const token = randomBytes(32).toString('hex');
let container;
let volume;
let proxy;
let browser;
const docker = (...args) => execFileSync('docker', args, {
  encoding: 'utf8',
  env: { ...process.env, STUDIO_AUTH_TOKEN: token },
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

async function waitUntilReady(base) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${base}/api/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch (error) {
      if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Production container did not become ready within 10 seconds.');
}

try {
  volume = docker('volume', 'create');
  container = docker('run', '--detach', '--rm', '--publish', '127.0.0.1::4800',
    '--mount', `type=volume,source=${volume},target=/data`,
    '--env', 'STUDIO_AUTH_TOKEN', '--env', 'PORT=4800', image);
  const bindings = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', container));
  let base = `http://127.0.0.1:${bindings['4800/tcp'][0].HostPort}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  await waitUntilReady(base);

  assert.equal((await fetch(`${base}/api/draft`)).status, 401, 'Direct API access must require authentication');
  const signIn = await fetch(base);
  assert.equal(signIn.status, 401);
  assert.match(await signIn.text(), /Sign in/i);
  const page = await fetch(base, { headers });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Native Home Studio/);
  const asset = html.match(/src="(\.\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(asset, 'Built HTML must use relative asset paths for Ingress');
  assert.equal((await fetch(new URL(asset, `${base}/`), { headers })).status, 200);

  const draft = await (await fetch(`${base}/api/draft`, { headers })).json();
  draft.document.name = 'Container persistence check';
  const savedResponse = await fetch(`${base}/api/draft`, {
    method: 'PUT', headers,
    body: JSON.stringify({ document: draft.document, expectedRevision: draft.revision }),
  });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  const publishedResponse = await fetch(`${base}/api/publish`, {
    method: 'POST', headers, body: JSON.stringify({ expectedRevision: saved.revision }),
  });
  assert.equal(publishedResponse.status, 200);
  const published = await publishedResponse.json();
  docker('restart', container);
  const restartedBindings = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', container));
  base = `http://127.0.0.1:${restartedBindings['4800/tcp'][0].HostPort}`;
  await waitUntilReady(base);
  const restored = await (await fetch(`${base}/api/published`, { headers })).json();
  assert.equal(restored.revision, published.revision);
  assert.equal(restored.document.name, 'Container persistence check');

  docker('stop', '--time', '10', container);
  container = undefined;
  container = docker('run', '--detach', '--rm', '--publish', '127.0.0.1::4800',
    '--mount', `type=volume,source=${volume},target=/data`,
    '--env', 'STUDIO_AUTH_TOKEN', '--env', 'PORT=4800', image);
  const replacementBindings = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', container));
  base = `http://127.0.0.1:${replacementBindings['4800/tcp'][0].HostPort}`;
  await waitUntilReady(base);
  const afterReplacement = await (await fetch(`${base}/api/published`, { headers })).json();
  assert.deepEqual(afterReplacement, restored, 'Replacing the container must preserve the publication');
  const draftAfterReplacement = await (await fetch(`${base}/api/draft`, { headers })).json();
  assert.equal(draftAfterReplacement.revision, saved.revision);
  assert.deepEqual(draftAfterReplacement.document, saved.document);

  const mount = '/api/hassio_ingress/studio-test/';
  const escapedRequests = [];
  proxy = http.createServer((request, response) => {
    if (!request.url?.startsWith(mount)) {
      escapedRequests.push(request.url);
      response.writeHead(404).end();
      return;
    }
    const upstream = http.request(new URL(request.url.slice(mount.length), `${base}/`), {
      method: request.method,
      headers: { ...request.headers, authorization: `Bearer ${token}` },
    }, result => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502).end(); });
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch();
  const tab = await browser.newPage();
  const browserErrors = [];
  tab.on('pageerror', error => browserErrors.push(error.message));
  await tab.goto(`http://127.0.0.1:${address.port}${mount}`);
  await tab.getByLabel('Page title', { exact: true }).waitFor();
  assert.equal(await tab.getByLabel('Page title', { exact: true }).inputValue(), restored.document.pages[0].title);
  await tab.getByLabel('Page title', { exact: true }).fill('Ingress route check');
  await tab.getByRole('button', { name: /^Save/ }).click();
  await tab.getByText(/Draft saved/).first().waitFor();
  const ingressDraft = await (await fetch(`${base}/api/draft`, { headers })).json();
  assert.equal(ingressDraft.document.pages[0].title, 'Ingress route check');
  assert.deepEqual(browserErrors, []);
  assert.deepEqual(escapedRequests.filter(url => url?.startsWith('/api/')), []);
  console.log('Production container: auth, assets, save/publish, restart/replacement persistence, and mounted-path browser routing passed.');
} finally {
  await browser?.close();
  if (proxy) {
    proxy.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
  }
  if (container) docker('stop', '--time', '10', container);
  if (volume) docker('volume', 'rm', volume);
}
