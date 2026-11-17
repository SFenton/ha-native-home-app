/**
 * studio-publish: the one path for an agent to change the owner's Studio draft and publish it.
 *
 *     tsx scripts/studio-publish.ts status   [--base URL] [--json]
 *     tsx scripts/studio-publish.ts check    CHANGE [--base URL] [--json]
 *     tsx scripts/studio-publish.ts apply    CHANGE --reason TEXT [--publish] [--rebase-identical]
 *     tsx scripts/studio-publish.ts publish  CHANGE --reason TEXT
 *     tsx scripts/studio-publish.ts rollback CHANGE --reason TEXT [--live-only | --draft-only]
 *     tsx scripts/studio-publish.ts resolve  CHANGE --reason TEXT [--owner-action]
 *
 * A Studio publish reaches every signed-in phone at once, so it is a live Home Assistant change by effect. This client speaks only to the
 * Studio server's own API on loopback (`/native/api/draft`, `validate`, `ha/open-check`, `ha/publication`, `ha/publish`, `ha/rollback`).
 * The Home Assistant credential stays in the Studio server and never reaches this process. It never opens the Studio's data directory.
 *
 * `CHANGE` is a directory under the change root (`STUDIO_PUBLISH_HOME`, default `~/hass-agents/studio-publish`), given as a path or a bare id.
 * That root lives outside every repository: the change record holds the owner's draft. It holds `change.json` (`id`, `task`,
 * `studio` {`base`, `publisherId`, `documentId`}, `base` {`draftRevision`, `document`, `liveRevision`, `liveEnvelopeSha256`}, `document` (the
 * full candidate), `scope` (JSON pointers the change may differ in), `summary`) and `evidence.json` (`candidateSha256`, `validation`,
 * `screenshots` {`before`, `after`}, `checks`; relative screenshot paths resolve against the change directory). After `apply` it also
 * holds `record.json` and `prior.json` (the draft before the change, mode 600).
 *
 * Order: `check` (read only) -> `apply` (record, then `PUT draft` with `expectedRevision`) -> `publish` (re-read, `POST ha/publish` with
 * `expectedRevision`, confirm). States `recorded -> applied -> published -> rolled_back`; each step is idempotent and resumable.
 *
 * Refusals: the draft must equal what the app serves (`open-check` first, then `draftIsLive`) so the owner's unpublished edits are never
 * shipped; the draft must be at the revision and document the change was built against; the diff must lie inside `scope`; the evidence must
 * be bound to the SHA-256 of the candidate's canonical text. A 409 stops with `stale_base` (rebuild, never retried).
 *
 * Auth: the Studio at 4801 runs without a token. The request goes out without credentials; on a 401 the token is read from the process
 * environment variable `STUDIO_AUTH_TOKEN` only (no file is read) and sent as a Bearer header. It is never printed, logged or put on a
 * command line. The base URL is `http://127.0.0.1:4801` unless `--base` (or the bundle) names another loopback port.
 *
 * Every attempt is one JSON line in `~/hass-agents/studio-publish.jsonl` (time, command, reason, change id, revisions, envelope hash,
 * security flag, result; never a document or a secret). Exit code: 0 done, 1 refused or failed, 3 stale base or owner edits (rebuild; not
 * an error to retry). An `ALERT` line is printed, and logged, when a rollback fails or a change is marked `owner_action`; `status` lists
 * every record that is not final.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { z } from 'zod/v4';
import type { HaPublicationSummary, HaPublishResult } from '../server/ha-publication';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { canonicalCompositionJSON } from '../src/shared/composition/json';
import type { CompositionDraft } from '../src/shared/composition/workspace';

// MARK: - Constants

const DEFAULT_BASE = 'http://127.0.0.1:4801';
const DEFAULT_LOG = '~/hass-agents/studio-publish.jsonl';
const DEFAULT_HOME = '~/hass-agents/studio-publish';
const TOKEN_ENV = 'STUDIO_AUTH_TOKEN';
/** Studios that are never the target unless the bundle itself names the port (the identity check is the real guard). */
const PINNED_PORTS = [4800, 4819];
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'];
const REQUEST_TIMEOUT_MS = 20_000;
/** A change bundle or evidence file larger than this is refused before anything is sent. */
const MAX_BYTES = 8 * 1024 * 1024;
/** `open-check` actions the tool accepts: `start` (the draft holds no edit the app lacks) and `keep`; `ask` means unpublished edits. */
const OPEN_OK = ['start', 'keep'];
/** A change that mentions these is flagged `security: true` in the log, as `tools/ha_change.py apply` does in native-home. */
const SECURITY_WORDS = ['lock.', 'alarm_control_panel.', 'garage', 'siren.'];
const STALE_CODES = ['stale_base', 'owner_edits'];
const MISSING = Symbol('missing');
const FINAL_STATES = ['published', 'rolled_back', 'resolved', 'owner_action'];

/** A refusal or failure with a reason code (the log and the output carry it) and an exit code. */
export class Refusal extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'Refusal'; }
  /** 3 for a stale base or owner edits, 2 for bad arguments, otherwise 1. */
  get exitCode() { return STALE_CODES.includes(this.code) ? 3 : this.code === 'bad_args' ? 2 : 1; }
}

// MARK: - Types

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface OpenCheck { action: string; reason?: string; draftRevision?: number; publishedRevision?: number }
type Change = z.infer<typeof changeSchema>;
type Difference = [pointer: string, before: unknown, after: unknown];

/** `record.json`: what was done and what is needed to undo it. Revisions and hashes only. */
export interface PublishRecord {
  change: string;
  state: 'recorded' | 'applied' | 'published' | 'rolled_back' | 'rollback_failed' | 'refused' | 'resolved' | 'owner_action';
  base: string | null;
  priorRevision: number;
  liveBefore: { revision: number | null; envelopeSha256: string | null };
  candidateSha256: string;
  security: boolean;
  reason: string;
  rebased: boolean;
  recordedAt: string;
  pendingDraftRevision?: number | null;
  afterDraftRevision?: number | null;
  draftWritten?: boolean;
  readBackSha256?: string;
  publishAttempted?: boolean;
  expectedPublishRevision?: number;
  publishedRevision?: number;
  publishedEnvelopeSha256?: string;
  publishedAt?: string;
  liveRolledBack?: boolean;
  draftRolledBack?: boolean;
  draftMoved?: boolean;
}

const revisionSchema = z.number().int();
const changeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/, 'change id must be letters, digits, dot, dash or underscore'),
  task: z.string().optional(),
  studio: z.object({ base: z.string().optional(), publisherId: z.string(), documentId: z.string() }),
  base: z.object({
    draftRevision: revisionSchema, document: z.record(z.string(), z.unknown()),
    liveRevision: revisionSchema, liveEnvelopeSha256: z.string().optional(),
  }),
  document: z.record(z.string(), z.unknown()),
  // An empty path would allow the whole document.
  scope: z.array(z.string().regex(/^\/.+/, 'scope must hold non-empty JSON pointers (an empty path would allow the whole document)')),
  summary: z.string().optional(),
});
const evidenceSchema = z.object({
  candidateSha256: z.string().optional(),
  storedSha256: z.string().optional(),
  validation: z.object({ result: z.string() }).optional(),
  screenshots: z.object({ before: z.array(z.string()).optional(), after: z.array(z.string()).optional() }).optional(),
  checks: z.array(z.object({ result: z.string() }).passthrough()).optional(),
});

// MARK: - JSON helpers

/** Parses JSON text and refuses a duplicate key (the last would silently win), which `JSON.parse` does not. */
export function parseStrict(text: string): unknown {
  let index = 0;
  const fail = (what: string): never => { throw new SyntaxError(`${what} at ${index}`); };
  const space = () => { while (index < text.length && ' \t\r\n'.includes(text[index])) index++; };
  const literal = (word: string, value: Json) => { if (!text.startsWith(word, index)) fail('bad literal'); index += word.length; return value; };
  function str(): string {
    const start = index++;
    while (index < text.length) {
      const char = text[index++];
      if (char === '\\') index++;
      else if (char === '"') return JSON.parse(text.slice(start, index)) as string;
    }
    return fail('unterminated string');
  }
  function value(depth: number): Json {
    if (depth > 100) fail('too deep');
    space();
    const char = text[index];
    if (char === '"') return str();
    if (char === '{') {
      index++; space();
      const out: Record<string, Json> = Object.create(null);
      if (text[index] === '}') { index++; return out; }
      for (;;) {
        space();
        if (text[index] !== '"') fail('expected key');
        const key = str();
        if (key in out) fail(`duplicate key ${JSON.stringify(key.slice(0, 40))}`);
        space();
        if (text[index++] !== ':') fail('expected colon');
        out[key] = value(depth + 1);
        space();
        const next = text[index++];
        if (next === '}') return { ...out };
        if (next !== ',') fail('expected comma');
      }
    }
    if (char === '[') {
      index++; space();
      const out: Json[] = [];
      if (text[index] === ']') { index++; return out; }
      for (;;) {
        out.push(value(depth + 1)); space();
        const next = text[index++];
        if (next === ']') return out;
        if (next !== ',') fail('expected comma');
      }
    }
    if (char === 't') return literal('true', true);
    if (char === 'f') return literal('false', false);
    if (char === 'n') return literal('null', null);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match) return fail('unexpected character');
    index += match[0].length;
    return Number(match[0]);
  }
  const result = value(0);
  space();
  if (index !== text.length) fail('trailing text');
  return result;
}

/** SHA-256 of a document's canonical text (the Studio's own canonicalization): how evidence is bound to a candidate. */
export function docSha256(document: unknown): string {
  return createHash('sha256').update(canonicalCompositionJSON(document)).digest('hex');
}
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
const escapePointer = (segment: string) => segment.replace(/~/g, '~0').replace(/\//g, '~1');
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The differences between two documents as `[JSON pointer, before, after]`; a changed list length is one difference at the list. */
export function diff(before: unknown, after: unknown, pointer = ''): Difference[] {
  if (isObject(before) && isObject(after)) {
    const out: Difference[] = [];
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const child = `${pointer}/${escapePointer(key)}`;
      if (key in before && key in after) out.push(...diff(before[key], after[key], child));
      else out.push([child, key in before ? before[key] : MISSING, key in after ? after[key] : MISSING]);
    }
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) return before.flatMap((item, index) => diff(item, after[index], `${pointer}/${index}`));
  return same(before, after) ? [] : [[pointer, before, after]];
}

/** Is `pointer` equal to, or below, one of the `scope` pointers (whole segments, never a string prefix)? */
export function inScope(pointer: string, scope: string[]): boolean {
  return scope.some(allowed => allowed !== '' && (pointer === allowed || pointer.startsWith(`${allowed.replace(/\/+$/, '')}/`)));
}

/** Does a changed pointer or value mention a lock, alarm, garage or siren? */
export function isSecurity(changes: Difference[]): boolean {
  return changes.some(([pointer, before, after]) => {
    const text = [pointer, ...[before, after].filter(value => value !== MISSING).map(value => JSON.stringify(value))].join(' ').toLowerCase();
    return SECURITY_WORDS.some(word => text.includes(word));
  });
}

/** The base URL when it is `http://127.0.0.1:PORT` or `http://localhost:PORT`, otherwise a refusal. Ports 4800 and 4819 need the bundle to name that base. */
export function checkBase(base: string, bundleBase?: string): string {
  let url: URL;
  try { url = new URL(base); } catch { throw new Refusal('bad_base', 'the base URL is not valid'); }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.includes(url.hostname) || !url.port || url.username || url.password)
    throw new Refusal('bad_base', 'the base URL must be http://127.0.0.1:PORT or http://localhost:PORT');
  if (!['', '/'].includes(url.pathname) || url.search || url.hash) throw new Refusal('bad_base', 'the base URL carries a path, query or fragment');
  const port = Number(url.port);
  if (PINNED_PORTS.includes(port) && bundleBase?.replace(/\/+$/, '') !== base.replace(/\/+$/, ''))
    throw new Refusal('bad_base', `port ${port} is refused unless the change bundle names it`);
  return `http://${url.hostname}:${port}`;
}

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const expandHome = (path: string) => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;

// MARK: - HTTP

/** A client for the Studio's own API on loopback. Auth is tried without credentials, then with `STUDIO_AUTH_TOKEN` on a 401. */
export class StudioClient {
  private useAuth = false;
  constructor(readonly base: string, private readonly token: string, private readonly fetchImpl: typeof fetch, private readonly sleep: (ms: number) => Promise<void>) {}

  /** `{status, data}`. One retry with back-off on 429 and one on a 401 with the token; never on 409 or 422. */
  async request(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
    let retried429 = false;
    for (;;) {
      const answer = await this.once(method, path, body);
      if (answer.status === 401 && this.token && !this.useAuth) { this.useAuth = true; continue; }
      if (answer.status === 401) throw new Refusal('auth_failed', `the Studio answered 401 and no valid ${TOKEN_ENV} is set`);
      if (answer.status === 429 && !retried429) { retried429 = true; await this.sleep(2000); continue; }
      return answer;
    }
  }

  private async once(method: string, path: string, body: unknown): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.useAuth) headers.Authorization = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await this.fetchImpl(this.base + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch { throw new Refusal('studio_unreachable', `the Studio did not answer on ${this.base}`); }
    const text = await response.text().catch(() => '');
    let data: unknown = null;
    try { data = text ? parseStrict(text) : null; } catch { data = null; }
    return { status: response.status, data };
  }
}

// MARK: - Options and output

export interface PublishOptions {
  env?: Record<string, string | undefined>;
  /** The change root; default `STUDIO_PUBLISH_HOME` or `~/hass-agents/studio-publish`. */
  home?: string;
  logPath?: string;
  out?: (line: string) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

// MARK: - The publisher

export class Publisher {
  private readonly env: Record<string, string | undefined>;
  private readonly homeDir: string;
  private readonly logPath: string;
  private readonly emit: (line: string) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private client?: StudioClient;

  constructor(options: PublishOptions = {}) {
    this.env = options.env ?? process.env;
    this.homeDir = resolve(expandHome(options.home ?? this.env.STUDIO_PUBLISH_HOME ?? DEFAULT_HOME));
    this.logPath = resolve(expandHome(options.logPath ?? DEFAULT_LOG));
    this.emit = options.out ?? ((line) => console.log(line));
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise(done => setTimeout(done, ms)));
  }

  // MARK: Output

  /** Redacts the Studio token (if set) and credential-shaped text from anything that leaves the tool. */
  scrub(text: string): string {
    const token = this.env[TOKEN_ENV];
    let out = token ? text.split(token).join('[redacted]') : text;
    out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[redacted]')
      .replace(/\b((?:[A-Za-z_]*(?:token|password|passwd|secret|api[_-]?key))\s*[=:]\s*)[^\s"',;]+/gi, '$1[redacted]')
      .replace(/\b(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_]{16,}/g, '[redacted]');
    return out;
  }
  say(text: string) { this.emit(this.scrub(text)); }

  /** One line in the JSONL log: revisions, hashes, the reason code and the security flag; never a document or a secret. */
  async log(command: string, reason: string, change: string, result: string, fields: Record<string, unknown> = {}) {
    const line: Record<string, unknown> = { time: now(), command, reason, change, result };
    for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null) line[key] = value;
    try {
      await mkdir(resolve(this.logPath, '..'), { recursive: true });
      await appendFile(this.logPath, `${this.scrub(JSON.stringify(sortKeys(line)))}\n`);
    } catch { this.say('warning: the log could not be written'); }
  }

  /** The owner must hear about a rollback that failed and about a change marked for hand work: an ALERT line, here and in the log. */
  private async alert(kind: 'rollback_failed' | 'owner_action', change: string, detail: string) {
    this.say(`ALERT [${kind}] ${change}: ${detail}`);
    await this.log('alert', kind, change, kind === 'owner_action' ? 'owner_action_needed' : 'rollback_failed_alert');
  }

  // MARK: Bundle

  /** The resolved change directory: an existing directory under the change root, given as a path or a bare id. */
  async changeDir(given: string): Promise<string> {
    let root: string;
    try { root = await realpath(this.homeDir); } catch { throw new Refusal('bad_bundle', 'the change root does not exist'); }
    if (await insideGitRepository(root)) throw new Refusal('bad_root', 'the change root (STUDIO_PUBLISH_HOME) is inside a git repository; it holds the owner\'s draft, so keep it outside every repository');
    const candidate = isAbsolute(given) || given.includes('/') ? resolve(given) : join(root, given);
    let path: string;
    try { path = await realpath(candidate); } catch { throw new Refusal('bad_bundle', 'CHANGE must be an existing directory under the change root'); }
    if (path === root || !path.startsWith(root + sep) || !(await stat(path)).isDirectory())
      throw new Refusal('bad_bundle', 'CHANGE must be an existing directory under the change root');
    return path;
  }

  private async readJson(path: string, what: string): Promise<unknown> {
    let raw: Buffer;
    try { raw = await readFile(path); } catch { throw new Refusal('bad_bundle', `${what} is missing or unreadable`); }
    if (raw.length > MAX_BYTES) throw new Refusal('bad_bundle', `${what} is larger than ${MAX_BYTES} bytes`);
    try { return parseStrict(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch (error) { throw new Refusal('bad_bundle', `${what} is not valid JSON (${error instanceof Error ? error.message : 'unreadable'})`); }
  }

  private async writePrivate(path: string, data: unknown) {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(sortKeys(data), null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }

  async loadChange(directory: string): Promise<Change> {
    const parsed = changeSchema.safeParse(await this.readJson(join(directory, 'change.json'), 'change.json'));
    if (!parsed.success) throw new Refusal('bad_bundle', `change.json: ${parsed.error.issues[0].path.join('.') || 'shape'}: ${parsed.error.issues[0].message}`);
    return parsed.data;
  }

  /** The differences of the candidate against the base, refused unless every one lies inside `scope`. Returns them and the security flag. */
  scopeCheck(change: Change): { changes: Difference[]; security: boolean } {
    const changes = diff(change.base.document, change.document);
    if (changes.length === 0) throw new Refusal('no_change', 'the candidate document equals the base: nothing to apply');
    if (change.scope.length === 0) throw new Refusal('scope_violation', 'the change declares no scope');
    const outside = changes.map(([pointer]) => pointer).filter(pointer => !inScope(pointer, change.scope));
    if (outside.length > 0)
      throw new Refusal('scope_violation', `${outside.length} difference(s) outside the declared scope: ${outside.slice(0, 5).map(p => p.slice(0, 100)).join(', ')}`);
    return { changes, security: isSecurity(changes) };
  }

  /** The Studio's own compile of the candidate, offline (no write, no request): structure and semantics. */
  compileCheck(change: Change) {
    try { compileCompositionDocument(change.document); }
    catch (error) { throw new Refusal('invalid', `the Studio's compile refused the candidate (${error instanceof Error ? error.message : 'invalid'})`); }
  }

  /** `evidence.json` must pass every required check and be bound to the hash of the candidate document. */
  async evidenceCheck(directory: string, change: Change) {
    const parsed = evidenceSchema.safeParse(await this.readJson(join(directory, 'evidence.json'), 'evidence.json'));
    if (!parsed.success) throw new Refusal('bad_bundle', 'evidence.json has the wrong shape');
    const evidence = parsed.data;
    if (evidence.candidateSha256 !== docSha256(change.document)) throw new Refusal('evidence_unbound', 'evidence.json is not bound to this candidate document (candidateSha256 differs)');
    if (evidence.validation?.result !== 'pass') throw new Refusal('evidence_missing', 'evidence.json needs validation.result = pass');
    for (const side of ['before', 'after'] as const) {
      const paths = evidence.screenshots?.[side];
      if (!paths || paths.length === 0) throw new Refusal('evidence_missing', `evidence.json needs screenshots.${side} as a list of paths`);
      for (const path of paths) {
        const target = isAbsolute(path) ? path : join(directory, path);
        if (!(await stat(target).then(info => info.isFile(), () => false))) throw new Refusal('evidence_missing', `a ${side} screenshot does not exist: ${path.slice(0, 120)}`);
      }
    }
    if ((evidence.checks ?? []).some(check => check.result !== 'pass')) throw new Refusal('evidence_failed', 'a required check in evidence.json is not marked pass');
    return evidence;
  }

  // MARK: Studio reads

  private connect(change: Change | undefined, base: string | undefined): StudioClient {
    this.client = new StudioClient(checkBase(base ?? change?.studio.base ?? DEFAULT_BASE, change?.studio.base), this.env[TOKEN_ENV] ?? '', this.fetchImpl, this.sleep);
    return this.client;
  }
  private studio(): StudioClient { if (!this.client) throw new Error('not connected'); return this.client; }

  private async get<T>(path: string, code: string): Promise<T> {
    const { status, data } = await this.studio().request('GET', path);
    if (status !== 200 || !isObject(data)) throw new Refusal(code, `GET ${path} answered ${status}`);
    return data as T;
  }

  /** `[open-check, publication, draft]`, in that order: open-check is read first. */
  private async readState(): Promise<[OpenCheck, HaPublicationSummary, CompositionDraft]> {
    const openCheck = await this.get<OpenCheck>('/native/api/ha/open-check', 'ha_unreachable');
    const publication = await this.get<HaPublicationSummary>('/native/api/ha/publication', 'ha_unreachable');
    const draft = await this.get<CompositionDraft>('/native/api/draft', 'studio_unreachable');
    return [openCheck, publication, draft];
  }

  private liveOf(publication: HaPublicationSummary): [number | undefined, string | undefined] {
    return [publication.current?.revision, publication.current?.envelopeSha256];
  }

  /** The scope guard: refuse unless the draft equals what the app serves. */
  private requireServing(openCheck: OpenCheck, publication: HaPublicationSummary) {
    if (!OPEN_OK.includes(openCheck.action)) throw new Refusal('owner_edits', `the owner has unpublished edits in the draft (open-check says ${String(openCheck.action).slice(0, 20)}); wait`);
    if (publication.draftIsLive !== true) throw new Refusal('owner_edits', 'the draft does not equal what the app serves (draftIsLive is not true); wait');
  }

  // MARK: Records

  private async loadRecord(directory: string): Promise<PublishRecord | undefined> {
    const path = join(directory, 'record.json');
    if (!(await stat(path).then(() => true, () => false))) return undefined;
    return await this.readJson(path, 'record.json') as PublishRecord;
  }
  private async finish(directory: string, record: PublishRecord, state: PublishRecord['state']) {
    record.state = state;
    await this.writePrivate(join(directory, 'record.json'), record);
  }
  private async records(): Promise<{ id: string; record?: PublishRecord }[]> {
    let names: string[];
    try { names = (await readdir(this.homeDir)).sort(); } catch { return []; }
    const out: { id: string; record?: PublishRecord }[] = [];
    for (const name of names) {
      const path = join(this.homeDir, name, 'record.json');
      if (!(await stat(path).then(() => true, () => false))) continue;
      try { out.push({ id: name, record: await this.readJson(path, 'record.json') as PublishRecord }); } catch { out.push({ id: name }); }
    }
    return out;
  }

  // MARK: Commands

  /** Revisions and flags only: no document, token or house value. */
  async status(base: string | undefined, asJson: boolean): Promise<number> {
    this.connect(undefined, base);
    const [openCheck, publication, draft] = await this.readState();
    const all = await this.records();
    const info = {
      draftRevision: draft.revision, liveRevision: this.liveOf(publication)[0], draftIsLive: publication.draftIsLive ?? null,
      openCheck: openCheck.action, historyRevisions: (publication.history ?? []).map(entry => entry.revision),
      lastChange: await this.lastLogged(),
      openChanges: all.flatMap(({ id, record }) => !record ? [{ change: id, state: 'unreadable' }]
        : ['recorded', 'applied', 'rollback_failed'].includes(record.state) || (record.state === 'refused' && record.draftWritten) ? [{ change: record.change ?? id, state: record.state }] : []),
      ownerAction: all.flatMap(({ id, record }) => record?.state === 'owner_action' ? [{ change: record.change ?? id, state: 'owner_action' }] : []),
    };
    this.say(asJson ? JSON.stringify(sortKeys(info)) : Object.entries(info).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n'));
    return 0;
  }

  private async lastLogged() {
    try {
      const lines = (await readFile(this.logPath, 'utf8')).split('\n').filter(line => line.trim());
      const line = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
      return { time: line.time, command: line.command, change: line.change, result: line.result };
    } catch { return null; }
  }

  /** The read-only check. Returns the change and a context (draft, revisions, security flag); throws a `Refusal`. */
  async check(given: string, base: string | undefined, asJson: boolean, options: { rebaseIdentical?: boolean; command?: string } = {}) {
    const directory = await this.changeDir(given);
    const change = await this.loadChange(directory);
    const { changes, security } = this.scopeCheck(change);
    this.compileCheck(change);
    await this.evidenceCheck(directory, change);
    this.connect(change, base);
    const [openCheck, publication, draft] = await this.readState();
    this.requireServing(openCheck, publication);
    const document = draft.document as unknown;
    if (draft.publisherId !== change.studio.publisherId || !isObject(document) || document.id !== change.studio.documentId)
      throw new Refusal('wrong_studio', "the Studio's publisherId or document id differs from the bundle's");
    const [liveRevision, liveSha] = this.liveOf(publication);
    if (liveRevision !== change.base.liveRevision || (change.base.liveEnvelopeSha256 !== undefined && change.base.liveEnvelopeSha256 !== liveSha))
      throw new Refusal('ha_moved', 'the live publication differs from the one the change was built against; rebuild');
    if (!same(document, change.base.document)) throw new Refusal('stale_base', 'the draft document differs from the base the change was built against; rebuild');
    let rebased = false;
    if (draft.revision !== change.base.draftRevision) {
      if (!options.rebaseIdentical) throw new Refusal('stale_base', `the draft is at revision ${draft.revision}, the change was built at ${change.base.draftRevision}; rebuild`);
      rebased = true;
    }
    const verdict = await this.studio().request('POST', '/native/api/validate', { document: change.document });
    if (verdict.status !== 200 || !isObject(verdict.data) || verdict.data.valid !== true) throw new Refusal('invalid', `the Studio's validation refused the candidate (HTTP ${verdict.status})`);
    const context = { directory, draft, revision: draft.revision, liveRevision, liveSha, security, rebased, candidateSha256: docSha256(change.document) };
    if ((options.command ?? 'check') === 'check') {
      const summary = { change: change.id, state: 'checked', draftRevision: draft.revision, liveRevision, differences: changes.length, security };
      this.say(asJson ? JSON.stringify(sortKeys(summary)) : `checked ${change.id}: draft r${draft.revision}, live r${liveRevision}, ${changes.length} difference(s), security=${security}`);
    }
    return { change, context };
  }

  /** Record, `PUT draft` with the revision, verify. Resumes from `record.json`; with `publish` goes on to `publish`. */
  async apply(given: string, base: string | undefined, reason: string, options: { publish?: boolean; rebaseIdentical?: boolean; json?: boolean }): Promise<number> {
    const directory = await this.changeDir(given);
    const existing = await this.loadRecord(directory);
    const state = existing?.state;
    if (existing && (state === 'applied' || state === 'published')) {
      this.say(`already ${state}: ${existing.change}`);
      return options.publish && state === 'applied' ? this.publish(given, base, reason, options.json ?? false) : 0;
    }
    if (existing && (state === 'recorded' || state === 'rollback_failed' || (state === 'refused' && existing.draftWritten)))
      throw new Refusal('unresolved', `an earlier run left this change ${state}: run rollback --draft-only first`);
    const { change, context } = await this.check(given, base, options.json ?? false, { rebaseIdentical: options.rebaseIdentical, command: 'apply' });
    const record: PublishRecord = {
      change: change.id, state: 'recorded', base: this.studio().base, priorRevision: context.revision,
      liveBefore: { revision: context.liveRevision ?? null, envelopeSha256: context.liveSha ?? null },
      candidateSha256: context.candidateSha256, security: context.security, reason: this.scrub(reason), rebased: context.rebased,
      recordedAt: now(), pendingDraftRevision: context.revision + 1,
    };
    await this.writePrivate(join(directory, 'prior.json'), { document: context.draft.document, revision: context.revision });
    await this.writePrivate(join(directory, 'record.json'), record);
    const written = await this.studio().request('PUT', '/native/api/draft', { document: change.document, expectedRevision: context.revision });
    if (written.status === 409) {
      record.pendingDraftRevision = null;
      await this.finish(directory, record, 'refused');
      throw new Refusal('stale_base', 'the draft moved before the write (409): the owner or another tool saved; rebuild, do not retry');
    }
    if (written.status !== 200) {
      record.pendingDraftRevision = null;
      await this.finish(directory, record, 'refused');
      throw new Refusal('rejected', `the Studio refused the draft write (HTTP ${written.status}); the draft is unchanged`);
    }
    const after = await this.get<CompositionDraft>('/native/api/draft', 'studio_unreachable');
    const evidence = await this.readJson(join(directory, 'evidence.json'), 'evidence.json') as { storedSha256?: string };
    const matches = evidence.storedSha256 ? docSha256(after.document) === evidence.storedSha256 : same(after.document, change.document);
    if (!matches) {
      Object.assign(record, { draftWritten: true, readBackSha256: docSha256(after.document), afterDraftRevision: after.revision });
      await this.finish(directory, record, 'refused');
      throw new Refusal('store_mismatch', 'the draft the Studio stored differs from the candidate; run rollback --draft-only');
    }
    record.afterDraftRevision = after.revision;
    await this.finish(directory, record, 'applied');
    await this.log('apply', reason, change.id, 'applied', { priorRevision: context.revision, draftRevision: after.revision, liveRevision: context.liveRevision, security: context.security });
    this.say(`applied ${change.id}: draft r${context.revision} -> r${after.revision}`);
    return options.publish ? this.publish(given, base, reason, options.json ?? false) : 0;
  }

  /** Re-read, `POST ha/publish` with `expectedRevision`, confirm the live revision, hash and `draftIsLive`. */
  async publish(given: string, base: string | undefined, reason: string, asJson: boolean): Promise<number> {
    const directory = await this.changeDir(given);
    const record = await this.loadRecord(directory);
    if (!record || (record.state !== 'applied' && record.state !== 'published')) throw new Refusal('not_applied', 'nothing applied for this change; run apply first');
    if (record.state === 'published') { this.say(`already published: ${record.change}`); return 0; }
    const change = await this.loadChange(directory);
    this.scopeCheck(change);
    await this.evidenceCheck(directory, change);
    this.connect(change, base);
    const [, publication, draft] = await this.readState();
    if (draft.revision !== record.afterDraftRevision || !same(draft.document, change.document))
      throw new Refusal('owner_edits', 'the draft moved since the apply (the owner saved); not publishing, the draft is untouched');
    const [liveRevision] = this.liveOf(publication);
    if (liveRevision !== record.liveBefore.revision) throw new Refusal('ha_moved', 'the live publication moved since the check; not publishing');
    record.publishAttempted = true;
    record.expectedPublishRevision = record.afterDraftRevision as number;
    await this.finish(directory, record, 'applied');
    const published = await this.studio().request('POST', '/native/api/ha/publish', { expectedRevision: record.afterDraftRevision });
    if (published.status === 409) throw new Refusal('owner_edits', 'the draft moved before the publish (409); not publishing');
    const result = published.data as HaPublishResult | null;
    if (published.status !== 200 || !isObject(result))
      throw new Refusal(published.status >= 500 || published.status === 0 ? 'ha_unreachable' : 'rejected', `the publish answered ${published.status}; the state stays applied, run publish again to resume`);
    const confirm = await this.get<HaPublicationSummary>('/native/api/ha/publication', 'ha_unreachable');
    const [revision, sha] = this.liveOf(confirm);
    if (revision !== result.revision || sha !== result.envelopeSha256 || confirm.draftIsLive !== true) throw new Refusal('publish_unconfirmed', 'the publication read back does not match the publish answer');
    Object.assign(record, { publishedRevision: revision, publishedEnvelopeSha256: sha, publishedAt: now() });
    await this.finish(directory, record, 'published');
    await this.log('publish', reason, change.id, 'published', { draftRevision: record.afterDraftRevision, liveRevision: revision, envelopeSha256: sha, security: record.security });
    const info = { change: change.id, state: 'published', liveRevision: revision, envelopeSha256: sha, security: record.security };
    this.say(asJson ? JSON.stringify(sortKeys(info)) : `published ${change.id}: live r${revision}; the owner's open Studio tab needs a reload`);
    return 0;
  }

  /**
   * Marks a record final so a stale one stops showing in `status`. `resolved` after read-only checks that nothing of this change is left (the
   * draft no longer equals the candidate, the live publication is not this tool's). `--owner-action` marks a rollback that failed, or a draft
   * that moved, for the owner without those checks; it is logged, alerted, and listed by `status` until `resolve` clears it.
   */
  async resolve(given: string, base: string | undefined, reason: string, ownerAction: boolean): Promise<number> {
    const directory = await this.changeDir(given);
    const record = await this.loadRecord(directory);
    if (!record) throw new Refusal('not_applied', 'no record for this change');
    const change = await this.loadChange(directory);
    if (record.state === 'resolved' || record.state === 'rolled_back') { this.say(`already final: ${change.id} (${record.state})`); return 0; }
    if (ownerAction) {
      if (record.state !== 'rollback_failed' && record.state !== 'owner_action' && !record.draftMoved)
        throw new Refusal('not_stuck', '--owner-action is for a rollback that failed or a draft that moved; otherwise run rollback');
      await this.finish(directory, record, 'owner_action');
      await this.log('resolve', reason, change.id, 'owner_action', { security: record.security });
      await this.alert('owner_action', change.id, 'marked for the owner to finish by hand');
      this.say(`${change.id}: marked owner_action; the owner must finish it by hand`);
      return 0;
    }
    this.connect(change, base);
    const draft = await this.get<CompositionDraft>('/native/api/draft', 'studio_unreachable');
    const publication = await this.get<HaPublicationSummary>('/native/api/ha/publication', 'ha_unreachable');
    if (same(draft.document, change.document)) throw new Refusal('still_ours', 'the draft still holds this change: run rollback --draft-only');
    const [current] = this.liveOf(publication);
    const ours = record.publishedRevision;
    if ((ours !== undefined && current === ours) || (record.publishAttempted && ours === undefined && current !== record.liveBefore.revision && !record.liveRolledBack))
      throw new Refusal('still_ours', 'the live publication may still hold this change: run rollback --live-only, or resolve --owner-action');
    await this.finish(directory, record, 'resolved');
    await this.log('resolve', reason, change.id, 'resolved', { security: record.security });
    this.say(`resolved ${change.id}`);
    return 0;
  }

  /**
   * Puts the live publication and the draft back. The live side first (`ha/rollback`, else republish the prior document), then the draft
   * (only while it still sits at the revision this tool left and holds this tool's write). Works from any record that wrote or tried to write.
   */
  async rollback(given: string, base: string | undefined, reason: string, options: { liveOnly?: boolean; draftOnly?: boolean; json?: boolean }): Promise<number> {
    const directory = await this.changeDir(given);
    const record = await this.loadRecord(directory);
    if (!record || !['recorded', 'applied', 'published', 'refused', 'rolled_back', 'rollback_failed'].includes(record.state)) throw new Refusal('not_applied', 'nothing to roll back for this change');
    const change = await this.loadChange(directory);
    const prior = await this.readJson(join(directory, 'prior.json'), 'prior.json') as { document: unknown };
    this.connect(change, base);
    const wasPublished = Boolean(record.publishedRevision) || record.state === 'published' || Boolean(record.publishAttempted);
    const wantLive = wasPublished && !options.draftOnly && !record.liveRolledBack;
    const wantDraft = !options.liveOnly && !record.draftRolledBack;
    const outcome: Record<string, unknown> = { change: change.id };
    let fallback = false;
    try {
      if (wantLive) fallback = !(await this.rollbackLive(record, outcome));
      if (wantDraft || fallback) await this.rollbackDraft(record, prior, change.document, outcome, fallback);
    } catch (error) {
      if (error instanceof Refusal) {
        await this.finish(directory, record, 'rollback_failed');
        await this.log('rollback', reason, change.id, `rollback_failed:${error.code}`);
        await this.alert('rollback_failed', change.id, `${error.code}: ${error.message}`);
      }
      throw error;
    }
    const done = (record.liveRolledBack || !wasPublished) && record.draftRolledBack;
    await this.finish(directory, record, done ? 'rolled_back' : record.state);
    await this.log('rollback', reason, change.id, done ? 'rolled_back' : 'partial', {
      draftRevision: outcome.draftRevision, liveRevision: outcome.liveRevision, envelopeSha256: outcome.envelopeSha256, security: record.security,
    });
    this.say(options.json ? JSON.stringify(sortKeys(outcome))
      : `rolled back ${change.id}: ${Object.entries(outcome).filter(([key]) => key !== 'change').sort().map(([key, value]) => `${key}=${String(value)}`).join(', ')}; reload the open Studio tab`);
    return 0;
  }

  /**
   * `POST ha/rollback` to the revision recorded before the publish. True when done (or when the publish never took effect); false when the
   * entry aged out (404): republish instead. Refuses `live_moved` unless the live revision is still the one this tool published, so the
   * owner's later publish is never undone; an unconfirmed publish counts as ours only when the live revision is exactly one past the
   * recorded one and the draft equals it.
   */
  private async rollbackLive(record: PublishRecord, outcome: Record<string, unknown>): Promise<boolean> {
    const before = record.liveBefore;
    const publication = await this.get<HaPublicationSummary>('/native/api/ha/publication', 'ha_unreachable');
    const [current] = this.liveOf(publication);
    const ours = record.publishedRevision;
    if (ours === undefined && current === before.revision) { record.liveRolledBack = true; outcome.live = 'never_published'; return true; }
    if (ours !== undefined && current !== ours) throw new Refusal('live_moved', 'the live publication is no longer the one this tool published (the owner published since); leaving it');
    if (ours === undefined && !(before.revision !== null && current === before.revision + 1 && publication.draftIsLive === true))
      throw new Refusal('live_moved', "the live publication after an unconfirmed publish is not provably this tool's; leaving it");
    const rolled = await this.studio().request('POST', '/native/api/ha/rollback', { revision: before.revision });
    if (rolled.status === 404) return false;
    if (rolled.status !== 200) throw new Refusal('rollback_failed', `ha/rollback answered ${rolled.status}`);
    const [revision, sha] = this.liveOf(await this.get<HaPublicationSummary>('/native/api/ha/publication', 'ha_unreachable'));
    if (before.envelopeSha256 && sha !== before.envelopeSha256) throw new Refusal('rollback_failed', 'the live publication after the rollback is not the one recorded before the publish');
    record.liveRolledBack = true;
    Object.assign(outcome, { liveRevision: revision, envelopeSha256: sha, live: 'rolled_back' });
    return true;
  }

  /**
   * `PUT` the saved prior document while the draft still sits at the revision this tool left AND holds this tool's write (the candidate, or the
   * read-back hash recorded by a store mismatch; a revision number alone is not proof, the owner's autosave can take the same number);
   * otherwise report `draft_moved`. With `publishAfter` (the live entry aged out) the restored draft is then published to put the live side
   * back; before that the draft must equal the saved prior document and the live revision must still be this tool's.
   */
  private async rollbackDraft(record: PublishRecord, prior: { document: unknown }, candidate: unknown, outcome: Record<string, unknown>, publishAfter: boolean) {
    let draft = await this.get<CompositionDraft>('/native/api/draft', 'studio_unreachable');
    let revision = draft.revision;
    const left = record.afterDraftRevision ?? record.pendingDraftRevision;
    if (!record.draftRolledBack) {
      const proven = same(draft.document, candidate) || (record.readBackSha256 !== undefined && docSha256(draft.document) === record.readBackSha256);
      if (revision === record.priorRevision && same(draft.document, prior.document)) {
        record.draftRolledBack = true; // the write never landed
        outcome.draft = 'unchanged';
      } else if (revision !== left || !proven) {
        outcome.draft = 'draft_moved';
        record.draftMoved = true;
        if (publishAfter) throw new Refusal('rollback_failed', 'the live entry aged out and the draft moved: nothing safe to republish; report to the owner');
        return;
      } else {
        if (publishAfter) this.requireServing(await this.get<OpenCheck>('/native/api/ha/open-check', 'ha_unreachable'), await this.get<HaPublicationSummary>('/native/api/ha/publication', 'ha_unreachable'));
        const restored = await this.studio().request('PUT', '/native/api/draft', { document: prior.document, expectedRevision: revision });
        if (restored.status !== 200) throw new Refusal('rollback_failed', `restoring the draft answered ${restored.status}`);
        draft = await this.get<CompositionDraft>('/native/api/draft', 'studio_unreachable');
        revision = draft.revision;
        record.draftRolledBack = true;
        Object.assign(outcome, { draft: 'restored', draftRevision: revision });
      }
    }
    if (publishAfter) {
      const publication = await this.get<HaPublicationSummary>('/native/api/ha/publication', 'ha_unreachable');
      const ours = record.publishedRevision;
      const [current] = this.liveOf(publication);
      if (!same(draft.document, prior.document)) throw new Refusal('rollback_failed', 'the draft no longer equals the saved prior document (the owner edited); not republishing');
      if (ours !== undefined && current !== ours) throw new Refusal('live_moved', 'the live publication is no longer the one this tool published; not republishing');
      const published = await this.studio().request('POST', '/native/api/ha/publish', { expectedRevision: revision });
      const result = published.data as HaPublishResult | null;
      if (published.status !== 200 || !isObject(result)) throw new Refusal('rollback_failed', `republishing the prior document answered ${published.status}`);
      // A republish is a new envelope (new revision, new time), so its hash never equals the original's: confirm by reading back instead.
      const confirm = await this.get<HaPublicationSummary>('/native/api/ha/publication', 'ha_unreachable');
      if (confirm.current?.revision !== result.revision || confirm.current?.envelopeSha256 !== result.envelopeSha256 || confirm.draftIsLive !== true)
        throw new Refusal('rollback_failed', 'the publication read back after the republish does not match the restored prior document');
      record.liveRolledBack = true;
      Object.assign(outcome, { live: 'republished', liveRevision: result.revision, envelopeSha256: result.envelopeSha256 });
    }
  }
}

/** A copy with every object's keys sorted, so records and log lines are stable. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
}

// MARK: - Command line

const usage = 'Usage: tsx scripts/studio-publish.ts status|check|apply|publish|rollback|resolve [CHANGE] [--reason TEXT] [--base URL] [--json] [--log PATH]';

/** Runs one command and returns the exit code. `options` is for tests. */
export async function run(argv: string[], options: PublishOptions = {}): Promise<number> {
  const tool = new Publisher(options);
  let parsed: ReturnType<typeof parseCli>;
  try { parsed = parseCli(argv); } catch (error) { tool.say(`${error instanceof Error ? error.message : 'bad arguments'}\n${usage}`); return 2; }
  const { command, change, values } = parsed;
  const publisher = values.log ? new Publisher({ ...options, logPath: values.log }) : tool;
  const reason = values.reason ?? '';
  try {
    if (command === 'status') return await publisher.status(values.base, Boolean(values.json));
    if (!change) throw new Refusal('bad_args', `${command} needs a CHANGE`);
    if (command !== 'check' && !reason) throw new Refusal('bad_args', `${command} needs --reason`);
    if (command === 'check') { await publisher.check(change, values.base, Boolean(values.json)); return 0; }
    if (command === 'apply') return await publisher.apply(change, values.base, reason, { publish: values.publish, rebaseIdentical: values['rebase-identical'], json: values.json });
    if (command === 'publish') return await publisher.publish(change, values.base, reason, Boolean(values.json));
    if (command === 'resolve') return await publisher.resolve(change, values.base, reason, Boolean(values['owner-action']));
    return await publisher.rollback(change, values.base, reason, { liveOnly: values['live-only'], draftOnly: values['draft-only'], json: values.json });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    if (command !== 'status' && change) {
      const id = await publisher.changeDir(change).then(dir => publisher.loadChange(dir)).then(c => c.id, () => '');
      await publisher.log(command, reason, id, `refused:${error.code}`);
    }
    publisher.say(`REFUSED [${error.code}]: ${error.message}${error.exitCode === 3 ? ' (rebuild the change; do not retry)' : ''}`);
    return error.exitCode;
  }
}

function parseCli(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: {
      reason: { type: 'string' }, base: { type: 'string' }, log: { type: 'string' }, json: { type: 'boolean' }, publish: { type: 'boolean' },
      'rebase-identical': { type: 'boolean' }, 'live-only': { type: 'boolean' }, 'draft-only': { type: 'boolean' }, 'owner-action': { type: 'boolean' },
    },
  });
  const [command, change, ...extra] = positionals;
  if (!['status', 'check', 'apply', 'publish', 'rollback', 'resolve'].includes(command ?? '') || extra.length > 0 || (command === 'status' && change !== undefined))
    throw new Error('unknown command or too many arguments');
  if (values['live-only'] && values['draft-only']) throw new Error('--live-only and --draft-only exclude each other');
  return { command, change, values };
}

/**
 * True when `entry` (`process.argv[1]`) is this module, compared by real path so a symlinked path to the script still runs `main`.
 * A script named `studio-publish.ts` or `studio-publish` always counts: an unrecognised entry must never exit 0 having done nothing.
 */
export function isMain(entry: string | undefined, moduleUrl: string): boolean {
  if (!entry) return false;
  const real = (value: string) => { try { return realpathSync(value); } catch { return resolve(value); } };
  if (real(entry) === real(fileURLToPath(moduleUrl))) return true;
  return /(?:^|[\\/])studio-publish(?:\.ts)?$/.test(entry);
}

/** True when `directory` or any parent holds a `.git` entry. */
async function insideGitRepository(directory: string): Promise<boolean> {
  for (let current = directory; ; current = dirname(current)) {
    if (await stat(join(current, '.git')).then(() => true, () => false)) return true;
    if (dirname(current) === current) return false;
  }
}

if (isMain(process.argv[1], import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2));
}
