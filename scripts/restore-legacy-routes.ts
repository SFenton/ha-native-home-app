/**
 * Adds the legacy route aliases and link prefixes to the draft, so older dashboard links keep opening the same pages
 * once the app reads routes as plain authored paths (note 07 section 5.4).
 *
 *   STUDIO_AUTH_TOKEN=... STUDIO_URL=http://127.0.0.1:4801 tsx scripts/restore-legacy-routes.ts
 *
 * Goes only through the running Studio's HTTP API (GET then PUT /native/api/draft, producing a new draft revision) and reads
 * the token from the environment. It reuses the Routes editor's "Import legacy aliases" logic, so the result is idempotent:
 * an alias another route already uses is skipped and reported. Run it only against a build that accepts `sh.route-links@1`;
 * an older build rejects the PUT, which leaves the draft untouched.
 */
import { importLegacyAliases } from '../src/routes-editor';

const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:4801';
const token = process.env.STUDIO_AUTH_TOKEN;
if (!token) throw new Error('STUDIO_AUTH_TOKEN is required');

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const draft = await (await fetch(`${base}/native/api/draft`, { headers })).json() as { revision: number; document: any };
if (!draft.document.extensions) throw new Error('The draft has no native extensions; nothing written');
const result = importLegacyAliases(draft.document.extensions);
if (result.added.length === 0) { console.log(`Nothing to add${result.skipped.length ? ` (skipped: ${result.skipped.join(', ')})` : ''}`); process.exit(0); }
draft.document.extensions = result.extensions;
const response = await fetch(`${base}/native/api/draft`, { method: 'PUT', headers, body: JSON.stringify({ document: draft.document, expectedRevision: draft.revision }) });
if (!response.ok) throw new Error(`Studio refused the draft (${response.status}): ${await response.text()}`);
console.log(`Added ${result.added.join(', ')}${result.skipped.length ? `; skipped ${result.skipped.join(', ')}` : ''} as revision ${(await response.json() as { revision: number }).revision}`);
