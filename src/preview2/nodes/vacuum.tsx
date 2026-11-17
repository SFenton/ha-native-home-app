import { BatteryFull, ChevronRight, ChevronsUpDown, CircleCheck, Home, Play, Plug, Circle } from 'lucide-react';
import { useMemo, useRef, type CSSProperties } from 'react';
import { useRender } from '../render-context';
import type { VacuumControl } from '../../shared/composition/vacuum';
import { PullDownMenu } from './PullDownMenu';
import { Switch, UseButton, unavailableText, useDevice, useEntity, usePreviewValue, useSharedPreview, useSimulate, stateText, type Device } from './device-shared';
import { Glyph, Pressable, type NodeOf } from './shared';
import { discTileWidths, type TileWidths } from './tile-minimum';
import { useElementWidth } from '../useElementWidth';
import { MapPicture, flipName, flipStyle, useValetudoMap } from './MapPicture';
import { MapControls } from './MapControls';
import { effectiveControls, flips } from '../../shared/composition/surface-controls';
import type { ValetudoMap } from '../valetudo-map';

type Primitive = VacuumControl['props']['primitive'];
const words = (text: string) => text.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const stoppers = ['stop', 'cancelResume', 'cancelSession', 'stopDockClean', 'stopDrying'];
const commandNames: Record<string, string> = { clean: 'Clean', cleanArea: 'Clean Area', dock: 'Dock', stop: 'Stop', resume: 'Resume', cancelResume: 'Cancel Resume', pause: 'Pause',
  cancelSession: 'Cancel', cleanDock: 'Clean Dock', stopDockClean: 'Stop Dock Clean', dryMops: 'Dry Mops', stopDrying: 'Stop Drying', emptyBin: 'Empty Bin' };

const modeLabels: Record<string, string> = { vacuum: 'Vacuum', mop: 'Mop', vacuum_and_mop: 'Vacuum and Mop' };
/** An option as its row spells it: the cleaning mode in words, passes as `2x`, any other option title-cased (`VacuumController.Setting.label`). */
export function settingLabel(role: 'mode' | 'fan' | 'water' | 'passes', option: string): string {
  if (role === 'mode') { const key = option.trim().toLowerCase().replace(/[\s-]+/g, '_'); return modeLabels[key] ?? words(option); }
  if (role === 'passes') { const count = Number(option); return option.trim() !== '' && Number.isFinite(count) ? `${count}x` : words(option); }
  return words(option);
}

/**
 * One Cleaning Settings row: the title and a pull-down menu of the select's options (`UKVacuumSettingRow`, `showsMenuAsPrimaryAction`).
 * A pick is held by the preview only, shared by every node of the same source and role, and cleared when the mode goes back to Edit.
 */
function VacuumSettingRow({ sourceId, device, role, title, hint }: { sourceId: string; device: Device; role: 'mode' | 'fan' | 'water' | 'passes'; title: string; hint: string }) {
  const { note } = useRender();
  const off = device.phase !== 'ready';
  const live = device.text(role);
  const [picked, setPicked] = useSharedPreview<string | undefined>(`${sourceId}:setting:${role}`, undefined);
  const value = picked ?? live;
  const options = device.get<string[]>(`${role}Options`) ?? [];
  // The value shows even when the select does not list it, first, as the app does.
  const shown = value && !options.includes(value) ? [value, ...options] : options;
  const disabled = off || options.length === 0;
  return <div className="sh-row sh-dv-row" data-state={off ? 'unavailable' : undefined} title={hint}><span className="sh-row-primary">{title}</span>
    <PullDownMenu title={title} className="sh-dv-pulldown" disabled={disabled} selected={value} options={shown.map(option => ({ value: option, label: settingLabel(role, option) }))}
      onSelect={next => { setPicked(next); note?.(`${title}: ${settingLabel(role, next)}`); }}>
      <span className="sh-row-value" data-state={value ? undefined : 'unavailable'}>{value ? settingLabel(role, value) : unavailableText}</span><ChevronsUpDown size={14} aria-hidden="true"/></PullDownMenu></div>;
}

/** The state line a vacuum shows: `Docked • 87%`. */
function line(device: Device): string {
  if (device.phase === 'loading') return 'Loading';
  if (device.phase === 'unavailable') return unavailableText;
  const state = device.text('state'), battery = device.number('battery');
  return [state ? words(state) : undefined, battery === undefined ? undefined : `${Math.round(battery)}%`].filter(Boolean).join(' • ') || unavailableText;
}

/**
 * The map's frame. With a decoded map it draws the vacuum's own (`picture`); without one, a schematic of rooms in the neutral blues,
 * labelled as one: the app draws the real map and the preview has none to read.
 */
function MapCanvas({ height, label, children, picture, tag = 'Schematic', flip, controls }: {
  height: number; label: string; children?: React.ReactNode; picture?: React.ReactNode; tag?: string;
  /** Mirrors the schematic (the picture mirrors itself): the preview shows the flip when the Studio is offline too (`sh.surface-orientation@1`). */
  flip?: { horizontal: boolean; vertical: boolean };
  /** The corners that hold a group, so the tag clears a bottom group and the fallback text clears a button (`build/design/vacuum-map-ctl.md`, Over the map). */
  controls?: { top: boolean; bottom: boolean };
}) {
  return <div className="sh-dv-map" style={{ '--map-h': `${Math.min(height, 420)}px` } as CSSProperties} role="img" aria-label={label} data-flip={flipName(flip)}>
    {picture ?? <div className="sh-dv-rooms" aria-hidden="true" style={flipStyle(flip)}><i/><i/><i/><i/><i/><i/><i/><i/></div>}{children}
    <span className="sh-tag sh-dv-map-tag" data-at={controls?.bottom ? 'center' : undefined}>{tag}</span></div>;
}

const normalized = (text: string) => text.trim().toLowerCase().split(/\s+/).join(' ');
/** The segment ids of the zones switched on, matched by name (`ValetudoMap.selectableRooms`). */
export function selectedSegments(map: ValetudoMap, zones: readonly { mapName: string; on: boolean }[]): Set<string> {
  const wanted = new Set(zones.filter(zone => zone.on).map(zone => normalized(zone.mapName)));
  return new Set(map.layers.filter(layer => layer.type === 'segment' && layer.segmentId && layer.name && wanted.has(normalized(layer.name))).map(layer => layer.segmentId!));
}

/**
 * `vacuum-control` `map`: the vacuum's live map when the Studio is connected (`UKVacuumMapFrame`; the camera picture
 * `camera.<map id>_map_data`), the selected rooms lit on the Rooms overlay; a labelled schematic when it is not.
 */
function VacuumMap({ node, primitive, device }: { node: NodeOf<'vacuum-control'>; primitive: Extract<Primitive, { kind: 'map' }>; device: Device }) {
  const off = device.phase !== 'ready';
  const { map } = useValetudoMap(device.text('mapId'), !off);
  const zones = device.get<{ mapName: string; on: boolean }[]>('zones') ?? [];
  const selected = useMemo(() => map && primitive.overlay === 'rooms' ? selectedSegments(map, zones) : undefined, [map, primitive.overlay, JSON.stringify(zones)]);
  // The flip is the source's own setting, so it shows while the data is loading and when the Studio is offline.
  const { sources } = useRender();
  const found = sources?.find(item => item.id === node.props.sourceId);
  const orientation = found?.kind === 'model' && found.model === 'vacuum@1' ? found.inputs.orientation : undefined;
  const flip = { horizontal: orientation?.flipHorizontal === true, vertical: orientation?.flipVertical === true };
  const groups = effectiveControls(primitive);
  const authored = primitive.controls !== undefined;
  const at = { top: authored && groups.some(group => group.corner.startsWith('top')), bottom: groups.some(group => group.corner.startsWith('bottom')) };
  return <MapCanvas height={primitive.height} label={primitive.label} tag={map ? off ? 'Last reported map' : 'Live map' : 'Schematic'} flip={flip} controls={at}
    picture={map ? <MapPicture map={map} selected={selected} reported={off} flip={flips({ flipHorizontal: flip.horizontal, flipVertical: flip.vertical }) ? flip : undefined}/> : undefined}>
    {groups.length > 0 && <MapControls nodeId={node.id} primitive={primitive} device={device}/>}
    {off && !map && <span className="sh-dv-map-note" style={authored ? { paddingBlock: `${at.top ? 60 : 0}px ${at.bottom ? 60 : 0}px` } : undefined}>{device.phase === 'loading' ? primitive.loadingText : primitive.unavailableText}</span>}</MapCanvas>;
}

/**
 * How the tile draws for the room it was given, in the order `ViewThatFits` tries them (`UKGlassTileView.fit(forWidth:)`): `natural`
 * when the room reaches the minimum, `ticker` (the text clipped, the discs trailing) down to the floor, and `below` (the discs under
 * the text) under it. A tile can never paint its text under its controls.
 */
export type TileFit = 'natural' | 'ticker' | 'below';
/** The fit for `available` points of room (a half point of tolerance, as the app has); `natural` until the tile is measured. */
export function tileFit(available: number, widths: TileWidths): TileFit {
  if (!(available > 0) || available + .5 >= widths.minimum) return 'natural';
  return available + .5 >= widths.floor ? 'ticker' : 'below';
}

/** `vacuum-control` `card`: the robot's navigation tile, with its start/pause and dock discs (`UKServerUIVacuumView`). */
function VacuumTile({ node, primitive, device }: { node: NodeOf<'vacuum-control'>; primitive: Extract<Primitive, { kind: 'card' }>; device: Device }) {
  const { run } = useRender();
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const fit = tileFit(width, discTileWidths(node.title, primitive.commands.length));
  const off = device.phase !== 'ready', state = device.text('state') ?? '';
  const cleaning = ['cleaning', 'returning'].includes(state), docked = state === 'docked';
  return <div ref={ref} className={`sh-dv-card-tile ${cleaning ? 'sh-dv-lit' : ''}`.trim()} data-fit={fit} data-state={off ? 'unavailable' : undefined}>
    <Pressable action={primitive.destination} className="sh-dv-card-face"><span className="sh-dv-card-glyph"><Glyph symbol={primitive.icon} size={22}/></span>
      <span className="sh-row-copy"><strong>{node.title}</strong><span>{line(device)}</span></span></Pressable>
    <span className="sh-dv-card-discs">
      {primitive.commands.includes('start_pause') && <UseButton className="sh-dv-disc" label={cleaning ? `Pause ${node.title}` : `Start ${node.title}`} onPress={() => undefined} disabled={off}><Play size={16} fill="currentColor"/></UseButton>}
      {primitive.commands.includes('dock') && <UseButton className="sh-dv-disc" label={`Dock ${node.title}`} onPress={() => undefined} disabled={off || docked}><Home size={16}/></UseButton>}
    </span>
    <UseButton className="sh-dv-chev" label={`Open ${node.title}`} onPress={() => run(primitive.destination)}><ChevronRight size={16}/></UseButton></div>;
}

/** What the automatic-cleaning control shows: `Enabled`, `Paused` or `Unavailable` (`VacuumAutoCleanController.display`). A pause switch is on while cleaning is paused. */
export function autoCleanDisplay(kind: string | undefined, state: string | undefined): { enabled: boolean; unavailable: boolean; subtitle: string } {
  if (!state || ['unavailable', 'unknown'].includes(state.trim().toLowerCase())) return { enabled: false, unavailable: true, subtitle: 'Unavailable' };
  const enabled = kind === 'pause' ? state !== 'on' : state === 'on';
  return { enabled, unavailable: false, subtitle: enabled ? 'Enabled' : 'Paused' };
}

/**
 * `vacuum-control` `auto-clean`: one switch row for the automation that cleans by itself, as the app draws it (`UKModuleToggleRow`,
 * `clock.arrow.circlepath`, "Turns automatic cleaning on or off."). The per-room choices belong to the sheet's Auto-Clean tab.
 */
function AutoCleanRow({ node, device }: { node: NodeOf<'vacuum-control'>; device: Device }) {
  const entityId = device.text('autoEntityId'), kind = device.text('autoKind');
  const entity = useEntity(entityId);
  const send = useSimulate();
  if (!entityId) return <div className="sh-info sh-tone-warning" role="note">Automatic cleaning is unavailable.</div>;
  const shown = autoCleanDisplay(kind, entity?.state);
  const hint = 'Turns automatic cleaning on or off.';
  return <div className="sh-dv-list" role="group" aria-label={node.title}><div className="sh-row sh-dv-row" title={hint} data-state={shown.unavailable ? 'unavailable' : undefined}>
    <span className="sh-row-glyph"><Glyph symbol={{ name: 'clock.arrow.circlepath' }} size={20}/></span>
    <span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span><span className="sh-row-secondary">{shown.subtitle}</span></span>
    <Switch on={shown.enabled} label={node.title} disabled={shown.unavailable}
      onChange={next => { const on = kind === 'pause' ? !next : next; send(entityId, on ? 'turn_on' : 'turn_off'); }}/></div></div>;
}

/** `vacuum-control`: one primitive of the vacuum sheet or page. */
export function VacuumControlNode({ node }: { node: NodeOf<'vacuum-control'> }) {
  const { props } = node, p: Primitive = props.primitive;
  const device = useDevice(props.sourceId);
  const entity = useEntity('entityId' in p ? p.entityId : undefined);
  const send = useSimulate();
  const { run } = useRender();
  const [picked, setPicked] = usePreviewValue<boolean | undefined>(undefined);
  const off = device.phase !== 'ready';
  const state = device.text('state') ?? '';
  const row = (children: React.ReactNode, className = '') => <div className={`sh-row sh-dv-row ${className}`.trim()} data-state={off ? 'unavailable' : undefined}>{children}</div>;

  switch (p.kind) {
    case 'card': return <VacuumTile node={node} primitive={p} device={device}/>;
    case 'map': return <VacuumMap node={node} primitive={p} device={device}/>;
    case 'status': {
      const battery = device.number('battery');
      const metric = { status: { icon: <CircleCheck size={18}/>, label: 'Status', value: state ? words(state) : undefined },
        battery: { icon: <BatteryFull size={18}/>, label: 'Battery', value: battery === undefined ? undefined : `${Math.round(battery)}%` },
        dock: { icon: <Plug size={18}/>, label: 'Dock', value: device.text('dock') ? words(device.text('dock')!) : undefined } }[p.metric];
      return <div className="sh-tile sh-dv-status" role="group" aria-label={metric.label} data-state={off ? 'unavailable' : undefined}><span className="sh-tile-glyph sh-dv-ok">{metric.icon}</span>
        <span className="sh-tile-line">{metric.label}</span><span className="sh-tile-title">{off ? unavailableText : metric.value ?? unavailableText}</span></div>;
    }
    case 'notices': {
      const error = device.text('error'), battery = device.number('battery');
      const text = error && !['none', 'ok', 'no_error'].includes(error.toLowerCase()) ? words(error) : battery !== undefined && battery < 20 ? `Battery low (${Math.round(battery)}%)` : undefined;
      return <div className={`sh-info ${text ? 'sh-tone-warning' : ''}`.trim()} role="note" data-quiet={text ? undefined : ''}>{off ? unavailableText : text ?? 'No notices'}</div>;
    }
    case 'auto-clean': return <AutoCleanRow node={node} device={device}/>;
    case 'settings': return <div className="sh-dv-list" role="group" aria-label={node.title}>{p.rows.map(item =>
      <VacuumSettingRow key={item.role} sourceId={node.props.sourceId} device={device} role={item.role} title={item.title} hint={item.hint}/>)}</div>;
    case 'command': {
      const stop = stoppers.includes(p.command);
      return <UseButton className={`sh-dv-action ${stop ? 'sh-dv-danger-tile' : ''}`.trim()} onPress={() => undefined} disabled={off}><span className="sh-tile-glyph"><Glyph symbol={p.icon} size={22}/></span>
        <span>{node.title || commandNames[p.command]}</span></UseButton>;
    }
    case 'choice': {
      const on = picked ?? entity?.state === 'on';
      return <UseButton className="sh-dv-choice" onPress={() => { setPicked(!on); send(entity?.entityId, 'toggle'); }} label={node.title}><span aria-pressed={on} className="sh-dv-choice-face" data-on={on ? '' : undefined}>
        <span>{node.title}</span>{on ? <CircleCheck size={20} className="sh-dv-check" aria-label="Selected"/> : <Circle size={20} className="sh-dv-off" aria-label="Not selected"/>}</span></UseButton>;
    }
    case 'consumable': {
      const value = entity && !['unavailable', 'unknown'].includes(entity.state) ? `${entity.state}${entity.unit ? ` ${entity.unit}` : ''}` : undefined;
      return row(<><span className="sh-row-primary">{node.title}</span><span className="sh-row-value" data-state={value ? undefined : 'unavailable'}>{value ?? stateText(entity) ?? unavailableText}</span></>);
    }
    case 'report': return <Pressable action={p.destination} className="sh-row sh-dv-row sh-pressable"><span className="sh-row-glyph"><Glyph symbol={{ name: 'clock.arrow.circlepath' }} size={20}/></span>
      <span className="sh-row-copy"><span className="sh-row-primary">{node.title}</span></span><ChevronRight size={16} aria-hidden="true"/></Pressable>;
    case 'outcomes': return <div className="sh-dv-card" data-state={off ? 'unavailable' : undefined}><span className="sh-row-primary">{node.title}</span><span className="sh-row-secondary">{off ? unavailableText : 'No cleaning outcome to show.'}</span></div>;
    case 'target': return <Pressable action={p.destination} className="sh-row sh-dv-row sh-pressable"><span className="sh-row-glyph"><Glyph symbol={p.icon} size={20}/></span>
      <span className="sh-row-primary">{node.title}</span><ChevronRight size={16} aria-hidden="true"/></Pressable>;
    case 'clear-area': return <UseButton className="sh-row sh-dv-row sh-pressable" onPress={() => undefined}><span className="sh-row-glyph"><Glyph symbol={p.icon} size={20}/></span><span className="sh-row-primary sh-dv-accent-text">{node.title}</span></UseButton>;
    case 'area-editor': return <div className="sh-dv-editor"><MapCanvas height={p.height} label={node.title}><span className="sh-dv-area" aria-hidden="true"><i/><i/><i/><i/></span></MapCanvas>
      <div className="sh-dv-editor-actions"><UseButton className="sh-dv-button sh-dv-prominent" onPress={() => run(p.onUse)}>Use Area</UseButton>
        <UseButton className="sh-dv-button sh-dv-danger" onPress={() => run(p.onDiscard)}>{p.discardLabel}</UseButton></div></div>;
  }
}
