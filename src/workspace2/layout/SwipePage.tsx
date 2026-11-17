import type { ReactNode } from 'react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { type CompositionDocument } from '../../shared/composition/schema';
import { defaultDetent, type SwipeTile, type TileSwipe } from '../../shared/composition/tile-swipe';
import { formatSwipe, numberText } from '../../preview2/tile-swipe';
import { ensureSource } from '../add/sources';
import { ObjectRows } from '../rows';
import { useRows } from '../rowsContext';
import { ChoiceRow } from '../SegmentRow';
import { LabeledRow, Switch, TextInput } from '../editors/controls';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { lightSwipe, presetOf, presetsFor, presetSwipe, presetWords, releaseSentence, swipeChecks, type SwipeCheck, type SwipePreset } from './swipe-presets';
import { swipeTileOf } from './SwipeRow';

type Tile = { type?: string; title?: string; binding?: { entityId: string }; action?: unknown; props: { swipe?: TileSwipe; discs?: unknown[]; progress?: unknown } & Record<string, unknown> };

/** The nodes that hold `path`, outermost first: whether the tile sits in a row that scrolls sideways. */
function inSidewaysRow(document: CompositionDocument, path: EditorPath): boolean {
  for (let depth = 1; depth < path.length; depth++) {
    const ancestor = valueAt(document, path.slice(0, depth)) as { type?: string } | undefined;
    if (ancestor?.type === 'paged-row' || ancestor?.type === 'status-rail') return true;
  }
  return false;
}

/** A line under a row: the check that concerns it. */
const Line = ({ check }: { check: SwipeCheck }) => <p className="w2-caption w2-swipe-line" role="note" data-check={check.id} data-tone={check.tone}>{check.text}</p>;

/**
 * The page the Swipe to Adjust row opens (`build/design/tile-swipe.md`, section 6): a switch, off by default; then, for a state tile, the Adjusts menu
 * and the range, the ticks, the band, the bubble's words and the name; for a light group tile the same read-only where the light source owns it.
 * A preset only fills fields: the document holds the expanded swipe.
 */
export default function SwipePage({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const { house } = useWorkspaceData();
  const tile = valueAt(document, path) as Tile | undefined;
  const kind = swipeTileOf(tile?.type) as SwipeTile | undefined;
  if (!tile || !kind) return null;
  const swipe = tile.props.swipe;
  const swipePath = [...path, 'props', 'swipe'];
  const entityId = tile.binding?.entityId;
  const entity = entityId ? house?.states?.get(entityId) : undefined;
  const write = (next: TileSwipe | undefined) => {
    const props = { ...tile.props } as Record<string, unknown>;
    if (next) props.swipe = next; else delete props.swipe;
    onChange(replaceAt(document, [...path, 'props'], props));
  };
  const turnOn = (preset?: SwipePreset) => {
    if (kind === 'light-group-tile') { write(lightSwipe()); return; }
    const chosen = preset ?? presetsFor(entityId)[0];
    const made = entityId ? ensureSource(document, entityId) : { document, sourceId: '' };
    const next = presetSwipe(chosen, entityId ?? 'input_number.value', made.sourceId, entity ?? {});
    const props = { ...tile.props, swipe: next } as Record<string, unknown>;
    onChange(replaceAt(made.document, [...path, 'props'], props));
  };
  const patch = (changes: Partial<TileSwipe>) => swipe && write({ ...swipe, ...changes });
  const without = (key: keyof TileSwipe) => { if (!swipe) return; const { [key]: _gone, ...rest } = swipe; void _gone; write(rest as TileSwipe); };
  const number = (text: string): number | undefined => { const value = Number(text); return text.trim() !== '' && Number.isFinite(value) ? value : undefined; };
  const field = (label: string, value: number | undefined, change: (next: number) => void, placeholder?: string) =>
    <LabeledRow label={label}><TextInput label={label} number value={value === undefined ? '' : numberText(value)} placeholder={placeholder} onCommit={text => { const next = number(text); if (next !== undefined) change(next); }}/></LabeledRow>;
  const checks = swipe ? swipeChecks(swipe, {
    tile: kind, inSidewaysRow: inSidewaysRow(document, path), deviceClass: entity?.deviceClass,
    hasProgress: tile.props.progress !== undefined, hasOtherControl: Boolean(tile.props.discs?.length) || tile.action !== undefined,
  }) : [];
  const under = (row: SwipeCheck['row']): ReactNode => checks.filter(check => check.row === row).map(check => <Line key={check.id} check={check}/>);
  const presets = presetsFor(entityId);
  const preset = swipe ? presetOf(swipe) : presets[0];

  return <div className="w2-editor-page" data-testid="swipe-page" data-field-path={swipePath.join('/')}>
    <Switch label="Swipe to Adjust" checked={swipe !== undefined} onChange={on => on ? turnOn() : write(undefined)}/>
    {swipe === undefined && <p className="w2-caption">Drag sideways on the tile to set a value. Off unless you turn it on.</p>}
    {swipe && kind === 'light-group-tile' && <>
      <LabeledRow label="Adjusts"><span data-testid="swipe-adjusts-text">Brightness</span></LabeledRow>
      <LabeledRow label="Range"><span data-testid="swipe-range-text">0 to 100%</span></LabeledRow>
      {field('Tick Every', swipe.detent ?? defaultDetent(swipe.range), next => patch({ detent: next }), '10')}
      {under('tick')}
      <Switch label="Haptic Ticks" checked={swipe.haptic !== 'none'} onChange={on => on ? without('haptic') : patch({ haptic: 'none' })}/>
      <Switch label="Level Band" checked={swipe.band !== false} onChange={on => on ? without('band') : patch({ band: false })}/>
      {under('band')}
      <p className="w2-caption">The light source sends the call.</p>
    </>}
    {swipe && kind === 'state-tile' && <>
      <ChoiceRow label="Adjusts" value={preset} options={presets.map(item => ({ value: item, label: presetWords[item] }))}
        onChange={next => { const made = entityId ? ensureSource(document, entityId) : { document, sourceId: '' }; const swiped = presetSwipe(next as SwipePreset, entityId ?? 'input_number.value', made.sourceId, entity ?? {}); onChange(replaceAt(made.document, [...path, 'props'], { ...tile.props, swipe: swiped })); }}/>
      {under('adjusts')}
      {field('Minimum', swipe.range.min, next => patch({ range: { ...swipe.range, min: next } }))}
      {field('Maximum', swipe.range.max, next => patch({ range: { ...swipe.range, max: next } }))}
      {field('Step', swipe.range.step, next => patch({ range: { ...swipe.range, step: next } }))}
      {under('range')}
      {field('Tick Every', swipe.detent ?? defaultDetent(swipe.range), next => patch({ detent: next }))}
      <p className="w2-caption">A haptic tick, and one VoiceOver step.</p>
      {under('tick')}
      <Switch label="Haptic Ticks" checked={swipe.haptic !== 'none'} onChange={on => on ? without('haptic') : patch({ haptic: 'none' })}/>
      <Switch label="Level Band" checked={swipe.band !== false} onChange={on => on ? without('band') : patch({ band: false })}/>
      {swipe.band === false && <p className="w2-caption">The tile shows no band. The bubble still shows the value.</p>}
      {under('band')}
      <LabeledRow label="Value Text"><TextInput label="Value Text" value={swipe.format ?? ''} placeholder="{value}" maxLength={80} onCommit={text => text ? patch({ format: text }) : without('format')}/></LabeledRow>
      <p className="w2-caption">Shows {formatSwipe(swipe.format, swipe.range.min)} to {formatSwipe(swipe.format, swipe.range.max)}.</p>
      {under('text')}
      <LabeledRow label="Name"><TextInput label="Name" value={swipe.label ?? ''} placeholder="position" maxLength={40} onCommit={text => text ? patch({ label: text }) : without('label')}/></LabeledRow>
      <p className="w2-caption">VoiceOver says “Swipe up or down to adjust {swipe.label || 'position'}.”</p>
      <LabeledRow label="When You Let Go"><span data-testid="swipe-release">{releaseSentence(swipe, kind)}</span></LabeledRow>
      {under('call')}
      <ObjectRows path={swipePath} owner="tile-swipe" groups={['advanced']} skip={at => !['value', 'action'].includes(String(at.at(-1))) || at.length > swipePath.length + 1}/>
    </>}
    {under('page')}
    {swipe && <p className="w2-caption" data-testid="swipe-foot">A drag sends one call when you let go. Haptics are felt on a device only. Switch to Use to try the drag. The preview cannot show haptics, VoiceOver, or how the app settles a swipe against paging, scrolling and the back swipe.</p>}
  </div>;
}
