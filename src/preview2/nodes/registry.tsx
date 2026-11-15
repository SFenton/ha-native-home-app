import type { CompositionNode } from '../../shared/composition/schema';
import { BoundControlNode, LocalControlNode } from './controls';
import { AccountHeaderNode, InfoBoxNode, PrimaryButtonNode, RowNode, SettingsLinkNode, StatusPillNode, TextNode } from './content';
import { LocalTabsNode, PagedRowNode, RoomSectionNode, SectionNode, StatusRailNode, TileGridNode } from './layout';
import { ActionTileNode, CameraTileNode, LightGroupTileNode, NavigationTileNode, RoomCardNode, RoomChipNode, RoomOverviewTileNode, StatusChipNode } from './tiles';

type Draw<T extends CompositionNode['type']> = (props: { node: Extract<CompositionNode, { type: T }> }) => React.JSX.Element;
type Registry = { [T in CompositionNode['type']]?: Draw<T> };

/**
 * The node types phase 1 draws. Every other type falls through to the placeholder, so the list of what the web cannot show
 * is the complement of these keys.
 */
export const registry: Registry = {
  'tile-grid': TileGridNode, section: SectionNode, 'status-rail': StatusRailNode, 'room-section': RoomSectionNode, 'paged-row': PagedRowNode, 'local-tabs': LocalTabsNode,
  text: TextNode, 'info-box': InfoBoxNode, 'status-pill': StatusPillNode, row: RowNode, 'settings-link': SettingsLinkNode, 'primary-button': PrimaryButtonNode, 'account-header': AccountHeaderNode,
  'navigation-tile': NavigationTileNode, 'action-tile': ActionTileNode, 'status-chip': StatusChipNode, 'room-overview-tile': RoomOverviewTileNode, 'light-group-tile': LightGroupTileNode,
  'room-card': RoomCardNode, 'room-chip': RoomChipNode, 'camera-tile': CameraTileNode,
  'bound-control': BoundControlNode, 'local-control': LocalControlNode,
};
/** The types the preview draws. */
export const drawnTypes: readonly string[] = Object.keys(registry);
