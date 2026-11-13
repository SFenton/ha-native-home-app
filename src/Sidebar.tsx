import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CirclePlus, Database, Ellipsis, GripVertical, Layers, ListTree, Plus, Search, Settings2, SlidersHorizontal, Trash2 } from 'lucide-react';
import { componentCatalog, createComponent } from './shared/catalog';
import type { Component, ComponentType, Page, StudioDocument } from './shared/types';
import { assertCanRemoveComponent, containers, deleteSurface, duplicateComponent, findComponent, findSiblings, flattenComponents, getComponents, getPage, insertComponent, removeComponent, reorderComponent, uid, variantLabels, variants, type Target } from './editor';
import { linkedPageIds, owningTabIds } from './shared/navigation';
import { DocumentValidationError, validateDocument } from './shared/schema';
import { addLinkedPage, addPageLink, addSidebarTab, createSidebarPage, movePageLink, pageLinks, relocateComponent, removeTab, reorderTab, unlinkPage, type PageLink, type Placement } from './sidebar-commands';
import { Dialog, EmptyState, Field, Icon, IconButton, TextField } from './ui';
import './Sidebar.css';

export type WorkspaceView = 'design' | 'data' | 'variables' | 'navigation';
export type SidebarProps = { document: StudioDocument; target: Target; selection?: string; view: WorkspaceView; apply: (change: (draft: StudioDocument) => void) => void; onView: (view: WorkspaceView) => void; onTarget: (target: Target) => void; onSelect: (id?: string) => void; onAdd: (type: ComponentType) => void; onNewSurface: (kind: Target['kind']) => void; onDeleteSurface: () => void; onMove: (id: string, offset: number) => void; onDelete: (id: string) => void; onReveal?: () => void };
type Subject = { kind: 'surface'; target: Target } | { kind: 'tab'; id: string } | { kind: 'component'; target: Target; id: string } | { kind: 'palette'; type: ComponentType } | { kind: 'project' };
type MenuEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;
type OpenMenu = (event: MenuEvent, subject: Subject) => void;
type MenuState = { subject: Subject; origin: HTMLElement; x: number; y: number };
type MenuAction = { label: string; run: () => void; disabled?: boolean; destructive?: boolean };
type SidebarDialog =
  | { kind: 'rename'; subject: Subject; title: string; value: string }
  | { kind: 'delete'; subject: Subject; title: string; description: string }
  | { kind: 'tab' }
  | { kind: 'move'; target: Target; id: string }
  | { kind: 'links'; pageId: string };

function contextHandlers(open: OpenMenu, subject: Subject) {
  return {
    onContextMenu: (event: MouseEvent<HTMLElement>) => open(event, subject),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event, subject);
    },
  };
}

function ContextMenu({ menu, title, actions, onClose, fallbackFocus }: { menu: MenuState; title: string; actions: MenuAction[]; onClose: () => void; fallbackFocus: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const fallbackRef = useRef(fallbackFocus);
  closeRef.current = onClose;
  fallbackRef.current = fallbackFocus;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
    element.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const originBounds = menu.origin.getBoundingClientRect();
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) closeRef.current(); };
    const moved = (event: Event) => {
      if (event.type === 'resize') { closeRef.current(); return; }
      if (event.target instanceof Node && element.contains(event.target)) return;
      const current = menu.origin.getBoundingClientRect();
      // A queued scroll from revealing the origin must not dismiss a just-opened menu.
      if (!menu.origin.isConnected || current.x !== originBounds.x || current.y !== originBounds.y) closeRef.current();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', moved);
    window.addEventListener('scroll', moved, true);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', moved);
      window.removeEventListener('scroll', moved, true);
      if (menu.origin.isConnected && !menu.origin.closest('[hidden], [inert]')) menu.origin.focus({ preventScroll: true });
      queueMicrotask(() => {
        if (menu.origin.isConnected && !menu.origin.closest('[hidden], [inert]')) return;
        fallbackRef.current();
        if (globalThis.document.activeElement === globalThis.document.body || globalThis.document.activeElement?.closest('[hidden], [inert]')) {
          globalThis.document.querySelector<HTMLElement>('[data-editor-focus-fallback]')?.focus({ preventScroll: true });
        }
      });
    };
  }, [menu]);
  return createPortal(<div ref={ref} className="sidebar-context-menu" role="menu" aria-label={`${title} actions`} style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      onClose(); return;
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = items.findIndex(item => item === globalThis.document.activeElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
  }}>
    <div className="sidebar-menu-title">{title}</div>
    {actions.map(action => <button key={action.label} role="menuitem" tabIndex={-1} disabled={action.disabled} className={action.destructive ? 'sidebar-destructive' : ''} onClick={() => { onClose(); action.run(); }}>{action.label}</button>)}
  </div>, globalThis.document.body);
}

function PaletteItem({ type, label, icon, description, onAdd, openMenu, dragPrefix }: { type: ComponentType; label: string; icon: string; description: string; onAdd: () => void; openMenu: OpenMenu; dragPrefix: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: `${dragPrefix}:${type}`, data: { kind: 'palette', type } });
  return <div ref={setNodeRef} className={`palette-item ${isDragging ? 'dragging' : ''}`} {...contextHandlers(openMenu, { kind: 'palette', type })}>
    <button className="palette-add" title={description} onClick={onAdd}><span><Icon name={icon} size={19}/></span><div><strong>{label}</strong><small>{description}</small></div><Plus size={13}/></button>
    <button type="button" className="palette-actions" aria-label={`Actions for ${label}`} aria-haspopup="menu" onClick={event => openMenu(event, { kind: 'palette', type })}><Ellipsis size={15}/><span>Actions</span></button>
    <button ref={setActivatorNodeRef} type="button" className="palette-drag" aria-label={`Drag ${label} to canvas`} {...attributes} {...listeners}><GripVertical size={16}/></button>
  </div>;
}

function paletteActions(type: ComponentType, selection: string | undefined, onAdd: (type: ComponentType) => void, onAddInside?: (type: ComponentType) => void): MenuAction[] {
  return [
    { label: selection ? 'Add after selected component' : 'Add to surface', run: () => onAdd(type) },
    { label: 'Add inside selected group', disabled: !onAddInside, run: () => onAddInside?.(type) },
  ];
}

export type ComponentLibraryProps = {
  selection?: string;
  onAdd: (type: ComponentType) => void;
  onAddInside?: (type: ComponentType) => void;
  searchRef?: Ref<HTMLInputElement>;
};
export function ComponentLibrary({ selection, onAdd, onAddInside, searchRef }: ComponentLibraryProps) {
  const dragPrefix = useId();
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState<MenuState>();
  const localSearch = useRef<HTMLInputElement | null>(null);
  const palette = componentCatalog.filter(entry => `${entry.label} ${entry.description}`.toLowerCase().includes(search.toLowerCase()));
  const openMenu: OpenMenu = (event, subject) => {
    event.preventDefault(); event.stopPropagation();
    const origin = event.target instanceof Element ? event.target.closest<HTMLElement>('button') ?? event.currentTarget : event.currentTarget;
    const rect = origin.getBoundingClientRect();
    const pointer = event.type === 'contextmenu' && 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0);
    setMenu({ subject, origin, x: pointer ? event.clientX : rect.left, y: pointer ? event.clientY : rect.bottom });
  };
  const selectedType = menu?.subject.kind === 'palette' ? menu.subject.type : undefined;
  return <div className="component-library">
    <div className="library-search"><Search size={16} aria-hidden="true"/><input ref={element => {
      localSearch.current = element;
      if (typeof searchRef === 'function') searchRef(element);
      else if (searchRef) searchRef.current = element;
    }} aria-label="Search components" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a component..."/></div>
    <p className="library-hint">{selection ? 'Tap to insert after selection. Use Actions to nest in a selected group.' : 'Tap to add. Drag a handle to choose a position.'}</p>
    <div className="component-library-categories">{[...new Set(palette.map(entry => entry.category))].map(category => <div className="component-library-category" key={category}><div className="section-label">{category}</div>{palette.filter(entry => entry.category === category).map(entry => <PaletteItem key={entry.type} {...entry} dragPrefix={`palette:${dragPrefix}`} openMenu={openMenu} onAdd={() => onAdd(entry.type)}/>)}</div>)}</div>
    {!palette.length && <EmptyState icon="search" title="No components found">Try a shorter search or another component name.</EmptyState>}
    {menu && selectedType && <ContextMenu menu={menu} title={componentCatalog.find(entry => entry.type === selectedType)?.label ?? 'Component'} actions={paletteActions(selectedType, selection, onAdd, onAddInside)} onClose={() => setMenu(undefined)} fallbackFocus={() => localSearch.current?.focus()}/>}
  </div>;
}
function ContainerDrop({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `inside:${id}`, data: { kind: 'inside', componentId: id } });
  return <div ref={setNodeRef} className={`nested-drop ${isOver ? 'over' : ''}`}>Drop inside group</div>;
}
type TreeProps = Pick<SidebarProps, 'selection' | 'onSelect' | 'onMove' | 'onDelete'> & { openMenu: OpenMenu; target: Target; onPlace: (id: string) => void };
function TreeNode({ component, depth, selection, onSelect, onMove, onDelete, openMenu, target, onPlace }: { component: Component; depth: number } & TreeProps) {
  const [expanded, setExpanded] = useState(true);
  const reduceMotion = useReducedMotion();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: component.id, data: { kind: 'component', componentId: component.id, title: component.title }, transition: reduceMotion ? null : undefined });
  const isContainer = containers.has(component.type);
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'dragging' : ''}>
    <div className={`tree-row ${selection === component.id ? 'selected' : ''}`} style={{ paddingInlineStart: 12 + depth * 12 }} {...contextHandlers(openMenu, { kind: 'component', target, id: component.id })}>
      <button ref={setActivatorNodeRef} className="drag-handle" aria-label={`Reorder ${component.title}`} {...attributes} {...listeners}><GripVertical size={12}/></button>
      {isContainer && <button className="tree-expand" aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${component.title}`} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}</button>}
      <button className="tree-label" onClick={() => onSelect(component.id)} aria-pressed={selection === component.id}><Icon name={component.icon ?? (isContainer ? 'layers' : 'text')} size={13}/><span>{component.title || component.type}</span>{component.visibility && <span className="condition-dot" title="Conditional visibility"/>}</button>
      <IconButton label={`Actions for ${component.title}`} aria-haspopup="menu" onClick={event => openMenu(event, { kind: 'component', target, id: component.id })}><Ellipsis size={14}/></IconButton>
      <div className="tree-controls"><IconButton label={`Move ${component.title} up`} onClick={() => onMove(component.id, -1)}><ArrowUp size={11}/></IconButton><IconButton label={`Move ${component.title} down`} onClick={() => onMove(component.id, 1)}><ArrowDown size={11}/></IconButton><IconButton label={`Move ${component.title} to...`} onClick={() => onPlace(component.id)}><ListTree size={11}/></IconButton><IconButton label={`Delete ${component.title}`} onClick={() => onDelete(component.id)}><Trash2 size={11}/></IconButton></div>
    </div>
    {isContainer && expanded && <><Tree components={component.children ?? []} depth={depth + 1} selection={selection} onSelect={onSelect} onMove={onMove} onDelete={onDelete} openMenu={openMenu} target={target} onPlace={onPlace}/><ContainerDrop id={component.id}/></>}
  </div>;
}
function Tree({ components, depth = 0, ...props }: { components: Component[]; depth?: number } & TreeProps) {
  return <SortableContext items={components.map(component => component.id)} strategy={verticalListSortingStrategy}>{components.map(component => <TreeNode key={component.id} component={component} depth={depth} {...props}/>)}</SortableContext>;
}

type Commit = (change: (draft: StudioDocument) => void) => boolean;
const targetKey = (target: Target) => `${target.kind}:${target.id}${target.kind === 'activity' ? `:${target.variant}` : ''}`;
const linkKey = (link: PageLink) => `${targetKey(link.source)}:${link.kind}:${link.id}`;
function surfaceName(document: StudioDocument, target: Target): string {
  if (target.kind === 'activity') return `${document.liveActivities.find(item => item.id === target.id)?.name ?? 'Activity'} / ${variantLabels[target.variant]}`;
  return getPage(document, target)?.title || `Untitled ${target.kind}`;
}

function PlacementFields({ components, placement, onChange, excluded = [], toolbar = false }: { components: Component[]; placement: Placement; onChange: (placement: Placement) => void; excluded?: string[]; toolbar?: boolean }) {
  const all = flattenComponents(components).filter(item => !excluded.includes(item.id));
  const groups = all.filter(item => containers.has(item.type));
  const anchors = placement.kind === 'inside' ? groups : all;
  return <>
    <Field label="Insertion position"><select value={placement.kind} onChange={event => {
      const kind = event.target.value;
      if (kind === 'start' || kind === 'end') onChange({ kind });
      else if (kind === 'before' || kind === 'after' || kind === 'inside') onChange({ kind, anchorId: (kind === 'inside' ? groups : all)[0]?.id ?? '' });
    }}>
      <option value="start">At the start of {toolbar ? 'the toolbar' : 'the surface'}</option>
      <option value="end">At the end of {toolbar ? 'the toolbar' : 'the surface'}</option>
      {!toolbar && <><option value="before" disabled={!all.length}>Before a component</option><option value="after" disabled={!all.length}>After a component</option><option value="inside" disabled={!groups.length}>Inside a group</option></>}
    </select></Field>
    {'anchorId' in placement && <Field label={placement.kind === 'inside' ? 'Destination group' : 'Relative to component'}><select value={placement.anchorId} onChange={event => onChange({ ...placement, anchorId: event.target.value })}>
      {!anchors.some(item => item.id === placement.anchorId) && <option value="">Choose a component</option>}
      {anchors.map(item => <option key={item.id} value={item.id}>{item.title || item.type} ({item.id})</option>)}
    </select></Field>}
  </>;
}

function TabDialog({ document, commit, onClose, onTarget, error }: { document: StudioDocument; commit: Commit; onClose: () => void; onTarget: (target: Target) => void; error: ReactNode }) {
  const [label, setLabel] = useState('New tab');
  const [root, setRoot] = useState('');
  return <Dialog title="Add tab" onClose={onClose}><form onSubmit={event => {
    event.preventDefault();
    const newPage = root ? undefined : createSidebarPage(uid('page'), label.trim());
    const pageId = root || newPage!.id;
    const tabId = uid('tab');
    if (commit(draft => addSidebarTab(draft, { id: tabId, label: label.trim(), icon: 'home', pageId }, newPage))) {
      onTarget({ kind: 'page', id: pageId }); onClose();
    }
  }}>
    <TextField label="Tab label" value={label} onChange={setLabel} maxLength={240}/>
    <Field label="Tab root page"><select value={root} onChange={event => setRoot(event.target.value)}><option value="">Create a new page</option>{document.pages.map(page => <option value={page.id} key={page.id}>{page.title}</option>)}</select></Field>
    <p className="dialog-description">A tab opens its root page. Links from that page define its child pages; no content is copied.</p>
    {error}<div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={!label.trim() || document.navigation.tabs.length >= 8}>Add tab</button></div>
  </form></Dialog>;
}

function MoveDialog({ document, target, id, commit, onClose, onMoved, error }: { document: StudioDocument; target: Target; id: string; commit: Commit; onClose: () => void; onMoved: (target: Target) => void; error: ReactNode }) {
  const choices: { target: Target; label: string }[] = [
    ...document.pages.map(page => ({ target: { kind: 'page' as const, id: page.id }, label: `Page: ${page.title}` })),
    ...document.modals.map(page => ({ target: { kind: 'modal' as const, id: page.id }, label: `Modal: ${page.title}` })),
    ...document.liveActivities.flatMap(activity => variants.map(variant => ({ target: { kind: 'activity' as const, id: activity.id, variant }, label: `${activity.name}: ${variantLabels[variant]}` }))),
  ];
  const [destinationKey, setDestinationKey] = useState(targetKey(target));
  const [placement, setPlacement] = useState<Placement>({ kind: 'end' });
  const destination = choices.find(choice => targetKey(choice.target) === destinationKey)?.target;
  const component = findComponent(getComponents(document, target), id);
  const excluded = component ? [component.id, ...flattenComponents(component.children ?? []).map(item => item.id)] : [];
  return <Dialog title={`Move ${component?.title ?? 'component'}`} onClose={onClose}><form onSubmit={event => {
    event.preventDefault();
    if (destination && commit(draft => relocateComponent(draft, target, id, destination, placement))) { onMoved(destination); onClose(); }
  }}>
    <p className="dialog-description">Move this component and its children. Choose an exact position or nest it in a group. Undo restores the previous location.</p>
    <Field label="Destination surface"><select value={destinationKey} onChange={event => { setDestinationKey(event.target.value); setPlacement({ kind: 'end' }); }}>{choices.map(choice => <option value={targetKey(choice.target)} key={targetKey(choice.target)}>{choice.label}</option>)}</select></Field>
    <PlacementFields components={destination ? getComponents(document, destination) : []} placement={placement} onChange={setPlacement} excluded={excluded}/>
    {error}<div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={!destination || !component}>Move component</button></div>
  </form></Dialog>;
}

function LinksDialog({ document, pageId, commit, onClose, error }: { document: StudioDocument; pageId: string; commit: Commit; onClose: () => void; error: ReactNode }) {
  const page = document.pages.find(item => item.id === pageId);
  const links = pageLinks(document, pageId);
  const [chosen, setChosen] = useState('new');
  const [sourceId, setSourceId] = useState(document.navigation.tabs.find(tab => owningTabIds(document, pageId).includes(tab.id) && tab.pageId !== pageId)?.pageId ?? document.pages.find(item => item.id !== pageId)?.id ?? '');
  const [placement, setPlacement] = useState<Placement>({ kind: 'end' });
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const reference = links.find(link => linkKey(link) === chosen);
  const stale = chosen !== 'new' && !reference;
  const source = document.pages.find(item => item.id === sourceId);
  const moving = reference?.kind === 'component' ? findComponent(getComponents(document, reference.source), reference.id) : undefined;
  const excluded = moving ? [moving.id, ...flattenComponents(moving.children ?? []).map(item => item.id)] : [];
  return <Dialog title={`${confirmUnlink ? 'Remove link to' : 'Links & placement for'} ${page?.title ?? 'page'}`} onClose={onClose}>
    {confirmUnlink ? <>
      <p className="dialog-description">Clear only the selected navigation action. Keep its component or toolbar item, this page, and every other link. Undo restores the action.</p>
      {error}<div className="dialog-actions"><button onClick={() => setConfirmUnlink(false)}>Cancel</button><button className="danger-button" disabled={!reference} onClick={() => { if (reference && commit(draft => unlinkPage(draft, pageId, reference))) { setChosen('new'); setConfirmUnlink(false); } }}>Remove link</button></div>
    </> : <form onSubmit={event => {
      event.preventDefault();
      if (stale) return;
      if (commit(draft => reference ? movePageLink(draft, pageId, reference, sourceId, placement) : addPageLink(draft, pageId, sourceId, placement))) onClose();
    }}>
      <p className="dialog-description">Pages are connected by editable actions, not folders. Add a link, or move one existing link to a page in the destination tab. Other links remain unchanged, so shared pages may still belong to multiple tabs.</p>
      <Field label="Navigation link"><select value={chosen} onChange={event => { setChosen(event.target.value); setPlacement({ kind: 'end' }); }}>
        <option value="new">Add a new navigation tile</option>
        {stale && <option value={chosen}>Link no longer available</option>}
        {links.map(link => <option key={linkKey(link)} value={linkKey(link)}>{surfaceName(document, link.source)} / {link.label} ({link.kind})</option>)}
      </select></Field>
      {stale && <p role="alert" className="inline-error">This link changed. Choose a current link before continuing.</p>}
      <Field label="Link from page"><select value={sourceId} onChange={event => { setSourceId(event.target.value); setPlacement({ kind: 'end' }); }}>
        {!source && <option value="">Choose a page</option>}
        {document.pages.filter(item => item.id !== pageId).map(item => <option key={item.id} value={item.id}>{item.title} {document.navigation.tabs.some(tab => tab.pageId === item.id) ? '(tab root)' : ''}</option>)}
      </select></Field>
      <PlacementFields components={source?.components ?? []} placement={placement} onChange={setPlacement} excluded={excluded} toolbar={reference?.kind === 'toolbar'}/>
      {reference?.kind === 'toolbar' && <p className="dialog-description">This moves the toolbar item, keeping its leading/trailing placement.</p>}
      {error}<div className="dialog-actions">{reference && <button type="button" className="danger-text" onClick={() => setConfirmUnlink(true)}>Remove selected link...</button>}<button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={!source || !page || stale}>{reference ? 'Move link' : 'Add link'}</button></div>
    </form>}
  </Dialog>;
}

export default function Sidebar(props: SidebarProps) {
  const { document, target, onTarget, onNewSurface, selection, view, onView } = props;
  const [tab, setTab] = useState<'project' | 'library'>('project');
  const tabId = useId();
  const [menu, setMenu] = useState<MenuState>();
  const [dialog, setDialog] = useState<SidebarDialog>();
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const owners = useMemo(() => new Map(document.pages.map(page => [page.id, owningTabIds(document, page.id)])), [document]);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  const dialogOrigin = useRef<HTMLElement | undefined>(undefined);
  const projectButton = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const openDialog = (next: SidebarDialog) => {
    dialogOrigin.current = menu?.origin ?? (globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : undefined);
    setError(''); setDialog(next);
  };
  const closeDialog = () => {
    setDialog(undefined); setError('');
    queueMicrotask(() => { (dialogOrigin.current?.isConnected ? dialogOrigin.current : projectButton.current)?.focus(); });
  };
  const commit: Commit = change => {
    try {
      const next = structuredClone(document);
      change(next); validateDocument(next);
      props.apply(draft => { change(draft); validateDocument(draft); });
      setError(''); return true;
    } catch (reason) {
      setError(reason instanceof DocumentValidationError ? reason.errors.join('\n') : reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const openMenu: OpenMenu = (event, subject) => {
    event.preventDefault(); event.stopPropagation();
    const element = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null;
    const origin = element ?? event.currentTarget.querySelector<HTMLElement>('button') ?? event.currentTarget;
    const rect = origin.getBoundingClientRect();
    const pointer = 'clientX' in event && event.type === 'contextmenu' && (event.clientX !== 0 || event.clientY !== 0);
    setMenu({ subject, origin, x: pointer ? event.clientX : rect.left, y: pointer ? event.clientY : rect.bottom });
  };
  const selectSurface = (next: Target) => { onTarget(next); onView('design'); };
  const addPage = (parentId?: string) => {
    const page = createSidebarPage(uid('page'), 'Untitled page');
    if (commit(draft => addLinkedPage(draft, page, parentId))) {
      setCollapsed(previous => new Set([...previous].filter(id => !owners.get(parentId ?? '')?.includes(id))));
      selectSurface({ kind: 'page', id: page.id }); props.onSelect(undefined);
    }
  };
  const titleOf = (subject: Subject): string => {
    if (subject.kind === 'surface') return surfaceName(document, subject.target);
    if (subject.kind === 'component') return findComponent(getComponents(document, subject.target), subject.id)?.title || 'Component';
    if (subject.kind === 'tab') return document.navigation.tabs.find(tab => tab.id === subject.id)?.label || 'Tab';
    return subject.kind === 'project' ? 'Project' : componentCatalog.find(item => item.type === subject.type)?.label ?? 'Component';
  };
  const requestDelete = (subject: Subject) => {
    const title = titleOf(subject);
    openDialog({ kind: 'delete', subject, title, description: subject.kind === 'tab'
      ? 'Remove this tab only. Its root page, child pages, and configured links stay in the document. Their navigation ownership will be recalculated. Undo restores the tab.'
      : 'Delete this surface and its components. Links to it will be cleared, and tabs rooted on it will be removed. Child pages are kept. Undo restores the previous structure.' });
  };
  const actionsFor = (subject: Subject): MenuAction[] => {
    const rename: MenuAction = { label: 'Rename...', run: () => openDialog({ kind: 'rename', subject, title: titleOf(subject), value: titleOf(subject) }) };
    if (subject.kind === 'project') return [
      { label: 'Add tab...', run: () => openDialog({ kind: 'tab' }) },
      { label: 'Add unassigned page', run: () => addPage() },
    ];
    if (subject.kind === 'tab') {
      const current = document.navigation.tabs.find(item => item.id === subject.id);
      if (!current) return [];
      const index = document.navigation.tabs.indexOf(current);
      return [
        { label: 'Open root page', run: () => selectSurface({ kind: 'page', id: current.pageId }) },
        { label: 'Add page to this tab', run: () => addPage(current.pageId) }, rename,
        { label: 'Move tab earlier', disabled: index === 0, run: () => commit(draft => reorderTab(draft, current.id, -1)) },
        { label: 'Move tab later', disabled: index === document.navigation.tabs.length - 1, run: () => commit(draft => reorderTab(draft, current.id, 1)) },
        { label: 'Remove tab...', destructive: true, run: () => requestDelete(subject) },
      ];
    }
    if (subject.kind === 'surface') {
      const current = subject.target;
      return [
        { label: 'Edit surface', run: () => { selectSurface(current); props.onSelect(undefined); } }, rename,
        ...(current.kind === 'page' ? [
          { label: 'Add child page', run: () => addPage(current.id) },
          { label: 'Links & placement...', run: () => openDialog({ kind: 'links', pageId: current.id }) },
          { label: 'Make initial page', disabled: document.navigation.initialPageId === current.id, run: () => commit(draft => { draft.navigation.initialPageId = current.id; }) },
        ] : []),
        { label: `Delete ${current.kind === 'activity' ? 'activity' : current.kind}...`, disabled: current.kind === 'page' && document.pages.length <= 1, destructive: true, run: () => requestDelete(subject) },
      ];
    }
    if (subject.kind === 'palette') return paletteActions(subject.type, selection, props.onAdd, addInside);
    const items = getComponents(document, subject.target);
    const component = findComponent(items, subject.id);
    if (!component) return [];
    const siblings = findSiblings(items, subject.id)!;
    return [
      { label: 'Edit component', run: () => { selectSurface(subject.target); props.onSelect(subject.id); } }, rename,
      { label: 'Duplicate component', run: () => {
        const duplicate = duplicateComponent(component);
        if (commit(draft => insertComponent(getComponents(draft, subject.target), structuredClone(duplicate), subject.id))) { selectSurface(subject.target); props.onSelect(duplicate.id); }
      } },
      { label: 'Move up', disabled: siblings.indexOf(component) === 0, run: () => commit(draft => reorderComponent(getComponents(draft, subject.target), subject.id, -1)) },
      { label: 'Move down', disabled: siblings.indexOf(component) === siblings.length - 1, run: () => commit(draft => reorderComponent(getComponents(draft, subject.target), subject.id, 1)) },
      { label: 'Move to...', run: () => openDialog({ kind: 'move', target: subject.target, id: subject.id }) },
      { label: 'Delete component', destructive: true, run: () => {
        if (commit(draft => { assertCanRemoveComponent(getPage(draft, subject.target), subject.id); removeComponent(getComponents(draft, subject.target), subject.id); }) && selection && (selection === subject.id || findComponent(component.children ?? [], selection))) props.onSelect(undefined);
      } },
    ];
  };
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]') || globalThis.document.querySelector('dialog[open]')) return;
      if (sidebarRef.current?.closest('[hidden], [inert]') && !props.onReveal) return;
      event.preventDefault(); focusSearch.current = true; setTab('library'); onView('design');
      props.onReveal?.();
      queueMicrotask(() => searchRef.current?.focus());
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onView, props.onReveal]);
  useEffect(() => { if (tab === 'library' && focusSearch.current) { searchRef.current?.focus(); focusSearch.current = false; } }, [tab]);
  const components = getComponents(document, target);
  const errorNotice = error ? <p role="alert" className="inline-error">{error}</p> : null;
  const surfaceRow = (surface: Page | { id: string; name: string; enabled: boolean }, next: Target, note?: string, depth = 0) => {
    const subject: Subject = { kind: 'surface', target: next };
    const label = 'title' in surface ? surface.title || `Untitled ${next.kind}` : surface.name;
    return <div key={targetKey(next)} className="sidebar-surface" style={depth ? { marginInlineStart: 4 + Math.min(depth, 4) * 9 } : undefined} {...contextHandlers(openMenu, subject)}>
      <div className="sidebar-surface-row"><button className={`page-row ${view === 'design' && target.kind === next.kind && target.id === next.id ? 'active' : ''}`} onClick={() => selectSurface(next)} aria-current={view === 'design' && target.kind === next.kind && target.id === next.id ? 'page' : undefined}>
        <Icon name={'icon' in surface ? surface.icon : 'activity'} size={15}/><span>{label}</span>{next.kind === 'page' && document.navigation.initialPageId === next.id && <small>Start</small>}{'enabled' in surface && <span className={`status-dot ${surface.enabled ? 'enabled' : ''}`} aria-label={surface.enabled ? 'Enabled' : 'Disabled'}/>}
      </button><IconButton label={`Actions for ${label}`} aria-haspopup="menu" onClick={event => openMenu(event, subject)}><Ellipsis size={15}/></IconButton></div>
      {note && <p className="sidebar-page-note">{note}</p>}
    </div>;
  };
  const selectedGroup = selection ? findComponent(components, selection) : undefined;
  const addInside = selectedGroup && containers.has(selectedGroup.type) ? (type: ComponentType) => {
    const item = createComponent(type);
    if (commit(draft => {
      const group = findComponent(getComponents(draft, target), selectedGroup.id);
      if (!group || !containers.has(group.type)) throw new Error('The selected group no longer exists.');
      insertComponent(getComponents(draft, target), structuredClone(item), group.id, true);
    })) props.onSelect(item.id);
  } : undefined;
  return <aside ref={sidebarRef} className="sidebar" aria-label="Project navigation and component library">
    <div className="sidebar-top"><div className="sidebar-project"><span className="project-avatar"><Icon name="home" size={18}/></span><div><strong>{document.name}</strong><small>Personal workspace</small></div><span className="project-dot"/></div>
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'project' : event.key === 'End' ? 'library' : tab === 'project' ? 'library' : 'project';
        setTab(next); onView('design');
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-sidebar-tab="${next}"]`)?.focus();
      }}><button ref={projectButton} id={`${tabId}-project-tab`} data-sidebar-tab="project" role="tab" aria-controls={`${tabId}-project-panel`} tabIndex={tab === 'project' ? 0 : -1} aria-selected={tab === 'project'} onClick={() => { setTab('project'); onView('design'); }} className={tab === 'project' ? 'active' : ''}><Layers size={14}/> Project</button><button id={`${tabId}-library-tab`} data-sidebar-tab="library" role="tab" aria-controls={`${tabId}-library-panel`} tabIndex={tab === 'library' ? 0 : -1} aria-selected={tab === 'library'} onClick={() => { setTab('library'); onView('design'); }} className={tab === 'library' ? 'active' : ''}><CirclePlus size={14}/> Components</button></div>
    </div>
    <div className="sidebar-body">
      <div id={`${tabId}-library-panel`} role="tabpanel" aria-labelledby={`${tabId}-library-tab`} hidden={tab !== 'library'} inert={tab !== 'library'}>
        <ComponentLibrary searchRef={searchRef} selection={selection} onAdd={props.onAdd} onAddInside={addInside}/>
      </div>
      <div id={`${tabId}-project-panel`} role="tabpanel" aria-labelledby={`${tabId}-project-tab`} hidden={tab !== 'project'} inert={tab !== 'project'}>
        <section aria-label="Pages and tabs" {...contextHandlers(openMenu, { kind: 'project' })}>
          <div className="sidebar-section-heading"><span>PAGES & TABS</span><IconButton label="Page organization actions" aria-haspopup="menu" onClick={event => openMenu(event, { kind: 'project' })}><Ellipsis size={14}/></IconButton></div>
          <div className="sidebar-create-actions"><button aria-label="Create page" disabled={document.pages.length >= 50} title={target.kind === 'page' ? `Add a child page linked from ${surfaceName(document, target)}` : 'Add an unassigned page'} onClick={() => addPage(target.kind === 'page' ? target.id : undefined)}><Plus size={13}/> Add page</button><button disabled={document.navigation.tabs.length >= 8} onClick={() => openDialog({ kind: 'tab' })}><Plus size={13}/> Add tab</button></div>
          <p className="sidebar-help">Tabs open root pages. Children follow the first configured route, not folders. Use an item's actions to move or reorder its links.</p>
          {document.navigation.tabs.map(navTab => {
            const isCollapsed = collapsed.has(navTab.id);
            const root = document.pages.find(page => page.id === navTab.pageId);
            const children: { page: Page; via: string; depth: number }[] = [];
            const visited = new Set([navTab.pageId]);
            const visit = (parent: Page, depth: number) => {
              for (const id of linkedPageIds(document, parent.id)) {
                if (visited.has(id) || owners.get(id)?.length !== 1 || owners.get(id)?.[0] !== navTab.id) continue;
                visited.add(id);
                const page = document.pages.find(item => item.id === id);
                if (page) { children.push({ page, via: parent.title, depth }); visit(page, depth + 1); }
              }
            };
            if (root) visit(root, 1);
            const subject: Subject = { kind: 'tab', id: navTab.id };
            return <section className="sidebar-tab-group" key={navTab.id} aria-label={`${navTab.label} tab`}>
              <div className="sidebar-tab-heading" {...contextHandlers(openMenu, subject)}>
                <button aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${navTab.label} tab`} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(navTab.id)) next.delete(navTab.id); else next.add(navTab.id); return next; })}>{isCollapsed ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}<Icon name={navTab.icon} size={13}/><span>{navTab.label}</span></button>
                <IconButton label={`Add page to ${navTab.label} tab`} disabled={document.pages.length >= 50} onClick={() => addPage(navTab.pageId)}><Plus size={14}/></IconButton>
                <IconButton label={`Actions for ${navTab.label} tab`} aria-haspopup="menu" onClick={event => openMenu(event, subject)}><Ellipsis size={14}/></IconButton>
              </div>
              {!isCollapsed && <div className="sidebar-tab-pages">{root && surfaceRow(root, { kind: 'page', id: root.id }, 'Tab root')}
                {children.map(({ page, via, depth }) => surfaceRow(page, { kind: 'page', id: page.id }, `Linked from ${via}`, depth))}
                {!children.length && <p className="sidebar-help">Use + to add a linked page.</p>}
              </div>}
            </section>;
          })}
          {document.pages.some(page => (owners.get(page.id)?.length ?? 0) > 1 && !document.navigation.tabs.some(tab => tab.pageId === page.id)) && <><div className="sidebar-section-heading"><span>SHARED PAGES</span></div>{document.pages.filter(page => (owners.get(page.id)?.length ?? 0) > 1 && !document.navigation.tabs.some(tab => tab.pageId === page.id)).map(page => surfaceRow(page, { kind: 'page', id: page.id }, `Linked from ${document.navigation.tabs.filter(tab => owners.get(page.id)?.includes(tab.id)).map(tab => tab.label).join(', ')}`))}</>}
          {document.pages.some(page => !owners.get(page.id)?.length) && <><div className="sidebar-section-heading"><span>UNASSIGNED PAGES</span></div><p className="sidebar-help">No tab route reaches these pages. Use Links & placement to connect them.</p>{document.pages.filter(page => !owners.get(page.id)?.length).map(page => surfaceRow(page, { kind: 'page', id: page.id }))}</>}
        </section>
        <div className="sidebar-section-heading"><span>MODALS</span><IconButton label="Create modal" onClick={() => onNewSurface('modal')}><Plus size={14}/></IconButton></div>
        {document.modals.map(modal => surfaceRow(modal, { kind: 'modal', id: modal.id }))}
        {!document.modals.length && <p className="inline-empty">No modals yet. Add a sheet or focused dialog.</p>}
        <div className="sidebar-section-heading"><span>LIVE ACTIVITIES</span><IconButton label="Create Live Activity" onClick={() => onNewSurface('activity')}><Plus size={14}/></IconButton></div>
        {document.liveActivities.map(activity => surfaceRow(activity, { kind: 'activity', id: activity.id, variant: 'lockScreen' }))}
        {target.kind === 'activity' && view === 'design' && <div className="variant-list">{variants.map(variant => <button key={variant} className={target.variant === variant ? 'active' : ''} onClick={() => onTarget({ ...target, variant })}>{variantLabels[variant]}</button>)}</div>}
        {view === 'design' && <><div className="sidebar-divider"/><div className="sidebar-section-heading"><span><ListTree size={13}/> LAYERS</span><IconButton label="Add component" onClick={() => setTab('library')}><Plus size={14}/></IconButton></div><button className={`page-root ${selection ? '' : 'selected'}`} {...contextHandlers(openMenu, { kind: 'surface', target })} onClick={() => props.onSelect(undefined)}><Layers size={13}/> {target.kind === 'activity' ? variantLabels[target.variant] : 'Page & header'}<Settings2 size={12}/></button><Tree components={components} selection={selection} onSelect={props.onSelect} onMove={props.onMove} onDelete={props.onDelete} openMenu={openMenu} target={target} onPlace={id => openDialog({ kind: 'move', target, id })}/>{!components.length && <EmptyState title="A fresh canvas">Add components from the library to start building.</EmptyState>}<button className="outline-add" onClick={() => setTab('library')}><Plus size={14}/> Add component</button><button className="delete-surface" disabled={target.kind === 'page' && document.pages.length <= 1} onClick={props.onDeleteSurface}><Trash2 size={12}/> Delete {target.kind === 'activity' ? 'activity' : target.kind}</button></>}
      </div>
      {!dialog && errorNotice}
    </div>
    <nav className="sidebar-footer" aria-label="Project tools"><button className={view === 'navigation' ? 'active' : ''} onClick={() => onView('navigation')}><ListTree size={16}/> Navigation & theme<ChevronRight size={13}/></button><button className={view === 'data' ? 'active' : ''} onClick={() => onView('data')}><Database size={16}/> Data sources<span>{document.dataSources.length}</span></button><button className={view === 'variables' ? 'active' : ''} onClick={() => onView('variables')}><SlidersHorizontal size={16}/> Variables & conditions<span>{Object.keys(document.variables).length}</span></button><div className="workspace-note"><span className="status-dot enabled"/> Safe preview workspace <span>v1.0</span></div></nav>
    {menu && <ContextMenu menu={menu} title={titleOf(menu.subject)} actions={actionsFor(menu.subject)} onClose={() => setMenu(undefined)} fallbackFocus={() => projectButton.current?.focus()}/>}
    {dialog?.kind === 'tab' && <TabDialog document={document} commit={commit} onClose={closeDialog} onTarget={selectSurface} error={errorNotice}/>}
    {dialog?.kind === 'move' && <MoveDialog document={document} target={dialog.target} id={dialog.id} commit={commit} onClose={closeDialog} onMoved={next => { selectSurface(next); props.onSelect(dialog.id); }} error={errorNotice}/>}
    {dialog?.kind === 'links' && <LinksDialog document={document} pageId={dialog.pageId} commit={commit} onClose={closeDialog} error={errorNotice}/>}
    {dialog?.kind === 'rename' && <Dialog title={`Rename ${dialog.title}`} onClose={closeDialog}><form onSubmit={event => {
      event.preventDefault();
      if (commit(draft => {
        const subject = dialog.subject;
        const item = subject.kind === 'tab' ? draft.navigation.tabs.find(tab => tab.id === subject.id)
          : subject.kind === 'component' ? findComponent(getComponents(draft, subject.target), subject.id)
          : subject.kind === 'surface' ? subject.target.kind === 'activity' ? draft.liveActivities.find(activity => activity.id === subject.target.id) : getPage(draft, subject.target) : undefined;
        if (!item) throw new Error('This item no longer exists.');
        if ('label' in item) item.label = dialog.value.trim();
        else if ('title' in item) item.title = dialog.value.trim();
        else item.name = dialog.value.trim();
      })) closeDialog();
    }}><TextField label="Name" value={dialog.value} maxLength={240} onChange={value => setDialog({ ...dialog, value })}/>{errorNotice}<div className="dialog-actions"><button type="button" onClick={closeDialog}>Cancel</button><button className="primary" disabled={!dialog.value.trim()}>Rename</button></div></form></Dialog>}
    {dialog?.kind === 'delete' && <Dialog title={`${dialog.subject.kind === 'tab' ? 'Remove tab' : 'Delete'} ${dialog.title}?`} onClose={closeDialog}><p className="dialog-description">{dialog.description}</p>{errorNotice}<div className="dialog-actions"><button onClick={closeDialog}>Cancel</button><button className="danger-button" disabled={dialog.subject.kind === 'surface' && dialog.subject.target.kind === 'page' && document.pages.length <= 1} onClick={() => {
      const subject = dialog.subject;
      if (commit(draft => { if (subject.kind === 'tab') removeTab(draft, subject.id); else if (subject.kind === 'surface') deleteSurface(draft, subject.target); })) closeDialog();
    }}>{dialog.subject.kind === 'tab' ? 'Remove tab' : 'Delete surface'}</button></div></Dialog>}
  </aside>;
}
