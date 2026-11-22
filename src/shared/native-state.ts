import type { Json } from './types';

/** Studio-only HA core time zone; offset strings are not IANA names. */
export function isNativeTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; }
  catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

export type NativeCurrentUser = {
  id: string;
  name: string;
  isOwner: boolean;
  isAdmin: boolean;
  personEntityId?: string;
};

export type NativeForecast = {
  datetime: string;
  condition?: string;
  temperature?: number;
  templow?: number;
  precipitation?: number;
  precipitationProbability?: number;
  humidity?: number;
  windSpeed?: number;
};

export type NativeTodoItem = {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  description?: string;
  due?: string;
};

export type NativeTodoRead =
  | { status: 'ready'; items: NativeTodoItem[] }
  | { status: 'error' | 'unavailable'; message: string };

export type NativeState = {
  entityId: string;
  state: string;
  /** When the state last changed, `YYYY-MM-DDTHH:MM:SS.sssZ` (`last-changed`, `sh.entity-time@1`); absent when Home Assistant did not say. */
  lastChanged?: string;
  name: string;
  /** Safe Home Assistant attributes explicitly read by the current Studio draft; live preview only. */
  attributes?: Record<string, Json>;
  unit?: string;
  icon?: string;
  deviceClass?: string;
  brightness?: number;
  temperature?: number;
  currentTemperature?: number;
  hvacAction?: string;
  percentage?: number;
  currentPosition?: number;
  volumeLevel?: number;
  isVolumeMuted?: boolean;
  supportedFeatures?: number;
  supportedColorModes?: string[];
  colorMode?: string;
  colorTempKelvin?: number;
  minColorTempKelvin?: number;
  maxColorTempKelvin?: number;
  hsColor?: [number, number];
  rgbColor?: [number, number, number];
  xyColor?: [number, number];
  effect?: string;
  effectList?: string[];
  minTemp?: number;
  maxTemp?: number;
  targetTempStep?: number;
  targetTempHigh?: number;
  targetTempLow?: number;
  hvacModes?: string[];
  presetMode?: string;
  presetModes?: string[];
  fanMode?: string;
  fanModes?: string[];
  swingMode?: string;
  swingModes?: string[];
  currentHumidity?: number;
  targetHumidity?: number;
  minHumidity?: number;
  maxHumidity?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  percentageStep?: number;
  direction?: string;
  oscillating?: boolean;
  currentTiltPosition?: number;
  mediaTitle?: string;
  mediaArtist?: string;
  mediaAlbumName?: string;
  mediaContentType?: string;
  mediaDuration?: number;
  mediaPosition?: number;
  mediaPositionUpdatedAt?: string;
  source?: string;
  sourceList?: string[];
  soundMode?: string;
  soundModeList?: string[];
  repeat?: string;
  shuffle?: boolean;
  batteryLevel?: number;
  fanSpeed?: string;
  fanSpeedList?: string[];
  status?: string;
  apparentTemperature?: number;
  humidity?: number;
  dewPoint?: number;
  pressure?: number;
  pressureUnit?: string;
  windSpeed?: number;
  windGustSpeed?: number;
  windBearing?: number | string;
  windSpeedUnit?: string;
  precipitationUnit?: string;
  visibility?: number;
  visibilityUnit?: string;
  cloudCoverage?: number;
  uvIndex?: number;
  dailyForecast?: NativeForecast[];
  hourlyForecast?: NativeForecast[];
  todoList?: NativeTodoRead;
};

export type NativeSnapshot = {
  mode: 'live';
  /** Validated HA core IANA zone, for Studio time presentation only. */
  timeZone?: string;
  houseConfig: { schema: 2; hash: string; config: Record<string, Json> };
  states: NativeState[];
  currentUser?: NativeCurrentUser;
  warnings?: string[];
};
