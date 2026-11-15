import { useId, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import { ArrowLeft, Eye, Layers, Plus, SlidersHorizontal, X } from 'lucide-react';
import type { WorkspaceView } from './Sidebar';
import { IconButton } from './ui';

export type EditorPane = 'project' | 'preview' | 'inspect';
export type EditorLayout = 'compact' | 'intermediate' | 'wide';
export type MobileWorkspaceHandle = {
  showPane: (pane: EditorPane) => void;
  closeInspector: () => void;
  toggleInspector: () => void;
};
export type MobileWorkspaceProps = {
  ref?: Ref<MobileWorkspaceHandle>;
  project: ReactNode;
  preview: ReactNode;
  inspector: ReactNode;
  panels: Record<Exclude<WorkspaceView, 'design'>, ReactNode>;
  toolbar: ReactNode;
  status: ReactNode;
  notices?: ReactNode;
  activity?: ReactNode;
  insert: ReactNode;
  view: WorkspaceView;
  onView: (view: WorkspaceView) => void;
  editing: boolean;
  dragging: boolean;
  inspectorVisible: boolean;
  onInspectorVisible: (visible: boolean) => void;
  onPaneChange?: (pane: EditorPane) => void;
};

export function editorLayout(width: number): EditorLayout {
  return width <= 700 ? 'compact' : width < 1200 ? 'intermediate' : 'wide';
}

function subscribeToWidth(listener: () => void) {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}
const paneNames: Record<EditorPane, string> = { project: 'Project', preview: 'Preview', inspect: 'Inspect' };
const paneIcons = { project: Layers, preview: Eye, inspect: SlidersHorizontal };
const panelNames = { data: 'Data sources', variables: 'Variables & conditions', navigation: 'Navigation & theme' };
const panelViews = ['data', 'variables', 'navigation'] as const;
const available = (element: HTMLElement | null | undefined): element is HTMLElement =>
  Boolean(element?.isConnected && !element.closest('[hidden], [inert]') && !element.matches(':disabled'));

export default function MobileWorkspace({ ref, project, preview, inspector, panels, toolbar, status, notices, activity, insert, view, onView, editing, dragging, inspectorVisible, onInspectorVisible, onPaneChange }: MobileWorkspaceProps) {
  const layout = useSyncExternalStore(subscribeToWidth, () => editorLayout(window.innerWidth), () => 'wide' as const);
  const id = useId();
  const [pane, setPane] = useState<EditorPane>('preview');
  const [sidePane, setSidePane] = useState<'project' | 'inspect'>('project');
  const [insertOpen, setInsertOpen] = useState(false);
  const regions = useRef<Partial<Record<EditorPane, HTMLDivElement | null>>>({});
  const lastFocus = useRef<Partial<Record<EditorPane, HTMLElement>>>({});
  const [focusRequest, setFocusRequest] = useState<{ pane: EditorPane | 'insert' }>();
  const focusOwner = useRef<EditorPane | undefined>(undefined);
  const insertButton = useRef<HTMLButtonElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const traySearch = useRef<HTMLDivElement>(null);
  const focusInTray = useRef(false);
  const management = view !== 'design';
  const activePane = management ? 'project' : pane;
  const previousPane = useRef(activePane);
  useLayoutEffect(() => {
    if (previousPane.current !== activePane) onPaneChange?.(activePane);
    previousPane.current = activePane;
  }, [activePane, onPaneChange]);
  const visible = {
    project: management || layout === 'wide' || (layout === 'intermediate' ? sidePane === 'project' : activePane === 'project'),
    preview: !management && (layout !== 'compact' || activePane === 'preview'),
    inspect: !management && (layout === 'wide' ? inspectorVisible : layout === 'intermediate' ? sidePane === 'inspect' : activePane === 'inspect'),
  };
  const trayVisible = insertOpen && visible.preview && editing;

  const showPane = (next: EditorPane) => {
    if (dragging) return;
    if (next !== 'project') onView('design');
    if (next === 'inspect') onInspectorVisible(true);
    if (next !== 'preview') { setSidePane(next); setInsertOpen(false); }
    setPane(next);
    setFocusRequest({ pane: next });
  };
  const closeInspector = () => {
    if (dragging) return;
    onInspectorVisible(false);
    setSidePane('project');
    showPane('preview');
  };
  useImperativeHandle(ref, () => ({
    showPane,
    closeInspector,
    toggleInspector: () => {
      if (visible.inspect) closeInspector();
      else showPane('inspect');
    },
  }));
  const closeInsert = () => {
    if (dragging) return;
    setInsertOpen(false);
    insertButton.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (tray.current?.contains(focused)) focusInTray.current = true;
    if (document.querySelector('dialog[open]')) return;
    const requested = focusRequest?.pane;
    if (focusRequest) setFocusRequest(undefined);
    if (requested === 'insert' && trayVisible) {
      (traySearch.current?.querySelector<HTMLInputElement>('input') ?? tray.current)?.focus({ preventScroll: true });
      return;
    }
    if (requested && requested !== 'insert' && visible[requested]) {
      const previous = lastFocus.current[requested];
      (available(previous) ? previous : regions.current[requested])?.focus({ preventScroll: true });
      return;
    }
    const hiddenPane = (Object.keys(regions.current) as EditorPane[]).find(key => !visible[key] && (regions.current[key]?.contains(focused) || (focused === document.body && focusOwner.current === key)));
    const hiddenControl = focused instanceof HTMLElement && focused.closest('[hidden], [inert]');
    const hiddenPreviousControl = focused === document.body && focusOwner.current && lastFocus.current[focusOwner.current] && !available(lastFocus.current[focusOwner.current]);
    if (hiddenPane || hiddenControl || hiddenPreviousControl || (!trayVisible && focusInTray.current)) {
      focusInTray.current = false;
      const destination = visible[activePane] ? activePane : 'preview';
      regions.current[destination]?.focus({ preventScroll: true });
    }
  });

  useLayoutEffect(() => {
    let frame = 0;
    const revealFocusedField = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement) || !available(focused) || document.querySelector('dialog[open]')) return;
        if (!focused.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
        if (regions.current.project?.contains(focused) || regions.current.inspect?.contains(focused)) {
          focused.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }
      });
    };
    revealFocusedField();
    window.addEventListener('resize', revealFocusedField);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', revealFocusedField); };
  }, [layout, activePane, view]);

  return <section className="mobile-workspace" data-editor-layout={layout} data-editor-active-pane={activePane} data-editor-view={view} data-layout={layout} data-dragging={dragging || undefined} aria-label="Configuration editor" onFocusCapture={event => {
    const focusedPane = (Object.keys(regions.current) as EditorPane[]).find(key => regions.current[key]?.contains(event.target));
    focusOwner.current = focusedPane;
    if (focusedPane) {
      setPane(focusedPane);
      if (focusedPane !== 'preview') setSidePane(focusedPane);
    }
  }} onBlurCapture={event => {
    if (event.relatedTarget instanceof Node && event.relatedTarget !== document.body && !event.currentTarget.contains(event.relatedTarget)) focusOwner.current = undefined;
  }} onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented || dragging || document.querySelector('dialog[open], [role="menu"]')) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], details[open]')) return;
    if (trayVisible) { event.preventDefault(); event.stopPropagation(); closeInsert(); }
    else if (activePane !== 'preview' && layout !== 'wide') {
      event.preventDefault(); event.stopPropagation(); showPane('preview');
    }
  }}>
    <nav className="mobile-pane-nav" aria-label="Editor panes">
      {(['project', 'preview', 'inspect'] as const).map(key => {
        const Glyph = paneIcons[key];
        return <button key={key} type="button" aria-controls={`${id}-${key}`} aria-pressed={activePane === key} data-editor-focus-fallback={key === 'preview' ? '' : undefined} disabled={dragging} onClick={() => showPane(key)}><Glyph size={17} aria-hidden="true"/>{paneNames[key]}</button>;
      })}
      <button ref={insertButton} type="button" className="mobile-insert-toggle" aria-label="Insert" title="Insert components" aria-controls={`${id}-insert`} aria-expanded={trayVisible} disabled={dragging || !editing} onClick={() => {
        if (trayVisible) closeInsert();
        else {
          onView('design'); setPane('preview'); setInsertOpen(true); setFocusRequest({ pane: 'insert' });
        }
      }}><Plus size={17} aria-hidden="true"/><span>Insert</span></button>
    </nav>
    <div className="mobile-workspace-toolbar">{toolbar}</div>
    {notices && <div className="mobile-workspace-notices">{notices}</div>}
    {layout !== 'wide' && activePane !== 'preview' && <div className="mobile-pane-back"><button type="button" disabled={dragging} onClick={() => showPane('preview')}><ArrowLeft size={16} aria-hidden="true"/>Back to preview</button><span>{management ? panelNames[view] : paneNames[activePane]}</span></div>}
    <div className="mobile-pane-grid">
      <div id={`${id}-project`} ref={element => { regions.current.project = element; }} className="mobile-pane mobile-pane-project" data-editor-pane="project" data-tools={management || undefined} role="region" aria-label="Project pane" tabIndex={-1} hidden={!visible.project} inert={!visible.project} onFocusCapture={event => { if (event.target instanceof HTMLElement && event.target !== event.currentTarget) lastFocus.current.project = event.target; }}>
        <div className="mobile-project-browser" hidden={management && layout === 'compact'} inert={management && layout === 'compact'}>{project}</div>
        <div className="mobile-project-tools" hidden={!management} inert={!management}>
          <div className="mobile-tools-heading"><button type="button" onClick={() => { onView('design'); showPane('project'); }}><ArrowLeft size={16} aria-hidden="true"/>Back to project</button></div>
          {panelViews.map(key => <div key={key} className="mobile-management-content" hidden={view !== key} inert={view !== key} aria-label={panelNames[key]}>{panels[key]}</div>)}
        </div>
      </div>
      <div id={`${id}-preview`} ref={element => { regions.current.preview = element; }} className="mobile-pane mobile-pane-preview" data-editor-pane="preview" role="region" aria-label="Preview pane" tabIndex={-1} hidden={!visible.preview} inert={!visible.preview} onFocusCapture={event => { if (event.target instanceof HTMLElement && event.target !== event.currentTarget) lastFocus.current.preview = event.target; }}>
        <div className="mobile-preview-content">{preview}</div>
        <div ref={tray} id={`${id}-insert`} className="mobile-insert-tray" role="region" aria-label="Quick insert components" tabIndex={-1} hidden={!trayVisible} inert={!trayVisible} onFocusCapture={() => { focusInTray.current = true; }} onBlurCapture={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focusInTray.current = false; }}>
          <div className="mobile-insert-heading"><strong>Insert components</strong><span>Tap to add, or drag onto the preview.</span><IconButton label="Close insert tray" disabled={dragging} onClick={closeInsert}><X size={18}/></IconButton></div>
          <div ref={traySearch} className="mobile-insert-library">{insert}</div>
        </div>
      </div>
      <div id={`${id}-inspect`} ref={element => { regions.current.inspect = element; }} className="mobile-pane mobile-pane-inspect" data-editor-pane="inspect" role="region" aria-label="Inspect pane" tabIndex={-1} hidden={!visible.inspect} inert={!visible.inspect} onFocusCapture={event => { if (event.target instanceof HTMLElement && event.target !== event.currentTarget) lastFocus.current.inspect = event.target; }}>{inspector}</div>
    </div>
    {activity}
    <div className="mobile-workspace-status">{status}</div>
  </section>;
}
