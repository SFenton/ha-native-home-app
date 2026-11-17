import type { CompositionDocument } from '../../shared/composition/schema';
import type { NativeState, NativeTodoItem } from '../../shared/native-state';
import { demoHouse } from '../demo-house';
import { houseFrom, type House } from '../projections';

/**
 * The story of the camera and chores fixes (lane `fidcamlists`, task `sim-fidelity`, items 8 and 15): the `home-domains` fixture, whose Home and
 * Security pages hold camera tiles and whose camera sheet holds the viewer, plus a Chores page whose `todo` collection reads a `todo-collection@1`
 * provider of five lists over made-up tasks: a heading each, completed tasks hidden in one, a list with no open task that hides, a list for the
 * signed-in person and one for somebody else. Synthetic `demo_` ids only. Open it at `/?preview2=1&fixture=fidcamlists&picture=fake&surface=page:page-fid-chores`.
 */

const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const space = (name: string) => ({ type: 'token', name });
const literal = (value: string) => ({ type: 'literal', value });
const list = (title: string, entityId: string, options: Record<string, unknown> = {}) => ({ title, entityId: literal(entityId), hideCompleted: false, hideWhenNoOpenItems: true, ...options });

/** The signed-in person of the story. */
export const FIDCAMLISTS_VIEWER = 'demo-user-alex';

const task = (uid: string, summary: string, status: NativeTodoItem['status'] = 'needs_action', due?: string): NativeTodoItem => ({ uid, summary, status, ...(due ? { due } : {}) });
const todo = (entityId: string, name: string, items: NativeTodoItem[]): NativeState =>
  ({ entityId, name, state: String(items.filter(item => item.status === 'needs_action').length), todoList: { status: 'ready', items } });
const todoStates: NativeState[] = [
  todo('todo.demo_past_due', 'Past Due', [task('p1', 'Replace the hallway bulb', 'needs_action', '2026-11-09'), task('p2', 'Return the library books', 'needs_action', '2026-11-12'), task('p3', 'Renew the parking permit', 'completed', '2026-11-05')]),
  todo('todo.demo_evening', 'Evening Tasks', [task('e1', 'Run the dishwasher'), task('e2', 'Set out the recycling', 'needs_action', '2026-11-16'), task('e3', 'Lock the back gate', 'completed')]),
  todo('todo.demo_weekend', 'Weekend', [task('w1', 'Wash the car', 'completed'), task('w2', 'Mow the lawn', 'completed')]),
  todo('todo.demo_alex', 'Alex', [task('a1', 'Water the herbs'), task('a2', 'Sort the mail', 'completed')]),
  todo('todo.demo_sam', 'Sam', [task('s1', 'Feed the cat')]),
];

/** The story's document and house: the base fixture, with a Chores page and its provider; the base's own entities get demo states and the signed-in person is known. */
export function fidcamlistsStory(base: CompositionDocument): { document: CompositionDocument; house: House } {
  const document = structuredClone(base) as CompositionDocument & Record<string, unknown>;
  document.pages = [...document.pages, {
    id: 'page-fid-chores', title: 'Chores', icon: symbol('checklist'), parameters: {}, navigation: { type: 'stack' }, toolbar: { type: 'inherit' },
    layout: { type: 'column', padding: { top: space('m'), leading: space('m'), bottom: space('m'), trailing: space('m') }, spacing: space('m'), maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host' },
    components: [{ id: 'fid-chores', title: 'Chores', type: 'collection', layout: { span: 1 }, props: { providerId: 'fid-chores-source', template: 'todo', loadingText: 'Loading chores', emptyText: 'No chores' } }],
  }] as unknown as CompositionDocument['pages'];
  document.dataSources = [...document.dataSources, {
    id: 'fid-chores-source', kind: 'model', model: 'todo-collection@1',
    inputs: {
      title: 'Chores',
      lists: [
        list('Past Due', 'todo.demo_past_due', { hideCompleted: true }),
        list('Evening Tasks', 'todo.demo_evening'),
        list('Weekend', 'todo.demo_weekend'),
        list('Alex', 'todo.demo_alex', { visibleWhen: { type: 'viewer', userIds: [FIDCAMLISTS_VIEWER] }, whenUnknown: 'hide' }),
        list('Sam', 'todo.demo_sam', { visibleWhen: { type: 'viewer', userIds: ['demo-user-sam'] }, whenUnknown: 'hide' }),
      ],
      addAction: { type: 'task', defaultAssignee: '' }, hideListHeaders: false, hiddenByVacation: false,
      empty: { title: 'Nothing to Do', description: 'Every list is finished.' },
    },
  }] as unknown as CompositionDocument['dataSources'];
  const states = [...demoHouse(base).states!.values(), ...todoStates];
  return { document, house: houseFrom({ states, currentUser: { id: FIDCAMLISTS_VIEWER, name: 'Alex', isOwner: false, isAdmin: false } }) };
}
