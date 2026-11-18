/** Everything a person reads on a surface, for the copy snapshots and the voice rules. */

/** Text nodes of `root` that are on screen (not under `hidden`), in reading order, one string each. */
export function visibleStrings(root: ParentNode): string[] {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim(); if (text) out.push(text); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.hidden || element.tagName === 'STYLE' || element.tagName === 'SCRIPT' || element.tagName === 'CODE') return;
    if (element.tagName === 'SELECT') { out.push(...[...element.querySelectorAll('option')].map(option => (option.textContent ?? '').trim()).filter(Boolean)); return; }
    element.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out;
}

/** The names a screen reader gets that no text node says: aria-labels, placeholders and titles, first seen first. */
export function accessibleNames(root: ParentNode): string[] {
  const seen = new Set<string>(), visible = new Set(visibleStrings(root));
  for (const element of root.querySelectorAll<HTMLElement>('[aria-label], [placeholder], [title]')) {
    if (element.closest('[hidden]')) continue;
    for (const name of [element.getAttribute('aria-label'), element.getAttribute('placeholder'), element.getAttribute('title')]) if (name && !visible.has(name)) seen.add(name);
  }
  return [...seen];
}

/** A surface's copy as the snapshot file reads: its visible strings, then the names only a screen reader hears. */
export function copyOf(root: ParentNode): string {
  const names = accessibleNames(root);
  return `${visibleStrings(root).join('\n')}${names.length ? `\n\n[names]\n${names.join('\n')}` : ''}\n`;
}

const small = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'at', 'as', 'by', 'from', 'with', 'is']);
const keep = ['Home Assistant', 'S+H', 'iOS', 'iPhone', 'iPad', 'Siri', 'JSON', 'ID', 'URL', 'HTTP', 'SF Symbols', 'Live Activities', 'Quick Links and Profile', 'Local State', 'Time Sensitive', 'Live', 'Duo'];
const strip = (text: string) => keep.reduce((rest, name) => rest.split(name).join(' '), text);

/** Title Case as the app writes it: every word capitalised but the small ones in the middle. */
export function isTitleCase(text: string): boolean {
  const words = strip(text).replace(/[“”"…?.,:]/g, ' ').split(/\s+/).filter(word => /[A-Za-z]/.test(word));
  return words.every((word, at) => /^[A-Z]/.test(word) || (at > 0 && small.has(word)));
}
/** Sentence case: the first word capital, no other word capital apart from the names kept. */
export function isSentenceCase(text: string): boolean {
  const words = strip(text).replace(/[“”"…?.,:]/g, ' ').split(/\s+/).filter(word => /[A-Za-z]/.test(word));
  return words.every((word, at) => at === 0 ? /^[A-Z0-9]/.test(word) : !/^[A-Z][a-z]/.test(word));
}

/** Words the voice rules keep out of the Studio (copy note: no AI-isms, taglines, reassurance or the old product name). */
const banned: [RegExp, string][] = [
  [/[—–]/, 'a dash used as punctuation'], [/Native Home/i, 'the old product name'],
  [/\b(seamless(ly)?|effortless(ly)?|supercharge|leverage|elevate|delve|robust|streamline|empower|journey|magical|reimagined|crafted)\b/i, 'an AI-ism'],
  [/\b(don[’']t worry|no worries|rest assured|your .* (is|are) safe|nothing (was|is) (changed|lost)|safe preview)\b/i, 'reassurance'],
  [/\b(oops|whoops|uh-oh)\b/i, 'a cute error'], [/!\s*$/, 'an exclamation'],
];

/** What breaks the voice rules among the strings a surface shows: `buttons` are Title Case, `labels` sentence case (or Title Case, for a row's name: `build/design/templates/anyfield.md`, section 4), all of them free of {@link banned}. */
export function voiceIssues(root: ParentNode): string[] {
  const issues: string[] = [];
  const plain = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  const data = (element: Element) => Boolean(element.querySelector('.w2-page-title, .w2-level-title, code, time, strong, input, select, textarea, [data-testid]'));
  for (const text of [...visibleStrings(root), ...accessibleNames(root)]) for (const [pattern, why] of banned) if (pattern.test(text)) issues.push(`“${text}” has ${why}`);
  for (const element of root.querySelectorAll('button, [role=menuitem], [role=tab]')) {
    // Rows, choices and the back button's page name are labels or data, not commands.
    if (element.closest('[hidden]') || data(element) || element.closest('.w2-list, .w2-history, .w2-tab-list, .w2-check-row, .w2-choice, .w2-segment, .w2-add-tile, .w2-palette-cell, .w2-back, .w2-logic-settingbtn, .w2-crumb, .w2-disclosure-head, .w2-add-row, .w2-outline-row')) continue;
    const text = plain(element);
    if (text && /\s/.test(text) && !/\d/.test(text) && !isTitleCase(text)) issues.push(`button “${text}” is not Title Case`);
  }
  for (const element of root.querySelectorAll('.w2-row-label, .w2-group-title, .field > span:first-child')) {
    const text = plain(element);
    if (text && /\s/.test(text) && !/\d/.test(text) && !isSentenceCase(text) && !isTitleCase(text)) issues.push(`label “${text}” is not sentence case`);
  }
  return issues;
}
