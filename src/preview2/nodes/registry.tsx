import type { CompositionNode } from '../../shared/composition/schema';
import { BoundControlNode, LocalControlNode } from './controls';
import { AccountHeaderNode, InfoBoxNode, PrimaryButtonNode, RowNode, SettingsLinkNode, StatusPillNode, TextNode } from './content';
import { OverlayNode } from './overlay';
import { RepeatNode } from './repeat';
import { ShapeNode, StackNode, SymbolPartNode } from './parts';
import { ChartNode } from './chart';
import { GaugeNode } from './gauge';
import { ArcTrackNode, DialNode } from './dial';
import { LocalTabsNode, PagedRowNode, RoomSectionNode, SectionNode, StatusRailNode, TileGridNode } from './layout';
import { ClimateControlNode } from './climate';
import { CustomLightControlNode } from './custom-lights';
import { RemoteControlNode } from './remote';
import { SettingsControlNode } from './settings';
import { SprinklerControlNode } from './sprinkler';
import { VacuumControlNode } from './vacuum';
import { CameraTileNode } from './camera-tile';
import { LightGroupTileNode } from './light-tile';
import { AvatarNode } from './avatar';
import { ActionTileNode, StateTileNode, NavigationTileNode, RoomCardNode, RoomChipNode, RoomOverviewTileNode, StatusChipNode } from './tiles';
import { AlarmPanelNode, BedroomControlNode, BootstrapMessageNode, CameraControlsNode, CameraVideoNode, CameraViewerNode, CollectionNode, DoorTileNode, FormNode, PinnedActionsNode, RecipePartNode, RoomDeviceControlNode, RoomNavigationGridNode, RowCollectionNode, WeatherPanelNode } from './panels';

type Draw<T extends CompositionNode['type']> = (props: { node: Extract<CompositionNode, { type: T }> }) => React.JSX.Element;
type Registry = { [T in CompositionNode['type']]?: Draw<T> };

/**
 * The node types the preview draws. A type with no entry (an unknown or future one) falls through to the placeholder.
 */
export const registry: Registry = {
  'tile-grid': TileGridNode, section: SectionNode, 'status-rail': StatusRailNode, 'room-section': RoomSectionNode, 'paged-row': PagedRowNode, 'local-tabs': LocalTabsNode, overlay: OverlayNode,
  text: TextNode, 'info-box': InfoBoxNode, 'status-pill': StatusPillNode, row: RowNode, 'settings-link': SettingsLinkNode, 'primary-button': PrimaryButtonNode, 'account-header': AccountHeaderNode,
  'navigation-tile': NavigationTileNode, 'action-tile': ActionTileNode, 'status-chip': StatusChipNode, 'room-overview-tile': RoomOverviewTileNode, 'light-group-tile': LightGroupTileNode,
  'room-card': RoomCardNode, 'room-chip': RoomChipNode, 'camera-tile': CameraTileNode, 'state-tile': StateTileNode,
  'bound-control': BoundControlNode, 'local-control': LocalControlNode,
  'settings-control': SettingsControlNode, 'vacuum-control': VacuumControlNode, 'custom-light-control': CustomLightControlNode,
  'climate-control': ClimateControlNode, 'sprinkler-control': SprinklerControlNode, 'remote-control': RemoteControlNode,
  // Panels, security, rooms, cameras and records (lane nodesb); the notification banner is the app's own and stays hidden (`hiddenNodeTypes`).
  'weather-panel': WeatherPanelNode, 'alarm-panel': AlarmPanelNode, 'door-tile': DoorTileNode, 'room-navigation-grid': RoomNavigationGridNode, 'room-device-control': RoomDeviceControlNode,
  'bedroom-control': BedroomControlNode, 'camera-video': CameraVideoNode, 'camera-controls': CameraControlsNode, 'camera-viewer': CameraViewerNode, 'row-collection': RowCollectionNode,
  stack: StackNode, shape: ShapeNode, symbol: SymbolPartNode, repeat: RepeatNode,
  chart: ChartNode, 'linear-gauge': GaugeNode, dial: DialNode, 'arc-track': ArcTrackNode, avatar: AvatarNode,
  collection: CollectionNode, form: FormNode, 'recipe-part': RecipePartNode, 'pinned-actions': PinnedActionsNode, 'bootstrap-message': BootstrapMessageNode,
};
/** The types the preview draws. */
export const drawnTypes: readonly string[] = Object.keys(registry);
