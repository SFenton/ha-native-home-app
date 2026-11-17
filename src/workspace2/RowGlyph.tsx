import { Dock, PanelBottom, AppWindow, Layers, GalleryHorizontal, PanelsTopLeft, SquareDashed, ListTree, RectangleHorizontal, CircleArrowRight, ToggleRight, Settings2, Settings, Sofa, LayoutList, LayoutDashboard, Grid2x2, Lightbulb, Thermometer, CloudSun, ShieldAlert, DoorClosed, Cctv, Video, Gamepad2, BedDouble, CircleUser, ClipboardList, Pin, Puzzle, MessageSquare, BellRing, Component, Rows3, Activity, Power, Info, Type, Tag, List, LayoutGrid, ChartColumn, Gauge, type LucideIcon } from 'lucide-react';
import { CircleGauge, Spline } from 'lucide-react';
import { GlyphByName, hasGlyph } from '../preview2/nodes/shared';
import { typeGlyph } from './levels';

/** The lucide glyphs of {@link typeGlyph}, by name. Listed by hand so the bundle holds only these. */
const glyphs: Record<string, LucideIcon> = { Dock, PanelBottom, AppWindow, Layers, GalleryHorizontal, PanelsTopLeft, SquareDashed, ListTree, RectangleHorizontal, CircleArrowRight, ToggleRight, Settings2, Settings, Sofa, LayoutList, LayoutDashboard, Grid2x2, Lightbulb, Thermometer, CloudSun, ShieldAlert, DoorClosed, Cctv, Video, Gamepad2, BedDouble, CircleUser, ClipboardList, Pin, Puzzle, MessageSquare, BellRing, Component, Rows3, Activity, Power, Info, Type, Tag, List, LayoutGrid, ChartColumn, Gauge };
Object.assign(glyphs, { CircleGauge, Spline });

/**
 * A row's icon, 18 px in a 24 px slot (studio-ux2 lib3, L-tree): the node's own icon when it has one, else the glyph of its type
 * (`typeGlyph`). The caller passes the person's own list icon (L-icons) as `icon` when there is one, so it takes the first place.
 */
export default function RowGlyph({ icon, type, size = 18 }: { icon?: string; type: string; size?: number }) {
  if (icon && hasGlyph(icon)) return <GlyphByName name={icon} size={size}/>;
  const Glyph = glyphs[typeGlyph(type)] ?? Component;
  return <Glyph size={size} strokeWidth={1.8} aria-hidden/>;
}
