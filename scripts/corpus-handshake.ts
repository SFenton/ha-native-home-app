/**
 * Where a generated publication case lives, by what the app's shipped list does with it.
 *
 * `contract/corpus/capabilities.json` is the list the app declares. An envelope that declares an id outside it is refused at the first such id
 * (`unsupported_capability`), before anything else: that case is a `pending` reject that also records `studioIssue`. An envelope that declares only
 * shipped ids is an ordinary case: an accept under `accept/`, or a reject under `reject/` whose `issue` is the Studio's first issue (which the app
 * must give too). A capability that ships moves its cases from the first kind to the second the next time a generator runs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

type J = Record<string, any>;

/** The capability ids the app ships, read from `capabilities.json` in the corpus directory `root`. */
export function shippedCapabilities(root: string): Set<string> {
  return new Set<string>(JSON.parse(readFileSync(path.join(root, 'capabilities.json'), 'utf8')));
}

/** The app's refusal of an envelope that declares `capabilities`: its first id outside `shipped`, or `undefined` when it lists them all. */
export function shippedIssue(shipped: ReadonlySet<string>, capabilities: readonly string[]): J | undefined {
  const at = capabilities.findIndex(name => !shipped.has(name));
  return at < 0 ? undefined : { code: 'unsupported_capability', pointer: `/capabilities/${at}`, capability: capabilities[at] };
}

/**
 * The file and the index entry for one generated case. `name` may carry the `pending-` prefix an accepted case had while its capability was pending;
 * it is dropped once the case no longer needs it. `studioIssue` is the Studio's first issue for a rejected case, and `undefined` for an accepted one.
 */
export function placeCase(
  name: string, note: string, outcome: 'accept' | 'reject', refusal: J | undefined, studioIssue: J | undefined,
): { file: string; entry: J } {
  const stem = name.replace(/^pending-/, '');
  if (refusal) {
    const file = outcome === 'accept' ? `reject/pending-${stem}.json` : `reject/${stem}.json`;
    return { file, entry: { file, outcome: 'reject', note, issue: refusal, pending: true, ...(studioIssue ? { studioIssue } : {}) } };
  }
  if (outcome === 'accept') {
    const file = `accept/${stem}.json`;
    return { file, entry: { file, outcome: 'accept', note } };
  }
  const file = `reject/${stem}.json`;
  return { file, entry: { file, outcome: 'reject', note, issue: studioIssue } };
}
