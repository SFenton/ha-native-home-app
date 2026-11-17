import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The file of a generated corpus case by its name, wherever the handshake put it: `accept/<name>`, `reject/<name>`, or `reject/pending-<name>` while a
 * capability it needs is still pending. `name` may carry the `pending-` prefix an accepted case had before its capability shipped.
 */
export function corpusCaseFile(corpus: string, name: string): string {
  const stem = name.replace(/^pending-/, '');
  const found = [`accept/${stem}.json`, `reject/${stem}.json`, `reject/pending-${stem}.json`].map(file => path.join(corpus, file)).find(file => existsSync(file));
  if (!found) throw new Error(`no corpus case named ${name}`);
  return found;
}
