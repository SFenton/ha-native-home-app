import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NativeLocalTabs } from './NativeControls';
import { nativeEntity } from './shared/native-preview';
import { nativeModalSubtitle, nativeVacuumPolicy, nativeVacuumTabs } from './shared/native-presentation';
import type { Action, Component, Json } from './shared/types';
import { Icon } from './ui';

type Chrome = { title: string; subtitle?: string; back?: () => void; close?: boolean };
type Props = {
  component: Component; states?: Json; editing: boolean; disabled?: boolean; selection?: string; surfaceActive?: boolean;
  tabStyle?: 'menu' | 'icons' | 'labels'; onAction: (action?: Action) => void; onSelect: (id: string) => void;
  onChrome?: (chrome?: Chrome) => void; renderComponent: (component: Component, disabled: boolean) => ReactNode;
};
const contains = (component: Component, id: string): boolean =>
  component.id === id || (component.children ?? []).some(child => contains(child, id));

export default function NativeVacuum({ component, states, editing, disabled: external, selection, tabStyle, surfaceActive = true,
  onAction, onSelect, onChrome, renderComponent }: Props) {
  const all = component.children ?? [];
  const tabs = editing ? all.filter(child => typeof child.props.vacuumTab === 'string') : nativeVacuumTabs(component, states);
  const policy = nativeVacuumPolicy(component, states);
  const [selected, setSelected] = useState(tabs[0]?.id);
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [pageId, setPageId] = useState<string>();
  const root = useRef<HTMLDivElement>(null), offsets = useRef(new Map<string, number>());
  const editorTab = editing && selection ? tabs.find(tab => contains(tab, selection)) : undefined;
  const editorPage = editing && selection ? all.find(child => child.props.vacuumPage && contains(child, selection)) : undefined;
  const page = editorPage ?? all.find(child => child.id === pageId && child.props.vacuumPage);
  const active = editorTab?.id ?? (tabs.some(tab => tab.id === selected) ? selected : tabs[0]?.id);
  const back = useCallback(() => setPageId(undefined), []);
  const subtitle = nativeModalSubtitle(component, states);
  useEffect(() => {
    if (!surfaceActive) return;
    onChrome?.(page ? { title: page.title, subtitle: page.subtitle, back, close: false }
      : { title: `${component.title} Robot Vacuum`, subtitle, close: true });
    return () => onChrome?.(undefined);
  }, [page?.id, page?.title, page?.subtitle, component.title, subtitle, onChrome, back, surfaceActive]);
  const surface = page?.id ?? active;
  useEffect(() => {
    if (!surfaceActive) return;
    const scroll = root.current?.closest('.native-modal-scroll');
    if (scroll) scroll.scrollTop = surface ? offsets.current.get(surface) ?? 0 : 0;
    return () => { if (scroll && surface) offsets.current.set(surface, scroll.scrollTop); };
  }, [surface, surfaceActive]);
  const navigate = (id: string, child = false) => {
    if (!surfaceActive) return;
    const scroll = root.current?.closest('.native-modal-scroll');
    if (scroll && surface) offsets.current.set(surface, scroll.scrollTop);
    if (child) setPageId(id); else { setPageId(undefined); setSelected(id); }
  };
  const rooms = all.find(child => child.props.vacuumTab === 'zones');
  const selectedRooms = (rooms?.children ?? []).filter(child => roomIds.includes(child.id));
  const disabled = editing || external || !surfaceActive || component.props.disabled === true || component.props.readOnly === true || !policy.available;
  const entityId = typeof component.props.entityId === 'string' ? component.props.entityId : '';
  const features = nativeEntity(states, entityId)?.supportedFeatures;
  const supports = (bit: number) => typeof features === 'number' && (features & bit) === bit;
  const command = (title: string, service: string, bit: number, hint?: string) => <button type="button" disabled={disabled || !supports(bit)}
    title={hint} onClick={() => {
      if (!disabled && supports(bit) && /^vacuum\.[a-z0-9_]+$/.test(entityId))
        onAction({ type: 'service', domain: 'vacuum', service, entityId });
    }}>{title}</button>;
  const target = selectedRooms.length ? selectedRooms.map(room => room.title).join(', ') : 'Full Clean';
  return <div ref={root} className="native-sheet-tabs native-vacuum" data-component-id={component.id}>
    {all.filter(child => typeof child.props.vacuumTab === 'string').map(tab => <div key={tab.id} role="tabpanel" id={`${tab.id}-panel`} aria-label={tab.title}
      hidden={!!page || tab.id !== active} inert={!!page || tab.id !== active} className="native-tab-panel">
      {tab.props.vacuumTab === 'controls' ? <>
        {policy.full && <section className="native-control"><h2>Cleaning Target</h2>
          <button type="button" className="native-vacuum-target" disabled={disabled || !rooms?.children?.length}
            onClick={() => { if (rooms) navigate(rooms.id); }}><span>{target}</span></button>
        </section>}
        {tab.children?.map(child => {
          return <div key={child.id} hidden={!policy.full && !editing} inert={!policy.full && !editing}>
            {renderComponent(child, disabled || child.props.vacuumAction === 'clean' && selectedRooms.length > 0)}
          </div>;
        })}
        {!tab.children?.some(child => child.props.vacuumAction === 'clean') && <p className="native-control-note">No clean script configured.</p>}
        {selectedRooms.length > 0 && <p className="native-control-note">Room selection is preview only.</p>}
        <div className="native-control-actions">
          {policy.cleaning && command('Pause', 'pause', 4)}
          {policy.paused && command('Resume', 'start', 8192)}
          {policy.state && ['cleaning', 'paused', 'returning', 'error'].includes(policy.state)
            && command('Stop', policy.state === 'error' ? 'stop' : 'return_to_base', policy.state === 'error' ? 8 : 16)}
          {command('Dock', 'return_to_base', 16)}
          {command('Locate', 'locate', 512, 'Asks the robot to play a sound.')}
        </div><p className="native-control-note">Asks the robot to play a sound.</p>
        
        <div className="native-control-actions">{all.filter(child => child.props.vacuumPage).map(child =>
          <button type="button" key={child.id} onClick={() => navigate(child.id, true)}>{child.title}</button>)}</div>
      </> : tab.props.vacuumTab === 'zones' ? <>
        <p className="native-control-note">Choose rooms in cleaning order. No selection means Full Clean.</p>
        <div className="native-vacuum-rooms">{tab.children?.map(room => <button type="button" key={room.id}
          data-component-id={room.id} aria-pressed={roomIds.includes(room.id)} disabled={!editing && (disabled || policy.cleaning)}
          onClick={() => {
            if (editing) onSelect(room.id);
            else if (!disabled && !policy.cleaning) setRoomIds(previous => previous.includes(room.id)
              ? previous.filter(id => id !== room.id) : [...previous, room.id]);
          }}><strong>{room.title}</strong><span>{roomIds.includes(room.id) ? roomIds.indexOf(room.id) + 1 : 'Not selected'}</span></button>)}</div>
      </> : <>
        {tab.children?.map(child => {
          const dock = nativeEntity(states, component.props.dockStatusEntityId)?.state;
          const title = child.props.vacuumAction === 'dockClean' && dock === 'cleaning' ? 'Stop Dock Clean'
            : child.props.vacuumAction === 'dockDry' && dock === 'drying' ? 'Stop Mop Drying' : child.title;
          return renderComponent({ ...child, title }, disabled);
        })}
        {tab.subtitle && <p className="native-control-note">{tab.subtitle}</p>}
      </>}
    </div>)}
    {all.filter(child => child.props.vacuumPage).map(child => <div key={child.id} className="native-subpage"
      hidden={page?.id !== child.id} inert={page?.id !== child.id}>
      {!onChrome && page?.id === child.id && <button type="button" onClick={back}>Back</button>}
      <p className="native-control-note">{child.props.vacuumPage === 'area'
        ? 'No map available.'
        : 'No cleaning report.'}</p>
      {renderComponent(child, true)}
    </div>)}
    {!page && <NativeLocalTabs tabs={tabs.map(tab => ({ id: tab.id, title: tab.title, icon: <Icon name={tab.icon} size={22}/> }))}
      active={active} onSelect={id => navigate(id)} style={tabStyle} surfaceActive={surfaceActive}/>}
  </div>;
}
