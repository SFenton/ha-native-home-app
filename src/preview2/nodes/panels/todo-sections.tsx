import { Check } from 'lucide-react';
import { isShown } from '../../evaluate';
import { useRender } from '../../render-context';
import type { NativeTodoItem } from '../../../shared/native-state';
import type { CompositionDocument } from '../../../shared/composition/schema';

type TodoSource = Extract<CompositionDocument['dataSources'][number], { model: 'todo-collection@1' }>;

/** The `todo-collection@1` source a collection names as its provider, as authored; `undefined` for any other source. */
export function todoSource(sources: CompositionDocument['dataSources'] | undefined, providerId: string): TodoSource | undefined {
  const found = sources?.find(item => item.id === providerId);
  return found?.kind === 'model' && found.model === 'todo-collection@1' ? found : undefined;
}

/** "Nov 12" for a task's due date or date-time; the date part only, so a time zone never moves it. */
const dueText = (due: string) => new Date(`${due.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** One task row: the ring (a check when done), the summary and, when there is one, the due date. */
function TaskRow({ item }: { item: NativeTodoItem }) {
  const done = item.status === 'completed';
  return <div className="sh-row sh-todo-row" data-done={done ? '' : undefined}>
    <span className="sh-todo-ring" role="img" aria-label={done ? 'Completed' : 'Not completed'}>{done && <Check size={14} strokeWidth={3} aria-hidden="true"/>}</span>
    <span className="sh-row-copy"><span className="sh-row-primary">{item.summary}</span>{item.due && <span className="sh-row-secondary">{`Due ${dueText(item.due)}`}</span>}</span>
  </div>;
}

/**
 * The sections of a `todo` collection, drawn from its provider (`sh.todo-collection@1`): per list, its heading (unless the provider hides headers),
 * then the open tasks and, unless `hideCompleted`, the done ones. A list shows only to the viewer its `visibleWhen` rule names, and not while it has
 * no open task when `hideWhenNoOpenItems`. When no list shows, the provider's empty words are drawn. The caller draws placeholders until the house arrives.
 */
export function TodoSections({ nodeId, source, emptyText }: { nodeId: string; source: TodoSource; emptyText: string }) {
  const { house, env, previous } = useRender();
  const states = house.states;
  const { lists, hideListHeaders, empty } = source.inputs;
  const sections = lists.flatMap((list, index) => {
    const key = `${nodeId}/list/${index}`;
    const visible = isShown(list, env, previous.get(key));
    previous.set(key, visible);
    if (!visible) return [];
    const read = states?.get(list.entityId.value)?.todoList;
    if (read?.status === 'ready') {
      const open = read.items.filter(item => item.status === 'needs_action');
      if (list.hideWhenNoOpenItems && open.length === 0) return [];
      const items = list.hideCompleted ? open : [...open, ...read.items.filter(item => item.status === 'completed')];
      return [{ key, title: list.title, items, message: undefined as string | undefined }];
    }
    if (!read) return [];
    return [{ key, title: list.title, items: [] as NativeTodoItem[], message: read.message }];
  });
  if (sections.length === 0) return <div className="sh-list-state" role="status" data-state="empty">
    <strong className="sh-list-state-title">{empty.title || emptyText}</strong>{empty.description && <p className="sh-list-empty-message">{empty.description}</p>}</div>;
  return <>{sections.map(section => <section key={section.key} className="sh-todo-section" aria-label={section.title}>
    {!hideListHeaders && <h3 className="sh-section-header">{section.title}</h3>}
    <div className="sh-section-module-list"><div className="sh-section-body">
      {section.message !== undefined
        ? <p className="sh-list-footnote" role="status">{section.message}</p>
        : section.items.map(item => <TaskRow key={item.uid} item={item}/>)}
    </div></div>
  </section>)}</>;
}
