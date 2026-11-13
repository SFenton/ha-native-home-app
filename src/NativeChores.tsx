import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { Check, Pencil, Plane, Plus } from 'lucide-react';
import type { Action, Component, Json, Primitive, RowActions, RowSwipeAction, StudioDocument } from './shared/types';
import type { NativeTodoItem } from './shared/native-state';
import { choreDue, choreListIds, choreRecord, choreRecords, choreResident, choreTitle, choreUserId, readChoreList, sortChoreItems } from './shared/native-chores';
import { evaluateCondition, resolveBinding } from './shared/runtime';
import { uid } from './editor';
import { RowInteractions, useTodoAddControl } from './InteractionControls';
import { legacyRowActions } from './shared/interactions';
import { resolveCollection } from './shared/collection';
import './NativeChores.css';

type Patch = { entityId: string; uid: string; item: NativeTodoItem | null; completedAt?: number };
type Simulation = { identityKey: string; patches: Record<string, Patch>; now: number; put: (entityId: string, item: NativeTodoItem, remove?: boolean) => void; reset: () => void };
const SimulationContext = createContext<Simulation | undefined>(undefined);
const patchKey = (entityId: string, itemId: string) => JSON.stringify([entityId, itemId]);

export function ChoresSimulationProvider({ identityKey, children }: { identityKey: string; children: ReactNode }) {
  const session = useRef({ identityKey });
  if (session.current.identityKey !== identityKey) session.current = { identityKey };
  const identity = session.current;
  const [state, setState] = useState<{ key: string; patches: Record<string, Patch> }>({ key: identityKey, patches: {} });
  const [now, setNow] = useState(Date.now);
  const patches = state.key === identityKey ? state.patches : {};
  useEffect(() => {
    setState(previous => previous.key === identityKey ? previous : { key: identityKey, patches: {} });
  }, [identityKey]);
  useEffect(() => {
    const expires = Object.values(patches).flatMap(patch => patch.completedAt && patch.completedAt + 5000 > now ? [patch.completedAt + 5000] : []);
    if (!expires.length) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(...expires) - Date.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [patches, now]);
  const reset = () => {
    if (session.current !== identity) return;
    setState({ key: identityKey, patches: {} });
  };
  const put: Simulation['put'] = (entityId, item, remove) => {
    if (session.current !== identity) return;
    const time = Date.now();
    setNow(time);
    setState(previous => ({ key: identityKey, patches: {
      ...(previous.key === identityKey ? previous.patches : {}),
      [patchKey(entityId, item.uid)]: { entityId, uid: item.uid, item: remove ? null : item, ...(item.status === 'completed' && !remove ? { completedAt: time } : {}) },
    } }));
  };
  return <SimulationContext.Provider value={{ identityKey, patches, now, put, reset }}>{children}</SimulationContext.Provider>;
}

export function simulatedChoreItems(items: NativeTodoItem[], entityId: string, simulation?: Simulation) {
  const current = new Map(items.map(item => [item.uid, item]));
  for (const patch of Object.values(simulation?.patches ?? {})) {
    if (patch.entityId !== entityId) continue;
    if (patch.item) current.set(patch.item.uid, patch.item);
    else current.delete(patch.uid);
  }
  return [...current.values()];
}
function choreStates(states: Json | undefined, simulation?: Simulation): Json | undefined {
  if (!simulation || !Object.keys(simulation.patches).length || !Array.isArray(states)) return states;
  return states.map(value => {
    const state = choreRecord(value), list = readChoreList(states, String(state.entityId));
    if (list.status !== 'ready') return value;
    const delta = simulatedChoreItems(list.items, String(state.entityId), simulation).filter(item => item.status !== 'completed').length
      - list.items.filter(item => item.status !== 'completed').length;
    const count = Number(state.state);
    return Number.isFinite(count) ? { ...state, state: String(Math.max(0, Math.trunc(count) + delta)) } : value;
  });
}
export function useChoreStates(states: Json | undefined): Json | undefined {
  return choreStates(states, useContext(SimulationContext));
}
function recent(simulation: Simulation | undefined, entityId: string, item: NativeTodoItem) {
  const completed = simulation?.patches[patchKey(entityId, item.uid)]?.completedAt;
  return completed !== undefined && simulation !== undefined && completed + 5000 > simulation.now;
}
function visibleItems(component: Component, states: Json | undefined, entityId: string, simulation?: Simulation) {
  const read = readChoreList(states, entityId);
  if (read.status !== 'ready') return [];
  const sorted = sortChoreItems(simulatedChoreItems(read.items, entityId, simulation));
  return sorted.filter(item => component.props.hideCompleted === false || item.status !== 'completed' || recent(simulation, entityId, item));
}
const taskEditable = (item: NativeTodoItem) => item.uid.startsWith('simulation-') || /^[1-9]\d*(?:--|$)/.test(item.uid);
type Editor = { entityId: string; item?: NativeTodoItem; generation?: string; nodeId?: string; descriptor?: RowSwipeAction };
type ChoresProps = { component: Component; document: StudioDocument; dataState?: string; editing: boolean; entities?: Record<string, Primitive>; renderOther?: (component: Component) => ReactNode; onSelect?: (id: string) => void; onAction?: (action: Action) => void; variables?: Record<string, Primitive>; search?: { query: Primitive | undefined; paths: readonly string[]; targetIds: readonly string[] } };
function ChoresOverlay({ root, children }: { root: HTMLElement | null; children: ReactNode }) {
  const host = root?.closest('.native-modal, .native-app');
  const overlay = <div className="native-chores chore-form-backdrop">{children}</div>;
  return host ? createPortal(overlay, host) : overlay;
}

function TodoRow({ item, entityId, canEdit, canDelete, offersUndo, onEdit, onToggle, disabled, actions, generation, onInvoke, legacy, accent }: {
  item: NativeTodoItem; entityId: string; canEdit: boolean; canDelete: boolean; offersUndo: boolean;
  onEdit: () => void; onToggle: () => void; disabled: boolean; actions: RowActions; generation: string; onInvoke: (action: RowSwipeAction) => void; legacy: boolean; accent: string;
}) {
  const done = item.status === 'completed', due = !done ? choreDue(item.due) : undefined;
  const title = choreTitle(item);
  const permitted = legacy ? { ...actions, trailing: actions.trailing.filter(action => action.action.type !== 'todo-row' || (action.action.operation === 'edit' ? canEdit : action.action.operation === 'delete' ? canDelete : true)) } : actions;
  return <RowInteractions actions={permitted} title={title} completed={done} disabled={disabled} generation={generation} entityId={entityId} legacy={legacy} accent={accent} onInvoke={onInvoke} reason={descriptor => descriptor.action.type === 'todo-row'
    ? descriptor.action.operation === 'edit' && !canEdit ? 'Editing is not supported for this item.' : descriptor.action.operation === 'delete' && !canDelete ? 'Deletion is not supported for this list.' : undefined : undefined}>
      <button className="chore-toggle" disabled={disabled} aria-label={`${done ? 'Mark Not Done' : 'Complete'} ${title}`} aria-pressed={done}
        onClick={onToggle}>
        <span className="chore-check" aria-hidden="true">{done && <Check size={17}/>}</span><span className="chore-copy"><span>{title}</span>{due && <small className={`chore-due-${due.tone}`}>{due.text}</small>}</span>
      </button>
      {offersUndo ? <button className="chore-accessory" disabled={disabled} onClick={onToggle}>Undo</button>
        : canEdit && <button className="chore-accessory" aria-label={`Edit ${title}`} disabled={disabled} onClick={onEdit}><Pencil size={19}/></button>}
  </RowInteractions>;
}

function ChoreEditor({ editor, lists, taskForm, onTarget, onClose, onSave }: {
  editor: Editor; lists: { entityId: string; title: string }[]; taskForm: boolean; onTarget: (entityId: string) => void; onClose: () => void; onSave: (entityId: string, item: NativeTodoItem) => void;
}) {
  const [summary, setSummary] = useState(editor.item?.summary ?? '');
  const [description, setDescription] = useState(editor.item?.description ?? '');
  const [due, setDue] = useState(editor.item?.due?.slice(0, 10) ?? '');
  const [time, setTime] = useState(editor.item?.due?.includes('T') ? editor.item.due.slice(11, 16) : '');
  const entityId = editor.entityId;
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { form.current?.querySelector('input')?.focus(); }, []);
  return <form ref={form} role="dialog" aria-modal="false" aria-label={editor.item ? 'Edit Task simulation' : 'New Task simulation'}
    className={`chore-form ${taskForm ? 'chore-task-form' : ''}`} onKeyDown={event => { if (event.key === 'Escape') onClose(); }} onSubmit={event => {
      event.preventDefault();
      if (!summary.trim()) return;
      const item: NativeTodoItem = { ...editor.item, uid: editor.item?.uid ?? uid('simulation'), summary: summary.trim(), status: editor.item?.status ?? 'needs_action' };
      if (taskForm) {
        if (description) item.description = description; else delete item.description;
        if (!due) delete item.due;
        else if (due !== editor.item?.due?.slice(0, 10) || time !== (editor.item?.due?.includes('T') ? editor.item.due.slice(11, 16) : '')) item.due = time ? `${due}T${time}:00` : due;
      }
      onSave(entityId, item);
    }}>
    <header><button type="button" onClick={onClose}>Cancel</button><strong>{editor.item ? 'Edit Task' : 'New Task'}</strong><button disabled={!summary.trim()} type="submit">{editor.item ? 'Save' : 'Add'}</button></header>
    <p role="note">Simulation only. No Home Assistant chores are changed.</p>
    <label>Task Name<input required maxLength={2000} value={summary} onChange={event => setSummary(event.target.value)}/></label>
    {taskForm && <><label>Description<textarea maxLength={16384} value={description} onChange={event => setDescription(event.target.value)}/></label>
      <label>Due Date<input type="date" value={due} onChange={event => setDue(event.target.value)}/></label>
      {due && <label>Due Time<input type="time" value={time} onChange={event => setTime(event.target.value)}/></label>}
      {!editor.item && lists.length > 1 && <label>Simulated list<select value={entityId} onChange={event => onTarget(event.target.value)}>{lists.map(list => <option key={list.entityId} value={list.entityId}>{list.title}</option>)}</select></label>}
      <p>Assignment, priority, recurrence and attachment metadata require the separate native task-form contract; they are not inferred from todo items.</p></>}
  </form>;
}

function ChoresContent({ component, document, dataState, editing, entities = {}, renderOther, onSelect, onAction, variables = document.variables, search }: ChoresProps) {
  const simulation = useContext(SimulationContext);
  const root = useRef<HTMLDivElement>(null);
  const isPage = component.props.nativeTodoPage === true;
  const nodes = isPage ? component.children ?? [] : [component];
  const [editor, setEditor] = useState<Editor>(), [announcement, setAnnouncement] = useState('');
  const profileError = nodes.some(node => Array.isArray(node.props.currentUserIds) && node.props.currentUserIds.length > 0) && !choreUserId(component, document);
  const sections = nodes.filter(node => ['todo-items', 'resident-todo-items'].includes(String(node.props.collectionKind)) && evaluateCondition(node.visibility, variables, entities)).flatMap(node => choreListIds(node, document).map(list => {
    const states = resolveBinding(node, document), read = readChoreList(states, list.entityId);
    const eligible = visibleItems(node, states, list.entityId, simulation);
    const filter = search?.targetIds.includes(node.id) ? search : undefined;
    const items = resolveCollection({ ...node, props: { ...node.props, collectionKind: '', requiredData: false } }, eligible, variables, filter).map(record => eligible[record.sourceIndex]);
    const state = choreRecords(choreStates(states, simulation)).find(state => state.entityId === list.entityId);
    const keepsOpen = items.some(item => recent(simulation, list.entityId, item));
    const countKnownEmpty = state && !['unknown', 'unavailable'].includes(String(state.state)) && Number(state.state) <= 0;
    return { ...list, node, read, items, eligible, hidden: countKnownEmpty && !keepsOpen };
  }));
  const shown = sections.filter(section => !section.hidden && (section.read.status !== 'ready' || section.items.length > 0));
  const addAction = choreRecord(component.props.addAction ?? nodes[0]?.props.addAction);
  const taskForm = component.props.hasTaskForm === true || nodes[0]?.props.hasTaskForm === true || component.props.collectionKind === 'resident-todo-items';
  const admin = Object.hasOwn(addAction, 'adminTodo'), grocery = Object.hasOwn(addAction, 'groceryItem');
  const canDelete = !admin && (taskForm || grocery);
  const disabled = editing || component.props.disabled === true || dataState === 'error' || dataState === 'loading' || profileError || !evaluateCondition(component.visibility, variables, entities);
  const readyLists = sections.filter(section => section.read.status === 'ready' && section.node.props.disabled !== true);
  const vacation = entities[String(component.props.vacationEntityId)] === 'on';
  const viewer = choreResident(component, document);
  const emptyText = component.props.hiddenByVacation && vacation ? component.props.vacationEmptyText
    : component.props.resident && viewer?.key === component.props.resident ? 'You have no chores due. Nice job!' : component.props.emptyText;
  const toggle = (entityId: string, item: NativeTodoItem) => {
    simulation?.put(entityId, { ...item, status: item.status === 'completed' ? 'needs_action' : 'completed' });
    setAnnouncement(item.status === 'completed' ? 'Task reopened in simulation.' : 'Task completed in simulation. Undo is available for five seconds.');
  };
  const generation = JSON.stringify([simulation?.identityKey, choreUserId(component, document), component.id, addAction, taskForm, admin, grocery]);
  const supportsAdd = ['assignedTask', 'groceryItem', 'adminTodo'].some(key => Object.hasOwn(addAction, key));
  const addTarget = String(choreRecord(addAction.groceryItem ?? addAction.adminTodo).entityId ?? readyLists[0]?.entityId ?? '');
  const addReason = disabled ? 'Chores is not currently interactive.' : !supportsAdd ? 'This root has no supported Add capability.'
    : !readyLists.some(list => list.entityId === addTarget) ? 'No authorized ready list is available.' : undefined;
  const current = useRef({ generation, disabled, sections, addReason });
  current.current = { generation, disabled, sections, addReason };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const currentRow = (entityId: string, item: NativeTodoItem, nodeId: string) => {
    if (!mounted.current || current.current.disabled || current.current.generation !== generation) return undefined;
    const section = current.current.sections.find(section => section.entityId === entityId && section.node.id === nodeId && !section.hidden && section.read.status === 'ready');
    return section?.node.props.disabled !== true ? section?.items.find(row => row.uid === item.uid && JSON.stringify(row) === JSON.stringify(item)) : undefined;
  };
  const validEditor = (candidate: Editor) => {
    if (!mounted.current || current.current.disabled || candidate.generation !== current.current.generation) return false;
    if (!candidate.item) return !current.current.addReason && current.current.sections.some(section => section.entityId === candidate.entityId && section.read.status === 'ready' && section.node.props.disabled !== true);
    const section = current.current.sections.find(section => section.entityId === candidate.entityId && section.node.id === candidate.nodeId && !section.hidden);
    const row = section?.items.find(row => row.uid === candidate.item!.uid && JSON.stringify(row) === JSON.stringify(candidate.item));
    if (!row || section?.node.props.disabled === true || grocery || !(admin || (taskForm && taskEditable(row)))) return false;
    return !candidate.descriptor || [...(section?.node.rowActions?.leading ?? []), ...(section?.node.rowActions?.trailing ?? [])].some(action => JSON.stringify(action) === JSON.stringify(candidate.descriptor));
  };
  useEffect(() => { if (editor && !validEditor(editor)) setEditor(undefined); });
  const openAdd = () => {
    if (!mounted.current || current.current.generation !== generation || current.current.addReason) return;
    setEditor({ entityId: addTarget, generation });
  };
  const docked = useTodoAddControl(component.id, { reason: isPage ? addReason : 'Add requires a Chores page root.', open: openAdd, busy: !!editor && validEditor(editor) });
  const filtering = typeof search?.query === 'string' && !!search.query.trim();
  const noMatches = filtering && sections.some(section => section.eligible.length && search?.targetIds.includes(section.node.id)) && !shown.length;
  return <div ref={root} className="native-chores" data-chore-page={isPage || undefined}>
    {Object.keys(simulation?.patches ?? {}).length > 0 && <div className="chore-simulation-status" role="status">Simulated changes only <button onClick={() => { simulation?.reset(); setAnnouncement('Chores simulation reset.'); }}>Reset Chores simulation</button></div>}
    <span className="sr-only" aria-live="polite">{announcement}</span>
    {dataState === 'loading' ? <p role="status">Loading chores...</p> : dataState === 'error' || profileError
      ? <p role="alert">{profileError ? 'Signed-in user unavailable. Refresh live preview data.' : 'Chores could not be loaded. Refresh live preview data.'}</p>
      : <>
        {nodes.map(node => !['todo-items', 'resident-todo-items'].includes(String(node.props.collectionKind)) ? renderOther?.(node) : <Fragment key={node.id}>{shown.filter(section => section.node.id === node.id).map(section => <section key={`${section.node.id}:${section.entityId}`} className="chore-section" data-component-id={editing ? section.node.id : undefined} onClick={editing ? event => { event.stopPropagation(); onSelect?.(section.node.id); } : undefined}>
          {!component.props.hideListHeaders && <h3>{section.title}</h3>}
          {section.read.status !== 'ready' ? <p role={section.read.status === 'error' ? 'alert' : 'status'}>{section.read.message}</p> : <div className="chore-module">
            <AnimatePresence initial={false}>{section.items.map(item => <TodoRow key={item.uid} entityId={section.entityId} item={item} accent={document.theme.accent} disabled={disabled || section.node.props.disabled === true}
              offersUndo={recent(simulation, section.entityId, item)} canEdit={!grocery && (admin || (taskForm && taskEditable(item)))} canDelete={canDelete}
              actions={section.node.rowActions ?? legacyRowActions({ taskForm, grocery, admin })} legacy={section.node.rowActions === undefined}
              generation={JSON.stringify([generation, section.node.id, item, section.node.props.disabled, section.node.visibility, !grocery && (admin || (taskForm && taskEditable(item))), canDelete])}
              onToggle={() => { if (currentRow(section.entityId, item, section.node.id)) toggle(section.entityId, item); }}
              onEdit={() => { if (currentRow(section.entityId, item, section.node.id) && !grocery && (admin || (taskForm && taskEditable(item)))) setEditor({ entityId: section.entityId, item, nodeId: section.node.id, generation }); }}
              onInvoke={descriptor => {
                if (!currentRow(section.entityId, item, section.node.id) || section.node.props.disabled === true) return;
                const action = descriptor.action;
                if (action.type !== 'todo-row') { onAction?.(action); return; }
                if (action.operation === 'toggle') toggle(section.entityId, item);
                else if (action.operation === 'edit' && !grocery && (admin || (taskForm && taskEditable(item)))) setEditor({ entityId: section.entityId, item, nodeId: section.node.id, generation, ...(section.node.rowActions ? { descriptor } : {}) });
                else if (action.operation === 'delete' && canDelete) { simulation?.put(section.entityId, item, true); setAnnouncement('Item deleted in simulation only.'); }
              }}/>)}</AnimatePresence>
          </div>}
        </section>)}{sections.some(section => section.node.id === node.id) && node.children?.map(child => renderOther?.(child))}</Fragment>)}
        {!shown.length && <div className="chore-empty" role="status">{vacation && component.props.hiddenByVacation ? <Plane size={30}/> : <Check size={30}/>}<strong>{noMatches ? 'No matching results' : String(component.props.emptyTitle ?? 'Nothing To Show')}</strong><p>{noMatches ? 'Clear search to show all eligible items.' : String(emptyText ?? '')}</p></div>}
      </>}
    {!docked && isPage && Object.keys(addAction).length > 0 && <div className="standalone-chore-dock"><button className="chore-add" disabled={!!addReason} title={addReason} onClick={openAdd}><Plus size={19}/>{grocery ? 'Add Groceries' : 'Add Task'}</button></div>}
    {editor && validEditor(editor) && <ChoresOverlay root={root.current}><ChoreEditor key={editor.item ? `${editor.entityId}:${editor.item.uid}` : 'new'} editor={editor} taskForm={taskForm && !grocery}
      lists={readyLists} onTarget={entityId => setEditor(previous => previous ? { ...previous, entityId } : undefined)} onClose={() => setEditor(undefined)} onSave={(entityId, item) => {
        if (!validEditor(editor) || !current.current.sections.some(section => section.entityId === entityId && section.read.status === 'ready' && section.node.props.disabled !== true)) { setEditor(undefined); setAnnouncement('This operation is no longer available.'); return; }
        simulation?.put(entityId, item); setEditor(undefined); setAnnouncement('Task saved in simulation only.');
      }}/></ChoresOverlay>}
  </div>;
}

export function NativeChores(props: ChoresProps) {
  const simulation = useContext(SimulationContext);
  const identityKey = simulation?.identityKey ?? JSON.stringify([props.document.id, choreUserId(props.component, props.document)]);
  const content = <ChoresContent key={identityKey} {...props}/>;
  return simulation ? content : <ChoresSimulationProvider identityKey={identityKey}>{content}</ChoresSimulationProvider>;
}
