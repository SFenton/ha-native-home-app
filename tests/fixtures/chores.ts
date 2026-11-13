import { importNativeHome, type NativeSnapshot } from '../../src/shared/native-preview';
import type { Component, Json } from '../../src/shared/types';

export const choreDescendants = (components: Component[]): Component[] => components.flatMap(component => [component, ...choreDescendants(component.children ?? [])]);
export function choresSnapshot(): NativeSnapshot {
  const list = (title: string, entityId: string, userIds: string[] = []) => ({ title, entityId, userIds, hideCompleted: true, hideWhenNoOpenItems: userIds.length > 0 });
  const first: Record<string, Json>[] = [
    { ...list('Past Due', 'todo.fixture_overdue', ['user-one']), countBucket: { overdue: {} } },
    { ...list('Due Today', 'todo.fixture_today', ['user-one']), countBucket: { upcoming: {} } },
    list('No Due Date', 'todo.fixture_undated', ['user-one']),
  ];
  return {
    mode: 'live', currentUser: { id: 'user-one', name: 'Authenticated fixture', isOwner: false, isAdmin: false },
    houseConfig: { schema: 2, hash: 'c'.repeat(64), config: {
      home: { statusChips: [], cameras: [], guestToggles: [] }, security: {}, climate: { rooms: [] },
      chores: {
        people: [
          { key: 'resident_one', haUserId: 'user-one', name: 'Resident One', summaryLists: { overdue: 'todo.fixture_overdue', dueToday: 'todo.fixture_today', noDueDate: 'todo.fixture_undated' } },
          { key: 'resident_two', haUserId: 'user-two', name: 'Resident Two', summaryLists: { overdue: 'todo.fixture_other', dueToday: 'todo.fixture_other_today', noDueDate: 'todo.fixture_other_undated' } },
        ],
        pages: [
          { id: 'chores', title: 'Chores', lists: [...first, list('Other Past Due', 'todo.fixture_other', ['user-two'])], hasTaskForm: true, addAction: { assignedTask: {} }, emptyTitle: 'All caught up', emptyDescription: 'Nothing assigned.' },
          { id: 'resident-one', title: 'Resident One Chores', resident: 'resident_one', lists: first.map(value => ({ ...value, userIds: [] })), hasTaskForm: true, addAction: { assignedTask: { defaultAssignee: 'fixture-one' } }, emptyTitle: 'All caught up' },
          { id: 'resident-two', title: 'Resident Two Chores', resident: 'resident_two', lists: [list('Other Past Due', 'todo.fixture_other')], hasTaskForm: true, addAction: { assignedTask: { defaultAssignee: 'fixture-two' } } },
          { id: 'groceries', title: 'Groceries', lists: [list('Groceries', 'todo.fixture_groceries')], hideListHeaders: true, addAction: { groceryItem: { entityId: 'todo.fixture_groceries' } } },
          { id: 'admin-todo', title: 'To-Do', lists: [{ ...list('To-Do', 'todo.fixture_admin'), completionScript: 'script.fixture_complete' }], addAction: { adminTodo: { entityId: 'todo.fixture_admin' } } },
        ],
        quickLinks: [{ title: 'Resident One Chores', pageId: 'resident-one' }, { title: 'Resident Two Chores', pageId: 'resident-two' }, { title: 'Groceries', pageId: 'groceries' }, { title: 'To-Do', pageId: 'admin-todo' }, { title: 'Missing page', pageId: 'missing' }],
      },
      vacation: { modeEntityId: 'input_boolean.fixture_vacation' }, rooms: { pages: [], grid: { items: [] }, quickLinks: [] },
    } },
    states: [
      { entityId: 'todo.fixture_overdue', name: 'Overdue', state: '2', todoList: { status: 'ready', items: [
        { uid: '11--fixture', summary: 'Task Alpha', status: 'needs_action', due: '2020-01-01', description: 'Synthetic task' },
        { uid: '12--fixture', summary: 'Task Beta', status: 'needs_action', due: '2020-01-02' },
      ] } },
      { entityId: 'todo.fixture_today', name: 'Today', state: '1', todoList: { status: 'ready', items: [{ uid: '13--fixture', summary: 'Task Today', status: 'needs_action', due: '2099-01-01' }] } },
      { entityId: 'todo.fixture_undated', name: 'Undated', state: '0', todoList: { status: 'ready', items: [] } },
      { entityId: 'todo.fixture_other', name: 'Other', state: '1', todoList: { status: 'ready', items: [{ uid: '21--fixture', summary: 'Other assignment', status: 'needs_action' }] } },
      { entityId: 'todo.fixture_other_today', name: 'Other today', state: '0', todoList: { status: 'ready', items: [] } },
      { entityId: 'todo.fixture_other_undated', name: 'Other undated', state: '0', todoList: { status: 'ready', items: [] } },
      { entityId: 'todo.fixture_groceries', name: 'Groceries', state: '1', todoList: { status: 'ready', items: [{ uid: 'grocery-one', summary: 'Synthetic apples', status: 'needs_action' }] } },
      { entityId: 'todo.fixture_admin', name: 'To-Do', state: '1', todoList: { status: 'ready', items: [{ uid: 'admin-one', summary: 'Synthetic admin item', status: 'needs_action' }] } },
    ],
  };
}
export function choresDocument() {
  const snapshot = choresSnapshot(), { document } = importNativeHome(snapshot);
  delete document.theme.background;
  document.dataSources = document.dataSources.map(source => ({
    ...source, kind: 'static', endpoint: undefined, sample: source.id === 'native-profile' ? { ...snapshot.currentUser! } : snapshot.states,
  }));
  return document;
}

export function legacyChoresDocument() {
  const document = choresDocument();
  for (const surface of [...document.pages, ...document.modals]) {
    for (const node of choreDescendants(surface.components)) {
      if (node.props.nativeTodoPage) {
        node.title = surface.title;
        for (const key of ['addAction', 'hasTaskForm', 'vacationEntityId', 'vacationEmptyText']) delete node.props[key];
      }
      if (node.props.collectionKind === 'todo-items') {
        delete node.props.profileSourceId;
        delete node.props.people;
        node.props.emptyText = 'Nothing To Show';
      }
      if (node.props.collectionKind === 'resident-todo-items') {
        for (const key of ['hideCompleted', 'emptyTitle', 'hiddenByVacation', 'vacationEntityId', 'vacationEmptyText']) delete node.props[key];
        node.props.emptyText = 'Nothing To Show';
      }
      if (node.props.choreLink) {
        for (const key of ['choreLink', 'people', 'profileSourceId']) delete node.props[key];
        delete node.binding;
      }
    }
  }
  return document;
}
