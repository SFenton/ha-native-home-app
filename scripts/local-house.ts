/**
 * Loads the house-specific values a maintenance script needs from a git-ignored local file, so no script name, card key or
 * other house identifier is ever written in source.
 *
 * The file is `<name>.json` in `.local/` at the repository root, or in the folder `STUDIO_LOCAL_DIR` names. `.local/` is
 * git-ignored. Each script documents its file's shape and ships a synthetic example in `scripts/examples/<name>.example.json`
 * (copy it to `.local/<name>.json` and replace the values).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

/** The folder holding the local files: `STUDIO_LOCAL_DIR` when set, else `.local/` at the repository root. */
export function localHouseDirectory(environment: Record<string, string | undefined> = process.env): string {
  const configured = environment.STUDIO_LOCAL_DIR;
  return configured ? path.resolve(configured) : path.join(repositoryRoot, '.local');
}

/** Reads and parses `<name>.json` from the local folder; the error names the file and the example to copy, never a value. */
export function loadLocalHouse(name: string, environment: Record<string, string | undefined> = process.env): unknown {
  const file = path.join(localHouseDirectory(environment), `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(`Missing ${file}. Copy scripts/examples/${name}.example.json there and replace the values with your own.`);
  }
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`${file} is not valid JSON`); }
}

/** One card whose action is restored: the card's key in the draft, and the script service its button should call. */
export interface RestoredCardAction { cardKey: string; scriptService: string }

/** Checks the shape of `restore-theater-actions.json`: `{ "actions": [{ "cardKey": "...", "scriptService": "..." }] }`. */
export function parseRestoredCardActions(value: unknown): RestoredCardAction[] {
  const actions = (value as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(actions) || actions.length === 0) throw new Error('"actions" must be a non-empty list');
  const keys = new Set<string>();
  return actions.map((entry, index) => {
    const { cardKey, scriptService } = (entry ?? {}) as Partial<RestoredCardAction>;
    if (typeof cardKey !== 'string' || !cardKey) throw new Error(`actions[${index}].cardKey must be a non-empty string`);
    if (typeof scriptService !== 'string' || !/^[a-z0-9_]+$/.test(scriptService)) throw new Error(`actions[${index}].scriptService must be a script service name`);
    if (keys.has(cardKey)) throw new Error(`actions[${index}].cardKey repeats an earlier card`);
    keys.add(cardKey);
    return { cardKey, scriptService };
  });
}
