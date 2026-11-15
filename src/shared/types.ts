export type Primitive = string | number | boolean | null;
export type Json = Primitive | Json[] | { [key: string]: Json };
export type ComponentType =
  | 'heading' | 'text' | 'action-tile' | 'navigation-tile' | 'status-chip'
  | 'camera-feed' | 'camera-button' | 'tile-grid' | 'list' | 'carousel'
  | 'section' | 'settings-row' | 'profile' | 'toggle' | 'spacer'
  | 'report-issue' | 'request-feature' | 'progress' | 'weather-summary';

export type Action =
  | { type: 'none' }
  | { type: 'navigate'; pageId: string }
  | { type: 'modal'; modalId: string }
  | { type: 'dismiss' }
  | { type: 'toggle'; variable: string }
  | { type: 'set'; variable: string; value: Primitive }
  | { type: 'service'; domain: string; service: string; entityId: string; data?: Record<string, Json> }
  | { type: 'url'; url: string }
  | { type: 'report-issue' }
  | { type: 'request-feature' };

export interface Condition {
  source: 'variable' | 'entity';
  key: string;
  operator: 'equals' | 'not-equals' | 'truthy' | 'greater-than' | 'less-than';
  value?: Primitive;
}

export interface Component {
  id: string;
  type: ComponentType;
  title: string;
  subtitle?: string;
  icon?: string;
  color?: string;
  props: Record<string, Json>;
  action?: Action;
  visibility?: Condition;
  binding?: { sourceId: string; path?: string };
  layout?: { span?: number; rows?: number };
  children?: Component[];
  rowActions?: RowActions;
}

export interface ChromeAction {
  id: string;
  label: string;
  icon: string;
  placement: 'leading' | 'trailing';
  action: Action;
}

export type TodoAddIntent = { type: 'todo-add'; componentId: string };
export type TodoRowIntent = { type: 'todo-row'; operation: 'toggle' | 'edit' | 'delete' };
export type FloatingButton = Pick<ChromeAction, 'id' | 'label' | 'icon'> & {
  color?: string;
  action: Action | TodoAddIntent;
};
export interface ActionConfirmation {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
}
export type RowSwipeAction = Pick<ChromeAction, 'id' | 'label' | 'icon'> & {
  color?: string;
  action: Action | TodoRowIntent;
  completedLabel?: string;
  fullSwipe?: boolean;
  confirmation?: ActionConfirmation;
};
export interface RowActions {
  keyPath?: string;
  leading: RowSwipeAction[];
  trailing: RowSwipeAction[];
}
export type PageSearch = { id: string; label: string; placeholder: string } & (
  | { mode: 'filter'; queryVariable: string; targetComponentIds: string[]; paths: string[] }
  | { mode: 'endpoint'; sourceId: string }
);

export interface Page {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  layout: { columns: number; gap: number; foldAware?: boolean };
  components: Component[];
  toolbar: ChromeAction[];
  floatingButtons?: FloatingButton[];
  search?: PageSearch;
}

export interface Modal extends Page {
  presentation: 'sheet' | 'fullscreen' | 'alert';
  detent: 'medium' | 'large';
}

export interface Tab {
  id: string;
  label: string;
  icon: string;
  pageId: string;
}

export interface DataSource {
  id: string;
  name: string;
  kind: 'static' | 'ha-state' | 'native-home' | 'endpoint';
  endpoint?: string;
  queryVariable?: string;
  entityId?: string;
  refreshSeconds: number;
  sample: Json;
}

export interface LiveActivity {
  id: string;
  name: string;
  enabled: boolean;
  attributes: Record<string, Primitive>;
  variants: {
    lockScreen: Component[];
    compactLeading: Component[];
    compactTrailing: Component[];
    minimal: Component[];
    expanded: Component[];
  };
}

export interface StudioDocument {
  schemaVersion: '1.0';
  id: string;
  name: string;
  theme: {
    accent: string;
    appearance: 'light' | 'dark' | 'system';
    fontScale: number;
    background?: { image: string; dim: number; blur: number };
  };
  navigation: { initialPageId: string; tabs: Tab[] };
  pages: Page[];
  modals: Modal[];
  liveActivities: LiveActivity[];
  dataSources: DataSource[];
  variables: Record<string, Primitive>;
}

export interface DraftEnvelope {
  document: StudioDocument;
  revision: number;
  updatedAt: string;
}

