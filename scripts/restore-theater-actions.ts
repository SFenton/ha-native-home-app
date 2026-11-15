/**
 * Restores the room-card actions that the retired house-script check dropped from the draft.
 *
 *   STUDIO_AUTH_TOKEN=... STUDIO_URL=http://127.0.0.1:4801 tsx scripts/restore-theater-actions.ts
 *
 * The cards and the scripts they call are house data, so they are not in source: the script reads them from the git-ignored
 * `.local/restore-theater-actions.json` (or the folder `STUDIO_LOCAL_DIR` names). Copy
 * `scripts/examples/restore-theater-actions.example.json` there and replace the synthetic values:
 *
 *   { "actions": [{ "cardKey": "<key of the card in the draft>", "scriptService": "<script service name>" }] }
 *
 * Goes only through the running Studio's HTTP API (GET then PUT /native/api/draft, producing a new draft revision) and reads
 * the token from the environment. Run it only against a build that accepts any script (the generic-actions build); an older
 * build rejects the PUT, which leaves the draft untouched.
 */
import { loadLocalHouse, parseRestoredCardActions } from './local-house';

const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:4801';
const token = process.env.STUDIO_AUTH_TOKEN;
if (!token) throw new Error('STUDIO_AUTH_TOKEN is required');

const script = (service: string) => ({ type: 'command', command: { type: 'service', call: { domain: 'script', service, data: {} }, optimistic: [] } });
const actions: Record<string, unknown> = Object.fromEntries(
  parseRestoredCardActions(loadLocalHouse('restore-theater-actions')).map(({ cardKey, scriptService }) => [cardKey, script(scriptService)]),
);

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const draft = await (await fetch(`${base}/native/api/draft`, { headers })).json() as { revision: number; document: any };
let restored = 0;
for (const source of draft.document.dataSources) {
  for (const card of source.inputs?.cards ?? []) {
    if (card.key in actions) { card.configuration.action = actions[card.key]; restored += 1; }
  }
}
if (restored !== Object.keys(actions).length) throw new Error(`Found ${restored} of ${Object.keys(actions).length} cards listed in the local file; nothing written`);
const response = await fetch(`${base}/native/api/draft`, { method: 'PUT', headers, body: JSON.stringify({ document: draft.document, expectedRevision: draft.revision }) });
if (!response.ok) throw new Error(`Studio refused the draft (${response.status}): ${await response.text()}`);
console.log(`Restored ${restored} card actions as revision ${(await response.json() as { revision: number }).revision}`);
