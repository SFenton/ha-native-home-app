import { ChevronRight } from 'lucide-react';
import { useSourceRead, type NodeOf } from '../shared';
import { Pressable } from '../shared';
import { weatherGlyphs } from './weather-glyphs';

/** Home Assistant weather conditions mapped to the kit's glyphs and the words the app writes. */
const conditions: Record<string, { glyph: keyof typeof weatherGlyphs; text: string }> = {
  sunny: { glyph: 'sunny', text: 'Sunny' }, 'clear-night': { glyph: 'clear-night', text: 'Clear' }, partlycloudy: { glyph: 'partly-cloudy', text: 'Partly Cloudy' },
  cloudy: { glyph: 'cloudy', text: 'Cloudy' }, fog: { glyph: 'cloudy', text: 'Foggy' }, hail: { glyph: 'snow', text: 'Hail' }, rainy: { glyph: 'rain', text: 'Rain' },
  pouring: { glyph: 'rain', text: 'Heavy Rain' }, lightning: { glyph: 'storm', text: 'Thunderstorm' }, 'lightning-rainy': { glyph: 'storm', text: 'Thunderstorm' },
  snowy: { glyph: 'snow', text: 'Snow' }, 'snowy-rainy': { glyph: 'snow', text: 'Sleet' }, windy: { glyph: 'cloudy', text: 'Windy' }, 'windy-variant': { glyph: 'cloudy', text: 'Windy' },
  exceptional: { glyph: 'cloudy', text: 'Weather Alert' },
};
const hoursOf = ['Now', '', '', '', '', ''];

/** A weather glyph, multicolour like Apple Weather. */
function WeatherGlyph({ kind, size }: { kind: keyof typeof weatherGlyphs; size: number }) {
  return <svg className="sh-wx-glyph" viewBox="9.5 3.7 52.8 50.3" width={size * 1.05} height={size} aria-hidden="true" dangerouslySetInnerHTML={{ __html: weatherGlyphs[kind] }}/>;
}
/** The card's static hour placeholders (`WeatherCardHourPlaceholder`): capsules and a circle at 18% white, nothing animated. */
function HourPlaceholders({ count }: { count: number }) {
  return <div className="sh-wx-hours" aria-hidden="true">{Array.from({ length: count }, (_, i) => <div key={i} className="sh-wx-hour"><i/><i/><i/></div>)}</div>;
}
const dash = <span aria-hidden="true">--</span>;

/**
 * `weather-panel`: the Home weather card in the panel the node asks for (`UKWeatherCard` and its sheet panels). The weather
 * entity gives the condition and temperature. The snapshot carries no forecast, so the hours, days and highlights draw the
 * card's own pending look (static capsules) instead of invented numbers.
 */
export function WeatherPanelNode({ node }: { node: NodeOf<'weather-panel'> }) {
  const { props } = node;
  const phase = useSourceRead(props.sourceId, ['phase']);
  const condition = useSourceRead(props.sourceId, ['condition']);
  const temperature = useSourceRead(props.sourceId, ['temperature']);
  const ready = phase.status === 'value' && phase.value === 'ready';
  const loading = phase.status === 'loading';
  const known = ready && condition.status === 'value' ? conditions[String(condition.value)] ?? { glyph: 'cloudy' as const, text: String(condition.value) } : undefined;
  const label = loading ? props.labels.loading : known?.text ?? props.labels.error;
  const degrees = ready && temperature.status === 'value' && typeof temperature.value === 'number' ? `${Math.round(temperature.value)}°` : undefined;
  const kind = known?.glyph ?? 'cloudy';
  const open = node.action ? props.labels.open : undefined;

  const header = <Pressable action={node.action} className="sh-wx-head" label={open ? `${label}${degrees ? `, ${degrees}` : ''}. ${open}` : undefined}>
    <span className="sh-wx-lead"><WeatherGlyph kind={kind} size={40}/><strong className="sh-wx-label">{label}</strong></span>
    <span className="sh-wx-temp"><span className="sh-wx-num">{degrees ?? dash}</span>{node.action && <ChevronRight size={16} aria-hidden="true"/>}</span>
  </Pressable>;

  switch (props.panel) {
    case 'summary': return <section className="sh-wx sh-wx-card" aria-label={node.title}>{header}<hr/>
      <p className="sh-wx-brief" data-pending="">{props.labels.empty}</p><hr/><HourPlaceholders count={props.compactHours > 6 ? 6 : props.compactHours}/></section>;
    case 'hero': return <section className="sh-wx sh-wx-hero" aria-label={node.title}>
      <WeatherGlyph kind={kind} size={72}/><span className="sh-wx-hero-num">{degrees ?? dash}</span><strong className="sh-wx-label">{label}</strong></section>;
    case 'briefing': return <section className="sh-wx sh-wx-card" aria-label={node.title}><strong className="sh-wx-title">{node.title}</strong>
      <p className="sh-wx-brief" data-pending="">{props.labels.empty}</p></section>;
    case 'hourly': return <section className="sh-wx sh-wx-card" aria-label={node.title}><strong className="sh-wx-title">{node.title}</strong>
      <HourPlaceholders count={hoursOf.length}/></section>;
    case 'daily': return <section className="sh-wx sh-wx-card" aria-label={node.title}><strong className="sh-wx-title">{node.title}</strong>
      <div className="sh-wx-days" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="sh-wx-day"><i/><i/><i/></div>)}</div></section>;
    case 'highlights': return <section className="sh-wx sh-wx-highlights" aria-label={node.title}>
      {props.highlights.map(item => <div key={item} className="sh-wx-high" data-kind={item}><span className="sh-wx-high-name">{highlightName[item]}</span><i aria-hidden="true"/></div>)}</section>;
  }
}
const highlightName: Record<NodeOf<'weather-panel'>['props']['highlights'][number], string> = {
  aqi: 'Air Quality', precipitation: 'Precipitation', accumulation: 'Accumulation', humidity: 'Humidity', cloud: 'Cloud Cover', feels: 'Feels Like',
  uv: 'UV Index', wind: 'Wind', sun: 'Sunrise and Sunset', visibility: 'Visibility', pressure: 'Pressure',
};
