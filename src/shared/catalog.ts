import type { Component, ComponentType } from './types';
import { createId } from './ids';

export const containerTypes: ReadonlySet<ComponentType> = new Set(['section', 'tile-grid', 'list', 'carousel']);
export const nonInteractiveTypes: ReadonlySet<ComponentType> = new Set(['spacer', 'camera-feed']);

export const componentCatalog: {
  type: ComponentType; label: string; description: string; icon: string; category: string;
}[] = [
  { type: 'heading', label: 'Heading', description: 'Introduce a page or group.', icon: 'Type', category: 'Content' },
  { type: 'text', label: 'Text', description: 'Editable supporting copy.', icon: 'AlignLeft', category: 'Content' },
  { type: 'action-tile', label: 'Action tile', description: 'A prominent shortcut or command.', icon: 'Zap', category: 'Controls' },
  { type: 'navigation-tile', label: 'Navigation tile', description: 'Open another page or sheet.', icon: 'ArrowUpRight', category: 'Controls' },
  { type: 'status-chip', label: 'Status chip', description: 'Native two-line status capsule.', icon: 'Activity', category: 'Home' },
  { type: 'weather-summary', label: 'Weather', description: 'Current conditions and temperature.', icon: 'CloudSun', category: 'Home' },
  { type: 'camera-feed', label: 'Camera feed', description: 'A configured camera image preview.', icon: 'Video', category: 'Home' },
  { type: 'camera-button', label: 'Camera button', description: 'Open a camera detail sheet.', icon: 'Camera', category: 'Home' },
  { type: 'tile-grid', label: 'Tile grid', description: 'Arrange child tiles in columns.', icon: 'LayoutGrid', category: 'Layout' },
  { type: 'list', label: 'List', description: 'Display bound records or child rows.', icon: 'List', category: 'Layout' },
  { type: 'carousel', label: 'Carousel', description: 'A paged grid of bound cards.', icon: 'GalleryHorizontal', category: 'Layout' },
  { type: 'section', label: 'Section', description: 'Group related components.', icon: 'Layers', category: 'Layout' },
  { type: 'settings-row', label: 'Settings row', description: 'A labeled setting or destination.', icon: 'Settings', category: 'Settings' },
  { type: 'profile', label: 'Profile', description: 'A configurable household profile.', icon: 'UserRound', category: 'Settings' },
  { type: 'toggle', label: 'Toggle', description: 'Change a boolean preview variable.', icon: 'ToggleRight', category: 'Controls' },
  { type: 'spacer', label: 'Spacer', description: 'Add intentional breathing room.', icon: 'Space', category: 'Layout' },
  { type: 'report-issue', label: 'Report issue', description: 'Queue an issue report locally.', icon: 'Bug', category: 'Support' },
  { type: 'request-feature', label: 'Request feature', description: 'Queue a feature request locally.', icon: 'Lightbulb', category: 'Support' },
  { type: 'progress', label: 'Progress', description: 'Show completion or an active timer.', icon: 'CircleGauge', category: 'Content' },
];

export function createComponent(type: ComponentType): Component {
  const entry = componentCatalog.find((item) => item.type === type);
  if (!entry) throw new Error(`Unknown component type: ${type}`);
  const component: Component = {
    id: createId(type),
    type,
    title: entry.label,
    icon: entry.icon,
    props: {},
  };
  if (containerTypes.has(type)) component.children = [];
  if (type === 'tile-grid') component.props.columns = 2;
  if (type === 'progress') component.props.value = 0.65;
  if (type === 'spacer') component.props.height = 16;
  if (type === 'report-issue' || type === 'request-feature') component.action = { type };
  return component;
}
