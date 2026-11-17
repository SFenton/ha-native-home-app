import {
  AirVent, AlarmClock, ArrowDownToLine, ArrowUpToLine, Blinds, AppWindow, Apple, Armchair, ArrowUp, ArrowUpDown, Bath, Bot, Briefcase, Cable, ChevronDown, ChevronLeft, Circle, CircleAlert, CircleGauge, CirclePause, CircleX,
  ClipboardList, CloudRain, Computer, CookingPot, Crop, DoorClosed, Droplets, Dumbbell, Fan, Footprints, Gamepad2, Guitar, Hammer, Heater, History, Image, Inbox, Key, Layers, LightbulbOff,
  ListChecks, ListFilter, LogOut, MapPin, Microwave, Monitor, Music, Pause, PawPrint, Plug, PlugZap, Projector, Refrigerator, RotateCw, ScanBarcode, Server, ShieldCheck, ShoppingBasket,
  ShoppingCart, ShowerHead, SkipBack, SkipForward, Speaker, SprayCan, Square, SquarePlay, Star, ThermometerSnowflake, ThermometerSun, ToggleLeft, TriangleAlert, Tv, Undo2, Utensils,
  Volume1, Volume2, WashingMachine, Grid2X2, Lightbulb, Palette, Paperclip, RotateCcw, type LucideIcon,
} from 'lucide-react';

/**
 * SF Symbol names (and plain icon names from older drafts) the Studio's other icon tables lack, each mapped to the nearest lucide
 * glyph so the "?" fallback never shows for a name in the icon catalogue, a fixture or an existing draft. The icon census test
 * (`tests/icon-census.test.ts`) fails when a requested name is in neither table.
 */
export const symbolAliases: Record<string, LucideIcon> = {
  // The icon catalogue (`pickers/icons.ts`).
  'arrow.clockwise': RotateCw, 'arrow.up': ArrowUp, 'arrow.uturn.backward': Undo2, 'cloud.rain': CloudRain, dryer: WashingMachine, washer: WashingMachine,
  'exclamationmark.triangle': TriangleAlert, fanblades: Fan, gamecontroller: Gamepad2, humidity: Droplets, key: Key, 'music.note': Music, pause: Pause,
  pawprint: PawPrint, photo: Image, 'poweroutlet.type.b': Plug, refrigerator: Refrigerator, shower: ShowerHead, 'speaker.wave.2': Volume2,
  'sprinkler.and.droplets': SprayCan, sprinkler: SprayCan, star: Star, 'switch.2': ToggleLeft, 'thermometer.snowflake': ThermometerSnowflake, 'thermometer.sun': ThermometerSun,
  // Symbols the documents and the owner's drafts use.
  'air.purifier': AirVent, alarm: AlarmClock, 'app.fill': AppWindow, 'apple.logo': Apple, 'appletvremote.gen4': Tv, 'arrow.up.arrow.down': ArrowUpDown,
  'arrowtriangle.down.fill': ChevronDown, 'backward.end': SkipBack, 'barcode.viewfinder': ScanBarcode, basket: ShoppingBasket, bathtub: Bath, cabinet: DoorClosed,
  'cable.connector': Cable, 'carseat.left': Armchair, 'cart.circle.fill': ShoppingCart, checklist: ListChecks, 'chevron.down': ChevronDown, 'chevron.left': ChevronLeft,
  'circle.fill': Circle, crop: Crop, desktopcomputer: Computer, dishwasher: WashingMachine, dumbbell: Dumbbell, 'ev.charger': PlugZap, 'exclamationmark.circle': CircleAlert,
  'forward.end': SkipForward, 'frying.pan': CookingPot, 'gamecontroller.fill': Gamepad2, guitars: Guitar, 'hammer.circle.fill': Hammer, 'heat.waves': Heater,
  hifireceiver: Speaker, hifispeaker: Speaker, humidifier: Droplets, 'lightbulb.slash': LightbulbOff, 'line.3.horizontal.decrease': ListFilter,
  'list.bullet.clipboard': ClipboardList, location: MapPin, 'lock.shield': ShieldCheck, 'mdi:speaker': Speaker, 'pause.circle': CirclePause, pc: Computer,
  'play.rectangle': SquarePlay, 'rectangle.portrait.and.arrow.right': LogOut, 'robotic.vacuum': CircleGauge, 'server.rack': Server, 'speaker.minus.fill': Volume1,
  'speaker.plus.fill': Volume2, 'square.split.2x2': Grid2X2, stairs: Layers, stop: Square, stove: Microwave, suitcase: Briefcase, 'takeoutbag.and.cup.and.straw': Utensils,
  'tray.circle.fill': Inbox, 'tv.and.mediabox': Tv, videoprojector: Projector, 'windshield.front.and.heat.waves': Heater, 'xmark.circle': CircleX,
  // The device controls (settings, vacuum, lights, climate, sprinkler, remote).
  'arrow.counterclockwise': RotateCcw, 'clock.arrow.circlepath': History, 'lightbulb.led': Lightbulb, paintpalette: Palette, paperclip: Paperclip, 'stop.fill': Square,
  // The built-in state styles' glyphs (`state-styles.ts`): the garage door and blind verbs.
  'arrow.uturn.down': ArrowDownToLine, 'arrow.uturn.up': ArrowUpToLine, 'blinds.horizontal.closed': Blinds, 'blinds.horizontal.open': Blinds,
  // Plain names older drafts carried.
  Bot, Footprints, Gamepad2, History, Monitor, PlugZap,
};
