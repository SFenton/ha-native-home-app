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
  container = docker('run', '--detach', '--publish', '127.0.0.1::4800',
    '--mount', `type=volume,source=${volume},target=/data`,
    '--env', 'STUDIO_AUTH_TOKEN', '--env', 'PORT=4800', image);
  const bindings = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', container));
  let base = `http://127.0.0.1:${bindings['4800/tcp'][0].HostPort}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  await waitUntilReady(base);

  assert.equal((await fetch(`${base}/native/api/draft`)).status, 401, 'Direct API access must require authentication');
  const signIn = await fetch(base);
  assert.equal(signIn.status, 401);
  assert.match(await signIn.text(), /Sign in/i);
  const page = await fetch(base, { headers });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /S\+H Studio/);
  const asset = html.match(/src="(\.\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(asset, 'Built HTML must use relative asset paths for Ingress');
  assert.equal((await fetch(new URL(asset, `${base}/`), { headers })).status, 200);

  const nativeDraft = await (await fetch(`${base}/native/api/draft`, { headers })).json();
  assert.equal(nativeDraft.document.schemaVersion, '2.0');
  nativeDraft.document.name = 'Native container persistence check';
  const nativeValidation = await fetch(`${base}/native/api/validate`, {
    method: 'POST', headers, body: JSON.stringify({ document: nativeDraft.document }),
  });
  assert.equal(nativeValidation.status, 200);
  assert.equal((await nativeValidation.json()).valid, true);
  const nativeSavedResponse = await fetch(`${base}/native/api/draft`, {
    method: 'PUT', headers,
    body: JSON.stringify({ document: nativeDraft.document, expectedRevision: nativeDraft.revision }),
  });
  assert.equal(nativeSavedResponse.status, 200);
  const nativeSaved = await nativeSavedResponse.json();
  const nativePublishedResponse = await fetch(`${base}/native/api/publish`, {
    method: 'POST', headers, body: JSON.stringify({ expectedRevision: nativeSaved.revision }),
  });
  assert.equal(nativePublishedResponse.status, 200);
  const nativePublished = await nativePublishedResponse.json();
  assert.deepEqual(nativePublished.document, nativeDraft.document);
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const uploadedResponse = await fetch(`${base}/native/api/assets`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: pixel,
  });
  assert.equal(uploadedResponse.status, 201);
  const uploaded = await uploadedResponse.json();
  assert.match(uploaded.source.path, /^\/api\/assets\/[a-f0-9]{64}\.png$/);

  docker('restart', container);
  const restartedBindings = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', container));
  base = `http://127.0.0.1:${restartedBindings['4800/tcp'][0].HostPort}`;
  await waitUntilReady(base);
  const restored = await (await fetch(`${base}/native/api/draft`, { headers })).json();
  assert.equal(restored.revision, nativeSaved.revision);
  assert.equal(restored.document.name, 'Native container persistence check');

  docker('stop', '--time', '10', container);
  docker('rm', container);
  container = undefined;
  container = docker('run', '--detach', '--publish', '127.0.0.1::4800',
    '--mount', `type=volume,source=${volume},target=/data`,
    '--env', 'STUDIO_AUTH_TOKEN', '--env', 'PORT=4800', image);
  const replacementBindings = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', container));
  base = `http://127.0.0.1:${replacementBindings['4800/tcp'][0].HostPort}`;
  await waitUntilReady(base);
  const draftAfterReplacement = await (await fetch(`${base}/native/api/draft`, { headers })).json();
  assert.equal(draftAfterReplacement.revision, nativeSaved.revision);
  assert.deepEqual(draftAfterReplacement.document, nativeSaved.document);
  const nativeAfterReplacement = await (await fetch(`${base}/native/api/published`, { headers })).json();
  assert.deepEqual(nativeAfterReplacement, nativePublished, 'The publication must survive container replacement');
  const nativeAssetAfterReplacement = await fetch(`${base}/native${uploaded.source.path}`, { headers });
  assert.equal(nativeAssetAfterReplacement.status, 200);
  assert.deepEqual(Buffer.from(await nativeAssetAfterReplacement.arrayBuffer()), pixel);

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
  await tab.getByRole('button', { name: 'Publish' }).waitFor();
  await tab.locator('[data-preview-root]').first().waitFor();
  const mountedNative = await fetch(`http://127.0.0.1:${address.port}${mount}native/api/published`);
  assert.equal(mountedNative.status, 200);
  assert.deepEqual(await mountedNative.json(), nativePublished);
  const mountedAsset = await fetch(`http://127.0.0.1:${address.port}${mount}native${uploaded.source.path}`);
  assert.equal(mountedAsset.status, 200);
  assert.deepEqual(Buffer.from(await mountedAsset.arrayBuffer()), pixel);
  assert.deepEqual(browserErrors, []);
  assert.deepEqual(escapedRequests.filter(url => url?.startsWith('/api/') || url?.startsWith('/native/')), []);
} finally {
  await browser?.close();
  if (proxy) {
    proxy.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
  }
  if (container) {
    docker('stop', '--time', '10', container);
    docker('rm', container);
  }
  if (volume) docker('volume', 'rm', volume);
}
console.log('Production container: auth, assets, save/publish, restart/replacement persistence, mounted-path routing, and cleanup passed.');
