import type { Component, Json } from './types';
import { nativeEntity } from './native-preview';

const strings = (value: Json | undefined): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string') : [];
const state = (states: Json | undefined, id: Json | undefined) => nativeEntity(states, id)?.state;
const available = (value: Json | undefined) => typeof value === 'string' && value !== '' && !['unknown', 'unavailable'].includes(value);

/** Finite imported presentation metadata, never an expression or command interpreter. */
export function nativePresentationVisible(component: Component, states: Json | undefined): boolean {
  const props = component.props;
  if (props.presentation === 'guest-group')
    return (component.children ?? []).some(child => state(states, child.props.entityId) === 'on');
  if (Array.isArray(props.matchStates) || Array.isArray(props.alternateForStates)) {
    if (typeof props.stateEntityId !== 'string') return false;
    const current = state(states, props.stateEntityId);
    if (!available(current)) return false;
    if (strings(props.excludedStates).includes(String(current))) return false;
    if (Array.isArray(props.matchStates) && !strings(props.matchStates).includes(String(current))) return false;
    if (Array.isArray(props.alternateForStates) && strings(props.alternateForStates).includes(String(current))) return false;
  }
  return true;
}

export function nativeRemoteEnabled(component: Component, states: Json | undefined): boolean {
  const id = component.props.remoteMediaEntityId;
  if (typeof id !== 'string') return false;
  const current = state(states, id);
  return available(current) && (component.props.remoteKey === 'power' || !['off', 'standby'].includes(String(current)));
}

export function nativeVacuumPolicy(component: Component, states: Json | undefined) {
  const current = state(states, component.props.entityId);
  const known = typeof component.props.entityId === 'string' && /^vacuum\.[a-z0-9_]+$/.test(component.props.entityId) && available(current);
  const dock = state(states, component.props.dockStatusEntityId);
  // Error reasons and pending-resume policy are not in the current safe state projection.
  const full = known && ['docked', 'idle'].includes(String(current));
  return {
    state: known ? String(current) : undefined,
    available: known,
    full,
    cleaning: current === 'cleaning',
    paused: current === 'paused',
    dockActive: ['cleaning', 'drying'].includes(String(dock)),
  };
}

export function nativeVacuumTabs(component: Component, states: Json | undefined): Component[] {
  const policy = nativeVacuumPolicy(component, states);
  return (component.children ?? []).filter(child => {
    switch (child.props.vacuumTab) {
      case 'controls': return true;
      case 'zones': return policy.full && !!child.children?.length;
      case 'autoClean': return !!child.children?.length;
      case 'more': return policy.full || policy.dockActive && !!child.children?.length;
      case 'info': return !!child.children?.length;
      default: return false;
    }
  });
}

export function nativeModalSubtitle(component: Component, states: Json | undefined): string | undefined {
  const current = state(states, component.props.entityId);
  if (!available(current)) return 'Unavailable';
  const title = String(current).replaceAll('_', ' ').replace(/^\w/, letter => letter.toUpperCase());
  if (component.props.presentation === 'vacuum-sheet') {
    const entity = nativeEntity(states, component.props.entityId);
    const batteryState = state(states, component.props.batteryEntityId);
    const battery = typeof batteryState === 'string' && batteryState.trim() && Number.isFinite(Number(batteryState))
      ? Number(batteryState) : entity?.batteryLevel;
    return `${title}${typeof battery === 'number' && battery >= 0 && battery <= 100 ? ` \u00b7 ${battery}%` : ''}`;
  }
  const app = nativeEntity(states, component.props.entityId)?.appName;
  return !['off', 'standby'].includes(String(current)) && typeof app === 'string' && app.trim() ? `${app} \u00b7 ${title}` : title;
}

export function nativeLocalTabStyle(width: number, accessibility: boolean, hasSymbols: boolean): 'menu' | 'icons' | 'labels' {
  return accessibility ? 'menu' : hasSymbols && width < 600 ? 'icons' : 'labels';
}
