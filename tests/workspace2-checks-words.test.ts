import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { CompositionIssue } from '../src/shared/composition/json';
import { buildDocumentIndex } from '../src/preview2/model';
import { replaceAt } from '../src/composition-editor';
import { compilerIssues, followCheck, pointerPath, runChecks, sentenceFor } from '../src/workspace2/checks';
import { targetOf } from '../src/workspace2/checkWords';
import { dialogTitles } from '../src/workspace2/projectDialogs';

/** The first node that sits inside another node with a title, its path, kind and the holder's title. */
function findNested(document: CompositionDocument): { path: (string | number)[]; type: string; holder: string } {
  const index = buildDocumentIndex(document);
  for (const key of index.keys) {
    const entry = index.get(key);
    const holder = entry?.node && entry.parent ? index.get(entry.parent)?.node : undefined;
    if (entry?.node && holder?.title && entry.node.title) return { path: [...entry.path], type: entry.node.type.replace(/-/g, ' '), holder: holder.title };
  }
  throw new Error('The fixture has no nested node.');
}

/** Every row of Checks must say what it is about (by name), which field (by its label), what to change, and go somewhere. */
const corpus = path.resolve(__dirname, '../contract/corpus/reject');
const home = JSON.parse(readFileSync(new URL('../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')).document as CompositionDocument;
const panels = ['tabs', 'header', 'wallpaper', 'styles'];
const allCodes: CompositionIssue['code'][] = ['unsupported_schema', 'unknown_field', 'unknown_variant', 'missing_required', 'invalid_value', 'duplicate_key', 'limit_exceeded', 'duplicate_id', 'invalid_reference', 'binding_type', 'invalid_combination', 'capability_manifest_mismatch', 'unsupported_capability', 'asset_integrity'];

/** The issues the compiler gives for each corpus reject file's document, and the document. */
const rejected = readdirSync(corpus).filter(name => name.endsWith('.json')).flatMap(name => {
  const parsed = JSON.parse(readFileSync(path.join(corpus, name), 'utf8'));
  const document = (parsed.document ?? parsed) as CompositionDocument;
  let issues: CompositionIssue[] = [];
  try { issues = compilerIssues(document); } catch { /* an envelope-level reject has no document issue */ }
  return issues.map(issue => ({ name, document, issue }));
});

function expectNamed(document: CompositionDocument, issue: CompositionIssue, label: string) {
  const row = sentenceFor(document, issue);
  const target = targetOf(document, pointerPath(issue.pointer));
  expect(row.place.trim().length, label).toBeGreaterThan(0);
  expect(row.sentence.startsWith(`${row.place}: `), label).toBe(true);
  // The field is named by its label whenever the path ends in one; a path that ends at the item itself says what to do with the item.
  // Three wordings are about the whole project or its tab bar, not one field, and say so.
  const wholeProject = ['unsupported_schema', 'capability_manifest_mismatch'].includes(issue.code) || issue.capability === 'sh.extended-tabs@1';
  if (wholeProject) expect(row.sentence, label).toMatch(/^[^:]+: (This project|The list|The tab bar)/);
  else if (target.field) expect(row.sentence, label).toContain(target.field);
  else expect(row.sentence, label).toMatch(/^[^:]+: (This|It|The|A|An|Project)/);
  expect(row.sentence, label).not.toMatch(/work together|\/document|\.json|invalid_|pointer/i);
  // A plain sentence saying what to change: it ends the sentence and carries an instruction.
  expect(row.sentence, label).toMatch(/(Add|Remove|Change|Choose|Pick|Move|Shorten|Simplify|Give|Delete|Save|Open)\b[^.]*\.$/);
  const go = row.go;
  expect(go, label).toBeDefined();
  if ('select' in go) expect(buildDocumentIndex(document).get(go.select), label).toBeDefined();
  else if ('panel' in go) expect(panels, label).toContain(go.panel);
  else if ('logic' in go) expect(document.logicLibrary?.map(entry => entry.id), label).toContain(go.logic);
  else expect(Object.keys(dialogTitles), label).toContain(go.dialog);
  return row;
}

describe('every compiler error names its target, its field and what to change, and goes there', () => {
  it('covers each issue the shared reject corpus gives', () => {
    expect(rejected.length).toBeGreaterThan(60);
    for (const { name, document, issue } of rejected) expectNamed(document, issue, `${name} ${issue.code} ${issue.pointer}`);
  });

  it('words each of the 14 compiler codes, whether or not the corpus triggers it here', () => {
    const seen = new Set(rejected.map(item => item.issue.code));
    for (const code of allCodes) {
      const issue: CompositionIssue = { code, pointer: '/document/pages/0/components/0/props/title', ...(code === 'unsupported_capability' ? { capability: 'sh.extended-tabs@1' } : {}) };
      expectNamed(home, issue, code);
      expectNamed(home, { ...issue, pointer: '/document/navigation/tabs' }, `${code} on the tabs`);
      expectNamed(home, { ...issue, pointer: '/document/dataSources/0/inputs/entityId' }, `${code} on a source`);
      expectNamed(home, { ...issue, pointer: '/document/localState/0/id' }, `${code} on local state`);
    }
    // The corpus alone reaches most codes; the rest are worded above.
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  it('names every part of the project a pointer can start in, and goes to a panel or dialog for it', () => {
    for (const root of ['name', 'theme/background', 'assets/0', 'navigation/chrome/groups/0', 'navigation/initialTabId', 'dataSources/0', 'localState/0', 'liveActivities/0', 'bootstrap', 'extensions/routes/0', 'extensions/linkPrefixes', 'variables', 'schemaVersion']) {
      const target = targetOf(home, pointerPath(`/document/${root}`));
      expect(target.place, root).not.toBe('');
      expect(Boolean(target.go), root).toBe(true);
      expect('select' in target.go || 'panel' in target.go || 'dialog' in target.go, root).toBe(true);
    }
  });

  it('names the data source and the entity kind when a power switch reads a light', () => {
    const at = home.dataSources.findIndex(source => source.kind === 'model' && source.model === 'power-toggle@1');
    const document = replaceAt(home, ['dataSources', at, 'inputs', 'entityId', 'value'], 'light.demo_lamp_15');
    const problems = runChecks(document).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0].sentence).toContain('Data source Power switch');
    expect(problems[0].sentence).toContain('Entity “light.demo_lamp_15” is not switch or input boolean');
    expect(problems[0].go).toEqual({ dialog: 'data' });
    expect(problems[0].sentence).not.toMatch(/work together/);
  });

  it('keeps the old wording for a field the person can see on the tile', () => {
    expect(sentenceFor(home, { code: 'missing_required', pointer: '/document/pages/0/components/0/title' }).sentence).toMatch(/: Title is needed\. Add it\.$/);
  });

  it('says an emptied title is empty, by the item\'s place, never "not allowed"', () => {
    const titleOf = (path: (string | number)[]) => runChecks(replaceAt(home, [...path, 'title'], '')).problems.map(row => row.sentence);
    // An unnamed node is placed by the page that holds it, or by the nearest titled node around it.
    expect(titleOf(['pages', 0, 'components', 0])).toEqual([`Untitled status rail in ${home.pages[0].title}: Title is empty. Add a title.`]);
    const nested = findNested(home);
    expect(titleOf(nested.path)).toEqual([`Untitled ${nested.type} in ${nested.holder}: Title is empty. Add a title.`]);
    expect(titleOf(nested.path)[0]).not.toMatch(/not allowed/);
    // A whitespace-only title is empty too.
    expect(runChecks(replaceAt(home, ['pages', 0, 'components', 0, 'title'], '   ')).problems[0].sentence).toMatch(/: Title is empty\. Add a title\.$/);
    // Pages and sheets: "Untitled page" and where it sits.
    expect(titleOf(['pages', 0])).toEqual(['Untitled page in the Home tab: Title is empty. Add a title.']);
    expect(titleOf(['pages', 1])[0]).toBe(`Untitled page after ${home.pages[0].title}: Title is empty. Add a title.`);
    expect(titleOf(['modals', 1])).toEqual([`Untitled sheet after ${home.modals[0].title}: Title is empty. Add a title.`]);
    expect(titleOf(['modals', 0])).toEqual(['Untitled sheet, the first sheet: Title is empty. Add a title.']);
  });

  it('gives every row that names a field the path to focus, and nothing for a row that names none', () => {
    const rows = runChecks(replaceAt(home, ['pages', 0, 'components', 0, 'title'], '')).problems;
    expect(rows[0].fieldPath).toBe('pages/0/components/0/title');
    const calls: string[] = [];
    followCheck(rows[0], { select: key => calls.push(`select ${key}`), panel: () => undefined, dialog: () => undefined, focus: path => calls.push(`focus ${path}`) });
    expect(calls).toEqual([expect.stringMatching(/^select node:/), 'focus pages/0/components/0/title']);
    expect(runChecks(home).problems).toEqual([]);
    expect(sentenceFor(home, { code: 'invalid_value', pointer: '/document/pages/0/components/0' }).fieldPath).toBeUndefined();
  });

  it('goes to the item, panel or dialog a row names', () => {
    const calls: string[] = [];
    const to = { select: (key: string) => calls.push(`select ${key}`), panel: (panel: string) => calls.push(`panel ${panel}`), dialog: (dialog: string) => calls.push(`dialog ${dialog}`) };
    followCheck({ id: 'a', sentence: '', place: '', go: { select: 'node:x' } }, to);
    followCheck({ id: 'b', sentence: '', place: '', go: { panel: 'tabs' } }, to);
    followCheck({ id: 'c', sentence: '', place: '', go: { dialog: 'data' } }, to);
    followCheck({ id: 'd', sentence: '', place: '', select: 'page:p' }, to);
    expect(calls).toEqual(['select node:x', 'panel tabs', 'dialog data', 'select page:p']);
  });
});

describe('the line for profile settings (sh.shell-profile@1)', () => {
  it('says the app needs to be newer, and what to leave alone', () => {
    const issue: CompositionIssue = { code: 'unsupported_capability', pointer: '/document/navigation/chrome/groups/0/items/0/profile', capability: 'sh.shell-profile@1' };
    expect(sentenceFor(home, issue).sentence).toContain('Profile button settings need a newer app than this one runs. Clear them, or wait for the app to update.');
  });
});

describe('the lines for value settings (sh.component-values@1)', () => {
  it('says what to do when an app does not read value settings', () => {
    const issue: CompositionIssue = { code: 'unsupported_capability', pointer: '/document/pages/0/components/0', capability: 'sh.component-values@1' };
    expect(sentenceFor(home, issue).sentence).toContain('Settings for colors, rules and numbers need a newer app than this one runs. Make them the same everywhere, or wait for the app to update.');
  });

  it('says a value is too large for one place, and keeps the list wording for any other limit', () => {
    const large: CompositionIssue = { code: 'limit_exceeded', pointer: '/document/pages/0/components/0/values/ink' };
    expect(sentenceFor(home, large).sentence).toContain('This value is too large for one place. Shorten it.');
    const other: CompositionIssue = { code: 'limit_exceeded', pointer: '/document/pages/0/components/0/children' };
    expect(sentenceFor(home, other).sentence).not.toContain('too large for one place');
  });
});
