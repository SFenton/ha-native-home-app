import { capabilitiesOf } from '../composition-editor';
import type { CompositionDocument } from '../shared/composition/schema';
import { pendingCompositionCapabilities } from '../shared/composition/pending';

/** The Studio's words for a pending capability, where it has one an author would know; any other id is named by its own words. No pending id has one now. */
const pendingNames: Record<string, string> = {};

const used = new WeakMap<object, string[]>();
/** The pending capability ids a document declares: features the shipped app does not list yet. A publication that declares one is refused by the app until it updates. */
export function pendingCapabilitiesUsed(document: CompositionDocument): string[] {
  const known = used.get(document);
  if (known) return known;
  // A document that does not compile has no manifest to warn about; its problems are shown instead.
  const ids = capabilitiesOf(document).filter(id => pendingCompositionCapabilities.includes(id));
  used.set(document, ids);
  return ids;
}

/** The warning for a document that uses pending capabilities, or undefined when it uses none. */
export function pendingUseWords(document: CompositionDocument): string | undefined {
  const ids = pendingCapabilitiesUsed(document);
  if (!ids.length) return undefined;
  const names = ids.map(id => pendingNames[id] ?? id.replace(/^sh\./, '').replace(/@\d+$/, '').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()));
  const list = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
  return `This project uses ${list}, which the app does not have yet. The app refuses a publication that uses it until the app updates.`;
}
