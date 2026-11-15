/** Exact native domain operations; this is not a second generic form/collection language. */
export const settingsKinds = [
  'household-toggle', 'household-recovery', 'household-relay-warning', 'household-read-only', 'presence-room', 'presence-choice',
  'vacation-status', 'vacation-toggle', 'vacation-check', 'vacation-dates', 'vacation-confirm',
  'away-status', 'solo-traveler', 'solo-toggle', 'solo-dates', 'solo-return', 'solo-confirm', 'away-restore',
  'background-blur', 'reset-background-blur', 'app-badge', 'app-icon-choice', 'app-version',
  'feedback-field', 'feedback-media', 'feedback-submit', 'feedback-status', 'feedback-stop',
  'location-account', 'location-status', 'location-action', 'profile-person', 'profile-people', 'sign-out', 'ha-settings', 'ha-value', 'ha-web',
  'performance-recording', 'performance-action',
] as const;
export type SettingsKind = typeof settingsKinds[number];
export function settingsDomain(kind: SettingsKind) {
  if (['household-toggle', 'household-recovery', 'household-relay-warning', 'household-read-only', 'presence-room', 'presence-choice'].includes(kind)) return 'household';
  if (['background-blur', 'reset-background-blur', 'app-badge', 'app-icon-choice', 'app-version'].includes(kind)) return 'preferences';
  if (kind.startsWith('feedback-')) return 'feedback';
  if (kind.startsWith('location-') || kind.startsWith('ha-') || ['profile-person', 'profile-people', 'sign-out'].includes(kind)) return 'profile';
  if (kind.startsWith('performance-')) return 'performance';
  return 'away';
}
export const settingsDestination = (kind: SettingsKind) => ['presence-room', 'vacation-toggle', 'solo-toggle', 'location-account'].includes(kind);
export const settingsItem = (kind: SettingsKind) => [
  'household-toggle', 'household-recovery', 'household-read-only', 'presence-room', 'presence-choice',
  'vacation-check', 'solo-traveler', 'app-icon-choice', 'away-restore',
  'feedback-field', 'profile-person', 'performance-action', 'ha-value', 'ha-web',
].includes(kind);
export const settingsFixedItems: Partial<Record<SettingsKind, readonly string[]>> = {
  'feedback-field': ['title', 'description', 'repro', 'expected'],
  'away-restore': ['keep_current', 'restore_saved'],
  'performance-action': ['refresh', 'clear-images', 'reset', 'export'],
  'app-icon-choice': ['navySky', 'tealMint', 'plumLilac', 'forestGreen', 'burgundyRose', 'indigoPeriwinkle', 'espressoAmber', 'midnightGold'],
  'ha-value': ['address', 'connection', 'version', 'house-layout', 'account', 'role'],
  'ha-web': ['settings', 'profile'],
};
