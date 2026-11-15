import { useMemo, useState, type ReactNode } from 'react';
import { buildDocumentIndex, type SelectionKey } from '../preview2/model';
import { Menu } from '@base-ui/react/menu';
import { ChevronRight, EyeOff, MoreHorizontal, X } from 'lucide-react';
import type { CompositionDocument } from '../shared/composition/schema';
import type { Json } from '../shared/types';
import { replaceAt, valueAt, type EditorPath } from '../composition-editor';
import { Icon } from '../ui';
import { fieldOptions, ObjectRows, RowsProvider, useRows, type RowOverride } from './rows';
import { PushStack, Tag, usePush } from './kit';
import { HeaderPanel, TabsPanel, WallpaperPanel } from './panels';
import { collectLinks } from './outline';
import { deleteNode, duplicateNode, moveNodeBy, moveNodeTo, moveTargets } from './nodeActions';
import { copyText, typeName } from './util';
import { toastManager } from './toasts';
import type { Workspace2 } from './useWorkspace2';
import CompositionFields from '../CompositionFields';

/** The header every properties surface has: icon, title, one line of context, tags, More, Close (spec 5.2). */
function Header({ icon, title, line, tags, more, onClose, grab }: { icon: string; title: string; line: string; tags?: ReactNode; more?: ReactNode; onClose: () => void; grab?: boolean }) {
  return <header className="w2-props-head" data-grab={grab || undefined}>
    <span className="w2-props-icon"><Icon name={icon} size={20}/></span>
    <div className="w2-props-titles"><h2>{title}</h2><p>{line}</p>{tags && <div className="w2-props-tags">{tags}</div>}</div>
    {more}
    <button type="button" className="w2-icon-button" aria-label="Close" onClick={onClose}><X size={18} aria-hidden/></button>
  </header>;
}

/** Copies an id and says so. */
function IdRow({ id, path }: { id: string; path: string }) {
  return <div className="w2-row w2-id-row" data-field-path={path}><span className="w2-row-label">ID</span><code>{id}</code>
    <button type="button" onClick={async () => { if (await copyText(id)) toastManager.add({ title: 'Copied' }); }}>Copy</button></div>;
}

/** "Opened from": the pages and tiles whose actions open this page or sheet; each row goes there. */
function OpenedFrom({ document, kind, id, onGo }: { document: CompositionDocument; kind: 'page' | 'modal'; id: string; onGo: (key: `${'page' | 'modal' | 'node'}:${string}`) => void }) {
  const links = collectLinks(document).filter(link => link.to.kind === kind && link.to.id === id);
  const surfaces = [...document.pages, ...document.modals];
  return <section className="w2-group" aria-label="Opened from"><h3 className="w2-group-title">Opened from</h3>
    {links.length === 0 ? <p className="w2-caption">{kind === 'page' ? 'Nothing opens this page.' : 'Nothing opens this sheet.'}</p>
      : <ul>{links.map((link, at) => <li key={at}><button type="button" className="w2-link-row" onClick={() => onGo(link.holder ? `node:${link.holder.id}` : `${link.from.kind}:${link.from.id}`)}>
        <span>{link.holder?.title ?? surfaces.find(item => item.id === link.from.id)?.title}</span><span className="w2-page-via">{surfaces.find(item => item.id === link.from.id)?.title}</span><ChevronRight size={16} aria-hidden/></button></li>)}</ul>}
  </section>;
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
  if (!node) return null;
  return <>
    <ObjectRows path={path} owner={String((node as { type?: string }).type)} skip={notChildren} groups={['what', 'look', 'behaviour']}/>
    <section className="w2-group"><button type="button" className="w2-disclosure-head w2-advanced-row" onClick={() => push?.push({
      title: 'Advanced', body: <><IdRow id={node.id} path={[...path, 'id'].join('/')}/><ObjectRows path={path} owner={String((node as { type?: string }).type)} skip={child => notChildren(child) || child.at(-1) === 'id'} groups={['advanced']}/></>,
    })}><span className="w2-row-label">Advanced</span><span className="w2-summary"/><ChevronRight size={16} aria-hidden/></button></section>
  </>;
}

function PageBody({ ws, kind, path, onGo, onOpenProject }: { ws: Workspace2; kind: 'page' | 'modal'; path: EditorPath; onGo: Parameters<typeof OpenedFrom>[0]['onGo']; onOpenProject: (dialog: string) => void }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const surface = valueAt(document, path) as CompositionDocument['pages'][number] & CompositionDocument['modals'][number];
  const owner = kind === 'page' ? 'page' : 'sheet';
  const skip = (at: EditorPath) => at.at(-1) === 'components';
  const set = (at: EditorPath, value: Json) => onChange(replaceAt(document, at, value));
  const overrides: Record<string, RowOverride> = kind === 'page' ? {
    navigation: ({ path: at }) => {
      const on = (surface as CompositionDocument['pages'][number]).navigation.type === 'navigation-columns';
      return <>
        <label className="w2-switch-row" data-field-path={`${at.join('/')}/type`}><span className="w2-row-label">Open pages beside this one</span>
          <input type="checkbox" role="switch" checked={on} onChange={event => set(at, event.target.checked ? { type: 'navigation-columns', placeholder: 'Select an item', standalone: false } : { type: 'stack' })}/></label>
        {on && <CompositionFields schema={{ type: 'string', maxLength: 240 }} value={(surface as CompositionDocument['pages'][number] & { navigation: { placeholder: string } }).navigation.placeholder} path={[...at, 'placeholder']}
          label="Empty side text" document={document} onChange={onChange} onError={ws.studio.setError} options={fieldOptions('page', path)}/>}
      </>;
    },
    toolbar: ({ path: at }) => {
      const custom = surface.toolbar.type === 'replace';
      return <>
        <div className="w2-segment" role="group" aria-label="Header buttons" data-field-path={`${at.join('/')}/type`}>
          <span className="w2-row-label">Header buttons</span>
          {(['inherit', 'replace'] as const).map(type => <button key={type} type="button" aria-pressed={surface.toolbar.type === type}
            onClick={() => type !== surface.toolbar.type && set(at, type === 'inherit' ? { type: 'inherit' } : { type: 'replace', groups: [] })}>{type === 'inherit' ? 'Same as app' : 'Custom'}</button>)}
        </div>
        {custom && <CompositionFields schema={{ type: 'array', items: {} }} value={(surface.toolbar as { groups: Json }).groups} path={[...at, 'groups']} label="Header buttons" document={document} onChange={onChange} onError={ws.studio.setError} options={fieldOptions('page', path)}/>}
      </>;
    },
  } : {
    'presentation.height': ({ path: at }) => {
      const full = surface.presentation.height.type === 'full';
      return <div className="w2-segment" role="group" aria-label="Height" data-field-path={`${at.join('/')}/type`}>
        <span className="w2-row-label">Height</span>
        {(['fitted', 'full'] as const).map(type => <button key={type} type="button" aria-pressed={full === (type === 'full')}
          onClick={() => (type === 'full') !== full && set(at, type === 'full' ? { type: 'full' } : { type: 'fitted', follows: 'root', firstOpen: 'canonical@1' })}>{type === 'full' ? 'Full' : 'Fitted'}</button>)}
      </div>;
    },
  };
  const routes = (document.extensions?.routes ?? []).filter(route => route.pageId === surface.id).length;
  const advancedExtra = kind === 'page' && surface.navigation.type === 'navigation-columns' ? <>
    {(['onDemand', 'standalone'] as const).map(name => <div className="w2-row" key={name}><CompositionFields schema={{ type: 'boolean' }} value={Boolean((surface.navigation as unknown as Record<string, Json>)[name])}
      path={[...path, 'navigation', name]} label={name === 'onDemand' ? 'Start with one pane' : 'Start a new column set here'} document={document} onChange={onChange} onError={ws.studio.setError} options={fieldOptions('page', path)}/></div>)}
  </> : kind === 'modal' && surface.presentation.height.type === 'fitted' ? <div className="w2-row"><CompositionFields schema={{ enum: ['root', 'top-page'] }} value={surface.presentation.height.follows}
    path={[...path, 'presentation', 'height', 'follows']} label="Fit to" document={document} onChange={onChange} onError={ws.studio.setError} options={fieldOptions('sheet', path)}/></div> : undefined;
  return <>
    <ObjectRows path={path} owner={owner} skip={skip} overrides={overrides} groups={['what', 'look', 'behaviour']}/>
    {kind === 'page' && <section className="w2-group"><button type="button" className="w2-disclosure-head" onClick={() => onOpenProject('links')}>
      <span className="w2-row-label">Opens from outside the app</span><span className="w2-summary">{routes}</span><ChevronRight size={16} aria-hidden/></button></section>}
    <OpenedFrom document={document} kind={kind} id={surface.id} onGo={onGo}/>
    <section className="w2-group"><button type="button" className="w2-disclosure-head w2-advanced-row" onClick={() => push?.push({
      title: 'Advanced', body: <><IdRow id={surface.id} path={[...path, 'id'].join('/')}/><ObjectRows path={path} owner={owner} skip={child => skip(child) || child.at(-1) === 'id'} overrides={overrides} groups={['advanced']} extra={{ advanced: advancedExtra }}/></>,
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
  return <Menu.Root open={open} onOpenChange={setOpen}>
    <Menu.Trigger className={className} aria-label="More"><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
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
    body = <PageBody ws={ws} kind={target.kind} path={entry.path} onGo={ws.selectAnywhere} onOpenProject={onOpenProject}/>;
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
