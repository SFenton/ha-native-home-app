import { boundControlShows } from './editors/boundControl';
import { useMemo, useState, type ReactNode } from 'react';
import { buildDocumentIndex, type SelectionKey } from '../preview2/model';
import { Menu } from '@base-ui/react/menu';
import { ChevronRight, EyeOff, MoreHorizontal, X } from 'lucide-react';
import type { CompositionDocument } from '../shared/composition/schema';
import { valueAt, type EditorPath } from '../composition-editor';
import { Icon } from '../ui';
import { ObjectRows, RowsProvider, useRows } from './rows';
import { PushStack, Tag, usePush } from './kit';
import { HeaderPanel, TabsPanel, WallpaperPanel } from './panels';
import { useAdd } from './add/AddHost';
import { useDeepRows } from './editors/overrides';
import { after } from './add/insert';
import IdRow from './IdRow';
import SurfaceSettings from './navigation/PageSettings';
import { deleteNode, duplicateNode, moveNodeBy, moveNodeTo, moveTargets } from './nodeActions';
import { typeName } from './util';
import type { Workspace2 } from './useWorkspace2';

/** The header every properties surface has: icon, title, one line of context, tags, More, Close (spec 5.2). */
function Header({ icon, title, line, tags, more, onClose, grab }: { icon: string; title: string; line: string; tags?: ReactNode; more?: ReactNode; onClose: () => void; grab?: boolean }) {
  return <header className="w2-props-head" data-grab={grab || undefined}>
    <span className="w2-props-icon"><Icon name={icon} size={20}/></span>
    <div className="w2-props-titles"><h2>{title}</h2><p>{line}</p>{tags && <div className="w2-props-tags">{tags}</div>}</div>
    {more}
    <button type="button" className="w2-icon-button" aria-label="Close" onClick={onClose}><X size={18} aria-hidden/></button>
  </header>;
}

/** "Move To…": every page, sheet and container, as a pushed page. */
function MoveToPage({ id, onDone }: { id: string; onDone: (moved: CompositionDocument) => void }) {
  const { document, onError } = useRows();
  const targets = moveTargets(document, id);
  return <ul className="w2-move-list">{targets.map(target => <li key={`${target.parent.kind}:${target.parent.id}:${target.parent.tabId ?? ''}`}>
    <button type="button" className="w2-link-row" onClick={() => { try { onDone(moveNodeTo(document, id, target.parent)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } }}>
      <span>{target.label}</span>{target.where && <span className="w2-page-via">{target.where}</span>}</button></li>)}</ul>;
}

/** A node's own fields; its child nodes are edited by selecting them. */
const notChildren = (at: EditorPath) => at.at(-1) === 'children';
function NodeBody({ path }: { path: EditorPath }) {
  const push = usePush();
  const { document } = useRows();
  const node = valueAt(document, path) as { id: string } | undefined;
  const overrides = useDeepRows(path);
  if (!node) return null;
  // A bound control hides the fields its kind does not use: the compiler rejects them.
  const hidden = (at: EditorPath) => notChildren(at) || !boundControlShows(document, path, at);
  return <>
    <ObjectRows path={path} owner={String((node as { type?: string }).type)} skip={hidden} overrides={overrides} groups={['what', 'look', 'behaviour']}/>
    <section className="w2-group"><button type="button" className="w2-disclosure-head w2-advanced-row" onClick={() => push?.push({
      title: 'Advanced', body: <><IdRow id={node.id} path={[...path, 'id'].join('/')}/><ObjectRows path={path} owner={String((node as { type?: string }).type)} skip={child => hidden(child) || child.at(-1) === 'id'} overrides={overrides} groups={['advanced']}/></>,
    })}><span className="w2-row-label">Advanced</span><span className="w2-summary"/><ChevronRight size={16} aria-hidden/></button></section>
  </>;
}

/** The node's More menu: Duplicate, Move Up, Move Down, Move To…, Delete. Move To… pushes a page inside the surface. */
function PropertiesNodeMenu(props: { ws: Workspace2; path: EditorPath; id: string; selectionKey: SelectionKey }) {
  const { onError } = useRows();
  const push = usePush();
  const { id, ...rest } = props;
  return <NodeMenu {...rest} onError={onError} onMoveTo={push ? () => push.push({ title: 'Move To…', body: <MoveToPage id={id} onDone={moved => { props.ws.studio.apply(moved); push.pop(); }}/> }) : undefined}/>;
}

/**
 * The node's More menu. Wide, the selected tile's handle shows it too (without Move To…, which needs the properties page);
 * `onMoveTo` adds that item.
 */
export function NodeMenu({ ws, path, selectionKey, onError, onMoveTo, className = 'w2-icon-button' }: { ws: Workspace2; path: EditorPath; selectionKey: SelectionKey; onError: (message: string) => void; onMoveTo?: () => void; className?: string }) {
  const document = ws.document!;
  const [open, setOpen] = useState(false);
  const index = ws.index!;
  const position = Number(path.at(-1)), siblings = (valueAt(document, path.slice(0, -1)) as unknown[]).length;
  const run = (operation: () => void) => { try { operation(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const add = useAdd();
  return <Menu.Root open={open} onOpenChange={setOpen}>
    <Menu.Trigger className={className} aria-label="More"><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      {add && <Menu.Item className="w2-menu-item" onClick={() => { const destination = after(document, selectionKey); if (destination) add.open(destination); }}>Add After…</Menu.Item>}
      <Menu.Item className="w2-menu-item" onClick={() => run(() => {
        const copy = duplicateNode(document, path); ws.studio.apply(copy.document);
        const key = buildDocumentIndex(copy.document).keyAt(copy.path); if (key) ws.select(key);
      })}>Duplicate</Menu.Item>
      <Menu.Item className="w2-menu-item" disabled={position === 0} onClick={() => run(() => ws.studio.apply(moveNodeBy(document, path, -1)))}>Move Up</Menu.Item>
      <Menu.Item className="w2-menu-item" disabled={position >= siblings - 1} onClick={() => run(() => ws.studio.apply(moveNodeBy(document, path, 1)))}>Move Down</Menu.Item>
      {onMoveTo && <Menu.Item className="w2-menu-item" onClick={onMoveTo}>Move To…</Menu.Item>}
      <Menu.Separator className="w2-menu-sep"/>
      <Menu.Item className="w2-menu-item w2-danger-item" onClick={() => run(() => {
        ws.studio.apply(deleteNode(document, path));
        const parent = index.ancestors(selectionKey).at(-1);
        ws.select(parent && parent !== index.get(selectionKey)?.surface ? parent : undefined);
      })}>Delete</Menu.Item>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

/**
 * The properties surface's content (spec 5.2), for the card and the sheet alike: a header and a body that depends on
 * what is selected. Depth is a push inside it, never a second surface.
 */
export default function PropertiesPanel({ ws, onClose, onOpenProject, notice, onError }: { ws: Workspace2; onClose: () => void; onOpenProject: (dialog: string) => void; notice?: string; onError: (message: string) => void }) {
  const { document, target, index } = ws;
  const ctx = useMemo(() => document ? { document, onChange: ws.studio.apply, onError } : undefined, [document, ws.studio.apply, onError]);
  if (!document || !ctx || !target || !index) return null;
  const surfaceTitle = (key?: string) => { const [kind, ...id] = (key ?? '').split(':'); return (kind === 'page' ? document.pages : document.modals).find(item => item.id === id.join(':'))?.title ?? ''; };
  let header: ReactNode, body: ReactNode, title = '';
  if (target.kind === 'node') {
    const entry = index.get(target.key)!, node = entry.node!;
    title = node.title;
    const section = index.ancestors(target.key).map(key => index.get(key)?.node).filter(Boolean).reverse().find(item => item?.type === 'section' || item?.type === 'tile-grid' || item?.type === 'status-rail' || item?.type === 'room-section');
    const hidden = 'visibleWhen' in node && node.visibleWhen;
    header = <Header onClose={onClose} icon={(node as { icon?: { name: string } }).icon?.name ?? 'grid'} title={node.title}
      line={`${typeName(node.type)} · ${surfaceTitle(entry.surface)}${section ? ` › ${section.title}` : ''}`}
      tags={hidden ? <Tag><EyeOff size={12} aria-hidden/> Hidden by Rule</Tag> : undefined}
      more={<PropertiesNodeMenu ws={ws} path={entry.path} id={node.id} selectionKey={target.key}/>}/>;
    body = <NodeBody path={entry.path}/>;
  } else if (target.kind === 'page' || target.kind === 'modal') {
    const entry = index.get(target.key)!;
    const surface = valueAt(document, entry.path) as { title: string; icon: { name: string } };
    title = surface.title;
    header = <Header onClose={onClose} icon={surface.icon.name} title={surface.title} line={target.kind === 'page' ? 'Page settings' : 'Sheet settings'}/>;
    body = <SurfaceSettings ws={ws} kind={target.kind} path={entry.path} onGo={ws.selectAnywhere}/>;
  } else if (target.kind === 'tabs') {
    title = 'Tabs';
    header = <Header onClose={onClose} icon="layers" title="Tabs" line="Tab bar"/>;
    body = <TabsPanel selectedTab={target.key?.startsWith('tab:') ? target.key.slice(4) : undefined}/>;
  } else if (target.kind === 'header') {
    title = 'Header Buttons';
    header = <Header onClose={onClose} icon="sliders" title="Header Buttons" line="Used on every page"/>;
    body = <HeaderPanel/>;
  } else {
    title = 'Wallpaper';
    header = <Header onClose={onClose} icon="image" title="Wallpaper" line="Behind every page"/>;
    body = <WallpaperPanel/>;
  }
  return <RowsProvider value={ctx}>
    <PushStack key={`${target.kind}:${'key' in target ? target.key : ''}`} rootTitle={title} rootHeader={<>{header}{notice && <p role="alert" className="w2-notice">{notice}</p>}</>}
      root={<div className="w2-props-body">{body}</div>}/>
  </RowsProvider>;
}
