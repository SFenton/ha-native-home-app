import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { motion, useReducedMotion } from 'motion/react';
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { Activity, BatteryFull, Camera, Check, ChevronLeft, ChevronRight, CircleCheck, GripVertical, Menu, Monitor, RotateCcw, RotateCw, Signal, Smartphone, Tablet, Wifi, X } from 'lucide-react';
import { evaluateCondition, resolveBinding } from './shared/runtime';
import { canShowResidentContent, resolveCollection } from './shared/collection';
import { isSafeUrl } from './shared/urls';
import { nativeEntity, nativeGroupActivity, nativeHelperFill, nativeSummary, record } from './shared/native-preview';
import { duoGeometry, isAccessibilityText, nativeSectionColumns, nativeTileMetrics, placeFoldSections, solveNativeGrid, type TileArrangement } from './shared/native-layout';
import CameraMedia from './CameraMedia';
import { NativeEntityControl, NativeGuestTile, NativeLocalTabs, NativeRemoteKey, NativeRemoteVolume, NativeWeather } from './NativeControls';
import NativeVacuum from './NativeVacuum';
import { nativeLocalTabStyle, nativeModalSubtitle, nativePresentationVisible } from './shared/native-presentation';
import type { Action, Component, Json, LiveActivity, Page, Primitive, StudioDocument } from './shared/types';
import { containers, findComponent, getComponents, getPage, readPath, variantLabels, variants, type Target, type Variant } from './editor';
import { EmptyState, Icon, IconButton } from './ui';
import { apiUrl } from './api';
import { DeviceFrame, fitZoom, useAutoFit } from './preview2/DeviceFrame';
import { owningTabIds } from './shared/navigation';
import { choreLinkPresentation, choreUserId } from './shared/native-chores';
import { ChoresSimulationProvider, NativeChores, useChoreStates } from './NativeChores';
import { InteractionSurface, RowInteractions, SurfaceSearch } from './InteractionControls';
import { collectionKeys, interactionComponents, searchTargets } from './shared/interactions';

export type DeviceKind = 'island' | 'compact-island' | 'notch' | 'ipad' | 'duo';
export const deviceLabels: Record<DeviceKind, string> = { island: 'iPhone · Dynamic Island', 'compact-island': 'iPhone 18 Pro · compact island', notch: 'iPhone · notch', ipad: 'iPad', duo: 'iPhone Duo · fold study' };
export type PreviewSettings = { device: DeviceKind; landscape: boolean; rotation?: number; threeD: boolean; fold: number; yaw: number; pitch: number; zoom: number; autoFit: boolean; contentState: 'ready' | 'loading' | 'error'; appearance: 'document' | StudioDocument['theme']['appearance'] };
export const initialPreview: PreviewSettings = { device: 'island', landscape: false, threeD: false, fold: 180, yaw: -14, pitch: 8, zoom: 85, autoFit: true, contentState: 'ready', appearance: 'document' };
type PageChrome = { title: string; subtitle?: string; back?: () => void; close?: boolean };
type RuntimeContext = { document: StudioDocument; variables: Record<string, Primitive>; entities: Record<string, Primitive>; editing: boolean; selection?: string; onSelect: (id?: string) => void; onAction: (action?: Action) => void; dataModes: Record<string, string>; dataErrors?: Record<string, string>; queryLiveEnabled?: boolean; onEnableQuery?: () => void; onSearchVariable?: (variable: string, value: string) => void; onSearchSubmit?: (sourceId: string) => void; surfaceActive?: boolean; interactionBlocked?: boolean; search?: { query: Primitive | undefined; paths: readonly string[]; targetIds: readonly string[] }; contentState?: PreviewSettings['contentState']; liveDataEnabled?: boolean; layoutWidth?: number; duo?: ReturnType<typeof duoGeometry>; portraitMenu?: boolean; onSubpage?: (id: string) => void; initialTabId?: string; onInitialTab?: (id: string) => void; initialDestinationId?: string; onInitialDestination?: (id: string) => void; onPageChrome?: (chrome?: PageChrome) => void; onFeedback?: (message: string) => void };
type DeviceProps = RuntimeContext & { target: Target; previewPage: string; previewModal?: string; onDismiss: () => void; settings: PreviewSettings; onSettings: (settings: PreviewSettings) => void; onTarget: (target: Target) => void };
const mediaUrl = (value: Json | undefined) => typeof value === 'string' && isSafeUrl(value) ? value : undefined;
const display = (value: unknown) => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

function Media({ component }: { component: Component }) {
  const [failed, setFailed] = useState(false);
  const image = mediaUrl(component.props.imageUrl ?? component.props.src);
  const stream = mediaUrl(component.props.url);
  const label = String(component.props.placeholder ?? 'No camera image. Add a URL in the inspector.');
  if (failed) return <div className="camera-empty"><Camera size={28}/><strong>Media could not be loaded</strong><span>Check the URL and browser format support.</span><button onClick={() => setFailed(false)}>Retry</button></div>;
  if (stream) return <video className="camera-image" aria-label={component.title} src={stream} poster={image} controls playsInline onError={() => setFailed(true)}/>;
  if (image) return <img className="camera-image" alt={component.title} src={image} onError={() => setFailed(true)}/>;
  return <div className="camera-empty"><Camera size={28}/><span>{label}</span></div>;
}
function Avatar({ url, initials }: { url?: string; initials: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="native-avatar">{url && !failed ? <img src={url} alt="" onError={() => setFailed(true)}/> : initials}</span>;
}
function BackgroundImage({ background }: { background: NonNullable<StudioDocument['theme']['background']> }) {
  const [failed, setFailed] = useState(false);
  const image = background.image === '/api/native-wallpaper' ? apiUrl(background.image) : background.image;
  const scrim = [[0, .44], [28, .45], [50, .46], [75, .52], [100, .64]].map(([position, alpha]) => `rgba(0,0,0,${Math.min(.95, alpha * background.dim / .46)}) ${position}%`).join(',');
  return <>{!failed && <div className="native-wallpaper" aria-hidden="true"><img src={image} alt="" style={{ filter: `blur(${background.blur}px) saturate(1.1)` }} onError={() => setFailed(true)}/><div style={{ background: `linear-gradient(${scrim})` }}/></div>}{failed && <div role="status" className="wallpaper-error">Background unavailable. Check the image URL or server connection.</div>}</>;
}
function CanvasGroupDrop({ component }: { component: Component }) {
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({ id: `canvas-inside:${component.id}`, data: { kind: 'inside', componentId: component.id }, disabled: !active });
  return active ? <div ref={setNodeRef} className={`canvas-group-drop ${isOver ? 'over' : ''}`}>Drop inside {component.title}</div> : null;
}
function CanvasPlacement({ component, placement, horizontal, fallback }: { component: Component; placement: 'before' | 'after'; horizontal: boolean; fallback?: boolean }) {
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({
    id: `canvas-${placement}:${component.id}`, data: { kind: 'position', componentId: component.id, placement },
    disabled: !active || active.data.current?.componentId === component.id,
  });
  return active ? <div ref={setNodeRef} className={`canvas-placement ${horizontal ? 'horizontal' : 'vertical'} ${placement} ${isOver || fallback ? 'active' : ''}`} data-drop-placement={placement} data-drop-active={isOver || fallback || undefined}>
    <span className="native-data-status" role={isOver || fallback ? 'status' : undefined}>Drop {placement} {component.title}</span>
  </div> : null;
}
function RuntimeNode({ component, context, columns = 1, layoutStyle }: { component: Component; context: RuntimeContext; columns?: number; layoutStyle?: CSSProperties }) {
  const { document, editing, onSelect, variables, entities } = context;
  const { active, activatorEvent } = useDndContext();
  const keyboardDrag = activatorEvent instanceof KeyboardEvent;
  const reduceEditorMotion = useReducedMotion();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging, isOver, index, data } = useSortable({ id: `canvas:${component.id}`, data: { kind: 'canvas', componentId: component.id, title: component.title, placement: keyboardDrag ? undefined : 'after' }, disabled: !editing, transition: reduceEditorMotion ? null : undefined });
  const activeSortable = active?.data.current?.sortable;
  const fallbackPlacement = keyboardDrag && (activeSortable?.containerId !== data.sortable.containerId || activeSortable?.index > index) ? 'before' : 'after';
  const bound = resolveBinding(component, document);
  const visible = evaluateCondition(component.visibility, variables, entities) && canShowResidentContent(component, document) && nativePresentationVisible(component, bound);
  const choreStates = useChoreStates(bound);
  const entity = nativeEntity(bound, component.props.entityId);
  const nativeBound = typeof component.props.entityId === 'string' && component.binding !== undefined;
  const value = nativeBound ? nativeSummary(component, bound) : display(bound ?? component.props.value);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [recordSelection, setRecordSelection] = useState<string>();
  const [collectionPage, setCollectionPage] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [navigationError, setNavigationError] = useState('');
  const color = component.color ?? document.theme.accent;
  const dataState = context.contentState && context.contentState !== 'ready' ? context.contentState : component.binding ? context.dataModes[component.binding.sourceId] : undefined;
  const loading = Boolean(component.binding && dataState === 'loading');
  const [loadingVisible, setLoadingVisible] = useState(false);
  useEffect(() => {
    if (!loading) { setLoadingVisible(false); return; }
    const timer = window.setTimeout(() => setLoadingVisible(true), 150);
    return () => window.clearTimeout(timer);
  }, [loading]);
  const enabled = component.props.disabled !== true && (typeof component.props.enabledEntityId !== 'string' || (entities[component.props.enabledEntityId] ?? nativeEntity(bound, component.props.enabledEntityId)?.state) === component.props.enabledState);
  const interactionBlocked = context.interactionBlocked === true || !enabled || loading || dataState === 'error' || component.props.readOnly === true || context.surfaceActive === false;
  const onAction = (action?: Action) => { if (!editing && !interactionBlocked) context.onAction(action); };
  const childContext = { ...context, interactionBlocked, onAction };
  const act = () => {
    if (editing) { onSelect(component.id); return; }
    if (interactionBlocked || (component.props.modeState && entity?.state === component.props.modeState)) return;
    if (typeof component.props.destinationId === 'string') {
      if (context.onSubpage) context.onSubpage(component.props.destinationId);
      else setNavigationError('This destination is outside a configured navigation stack.');
      return;
    }
    if (typeof component.props.initialTabId === 'string') context.onInitialTab?.(component.props.initialTabId);
    if (typeof component.props.initialDestinationId === 'string') context.onInitialDestination?.(component.props.initialDestinationId);
    else context.onInitialDestination?.('');
    if (component.props.confirmation) { setConfirming(true); return; }
    onAction(component.action ?? (component.type === 'toggle' && typeof component.props.variable === 'string' ? { type: 'toggle', variable: component.props.variable } : component.type === 'report-issue' || component.type === 'request-feature' ? { type: component.type } : undefined));
  };
  const profileData = component.type === 'profile' && bound && typeof bound === 'object' && !Array.isArray(bound) ? bound : undefined;
  const choreLink = component.props.choreLink ? choreLinkPresentation(component, document, choreStates) : undefined;
  const title = display(choreLink?.title ?? profileData?.name ?? profileData?.title ?? component.title);
  const occupancyState = component.props.nativeKind === 'climate-room' ? nativeEntity(bound, component.props.occupancyEntityId)?.state : undefined;
  const occupancy = occupancyState === 'on' ? 'Occupied' : occupancyState === 'off' ? 'Not occupied' : occupancyState !== undefined ? 'Occupancy unavailable' : undefined;
  const suppressedState = component.props.suppressNormalState === true && value !== 'Unavailable';
  const subtitle = display(choreLink?.subtitle ?? profileData?.subtitle ?? component.subtitle ?? (nativeBound && component.props.showState !== false && !suppressedState ? `${value}${occupancy !== undefined ? `\n${occupancy}` : ''}` : undefined));
  const copy = <div className="native-copy"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>;
  const glyph = component.icon?.trim() === '' ? null : <span className="native-icon" style={{ '--component-color': color } as CSSProperties}><Icon name={component.icon} size={22}/></span>;
  const buttonProps = { onClick: act, tabIndex: editing ? -1 : 0, disabled: interactionBlocked && !editing };
  if (!editing && (!visible || (component.props.hideWhenEmpty && !component.children?.some(child => evaluateCondition(child.visibility, variables, entities))))) return null;
  const style = { gridColumn: `span ${Math.min(component.layout?.span ?? 1, columns)}`, gridRow: `span ${component.layout?.rows ?? 1}`, '--layout-span': layoutStyle?.gridColumn ?? `span ${Math.min(component.layout?.span ?? 1, columns)}`, '--component-color': color, ...layoutStyle } as CSSProperties;
  const actionOnSurface = !editing && Boolean(component.action && component.action.type !== 'none') && ['heading', 'text', 'status-chip', 'progress'].includes(component.type);
  let body: React.ReactNode;
  switch (component.type) {
    case 'heading':
      body = <div className="native-heading"><h2>{component.title}</h2>{component.subtitle && <p>{component.subtitle}</p>}</div>; break;
    case 'text':
      body = <div className="native-text">{bound !== undefined ? display(bound) : component.props.text !== undefined ? display(component.props.text) : component.title}{component.subtitle && <small>{component.subtitle}</small>}</div>; break;
    case 'section':
    case 'tile-grid':
    case 'list':
    case 'carousel': {
      if (component.props.nativeTodoPage === true || ['todo-items', 'resident-todo-items'].includes(String(component.props.collectionKind))) {
        const sourceId = component.binding?.sourceId ?? component.children?.find(child => child.props.collectionKind === 'todo-items')?.binding?.sourceId;
        const choreDataState = context.contentState && context.contentState !== 'ready' ? context.contentState : sourceId ? context.dataModes[sourceId] : undefined;
        body = <NativeChores component={interactionBlocked ? { ...component, props: { ...component.props, disabled: true } } : component} document={document} dataState={choreDataState} editing={editing || context.surfaceActive === false} entities={entities} variables={variables} search={context.search} onAction={onAction}
          onSelect={onSelect} renderOther={child => <RuntimeNode key={child.id} component={child} context={childContext}/>}/>; break;
      }
      if (component.props.presentation === 'alarm-panel') { body = <NativeAlarmPanel component={component} context={childContext}/>; break; }
      if (component.props.presentation === 'navigation-stack') { body = <NativeNavigationStack component={component} context={childContext}/>; break; }
      if (component.props.presentation === 'tabs') { body = <NativeTabs component={component} context={childContext}/>; break; }
      if (component.props.presentation === 'vacuum-sheet') {
        body = <NativeVacuum component={component} states={bound} editing={editing} selection={context.selection} surfaceActive={context.surfaceActive !== false}
          disabled={interactionBlocked}
          tabStyle={nativeLocalTabStyle(context.layoutWidth ?? 342, isAccessibilityText(document.theme.fontScale), (component.children ?? []).filter(child => child.props.vacuumTab).every(child => !!child.icon))}
          onAction={onAction} onSelect={onSelect} onChrome={context.onPageChrome}
          renderComponent={(child, disabled) => <RuntimeNode key={child.id} component={child} context={{ ...childContext, interactionBlocked: interactionBlocked || disabled }}/>}/>;
        break;
      }
      if (component.props.presentation === 'remote-volume') {
        body = <NativeRemoteVolume component={component} entity={entity} states={bound} editing={editing}
          disabled={interactionBlocked}
          onAction={onAction} renderKey={child => <RuntimeNode key={child.id} component={child} context={childContext}/>}/>;
        break;
      }
      const defaultColumns = component.type === 'tile-grid' || component.type === 'carousel' || (component.type === 'section' && component.children?.length && component.children.every(child => child.type === 'status-chip')) ? 2 : 1;
      const nestedColumns = Math.max(1, Math.min(12, Number(component.props.columns ?? defaultColumns)));
      const filter = context.search?.targetIds.includes(component.id) ? context.search : undefined;
      const records = component.props.presentation === 'guest-group' ? [] : resolveCollection(component, bound, variables, filter);
      let rowKeys: string[] | undefined, rowKeyError: string | undefined;
      if (component.rowActions && !['idle', 'unsaved', 'loading', 'error'].includes(dataState ?? '')) {
        try {
          if (!Array.isArray(bound) || !component.rowActions.keyPath) throw new Error('Row actions need a list and a row key.');
          rowKeys = collectionKeys(bound, component.rowActions.keyPath);
        } catch (reason) { rowKeyError = reason instanceof Error ? reason.message : String(reason); }
      }
      const recordColumns = isAccessibilityText(document.theme.fontScale) ? 1 : nestedColumns;
      const rows = Math.max(1, Math.min(8, Number(component.props.rows ?? 1)));
      const pageSize = recordColumns * rows;
      const pageCount = Math.ceil(records.length / pageSize);
      const currentPage = Math.min(collectionPage, Math.max(0, pageCount - 1));
      const visibleRecords = component.type === 'carousel' ? records.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : records;
      const recordStyle: CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(${recordColumns}, minmax(0, 1fr))`, gap: Number(component.props.gap ?? 10) };
      const children = component.props.presentation === 'state-groups' ? (['active', 'inactive', 'unavailable'] as const).flatMap(state => {
        const children = (component.children ?? []).filter(child => editing || evaluateCondition(child.visibility, variables, entities)).filter(child => nativeGroupActivity(child, resolveBinding(child, document)) === state);
        return children.length ? [{ id: `${component.id}-${state}`, type: 'heading' as const, title: display(component.props[`${state}Title`]), props: {}, layout: { span: 12 } }, ...children] : [];
      }) : component.children;
      body = <div className={`native-group group-${component.type} presentation-${String(component.props.presentation ?? 'plain')} ${component.props.adaptive ? 'adaptive-group' : ''}`} data-rail-layout={component.props.presentation === 'status-rail' ? isAccessibilityText(document.theme.fontScale) ? 'wrap' : 'scroll' : undefined}>{component.title && <div className="native-group-title"><h3>{component.title}</h3>{component.type === 'carousel' && <span>{records.length || component.children?.length || 0}</span>}</div>}{component.subtitle && !['guest-group', 'grouped-settings'].includes(String(component.props.presentation)) && <p className="native-group-subtitle">{component.subtitle}</p>}
        {records.length > 0 && !rowKeyError && <div className={component.type === 'carousel' ? 'native-carousel' : 'native-records'} style={recordStyle}>{visibleRecords.map(({ value: record, sourceIndex }) => {
          const item = record && typeof record === 'object' && !Array.isArray(record) ? record : { title: record };
          const id = rowKeys?.[sourceIndex] ?? display(item.id ?? sourceIndex);
          const title = display(readPath(item, String(component.props.itemTitle ?? 'title')));
          const subtitle = display(readPath(item, String(component.props.itemSubtitle ?? 'subtitle')));
          const isChecked = checked[id] ?? Boolean(item.checked);
          const itemColor = typeof item.color === 'string' ? item.color : color;
          const rowButton = <button key={id} {...buttonProps} className={`${component.type === 'carousel' ? 'category-card' : 'record-row'} ${recordSelection === id ? 'chosen' : ''}`} onClick={() => {
            if (editing) { onSelect(component.id); return; }
            if (interactionBlocked) return;
            if (component.props.showChecks) setChecked(previous => ({ ...previous, [id]: !isChecked }));
            else setRecordSelection(id);
            if (component.action) onAction(component.action);
          }}>{component.props.showChecks ? <span className={`record-check ${isChecked ? 'checked' : ''}`}>{isChecked && <Check size={12}/>}</span> : <span className="record-icon" style={{ color: itemColor, background: `${itemColor}15` }}><Icon name={typeof item.icon === 'string' ? item.icon : component.icon} size={component.type === 'carousel' ? 27 : 18}/></span>}<span className={`record-copy ${isChecked && component.props.showChecks ? 'complete' : ''}`}><strong>{title || display(record)}</strong>{subtitle && <small>{subtitle}{component.type === 'carousel' && component.props.itemSubtitle === 'count' ? ' items' : ''}</small>}</span>{component.type === 'carousel' && recordSelection === id && <CircleCheck size={14}/>}</button>;
          return component.rowActions && rowKeys && !rowKeyError ? <RowInteractions key={id} title={title || id} actions={component.rowActions} accent={document.theme.accent} disabled={editing || interactionBlocked}
            generation={JSON.stringify([document.id, choreUserId(component, document), id, record, visible])} onInvoke={descriptor => { if (descriptor.action.type !== 'todo-row') onAction(descriptor.action); }}>{rowButton}</RowInteractions> : rowButton;
        })}</div>}
        {component.type === 'carousel' && pageCount > 1 && <div className="collection-pagination" aria-label={`${component.title} pagination`}><button disabled={currentPage === 0} onClick={() => setCollectionPage(currentPage - 1)} aria-label="Previous collection page">Previous</button><span aria-live="polite">Page {currentPage + 1} of {pageCount}</span><button disabled={currentPage + 1 >= pageCount} onClick={() => setCollectionPage(currentPage + 1)} aria-label="Next collection page">Next</button></div>}
        {children && children.length > 0 && <NativeComponents components={children} context={childContext} columns={nestedColumns} gap={Number(component.props.gap ?? 12)} adaptive={component.props.adaptive && component.props.presentation !== 'status-rail' ? { minimumWidth: Number(component.props.minimumWidth ?? 150), maximumColumns: Number(component.props.maximumColumns ?? 4), fill: component.props.fill !== false } : undefined}/>}
        {component.subtitle && ['guest-group', 'grouped-settings'].includes(String(component.props.presentation)) && <p className="native-group-footer">{component.subtitle}</p>}
        {rowKeyError && <p className="native-data-error" role="alert">{rowKeyError}</p>}
        {!records.length && !component.children?.length && <div className="native-empty-group" role="status">{component.props.requiredData ? display(component.props.unavailableText ?? 'Unavailable') : filter && typeof filter.query === 'string' && filter.query.trim() ? 'No matching results' : editing ? 'Add child components or bind an array.' : display(component.props.emptyText ?? 'Nothing here yet.')}</div>}
      </div>; break;
    }
    case 'weather-summary': {
      body = <NativeWeather component={component} weather={nativeBound ? entity : record(bound)} editing={editing} onOpen={act}/>; break;
    }
    case 'status-chip': {
      const summary = nativeBound ? value : bound !== undefined && typeof bound !== 'object' ? `${display(bound)}${display(component.props.suffix)}` : display(component.props.value);
      const fill = nativeHelperFill(nativeEntity(bound, component.props.colorEntityId)?.state);
      body = <div className={`native-status tone-${String(component.props.tone ?? 'neutral')}`} style={{ backgroundColor: fill, '--chip-radius': `${Math.max(48, 40 * document.theme.fontScale + 8) / 2}px` } as CSSProperties} data-state={display(entity?.state)}>{glyph}<div><small>{component.title}</small><strong>{summary || component.subtitle || '—'}</strong></div></div>; break;
    }
    case 'action-tile':
    case 'navigation-tile':
    case 'camera-button': {
      if (component.props.presentation === 'guest-toggle') {
        body = <NativeGuestTile component={component} entity={entity} editing={editing}
          disabled={interactionBlocked}
          onAction={onAction} onSelect={() => onSelect(component.id)}/>; break;
      }
      if (component.props.presentation === 'remote-key') {
        body = <NativeRemoteKey component={component} states={bound} editing={editing}
          disabled={interactionBlocked}
          onAction={onAction} onSelect={() => onSelect(component.id)}/>; break;
      }
      if (component.props.presentation === 'control') { body = <NativeEntityControl component={component} entity={entity} editing={editing} disabled={interactionBlocked} onAction={onAction} onOpen={act} onSelect={() => onSelect(component.id)}/>; break; }
      const rawArrangement = String(component.props.arrangement ?? (component.type === 'navigation-tile' ? 'anchored-bottom' : 'row'));
      const arrangement: TileArrangement = rawArrangement === 'anchored-bottom' || rawArrangement === 'centered-stack' || rawArrangement === 'stacked-top' ? rawArrangement : 'row';
      const metrics = nativeTileMetrics(arrangement, document.theme.fontScale, component.type === 'navigation-tile');
      const tileClass = `native-tile tile-${component.type} arrangement-${metrics.arrangement}`;
      const fill = nativeHelperFill(nativeEntity(bound, component.props.colorEntityId)?.state);
      const tileStyle = { minHeight: metrics.minimumHeight, backgroundColor: fill, '--native-ink': fill ? 'white' : undefined, '--native-secondary': fill ? '#ebebf5ad' : undefined, '--title-reserve': metrics.titleReserve === undefined ? undefined : `${metrics.titleReserve}px` } as CSSProperties;
      const spokenState = suppressedState ? `${title}, ${value}` : undefined;
      const content = <>{glyph}{(component.action?.type === 'navigate' || component.action?.type === 'modal' || component.props.destinationId) && <span className="tile-arrow"><ChevronRight size={15}/></span>}{copy}</>;
      body = component.type === 'camera-button' && component.props.presentation === 'camera-card'
        ? <div className="native-camera-card">{typeof component.props.entityId === 'string' && component.props.entityId ? <CameraMedia entityId={component.props.entityId} enabled={context.liveDataEnabled === true} aspectRatio={Number(component.props.aspectRatio ?? 16 / 9)}/> : <Camera size={28}/>}<button {...buttonProps} className="native-camera-open" aria-label={`Open ${component.title}`}/><span>{component.title}</span></div>
        : component.props.readOnly || (nativeBound && !component.action && !component.props.destinationId)
          ? <div className={tileClass} style={tileStyle} aria-label={spokenState}>{content}</div>
          : <button {...buttonProps} className={tileClass} style={tileStyle} aria-label={spokenState} aria-pressed={typeof component.props.modeState === 'string' ? entity?.state === component.props.modeState : undefined}>{content}</button>;
      break;
    }
    case 'settings-row':
    case 'report-issue':
    case 'request-feature':
      body = component.props.readOnly ? <div className="native-settings-row">{glyph}{copy}</div> : <button {...buttonProps} className="native-settings-row">{glyph}{copy}{!nativeBound && (bound !== undefined || component.props.value !== undefined) && <span className="setting-value">{value}</span>}{!enabled && <small>{display(component.props.disabledMessage)}</small>}{(component.action || component.props.destinationId) && <ChevronRight size={15}/>}</button>; break;
    case 'profile': {
      const avatar = mediaUrl(profileData?.avatarUrl ?? component.props.avatarUrl);
      const profile = <><Avatar key={avatar} url={avatar} initials={display(profileData?.initials ?? component.props.initials) || title.split(' ').map(word => word[0]).slice(0, 2).join('')}/>{copy}</>;
      body = component.props.presentation === 'summary'
        ? <div className="native-profile profile-summary" aria-label={title}>{profile}</div>
        : <button {...buttonProps} className="native-profile">{profile}<ChevronRight size={16}/></button>; break;
    }
    case 'toggle': {
      const variable = typeof component.props.variable === 'string' ? component.props.variable : component.action?.type === 'toggle' ? component.action.variable : '';
      body = <button {...buttonProps} role="switch" aria-label={component.title} aria-checked={Boolean(variables[variable])} className="native-toggle">{glyph}{copy}<span className={`native-switch ${variables[variable] ? 'on' : ''}`}/></button>; break;
    }
    case 'progress': {
      const value = Math.max(0, Math.min(1, Number(typeof bound === 'number' ? bound : component.props.value ?? 0)));
      body = <div className="native-progress">{component.icon && glyph}<div>{copy}<div className="native-progress-bar" role="progressbar" aria-label={component.title} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value * 100}%` }}/></div></div><b>{Math.round(value * 100)}{display(component.props.suffix ?? '%')}</b></div>; break;
    }
    case 'camera-feed': {
      const mediaProps = { ...component.props };
      if (typeof bound === 'string') mediaProps.imageUrl = bound;
      else if (bound && typeof bound === 'object' && !Array.isArray(bound)) {
        if (typeof bound.imageUrl === 'string') mediaProps.imageUrl = bound.imageUrl;
        if (typeof bound.url === 'string') mediaProps.url = bound.url;
      }
      const mediaComponent = { ...component, props: mediaProps };
      const nativeCamera = typeof component.props.entityId === 'string' && component.props.entityId.startsWith('camera.');
      const legacyViewer = nativeCamera && component.props.viewer === undefined && component.props.controls === undefined;
      const controls: Array<'snapshot' | 'sound' | 'record'> = Array.isArray(component.props.controls) ? component.props.controls.filter((control): control is 'snapshot' | 'sound' | 'record' => control === 'snapshot' || control === 'sound' || control === 'record') : legacyViewer ? ['snapshot', 'sound'] : [];
      body = <div className={`native-camera ${nativeCamera ? 'native-camera-viewer' : ''}`} style={{ aspectRatio: !nativeCamera && typeof component.props.aspectRatio === 'number' ? component.props.aspectRatio : undefined }}>{!nativeCamera && <div className="camera-label"><strong>{component.title}</strong></div>}{nativeCamera ? <CameraMedia entityId={String(component.props.entityId)} enabled={context.liveDataEnabled === true} viewer={component.props.viewer !== false} aspectRatio={Number(component.props.aspectRatio ?? 16 / 9)} controls={controls} onFeedback={context.onFeedback}/> : <Media key={`${component.id}:${display(mediaProps.imageUrl)}:${display(mediaProps.url)}`} component={mediaComponent}/>}</div>; break;
    }
    case 'spacer':
      body = <div className={`native-spacer ${editing ? 'editing' : ''}`} style={{ minHeight: Number(component.props.height ?? 16) }}>{editing && <span>Spacer · {Number(component.props.height ?? 16)}px</span>}</div>; break;
  }
  return <div ref={setNodeRef} style={style}
    className={`native-node node-${component.type} fold-${String(component.props.foldRegion ?? 'leading')} ${loadingVisible ? 'native-loading' : ''} ${editing ? 'editable-node' : ''} ${isDragging ? 'canvas-dragging' : ''} ${isOver && !isDragging ? 'canvas-drop-target' : ''} ${actionOnSurface ? 'surface-action' : ''} ${context.selection === component.id && editing ? 'is-selected' : ''} ${!visible ? 'condition-hidden' : ''}`}
    data-component-id={component.id} data-presentation={typeof component.props.presentation === 'string' ? component.props.presentation : undefined} aria-busy={loading} role={editing || actionOnSurface ? 'button' : undefined}
    aria-label={editing ? `Select ${component.title || component.type}` : actionOnSurface ? component.title : undefined}
    tabIndex={editing || actionOnSurface ? 0 : undefined}
    onMouseDown={editing ? event => {
      const element = event.target;
      if (!(element instanceof Element)) return;
      if (element.closest('[data-component-id]')?.getAttribute('data-component-id') !== component.id || element.closest('.canvas-drag-handle')) return;
      if (element.matches('.presentation-status-rail > .native-layout')) return;
      if (event.button !== 0) return;
      listeners?.onMouseDown?.(event);
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
      onSelect(component.id);
    } : undefined}
    onTouchStart={editing ? event => {
      const element = event.target;
      if (!(element instanceof Element) || event.touches.length !== 1) return;
      if (element.closest('[data-component-id]')?.getAttribute('data-component-id') !== component.id || element.closest('.canvas-drag-handle')) return;
      if (element.matches('.presentation-status-rail > .native-layout')) return;
      listeners?.onTouchStart?.(event);
      event.stopPropagation();
    } : undefined}
    onClick={actionOnSurface ? act : undefined}
    onClickCapture={editing ? event => { if ((event.target as HTMLElement).closest('[data-component-id]')?.getAttribute('data-component-id') !== component.id) return; event.preventDefault(); event.stopPropagation(); onSelect(component.id); } : undefined}
    onKeyDown={editing || actionOnSurface ? event => { if (event.currentTarget !== event.target) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); act(); } } : undefined}>
    {body}
    {navigationError && <p role="alert">{navigationError}</p>}
    {confirming && <div role="alertdialog" aria-label={display(component.props.confirmation)} className="native-confirmation"><p>{display(component.props.confirmation)}</p><button onClick={() => setConfirming(false)}>Cancel</button><button onClick={() => { setConfirming(false); onAction(component.action); }}>{component.title}</button></div>}
    {loading && <span className="native-data-status" role="status">Loading {component.title}</span>}
    {component.binding && dataState === 'error' && <span className="native-data-status" role="status">Data unavailable · last preview retained</span>}
    {editing && <button ref={setActivatorNodeRef} className="canvas-drag-handle" {...attributes} {...listeners} aria-label={`Drag ${component.title || component.type} on canvas`}><GripVertical size={15}/></button>}
    {editing && !isDragging && <>{(['before', 'after'] as const).map(placement => <CanvasPlacement key={placement} component={component} placement={placement} horizontal={columns > 1 && (component.layout?.span ?? 1) < columns} fallback={placement === fallbackPlacement && isOver}/>)}</>}
    {editing && containers.has(component.type) && <CanvasGroupDrop component={component}/>}
    {editing && context.selection === component.id && <span className="component-selection-label">{component.type}</span>}
    {editing && !visible && <span className="hidden-indicator">Condition hidden</span>}
  </div>;
}
function NativeAlarmPanel({ component, context }: { component: Component; context: RuntimeContext }) {
  const source = resolveBinding(component, context.document);
  const entity = nativeEntity(source, component.props.entityId);
  const [selected, setSelected] = useState<string>();
  useEffect(() => setSelected(undefined), [entity?.state]);
  const state = selected ?? (typeof entity?.state === 'string' ? entity.state : undefined);
  const unavailable = !state || state === 'unavailable' || state === 'unknown';
  const stateTitle = unavailable ? 'Unavailable' : state.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
  const stamp = typeof entity?.lastChanged === 'string' ? new Date(entity.lastChanged) : undefined;
  const since = !selected && stamp && Number.isFinite(stamp.getTime()) ? `Since ${stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : undefined;
  const children = component.children ?? [];
  const localDocument = selected && Array.isArray(source) && component.binding ? {
    ...context.document,
    dataSources: context.document.dataSources.map(item => item.id === component.binding?.sourceId ? { ...item, sample: source.map(item => record(item).entityId === component.props.entityId ? { ...record(item), state: selected } : item) } : item),
  } : context.document;
  return <section className="native-alarm-panel" data-state={state} aria-label={component.title}>
    <div className="native-alarm-state"><span className="native-alarm-badge"><Icon name={unavailable ? 'shield' : state === 'disarmed' ? 'ShieldOff' : 'Shield'} size={24}/></span><div><strong>{stateTitle}</strong><p>{component.title}{since && !unavailable ? ` · ${since}` : ''}</p></div></div>
    <div className="native-alarm-modes" data-unavailable={unavailable}><NativeComponents components={children.map(child => ({ ...child, props: { ...child.props, disabled: unavailable } }))} context={{ ...context, document: localDocument, onAction: action => {
      const mode = children.find(child => child.action === action);
      if (typeof mode?.props.modeState === 'string') setSelected(mode.props.modeState);
      context.onAction(action);
    } }} columns={4} gap={12}/></div>
  </section>;
}
function NativeNavigationStack({ component, context }: { component: Component; context: RuntimeContext }) {
  const children = component.children ?? [], initial = children[0]?.id;
  const requested = children.find(child => child.id === context.initialDestinationId)?.id;
  const initialStack = initial ? requested && requested !== initial ? [initial, requested] : [initial] : [];
  const [stack, setStack] = useState(initialStack);
  const requestedDestination = useRef(requested);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null), offsets = useRef(new Map<string, number>());
  useEffect(() => {
    if (requestedDestination.current === requested) return;
    requestedDestination.current = requested;
    setStack(initial ? requested && requested !== initial ? [initial, requested] : [initial] : []);
    setError('');
  }, [requested, initial]);
  const selection = context.editing ? context.selection : undefined;
  const current = (selection ? children.find(child => child.id === selection || findComponent(child.children ?? [], selection))?.id : undefined) ?? stack.at(-1) ?? initial;
  const navigate = (id: string, back = false) => {
    if (!children.some(child => child.id === id)) { setError(`Subpage "${id}" is not configured.`); return; }
    const scroll = root.current?.closest('.native-modal-scroll');
    if (scroll && current) offsets.current.set(current, scroll.scrollTop);
    setError('');
    setStack(previous => back ? previous.slice(0, -1) : [...previous, id]);
  };
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const previous = stack.at(-2) ?? initial;
  const back = useCallback(() => { if (previous) navigateRef.current(previous, true); }, [previous]);
  const destination = children.find(child => child.id === current);
  useEffect(() => {
    context.onPageChrome?.(current !== initial && destination ? { title: destination.title, subtitle: destination.subtitle, back, close: component.props.childClose === true } : undefined);
    return () => context.onPageChrome?.(undefined);
  }, [current, initial, destination?.title, destination?.subtitle, back, context.onPageChrome, component.props.childClose]);
  useLayoutEffect(() => {
    const scroll = root.current?.closest('.native-modal-scroll');
    if (scroll instanceof HTMLElement && current) { scroll.scrollTop = offsets.current.get(current) ?? 0; updateHeaderProgress(scroll); }
  }, [current]);
  return <div ref={root} className="native-navigation-stack">
    {error && <p role="alert">{error}</p>}
    {!context.onPageChrome && initial && current !== initial && <div className="native-subpage-header"><button aria-label="Back in sheet" onClick={back}><ChevronLeft size={20}/>Back</button><h2>{destination?.title}</h2></div>}
    {children.map(child => <div key={child.id} className="native-subpage" hidden={child.id !== current} inert={child.id !== current}>
      <RuntimeNode component={context.onPageChrome || child.id !== initial ? { ...child, title: '' } : child} context={{ ...context, surfaceActive: context.surfaceActive !== false && child.id === current, editing: context.editing && child.id === current, onSubpage: navigate, onPageChrome: child.id === current ? context.onPageChrome : undefined }}/>
    </div>)}
  </div>;
}
function NativeTabs({ component, context }: { component: Component; context: RuntimeContext }) {
  const allChildren = (component.children ?? []).filter(child => context.editing || canShowResidentContent(child, context.document));
  const children = allChildren.filter(child => context.editing || evaluateCondition(child.visibility, context.variables, context.entities) && nativePresentationVisible(child, resolveBinding(child, context.document)));
  const [selected, setSelected] = useState<string | undefined>(() => children.find(child => child.id === context.initialTabId)?.id ?? children[0]?.id);
  const requestedTab = useRef(context.initialTabId);
  const selection = context.editing ? context.selection : undefined;
  const active = (selection ? children.find(child => child.id === selection || findComponent(child.children ?? [], selection))?.id : undefined) ?? (children.some(child => child.id === selected) ? selected : children[0]?.id);
  const root = useRef<HTMLDivElement>(null), offsets = useRef(new Map<string, number>());
  const select = (id: string) => {
    const scroll = root.current?.closest('.native-modal-scroll');
    if (scroll && active) offsets.current.set(active, scroll.scrollTop);
    setSelected(id);
  };
  useLayoutEffect(() => {
    const scroll = root.current?.closest('.native-modal-scroll');
    if (scroll && active) scroll.scrollTop = offsets.current.get(active) ?? 0;
  }, [active]);
  const remote = component.props.nativeKind === 'remote-sheet';
  const subtitle = remote ? nativeModalSubtitle(component, resolveBinding(component, context.document)) : undefined;
  useEffect(() => {
    if (!remote || context.surfaceActive === false) return;
    context.onPageChrome?.({ title: component.title, subtitle, close: true });
    return () => context.onPageChrome?.(undefined);
  }, [remote, component.title, subtitle, context.surfaceActive, context.onPageChrome]);
  useEffect(() => {
    if (requestedTab.current === context.initialTabId) return;
    requestedTab.current = context.initialTabId;
    if (children.some(child => child.id === context.initialTabId)) setSelected(context.initialTabId);
  }, [context.initialTabId, children]);
  return <div ref={root} className="native-sheet-tabs">
    {allChildren.map(child => <div key={child.id} role="tabpanel" aria-label={child.title} id={`${child.id}-panel`} hidden={child.id !== active} inert={child.id !== active} className="native-tab-panel"><RuntimeNode component={{ ...child, title: '', visibility: undefined }} context={{ ...context, surfaceActive: context.surfaceActive !== false && child.id === active, editing: context.editing && child.id === active, onPageChrome: child.id === active ? context.onPageChrome : undefined }}/></div>)}
    <NativeLocalTabs tabs={children.map(child => ({ id: child.id, title: child.title, icon: <Icon name={child.icon} size={20}/> }))}
      active={active} onSelect={select} title={component.title || 'Sheet sections'} surfaceActive={context.surfaceActive !== false}
      style={nativeLocalTabStyle(context.layoutWidth ?? 342, isAccessibilityText(context.document.theme.fontScale), children.every(child => !!child.icon))}/>
  </div>;
}
export function NativeComponents({ components, context, columns = 1, gap = 12, adaptive, fold }: { components: Component[]; context: RuntimeContext; columns?: number; gap?: number; adaptive?: { minimumWidth: number; maximumColumns?: number; fill?: boolean }; fold?: ReturnType<typeof duoGeometry>['foldColumns'] }) {
  const root = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const shown = components.filter(component => context.editing || (evaluateCondition(component.visibility, context.variables, context.entities) && nativePresentationVisible(component, resolveBinding(component, context.document)) && !(component.props.hideWhenEmpty && !component.children?.some(child => evaluateCondition(child.visibility, context.variables, context.entities) && nativePresentationVisible(child, resolveBinding(child, context.document))))));
  const scale = context.document.theme.fontScale;
  const width = measuredWidth || context.layoutWidth || 342;
  const sectionGrid = adaptive && shown.length > 0 && shown.every(component => component.type === 'section');
  const resolvedGap = sectionGrid ? 24 : gap;
  const layout = adaptive ? solveNativeGrid(width, shown.map(component => ({ span: component.layout?.span, minimumWidth: typeof component.props.minimumWidth === 'number' ? component.props.minimumWidth * scale : undefined })), { ...adaptive, minimumWidth: sectionGrid ? Math.max(340, 340 * scale) : adaptive.minimumWidth * scale, maximumColumns: sectionGrid ? nativeSectionColumns(width, scale) : adaptive.maximumColumns, gap: resolvedGap }) : undefined;
  const resolvedColumns = layout?.columns ?? columns;
  const template = layout?.shared ? layout.placements.map(item => `${item.width}px`).join(' ') : `repeat(${resolvedColumns}, minmax(0, 1fr))`;
  const folded = fold ? placeFoldSections(shown.map(component => ({ side: String(component.props.foldRegion ?? 'leading'), order: typeof component.props.foldOrder === 'number' ? component.props.foldOrder : undefined, height: heights[component.id] ?? 0 })), fold, gap, isAccessibilityText(scale)) : undefined;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const read = () => {
      if (element.clientWidth) setMeasuredWidth(element.clientWidth);
      if (fold) {
        const values = Object.fromEntries([...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement).map(child => [child.dataset.componentId, child.offsetHeight]));
        setHeights(previous => Object.keys(values).length === Object.keys(previous).length && Object.entries(values).every(([id, height]) => previous[id] === height) ? previous : values);
      }
    };
    read();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', read); return () => window.removeEventListener('resize', read); }
    const observer = new ResizeObserver(read);
    observer.observe(element);
    if (fold) [...element.children].forEach(child => observer.observe(child));
    return () => observer.disconnect();
  }, [fold, components]);
  const tallRows = shown.some(component => (component.layout?.rows ?? 1) > 1);
  return <SortableContext items={shown.map(component => `canvas:${component.id}`)} strategy={rectSortingStrategy}><div ref={root} className={`native-layout ${fold ? 'native-fold-layout' : ''}`} data-native-columns={resolvedColumns} style={{ gridTemplateColumns: template, gap: resolvedGap, '--layout-columns': template, '--layout-gap': `${resolvedGap}px`, ...(folded ? { height: folded.height } : {}) } as CSSProperties}>{shown.map((component, index) => {
    const placement = layout?.placements[index], frame = folded?.frames[index];
    const itemWidth = frame?.width ?? placement?.width ?? (width - gap * (resolvedColumns - 1)) / resolvedColumns * Math.min(component.layout?.span ?? 1, resolvedColumns);
    const layoutStyle: CSSProperties | undefined = frame ? { position: 'absolute', left: frame.left, top: frame.top, width: frame.width } : placement ? { gridColumn: layout?.shared ? index + 1 : `${placement.column} / span ${placement.span}`, gridRow: tallRows ? `span ${component.layout?.rows ?? 1}` : `${placement.row} / span ${component.layout?.rows ?? 1}` } : undefined;
    return <RuntimeNode key={component.id} component={component} context={{ ...context, layoutWidth: itemWidth }} columns={resolvedColumns} layoutStyle={layoutStyle}/>;
  })}</div></SortableContext>;
}
function NativePage({ page, context, onBack }: { page: Page; context: RuntimeContext; onBack?: () => void }) {
  const { active, over } = useDndContext();
  const [menu, setMenu] = useState(false);
  const [detail, setDetail] = useState<PageChrome>();
  const title = detail?.title ?? page.title, subtitle = detail?.subtitle ?? page.subtitle;
  const back = detail?.back ?? onBack;
  const surfaceActive = context.surfaceActive !== false;
  const search = page.search?.mode === 'filter' ? { query: context.variables[page.search.queryVariable], paths: page.search.paths, targetIds: searchTargets(page.search, page.components) } : undefined;
  const sourceId = page.search?.mode === 'endpoint' ? page.search.sourceId : undefined;
  const sourceMode = sourceId ? context.dataModes[sourceId] : undefined;
  const endpointLists = sourceId ? interactionComponents(page.components).filter(component => component.type === 'list' && component.binding?.sourceId === sourceId).map(component => resolveBinding(component, context.document)).filter(Array.isArray) : [];
  const searchMode = sourceMode === 'live' && endpointLists.length > 0 && endpointLists.every(items => items.length === 0) ? 'empty' : sourceMode;
  return <InteractionSurface page={page} active={surfaceActive} editing={context.editing} onSelect={() => context.onSelect(undefined)} onAction={context.onAction} trailingInset={context.duo?.trailingControls ? 100 : 16} fontScale={context.document.theme.fontScale} accent={context.document.theme.accent}><header className="native-page-header" data-sheet-child={!!detail?.back} data-sheet-close={detail?.close !== false}><div className="native-toolbar">
    {back && <button className="native-back" aria-label={detail ? 'Back in sheet' : 'Back in app preview'} onClick={back}><ChevronLeft size={20}/><span>Back</span></button>}
    {context.portraitMenu && page.toolbar.length > 0 && <button aria-label="App menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Menu size={20}/></button>}
    {page.toolbar.filter(action => action.placement === 'leading').map(action => <button key={action.id} data-placement="leading" title={action.label} aria-label={action.label} onClick={() => context.editing ? context.onSelect(undefined) : context.onAction(action.action)}><Icon name={action.icon} size={20}/></button>)}
    <span className="native-inline-title" aria-hidden="true">{title}{detail?.subtitle && <small>{detail.subtitle}</small>}</span>
    {page.toolbar.filter(action => action.placement === 'trailing').map(action => <button key={action.id} data-placement="trailing" title={action.label} aria-label={action.label} onClick={() => context.editing ? context.onSelect(undefined) : context.onAction(action.action)}><Icon name={action.icon} size={20}/></button>)}
  </div>{menu && context.portraitMenu && <div className="native-app-menu">{context.document.navigation.tabs.map(tab => <button key={tab.id} onClick={() => { setMenu(false); if (!context.editing) context.onAction({ type: 'navigate', pageId: tab.pageId }); }}>{tab.label}</button>)}</div>}
    <div onClick={() => context.editing && context.onSelect(undefined)} className="native-page-title"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div></header>
    {page.search && <SurfaceSearch search={page.search} document={context.document} variables={context.variables} editing={context.editing} onSelect={() => context.onSelect(undefined)} onVariable={context.onSearchVariable} queryLiveEnabled={context.queryLiveEnabled} onEnable={context.onEnableQuery} onSubmit={context.onSearchSubmit} mode={searchMode} error={sourceId ? context.dataErrors?.[sourceId] : undefined} active={surfaceActive}/>}
    <main className="native-page-content" data-fold-aware={page.layout.foldAware ?? false} style={{ paddingBottom: 'max(24px, var(--interaction-dock-height, 24px))' }}>
      <NativeComponents components={page.components} context={{ ...context, search, onPageChrome: setDetail }} columns={page.layout.columns} gap={page.layout.gap} fold={page.layout.foldAware ? context.duo?.foldColumns : undefined}/>
      {!page.components.length && <EmptyState title={context.editing ? 'Empty page' : 'Nothing here yet'}>{context.editing ? 'Add components from the sidebar.' : 'No content.'}</EmptyState>}
      {context.editing && active && over?.id === 'drop:root' && <div className="canvas-root-drop-cue" role="status">Drop at end of {page.title}</div>}
    </main></InteractionSurface>;
}
function updateHeaderProgress(scroll: HTMLElement) {
  const progress = Math.min(1, Math.max(0, scroll.scrollTop / 52));
  scroll.style.setProperty('--header-progress', String(progress));
}
function NativePageDeck({ page, context, obscured }: { page: Page; context: RuntimeContext; obscured: boolean }) {
  const backRequested = useRef(false);
  const scrollOffsets = useRef(new Map<string, number>());
  const pageElements = useRef(new Map<string, HTMLDivElement>());
  const [navigation, setNavigation] = useState<{ current: string; visited: string[]; stack: string[]; previous?: string; motion: string }>({ current: page.id, visited: [page.id], stack: [page.id], motion: 'none' });
  useLayoutEffect(() => {
    const element = pageElements.current.get(page.id);
    if (element) { element.scrollTop = scrollOffsets.current.get(page.id) ?? 0; updateHeaderProgress(element); }
    const back = backRequested.current;
    backRequested.current = false;
    setNavigation(previous => {
      if (previous.current === page.id) return previous;
      const root = context.document.navigation.tabs.some(tab => tab.pageId === page.id);
      const index = previous.stack.indexOf(page.id);
      return {
        current: page.id, visited: [...new Set([...previous.visited, page.id])],
        stack: root ? [page.id] : index < 0 ? [...previous.stack, page.id] : previous.stack.slice(0, index + 1),
        previous: context.editing ? undefined : previous.current,
        motion: context.editing ? 'none' : back ? 'back' : root ? 'fade' : index < 0 ? 'forward' : 'back',
      };
    });
  }, [page.id, context.editing, context.document.navigation.tabs]);
  useEffect(() => {
    if (!navigation.previous) return;
    const timer = window.setTimeout(() => setNavigation(previous => ({ ...previous, previous: undefined, motion: 'none' })), 300);
    return () => window.clearTimeout(timer);
  }, [navigation.current, navigation.previous]);
  const pages = context.editing ? [page] : [...new Set([...navigation.visited, page.id])].flatMap(id => context.document.pages.filter(item => item.id === id));
  return <>{pages.map(item => {
    const active = item.id === page.id;
    const leaving = item.id === navigation.previous;
    return <div key={item.id} ref={element => { if (element) pageElements.current.set(item.id, element); else pageElements.current.delete(item.id); }} onScroll={event => { if (active) { scrollOffsets.current.set(item.id, event.currentTarget.scrollTop); updateHeaderProgress(event.currentTarget); } }} className={`native-scroll navigation-${navigation.motion} ${active ? 'navigation-enter' : leaving ? 'navigation-exit' : ''}`} data-preview-page={item.id} hidden={!active && !leaving} inert={obscured || !active}>
      <NativePage page={item} context={{ ...context, surfaceActive: context.surfaceActive !== false && active && !obscured, editing: active && !obscured && context.editing, liveDataEnabled: active && !obscured && context.liveDataEnabled }} onBack={active && !context.editing && navigation.stack.length > 1 ? () => { backRequested.current = true; context.onAction({ type: 'navigate', pageId: navigation.stack[navigation.stack.length - 2] }); } : undefined}/>
    </div>;
  })}</>;
}
function ActivityRegion({ activity, variant, context }: { activity: LiveActivity; variant: Variant; context: RuntimeContext }) {
  if (variant === 'compactLeading' || variant === 'compactTrailing') return <div className="activity-island-expanded"><div className={`island-half ${variant === 'compactLeading' ? 'active-variant' : ''}`} inert={context.editing && variant !== 'compactLeading'}><NativeComponents components={activity.variants.compactLeading} context={{ ...context, editing: context.editing && variant === 'compactLeading' }}/></div><div className="island-camera"/><div className={`island-half ${variant === 'compactTrailing' ? 'active-variant' : ''}`} inert={context.editing && variant !== 'compactTrailing'}><NativeComponents components={activity.variants.compactTrailing} context={{ ...context, editing: context.editing && variant === 'compactTrailing' }}/></div></div>;
  return <div className={`activity-region activity-${variant}`}><NativeComponents components={activity.variants[variant]} context={context}/>{!activity.variants[variant].length && <span className="activity-empty">Empty. Add components.</span>}</div>;
}
export default function DevicePreview(props: DeviceProps) {
  const { document, target, settings, onSettings, editing, onTarget } = props;
  const { setNodeRef, isOver } = useDroppable({ id: 'drop:root', data: { kind: 'root' }, disabled: !editing || settings.threeD });
  const screenRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ key: string; image?: string; error?: string }>();
  const [tabOrigin, setTabOrigin] = useState<{ documentId: string; tabId: string }>();
  const orbit = useRef<{ pointerId: number; x: number; y: number; yaw: number; pitch: number } | undefined>(undefined);
  const [orbiting, setOrbiting] = useState(false);
  const canvasRef = useRef<HTMLElement>(null);
  const setCanvasRef = useCallback((element: HTMLElement | null) => { canvasRef.current = element; setNodeRef(element); }, [setNodeRef]);
  const [deviceControls, setDeviceControls] = useState(false);
  const [initialTabId, setInitialTabId] = useState<string>();
  const [initialDestinationId, setInitialDestinationId] = useState<string>();
  const [reduceMotion, setReduceMotion] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [opaqueChrome, setOpaqueChrome] = useState(false);
  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(query?.matches ?? false);
    query?.addEventListener('change', update);
    return () => query?.removeEventListener('change', update);
  }, []);
  const previewPage = document.pages.find(page => page.id === props.previewPage) ?? document.pages.find(page => page.id === document.navigation.initialPageId);
  const page = editing && target.kind !== 'modal' ? getPage(document, target) : previewPage ?? document.pages[0];
  const modal = !editing && props.previewModal ? document.modals.find(modal => modal.id === props.previewModal) : editing && target.kind === 'modal' ? document.modals.find(modal => modal.id === target.id) : undefined;
  const activity = target.kind === 'activity' ? document.liveActivities.find(activity => activity.id === target.id) : undefined;
  const owners = useMemo(() => page ? owningTabIds(document, page.id) : [], [document, page?.id]);
  const activeTab = owners.includes(tabOrigin?.documentId === document.id ? tabOrigin.tabId : '') ? tabOrigin?.tabId : owners[0];
  useEffect(() => {
    if (activeTab && (tabOrigin?.documentId !== document.id || tabOrigin.tabId !== activeTab)) setTabOrigin({ documentId: document.id, tabId: activeTab });
  }, [activeTab, document.id, tabOrigin]);
  const duo = settings.device === 'duo';
  const posture = !duo ? 'standard' : settings.fold <= 15 ? 'closed' : settings.fold >= 165 ? 'open' : 'partial';
  const closedDuo = posture === 'closed';
  const geometry = duo ? duoGeometry(closedDuo ? 'closed' : posture === 'partial' ? 'partial' : 'open', settings.landscape ? 'landscape' : 'portrait') : undefined;
  const width = settings.device === 'ipad' ? (settings.landscape ? 920 : 720) : geometry ? geometry.width + 28 : settings.landscape ? 740 : 374;
  const height = settings.device === 'ipad' ? (settings.landscape ? 660 : 870) : geometry ? geometry.height + 28 : settings.landscape ? 374 : 768;
  const context: RuntimeContext = { ...props, surfaceActive: props.surfaceActive !== false && !settings.threeD, editing: editing && !settings.threeD, contentState: settings.contentState, liveDataEnabled: props.liveDataEnabled === true, duo: geometry, portraitMenu: Boolean(geometry && !geometry.trailingControls), layoutWidth: geometry?.contentWidth ?? width - 60, initialTabId, onInitialTab: setInitialTabId, initialDestinationId, onInitialDestination: setInitialDestinationId };
  const rotation = settings.rotation !== undefined && Boolean(settings.rotation % 180) === settings.landscape ? settings.rotation : settings.landscape ? 90 : 0;
  const rotate = (direction: -1 | 1) => {
    const next = (rotation + direction * 90 + 360) % 360;
    onSettings({ ...settings, rotation: next, landscape: next % 180 !== 0 });
  };
  const screenWidth = width - (settings.device === 'ipad' ? 46 : 28), screenHeight = height - (settings.device === 'ipad' ? 46 : 28);
  const folding = duo && settings.threeD && !closedDuo;
  const zoom = settings.zoom / 100;
  const appearance = settings.appearance && settings.appearance !== 'document' ? settings.appearance : document.theme.appearance;
  const frameKey = `${document.id}:${page?.id}:${modal?.id}:${target.kind}:${target.kind === 'activity' ? target.variant : ''}:${screenWidth}:${screenHeight}:${appearance}:${opaqueChrome}`;
  useEffect(() => {
    if (!folding) { setFrame(undefined); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      if (!screenRef.current) return;
      void import('./preview-frame').then(({ capturePreviewFrame }) => active && screenRef.current ? capturePreviewFrame(screenRef.current) : undefined).then(image => {
        if (active && image) setFrame({ key: frameKey, image });
      }, error => {
        if (active) setFrame({ key: frameKey, error: error instanceof Error ? error.message : 'Frame capture failed.' });
      });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [folding, frameKey, document]);
  const foldedFrame = frame?.key === frameKey ? frame.image : undefined;
  const themeStyle = { '--app-accent': document.theme.accent, '--app-font-scale': document.theme.fontScale, '--duo-sheet-width': geometry ? `${geometry.sheetWidth}px` : undefined } as CSSProperties;
  const renderScreen = () => {
    return <div ref={screenRef} className={`native-app appearance-${appearance} ${opaqueChrome ? 'opaque-chrome' : ''} ${document.theme.background ? 'has-wallpaper' : ''} ${settings.device === 'ipad' ? 'native-ipad' : ''} ${activity ? 'activity-preview-app' : ''}`} style={themeStyle} inert={settings.threeD}>
    {document.theme.background && <BackgroundImage key={document.theme.background.image} background={document.theme.background}/>}
    <div className="native-statusbar"><strong>9:41</strong><span><Signal size={12}/><Wifi size={13}/><BatteryFull size={17}/></span></div>
    {!activity && ['island', 'compact-island'].includes(settings.device) && <div className={`hardware-island ${settings.device === 'compact-island' ? 'compact' : ''}`}/>}
    {settings.device === 'notch' && <div className="hardware-notch"/>}
    {closedDuo && <div className="duo-cover-camera" aria-hidden="true"/>}
    {geometry?.trailingControls && page && !activity && <div className="native-side-actions" inert={Boolean(modal)}>{page.toolbar.map(action => <button key={action.id} aria-label={action.label} onClick={() => context.editing ? context.onSelect(undefined) : context.onAction(action.action)}><Icon name={action.icon} size={22}/></button>)}</div>}
    {activity ? <div className={`activity-scene scene-${target.kind === 'activity' ? target.variant : ''}`}><div className="activity-scene-label"><Activity size={14}/>{activity.name}<span className="sample-badge">sample</span></div>{target.kind === 'activity' && target.variant === 'lockScreen' && <div className="lock-clock"><span>Lock Screen</span><strong>9:41</strong></div>}{target.kind === 'activity' && <ActivityRegion activity={activity} variant={target.variant} context={context}/>}{!activity.enabled && <span className="activity-disabled">Disabled in configuration</span>}</div> : page ? <><NativePageDeck key={`${document.id}:${editing}`} page={page} context={context} obscured={Boolean(modal)}/><nav className="native-tabbar" aria-label="App tabs" inert={Boolean(modal)}>{document.navigation.tabs.map(tab => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => { setTabOrigin({ documentId: document.id, tabId: tab.id }); if (editing) onTarget({ kind: 'page', id: tab.pageId }); else props.onAction({ type: 'navigate', pageId: tab.pageId }); }}><Icon name={tab.icon} size={21}/><span>{tab.label}</span></button>)}</nav></> : null}
    {modal && <div className={`native-modal-backdrop presentation-${modal.presentation}`}><motion.section key={modal.id} initial={reduceMotion || editing ? false : { y: 48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 36, mass: 1 }} role="dialog" aria-modal={false} aria-label={modal.title} className={`native-modal modal-${modal.presentation} detent-${modal.detent} ${modal.components.some(component => component.type === 'camera-feed') ? 'modal-camera' : ''} ${modal.components.some(component => component.type === 'weather-summary') ? 'modal-weather' : ''}`}><div className="modal-grabber"/>{geometry?.trailingControls && <div className="native-sheet-status" aria-hidden="true"><strong>9:41</strong><Wifi size={24}/></div>}<button className="native-modal-close" aria-label="Dismiss app modal" onClick={props.onDismiss}><X size={22}/></button><div className="native-modal-scroll" onScroll={event => updateHeaderProgress(event.currentTarget)}><NativePage key={modal.id} page={modal} context={{ ...context, portraitMenu: false, layoutWidth: (geometry?.sheetWidth ?? width - 48) - 32 - (geometry?.trailingControls ? 83 : 0) }}/></div></motion.section></div>}
    {duo && !closedDuo && <div className={`duo-crease ${posture}`} aria-hidden="true"/>}
    <div className="home-indicator"/>
  </div>;
  };
  const frameRef = useRef<HTMLDivElement>(null);
  const fitDevice = useCallback(() => {
    const canvas = canvasRef.current;
    const zoom = canvas ? fitZoom(canvas, width, height, 80, target.kind === 'activity' ? 290 : 240) : undefined;
    if (zoom !== undefined && (zoom !== settings.zoom || !settings.autoFit)) onSettings({ ...settings, zoom, autoFit: true });
  }, [width, height, target.kind, settings, onSettings]);
  useAutoFit(canvasRef, settings.autoFit, fitDevice);
  const choresIdentityKey = JSON.stringify([document.id, ...document.dataSources.filter(source => (source.kind === 'native-home' && source.endpoint === 'house-profile') || source.id === 'native-profile').map(source => record(source.sample).id)]);
  return <ChoresSimulationProvider identityKey={choresIdentityKey}><section className={`canvas-workspace ${isOver ? 'drop-over' : ''}`} ref={setCanvasRef} aria-label="Device canvas">
    <div className="canvas-stage">
      {target.kind === 'activity' && <div className="activity-variant-switch" aria-label="Activity variant">{variants.map(variant => <button key={variant} className={target.variant === variant ? 'active' : ''} onClick={() => onTarget({ ...target, variant })}>{variantLabels[variant]}</button>)}</div>}
      {target.kind === 'activity' && target.variant !== 'lockScreen' && ['notch', 'ipad'].includes(settings.device) && <p className="canvas-tip">This device has no Dynamic Island.</p>}
      <DeviceFrame width={width} height={height} zoom={zoom} pan={!editing && !settings.threeD} perspective={1300} transform={settings.threeD ? `rotateX(${settings.pitch}deg) rotateY(${settings.yaw}deg)` : ''} frameRef={frameRef}
        stageClassName={`${settings.threeD ? 'is-3d' : ''} ${orbiting ? 'orbiting' : ''}`}
        stageProps={{ tabIndex: settings.threeD ? 0 : undefined, role: settings.threeD ? 'group' : undefined, 'aria-label': settings.threeD ? '3D device. Drag to rotate, or use arrow keys.' : undefined, onPointerDownCapture: event => {
          if (!settings.threeD || event.button !== 0 || !event.isPrimary) return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          orbit.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: settings.yaw, pitch: settings.pitch };
          setOrbiting(true);
        }, onPointerMove: event => {
          const start = orbit.current;
          if (!start || start.pointerId !== event.pointerId) return;
          event.preventDefault(); event.stopPropagation();
          const yaw = ((start.yaw + (event.clientX - start.x) * .45 + 180) % 360 + 360) % 360 - 180;
          const pitch = Math.max(-85, Math.min(85, start.pitch - (event.clientY - start.y) * .45));
          onSettings({ ...settings, yaw: Math.round(yaw), pitch: Math.round(pitch) });
        }, onPointerUp: event => { if (orbit.current?.pointerId === event.pointerId) { orbit.current = undefined; setOrbiting(false); event.currentTarget.releasePointerCapture(event.pointerId); } }, onPointerCancel: () => { orbit.current = undefined; setOrbiting(false); }, onLostPointerCapture: () => { orbit.current = undefined; setOrbiting(false); }, onKeyDown: event => {
          if (!settings.threeD || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          onSettings({ ...settings, yaw: Math.max(-180, Math.min(180, settings.yaw + (event.key === 'ArrowLeft' ? -5 : event.key === 'ArrowRight' ? 5 : 0))), pitch: Math.max(-85, Math.min(85, settings.pitch + (event.key === 'ArrowUp' ? 5 : event.key === 'ArrowDown' ? -5 : 0))) });
        } }}
        modelClassName={`device-${settings.device} posture-${posture} ${folding && foldedFrame ? 'duo-folding' : ''} ${closedDuo ? 'duo-closed' : ''} ${settings.landscape ? 'landscape' : ''}`}
        modelProps={{ 'data-posture': posture, 'data-orientation': String(rotation), 'data-layout': duo && (settings.landscape || closedDuo) ? 'side-controls' : 'bottom-controls' }}
        modelStyle={{ '--fold-angle': `${(180 - settings.fold) / 2}deg` } as CSSProperties}>
        <div className="device-button power"/><div className="device-button volume"/>
        <div className="device-screen">{renderScreen()}</div>
        {folding && foldedFrame && (['leading', 'trailing'] as const).map(side => <div key={side} className={`duo-fold-face ${side}`} aria-hidden="true">
          <img alt="" src={foldedFrame} style={{ width: screenWidth, height: screenHeight, maxWidth: 'none' }}/>
        </div>)}
      </DeviceFrame>
      {settings.threeD && <p className="canvas-tip">Drag to rotate. Switch to Flat to edit.</p>}
      {folding && !foldedFrame && <p className="canvas-tip" role="status">{frame?.key === frameKey && frame.error ? 'Showing the flat view.' : 'Capturing…'}</p>}
      
    </div>
    <div className="device-dock">
      <div className="dock-device"><Icon name={settings.device === 'ipad' ? 'grid' : 'smartphone'} size={15}/><select aria-label="Preview device" value={settings.device} onChange={event => onSettings({ ...settings, device: event.target.value as DeviceKind })}>{Object.entries(deviceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <span className="dock-divider"/>
      <select aria-label="Device theme" value={settings.appearance ?? 'document'} onChange={event => onSettings({ ...settings, appearance: event.target.value as PreviewSettings['appearance'] })}><option value="document">App theme</option><option value="system">System theme</option><option value="light">Light</option><option value="dark">Dark</option></select>
      <button aria-pressed={opaqueChrome} onClick={() => setOpaqueChrome(value => !value)}>Solid bars</button>
      <IconButton label="Rotate device 90 degrees counterclockwise" onClick={() => rotate(-1)}><RotateCcw size={15}/></IconButton>
      <IconButton label="Rotate device 90 degrees clockwise" onClick={() => rotate(1)}><RotateCw size={15}/></IconButton>
      <button className={settings.threeD ? 'dock-active' : ''} onClick={() => onSettings({ ...settings, threeD: !settings.threeD })}>{settings.threeD ? '3D' : 'Flat'}</button>
      <button className={deviceControls ? 'dock-active' : ''} onClick={() => setDeviceControls(!deviceControls)} aria-expanded={deviceControls}>More</button>
      <span className="dock-divider"/><button onClick={fitDevice}>Fit</button>
      <button aria-label="Zoom out" disabled={settings.zoom <= 25} onClick={() => onSettings({ ...settings, zoom: Math.max(25, settings.zoom - 5), autoFit: false })}>−</button>
      <button className="zoom-label" aria-label="Reset preview zoom to 100 percent" onClick={() => onSettings({ ...settings, zoom: 100, autoFit: false })}>{settings.zoom}%</button>
      <button aria-label="Zoom in" disabled={settings.zoom >= 120} onClick={() => onSettings({ ...settings, zoom: Math.min(120, settings.zoom + 5), autoFit: false })}>+</button>
    {deviceControls && <div className="device-controls">
      <label>Data state <select aria-label="Preview data state" value={settings.contentState} onChange={event => onSettings({ ...settings, contentState: event.target.value as PreviewSettings['contentState'] })}><option value="ready">Ready</option><option value="loading">Loading</option><option value="error">Unavailable</option></select></label>
      {duo && <><div className="posture-presets" aria-label="Duo posture">{([['Closed', 0], ['Partial', 90], ['Open', 180]] as const).map(([label, fold]) => <button key={label} aria-pressed={posture === label.toLowerCase()} onClick={() => onSettings({ ...settings, fold })}>{label}</button>)}</div>
        <label>Fold angle <input aria-label="Fold angle" type="range" min={0} max={180} value={settings.fold} onChange={event => onSettings({ ...settings, fold: Number(event.target.value), threeD: true })}/><output>{settings.fold}°</output></label></>}
      {settings.threeD && <><label>Yaw <input aria-label="Device yaw" type="range" min={-180} max={180} value={settings.yaw} onChange={event => onSettings({ ...settings, yaw: Number(event.target.value) })}/><output>{settings.yaw}°</output></label>
        <label>Pitch <input aria-label="Device pitch" type="range" min={-85} max={85} value={settings.pitch} onChange={event => onSettings({ ...settings, pitch: Number(event.target.value) })}/><output>{settings.pitch}°</output></label></>}
      
      <button onClick={() => onSettings({ ...initialPreview, device: settings.device })}>Reset view</button>
    </div>}
    </div>
  </section></ChoresSimulationProvider>;
}
