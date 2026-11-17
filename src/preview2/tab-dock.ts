import { createContext } from 'react';
import type { TabBar } from '../shared/composition/schema';
import type { SheetFrame } from './sheet-frame';

/**
 * The slot a page or a sheet keeps for its bottom tab bar. The app pins a `pinned` `local-tabs` bar on the bottom safe edge of the page
 * it belongs to (`UKPagePinnedBar`, `UKServerUIShellPrimitives.swift:529-533`), outside the scrolling content, so the bar is not drawn
 * in the content's flow: the node portals it into this element. Null while no page body has mounted it yet (the bar then draws in flow).
 */
export const TabDockContext = createContext<HTMLElement | null>(null);

/**
 * Whether a tab bar leaves the content's flow for the page's bottom edge. Native decides by `pinned` alone (`tabBarOf`: `pinned` is
 * Bottom, otherwise Top) in every window, compact or regular; no size or device moves it.
 */
export const docksAtBottom = (setting: Pick<TabBar, 'placement'>): boolean => setting.placement === 'bottom';

/**
 * Whether a sheet reaches the window's bottom edge, so its own bottom safe area is the window's home indicator inset. A card rising
 * from the bottom and a full-screen cover do; a centred or leading sheet floats clear of that edge and has no bottom inset.
 */
export const sheetReachesBottom = (frame: Pick<SheetFrame, 'placement'>): boolean => frame.placement === 'bottom' || frame.placement === 'cover';
