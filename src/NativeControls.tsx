import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown, ArrowUp, Check, ChevronRight, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain,
  CloudSnow, CloudSun, Droplets, Fan, Home, Lightbulb, Minus, Moon, Pause,
  Play, Plus, Power, SlidersHorizontal, Square, Sun, Thermometer, Wind,
} from 'lucide-react';
import type { Action, Component, Json } from './shared/types';
import { nativePresentationVisible, nativeRemoteEnabled } from './shared/native-presentation';
import { Icon } from './ui';
import './NativeControls.css';

type Values = Record<string, Json>;
type WeatherMode = 'temperature' | 'precipitation' | 'wind';
type Forecast = Values & { datetime: string };
type Range = { min: number; max: number; step: number };

const numeric = (value: Json | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const text = (value: Json | undefined): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;
const strings = (value: Json | undefined): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item.trim()))] : [];
const label = (component: Component, key: string, fallback: string) => text(component.props[key]) ?? fallback;
const humanize = (value: string) => value.replace(/[-_]/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
const degree = (value: Json | undefined) => numeric(value) === undefined ? '--' : `${Math.round(numeric(value)!)}\u00b0`;
const temperature = (value: Json | undefined, unit: Json | undefined) =>
  numeric(value) === undefined ? 'Unavailable' : `${degree(value)}${(text(unit) ?? '').replace('\u00b0', '')}`;
const measure = (value: Json | undefined, unit?: Json, digits = 1) =>
  numeric(value) === undefined ? 'Unavailable' : `${Number(numeric(value)!.toFixed(digits))}${text(unit) ? `${unit === '%' || unit === '\u00b0' ? '' : ' '}${text(unit)}` : ''}`;
const unavailableState = (state: string | undefined) => !state || ['unknown', 'unavailable'].includes(state.toLowerCase());
const feature = (entity: Values | undefined, bit: number) => ((numeric(entity?.supportedFeatures) ?? 0) & bit) === bit;

function forecast(value: Json | undefined): Forecast[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Forecast =>
    !!row && typeof row === 'object' && !Array.isArray(row) && typeof row.datetime === 'string');
}

function conditionLabel(value: Json | undefined) {
  const condition = text(value);
  if (unavailableState(condition)) return 'Weather unavailable';
  const names: Record<string, string> = {
    sunny: 'Sunny', 'clear-night': 'Clear', partlycloudy: 'Partly cloudy',
    cloudy: 'Cloudy', rainy: 'Rain', pouring: 'Heavy rain', snowy: 'Snow',
    'snowy-rainy': 'Rain and snow', lightning: 'Thunderstorms',
    'lightning-rainy': 'Thunderstorms and rain', fog: 'Fog', hail: 'Hail',
    windy: 'Windy', 'windy-variant': 'Windy and cloudy', exceptional: 'Exceptional weather',
  };
  return names[condition!] ?? humanize(condition!);
}

function WeatherGlyph({ condition, size = 24 }: { condition?: Json; size?: number }) {
  const value = text(condition);
  const Glyph = value === 'sunny' ? Sun : value === 'clear-night' ? Moon
    : value === 'partlycloudy' ? CloudSun : value === 'rainy' ? CloudDrizzle
      : value === 'pouring' ? CloudRain : value?.includes('lightning') ? CloudLightning
        : value?.includes('snow') || value === 'hail' ? CloudSnow : value === 'fog' ? CloudFog
          : value?.startsWith('windy') ? Wind : Cloud;
  return <Glyph size={size} strokeWidth={1.8} aria-hidden="true" className={`native-weather-glyph native-weather-glyph-${value ?? 'unknown'}`}/>;
}

function timeLabel(value: string, daily = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, daily ? { weekday: 'short' } : { hour: 'numeric' }).format(date);
}

function highLow(today: Forecast | undefined, compact: boolean) {
  return [
    numeric(today?.temperature) === undefined ? '' : `${compact ? 'H:' : 'High: '}${degree(today?.temperature)}`,
    numeric(today?.templow) === undefined ? '' : `${compact ? 'L:' : 'Low: '}${degree(today?.templow)}`,
  ].filter(Boolean).join('  ');
}

function DailyRange({ row, rows }: { row: Forecast; rows: Forecast[] }) {
  const low = numeric(row.templow), high = numeric(row.temperature);
  const lows = rows.map((day) => numeric(day.templow)).filter((value): value is number => value !== undefined);
  const highs = rows.map((day) => numeric(day.temperature)).filter((value): value is number => value !== undefined);
  if (low === undefined || high === undefined || high < low || !lows.length || !highs.length)
    return <span className="native-weather-day-rail" aria-hidden="true"/>;
  const min = Math.min(...lows), max = Math.max(...highs);
  const spread = Math.max(1, max - min);
  return <span className="native-weather-day-rail" aria-hidden="true"><span style={{
    insetInlineStart: `${(low - min) / spread * 100}%`,
    width: `${(high - low) / spread * 100}%`,
  }}/></span>;
}

function briefing(weather: Values | undefined, daily: Forecast[]) {
  const today = daily[0];
  const sentences: string[] = [];
  const condition = text(today?.condition) ?? text(weather?.state);
  if (!unavailableState(condition)) {
    const range = [
      numeric(today?.temperature) !== undefined ? `a high of ${degree(today?.temperature)}` : '',
      numeric(today?.templow) !== undefined ? `a low of ${degree(today?.templow)}` : '',
    ].filter(Boolean).join(' and ');
    sentences.push(`${conditionLabel(condition)}${range ? `, with ${range}` : numeric(weather?.temperature) !== undefined ? `, ${temperature(weather?.temperature, weather?.unit)}` : ''}.`);
  } else if (highLow(today, false)) sentences.push(`${highLow(today, false)}.`);
  if (numeric(today?.precipitationProbability) !== undefined)
    sentences.push(`Precipitation chance: ${measure(today?.precipitationProbability)}%.`);
  if (numeric(today?.precipitation) !== undefined)
    sentences.push(`Expected precipitation: ${measure(today?.precipitation, weather?.precipitationUnit, 2)}.`);
  if (numeric(weather?.windSpeed) !== undefined)
    sentences.push(`Wind: ${measure(weather?.windSpeed, weather?.windSpeedUnit)}${numeric(weather?.windGustSpeed ?? weather?.windGust) !== undefined ? `, gusting to ${measure(weather?.windGustSpeed ?? weather?.windGust, weather?.windSpeedUnit)}` : ''}.`);
  return sentences;
}

function ForecastMessage({ weather, kind }: { weather?: Values; kind: 'daily' | 'hourly' }) {
  const error = text(weather?.[`${kind}ForecastError`]) ?? text(weather?.forecastError);
  return <p className="native-weather-empty" role="status">{error ? `Forecast unavailable: ${error}` : `No ${kind} forecast available.`}</p>;
}

function Hourly({ rows, weather, mode = 'temperature', paged = false }: { rows: Forecast[]; weather?: Values; mode?: WeatherMode; paged?: boolean }) {
  const rail = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const id = useId();
  const perPage = 6;
  const pageCount = Math.ceil(rows.length / perPage);
  if (!rows.length) return <ForecastMessage weather={weather} kind="hourly"/>;
  const cells = rows.map((row, index) => <div className="native-weather-hour" key={`${row.datetime}-${index}`}>
      <time dateTime={row.datetime}>{timeLabel(row.datetime)}</time>
      {mode === 'temperature' ? <WeatherGlyph condition={row.condition}/> : mode === 'wind' ? <Wind aria-hidden="true"/> : <Droplets aria-hidden="true"/>}
      <strong aria-label={mode === 'temperature' ? temperature(row.temperature, weather?.unit) : undefined}>
        {mode === 'temperature' ? degree(row.temperature) : mode === 'wind' ? measure(row.windSpeed, weather?.windSpeedUnit)
          : numeric(row.precipitationProbability) !== undefined ? `${measure(row.precipitationProbability)}%` : measure(row.precipitation, weather?.precipitationUnit, 2)}
      </strong>
      {mode === 'temperature' && <span className="native-weather-hour-condition">{conditionLabel(row.condition)}</span>}
      {mode === 'precipitation' && numeric(row.precipitationProbability) !== undefined && numeric(row.precipitation) !== undefined
        && <span>{measure(row.precipitation, weather?.precipitationUnit, 2)}</span>}
    </div>);
  return <div className="native-weather-carousel" data-weather-scroll>
    <div ref={rail} id={id} className={`native-weather-hourly${paged ? ' native-weather-hourly-paged' : ''}`}
      tabIndex={0} role="region" aria-label="Hourly forecast" onScroll={(event) => {
        const { scrollLeft, clientWidth } = event.currentTarget;
        if (paged && clientWidth > 0) setPage(Math.max(0, Math.min(pageCount - 1, Math.round(Math.abs(scrollLeft) / clientWidth))));
      }}>
      {paged ? Array.from({ length: pageCount }, (_, index) =>
        <div className="native-weather-hour-page" key={index}>{cells.slice(index * perPage, (index + 1) * perPage)}</div>) : cells}
    </div>
    {paged && pageCount > 1 && <div className="native-weather-pages" role="group" aria-label="Hourly forecast pages">
      {Array.from({ length: pageCount }, (_, index) => <button key={index} type="button" aria-controls={id}
        aria-label={`Forecast page ${index + 1} of ${pageCount}`} aria-current={Math.min(page, pageCount - 1) === index ? 'page' : undefined}
        onClick={() => {
          if (rail.current) {
            const direction = getComputedStyle(rail.current).direction === 'rtl' ? -1 : 1;
            rail.current.scrollLeft = index * rail.current.clientWidth * direction;
            setPage(index);
          }
        }}><span/></button>)}
    </div>}
  </div>;
}

function ConditionsChart({ rows, mode, weather }: { rows: Forecast[]; mode: WeatherMode; weather?: Values }) {
  const probability = mode === 'precipitation' && rows.some((row) => numeric(row.precipitationProbability) !== undefined);
  const key = mode === 'temperature' ? 'temperature' : mode === 'wind' ? 'windSpeed' : probability ? 'precipitationProbability' : 'precipitation';
  const values = rows.map((row) => numeric(row[key]));
  const known = values.filter((value): value is number => value !== undefined);
  const unit = mode === 'temperature' ? text(weather?.unit) : mode === 'wind' ? text(weather?.windSpeedUnit) : probability ? '%' : text(weather?.precipitationUnit);
  if (!known.length) return <p className="native-weather-empty">No {mode} measurements in the hourly forecast.</p>;
  const low = mode === 'temperature' ? Math.floor(Math.min(...known)) : 0;
  const high = probability ? 100 : Math.max(low + 1, Math.ceil(Math.max(...known)));
  const y = (value: number) => 92 - ((value - low) / (high - low)) * 80;
  const x = (index: number) => 12 + index * (276 / Math.max(1, values.length - 1));
  const lines: string[][] = [[]];
  values.forEach((value, index) => {
    if (value === undefined) { if (lines.at(-1)!.length) lines.push([]); }
    else lines.at(-1)!.push(`${x(index)},${y(value)}`);
  });
  return <figure className="native-weather-chart" aria-label={`${humanize(mode)} forecast, ${low} to ${high}${unit ? ` ${unit}` : ''}. Hourly values follow.`}>
    <div className="native-weather-axis" aria-hidden="true"><span>{high}{unit}</span><span>{low}{unit}</span></div>
    <svg viewBox="0 0 300 108" preserveAspectRatio="none" aria-hidden="true">
      {[12, 52, 92].map((at) => <line key={at} x1="0" x2="300" y1={at} y2={at} className="native-weather-gridline"/>)}
      {mode === 'temperature' ? lines.filter((line) => line.length > 1).map((points, index) =>
        <polyline key={index} points={points.join(' ')} className="native-weather-chart-line"/>)
        : values.map((value, index) => value === undefined ? null : <rect key={index} x={x(index) - 3} y={y(value)} width="6" height={Math.max(0, 92 - y(value))} rx="2" className="native-weather-chart-bar"/>)}
      {values.map((value, index) => value === undefined ? null : <circle key={index} cx={x(index)} cy={y(value)} r="2.5" className="native-weather-chart-point"/>)}
    </svg>
  </figure>;
}

export function NativeWeather({ component, weather, editing, onOpen }: {
  component: Component; weather: Values | undefined; editing: boolean; onOpen: () => void;
}) {
  const [mode, setMode] = useState<WeatherMode>('temperature');
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const daily = forecast(weather?.dailyForecast);
  const hourly = forecast(weather?.hourlyForecast);
  const sentences = briefing(weather, daily);
  const detail = component.props.presentation === 'detail';
  const condition = conditionLabel(weather?.state);
  const modes: WeatherMode[] = ['temperature', 'precipitation', 'wind'];
  const panelId = useId();
  const state = text(weather?.state);
  const wet = ['rainy', 'pouring', 'lightning-rainy'].includes(state ?? '');
  const metrics = [
    ['Humidity', measure(weather?.humidity, '%')],
    ['Feels like', temperature(weather?.apparentTemperature, weather?.unit)],
    ['Wind', measure(weather?.windSpeed, weather?.windSpeedUnit)],
    ['Gusts', measure(weather?.windGustSpeed ?? weather?.windGust, weather?.windSpeedUnit)],
    ['Wind bearing', typeof weather?.windBearing === 'string' ? weather.windBearing : measure(weather?.windBearing, '\u00b0')],
    ['Pressure', measure(weather?.pressure, weather?.pressureUnit)],
    ['Visibility', measure(weather?.visibility, weather?.visibilityUnit)],
    ['UV index', measure(weather?.uvIndex)],
    ['Dew point', temperature(weather?.dewPoint, weather?.unit)],
    ['Cloud cover', measure(weather?.cloudCoverage, '%')],
  ].filter(([, value]) => value !== 'Unavailable');

  const open = () => { if (!pointer.current?.moved) onOpen(); };
  return <article className={`native-weather-${detail ? 'detail' : 'card'}${wet ? ' native-weather-rain' : ''}`}
    data-component-id={component.id} data-editing={editing || undefined}
    onPointerDown={(event) => { pointer.current = { x: event.clientX, y: event.clientY, moved: false }; }}
    onPointerMove={(event) => {
      if (pointer.current && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 8) pointer.current.moved = true;
    }}
    onPointerCancel={() => { if (pointer.current) pointer.current.moved = true; }}
    onClick={detail ? undefined : (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-weather-scroll]')) open();
    }}>
    {detail ? <>
      <header className="native-weather-hero">
        <span className="native-weather-temperature" aria-label={temperature(weather?.temperature, weather?.unit)}>{degree(weather?.temperature)}</span>
        <h3>{condition}</h3>
        {highLow(daily[0], false) && <p>{highLow(daily[0], false)}</p>}
      </header>
      <section className="native-weather-panel native-weather-today">
        <div className="native-weather-panel-heading"><WeatherGlyph condition={daily[0]?.condition ?? weather?.state} size={32}/><div>
          <span>{label(component, 'todayLabel', 'Today')}</span><h3>{conditionLabel(daily[0]?.condition ?? weather?.state)}</h3>
        </div></div>
        {sentences.length ? <ul>{sentences.map((sentence) => <li key={sentence}>{sentence}</li>)}</ul> : <p>No weather briefing available.</p>}
      </section>
      <section className="native-weather-panel">
        <div className="native-weather-panel-heading"><h3>{label(component, 'conditionsLabel', 'Conditions')}</h3>
          <div className="native-weather-segments" role="tablist" aria-label="Forecast measurements">
            {modes.map((value, index) => <button key={value} type="button" role="tab" id={`${panelId}-${value}`}
              aria-selected={mode === value} aria-controls={panelId} tabIndex={mode === value ? 0 : -1}
              aria-label={humanize(value)} title={humanize(value)} onClick={() => setMode(value)}
              onKeyDown={(event) => {
                let next: WeatherMode | undefined;
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = modes[(index + 1) % modes.length];
                if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = modes[(index + modes.length - 1) % modes.length];
                if (event.key === 'Home') next = modes[0];
                if (event.key === 'End') next = modes.at(-1);
                if (next) { event.preventDefault(); setMode(next); document.getElementById(`${panelId}-${next}`)?.focus(); }
              }}>
              {value === 'temperature' ? <Thermometer aria-hidden="true"/> : value === 'precipitation' ? <Droplets aria-hidden="true"/> : <Wind aria-hidden="true"/>}
            </button>)}
          </div>
        </div>
        <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-${mode}`}>
          <ConditionsChart rows={hourly} mode={mode} weather={weather}/>
          <Hourly rows={hourly} weather={weather} mode={mode}/>
        </div>
      </section>
      <section className="native-weather-panel native-weather-daily">
        <h3>{label(component, 'dailyLabel', 'Daily forecast')}</h3>
        {daily.length ? daily.map((row, index) => <div className="native-weather-day" key={`${row.datetime}-${index}`}>
          <time dateTime={row.datetime}>{index === 0 ? label(component, 'todayLabel', 'Today') : timeLabel(row.datetime, true)}</time>
          <WeatherGlyph condition={row.condition}/><span className="native-weather-day-condition">{conditionLabel(row.condition)}</span>
          <span aria-label={`Low ${temperature(row.templow, weather?.unit)}`}>{degree(row.templow)}</span>
          <DailyRange row={row} rows={daily}/>
          <strong aria-label={`High ${temperature(row.temperature, weather?.unit)}`}>{degree(row.temperature)}</strong>
        </div>) : <ForecastMessage weather={weather} kind="daily"/>}
      </section>
      {metrics.length ? <dl className="native-weather-metrics">{metrics.map(([name, value]) => <div className="native-weather-panel" key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        : <p className="native-weather-empty">No condition measurements available.</p>}
    </> : <>
      <button className="native-weather-open" type="button"
        aria-label={`${label(component, 'openLabel', `Open ${component.title || 'weather'} forecast`)}. ${condition}, ${temperature(weather?.temperature, weather?.unit)}`}
        onKeyDown={() => { pointer.current = null; }}>
        <div className="native-weather-header">
          <div className="native-weather-summary"><WeatherGlyph condition={weather?.state} size={40}/><div>
            <h3>{text(component.props.conditionLabel) ?? condition}</h3>
            {highLow(daily[0], true) && <p className="native-weather-high-low">{highLow(daily[0], true)}</p>}
          </div></div>
          <span className="native-weather-temperature" aria-hidden="true">{degree(weather?.temperature)}</span>
        </div>
        <span className="native-weather-separator" aria-hidden="true"/>
        <p className="native-weather-brief">{sentences[0] ?? 'No weather briefing available.'}</p>
      </button>
      <hr className="native-weather-separator"/>
      <Hourly rows={hourly} weather={weather} paged/>
    </>}
  </article>;
}

function useDraft<T extends string | number | boolean | undefined>(source: string, current: T) {
  const [draft, setDraft] = useState<{ source: string; value: T }>({ source, value: current });
  if (draft.source !== source) setDraft({ source, value: current });
  return [draft.source === source ? draft.value : current, (value: T) => setDraft({ source, value })] as const;
}

export function NativeLocalTabs({ tabs, active, onSelect, style = 'labels', title = 'Sheet sections', surfaceActive = true }: {
  tabs: { id: string; title: string; icon?: ReactNode }[]; active?: string; onSelect: (id: string) => void;
  style?: 'menu' | 'icons' | 'labels'; title?: string; surfaceActive?: boolean;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => { setHost(anchor.current?.closest('.native-modal') ?? null); }, [tabs.length]);
  if (tabs.length <= 1) return null;
  const activeId = tabs.some(tab => tab.id === active) ? active : tabs[0]?.id;
  const bar = style === 'menu' ? <div hidden={!surfaceActive} className="native-sheet-tabbar native-sheet-tab-menu">
    <label htmlFor={id} className="native-data-status">{title}</label>
    <select id={id} value={activeId} onChange={event => {
      if (tabs.some(tab => tab.id === event.currentTarget.value)) onSelect(event.currentTarget.value);
    }}>{tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.title}</option>)}</select>
  </div> : <div hidden={!surfaceActive} role="tablist" aria-label={title} className="native-sheet-tabbar" data-style={style}>
    {tabs.map((tab, index) => <button type="button" key={tab.id} id={`${tab.id}-tab`} role="tab"
      aria-label={tab.title} title={tab.title} aria-selected={activeId === tab.id} aria-controls={`${tab.id}-panel`}
      tabIndex={activeId === tab.id ? 0 : -1} onClick={() => onSelect(tab.id)} onKeyDown={event => {
        const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
        const step = event.key === 'ArrowRight' ? rtl ? -1 : 1 : event.key === 'ArrowLeft' ? rtl ? 1 : -1 : 0;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : step ? (index + step + tabs.length) % tabs.length : undefined;
        if (next !== undefined) {
          event.preventDefault(); onSelect(tabs[next].id);
          globalThis.document.getElementById(`${tabs[next].id}-tab`)?.focus();
        }
      }}>{style === 'icons' ? tab.icon : <span>{tab.title}</span>}</button>)}
  </div>;
  return <><span ref={anchor} hidden/>{host ? createPortal(bar, host) : bar}</>;
}

export function NativeGuestTile({ component, entity, editing, disabled: external, onAction, onSelect }: {
  component: Component; entity?: Values; editing: boolean; disabled?: boolean;
  onAction: (action?: Action) => void; onSelect: () => void;
}) {
  const entityId = text(component.props.entityId) ?? '';
  const state = text(entity?.state);
  const available = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(entityId) && ['on', 'off'].includes(state ?? '');
  const [on, setOn] = useDraft(JSON.stringify([entityId, state]), state === 'on');
  const disabled = editing || external || component.props.disabled === true || component.props.readOnly === true || !available;
  const invoke = () => {
    if (disabled) return;
    const domain = entityId.split('.')[0];
    onAction({ type: 'service', domain: ['light', 'switch', 'fan', 'input_boolean'].includes(domain) ? domain : 'homeassistant',
      service: on ? 'turn_off' : 'turn_on', entityId });
    setOn(!on);
  };
  const subtitle = !available ? label(component, 'unavailableText', "Didn't Respond")
    : on ? label(component, 'activeText', 'Guests staying') : label(component, 'inactiveText', 'No guests');
  return <article className="native-guest-tile" data-active={on && available} data-component-id={component.id}
    onClick={event => { event.stopPropagation(); if (editing) onSelect(); }}>
    <button type="button" className="native-guest-body" disabled={disabled} onClick={invoke}>
      <Icon name={component.icon || 'UsersRound'} size={26}/><span><strong>{component.title}</strong><small>{subtitle}</small></span>
    </button>
    <button type="button" className="native-guest-power" disabled={disabled} aria-label={`${on ? 'Turn off' : 'Turn on'} ${component.title}`}
      aria-pressed={on && available} onClick={invoke}><Power aria-hidden="true"/></button>
  </article>;
}

export function NativeRemoteKey({ component, states, editing, disabled: external, onAction, onSelect }: {
  component: Component; states?: Json; editing: boolean; disabled?: boolean;
  onAction: (action?: Action) => void; onSelect: () => void;
}) {
  const disabled = editing || external || component.props.disabled === true || component.props.readOnly === true || !component.action || component.action.type === 'none'
    || !nativeRemoteEnabled(component, states) || !nativePresentationVisible(component, states);
  return <button type="button" className="native-remote-key" data-remote-key={text(component.props.remoteKey)}
    data-component-id={component.id} aria-label={component.title} title={component.title} disabled={disabled}
    onClick={event => { event.stopPropagation(); if (editing) onSelect(); else if (!disabled) onAction(component.action); }}>
    {component.icon ? <Icon name={component.icon} size={26}/> : <span>{component.title}</span>}
  </button>;
}

export function NativeRemoteVolume({ component, entity, states, editing, disabled: external, renderKey, onAction }: {
  component: Component; entity?: Values; states?: Json; editing: boolean; disabled?: boolean;
  renderKey: (component: Component) => ReactNode; onAction: (action?: Action) => void;
}) {
  const entityId = text(component.props.entityId) ?? '';
  const current = numeric(entity?.volumeLevel);
  const [percent, setPercent] = useDraft(JSON.stringify([entityId, current, entity?.state]),
    current !== undefined && current >= 0 && current <= 1 ? Math.round(current * 100) : undefined);
  const id = useId();
  const adjusting = useRef(false);
  const valid = percent !== undefined && percent >= 0 && percent <= 100;
  const disabled = editing || external || component.props.disabled === true || component.props.readOnly === true
    || !/^media_player\.[a-z0-9_]+$/.test(entityId) || unavailableState(text(entity?.state))
    || !nativeRemoteEnabled(component, states) || !feature(entity, 4) || !valid;
  const commit = (value = percent) => {
    if (!disabled && value !== undefined) onAction({ type: 'service', domain: 'media_player', service: 'volume_set',
      entityId, data: { volume_level: value / 100 } });
  };
  const keys = (name: string) => (component.children ?? []).filter(child =>
    child.props.remoteKey === name && (editing || nativePresentationVisible(child, states))).map(renderKey);
  return <section className="native-control native-remote-volume" data-component-id={component.id}>
    <header><label htmlFor={id}>{component.title}</label><output htmlFor={id}>{valid ? `${percent}%` : 'Unavailable'}</output>{keys('volumeMute')}</header>
    <div className="native-remote-volume-row">{keys('volumeDown')}
      <input id={id} type="range" min="0" max="100" step="1" value={valid ? percent : 0} disabled={disabled}
        aria-valuetext={valid ? `${percent}%` : 'Unavailable'} onPointerDown={() => { adjusting.current = true; }}
        onKeyDown={() => { adjusting.current = true; }} onChange={event => {
          if (!disabled) {
            const value = Math.max(0, Math.min(100, Math.round(Number(event.currentTarget.value))));
            setPercent(value);
            if (!adjusting.current) commit(value);
          }
        }} onPointerUp={() => { if (adjusting.current) commit(); adjusting.current = false; }}
        onPointerCancel={() => { adjusting.current = false; setPercent(current !== undefined ? Math.round(current * 100) : undefined); }}
        onBlur={() => { if (adjusting.current) commit(); adjusting.current = false; }} onKeyUp={event => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit();
          adjusting.current = false;
        }}/>{keys('volumeUp')}
    </div>
  </section>;
}

function range(min: Json | undefined, max: Json | undefined, step: Json | undefined): Range | undefined {
  const low = numeric(min), high = numeric(max), increment = numeric(step);
  return low !== undefined && high !== undefined && increment !== undefined && high > low && increment > 0 && increment <= high - low
    ? { min: low, max: high, step: increment } : undefined;
}

function clamp(value: number, limits: Range) {
  const bounded = Math.min(limits.max, Math.max(limits.min, value));
  const top = Math.floor((limits.max - limits.min) / limits.step + 1e-8);
  const steps = Math.min(top, Math.max(0, Math.round((bounded - limits.min) / limits.step)));
  return Number((limits.min + steps * limits.step).toFixed(8));
}

function NativeRange({ title, value, limits, disabled, onChange, unit = '', children }: {
  title: string; value: number | undefined; limits?: Range; disabled: boolean; onChange: (value: number) => void; unit?: string; children?: ReactNode;
}) {
  const id = useId();
  const valid = limits && value !== undefined && value >= limits.min && value <= limits.max;
  return <div className="native-control-range">
    <div className="native-control-range-heading"><label htmlFor={id}>{title}</label>
      <output htmlFor={id}>{value === undefined ? 'Unavailable' : `${Number(value.toFixed(2))}${unit}`}</output></div>
    <input id={id} type="range" min={limits?.min ?? 0} max={limits?.max ?? 1} step={limits?.step ?? 1}
      value={valid ? value : limits?.min ?? 0} disabled={disabled || !valid}
      aria-valuetext={valid ? `${value}${unit}` : 'Unavailable'}
      onChange={(event) => { if (!disabled && limits && valid) onChange(clamp(Number(event.currentTarget.value), limits)); }}/>
    {!limits && <p className="native-control-note">{title} limits unavailable.</p>}
    {limits && value !== undefined && !valid && <p className="native-control-note">{title} is outside device limits.</p>}
    {children}
  </div>;
}

function NativePicker({ title, value, options, disabled, onChange }: {
  title: string; value: string | undefined; options: string[]; disabled: boolean; onChange: (value: string) => void;
}) {
  const id = useId();
  const selected = value !== undefined && options.includes(value);
  return <div className="native-control-picker">
    <label htmlFor={id}>{title}</label>
    <select id={id} value={selected ? value : ''} disabled={disabled || !options.length}
      onChange={(event) => { if (!disabled && options.includes(event.currentTarget.value)) onChange(event.currentTarget.value); }}>
      {!selected && <option value="" disabled>{value ? `Current: ${humanize(value)}` : 'Unavailable'}</option>}
      {options.map((option) => <option value={option} key={option}>{humanize(option)}</option>)}
    </select>
    {!options.length && <p className="native-control-note">No options available.</p>}
  </div>;
}

function ClimateArc({ limits, target, low, high, action }: { limits?: Range; target?: number; low?: number; high?: number; action?: string }) {
  const valid = (value: number | undefined): value is number =>
    !!limits && value !== undefined && value >= limits.min && value <= limits.max;
  const fraction = (value: number) => (value - limits!.min) / (limits!.max - limits!.min);
  const dual = valid(low) && valid(high) && low <= high;
  const marks = dual ? [{ value: low!, color: 'heat' }, { value: high!, color: 'cool' }]
    : valid(target) ? [{ value: target, color: action === 'heating' ? 'heat' : action === 'cooling' ? 'cool' : 'target' }] : [];
  const arc = 'M 42.22 197.78 A 110 110 0 1 1 197.78 197.78';
  return <svg className="native-control-dial-arc" viewBox="0 0 240 240" aria-hidden="true">
    <path d={arc} className="native-control-dial-track"/>
    {dual && <>
      <path d={arc} pathLength="100" className="native-control-dial-heat" strokeDasharray={`${fraction(low!) * 100} 100`}/>
      <path d={arc} pathLength="100" className="native-control-dial-cool" strokeDasharray={`${(1 - fraction(high!)) * 100} 100`} strokeDashoffset={-fraction(high!) * 100}/>
    </>}
    {marks.map(({ value, color }, index) => {
      const angle = (135 + fraction(value) * 270) * Math.PI / 180;
      return <circle key={index} cx={120 + 110 * Math.cos(angle)} cy={120 + 110 * Math.sin(angle)}
        r="7" className={`native-control-dial-marker native-control-dial-${color}`}/>;
    })}
  </svg>;
}

export function NativeEntityControl(props: {
  component: Component; entity: Values | undefined; editing: boolean; disabled?: boolean;
  onAction: (action?: Action) => void; onSelect: () => void; onOpen?: () => void;
}) {
  return <EntityControl key={`${text(props.component.props.entityId)}:${text(props.component.props.controlKind)}`} {...props}/>;
}

function EntityControl({ component, entity, editing, disabled: externallyDisabled, onAction, onSelect, onOpen }: Parameters<typeof NativeEntityControl>[0]) {
  const kind = text(component.props.controlKind) ?? 'sensor';
  const entityId = text(component.props.entityId) ?? '';
  const domain = entityId.split('.')[0];
  const state = text(entity?.state);
  const allowed: Record<string, string[]> = {
    light: ['light'], climate: ['climate'], cover: ['cover'], fan: ['fan'],
    select: ['select', 'input_select'], toggle: ['switch', 'input_boolean', 'light', 'fan', 'humidifier'],
    media: ['media_player'], vacuum: ['vacuum'], humidifier: ['humidifier'], number: ['number', 'input_number'],
  };
  const pressAction = kind === 'sensor' && ['button', 'input_button'].includes(domain)
    && component.action?.type === 'service' && component.action.domain === domain
    && component.action.entityId === entityId && component.action.service === 'press';
  const available = /^[a-z0-9_]+\.[a-z0-9_]+$/.test(entityId) && (!unavailableState(state) || pressAction && state === 'unknown')
    && (kind === 'sensor' || !!allowed[kind]?.includes(domain));
  const navigationDisabled = editing || externallyDisabled === true || component.props.disabled === true;
  const disabled = navigationDisabled || component.props.readOnly === true || !available;
  const opensDestination = kind === 'media' && (component.action?.type === 'modal' || component.action?.type === 'navigate');
  const open = () => { if (!navigationDisabled) { if (onOpen) onOpen(); else onAction(component.action); } };
  const source = (value: Json | undefined, ...constraints: (Json | undefined)[]) => JSON.stringify([state, value, available, ...constraints]);
  const [on, setOn] = useDraft(source(entity?.state), state === 'on');
  const brightness = numeric(entity?.brightness);
  const [brightnessPercent, setBrightness] = useDraft(source(entity?.brightness, entity?.supportedColorModes, entity?.supportedFeatures),
    brightness === undefined || brightness < 0 || brightness > 255 ? undefined : Math.round(brightness / 255 * 100));
  const target = numeric(entity?.targetTemp ?? entity?.temperature);
  const [setpoint, setSetpoint] = useDraft(source(entity?.targetTemp ?? entity?.temperature, entity?.minTemp, entity?.maxTemp, entity?.targetTempStep, entity?.supportedFeatures), target);
  const [hvacMode, setHvacMode] = useDraft(source(entity?.hvacMode ?? entity?.state, entity?.hvacModes), text(entity?.hvacMode) ?? state);
  const [position, setPosition] = useDraft(source(entity?.currentPosition, entity?.supportedFeatures), numeric(entity?.currentPosition));
  const [percentage, setPercentage] = useDraft(source(entity?.percentage, entity?.percentageStep, entity?.supportedFeatures), numeric(entity?.percentage));
  const [option, setOption] = useDraft(source(entity?.state, entity?.options), state);
  const volumeLevel = numeric(entity?.volumeLevel);
  const [volume, setVolume] = useDraft(source(entity?.volumeLevel, entity?.supportedFeatures),
    volumeLevel === undefined || volumeLevel < 0 || volumeLevel > 1 ? undefined : volumeLevel);
  const [playing, setPlaying] = useDraft(source(entity?.state), state === 'playing');
  const [humidity, setHumidity] = useDraft(source(entity?.targetHumidity ?? entity?.humidity, entity?.minHumidity, entity?.maxHumidity), numeric(entity?.targetHumidity ?? entity?.humidity));
  const parsedState = state?.trim() && Number.isFinite(Number(state)) ? Number(state) : undefined;
  const [numberValue, setNumberValue] = useDraft(source(entity?.state, entity?.min, entity?.max, entity?.step), parsedState);
  const send = (service: string, data?: Values) => {
    if (disabled) return;
    onAction({ type: 'service', domain, service, entityId, ...(data ? { data } : {}) });
  };
  const actionButton = (title: string, icon: ReactNode, service: string, supported: boolean, data?: Values) =>
    <button type="button" disabled={disabled || !supported} onClick={() => send(service, data)}>{icon}<span>{title}</span></button>;
  const power = <button className="native-control-power" type="button" aria-label={label(component, 'powerLabel', !available || !['on', 'off'].includes(state ?? '') ? 'Power unavailable' : on ? 'Turn off' : 'Turn on')}
    aria-pressed={on} disabled={disabled || !['on', 'off'].includes(state ?? '')}
    onClick={() => { setOn(!on); send(on ? 'turn_off' : 'turn_on'); }}><Power aria-hidden="true"/><span>{!available || !['on', 'off'].includes(state ?? '') ? 'Unavailable' : on ? 'On' : 'Off'}</span></button>;
  const Icon = kind === 'light' ? Lightbulb : kind === 'climate' ? Thermometer : kind === 'fan' ? Fan
    : kind === 'humidifier' ? Droplets : kind === 'toggle' ? Power : SlidersHorizontal;
  let content: ReactNode;
  if (kind === 'light') {
    const modes = strings(entity?.supportedColorModes);
    const supportsBrightness = modes.some((mode) => ['brightness', 'color_temp', 'hs', 'xy', 'rgb', 'rgbw', 'rgbww', 'white'].includes(mode))
      || (numeric(entity?.supportedFeatures) !== undefined && feature(entity, 1));
    const kelvinLimits = range(entity?.minColorTempKelvin, entity?.maxColorTempKelvin, 1);
    content = <><div className="native-control-light-body">{power}
      <div className="native-control-brightness-tile" style={{ '--native-control-level': `${Math.min(100, Math.max(0, brightnessPercent ?? 0))}%` } as CSSProperties}>
        <Lightbulb size={32} aria-hidden="true"/>
        <NativeRange title={label(component, 'brightnessLabel', 'Brightness')} value={brightnessPercent} limits={{ min: 0, max: 100, step: 1 }}
          disabled={disabled || !supportsBrightness} unit="%" onChange={(value) => { setBrightness(value); setOn(value > 0); send(value === 0 ? 'turn_off' : 'turn_on', value === 0 ? undefined : { brightness_pct: value }); }}/>
        {!supportsBrightness && <p className="native-control-note">Brightness control unavailable.</p>}
      </div>
    </div>
      {modes.includes('color_temp') && <ColorTemperature key={entityId} value={numeric(entity?.colorTempKelvin)} source={source(entity?.colorTempKelvin, entity?.minColorTempKelvin, entity?.maxColorTempKelvin)}
        limits={kelvinLimits} disabled={disabled} title={label(component, 'colorTemperatureLabel', 'Color temperature')} send={send}/>}
    </>;
  } else if (kind === 'climate') {
    const limits = range(entity?.minTemp, entity?.maxTemp, entity?.targetTempStep);
    const canSet = !disabled && !!limits && setpoint !== undefined && setpoint >= limits.min && setpoint <= limits.max && feature(entity, 1);
    const change = (value: number) => { if (canSet && limits) { const next = clamp(value, limits); setSetpoint(next); send('set_temperature', { temperature: next }); } };
    const modes = strings(entity?.hvacModes).filter((mode) => ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'].includes(mode));
    const reading = (value: Json | undefined) => numeric(value) === undefined ? 'Unavailable'
      : `${Number(numeric(value)!.toFixed(2))}\u00b0${(text(entity?.unit) ?? '').replace('\u00b0', '')}`;
    content = <>
      <div className="native-control-dial" data-thermal-state={text(entity?.hvacAction)}>
        <ClimateArc limits={limits} target={setpoint} low={numeric(entity?.targetTempLow)} high={numeric(entity?.targetTempHigh)} action={text(entity?.hvacAction)}/>
        <div className="native-control-dial-reading"><span>{text(entity?.hvacAction) ? humanize(text(entity?.hvacAction)!) : label(component, 'currentLabel', 'Current temperature')}</span>
          <strong className="native-control-dial-current" aria-label={`Current ${reading(entity?.currentTemperature)}`}>
            {numeric(entity?.currentTemperature) === undefined ? '--' : reading(entity?.currentTemperature)}
          </strong>
          <span>{label(component, 'targetLabel', 'Set to')} {numeric(entity?.targetTempLow) !== undefined && numeric(entity?.targetTempHigh) !== undefined
            ? `${reading(entity?.targetTempLow)} \u00b7 ${reading(entity?.targetTempHigh)}`
            : reading(setpoint)}</span>
        </div>
      </div>
      <div className="native-control-stepper">
        <button type="button" aria-label="Decrease temperature" disabled={!canSet || setpoint! <= limits!.min}
          onClick={() => change(setpoint! - limits!.step)}><Minus aria-hidden="true"/></button>
        <span>{label(component, 'temperatureLabel', 'Temperature')}{text(entity?.unit) ? ` (${text(entity?.unit)})` : ''}</span>
        <button type="button" aria-label="Increase temperature" disabled={!canSet || setpoint! + limits!.step > limits!.max}
          onClick={() => change(setpoint! + limits!.step)}><Plus aria-hidden="true"/></button>
      </div>
      {!canSet && !disabled && <p className="native-control-note">Temperature control unavailable: a target, supported temperature control, and valid limits are required.</p>}
      <NativePicker title={label(component, 'modeLabel', 'Mode')} value={hvacMode} options={modes} disabled={disabled}
        onChange={(value) => { setHvacMode(value); send('set_hvac_mode', { hvac_mode: value }); }}/>
    </>;
  } else if (kind === 'cover') {
    content = <>
      <div className="native-control-cover" aria-hidden="true"><span style={{ height: position === undefined ? '0%' : `${Math.min(100, Math.max(0, 100 - position))}%` }}/></div>
      <NativeRange title={label(component, 'positionLabel', 'Position')} value={position} limits={{ min: 0, max: 100, step: 1 }} disabled={disabled || !feature(entity, 4)} unit="%"
        onChange={(value) => { setPosition(value); send('set_cover_position', { position: value }); }}/>
      <div className="native-control-actions">
        {actionButton(label(component, 'openLabel', 'Open'), <ArrowUp aria-hidden="true"/>, 'open_cover', feature(entity, 1))}
        {actionButton(label(component, 'stopLabel', 'Stop'), <Square aria-hidden="true"/>, 'stop_cover', feature(entity, 8))}
        {actionButton(label(component, 'closeLabel', 'Close'), <ArrowDown aria-hidden="true"/>, 'close_cover', feature(entity, 2))}
      </div>
    </>;
  } else if (kind === 'fan') {
    content = <>{power}<NativeRange title={label(component, 'speedLabel', 'Speed')} value={percentage}
      limits={range(0, 100, entity?.percentageStep)} disabled={disabled || !feature(entity, 1)} unit="%"
      onChange={(value) => { setPercentage(value); send('set_percentage', { percentage: value }); }}/></>;
  } else if (kind === 'select') {
    const options = strings(entity?.options);
    content = component.props.choiceList === true ? <div className="native-control-choices" role="group" aria-label={component.title}>
      {options.map(value => <button type="button" key={value} aria-pressed={option === value} disabled={disabled}
        onClick={() => { if (!disabled) { setOption(value); send('select_option', { option: value }); } }}>
        <span className="native-choice-check">{option === value && <Check aria-hidden="true"/>}</span><span>{humanize(value)}</span>
      </button>)}
      {!options.length && <p className="native-control-note">No options available.</p>}
    </div> : <NativePicker title={label(component, 'optionLabel', 'Selection')} value={option} options={options} disabled={disabled}
      onChange={(value) => { setOption(value); send('select_option', { option: value }); }}/>;
  } else if (kind === 'media') {
    const canTransport = ['playing', 'paused', 'idle'].includes(state ?? '');
    content = <>
      {text(entity?.mediaTitle) && <div className="native-control-now-playing"><strong>{text(entity?.mediaTitle)}</strong><span>{text(entity?.mediaArtist)}</span></div>}
      <div className="native-control-actions"><button type="button" disabled={disabled || !canTransport || !feature(entity, playing ? 1 : 512)}
        onClick={() => { setPlaying(!playing); send(playing ? 'media_pause' : 'media_play'); }}>
        {playing ? <Pause aria-hidden="true"/> : <Play aria-hidden="true"/>}<span>{label(component, playing ? 'pauseLabel' : 'playLabel', playing ? 'Pause' : 'Play')}</span>
      </button></div>
      <NativeRange title={label(component, 'volumeLabel', 'Volume')} value={volume === undefined ? undefined : Math.round(volume * 100)} limits={{ min: 0, max: 100, step: 1 }}
        disabled={disabled || !feature(entity, 4)} unit="%" onChange={(value) => { setVolume(value / 100); send('volume_set', { volume_level: value / 100 }); }}/>
    </>;
  } else if (kind === 'vacuum') {
    content = <>
      {numeric(entity?.batteryLevel) !== undefined && <p className="native-control-note">Battery {measure(entity?.batteryLevel)}%</p>}
      <div className="native-control-actions">
        {actionButton(label(component, 'startLabel', 'Start'), <Play aria-hidden="true"/>, 'start', feature(entity, 8192))}
        {actionButton(label(component, 'pauseLabel', 'Pause'), <Pause aria-hidden="true"/>, 'pause', feature(entity, 4))}
        {actionButton(label(component, 'returnLabel', 'Return'), <Home aria-hidden="true"/>, 'return_to_base', feature(entity, 16))}
      </div>
    </>;
  } else if (kind === 'humidifier') {
    content = <>{power}<div className="native-control-humidity-reading"><Droplets aria-hidden="true"/><strong>{numeric(entity?.currentHumidity) === undefined ? '--' : `${measure(entity?.currentHumidity)}%`}</strong><span>Current humidity</span></div>
      <NativeRange title={label(component, 'humidityLabel', 'Target humidity')} value={humidity} limits={range(entity?.minHumidity, entity?.maxHumidity, 1)}
        disabled={disabled} unit="%" onChange={(value) => { setHumidity(value); send('set_humidity', { humidity: value }); }}/></>;
  } else if (kind === 'number') {
    content = <NativeRange title={label(component, 'valueLabel', 'Value')} value={numberValue} limits={range(entity?.min, entity?.max, entity?.step)} disabled={disabled}
      unit={text(entity?.unit) ? ` ${text(entity?.unit)}` : ''} onChange={(value) => { setNumberValue(value); send('set_value', { value }); }}/>;
  } else if (kind === 'toggle') {
    content = component.props.checkRow === true ? <button type="button" className="native-check-row" aria-pressed={on}
      disabled={disabled || !['on', 'off'].includes(state ?? '')} onClick={() => { setOn(!on); send(on ? 'turn_off' : 'turn_on'); }}>
      <span className="native-choice-check">{on && <Check aria-hidden="true"/>}</span><span>{component.title}
        {(component.props.checkedText || component.props.uncheckedText) && <small>{!['on', 'off'].includes(state ?? '') ? 'Unavailable'
          : on ? label(component, 'checkedText', 'Included') : label(component, 'uncheckedText', 'Skipped')}</small>}</span>
    </button> : <div className="native-control-switch-row"><span>{label(component, 'powerLabel', 'Power')}</span>
      <button type="button" role="switch" aria-label={label(component, 'powerLabel', component.title || 'Power')} aria-checked={on}
        disabled={disabled || !['on', 'off'].includes(state ?? '')} onClick={() => { setOn(!on); send(on ? 'turn_off' : 'turn_on'); }}>
        <span className="native-control-switch-track"><span/></span><span>{!available || !['on', 'off'].includes(state ?? '') ? 'Unavailable' : on ? 'On' : 'Off'}</span>
      </button></div>;
  } else if (pressAction) {
    content = <button type="button" disabled={disabled} onClick={() => { if (!disabled) open(); }}>{label(component, 'pressLabel', component.title || 'Press')}</button>;
  } else {
    content = <p className="native-control-sensor-value">{available ? `${state}${text(entity?.unit) ? ` ${text(entity?.unit)}` : ''}` : 'Unavailable'}</p>;
  }
  return <section className={`native-control native-control-${kind}${component.props.checkRow === true ? ' native-control-check' : ''}`} data-component-id={component.id} data-unavailable={!available || undefined}
    onClick={(event) => { event.stopPropagation(); if (editing) onSelect(); }}>
    <header className="native-control-heading">
      <Icon aria-hidden="true"/>
      <div><h3>{opensDestination ? <button className="native-control-open" type="button" disabled={navigationDisabled} onClick={open} aria-label={label(component, 'openLabel', `Open ${component.title} remote`)}>{component.title}<ChevronRight size={18} aria-hidden="true"/></button> : component.title}</h3><p role="status">{!available ? 'Unavailable' : text(component.props.statusLabel) ?? (pressAction && state === 'unknown' ? 'Ready' : humanize(state!))}</p></div>
      {editing && <button type="button" className="native-control-select" onClick={(event) => { event.stopPropagation(); onSelect(); }} aria-label={`Select ${component.title}`}>Select</button>}
    </header>
    {component.subtitle && <p className="native-control-note">{component.subtitle}</p>}
    {content}
  </section>;
}

function ColorTemperature({ value, source, limits, disabled, title, send }: {
  value: number | undefined; source: string; limits: Range | undefined; disabled: boolean; title: string;
  send: (service: string, data?: Values) => void;
}) {
  const [draft, setDraft] = useDraft(source, value);
  return <NativeRange title={title} value={draft} limits={limits} disabled={disabled} unit=" K"
    onChange={(next) => { setDraft(next); send('turn_on', { color_temp_kelvin: next }); }}/>;
}
