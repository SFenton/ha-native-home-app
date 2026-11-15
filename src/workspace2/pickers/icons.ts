/** One symbol the app accepts: its SF Symbol name, a plain name, and the group it sits in. */
export interface IconChoice { symbol: string; name: string; group: IconGroup }
export const iconGroups = ['Home', 'Lights', 'Climate', 'Security', 'Media', 'People', 'Arrows'] as const;
export type IconGroup = typeof iconGroups[number];

const group = (name: IconGroup, items: [string, string][]): IconChoice[] => items.map(([symbol, label]) => ({ symbol, name: label, group: name }));

/**
 * The curated symbols the Studio offers. The list the app accepts is open question 3 in the spec; any other name can still be
 * typed and is tagged "Not Checked". The Studio draws stand-in glyphs, never the SF Symbols themselves.
 */
export const iconChoices: readonly IconChoice[] = [
  ...group('Home', [['house', 'House'], ['house.fill', 'House, filled'], ['square.grid.2x2', 'Grid'], ['door.left.hand.open', 'Door'], ['bed.double', 'Bed'], ['fork.knife', 'Kitchen'], ['washer', 'Washer'], ['dryer', 'Dryer'], ['refrigerator', 'Fridge'],
    ['shower', 'Shower'], ['sofa', 'Sofa'], ['gearshape', 'Settings'], ['list.bullet', 'List'], ['calendar', 'Calendar'], ['trash', 'Bin'], ['wrench.and.screwdriver', 'Tools'], ['sprinkler.and.droplets', 'Sprinkler'], ['leaf', 'Leaf']]),
  ...group('Lights', [['lightbulb', 'Light bulb'], ['lightbulb.fill', 'Light bulb, on'], ['lightbulb.2', 'Light bulbs'], ['power', 'Power'], ['bolt', 'Bolt'], ['bolt.fill', 'Bolt, filled'], ['sun.max', 'Sun'], ['moon', 'Moon'], ['sparkles', 'Sparkles'], ['fanblades', 'Fan'], ['switch.2', 'Switch'], ['poweroutlet.type.b', 'Outlet']]),
  ...group('Climate', [['thermometer.medium', 'Thermometer'], ['thermometer.sun', 'Warm'], ['thermometer.snowflake', 'Cold'], ['snowflake', 'Snowflake'], ['flame', 'Flame'], ['humidity', 'Humidity'], ['wind', 'Wind'], ['cloud', 'Cloud'], ['cloud.rain', 'Rain'], ['drop', 'Water drop'], ['aqi.medium', 'Air quality']]),
  ...group('Security', [['lock', 'Lock'], ['lock.open', 'Lock, open'], ['shield', 'Shield'], ['shield.slash', 'Shield, off'], ['bell', 'Bell'], ['camera', 'Camera'], ['video', 'Video'], ['eye', 'Eye'], ['key', 'Key'], ['exclamationmark.triangle', 'Warning'], ['door.garage.closed', 'Garage']]),
  ...group('Media', [['music.note', 'Music'], ['play', 'Play'], ['pause', 'Pause'], ['tv', 'TV'], ['speaker.wave.2', 'Speaker'], ['speaker.slash', 'Muted'], ['gamecontroller', 'Game'], ['film', 'Film'], ['photo', 'Photo'], ['wifi', 'Wi-Fi']]),
  ...group('People', [['person', 'Person'], ['person.2', 'People'], ['person.crop.circle', 'Account'], ['figure.walk', 'Walking'], ['pawprint', 'Pet'], ['heart', 'Heart'], ['star', 'Star'], ['bubble.left', 'Message'], ['info.circle', 'Info'], ['questionmark.circle', 'Help']]),
  ...group('Arrows', [['arrow.up', 'Up'], ['arrow.down', 'Down'], ['arrow.left', 'Left'], ['arrow.right', 'Right'], ['chevron.right', 'Chevron'], ['plus', 'Plus'], ['minus', 'Minus'], ['xmark', 'Close'], ['checkmark', 'Check'], ['arrow.clockwise', 'Refresh'], ['arrow.uturn.backward', 'Back']]),
];

/** Choices whose plain name or symbol name contains every word typed, grouped in the order of {@link iconGroups}. */
export function filterIcons(query: string): IconChoice[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return iconChoices.filter(choice => words.every(word => `${choice.name} ${choice.symbol}`.toLowerCase().includes(word)));
}
/** The plain name for a symbol, when the Studio knows it. */
export const iconName = (symbol: string) => iconChoices.find(choice => choice.symbol === symbol)?.name;
/** Whether the Studio knows a symbol (a typed one is "Not Checked"). */
export const isKnownIcon = (symbol: string) => iconChoices.some(choice => choice.symbol === symbol);
