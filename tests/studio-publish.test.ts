import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { StudioStore } from '../server/store';
import {
  checkBase, diff, docSha256, inScope, isMain, isSecurity, parseStrict, Refusal, run, type PublishRecord,
} from '../scripts/studio-publish';
import type { CompositionDraft } from '../src/shared/composition/workspace';
import { fakeHomeAssistant, type FakeHaOptions } from './fake-ha-publication';

/**
 * The publish CLI against the real Studio server, in process, on a scratch data directory under test-results and an ephemeral loopback port
 * (never 4800, 4801, 4819 or 4880). Only Home Assistant is faked (tests/fake-ha-publication.ts); faults are injected by wrapping `fetch`.
 */
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

const haToken = 'synthetic-ha-token-that-must-never-leave-the-server';
const studioToken = 'stub-token-SECRET-0123456789abcdefABCDEF';
const SENTINEL = 'SENTINEL-house-value-9917';
const scratchRoot = path.join('test-results', 'studio-publish');

type Intercept = (url: URL, init: RequestInit, real: () => Promise<Response>) => Promise<Response> | undefined;

async function setup(options: { authToken?: string; ha?: Partial<FakeHaOptions> } = {}) {
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, 'run-'));
  cleanup.push(() => rm(scratch, { recursive: true, force: true }));
  const haOptions: FakeHaOptions = { token: haToken, ...options.ha };
  const fake = await fakeHomeAssistant(haOptions);
  cleanup.push(() => fake.close());
  const dataDir = path.join(scratch, 'studio-data');
  await mkdir(dataDir);
  const store = await StudioStore.open(dataDir);
  cleanup.push(() => store.close());
  const application = createApp(store, { production: false, port: 0, host: '127.0.0.1', dataDir, authToken: options.authToken, haUrl: fake.url, haToken });
  application.app.use(application.errorHandler);
  const server = http.createServer(application.app);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  cleanup.push(async () => { application.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The change root lives outside every repository (the tool refuses one inside a git work tree), so under the system temp directory.
  const homeParent = await mkdtemp(path.join(tmpdir(), 'studio-publish-'));
  cleanup.push(() => rm(homeParent, { recursive: true, force: true }));
  const home = path.join(homeParent, 'changes');
  await mkdir(home);
  const logPath = path.join(scratch, 'log.jsonl');
  const calls: { method: string; path: string; authorization: string | null; body: unknown }[] = [];
  let intercept: Intercept | undefined;
  const wrapped: typeof fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init.headers);
    calls.push({ method: String(init.method ?? 'GET'), path: url.pathname, authorization: headers.get('authorization'), body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return intercept?.(url, init, () => fetch(input, init)) ?? fetch(input, init);
  };
  /** Direct API call: the owner's browser, which never goes through the tool. */
  const api = async (endpoint: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${endpoint}`, {
      method, headers: { ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json().catch(() => null) as Record<string, unknown> | null };
  };
  const draft = async () => (await api('/native/api/draft')).json as unknown as CompositionDraft;
  const ownerSaves = async (document: unknown) => (await api('/native/api/draft', 'PUT', { document, expectedRevision: (await draft()).revision })).status;
  const ownerPublishes = async () => (await api('/native/api/ha/publish', 'POST', { expectedRevision: (await draft()).revision })).status;

  // The house starts published: the live layout equals the draft, which is where a change can begin.
  const initial = await draft();
  expect(await ownerPublishes()).toBe(200);
  const initialPublication = (await api('/native/api/ha/publication')).json as { current: { revision: number; envelopeSha256: string }; draftIsLive: boolean };
  expect(initialPublication.draftIsLive).toBe(true);

  const dir = path.join(home, 'c1');
  await mkdir(dir);
  const baseDocument = initial.document as unknown as Record<string, unknown>;
  const candidate = (name = SENTINEL) => ({ ...baseDocument, name });

  async function writeBundle(change: { document?: unknown; scope?: string[]; revision?: number; evidenceFor?: unknown; publisherId?: string; id?: string } = {}) {
    const document = change.document ?? candidate();
    await writeFile(path.join(dir, 'change.json'), JSON.stringify({
      id: change.id ?? 'c1', task: 'templates', studio: { publisherId: change.publisherId ?? initial.publisherId, documentId: baseDocument.id },
      base: { draftRevision: change.revision ?? initial.revision, document: baseDocument, liveRevision: initialPublication.current.revision, liveEnvelopeSha256: initialPublication.current.envelopeSha256 },
      document, scope: change.scope ?? ['/name'], summary: 'label',
    }));
    for (const name of ['before.png', 'after.png']) await writeFile(path.join(dir, name), 'png');
    await writeFile(path.join(dir, 'evidence.json'), JSON.stringify({
      candidateSha256: docSha256(change.evidenceFor ?? document), validation: { result: 'pass' },
      screenshots: { before: ['before.png'], after: ['after.png'] }, checks: [{ id: 'pair', result: 'pass' }],
    }));
  }
  await writeBundle();

  const lines: string[] = [];
  const cli = async (...args: string[]) => {
    lines.length = 0;
    const code = await run([...args, '--log', logPath, '--base', base], {
      env: { STUDIO_PUBLISH_HOME: home, ...(options.authToken ? { STUDIO_AUTH_TOKEN: options.authToken } : {}) }, home,
      out: line => lines.push(line), fetch: wrapped, sleep: async () => undefined,
    });
    return { code, output: lines.join('\n') };
  };
  /** The same, with no token in the environment. */
  const cliNoToken = async (...args: string[]) => {
    lines.length = 0;
    const code = await run([...args, '--log', logPath, '--base', base], { env: { STUDIO_PUBLISH_HOME: home }, home, out: line => lines.push(line), fetch: wrapped, sleep: async () => undefined });
    return { code, output: lines.join('\n') };
  };
  const record = async () => JSON.parse(await readFile(path.join(dir, 'record.json'), 'utf8')) as PublishRecord;
  const logText = () => readFile(logPath, 'utf8').catch(() => '');
  const count = (method: string, suffix: string) => calls.filter(call => call.method === method && call.path.endsWith(suffix)).length;
  return {
    base, fake, haOptions, api, draft, ownerSaves, ownerPublishes, initial, baseDocument, candidate, writeBundle, cli, cliNoToken, record, logText, dir, home,
    calls, count, lines, setIntercept: (value?: Intercept) => { intercept = value; },
  };
}
type Lab = Awaited<ReturnType<typeof setup>>;
const tool = (lab: Lab, command: string, ...rest: string[]) => lab.cli(command, 'c1', '--reason', 't', ...rest);
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('studio-publish: the flow', () => {
  it('checks, applies, publishes and logs, with a private prior copy', async () => {
    const lab = await setup();
    expect((await lab.cli('check', 'c1')).code).toBe(0);
    const result = await tool(lab, 'apply', '--publish');
    expect(result.code, result.output).toBe(0);
    expect((await lab.draft()).revision).toBe(lab.initial.revision + 1);
    expect(lab.fake.state.revision).toBe(2);
    expect((await lab.record()).state).toBe('published');
    expect((await stat(path.join(lab.dir, 'prior.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path.join(lab.dir, 'prior.json'), 'utf8')).document).toEqual(lab.baseDocument);
    expect(await lab.logText()).toContain('"result":"published"');
  });

  it('reads open-check first', async () => {
    const lab = await setup();
    await lab.cli('check', 'c1');
    expect(lab.calls.find(call => call.path.startsWith('/native/api/ha/'))?.path).toBe('/native/api/ha/open-check');
    expect(lab.calls.filter(call => call.path.startsWith('/native/api/'))[0].path).toBe('/native/api/ha/open-check');
  });

  it('stops on a 409 at the write with stale_base, never retries, and leaves the draft alone', async () => {
    const lab = await setup();
    let moved = false;
    lab.setIntercept(async (url, init, real) => {
      if (init.method === 'PUT' && !moved) { moved = true; expect(await lab.ownerSaves(lab.baseDocument)).toBe(200); }
      return real();
    });
    const result = await tool(lab, 'apply');
    expect(result.code, result.output).toBe(3);
    expect(result.output).toContain('stale_base');
    expect(lab.count('PUT', '/native/api/draft')).toBe(1);
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
    expect((await lab.record()).state).toBe('refused');
  });

  it('refuses a moved revision at check, and accepts it with --rebase-identical when the document is equal', async () => {
    const lab = await setup();
    expect(await lab.ownerSaves(lab.baseDocument)).toBe(200);
    expect((await lab.cli('check', 'c1')).code).toBe(3);
    const result = await tool(lab, 'apply', '--rebase-identical');
    expect(result.code, result.output).toBe(0);
    expect((await lab.draft()).revision).toBe(lab.initial.revision + 2);
  });

  it('leaves the draft untouched when the Studio refuses the write (422)', async () => {
    const lab = await setup();
    // Changing the document id passes the compile and validate but not the store's identity rule.
    await lab.writeBundle({ document: { ...lab.baseDocument, id: 'document-other' }, scope: ['/id'] });
    const result = await tool(lab, 'apply');
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('rejected');
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
  });

  it('refuses a candidate the Studio compile refuses, before any write', async () => {
    const lab = await setup();
    await lab.writeBundle({ document: { ...lab.baseDocument, schemaVersion: '9.9' }, scope: ['/schemaVersion'] });
    expect((await tool(lab, 'apply')).code).toBe(1);
    expect(lab.count('PUT', '/native/api/draft')).toBe(0);
  });

  it('refuses when the server validation refuses', async () => {
    const lab = await setup();
    lab.setIntercept((url, init, real) => url.pathname === '/native/api/validate' ? Promise.resolve(json(422, { error: 'no' })) : real());
    const result = await tool(lab, 'apply');
    expect(result.code).toBe(1);
    expect(result.output).toContain('invalid');
    expect((await lab.draft()).revision).toBe(lab.initial.revision);
  });

  it('refuses while the owner has unpublished edits and writes nothing', async () => {
    const lab = await setup();
    expect(await lab.ownerSaves({ ...lab.baseDocument, name: 'Owner edit' })).toBe(200);
    const result = await tool(lab, 'apply', '--publish');
    expect(result.code).toBe(3);
    expect(result.output).toContain('owner_edits');
    expect(lab.count('PUT', '/native/api/draft')).toBe(0);
    expect(lab.count('POST', '/native/api/ha/publish')).toBe(0);
  });

  it('refuses to publish a draft the owner saved after the apply', async () => {
    const lab = await setup();
    expect((await tool(lab, 'apply')).code).toBe(0);
    expect(await lab.ownerSaves({ ...lab.candidate(), name: 'Owner edit after apply' })).toBe(200);
    expect((await tool(lab, 'publish')).code).toBe(3);
    expect(lab.fake.state.revision).toBe(1);
    expect(((await lab.draft()).document as unknown as { name: string }).name).toBe('Owner edit after apply');
  });

  it('refuses another Studio and a bad base', async () => {
    const lab = await setup();
    await lab.writeBundle({ publisherId: 'someone-else' });
    const wrong = await lab.cli('check', 'c1');
    expect(wrong.code).toBe(1);
    expect(wrong.output).toContain('wrong_studio');
    for (const bad of ['http://example.com:4801', 'http://127.0.0.1:4800', 'http://localhost:4819', 'https://127.0.0.1:4801', 'http://127.0.0.1']) expect(() => checkBase(bad), bad).toThrow(Refusal);
    expect(checkBase('http://127.0.0.1:4801')).toBe('http://127.0.0.1:4801');
    expect(checkBase('http://localhost:4800', 'http://localhost:4800')).toBe('http://localhost:4800');
  });

  it('refuses when the live publication moved since the bundle was built', async () => {
    const lab = await setup();
    expect(await lab.ownerPublishes()).toBe(200);
    const result = await lab.cli('check', 'c1');
    expect(result.code).toBe(1);
    expect(result.output).toContain('ha_moved');
  });

  it('keeps the applied state when Home Assistant fails, resumes the publish, and applies idempotently', async () => {
    const lab = await setup();
    let failed = false;
    lab.setIntercept((url, init, real) => {
      if (url.pathname.endsWith('/ha/publish') && !failed) { failed = true; return Promise.resolve(json(502, { error: 'down' })); }
      return real();
    });
    const first = await tool(lab, 'apply', '--publish');
    expect(first.code).toBe(1);
    expect(first.output).toContain('ha_unreachable');
    expect((await lab.record()).state).toBe('applied');
    expect((await tool(lab, 'publish')).code).toBe(0);
    expect(lab.fake.state.revision).toBe(2);
    expect((await tool(lab, 'apply')).code).toBe(0);
    expect(lab.count('PUT', '/native/api/draft')).toBe(1);
  });

  it('retries a 429 once with back-off and no more', async () => {
    const lab = await setup();
    let left = 1;
    lab.setIntercept((url, init, real) => left-- > 0 ? Promise.resolve(json(429)) : real());
    expect((await lab.cli('status', '--json')).code).toBe(0);
    left = 2;
    expect((await lab.cli('status', '--json')).code).toBe(1);
  });
});

describe('studio-publish: scope and evidence', () => {
  it('refuses a difference outside the declared scope', async () => {
    const lab = await setup();
    const document = { ...lab.candidate(), theme: { ...(lab.baseDocument.theme as object), appearance: 'light' } };
    await lab.writeBundle({ document });
    const result = await lab.cli('check', 'c1');
    expect(result.code).toBe(1);
    expect(result.output).toContain('scope_violation');
    expect((await tool(lab, 'apply')).code).toBe(1);
    expect((await lab.draft()).revision).toBe(lab.initial.revision);
  });

  it('matches scope by whole segments and tells a boolean from a number', () => {
    expect(inScope('/tiles/1/x', ['/tiles/1'])).toBe(true);
    expect(inScope('/tiles/10', ['/tiles/1'])).toBe(false);
    expect(diff({ a: true }, { a: 1 })).toHaveLength(1);
    expect(diff({ a: [1, 2] }, { a: [1, 2, 3] }).map(([pointer]) => pointer)).toEqual(['/a']);
    expect(isSecurity(diff({ a: 'x' }, { a: 'lock.test_door' }))).toBe(true);
    expect(isSecurity(diff({ a: 'x' }, { a: 'y' }))).toBe(false);
  });

  it('refuses an identical candidate, an empty scope and an empty scope path', async () => {
    const lab = await setup();
    await lab.writeBundle({ document: lab.baseDocument });
    expect((await lab.cli('check', 'c1')).output).toContain('no_change');
    await lab.writeBundle({ scope: [] });
    expect((await lab.cli('check', 'c1')).output).toContain('scope_violation');
    await lab.writeBundle({ scope: [''] });
    const result = await lab.cli('check', 'c1');
    expect(result.code).toBe(1);
    expect(result.output).toContain('bad_bundle');
  });

  it('refuses a duplicate key or an oversize bundle before sending any request', async () => {
    const lab = await setup();
    const before = lab.calls.length;
    await writeFile(path.join(lab.dir, 'change.json'), '{"id": "c1", "id": "c2"}');
    expect((await lab.cli('check', 'c1')).code).toBe(1);
    await writeFile(path.join(lab.dir, 'change.json'), ' '.repeat(8 * 1024 * 1024 + 10));
    expect((await lab.cli('check', 'c1')).code).toBe(1);
    expect(lab.calls.length).toBe(before);
    expect(() => parseStrict('{"a":1,"a":2}')).toThrow();
    expect(parseStrict('{"a":[1,{"b":null}],"c":"d"}')).toEqual({ a: [1, { b: null }], c: 'd' });
  });

  it('refuses evidence that is missing, failing, unbound, or points at a missing screenshot', async () => {
    const lab = await setup();
    await lab.writeBundle({ evidenceFor: { other: 1 } });
    expect((await tool(lab, 'apply')).output).toContain('evidence_unbound');
    await lab.writeBundle();
    const evidencePath = path.join(lab.dir, 'evidence.json');
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    await writeFile(evidencePath, JSON.stringify({ ...evidence, checks: [{ id: 'pair', result: 'fail' }] }));
    expect((await tool(lab, 'apply')).output).toContain('evidence_failed');
    await writeFile(evidencePath, JSON.stringify({ ...evidence, screenshots: { ...evidence.screenshots, after: ['missing.png'] } }));
    expect((await tool(lab, 'apply')).output).toContain('evidence_missing');
    await rm(evidencePath);
    expect((await tool(lab, 'apply')).code).toBe(1);
    expect((await lab.draft()).revision).toBe(lab.initial.revision);
  });

  it('flags a change that mentions a lock in the log', async () => {
    const lab = await setup();
    await lab.writeBundle({ document: lab.candidate('lock.test_door') });
    const result = await tool(lab, 'apply');
    expect(result.code, result.output).toBe(0);
    expect(await lab.logText()).toContain('"security":true');
  });

  it('accepts only a directory under the change root', async () => {
    const lab = await setup();
    const outside = await mkdtemp(path.join(tmpdir(), 'studio-outside-'));
    cleanup.push(() => rm(outside, { recursive: true, force: true }));
    const result = await lab.cli('check', outside);
    expect(result.code).toBe(1);
    expect(result.output).toContain('bad_bundle');
    expect((await lab.cli('check', path.join(lab.dir, '..', '..'))).output).toContain('bad_bundle');
  });
});

describe('studio-publish: rollback', () => {
  const published = async (lab: Lab) => { const result = await tool(lab, 'apply', '--publish'); expect(result.code, result.output).toBe(0); };
  const livedoc = async (lab: Lab) => ((await lab.api('/native/api/ha/publication')).json as { draftIsLive: boolean });

  it('restores the draft and the live publication', async () => {
    const lab = await setup();
    await published(lab);
    const result = await tool(lab, 'rollback');
    expect(result.code, result.output).toBe(0);
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
    expect(lab.fake.state.current?.envelope.document).toEqual(lab.baseDocument);
    expect((await livedoc(lab)).draftIsLive).toBe(true);
    expect((await lab.record()).state).toBe('rolled_back');
  });

  it('leaves a draft the owner edited since, and says draft_moved', async () => {
    const lab = await setup();
    await published(lab);
    expect(await lab.ownerSaves({ ...lab.candidate(), name: 'Owner edit' })).toBe(200);
    const result = await tool(lab, 'rollback');
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('draft_moved');
    expect(((await lab.draft()).document as unknown as { name: string }).name).toBe('Owner edit');
  });

  it('republishes the prior document when the live entry aged out', async () => {
    const lab = await setup();
    await published(lab);
    lab.haOptions.rejectRollback = true;
    const result = await tool(lab, 'rollback');
    expect(result.code, result.output).toBe(0);
    expect((await livedoc(lab)).draftIsLive).toBe(true);
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
    expect(lab.fake.state.current?.envelope.document).toEqual(lab.baseDocument);
  });

  it('fails loudly, with an alert, when the entry aged out and the draft moved', async () => {
    const lab = await setup();
    await published(lab);
    lab.haOptions.rejectRollback = true;
    expect(await lab.ownerSaves({ ...lab.candidate(), name: 'Owner edit' })).toBe(200);
    const result = await tool(lab, 'rollback');
    expect(result.code).toBe(1);
    expect(result.output).toContain('rollback_failed');
    expect(result.output).toContain('ALERT [rollback_failed]');
    expect(await lab.logText()).toContain('rollback_failed_alert');
  });

  it('rolls back only the side asked for', async () => {
    const lab = await setup();
    await published(lab);
    expect((await tool(lab, 'rollback', '--live-only')).code).toBe(0);
    expect((await lab.draft()).document).toEqual(lab.candidate());
    expect(lab.fake.state.current?.envelope.document).toEqual(lab.baseDocument);
    expect((await tool(lab, 'rollback', '--draft-only')).code).toBe(0);
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
    expect((await lab.record()).state).toBe('rolled_back');
  });

  it('rolls back an unpublished apply without touching the live side', async () => {
    const lab = await setup();
    expect((await tool(lab, 'apply')).code).toBe(0);
    expect((await tool(lab, 'rollback')).code).toBe(0);
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
    expect(lab.count('POST', '/native/api/ha/rollback')).toBe(0);
  });
});

describe('studio-publish: unsafe rollbacks', () => {
  it('never republishes an owner edit after a failed republish', async () => {
    const lab = await setup();
    expect((await tool(lab, 'apply', '--publish')).code).toBe(0);
    lab.haOptions.rejectRollback = true;
    let failed = false;
    lab.setIntercept((url, init, real) => {
      if (url.pathname.endsWith('/ha/publish') && !failed) { failed = true; return Promise.resolve(json(502)); }
      return real();
    });
    expect((await tool(lab, 'rollback')).code).toBe(1);
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
    lab.setIntercept(undefined);
    expect(await lab.ownerSaves({ ...lab.baseDocument, name: 'Owner edit' })).toBe(200);
    const publishes = lab.count('POST', '/native/api/ha/publish');
    const result = await tool(lab, 'rollback');
    expect(result.code).toBe(1);
    expect(result.output).toContain('rollback_failed');
    expect(lab.count('POST', '/native/api/ha/publish')).toBe(publishes);
    expect(((await lab.draft()).document as unknown as { name: string }).name).toBe('Owner edit');
  });

  it('finishes the republish on a retry when the draft is still the prior document', async () => {
    const lab = await setup();
    expect((await tool(lab, 'apply', '--publish')).code).toBe(0);
    lab.haOptions.rejectRollback = true;
    let failed = false;
    lab.setIntercept((url, init, real) => {
      if (url.pathname.endsWith('/ha/publish') && !failed) { failed = true; return Promise.resolve(json(502)); }
      return real();
    });
    expect((await tool(lab, 'rollback')).code).toBe(1);
    const retry = await tool(lab, 'rollback');
    expect(retry.code, retry.output).toBe(0);
    expect(lab.fake.state.current?.envelope.document).toEqual(lab.baseDocument);
  });

  it('rolls back a publish whose reply was lost', async () => {
    const lab = await setup();
    lab.setIntercept(async (url, init, real) => {
      if (url.pathname.endsWith('/ha/publish')) { await real(); return json(502); }
      return real();
    });
    expect((await tool(lab, 'apply', '--publish')).code).toBe(1);
    expect(lab.fake.state.revision).toBe(2);
    expect((await lab.record()).publishAttempted).toBe(true);
    lab.setIntercept(undefined);
    const result = await tool(lab, 'rollback');
    expect(result.code, result.output).toBe(0);
    expect(lab.fake.state.current?.envelope.document).toEqual(lab.baseDocument);
    expect((await lab.record()).state).toBe('rolled_back');
  });

  it('needs no live rollback for a publish that never took effect', async () => {
    const lab = await setup();
    lab.setIntercept((url, init, real) => url.pathname.endsWith('/ha/publish') ? Promise.resolve(json(502)) : real());
    expect((await tool(lab, 'apply', '--publish')).code).toBe(1);
    lab.setIntercept(undefined);
    expect((await tool(lab, 'rollback')).code).toBe(0);
    expect(lab.count('POST', '/native/api/ha/rollback')).toBe(0);
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
  });

  it('does not undo a publication the owner made after this tool', async () => {
    const lab = await setup();
    expect((await tool(lab, 'apply', '--publish')).code).toBe(0);
    expect(await lab.ownerPublishes()).toBe(200);
    const result = await tool(lab, 'rollback');
    expect(result.code).toBe(1);
    expect(result.output).toContain('live_moved');
    expect(lab.count('POST', '/native/api/ha/rollback')).toBe(0);
    expect(lab.fake.state.revision).toBe(3);
  });

  it('rolls back a draft that was written but never confirmed, and lists the open record', async () => {
    const lab = await setup();
    let armed = false;
    lab.setIntercept(async (url, init, real) => {
      if (init.method === 'PUT') { armed = true; return real(); }
      if (armed && url.pathname === '/native/api/draft') { armed = false; return json(500); }
      return real();
    });
    expect((await tool(lab, 'apply')).code).toBe(1);
    lab.setIntercept(undefined);
    expect((await lab.record()).state).toBe('recorded');
    expect((await lab.record()).pendingDraftRevision).toBe(lab.initial.revision + 1);
    expect((await lab.draft()).document).toEqual(lab.candidate());
    expect(JSON.parse((await lab.cli('status', '--json')).output).openChanges).toEqual([{ change: 'c1', state: 'recorded' }]);
    expect((await tool(lab, 'apply')).output).toContain('unresolved');
    expect((await tool(lab, 'rollback', '--draft-only')).code).toBe(0);
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
    expect((await lab.record()).state).toBe('rolled_back');
    expect(JSON.parse((await lab.cli('status', '--json')).output).openChanges).toEqual([]);
  });

  it('rolls back a refused record as unchanged', async () => {
    const lab = await setup();
    await lab.writeBundle({ document: { ...lab.baseDocument, id: 'document-other' }, scope: ['/id'] });
    expect((await tool(lab, 'apply')).code).toBe(1);
    expect((await tool(lab, 'rollback')).code).toBe(0);
    expect((await lab.draft()).revision).toBe(lab.initial.revision);
    expect(lab.count('PUT', '/native/api/draft')).toBe(1);
  });
});

describe('studio-publish: proof before a restore, and resolve', () => {
  const lostPut = async (lab: Lab) => {
    lab.setIntercept((url, init) => init.method === 'PUT' ? Promise.reject(new TypeError('connection lost')) : undefined);
    expect((await tool(lab, 'apply')).code).toBe(1);
    lab.setIntercept(undefined);
    expect((await lab.record()).state).toBe('recorded');
  };

  it('does not overwrite an owner save that took the revision number of a write that never landed', async () => {
    const lab = await setup();
    await lostPut(lab);
    expect(await lab.ownerSaves({ ...lab.baseDocument, name: 'Owner edit' })).toBe(200);
    expect((await lab.record()).pendingDraftRevision).toBe((await lab.draft()).revision);
    const result = await tool(lab, 'rollback', '--draft-only');
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('draft_moved');
    expect(((await lab.draft()).document as unknown as { name: string }).name).toBe('Owner edit');
    expect(lab.count('PUT', '/native/api/draft')).toBe(1);
  });

  it('still restores a write that did land', async () => {
    const lab = await setup();
    let armed = false;
    lab.setIntercept(async (url, init, real) => {
      if (init.method === 'PUT') { armed = true; return real(); }
      if (armed && url.pathname === '/native/api/draft') { armed = false; return json(500); }
      return real();
    });
    expect((await tool(lab, 'apply')).code).toBe(1);
    lab.setIntercept(undefined);
    expect((await tool(lab, 'rollback', '--draft-only')).code).toBe(0);
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
  });

  it('resolve refuses while the change is still in the draft', async () => {
    const lab = await setup();
    expect((await tool(lab, 'apply')).code).toBe(0);
    const result = await tool(lab, 'resolve');
    expect(result.code).toBe(1);
    expect(result.output).toContain('still_ours');
    expect((await lab.record()).state).toBe('applied');
  });

  it('resolve clears a draft_moved partial from status', async () => {
    const lab = await setup();
    await lostPut(lab);
    expect(await lab.ownerSaves({ ...lab.baseDocument, name: 'Owner edit' })).toBe(200);
    await tool(lab, 'rollback', '--draft-only');
    expect(JSON.parse((await lab.cli('status', '--json')).output).openChanges).toHaveLength(1);
    expect((await tool(lab, 'resolve')).code).toBe(0);
    expect((await lab.record()).state).toBe('resolved');
    expect(JSON.parse((await lab.cli('status', '--json')).output).openChanges).toEqual([]);
  });

  it('marks a failed rollback for the owner, alerts, logs, and keeps listing it', async () => {
    const lab = await setup();
    expect((await tool(lab, 'apply', '--publish')).code).toBe(0);
    lab.haOptions.rejectRollback = true;
    lab.setIntercept((url, init, real) => url.pathname.endsWith('/ha/publish') ? Promise.resolve(json(502)) : real());
    expect((await tool(lab, 'rollback')).code).toBe(1);
    lab.setIntercept(undefined);
    expect((await lab.record()).state).toBe('rollback_failed');
    expect((await tool(lab, 'resolve')).output).toContain('still_ours');
    const marked = await lab.cli('resolve', 'c1', '--reason', 'needs the owner', '--owner-action');
    expect(marked.code, marked.output).toBe(0);
    expect(marked.output).toContain('ALERT [owner_action]');
    expect((await lab.record()).state).toBe('owner_action');
    expect(await lab.logText()).toContain('owner_action_needed');
    const status = JSON.parse((await lab.cli('status', '--json')).output);
    expect(status.openChanges).toEqual([]);
    expect(status.ownerAction).toEqual([{ change: 'c1', state: 'owner_action' }]);
  });

  it('does not let --owner-action hide a change that rollback can still handle', async () => {
    const lab = await setup();
    expect((await tool(lab, 'apply', '--publish')).code).toBe(0);
    const result = await tool(lab, 'resolve', '--owner-action');
    expect(result.code).toBe(1);
    expect(result.output).toContain('not_stuck');
    expect((await lab.record()).state).toBe('published');
  });

  it('lets a change that ended in draft_moved be marked owner_action', async () => {
    const lab = await setup();
    await lostPut(lab);
    expect((await tool(lab, 'resolve', '--owner-action')).output).toContain('not_stuck');
    expect(await lab.ownerSaves({ ...lab.baseDocument, name: 'Owner edit' })).toBe(200);
    expect((await tool(lab, 'rollback', '--draft-only')).output).toContain('draft_moved');
    expect((await lab.record()).draftMoved).toBe(true);
    expect((await tool(lab, 'resolve', '--owner-action')).code).toBe(0);
    expect((await lab.record()).state).toBe('owner_action');
    expect(JSON.parse((await lab.cli('status', '--json')).output).ownerAction).toEqual([{ change: 'c1', state: 'owner_action' }]);
  });

  it('restores a write the Studio stored differently, by its read-back hash, and refuses when the draft no longer matches it', async () => {
    const lab = await setup();
    let normalize = false;
    lab.setIntercept(async (url, init, real) => {
      if (init.method === 'PUT') normalize = true;
      const response = await real();
      if (normalize && url.pathname === '/native/api/draft' && init.method === 'GET') {
        const body = await response.json() as CompositionDraft;
        return json(200, { ...body, document: { ...(body.document as object), description: 'normalized by the studio' } });
      }
      return response;
    });
    const applied = await tool(lab, 'apply');
    expect(applied.code).toBe(1);
    expect(applied.output).toContain('store_mismatch');
    expect((await lab.record()).readBackSha256).toBeTruthy();
    const restored = await tool(lab, 'rollback', '--draft-only');
    expect(restored.code, restored.output).toBe(0);
    normalize = false;
    expect((await lab.draft()).document).toEqual(lab.baseDocument);

    // The same record, with the owner's different document at that revision, is not restored over.
    const other = await setup();
    let seen = false;
    other.setIntercept(async (url, init, real) => {
      if (init.method === 'PUT') seen = true;
      const response = await real();
      if (seen && url.pathname === '/native/api/draft' && init.method === 'GET') {
        const body = await response.json() as CompositionDraft;
        return json(200, { ...body, document: { ...(body.document as object), description: 'normalized by the studio' } });
      }
      return response;
    });
    expect((await tool(other, 'apply')).code).toBe(1);
    seen = false;
    other.setIntercept(async (url, init, real) => {
      const response = await real();
      if (url.pathname === '/native/api/draft' && init.method === 'GET') {
        const body = await response.json() as CompositionDraft;
        return json(200, { ...body, document: { ...(body.document as object), description: 'something else' } });
      }
      return response;
    });
    const refused = await tool(other, 'rollback', '--draft-only');
    expect(refused.output).toContain('draft_moved');
    expect(other.count('PUT', '/native/api/draft')).toBe(1);
  });

  it('resolve refuses an unconfirmed publish that may still be live', async () => {
    const lab = await setup();
    lab.setIntercept(async (url, init, real) => {
      if (url.pathname.endsWith('/ha/publish')) { await real(); return json(502); }
      return real();
    });
    expect((await tool(lab, 'apply', '--publish')).code).toBe(1);
    lab.setIntercept(undefined);
    expect((await tool(lab, 'rollback', '--draft-only')).code).toBe(0);
    expect((await lab.draft()).document).toEqual(lab.baseDocument);
    const result = await tool(lab, 'resolve');
    expect(result.code).toBe(1);
    expect(result.output).toContain('still_ours');
  });
});

describe('studio-publish: secrets, status and the data directory', () => {
  it('prints no token and no document text, with a Studio that requires a token', async () => {
    const lab = await setup({ authToken: studioToken });
    const texts: string[] = [];
    for (const args of [['status', '--json'], ['check', 'c1'], ['apply', 'c1', '--reason', 't', '--publish'], ['rollback', 'c1', '--reason', 't']]) {
      const result = await lab.cli(...args);
      expect(result.code, result.output).toBe(0);
      texts.push(result.output);
    }
    texts.push(await lab.logText(), await readFile(path.join(lab.dir, 'record.json'), 'utf8'));
    expect(lab.calls.some(call => call.authorization === `Bearer ${studioToken}`)).toBe(true);
    for (const text of texts) {
      expect(text).not.toContain(studioToken);
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain(haToken);
    }
  });

  it('sends no credential to a Studio that does not ask, and refuses cleanly on a 401 without one', async () => {
    const open = await setup();
    const result = await open.cli('status');
    expect(result.code).toBe(0);
    expect(open.calls.every(call => call.authorization === null)).toBe(true);
    const guarded = await setup({ authToken: studioToken });
    const refused = await guarded.cliNoToken('status');
    expect(refused.code).toBe(1);
    expect(refused.output).toContain('auth_failed');
    expect(refused.output).not.toContain(studioToken);
  });

  it('status names revisions and flags only', async () => {
    const lab = await setup();
    const result = await lab.cli('status', '--json');
    expect(result.code).toBe(0);
    const info = JSON.parse(result.output);
    expect(Object.keys(info).sort()).toEqual(['draftIsLive', 'draftRevision', 'historyRevisions', 'lastChange', 'liveRevision', 'openChanges', 'openCheck', 'ownerAction']);
    expect(info.draftIsLive).toBe(true);
    expect(info.liveRevision).toBe(1);
    expect(result.output).not.toContain(SENTINEL);
  });

  it('never names the Studio data directory in code', async () => {
    const source = await readFile(path.join('scripts', 'studio-publish.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/native-v2|DATA_DIR|\.studio\.lock|state\.json/);
  });

  it('rejects unknown commands and missing arguments without a request', async () => {
    const lab = await setup();
    const before = lab.calls.length;
    expect((await lab.cli('frobnicate')).code).toBe(2);
    expect((await lab.cli('apply')).code).toBe(2);
    expect((await lab.cli('apply', 'c1')).output).toContain('--reason');
    expect((await lab.cli('rollback', 'c1', '--reason', 't', '--live-only', '--draft-only')).code).toBe(2);
    expect(lab.calls.length).toBe(before);
  });
});

describe('studio-publish: read-backs and safety checks that must fail closed', () => {
  const published = async (lab: Lab) => { const result = await tool(lab, 'apply', '--publish'); expect(result.code, result.output).toBe(0); };
  /** The publication summary as the Studio answers it, changed by `change`. */
  const altered = async (real: () => Promise<Response>, change: (body: Record<string, any>) => void) => {
    const body = await (await real()).json() as Record<string, any>;
    change(body);
    return json(200, body);
  };
  const isPublication = (url: URL, init: RequestInit) => url.pathname.endsWith('/ha/publication') && init.method === 'GET';

  it('refuses a republish whose read-back does not match, and alerts', async () => {
    const lab = await setup();
    await published(lab);
    lab.haOptions.rejectRollback = true;
    let republished = false;
    lab.setIntercept(async (url, init, real) => {
      if (url.pathname.endsWith('/ha/publish')) { const response = await real(); republished = true; return response; }
      if (republished && isPublication(url, init)) return altered(real, body => { body.draftIsLive = false; });
      return real();
    });
    const result = await tool(lab, 'rollback');
    expect(result.code).toBe(1);
    expect(result.output).toContain('rollback_failed');
    expect(result.output).toContain('ALERT [rollback_failed]');
    expect((await lab.record()).state).toBe('rollback_failed');
  });

  it('does not restore the draft while the Studio says the owner has unpublished edits, when the live entry aged out', async () => {
    const lab = await setup();
    await published(lab);
    lab.haOptions.rejectRollback = true;
    lab.setIntercept((url, init, real) => url.pathname.endsWith('/ha/open-check') ? Promise.resolve(json(200, { action: 'ask' })) : real());
    const puts = lab.count('PUT', '/native/api/draft');
    const publishes = lab.count('POST', '/native/api/ha/publish');
    const result = await tool(lab, 'rollback');
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('owner_edits');
    expect(lab.count('PUT', '/native/api/draft')).toBe(puts);
    expect(lab.count('POST', '/native/api/ha/publish')).toBe(publishes);
    expect(((await lab.draft()).document as unknown as { name: string }).name).toBe(SENTINEL);
  });

  it('fails the rollback when the live publication after ha/rollback is not the recorded one', async () => {
    const lab = await setup();
    await published(lab);
    let rolledBack = false;
    lab.setIntercept(async (url, init, real) => {
      if (url.pathname.endsWith('/ha/rollback')) { const response = await real(); rolledBack = true; return response; }
      if (rolledBack && isPublication(url, init)) return altered(real, body => { body.current.envelopeSha256 = 'f'.repeat(64); });
      return real();
    });
    const result = await tool(lab, 'rollback');
    expect(result.code).toBe(1);
    expect(result.output).toContain('rollback_failed');
    expect((await lab.record()).liveRolledBack).not.toBe(true);
  });

  it('does not roll back a publish of unknown outcome unless the live revision is provably this tool\'s', async () => {
    const lab = await setup();
    lab.setIntercept(async (url, init, real) => {
      if (url.pathname.endsWith('/ha/publish')) { await real(); return json(502); }
      return real();
    });
    expect((await tool(lab, 'apply', '--publish')).code).toBe(1);
    lab.setIntercept(undefined);
    // The owner saves again: the live revision is one past the recorded one, but the draft no longer equals what the app serves.
    expect(await lab.ownerSaves({ ...lab.baseDocument, name: 'Owner edit' })).toBe(200);
    const first = await tool(lab, 'rollback');
    expect(first.code).toBe(1);
    expect(first.output).toContain('live_moved');
    // The owner publishes: the live revision is two past the recorded one.
    expect(await lab.ownerPublishes()).toBe(200);
    const second = await tool(lab, 'rollback');
    expect(second.code).toBe(1);
    expect(second.output).toContain('live_moved');
    expect(lab.count('POST', '/native/api/ha/rollback')).toBe(0);
    expect(((await lab.draft()).document as unknown as { name: string }).name).toBe('Owner edit');
  });

  it('reports publish_unconfirmed when the publication read back does not match the publish answer', async () => {
    const lab = await setup();
    let sent = false;
    lab.setIntercept(async (url, init, real) => {
      if (url.pathname.endsWith('/ha/publish')) { const response = await real(); sent = true; return response; }
      if (sent && isPublication(url, init)) return altered(real, body => { body.draftIsLive = false; });
      return real();
    });
    const result = await tool(lab, 'apply', '--publish');
    expect(result.code).toBe(1);
    expect(result.output).toContain('publish_unconfirmed');
    const record = await lab.record();
    expect(record.state).not.toBe('published');
    expect(record.publishedRevision).toBeUndefined();
  });

  it('does not republish when the owner published between the live check and the republish', async () => {
    const lab = await setup();
    await published(lab);
    lab.haOptions.rejectRollback = true;
    let moved = false;
    lab.setIntercept(async (url, init, real) => {
      if (url.pathname.endsWith('/ha/rollback') && !moved) { moved = true; expect(await lab.ownerPublishes()).toBe(200); }
      return real();
    });
    const publishes = lab.count('POST', '/native/api/ha/publish');
    const result = await tool(lab, 'rollback');
    expect(result.code).toBe(1);
    expect(result.output).toContain('live_moved');
    expect(lab.count('POST', '/native/api/ha/publish')).toBe(publishes);
    expect(lab.fake.state.revision).toBe(3);
  });
});

describe('studio-publish: the log, the entry point and the change root', () => {
  it('logs the reason and the security flag when a change is marked owner_action', async () => {
    const lab = await setup();
    await lab.writeBundle({ document: { ...lab.baseDocument, name: 'lock.test_door' } });
    expect((await tool(lab, 'apply')).code).toBe(0);
    expect(await lab.ownerSaves({ ...lab.baseDocument, name: 'Owner edit' })).toBe(200);
    expect((await tool(lab, 'rollback')).output).toContain('draft_moved');
    const marked = await lab.cli('resolve', 'c1', '--reason', 'owner finishes by hand', '--owner-action');
    expect(marked.code, marked.output).toBe(0);
    const entries = (await lab.logText()).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    const resolve = entries.find(entry => entry.command === 'resolve');
    expect(resolve).toMatchObject({ reason: 'owner finishes by hand', result: 'owner_action', security: true });
    expect(entries.some(entry => entry.command === 'alert' && entry.reason === 'owner_action')).toBe(true);
  });

  it('exits 2, naming the problem, for a missing CHANGE or --reason', async () => {
    const lab = await setup();
    const noChange = await lab.cli('apply');
    expect(noChange.code).toBe(2);
    expect(noChange.output).toContain('needs a CHANGE');
    const noReason = await lab.cli('publish', 'c1');
    expect(noReason.code).toBe(2);
    expect(noReason.output).toContain('--reason');
  });

  it('refuses a change root inside a git repository', async () => {
    const lab = await setup();
    const repository = path.join(path.dirname(lab.home), 'repo');
    await mkdir(path.join(repository, '.git'), { recursive: true });
    const inside = path.join(repository, 'changes');
    await mkdir(inside);
    const result = await run(['check', 'c1', '--log', path.join(path.dirname(lab.home), 'log.jsonl'), '--base', lab.base], { env: { STUDIO_PUBLISH_HOME: inside }, home: inside, out: line => lab.lines.push(line), fetch: fetch });
    expect(result).toBe(1);
    expect(lab.lines.join('\n')).toContain('bad_root');
  });

  it('runs main when the script is reached through a symlink, and never exits 0 silently', async () => {
    const link = path.join(await mkdtemp(path.join(tmpdir(), 'studio-link-')), 'scripts-link');
    cleanup.push(() => rm(path.dirname(link), { recursive: true, force: true }));
    symlinkSync(path.resolve('scripts'), link);
    const tsx = path.resolve('node_modules', '.bin', 'tsx');
    const direct = spawnSync(tsx, [path.resolve('scripts', 'studio-publish.ts')], { encoding: 'utf8' });
    const through = spawnSync(tsx, [path.join(link, 'studio-publish.ts')], { encoding: 'utf8' });
    expect(direct.status).toBe(2);
    expect(through.status).toBe(2);
    expect(through.stdout).toContain('Usage');
    expect(isMain(path.join(link, 'studio-publish.ts'), pathToFileURL(path.resolve('scripts', 'studio-publish.ts')).href)).toBe(true);
    expect(isMain(path.join(link, 'studio-publish'), 'file:///elsewhere/other.ts')).toBe(true);
    expect(isMain('/x/other.ts', 'file:///elsewhere/module.ts')).toBe(false);
    expect(isMain(undefined, 'file:///elsewhere/module.ts')).toBe(false);
  }, 30_000);
});
