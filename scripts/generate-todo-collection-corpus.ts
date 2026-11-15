/**
 * Writes the `todo-collection-*` cases of the shared publication corpus: accepted and rejected envelopes for the
 * `todo-collection@1` source, the record page house configuration used to define as `chores.pages`. Each case is the shared
 * first-slice fixture with its third page's body replaced and the page's sources added, so the files stay small.
 *
 *   tsx scripts/generate-todo-collection-corpus.ts   # rewrites contract/corpus/{accept,reject}/todo-collection-*.json and their index entries
 *
 * Accepted capability lists come from the Studio compiler; a rejected case records the Studio's first issue. Run
 * `scripts/app-corpus-check/run.sh` afterwards: the app's compiler must agree with every line. This file owns only
 * `todo-collection-*`; `scripts/generate-grammar-corpus.ts` owns `grammar-*`.
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { decodeCompositionPublication } from '../server/composition';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';

type J = Record<string, any>;
const root = path.resolve(import.meta.dirname, '../contract/corpus');
const base: J = JSON.parse(readFileSync(path.join(root, 'accept/fixture-composition-first-slice.json'), 'utf8'));
const PAGE = 2;
const PREFIX = 'todo-collection-';

// MARK: Builders
const lit = (value: string) => ({ type: 'literal', value });
const list = (entityId: string, rest: J = {}): J => ({ title: 'List', entityId: lit(entityId), hideCompleted: true, hideWhenNoOpenItems: false, ...rest });
const inputs = (rest: J = {}): J => ({
  title: 'Chores',
  lists: [list('todo.demo_chores')],
  addAction: { type: 'task', defaultAssignee: '' },
  hideListHeaders: false, hiddenByVacation: false,
  empty: { title: 'Nothing To Show', description: 'No chores due.' },
  ...rest,
});
const source = (rest: J = {}, id = 'chores-page'): J => ({ id, kind: 'model', model: 'todo-collection@1', inputs: inputs(rest) });
const collection = (providerId = 'chores-page'): J => ({
  id: 'chores', title: 'Chores', type: 'collection', layout: { span: 1 },
  props: { providerId, template: 'todo', loadingText: 'Loading', emptyText: 'Nothing here' },
});
const viewerRule = (userIds: string[], extra: J = {}): J => ({ visibleWhen: { type: 'viewer', userIds }, whenUnknown: 'hide', ...extra });

interface Case { name: string; outcome: 'accept' | 'reject'; note: string; sources: J[]; components?: J[]; tweak?: (envelope: J) => void }
const cases: Case[] = [];
const accept = (name: string, note: string, sources: J[], more: Partial<Case> = {}) => cases.push({ name: PREFIX + name, outcome: 'accept', note, sources, ...more });
const reject = (name: string, note: string, sources: J[], more: Partial<Case> = {}) => cases.push({ name: PREFIX + name, outcome: 'reject', note, sources, ...more });

// MARK: Accepted
accept('task-page', 'A task page with a resident variant and a list only some users see, shown by a todo collection node.',
  [source({
    lists: [list('todo.demo_overdue', { title: 'Overdue', completionScript: lit('script.demo_finish'), ...viewerRule(['user-1', 'user-2']) }),
      list('todo.demo_upcoming', { title: 'Upcoming', hideWhenNoOpenItems: true })],
    personalization: { residentId: 'resident_1', ownTitle: 'Your Chores', otherTitle: "Alex's Chores", ownEmptyDescription: 'You have no chores due.' },
  })], { components: [collection()] });
accept('grocery-page', 'A grocery page: Add creates an item on one of its own lists.',
  [source({ title: 'Groceries', lists: [list('todo.demo_groceries', { hideCompleted: false })], addAction: { type: 'grocery', entityId: lit('todo.demo_groceries') },
    hideListHeaders: true })], { components: [collection()] });
accept('admin-page', 'An admin to-do page whose Add action is the admin form; hidden while Vacation Mode is on.',
  [source({ title: 'To-Do', lists: [list('todo.demo_admin')], addAction: { type: 'admin', entityId: lit('todo.demo_admin') }, hiddenByVacation: true })],
  { components: [collection()] });
accept('source-without-collection', 'A defined todo collection no node uses is accepted; it costs nothing.', [source()]);
accept('collection-without-source', 'A todo collection node whose provider no source defines still compiles: the app shows nothing for it and reads no house configuration.',
  [], { components: [collection('undefined-page')] });

// MARK: Rejected
reject('duplicate-list', 'A page lists each entity once.', [source({ lists: [list('todo.demo_chores'), list('todo.demo_chores')] })]);
reject('list-not-a-todo', 'A list is a todo entity.', [source({ lists: [list('sensor.demo_chores')] })]);
reject('list-bad-entity', 'An entity id has the form domain.object.', [source({ lists: [list('Todo Chores')] })]);
reject('no-lists', 'A page has at least one list.', [source({ lists: [] })]);
reject('script-not-a-script', 'A completion script is a script entity.', [source({ lists: [list('todo.demo_chores', { completionScript: lit('switch.demo_finish') })] })]);
reject('grocery-entity-not-listed', 'The grocery Add action names one of the page\'s own lists.',
  [source({ addAction: { type: 'grocery', entityId: lit('todo.demo_other') } })]);
reject('admin-entity-not-listed', 'The admin Add action names one of the page\'s own lists.',
  [source({ addAction: { type: 'admin', entityId: lit('todo.demo_other') } })]);
reject('add-action-unknown-type', 'Add creates a task, a grocery item or an admin to-do.', [source({ addAction: { type: 'recipe' } })]);
reject('list-rule-admin', 'A list rule names user ids; an administrator rule is not accepted there.',
  [source({ lists: [list('todo.demo_chores', { visibleWhen: { type: 'viewer', isAdmin: true }, whenUnknown: 'hide' })] })]);
reject('list-rule-admin-and-users', 'A list rule that also asks for an administrator is not accepted.',
  [source({ lists: [list('todo.demo_chores', { visibleWhen: { type: 'viewer', isAdmin: true, userIds: ['user-1'] }, whenUnknown: 'hide' })] })]);
reject('list-rule-reads-an-entity', 'A list rule cannot read an entity: a list is read where only the user id is known.',
  [{ id: 'guest-fan', kind: 'ha-entity', entityId: lit('fan.demo_bath_fan') },
    source({ lists: [list('todo.demo_chores', { visibleWhen: { type: 'state', sourceId: 'guest-fan', path: ['state'], in: ['on'] }, whenUnknown: 'hide' })] })]);
reject('list-rule-unknown-policy', 'A restricted list stays hidden until the user is known; show and keep are refused.',
  [source({ lists: [list('todo.demo_chores', viewerRule(['user-1'], { whenUnknown: 'show' }))] })]);
reject('list-policy-without-rule', 'whenUnknown means nothing without a visibleWhen.',
  [source({ lists: [list('todo.demo_chores', { whenUnknown: 'hide' })] })]);
reject('list-missing-flag', 'A list says whether completed items are hidden.',
  [source({ lists: [{ title: 'List', entityId: lit('todo.demo_chores'), hideWhenNoOpenItems: false }] })]);
reject('personalization-unknown-field', 'The resident variant has a title for the resident and one for everyone else, and nothing more.',
  [source({ personalization: { residentId: 'resident_1', ownTitle: 'Yours', otherTitle: 'Theirs', tint: 'red' } })]);
reject('unknown-input', 'A todo collection takes the fields of its schema and no others.', [source({ colour: 'red' })]);
reject('read-from-collection', 'A todo collection has no values to bind; a text cannot read from it.',
  [source()], { components: [{ id: 't', title: 't', type: 'text', layout: { span: 1 },
    props: { value: { type: 'read', from: { type: 'source', sourceId: 'chores-page', path: ['stateText'] }, as: 'string', missing: 'unavailable' }, style: 'body', unavailableText: 'None' } }] });
reject('capability-missing-from-manifest', 'A document that declares a todo collection must list its capability.',
  [source()], { tweak: envelope => { envelope.capabilities = envelope.capabilities.filter((name: string) => name !== 'sh.todo-collection@1'); } });

// MARK: Writing
function envelope(item: Case): J {
  const value = structuredClone(base);
  const document = value.document;
  if (item.components) document.pages[PAGE].components = item.components;
  document.dataSources.push(...item.sources);
  return value;
}
const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')) as { cases: J[] };
index.cases = index.cases.filter(entry => !String(entry.file).includes(`/${PREFIX}`));
for (const folder of ['accept', 'reject']) for (const name of readdirSync(path.join(root, folder))) if (name.startsWith(PREFIX)) unlinkSync(path.join(root, folder, name));
for (const item of cases) {
  const file = `${item.outcome}/${item.name}.json`;
  const draft = envelope(item);
  let issue: J | undefined;
  if (item.outcome === 'accept') draft.capabilities = compileCompositionDocument(draft.document).capabilities;
  else {
    // A rejected case starts from a document that would otherwise be complete, so only the fault under test is reported.
    try { draft.capabilities = compileCompositionDocument(draft.document).capabilities; } catch { /* the document is the fault */ }
    item.tweak?.(draft);
    try { decodeCompositionPublication(new TextEncoder().encode(JSON.stringify(draft))); throw new Error(`${item.name} was accepted`); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      const [first] = error.issues;
      issue = { code: first.code, pointer: first.pointer, ...(first.capability ? { capability: first.capability } : {}) };
    }
  }
  writeFileSync(path.join(root, file), `${JSON.stringify(draft)}\n`);
  index.cases.push({ file, outcome: item.outcome, note: item.note, ...(issue ? { issue } : {}) });
}
writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${cases.length} cases (${cases.filter(item => item.outcome === 'accept').length} accept)`);
