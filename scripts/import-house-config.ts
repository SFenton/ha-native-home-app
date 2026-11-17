/**
 * Imports the layout house configuration used to carry (chores pages, rooms) into the Studio draft.
 *
 *   STUDIO_AUTH_TOKEN=... STUDIO_URL=http://127.0.0.1:4801 tsx scripts/import-house-config.ts
 *
 * Goes only through the running Studio's HTTP API: GET /native/api/draft for the revision, then POST
 * /native/api/import-house-config, which reads the live house config over the Studio's own Home Assistant connection and
 * saves what the draft does not yet author as a new draft revision. Nothing the draft already authors is changed, so the
 * script can be run again. It never publishes. The token is read from the environment and never printed.
 *
 * The result lists every house-config behaviour the publication cannot express, by field path.
 */
const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:4801';
const token = process.env.STUDIO_AUTH_TOKEN;
if (!token) throw new Error('STUDIO_AUTH_TOKEN is required');

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const draft = await (await fetch(`${base}/native/api/draft`, { headers })).json() as { revision: number };
const response = await fetch(`${base}/native/api/import-house-config`, {
  method: 'POST', headers, body: JSON.stringify({ expectedRevision: draft.revision }),
});
if (!response.ok) throw new Error(`Studio refused the import (${response.status}): ${await response.text()}`);
const result = await response.json() as { revision: number; added: string[]; kept: string[]; dropped: { path: string; reason: string }[] };

console.log(`Draft is now revision ${result.revision} (was ${draft.revision}).`);
console.log(`Added ${result.added.length}: ${result.added.join(', ') || 'nothing'}`);
console.log(`Already authored, left alone ${result.kept.length}: ${result.kept.join(', ') || 'nothing'}`);
console.log(`Not expressible ${result.dropped.length}:`);
for (const note of result.dropped) console.log(`  ${note.path}: ${note.reason}`);
console.log('Review the draft, then publish from the Studio.');
