import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react';
import { motion, useIsPresent, useReducedMotion } from 'motion/react';
import { ActionEditor } from './ActionEditor';
import { flattenComponents, uid } from './editor';
import { contrastForeground, isTodoList, legacyFloatingButtons, legacyRowActions } from './shared/interactions';
import { choreRecord } from './shared/native-chores';
import type { Action, ActionConfirmation, Component, FloatingButton, Page, PageSearch, Primitive, RowActions, RowSwipeAction, StudioDocument } from './shared/types';
import { Field, Icon, IconButton, IconField, SelectField, TextField } from './ui';
import './InteractionControls.css';

function ColorEditor({ color, accent, onChange }: { color?: string; accent: string; onChange: (color?: string) => void }) {
  const swatch = color?.length === 4 ? `#${[...color.slice(1)].map(value => value + value).join('')}` : color ?? accent;
  return <Field label="Color"><div className="color-input"><input aria-label="Action color" type="color" value={swatch} onChange={event => onChange(event.target.value)}/><input aria-label="Action hex color" value={color ?? ''} placeholder="Theme accent" onChange={event => onChange(event.target.value || undefined)}/></div></Field>;
}
function OrderButtons({ index, length, move, remove }: { index: number; length: number; move: (offset: number) => void; remove: () => void }) {
  return <div className="selection-tools"><IconButton label="Move action up" disabled={!index} onClick={() => move(-1)}><ArrowUp size={15}/></IconButton><IconButton label="Move action down" disabled={index === length - 1} onClick={() => move(1)}><ArrowDown size={15}/></IconButton><button className="danger-text" onClick={remove}><Trash2 size={14}/> Remove action</button></div>;
}
function reorder<T>(items: T[], index: number, offset: number) { items.splice(index + offset, 0, items.splice(index, 1)[0]); }
function ContextActionEditor({ action, document, roots, todoRow, onChange }: {
  action: FloatingButton['action'] | RowSwipeAction['action']; document: StudioDocument; roots?: Component[]; todoRow?: boolean;
  onChange: (action: FloatingButton['action'] | RowSwipeAction['action']) => void;
}) {
  const local = action.type === 'todo-add' || action.type === 'todo-row';
  return <><SelectField label="Action context" value={local ? action.type : 'standard'} options={[
    { value: 'standard', label: 'Standard action' }, ...(roots?.length ? [{ value: 'todo-add', label: 'Add to Chores (simulation)' }] : []),
    ...(todoRow ? [{ value: 'todo-row', label: 'Chores row operation (simulation)' }] : []),
  ]} onChange={type => onChange(type === 'todo-add' ? { type, componentId: roots![0].id } : type === 'todo-row' ? { type, operation: 'toggle' } : { type: 'none' })}/>
    {action.type === 'todo-add' ? <SelectField label="Chores root" value={action.componentId} options={(roots ?? []).map(item => ({ value: item.id, label: item.title || item.id }))} onChange={componentId => onChange({ ...action, componentId })}/>
      : action.type === 'todo-row' ? <SelectField label="Row operation" value={action.operation} options={['toggle', 'edit', 'delete']} onChange={operation => onChange({ type: 'todo-row', operation: operation as 'toggle' | 'edit' | 'delete' })}/>
        : <ActionEditor document={document} action={action} onChange={onChange}/>}</>;
}
export function PageInteractionEditor({ page, document, update, createFilterVariable }: {
  page: Page; document: StudioDocument; update: (edit: (page: Page) => void) => void; createFilterVariable: (search: PageSearch, variable: string) => void;
}) {
  const all = flattenComponents(page.components), roots = all.filter(item => item.props.nativeTodoPage === true);
  const inherited = legacyFloatingButtons(page), search = page.search;
  const filterTargets = all.filter(item => item.props.nativeTodoPage === true || (item.type === 'list' && item.binding && (!item.props.requiredData || isTodoList(item))));
  const endpointSources = document.dataSources.filter(source => source.kind === 'endpoint' && source.queryVariable && all.some(item => item.binding?.sourceId === source.id));
  const enableFilter = () => {
    const variable = uid('search-query');
    createFilterVariable({ id: search?.id ?? uid('search'), label: search?.label ?? 'Search', placeholder: search?.placeholder ?? 'Search items', mode: 'filter', queryVariable: variable, targetComponentIds: filterTargets.slice(0, 1).map(item => item.id), paths: ['summary', 'title'] }, variable);
  };
  return <>
    <details className="inspector-section" open><summary>Floating actions</summary><div>
      {page.floatingButtons === undefined ? <><p className="field-note">Legacy controls: {inherited.map(item => item.label).join(', ') || 'none'}. Customize to edit the inherited template.</p><button onClick={() => update(item => { item.floatingButtons = inherited.map(button => ({ ...button, id: uid('floating') })); })}>Customize floating actions</button></>
        : <><p className="field-note">{page.floatingButtons.length ? 'One bottom-trailing dock; order is top to bottom.' : 'Floating actions disabled, including legacy Add.'}</p>
          {page.floatingButtons.length > 4 && <p role="alert">This inherited template has more than four controls. Remove controls before saving, or use legacy actions to retain all controls in overflow.</p>}
          {page.floatingButtons.map((button, index) => <details className="chrome-editor" key={button.id}><summary>{button.label || 'Floating action'}</summary><div>
            <TextField label="Floating label" value={button.label} maxLength={80} onChange={label => update(item => { item.floatingButtons![index].label = label; })}/>
            <IconField value={button.icon} onChange={icon => update(item => { item.floatingButtons![index].icon = icon; })}/>
            <ColorEditor color={button.color} accent={document.theme.accent} onChange={color => update(item => { if (color) item.floatingButtons![index].color = color; else delete item.floatingButtons![index].color; })}/>
            <ContextActionEditor action={button.action} document={document} roots={roots} onChange={action => { if (action.type !== 'todo-row') update(item => { item.floatingButtons![index].action = action; }); }}/>
            <OrderButtons index={index} length={page.floatingButtons!.length} move={offset => update(item => reorder(item.floatingButtons!, index, offset))} remove={() => update(item => { item.floatingButtons!.splice(index, 1); })}/>
          </div></details>)}
          <button className="add-button" disabled={page.floatingButtons.length >= 4} onClick={() => update(item => { item.floatingButtons!.push({ id: uid('floating'), label: 'New action', icon: 'plus', action: { type: 'none' } }); })}><Plus size={14}/> Add floating action</button></>}
      <button onClick={() => update(item => { item.floatingButtons = []; })}>Disable floating actions</button>{page.floatingButtons !== undefined && <button onClick={() => update(item => { delete item.floatingButtons; })}>Use legacy floating actions</button>}
    </div></details>
    <details className="inspector-section" open><summary>Search</summary><div>
      {!search ? <button disabled={!filterTargets.length && !endpointSources.length} onClick={() => {
        if (filterTargets.length) enableFilter();
        else update(item => { item.search = { id: uid('search'), label: 'Search', placeholder: 'Search items', mode: 'endpoint', sourceId: endpointSources[0].id }; });
      }}>Enable search</button> : <>
        <TextField label="Search label" value={search.label} maxLength={120} onChange={label => update(item => { item.search!.label = label; })}/>
        <TextField label="Search placeholder" value={search.placeholder} maxLength={120} onChange={placeholder => update(item => { item.search!.placeholder = placeholder; })}/>
        <SelectField label="Search mode" value={search.mode} options={[{ value: 'filter', label: 'Local filter (works offline)' }, { value: 'endpoint', label: 'Registered endpoint search' }]} onChange={mode => {
          if (mode === 'filter') enableFilter();
          else update(item => { item.search = { id: search.id, label: search.label, placeholder: search.placeholder, mode: 'endpoint', sourceId: endpointSources[0]?.id ?? '' }; });
        }}/>
        {search.mode === 'filter' ? <>
          <SelectField label="Filter query variable" value={search.queryVariable} options={Object.entries(document.variables).filter(([, value]) => typeof value === 'string').filter(([key]) => !document.dataSources.some(source => source.queryVariable === key)).map(([key]) => key)} onChange={queryVariable => update(item => { if (item.search?.mode === 'filter') item.search.queryVariable = queryVariable; })}/>
          <Field label="Filter targets"><div>{filterTargets.map(target => <label className="checkbox-field" key={target.id}><input type="checkbox" checked={search.targetComponentIds.includes(target.id)} onChange={event => update(item => { if (item.search?.mode === 'filter') item.search.targetComponentIds = event.target.checked ? [...item.search.targetComponentIds, target.id] : item.search.targetComponentIds.filter(id => id !== target.id); })}/>{target.title || target.id}</label>)}</div></Field>
          {search.paths.map((path, index) => <div key={index}><TextField label={`Search path ${index + 1}`} value={path} maxLength={500} onChange={path => update(item => { if (item.search?.mode === 'filter') item.search.paths[index] = path; })}/><button disabled={search.paths.length <= 1} onClick={() => update(item => { if (item.search?.mode === 'filter') item.search.paths.splice(index, 1); })}>Remove search path {index + 1}</button></div>)}
          <button disabled={search.paths.length >= 4} onClick={() => update(item => { if (item.search?.mode === 'filter') item.search.paths.push('subtitle'); })}>Add search path</button>
        </> : <><SelectField label="Endpoint search source" value={search.sourceId} options={[{ value: '', label: 'Choose a bound endpoint source' }, ...endpointSources.map(source => ({ value: source.id, label: source.name }))]} onChange={sourceId => update(item => { if (item.search?.mode === 'endpoint') item.search.sourceId = sourceId; })}/><p className="field-note">Query variable: {document.dataSources.find(source => source.id === search.sourceId)?.queryVariable || 'not configured'}. Edit it in Data sources. The registered endpoint must support search; only saved sources can run queries.</p></>}
        <button className="danger-text" onClick={() => update(item => { delete item.search; })}>Remove search</button>
      </>}
    </div></details>
  </>;
}
export function ListInteractionEditor({ component, document, update }: { component: Component; document: StudioDocument; update: (edit: (component: Component) => void) => void }) {
  const todo = isTodoList(component);
  const owner = [...document.pages, ...document.modals].flatMap(page => flattenComponents(page.components)).find(root => root.props.nativeTodoPage && flattenComponents(root.children ?? []).some(item => item.id === component.id));
  const add = choreRecord(owner?.props.addAction ?? owner?.children?.[0]?.props.addAction ?? component.props.addAction);
  const defaults = todo ? legacyRowActions({ taskForm: owner?.props.hasTaskForm === true || component.props.hasTaskForm === true || component.props.collectionKind === 'resident-todo-items', grocery: Object.hasOwn(add, 'groceryItem'), admin: Object.hasOwn(add, 'adminTodo') }) : { keyPath: 'id', leading: [], trailing: [] };
  const row = component.rowActions;
  return <details className="inspector-section" open><summary>Row swipe / menu actions</summary><div>
    <p className="field-note">{todo ? 'Chores permissions still apply: groceries cannot be edited; admin to-dos cannot be deleted; task editing needs a supported UID. Completion, Undo and eligible edit accessories remain available.' : 'Rows need stable, unique string keys. Actions are simulated without row interpolation.'}</p>
    {!row ? <><p className="field-note">{todo ? 'Using legacy Chores swipe and confirmation defaults.' : 'No row actions configured.'}</p><button onClick={() => update(item => { item.rowActions = structuredClone(defaults); })}>Customize row actions</button></> : <>
      {!todo && <TextField label="Row key path" value={row.keyPath} onChange={keyPath => update(item => { item.rowActions!.keyPath = keyPath; })}/>}
      {(['leading', 'trailing'] as const).map(side => <section key={side}><h4>{side === 'leading' ? 'Leading' : 'Trailing'} edge</h4>{row[side].map((descriptor, index) => {
        const change = (edit: (action: RowSwipeAction) => void) => update(item => edit(item.rowActions![side][index]));
        return <details className="chrome-editor" key={descriptor.id}><summary>{descriptor.label || 'Row action'}</summary><div>
          <TextField label="Swipe/menu label" value={descriptor.label} maxLength={80} onChange={label => change(item => { item.label = label; })}/>
          <IconField value={descriptor.icon} onChange={icon => change(item => { item.icon = icon; })}/>
          <ColorEditor color={descriptor.color} accent={document.theme.accent} onChange={color => change(item => { if (color) item.color = color; else delete item.color; })}/>
          <ContextActionEditor document={document} action={descriptor.action} todoRow={todo} onChange={action => {
            if (action.type === 'todo-add') return;
            change(item => {
              item.action = action;
              if (!(action.type === 'todo-row' && action.operation === 'toggle')) delete item.completedLabel;
              if (action.type === 'todo-row' && action.operation === 'delete' && !item.confirmation) item.confirmation = { title: 'Delete this item?', confirmLabel: 'Delete', cancelLabel: 'Cancel', destructive: true };
            });
          }}/>
          {descriptor.action.type === 'todo-row' && descriptor.action.operation === 'toggle' && <TextField label="Completed label (optional)" value={descriptor.completedLabel} maxLength={80} onChange={label => change(item => { if (label) item.completedLabel = label; else delete item.completedLabel; })}/>}
          <label className="checkbox-field"><input type="checkbox" checked={descriptor.fullSwipe ?? false} onChange={event => update(item => { for (const action of item.rowActions![side]) action.fullSwipe = action.id === descriptor.id && event.target.checked; })}/> Full swipe target</label>
          <label className="checkbox-field"><input type="checkbox" checked={!!descriptor.confirmation} onChange={event => change(item => { if (event.target.checked) item.confirmation = { title: 'Run this action?', confirmLabel: 'Continue', cancelLabel: 'Cancel' }; else delete item.confirmation; })}/> Confirm this swipe/menu action</label>
          {descriptor.confirmation && <>
            <TextField label="Confirmation title" value={descriptor.confirmation.title} maxLength={120} onChange={title => change(item => { item.confirmation!.title = title; })}/>
            <TextField label="Confirmation message" value={descriptor.confirmation.message} maxLength={1000} onChange={message => change(item => { item.confirmation!.message = message; })}/>
            <TextField label="Confirm label" value={descriptor.confirmation.confirmLabel} maxLength={80} onChange={confirmLabel => change(item => { item.confirmation!.confirmLabel = confirmLabel; })}/>
            <TextField label="Cancel label" value={descriptor.confirmation.cancelLabel} maxLength={80} onChange={cancelLabel => change(item => { item.confirmation!.cancelLabel = cancelLabel; })}/>
            <label className="checkbox-field"><input type="checkbox" checked={descriptor.confirmation.destructive ?? false} onChange={event => change(item => { item.confirmation!.destructive = event.target.checked; })}/> Destructive confirmation</label>
          </>}
          <SelectField label="Action side" value={side} options={['leading', 'trailing']} onChange={destination => update(item => {
            const other = destination as 'leading' | 'trailing';
            if (other === side) return;
            if (item.rowActions![other].length >= 3) throw new Error('At most three actions per edge.');
            if (item.rowActions![side][index].fullSwipe && item.rowActions![other].some(action => action.fullSwipe)) throw new Error('The destination edge already has a full-swipe target. Turn off one target before moving this action.');
            const [action] = item.rowActions![side].splice(index, 1);
            item.rowActions![other].push(action);
          })}/>
          <OrderButtons index={index} length={row[side].length} move={offset => update(item => reorder(item.rowActions![side], index, offset))} remove={() => update(item => { item.rowActions![side].splice(index, 1); })}/>
        </div></details>;
      })}<button disabled={row[side].length >= 3} onClick={() => update(item => { item.rowActions![side].push({ id: uid('swipe'), label: 'New action', icon: 'plus', action: { type: 'none' } }); })}>Add {side} action</button></section>)}
    </>}
    <button onClick={() => update(item => { item.rowActions = { ...(!todo ? { keyPath: row?.keyPath ?? 'id' } : {}), leading: [], trailing: [] }; })}>Disable row actions</button>{row && <button onClick={() => update(item => { delete item.rowActions; })}>Use legacy row actions</button>}
  </div></details>;
}

type AddControl = { reason?: string; open: () => void; busy?: boolean };
type SurfaceRegistry = { register: (id: string, control: AddControl) => () => void };
const SurfaceContext = createContext<SurfaceRegistry | undefined>(undefined);
export function useTodoAddControl(id: string, control: AddControl): boolean {
  const surface = useContext(SurfaceContext), latest = useRef(control);
  latest.current = control;
  useEffect(() => surface?.register(id, { reason: control.reason, busy: control.busy, open: () => latest.current.open() }), [surface, id, control.reason, control.busy]);
  return !!surface;
}
export function InteractionSurface({ page, active, editing, onSelect, onAction, children, trailingInset = 16, fontScale = 1, accent = '#0071E3' }: {
  page: Page; active: boolean; editing: boolean; onSelect: () => void; onAction: (action: Action) => void; children?: ReactNode; trailingInset?: number; fontScale?: number; accent?: string;
}) {
  const root = useRef<HTMLDivElement>(null), dock = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<Element | null>(null), [controls, setControls] = useState<Record<string, AddControl>>({}), [overflow, setOverflow] = useState(false);
  const registry = useMemo<SurfaceRegistry>(() => ({ register: (id, control) => {
    setControls(previous => ({ ...previous, [id]: control }));
    return () => setControls(previous => { const next = { ...previous }; delete next[id]; return next; });
  } }), []);
  const buttons = page.floatingButtons ?? legacyFloatingButtons(page);
  const busy = Object.values(controls).some(control => control.busy);
  const measuredStack = useRef({ signature: '', height: 0 });
  const stackSignature = JSON.stringify([fontScale, buttons.map(button => [button.id, button.label])]);
  if (measuredStack.current.signature !== stackSignature) measuredStack.current = { signature: stackSignature, height: 0 };
  useLayoutEffect(() => { setHost(root.current?.closest('.native-modal, .native-app') ?? null); }, []);
  useLayoutEffect(() => {
    const scroll = root.current?.closest<HTMLElement>('.native-scroll, .native-modal-scroll');
    const measure = () => {
      const height = dock.current?.offsetHeight ?? 0;
      scroll?.style.setProperty('--interaction-dock-height', `${height + 20}px`);
      const available = host instanceof HTMLElement ? host.clientHeight : 0;
      if (!overflow && height > 0) measuredStack.current.height = height;
      dock.current?.style.setProperty('--interaction-menu-height', `${available > 0 ? Math.max(44, available - (host?.matches('.native-modal') ? 154 : 218)) : 220}px`);
      setOverflow(buttons.length > 4 || (available > 0 && Math.max(measuredStack.current.height, buttons.length * 60 * fontScale) > available * .45));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    if (dock.current) observer?.observe(dock.current);
    if (host) observer?.observe(host);
    return () => { observer?.disconnect(); scroll?.style.removeProperty('--interaction-dock-height'); };
  }, [host, active, stackSignature, overflow, busy]);
  const renderButton = (button: FloatingButton) => {
    const action = button.action, control = action.type === 'todo-add' ? controls[action.componentId] : undefined;
    const reason = action.type === 'todo-add' ? control?.reason ?? (!control ? 'This Chores root is not currently visible.' : undefined) : undefined;
    const color = button.color ?? accent;
    return <button key={button.id} disabled={!editing && !!reason} title={reason} style={{ background: color, color: contrastForeground(color) }} onClick={() => {
      if (editing) onSelect();
      else if (action.type === 'todo-add') control?.open();
      else onAction(action);
    }}><Icon name={button.icon} size={19}/><span>{button.label}{reason && <small>{reason}</small>}</span></button>;
  };
  const content = active && !busy && buttons.length > 0 ? <div ref={dock} role="group" className="interaction-dock" aria-label="Floating actions" style={{ insetInlineEnd: trailingInset }}>
    {overflow ? <details><summary>Actions ({buttons.length})</summary><div>{buttons.map(renderButton)}</div></details> : buttons.map(renderButton)}
  </div> : null;
  return <SurfaceContext.Provider value={registry}><div ref={root} className="interaction-surface">{children}</div>{host && content && createPortal(content, host)}</SurfaceContext.Provider>;
}
export function SurfaceSearch({ search, document, variables, editing, onSelect, onVariable, queryLiveEnabled, onEnable, onSubmit, mode, error, active }: {
  search: PageSearch; document: StudioDocument; variables: Record<string, Primitive>; editing: boolean; onSelect: () => void;
  onVariable?: (variable: string, value: string) => void; queryLiveEnabled?: boolean; onEnable?: () => void; onSubmit?: (sourceId: string) => void;
  mode?: string; error?: string; active: boolean;
}) {
  const variable = search.mode === 'filter' ? search.queryVariable : document.dataSources.find(source => source.id === search.sourceId)?.queryVariable;
  const query = variable && typeof variables[variable] === 'string' ? variables[variable] as string : '';
  const [composition, setComposition] = useState<string>();
  const endpoint = search.mode === 'endpoint', blocked = endpoint && !queryLiveEnabled;
  useEffect(() => { setComposition(undefined); }, [search.id, variable, endpoint, blocked, active]);
  const status = !endpoint ? 'Local filter - no network requests' : blocked ? 'Configured sample data - endpoint queries disabled'
    : mode === 'unsaved' ? 'Save this source before searching' : mode === 'loading' ? 'Searching...' : mode === 'error' ? error || 'Endpoint search unavailable'
      : mode === 'empty' ? 'No matching results' : mode === 'live' || mode === 'ready' ? 'Endpoint results' : 'Enter a query to search. Configured samples are not query results.';
  return <div className="surface-search" onClick={editing ? onSelect : undefined}>
    <label><span>{search.label}</span><div><Search size={18}/><input type="search" aria-label={search.label} maxLength={500} placeholder={search.placeholder} value={composition ?? query} readOnly={editing} disabled={!editing && (blocked || !active)} onCompositionStart={() => { if (!editing && !blocked && active) setComposition(query); }} onCompositionEnd={event => { setComposition(undefined); if (variable && !editing && !blocked && active) onVariable?.(variable, event.currentTarget.value); }} onChange={event => {
      if (editing || blocked || !active) return;
      if (composition !== undefined) setComposition(event.target.value);
      else if (variable) onVariable?.(variable, event.target.value);
    }} onKeyDown={event => { if (!editing && active && !blocked && event.key === 'Enter' && !event.nativeEvent.isComposing && composition === undefined && endpoint && query.trim()) { event.preventDefault(); onSubmit?.(search.sourceId); } }}/>{(composition ?? query) && <button aria-label={`Clear ${search.label}`} disabled={editing || blocked || !active} onClick={() => { setComposition(undefined); if (variable) onVariable?.(variable, ''); }}><X size={16}/></button>}</div></label>
    <small role={mode === 'error' ? 'alert' : 'status'}>{status}</small>
    {!editing && blocked && active && <button onClick={onEnable}>Enable endpoint search reads</button>}
  </div>;
}
function Confirmation({ confirmation, root, onCancel, onConfirm }: { confirmation: ActionConfirmation; root: HTMLElement | null; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDivElement>(null), invoker = useRef<HTMLElement | null>(null);
  useEffect(() => {
    invoker.current = document.activeElement as HTMLElement | null;
    ref.current?.querySelector('button')?.focus();
    return () => { if (invoker.current?.isConnected) invoker.current.focus(); };
  }, []);
  const content = <div className="interaction-confirm-backdrop"><div ref={ref} className="interaction-confirm" role="alertdialog" aria-modal="false" aria-label={confirmation.title} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onCancel(); }
    if (event.key === 'Tab') {
      const buttons = ref.current?.querySelectorAll('button');
      if (buttons?.length) { event.preventDefault(); (document.activeElement === buttons[0] ? buttons[1] : buttons[0]).focus(); }
    }
  }}><h3>{confirmation.title}</h3>{confirmation.message && <p>{confirmation.message}</p>}<button onClick={onCancel}>{confirmation.cancelLabel}</button><button className={confirmation.destructive ? 'chore-delete-action' : ''} onClick={onConfirm}>{confirmation.confirmLabel}</button></div></div>;
  const host = root?.closest('.native-modal, .native-app');
  return host ? createPortal(content, host) : content;
}
export function RowInteractions({ actions, title, completed, disabled, generation, reason, onInvoke, children, legacy = false, entityId, accent = '#0071E3' }: {
  actions: RowActions; title: string; completed?: boolean; disabled: boolean; generation: string; reason?: (action: RowSwipeAction) => string | undefined;
  onInvoke: (action: RowSwipeAction) => void; children: ReactNode; legacy?: boolean; entityId?: string; accent?: string;
}) {
  const root = useRef<HTMLDivElement>(null), present = useIsPresent(), reduced = useReducedMotion();
  const [edge, setEdge] = useState<'leading' | 'trailing'>(), [drag, setDrag] = useState<number>(), [pending, setPending] = useState<{ action: RowSwipeAction; signature: string }>();
  const start = useRef<{ x: number; y: number; horizontal?: boolean } | undefined>(undefined), travel = useRef(0);
  const signature = JSON.stringify([generation, actions, disabled, present]), current = useRef(signature), mounted = useRef(true);
  current.current = signature;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setEdge(undefined); setDrag(undefined); setPending(undefined); start.current = undefined; }, [signature]);
  useEffect(() => {
    if (!edge) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setEdge(undefined); };
    window.addEventListener('pointerdown', dismiss); return () => window.removeEventListener('pointerdown', dismiss);
  }, [edge]);
  const activate = (action: RowSwipeAction) => {
    if (disabled || !present || reason?.(action) || !mounted.current || current.current !== signature) return;
    setEdge(undefined); setDrag(undefined);
    if (action.confirmation) setPending({ action, signature }); else onInvoke(action);
  };
  const rtl = () => root.current && getComputedStyle(root.current).direction === 'rtl' ? -1 : 1;
  const chosen = edge ?? (drag !== undefined && drag * rtl() > 0 ? 'leading' : 'trailing');
  const label = (action: RowSwipeAction) => completed && action.action.type === 'todo-row' && action.action.operation === 'toggle' ? action.completedLabel ?? action.label : action.label;
  return <motion.div ref={root} className="chore-row interaction-row" layout={!reduced} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} aria-hidden={!present} inert={!present} data-swipe={edge} data-entity-id={entityId} onKeyDown={event => { if (event.key === 'Escape') { setEdge(undefined); setDrag(undefined); } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setEdge(undefined); }}>
    <div className={`chore-swipe-actions ${chosen}`} data-active={!!edge || !!drag} aria-hidden={!edge} inert={!edge || disabled}>{actions[chosen].map(action => <button key={action.id} disabled={disabled || !!reason?.(action)} title={reason?.(action)} style={{ background: action.color ?? accent, color: contrastForeground(action.color ?? accent) }} onClick={() => activate(action)}><Icon name={action.icon} size={18}/>{label(action)}</button>)}</div>
    <motion.div className={`chore-row-front ${completed ? 'is-completed' : ''}`} animate={{ x: drag ?? (edge ? (edge === 'leading' ? 1 : -1) * rtl() * actions[edge].length * 90 : 0) }} transition={reduced || drag !== undefined ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 38 }}
      onClickCapture={event => { if (Math.abs(travel.current) > 10) { event.stopPropagation(); event.preventDefault(); travel.current = 0; } }} onPointerDown={event => {
        if (disabled || event.button !== 0 || (event.target as HTMLElement).closest('.chore-accessory,details')) return;
        start.current = { x: event.clientX, y: event.clientY }; travel.current = 0;
      }} onPointerMove={event => {
        if (!start.current) return;
        const x = event.clientX - start.current.x, y = event.clientY - start.current.y;
        if (!start.current.horizontal && Math.abs(y) > Math.abs(x) && Math.abs(y) > 10) { start.current = undefined; return; }
        if (Math.abs(x) > 10 && Math.abs(x) > Math.abs(y) * 1.3) {
          start.current.horizontal = true; travel.current = x; event.currentTarget.setPointerCapture?.(event.pointerId);
          setDrag(actions[x * rtl() > 0 ? 'leading' : 'trailing'].length ? Math.max(-300, Math.min(300, x)) : 0); event.preventDefault();
        }
      }} onPointerUp={event => {
        if (!start.current) return;
        const horizontal = start.current.horizontal, x = travel.current * rtl(); start.current = undefined; setDrag(undefined);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!horizontal) return;
        const side = x > 0 ? 'leading' : 'trailing';
        const full = actions[side].find(action => action.fullSwipe);
        if (Math.abs(x) > 210 && full) activate(full);
        else setEdge(Math.abs(x) > 35 && actions[side].length ? side : undefined);
      }} onPointerCancel={() => { start.current = undefined; setDrag(undefined); }}>
      {children}
      {(actions.leading.length > 0 || actions.trailing.length > 0) && <details className="chore-menu"><summary aria-label={`Actions for ${title}`}><MoreHorizontal size={19}/></summary><div>
        {[...actions.leading, ...actions.trailing].map(action => <button key={action.id} disabled={disabled || !!reason?.(action)} title={reason?.(action)} style={{ background: action.color ?? accent, color: contrastForeground(action.color ?? accent) }} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); activate(action); }}><Icon name={action.icon} size={17}/>{label(action)}{reason?.(action) && <small>{reason(action)}</small>}</button>)}
        {(['leading', 'trailing'] as const).filter(side => actions[side].length).map(side => <button key={side} disabled={disabled} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); setEdge(side); }}>{legacy ? side === 'leading' ? 'Show completion swipe' : 'Show edit/delete swipe' : `Show ${side} swipe`}</button>)}
      </div></details>}
    </motion.div>
    {pending && pending.signature === signature && pending.action.confirmation && <Confirmation root={root.current} confirmation={pending.action.confirmation} onCancel={() => setPending(undefined)} onConfirm={() => {
      if (mounted.current && current.current === pending.signature && !disabled && present && !reason?.(pending.action)) onInvoke(pending.action);
      setPending(undefined);
    }}/>}
  </motion.div>;
}
