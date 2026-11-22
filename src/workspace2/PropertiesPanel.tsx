import { boundControlShows } from './editors/boundControl';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { TemplateUsesList } from './TemplateUses';
import { templateWords } from './templateWords';
import { useTemplateActions } from './templateActions';
import { renameComponent, usesText } from './linked';
import { LabeledRow, TextInput } from './editors/controls';
import { buildDocumentIndex, type IndexEntry, type SelectionKey } from '../preview2/model';
import { CRUMB_SEPARATOR, levelCrumbs } from './levels';
import { Menu } from '@base-ui/react/menu';
import { ChangeListIconItem } from './ListIconPicker';
import { ChevronRight, EyeOff, Link2, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import type { ComponentEntry, CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { valueAt, type EditorPath } from '../composition-editor';
import { GlyphByName } from '../preview2/nodes/shared';
import { ChooseRow, gatherFixed, ObjectRows, RowsProvider, useRows } from './rows';
import AdvancedFold from './AdvancedFold';
import { fixedLine, type FieldGroup } from './labels';
import { PushStack, Tag, useNarrow, usePush } from './kit';
import { HeaderPanel, TabsPanel, WallpaperPanel } from './panels';
import { useAdd } from './add/AddHost';
import { useDeepRows } from './editors/overrides';
import { after } from './add/insert';
import SurfaceSettings from './navigation/PageSettings';
import { deleteNode, duplicateNode, filterMoveTargets, groupMoveTargets, moveNodeBy, moveNodeTo, moveTargets, putControlsOnTop, takeOffOverlay, type MoveTarget } from './nodeActions';
import { typeName } from './util';
import ComponentParams, { TemplateParameters, TemplateSettings } from './ComponentParams';
import TemplateFold from './TemplateFold';
import PerPlaceLine from './PerPlaceLine';
import { rowTarget } from './params';
import { ChooseBar, ChooseFieldsButton, useChooseRows } from './ChooseFields';
import { setChoosing, useChoosing } from './chooseStore';
import LinkedLine from './LinkedLine';
import { bodyIdOf, componentUses } from '../shared/composition/components';
import type { Workspace2 } from './useWorkspace2';
import { AlertPreviewContext } from './editors/alertPreview';
import './author.css';
import { StatesGroup, StateTapRow } from './styles/StatesGroup';
import { StylesPanel } from './styles/StylesPanel';
import { StatePreviewContext } from './styles/words';
import FlowEditor, { FlowMenu } from './data/FlowEditor';
import { SourceFields } from './dialogs/Data';
import { sourceName } from './dialogs/sources';
import { useWorkspaceData } from './pickers/WorkspaceData';
import { DataActionsProvider } from './data/dataActions';
import { FixedTextsNote, isList, ShowStateRow } from './data/ListStates';
import { repeatScopeOf, RepeatScopeProvider } from './data/repeatScope';
import { flowById, usedCount } from './data/flow';
import { AreaInspector, OverlayPosition, TabBarGroup, TabsList } from './layout/LayoutEditors';
import { ButtonsGroup, ProgressRow, WidthRow } from './layout/TileParts';
import { SwipeRow } from './layout/SwipeRow';
import { FoldSideRow } from './layout/FoldSides';
import { StateWordsFold } from './layout/StateWordsFold';
import { GroupsRow } from './layout/GroupsRow';
import ToneField from './layout/ToneField';
import ChoicesGroup from './layout/ChoicesGroup';
import ChildPosition from './layout/ChildPosition';
import RepeatProposal from './repeats/RepeatProposal';
import { pieceText, repeatedText } from './repeats/repeatWords';
import MapOrientation from './controls/MapOrientation';
import MapButtons from './controls/MapButtons';
import { DialControlInspector, ThermostatInspector } from './dial/DialControlInspector';
import { isThermostatDial } from '../shared/composition/dial-control-edit';
import LogicEditor from './data/logic/LogicEditor';
import { LogicScopeProvider } from './data/logic/logicScope';
import { entryOf, kindWord, useCount } from './data/logic/logicModel';
import { logicWords } from './data/logic/logicWords';

/** The header every properties surface has: icon, title, one line of context, tags, More, Close (spec 5.2). */
function Header({ icon, title, line, tags, more, onClose, grab }: { icon: string; title: string; line: string; tags?: ReactNode; more?: ReactNode; onClose: () => void; grab?: boolean }) {
  return <header className="w2-props-head" data-grab={grab || undefined}>
    <span className="w2-props-icon"><GlyphByName name={icon} size={20}/></span>
    <div className="w2-props-titles"><h2>{title}</h2><p title={line}>{line}</p>{tags && <div className="w2-props-tags">{tags}</div>}</div>
    {more}
    <button type="button" className="w2-icon-button" aria-label="Close" onClick={onClose}><X size={18} aria-hidden/></button>
  </header>;
}

/** "Move To…": every page, sheet and container, as a pushed page. */
export function MoveToPage({ id, onDone }: { id: string; onDone: (moved: CompositionDocument) => void }) {
  const { document, onError } = useRows();
  const [query, setQuery] = useState('');
  const targets = useMemo(() => moveTargets(document, id), [document, id]);
  const groups = groupMoveTargets(filterMoveTargets(targets, query));
  // A title two places share (two "Cameras") carries the page or sheet and the containers it sits in, so no two rows read alike.
  const shared = useMemo(() => { const count = new Map<string, number>(); for (const target of targets) count.set(target.label, (count.get(target.label) ?? 0) + 1); return count; }, [targets]);
  const where = (target: MoveTarget) => (shared.get(target.label) ?? 0) > 1 ? [target.where, ...target.trail].filter(Boolean).join(' › ') : target.trail.join(' › ');
  return <div className="w2-move">
    <input type="search" className="w2-move-search" aria-label="Search places" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)}/>
    {groups.length === 0 && <p className="w2-empty">No places match.</p>}
    {groups.map(({ group, targets: list }) => <section key={group} aria-label={group}>
      <h3 className="w2-group-title">{group}</h3>
      <ul className="w2-move-list">{list.map(target => <li key={`${target.parent.kind}:${target.parent.id}:${target.parent.tabId ?? ''}`}>
        <button type="button" className="w2-link-row" onClick={() => { try { onDone(moveNodeTo(document, id, target.parent)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } }}>
          <span>{target.label}</span>{where(target) && <span className="w2-page-via">In {where(target)}</span>}</button></li>)}</ul>
    </section>)}
  </div>;
}

/**
 * Adds a row to the Layout group of what a node already draws there (`extra` of {@link ObjectRows}). A tile grid's own Around the Fold lever is the last generated row, so its Partly Folded
 * row goes ahead of the group's other extras and the two sit together (decision D5 of `studio-duo-sim`).
 */
function withSide(row: ReactNode, extra: Partial<Record<FieldGroup, ReactNode>> | undefined, together = false): Partial<Record<FieldGroup, ReactNode>> | undefined {
  return row === undefined ? extra : { ...extra, look: together ? <>{row}{extra?.look}</> : <>{extra?.look}{row}</> };
}

/** A node's own fields; its child nodes are edited by selecting them. */
const notChildren = (at: EditorPath) => at.at(-1) === 'children';
function NodeBody({ path, placePath, template }: { path: EditorPath; /** For the root of a linked component: the reference's own path, which holds its Width. */ placePath?: EditorPath; /** For a node of a template: the template, and whether this is a place's root. */ template?: TemplateView }) {
  const { document } = useRows();
  const node = valueAt(document, path) as { id: string } | undefined;
  const overrides = useDeepRows(path);
  const choosing = useChoosing() === template?.component.id && template?.edit === true;
  const choose = useChooseRows(document, template?.component, node as CompositionNode | undefined, template?.ws.linked.say, template?.ws.linked.question !== undefined);
  if (!node) return null;
  // A bound control hides the fields its kind does not use: the compiler rejects them.
  const nodeType = String((node as { type?: string }).type);
  // A rule's "when unknown" policy is part of the rule: without one there is nothing to apply it to.
  // The root of a linked component edits the body for everything but its Width, which is this place's own (the reference's `layout.span`).
  // The Tabs list, the Tab Bar group and the Position group draw what these fields hold; a generic row for them would be a second copy.
  // A map draws its Orientation and Map Buttons groups itself: `locate` follows the buttons and `controls` is the list they edit.
  const isMap = nodeType === 'vacuum-control' && (node as { props?: { primitive?: { kind?: string } } }).props?.primitive?.kind === 'map';
  const drawn = (at: EditorPath) => { const rel = at.slice(path.length).join('.'); return (nodeType === 'local-tabs' && (rel === 'tabs' || rel === 'blocks' || rel === 'props.pinned' || rel.startsWith('props.tabBar'))) || (nodeType === 'overlay' && rel.startsWith('props.anchors')) || (nodeType === 'state-tile' && (rel === 'props.progress' || rel === 'props.discs' || rel === 'layout.span' || rel.startsWith('props.swipe'))) || ((nodeType === 'light-group-tile' || nodeType === 'room-overview-tile') && rel.startsWith('props.words')) || (nodeType === 'light-group-tile' && rel.startsWith('props.swipe')) || (nodeType === 'tile-grid' && rel.startsWith('props.groups')) || (nodeType === 'status-pill' && rel === 'props.tone') || (isMap && (rel === 'props.primitive.controls' || rel === 'props.primitive.locate')) || (nodeType === 'bound-control' && (rel === 'props.options' || rel === 'props.optionsFrom' || rel.startsWith('props.optionsFrom.'))); };
  // A dial control draws its own groups (stoppers, between, when released...); a thermostat dial draws its range, and the model owns the rest.
  const dialRel = (at: EditorPath) => at.slice(path.length).join('.');
  const isDialControl = nodeType === 'dial-control', isThermostat = isThermostatDial(node as never);
  const dialDrawn = (at: EditorPath) => (isDialControl && /^(props|action|enabledWhen)(\.|$)/.test(dialRel(at))) || (isThermostat && /^props\.(dial|kind)(\.|$)/.test(dialRel(at)));
  const hidden = (at: EditorPath) => notChildren(at) || drawn(at) || dialDrawn(at) || !boundControlShows(document, path, at) || (at.at(-1) === 'whenUnknown' && !('visibleWhen' in node && node.visibleWhen))
    || (placePath !== undefined && at.length > path.length && at[path.length] === 'layout');
  // A row of a template that is set per place carries its line, and an entity or state row that is not carries "Set Per Place" (Edit); in Use the line is a caption.
  const perPlace = template ? (rel: EditorPath) => {
    const found = valueAt(document, path) as CompositionNode | undefined;
    return found && found.type !== 'component-ref' && rowTarget(document, template.component, found, rel.join('/')) ? <PerPlaceLine document={document} component={template.component} node={found} field={rel.join('/')} readOnly={!template.edit} choosing={choosing}/> : null;
  } : undefined;
  // A group the inspector draws itself stands for one field: it carries the same line, and the same box while fields are chosen.
  const own = (field: string, group: ReactNode): ReactNode => {
    const rel = field.split('/');
    return choosing ? <ChooseRow key={field} choose={choose} rel={rel} below={perPlace?.(rel)}>{group}</ChooseRow> : <>{group}{perPlace?.(rel)}</>;
  };
  const rows = <>
    {isDialControl && <DialControlInspector path={path} own={template ? own : undefined}/>}
    {isThermostat && <ThermostatInspector path={path}/>}
    <ObjectRows path={path} owner={nodeType} skip={hidden} overrides={overrides} below={perPlace} choose={choosing ? choose : undefined} groups={nodeType === 'state-tile' ? ['what', 'look', 'states', 'behaviour'] : isList(nodeType) || nodeType === 'repeat' ? ['what', 'look', 'behaviour', 'states'] : ['what', 'look', 'behaviour']}
      extra={withSide(placePath === undefined ? <FoldSideRow path={path}/> : undefined, nodeType === 'state-tile' ? { what: <>{own('props/progress', <ProgressRow path={path}/>)}{own('props/discs', <ButtonsGroup path={path}/>)}</>, look: own('layout/span', <WidthRow path={path}/>), states: <StatesGroup path={path}/>, behaviour: <><StateTapRow path={path}/>{own('props/swipe', <SwipeRow path={path}/>)}</> } : nodeType === 'light-group-tile' ? { behaviour: own('props/swipe', <SwipeRow path={path}/>), what: own('props/words', <StateWordsFold path={path}/>) } : nodeType === 'room-overview-tile' ? { what: own('props/words', <StateWordsFold path={path}/>) } : nodeType === 'tile-grid' ? { look: own('props/groups', <GroupsRow path={path}/>) } : nodeType === 'status-pill' ? { what: own('props/tone', <ToneField path={path}/>) } : nodeType === 'bound-control' && (node as { props?: { kind?: string } }).props?.kind === 'choice' ? { what: own('props/options', <ChoicesGroup path={path}/>) } : nodeType === 'local-tabs' ? { what: <><TabsList path={path}/>{own('props/tabBar', <TabBarGroup path={path}/>)}</> } : nodeType === 'overlay' ? { what: <OverlayPosition path={path}/> } : isList(nodeType) ? { states: <><ShowStateRow path={path}/><FixedTextsNote path={path}/></> } : nodeType === 'repeat' ? { states: <ShowStateRow path={path}/> } : undefined, nodeType === 'tile-grid')}/>
    {isMap && <><MapOrientation path={path}/><MapButtons path={path}/></>}
    <ChildPosition path={path}/>
  </>;
  // While fields are chosen the boxes form one group, named for what they do.
  const grouped = (content: ReactNode) => choosing ? <div role="group" aria-label="Fields each place sets" className="w2-fields">{content}</div> : content;
  const fields = grouped(rows);
  const width = placePath && <ObjectRows path={placePath} owner="component-ref" skip={at => at.length > placePath.length && at[placePath.length] !== 'layout'} groups={['look']} extra={{ look: <FoldSideRow path={placePath}/> }}/>;
  const advanced = <AdvancedFold type={nodeType} id={node.id} idPath={[...path, 'id'].join('/')} fixed={fixedLine(gatherFixed(document, path), nodeType === 'state-tile' ? 'the motion between states, the 1 second minimum for an in-progress look, haptics and what VoiceOver announces' : undefined)}>
    {grouped(<ObjectRows path={path} owner={nodeType} skip={child => hidden(child) || child.at(-1) === 'id'} overrides={overrides} choose={choosing ? choose : undefined} below={perPlace} groups={['advanced']}/>)}
  </AdvancedFold>;
  // The root of a place (templates spec 3a-B): the place's own settings first, then its Width, then one closed row that holds the template's fields.
  if (template?.root && placePath) {
    const settings = Boolean(template.component.params?.length);
    return <>
      {choosing && <ChooseBar component={template.component}/>}
      {settings && <TemplateSettings ws={template.ws} document={document} component={template.component} refPath={placePath} onError={template.onError}/>}
      {width}
      <TemplateFold id={template.component.id} name={template.component.name} places={componentUses(document, template.component.id).length} hasSettings={settings}>
        <LinkedLine document={document} entry={template.entry} session={template.ws.linked.session} compact/>
        {template.edit && <ChooseFieldsButton document={document} component={template.component} node={node as CompositionNode} path={path}/>}
        {fields}
        {template.edit && <TemplateParameters ws={template.ws} document={document} component={template.component} entry={template.entry} onError={template.onError}/>}
      </TemplateFold>
      {advanced}
    </>;
  }
  return <>{choosing && template && <ChooseBar component={template.component}/>}{fields}{width}{advanced}</>;
}

/** A template's own editor (studio-tpl-ux), opened from its row in the Templates list or from the link badge of a place: Name, its places, Add to Page, the fields of its root, Delete. */
function TemplateEditor({ ws, component, at, onError }: { ws: Workspace2; component: ComponentEntry; at: number; onError: (message: string) => void }) {
  const { document } = useRows();
  const add = useAdd(), push = usePush(), narrow = useNarrow();
  const actions = useTemplateActions(ws);
  const uses = componentUses(document, component.id).length;
  const path: EditorPath = ['componentLibrary', at, 'node'];
  const edit = ws.mode === 'edit';
  const view: TemplateView = { ws, component, entry: { kind: 'node', path, component: component.id } as unknown as IndexEntry, root: false, edit, onError };
  const rename = (name: string) => { try { ws.studio.apply(renameComponent(document, component.id, name)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  return <div className="w2-tpl-editor" data-testid="template-editor">
    <section className="w2-group" aria-label="Template">
      <LabeledRow label="Name"><TextInput label="Name" value={component.name} maxLength={80} disabled={!edit} onCommit={rename}/></LabeledRow>
      <ul className="w2-list w2-tpl-editor-list"><li><button type="button" className="w2-list-row w2-push-row" data-testid="template-uses-row" disabled={uses === 0}
        onClick={() => { if (narrow) push?.push({ title: templateWords.usesTitle, body: <TemplateUsesPage id={component.id}/> }); else ws.setUsesId(component.id); }}>
        <span className="w2-page-text"><span className="w2-page-title">{usesText(uses)}</span></span><ChevronRight size={16} aria-hidden/></button></li></ul>
      <div className="w2-tpl-editor-actions"><button type="button" className="w2-tonal" disabled={!edit} onClick={event => add?.addSaved(component.id, event.currentTarget)}><Plus size={16} aria-hidden/>{templateWords.add}</button></div>
    </section>
    {uses > 1 && <p className="w2-tpl-everywhere"><Link2 size={14} aria-hidden/>{templateWords.everywhere(uses)}</p>}
    {edit && <section className="w2-group w2-tpl-editor-choose"><ChooseFieldsButton document={document} component={component} node={component.node} path={path}/></section>}
    {/* In Use the editor only shows the template: a disabled fieldset keeps every field of its root from writing, so nothing skips the edit question. */}
    <fieldset className="w2-tpl-editor-fields" disabled={!edit}><NodeBody path={path} template={view}/></fieldset>
    {edit && <TemplateParameters ws={ws} document={document} component={component} entry={view.entry} onError={onError}/>}
    <section className="w2-group w2-tpl-editor-foot"><button type="button" className="w2-danger" disabled={!edit} onClick={() => actions.remove(component.id)}>Delete Template…</button></section>
    {actions.dialog}
  </div>;
}

/** The Uses page a phone pushes inside the properties sheet. */
function TemplateUsesPage({ id }: { id: string }) {
  const ws = useContext(TemplateWs)!;
  const [query, setQuery] = useState('');
  const entry = ws.document?.componentLibrary?.find(item => item.id === id);
  if (!entry) return null;
  return <div className="w2-uses-page"><label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder={templateWords.findUses} aria-label={templateWords.findUses} value={query} onChange={event => setQuery(event.target.value)}/></label>
    <TemplateUsesList ws={ws} entry={entry} query={query}/></div>;
}
const TemplateWs = createContext<Workspace2 | undefined>(undefined);

/** What a node of a template needs to draw its fields as the template's: the template, the node's index entry, and whether this is a place's root. */
interface TemplateView { ws: Workspace2; component: ComponentEntry; entry: IndexEntry; root: boolean; edit: boolean; onError: (message: string) => void }

/** The node's More menu: Duplicate, Move Up, Move Down, Move To…, Delete. Move To… pushes a page inside the surface. */
function PropertiesNodeMenu(props: { ws: Workspace2; path: EditorPath; id: string; selectionKey: SelectionKey }) {
  const { onError } = useRows();
  const push = usePush();
  const { id, ...rest } = props;
  // Use changes a field and shows it in the simulator; commands that change the structure stay out of reach until Edit.
  if (props.ws.mode === 'use') return <button type="button" className="w2-icon-button" disabled aria-label="More" title="Switch to Edit to change this."><MoreHorizontal size={18} aria-hidden/></button>;
  return <NodeMenu {...rest} onError={onError} onMoveTo={push ? () => push.push({ title: 'Move To…', body: <MoveToPage id={bodyIdOf(id)} onDone={moved => { props.ws.studio.apply(moved); push.pop(); }}/> }) : undefined}/>;
}

/**
 * The node's More menu. Wide, the selected tile's handle shows it too (without Move To…, which needs the properties page);
 * `onMoveTo` adds that item.
 */
export function NodeMenu({ ws, path, selectionKey, onError, onMoveTo, className = 'w2-icon-button', label = 'More' }: { ws: Workspace2; path: EditorPath; selectionKey: SelectionKey; onError: (message: string) => void; onMoveTo?: () => void; className?: string; /** The button's accessible name: a list of rows names each one's menu. */ label?: string }) {
  const [open, setOpen] = useState(false);
  return <Menu.Root open={open} onOpenChange={setOpen}>
    <Menu.Trigger className={className} aria-label={label}><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      <NodeMenuItems ws={ws} path={path} selectionKey={selectionKey} onError={onError} onMoveTo={onMoveTo}/>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

/**
 * The items of a node's More menu: Add After…, Duplicate, Move Up, Move Down, Move To… (when `onMoveTo` is given) and Delete.
 * One list for the ••• button and for the right-click menu on the simulator, so the two never differ.
 */
export function NodeMenuItems({ ws, path, selectionKey, onError, onMoveTo }: { ws: Workspace2; path: EditorPath; selectionKey: SelectionKey; onError: (message: string) => void; onMoveTo?: () => void }) {
  const document = ws.document!;
  const index = ws.index!;
  const position = Number(path.at(-1)), siblings = (valueAt(document, path.slice(0, -1)) as unknown[]).length;
  const run = (operation: () => void) => { try { operation(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const add = useAdd();
  const entry = index.get(selectionKey);
  // Save as Template… on a node that is not linked and not inside a linked component; Unlink From Template on the root of one (Edit only).
  const saveable = ws.mode === 'edit' && entry?.kind === 'node' && entry.component === undefined && entry.dangling === undefined;
  const unlinkable = ws.mode === 'edit' && entry?.kind === 'node' && entry.bodyPath !== undefined;
  return <>
      {add && <Menu.Item className="w2-menu-item" onClick={() => { const destination = after(document, selectionKey); if (destination) add.open(destination); }}>Add After…</Menu.Item>}
      <Menu.Item className="w2-menu-item" onClick={() => run(() => {
        const copy = duplicateNode(document, path); ws.studio.apply(copy.document);
        const key = buildDocumentIndex(copy.document).keyAt(copy.path); if (key) ws.select(key);
      })}>Duplicate</Menu.Item>
      <Menu.Item className="w2-menu-item" disabled={position === 0} onClick={() => run(() => ws.studio.apply(moveNodeBy(document, path, -1)))}>Move Up</Menu.Item>
      <Menu.Item className="w2-menu-item" disabled={position >= siblings - 1} onClick={() => run(() => ws.studio.apply(moveNodeBy(document, path, 1)))}>Move Down</Menu.Item>
      {onMoveTo && <Menu.Item className="w2-menu-item" onClick={onMoveTo}>Move To…</Menu.Item>}
      {entry?.kind === 'node' && (entry.node?.type === 'state-tile' || (entry.node as { props?: { primitive?: { kind?: string } } })?.props?.primitive?.kind === 'map') && <Menu.Item className="w2-menu-item" onClick={() => run(() => ws.studio.apply(putControlsOnTop(document, path)))}>Put Controls on Top</Menu.Item>}
      {entry?.kind === 'node' && entry.node?.type === 'overlay' && <Menu.Item className="w2-menu-item" onClick={() => run(() => ws.studio.apply(takeOffOverlay(document, path)))}>Take Off the Overlay</Menu.Item>}
      <ChangeListIconItem rowKey={selectionKey}/>
      <Menu.Separator className="w2-menu-sep"/>
      {saveable && <Menu.Item className="w2-menu-item" onClick={() => ws.linked.requestSave(path, selectionKey)}>Save as Template…</Menu.Item>}
      {unlinkable && <Menu.Item className="w2-menu-item" onClick={() => run(() => ws.linked.unlink(path))}>Unlink From Template</Menu.Item>}
      {(saveable || unlinkable) && <Menu.Separator className="w2-menu-sep"/>}
      <Menu.Item className="w2-menu-item w2-danger-item" onClick={() => run(() => {
        ws.studio.apply(deleteNode(document, path));
        const parent = index.ancestors(selectionKey).at(-1);
        ws.select(parent && parent !== index.get(selectionKey)?.surface ? parent : undefined);
      })}>Delete</Menu.Item>
  </>;
}

/**
 * The properties surface's content (spec 5.2), for the card and the sheet alike: a header and a body that depends on
 * what is selected. Depth is a push inside it, never a second surface.
 */
export default function PropertiesPanel({ ws, onClose, onOpenProject, notice, onError }: { ws: Workspace2; onClose: () => void; onOpenProject: (dialog: string) => void; notice?: string; onError: (message: string) => void }) {
  const { document, target, index } = ws;
  const { entities } = useWorkspaceData();
  // Each field a Checks problem names carries its message under it; the edit itself is never held back (see `RowsContext.problems`).
  const problems = useMemo(() => {
    const byField = new Map<string, string>();
    for (const row of ws.checks.problems) if (row.fieldPath && !byField.has(row.fieldPath)) byField.set(row.fieldPath, row.sentence.slice(row.place.length + 2) || row.sentence);
    return byField;
  }, [ws.checks]);
  const ctx = useMemo(() => document ? { document, onChange: ws.studio.apply, onError, problems, onSelect: (key: string) => ws.select(key as never) } : undefined, [document, ws.studio.apply, ws.select, onError, problems]);
  const stateApi = useMemo(() => ({ preview: ws.statePreview, set: ws.setStatePreview }), [ws.statePreview, ws.setStatePreview]);
  // Choosing a template's fields ends when anything else is selected, or in Use (templates spec, "any field": Moving).
  const choosingId = useChoosing();
  const selectedTemplate = target?.kind === 'node' ? index?.get(target.key)?.component : undefined;
  useEffect(() => { if (choosingId !== undefined && (ws.mode !== 'edit' || selectedTemplate !== choosingId)) setChoosing(undefined); }, [choosingId, ws.mode, selectedTemplate]);
  if (!document || !ctx || !target || !index) return null;
  /** The words for the surface a node sits on. A level reads through its sheet ("Lights › Demo Room 1"), so the line says where it is; the full text is the line's title. */
  const surfaceTitle = (key?: string) => {
    const [kind, ...rest] = (key ?? '').split(':'), id = rest.join(':');
    const title = (kind === 'page' ? document.pages : kind === 'level' ? document.levels ?? [] : document.modals).find(item => item.id === id)?.title ?? '';
    return kind === 'level' ? [...levelCrumbs(document, ws.surface, id).map(crumb => crumb.title), title].join(` ${CRUMB_SEPARATOR} `) : title;
  };
  let header: ReactNode, body: ReactNode, title = '';
  if (target.kind === 'node') {
    const entry = index.get(target.key)!, node = entry.node!;
    const named = entry.bodyPath !== undefined ? document.componentLibrary?.find(item => item.id === entry.component) : undefined;
    // A place's header (templates spec 3a-B): its Name setting, else the template's name; the line says which template, then where.
    const hasName = named?.bindings?.some(binding => binding.nodeId === named.node.id && binding.field === 'title');
    title = named && !hasName ? named.name : node.title;
    const section = index.ancestors(target.key).map(key => index.get(key)?.node).filter(Boolean).reverse().find(item => item?.type === 'section' || item?.type === 'tile-grid' || item?.type === 'status-rail' || item?.type === 'room-section');
    const hidden = 'visibleWhen' in node && node.visibleWhen;
    header = <Header onClose={onClose} icon={(node as { icon?: { name: string } }).icon?.name ?? 'grid'} title={title}
      line={`${named ? (hasName ? named.name : 'Template') : typeName(node)} · ${surfaceTitle(entry.surface)}${section ? ` › ${section.title}` : ''}`}
      tags={hidden ? <Tag><EyeOff size={12} aria-hidden/> Hidden by Rule</Tag> : undefined}
      more={<PropertiesNodeMenu ws={ws} path={entry.path} id={node.id} selectionKey={target.key}/>}/>;
    const component = entry.component !== undefined ? document.componentLibrary?.find(item => item.id === entry.component) : undefined;
    const root = entry.bodyPath !== undefined;
    const view: TemplateView | undefined = component ? { ws, component, entry, root, edit: ws.mode === 'edit', onError } : undefined;
    body = <>{component && !root && <><LinkedLine document={document} entry={entry} session={ws.linked.session}/><ComponentParams ws={ws} document={document} entry={entry} onError={onError}/></>}<NodeBody path={entry.bodyPath ?? entry.path} placePath={entry.bodyPath ? entry.path : undefined} template={view}/></>;
  } else if (target.kind === 'page' || target.kind === 'modal' || target.kind === 'level') {
    const entry = index.get(target.key)!;
    const surface = valueAt(document, entry.path) as { title: string; icon: { name: string } };
    title = surface.title;
    const where = target.kind === 'level' ? levelCrumbs(document, ws.surface, entry.id).map(crumb => crumb.title) : [];
    header = <Header onClose={onClose} icon={surface.icon.name} title={surface.title} line={target.kind === 'page' ? 'Page settings' : target.kind === 'level' ? ['Level settings', ...(where.length ? [where.join(` ${CRUMB_SEPARATOR} `)] : [])].join(' · ') : 'Sheet settings'}/>;
    body = <SurfaceSettings ws={ws} kind={target.kind} path={entry.path} onGo={ws.selectAnywhere}/>;
  } else if (target.kind === 'tabs') {
    title = 'Tabs';
    header = <Header onClose={onClose} icon="layers" title="Tabs" line="Tab bar"/>;
    body = <TabsPanel selectedTab={target.key?.startsWith('tab:') ? target.key.slice(4) : undefined}/>;
  } else if (target.kind === 'area') {
    const entry = index.get(target.key)!, parent = entry.parent ? index.get(entry.parent) : undefined;
    const areaId = target.key.split('/').at(-1) ?? '';
    const label = (valueAt(document, entry.path) as { label?: string } | undefined)?.label ?? (entry.shared ? 'Shared Area' : 'Tab Area');
    title = label;
    header = <Header onClose={onClose} icon="square-dashed" title={label} line={`Area · ${parent?.node?.title ?? 'Tabs'}`}/>;
    body = parent ? <AreaInspector tabsPath={parent.path} areaPath={entry.path} areaId={areaId}/> : null;
  } else if (target.kind === 'flow') {
    const flow = flowById(document, target.id);
    title = flow?.inputs.title ?? 'Data Flow';
    const uses = usedCount(document, target.id);
    header = <Header onClose={onClose} icon="activity" title={title} line={`Data Flow · ${uses > 0 ? `Used by ${uses}` : 'Not Used'}`} more={<FlowMenu ws={ws} id={target.id} onError={onError}/>}/>;
    body = <FlowEditor ws={ws} id={target.id}/>;
  } else if (target.kind === 'template') {
    const at = document.componentLibrary!.findIndex(item => item.id === target.id), component = document.componentLibrary![at];
    const uses = componentUses(document, component.id).length;
    title = component.name;
    header = <Header onClose={onClose} icon={(component.node as { icon?: { name: string } }).icon?.name ?? 'grid'} title={title} line={templateWords.editorLine(uses)} more={<button type="button" className="w2-primary w2-done" onClick={onClose}>Done</button>}/>;
    body = <TemplateEditor ws={ws} component={component} at={at} onError={onError}/>;
  } else if (target.kind === 'logic') {
    const entry = entryOf(document, target.id)!;
    const uses = useCount(document, target.id);
    title = entry.name;
    header = <Header onClose={onClose} icon="sliders" title={title} line={`${logicWords.editorTitle} · ${kindWord(entry)} · ${logicWords.usedByLong(uses)}`} more={<button type="button" className="w2-primary w2-done" onClick={onClose}>Done</button>}/>;
    body = <LogicEditor ws={ws} id={target.id}/>;
  } else if (target.kind === 'source') {
    const source = document.dataSources.find(item => item.id === target.id)!;
    const uses = usedCount(document, target.id);
    title = sourceName(source, new Map(entities.map(row => [row.entityId, row.name])));
    header = <Header onClose={onClose} icon="activity" title={title} line={`Source · ${uses > 0 ? `Used by ${uses}` : 'Not Used'}`}/>;
    body = <SourceFields id={target.id}/>;
  } else if (target.kind === 'repeat') {
    const cls = ws.repeats.selected;
    title = cls ? pieceText(document, cls) : 'Repeated Piece';
    header = <Header onClose={onClose} icon="grid" title={title} line={cls ? repeatedText(cls.places.length) : ''}/>;
    body = <RepeatProposal ws={ws} onError={onError}/>;
  } else if (target.kind === 'header') {
    title = 'Tabs and header buttons';
    header = <Header onClose={onClose} icon="sliders" title="Tabs and header buttons" line="Used on every page"/>;
    body = <HeaderPanel onGo={ws.selectAnywhere}/>;
  } else if (target.kind === 'styles') {
    title = 'State Styles';
    header = <Header onClose={onClose} icon="sliders" title="State Styles" line="Used by state tiles"/>;
    body = <StylesPanel/>;
  } else {
    title = 'Wallpaper';
    header = <Header onClose={onClose} icon="image" title="Wallpaper" line="Behind every page"/>;
    body = <WallpaperPanel/>;
  }
  const dataActions = { openFlow: ws.openFlow, openLogic: (id: string) => ws.openLogic(id, 'key' in target && target.key ? { key: target.key, title } : undefined) };
  const repeat = target.kind === 'node' ? repeatScopeOf(document, index, target.key) : undefined;
  const logicScope = target.kind === 'logic' ? { entryId: target.id } : undefined;
  return <TemplateWs.Provider value={ws}><LogicScopeProvider value={logicScope}><RepeatScopeProvider scope={repeat}><RowsProvider value={ctx}><DataActionsProvider value={dataActions}><AlertPreviewContext.Provider value={ws.setAlertPreview}><StatePreviewContext.Provider value={stateApi}>
    <PushStack key={`${target.kind}:${'key' in target ? target.key : 'id' in target ? target.id : ''}`} rootTitle={title} rootHeader={<>{header}{notice && <p role="alert" className="w2-notice">{notice}</p>}</>}
      root={<div className="w2-props-body">{body}</div>}/>
  </StatePreviewContext.Provider></AlertPreviewContext.Provider></DataActionsProvider></RowsProvider></RepeatScopeProvider></LogicScopeProvider></TemplateWs.Provider>;
}
