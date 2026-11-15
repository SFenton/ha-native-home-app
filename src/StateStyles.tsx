import { useEffect, useId, useMemo, useState } from 'react';
import { request } from './api';
import { Icon, NumberField, SelectField, TextField } from './ui';
import type { CompositionDocument } from './shared/composition/schema';
import {
  addStateTile, addStyleRule, buildStateMap, classFixed, deleteBlock, deleteStyle, duplicateStyle, editWarning, libraryEntries, moveStyleRule, newStateTile, overrideFor,
  overriddenLayers, patchStyleRule, removeStyleRule, renameStyle, replaceStyle, resetOverride, saveAsNewStyle, setOverride, stateTiles,
  styleFromEntity, updateStateTile, usedByText, type HaState, type StateTileNode,
} from './shared/composition/state-style-library';
import { arcCrossFadeSeconds, previewTile, previewWidths, type TilePreview } from './shared/composition/state-style-preview';
import {
  builtInStyles, colourAllowed, indicatorOptions, overrideLayers, resolveTileStyle, stateClasses, stateColours, suggestBuiltInStyle,
  type OverrideLayer, type StateOverride, type StateRule, type StateStyleDefinition, type StateStyleLibrary,
} from './shared/composition/state-styles';
import './StateStyles.css';

/** The entity the picker lists and the states Home Assistant answers for it (`server/ha-entities.ts`). */
interface PickerEntity { entityId: string; name: string; state: string; deviceClass?: string }
interface EntityStates { entityId: string; deviceClass?: string; states: HaState[]; history: string[]; openEnded: boolean }

/** The note beside a colour menu that a warning, error or unknown state keeps disabled. */
const COLOUR_FOLLOWS_CLASS = 'Colour follows the class';
const colourLabels = { unlit: 'Unlit', lit: 'Lit' } as const;
const comma = (items: string[]) => items.join(', ');
const words = (text: string) => text.split(',').map(item => item.trim()).filter(Boolean);

/** A comma separated list that applies when the field is left, so typing a comma never eats it. */
function ListField({ label, value, onChange, disabled }: { label: string; value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState(comma(value));
  useEffect(() => { setText(comma(value)); }, [value]);
  return <label className="field"><span>{label}</span>
    <input value={text} disabled={disabled} onChange={event => setText(event.target.value)} onBlur={() => { const next = words(text); if (next.length) onChange(next); else setText(comma(value)); }}/>
  </label>;
}

/** Renames a saved style: the field keeps its own text while typing and applies it when it is left or Enter is pressed. */
function RenameField({ name, onRename, onDone }: { name: string; onRename: (next: string) => void; onDone: () => void }) {
  const [text, setText] = useState(name);
  const finish = () => { if (text.trim() && text !== name) onRename(text.trim()); onDone(); };
  return <label className="field"><span>New name for {name}</span>
    <input autoFocus value={text} onChange={event => setText(event.target.value)} onBlur={finish}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); finish(); } if (event.key === 'Escape') { event.preventDefault(); onDone(); } }}/>
  </label>;
}

/** One tile of the preview: the disc or the arc in its place, the face, the words, and the VoiceOver value. */
export function TilePreviewCard({ tile, width, label }: { tile: TilePreview; width: number; label: string }) {
  const id = useId();
  return <figure className={`style-preview-tile class-${tile.colour.class} ${tile.colour.active ? 'lit' : 'unlit'}`} style={{ width, maxWidth: '100%' }}
    aria-labelledby={id} data-preview-width={label.toLowerCase()} data-indicator={tile.indicator} data-class={tile.stateClass}>
    <figcaption id={id}>{label} · {width} pt</figcaption>
    <div className="style-preview-face">
      <span className={`style-preview-glyph effect-${tile.indicator}`} title={tile.icon}><Icon name={tile.icon} size={22}/></span>
      <span className="style-preview-text"><strong>{tile.text}</strong><small>{tile.stateClass}{tile.active ? ', lit' : ''}</small></span>
      <span className="style-preview-slot" aria-hidden="true">
        <span className="style-preview-disc" data-testid="preview-disc" style={{ opacity: tile.discOpacity, transition: `opacity ${arcCrossFadeSeconds}s` }}><Icon name={tile.verb ? tile.icon : 'circle'} size={16}/></span>
        <span className="style-preview-arc" data-testid="preview-arc" style={{ opacity: tile.showsArc ? 1 : 0, transition: `opacity ${arcCrossFadeSeconds}s` }}/>
      </span>
    </div>
    <p className="style-preview-spoken">VoiceOver: <q data-testid="preview-voiceover">{tile.voiceOver}</q></p>
  </figure>;
}

/** The style's states, for the preview's state picker. */
const statesOf = (style: StateStyleDefinition) => [...new Set(style.rules.flatMap(rule => rule.states))];

/** The preview at iPhone, Duo and iPad widths: one state, and the request phase as a choice. */
function Preview({ style, overrides = [], nodeIcon }: { style: StateStyleDefinition; overrides?: StateOverride[]; nodeIcon?: string }) {
  const states = useMemo(() => statesOf(style), [style]);
  const [state, setState] = useState(states[0] ?? 'unavailable');
  const [phase, setPhase] = useState<'idle' | 'inFlight' | 'failed'>('idle');
  const current = states.includes(state) ? state : states[0] ?? 'unavailable';
  const tile = previewTile(style, current, overrides, { inFlight: phase === 'inFlight', failed: phase === 'failed' }, nodeIcon);
  return <section className="style-preview" aria-label="Tile preview">
    <h3>Preview</h3>
    <div className="style-preview-controls">
      <SelectField label="Preview state" value={current} options={states} onChange={setState}/>
      <SelectField label="Request" value={phase} options={[{ value: 'idle', label: 'No request' }, { value: 'inFlight', label: 'Call in flight' }, { value: 'failed', label: 'Call failed' }]} onChange={value => setPhase(value as typeof phase)}/>
    </div>
    <div className="style-preview-row">{previewWidths.map(size => <TilePreviewCard key={size.id} tile={tile} width={size.width} label={size.label}/>)}</div>
    <p className="style-preview-note">The disc and the arc cross-fade over {arcCrossFadeSeconds} s. While the arc shows, VoiceOver reads the value as dimmed.</p>
  </section>;
}

/** One rule row of the state map. */
function RuleRow({ rule, index, last, style, readOnly, onChange }: {
  rule: StateRule | StateStyleDefinition['fallback']; index: number; last: number; style: StateStyleDefinition; readOnly: boolean; onChange: (next: StateStyleDefinition) => void;
}) {
  const isFallback = !('states' in rule);
  const at = isFallback ? -1 : index;
  const fixed = !isFallback && classFixed(rule as StateRule);
  const options = indicatorOptions(rule);
  const current = options.find(option => option.value === (rule.indicator ?? 'none'));
  const notes = options.filter(option => option.note);
  const heading = isFallback ? 'Anything else' : comma((rule as StateRule).states);
  const patch = (change: Partial<StateRule>) => onChange(patchStyleRule(style, at, change));
  return <li className="style-rule" aria-label={`Rule: ${heading}`}>
    <div className="style-rule-head"><strong>{heading}</strong>
      {!readOnly && !isFallback && <span className="style-rule-actions">
        <button type="button" aria-label={`Move ${heading} up`} disabled={index === 0} onClick={() => onChange(moveStyleRule(style, index, -1))}>Up</button>
        <button type="button" aria-label={`Move ${heading} down`} disabled={index === last} onClick={() => onChange(moveStyleRule(style, index, 1))}>Down</button>
        <button type="button" aria-label={`Remove ${heading}`} disabled={style.rules.length < 2} onClick={() => onChange(removeStyleRule(style, index))}>Remove</button>
      </span>}
    </div>
    <div className="style-rule-fields">
      {!isFallback && <ListField label={`States for ${heading}`} value={(rule as StateRule).states} disabled={readOnly} onChange={states => patch({ states })}/>}
      <label className="field"><span>Class</span>
        <select aria-label={`Class for ${heading}`} value={rule.class} disabled={readOnly || fixed} onChange={event => patch({ class: event.target.value as StateRule['class'] })}>
          {stateClasses.map(name => <option key={name}>{name}</option>)}
        </select>
        {fixed && <small>Unavailable and unknown are always the unknown class.</small>}
      </label>
      <label className="checkbox-field"><input type="checkbox" checked={rule.active} disabled={readOnly} onChange={event => patch({ active: event.target.checked })}/> Lit ({heading})</label>
      <label className="field"><span>Indicator</span>
        <select aria-label={`Indicator for ${heading}`} value={rule.indicator ?? ''} disabled={readOnly} aria-describedby={notes.length ? `${heading}-notes` : undefined}
          onChange={event => patch({ indicator: (event.target.value || undefined) as StateRule['indicator'] })}>
          <option value="">Default for the class</option>
          {options.map(option => <option key={option.value} value={option.value} disabled={!option.available}>{option.label}{option.note ? ` (${option.note})` : ''}</option>)}
        </select>
        {current && !current.available && <small>{current.note}</small>}
      </label>
      <label className="field"><span>Colour</span>
        <select aria-label={`Colour for ${heading}`} value={rule.colour ?? ''} disabled={readOnly || !colourAllowed(rule.class)} aria-describedby={colourAllowed(rule.class) ? undefined : `${heading}-colour-note`}
          onChange={event => patch({ colour: (event.target.value || undefined) as StateRule['colour'] })}>
          <option value="">The class face</option>
          {stateColours.map(name => <option key={name} value={name}>{colourLabels[name]}</option>)}
        </select>
        {!colourAllowed(rule.class) && <small id={`${heading}-colour-note`}>{COLOUR_FOLLOWS_CLASS}</small>}
      </label>
      <TextField label={`Icon for ${heading}`} value={rule.icon ?? ''} disabled={readOnly} onChange={icon => patch({ icon })}/>
      <TextField label={`Words for ${heading}`} value={rule.text ?? ''} disabled={readOnly} placeholder="Home Assistant's state name" onChange={text => patch({ text })}/>
    </div>
    {rule.action && <p className="style-rule-action">Action: {rule.action.verb} <code>{rule.action.service ?? 'no service'}</code>{rule.action.tappable === false ? ' (not tappable)' : ''}. No arc while this state has an action.</p>}
  </li>;
}

/** The request phase: timings, words, and the script and timer the lifecycle reads. The Studio installs neither. */
function RequestEditor({ style, readOnly, onChange }: { style: StateStyleDefinition; readOnly: boolean; onChange: (next: StateStyleDefinition) => void }) {
  const requestSettings = style.request;
  const [checks, setChecks] = useState<Record<string, boolean | 'checking' | 'failed'>>({});
  if (!requestSettings) {
    return <section aria-label="Request phase"><h3>Request phase</h3><p>This style has no request phase: a tap shows no pending words and no lockout.</p>
      {!readOnly && <button type="button" onClick={() => onChange({ ...style, request: { lockoutSeconds: 2, ackTimeoutSeconds: 10, settleTimeoutSeconds: 45, errorHoldSeconds: 4, onTimeout: 'error' } })}>Add a request phase</button>}</section>;
  }
  const update = (change: Partial<NonNullable<StateStyleDefinition['request']>>) => {
    const next = { ...requestSettings, ...change };
    for (const key of Object.keys(next) as (keyof typeof next)[]) if (next[key] === undefined || (next[key] as unknown) === '') delete next[key];
    onChange({ ...style, request: next });
  };
  const check = async (id: string) => {
    setChecks(previous => ({ ...previous, [id]: 'checking' }));
    try {
      const { exists } = await request<{ exists: boolean }>(`/native/api/ha/exists?id=${encodeURIComponent(id)}`);
      setChecks(previous => ({ ...previous, [id]: exists }));
    }
    catch { setChecks(previous => ({ ...previous, [id]: 'failed' })); }
  };
  const lifecycle = (label: string, kind: 'script' | 'timer', value: string | undefined) => {
    const key = value && checks[value];
    return <div className="request-lifecycle">
      <TextField label={label} value={value ?? ''} disabled={readOnly} placeholder={`${kind}.name`}
        onChange={id => update(kind === 'script' ? { script: id } : { errorTimer: id })}/>
      {value && !readOnly && <button type="button" onClick={() => void check(value)}>Check {value}</button>}
      {key === true && <p role="status" className="lifecycle-ok">{value} exists in Home Assistant.</p>}
      {key === false && <p role="alert" className="lifecycle-warning">{value} does not exist in Home Assistant. Create it there; the Studio installs nothing.</p>}
      {key === 'failed' && <p role="alert" className="lifecycle-warning">Home Assistant could not be asked whether {value} exists.</p>}
    </div>;
  };
  const oneMissing = Boolean(requestSettings.script) !== Boolean(requestSettings.errorTimer);
  return <section aria-label="Request phase"><h3>Request phase</h3>
    <div className="style-request-grid">
      <NumberField label="Lockout (seconds)" value={requestSettings.lockoutSeconds} min={0} max={60} onChange={lockoutSeconds => update({ lockoutSeconds })}/>
      <NumberField label="Acknowledge within (seconds)" value={requestSettings.ackTimeoutSeconds} min={1} max={120} onChange={ackTimeoutSeconds => update({ ackTimeoutSeconds })}/>
      <NumberField label="Settle within (seconds)" value={requestSettings.settleTimeoutSeconds} min={0} max={600} onChange={settleTimeoutSeconds => update({ settleTimeoutSeconds })}/>
      <NumberField label="Hold the error (seconds)" value={requestSettings.errorHoldSeconds} min={0} max={60} onChange={errorHoldSeconds => update({ errorHoldSeconds })}/>
      <SelectField label="When it times out" value={requestSettings.onTimeout} options={[{ value: 'error', label: 'Show an error' }, { value: 'revert', label: 'Revert to the state' }]} onChange={onTimeout => update({ onTimeout: onTimeout as 'error' | 'revert' })}/>
      <TextField label="Error words" value={requestSettings.errorWords ?? ''} disabled={readOnly} onChange={errorWords => update({ errorWords })}/>
    </div>
    <p>Pending words: {requestSettings.pendingWords?.length ? requestSettings.pendingWords.map(item => `${item.service}: ${item.text}`).join('; ') : 'none'}.</p>
    {lifecycle('Script', 'script', requestSettings.script)}
    {lifecycle('Error timer', 'timer', requestSettings.errorTimer)}
    {oneMissing && <p role="alert" className="lifecycle-warning">Name the script and the error timer together, or neither.</p>}
    <p className="style-hint">The lifecycle asks for a script and an error timer that already exist in Home Assistant. The Studio checks that they exist and warns when one is missing. It installs nothing.</p>
  </section>;
}

/** Picks a live entity and fills a state map from its own states. */
function EntityPicker({ onPick, labels = { region: 'Entity picker', heading: 'Pick an entity', search: 'Search entities', list: 'Entities' } }: {
  onPick: (entity: PickerEntity, states: EntityStates) => void; labels?: { region: string; heading: string; search: string; list: string };
}) {
  const [entities, setEntities] = useState<PickerEntity[]>();
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let live = true;
    request<PickerEntity[]>('/native/api/ha/entities').then(list => { if (live) setEntities(list); }, reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { live = false; };
  }, []);
  const shown = useMemo(() => (entities ?? []).filter(entity => `${entity.name} ${entity.entityId}`.toLowerCase().includes(search.toLowerCase())).slice(0, 50), [entities, search]);
  const pick = async (entity: PickerEntity) => {
    setBusy(entity.entityId); setError('');
    try { onPick(entity, await request<EntityStates>(`/native/api/ha/entity-states?entityId=${encodeURIComponent(entity.entityId)}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };
  return <section aria-label={labels.region}><h3>{labels.heading}</h3>
    <TextField label={labels.search} value={search} onChange={setSearch}/>
    {error && <p role="alert" className="inline-error">{error}</p>}
    {!entities && !error && <p role="status">Loading entities from Home Assistant...</p>}
    {entities && <ul className="entity-list" aria-label={labels.list}>{shown.map(entity => <li key={entity.entityId}>
      <button type="button" disabled={Boolean(busy)} onClick={() => void pick(entity)}><strong>{entity.name}</strong> <code>{entity.entityId}</code> <small>{entity.state}</small></button>
    </li>)}{shown.length === 0 && <li>No entity matches.</li>}</ul>}
  </section>;
}

const newTileLabels = { region: 'New tile entity', heading: 'Choose the entity for the tile', search: 'Find an entity for the tile', list: 'Candidates for the tile' };

/** Adds a state tile to a page: the entity comes from the picker and the style is the built-in one that fits its domain and device class. */
function AddStateTile({ document, onChange }: { document: CompositionDocument; onChange: (next: CompositionDocument) => void }) {
  const [open, setOpen] = useState(false);
  const [pageId, setPageId] = useState('');
  const [note, setNote] = useState('');
  const page = document.pages.find(item => item.id === pageId) ?? document.pages[0];
  const add = (entity: PickerEntity, states: EntityStates) => {
    const tile = newStateTile(entity.entityId, entity.name, states.deviceClass ?? entity.deviceClass, document.stateStyles);
    if (!tile || !page) { setNote(`No built-in style fits ${entity.name}. Make a saved style for its domain first.`); return; }
    onChange(addStateTile(document, page.id, tile));
    setNote(`Added a state tile for ${entity.name} to ${page.title}, with the ${tile.binding.builtIn ? `${builtInStyles.find(item => item.id === tile.binding.builtIn)?.name} built-in` : 'saved'} style.`);
    setOpen(false);
  };
  return <div className="style-add-tile">
    {note && <p role="status" className="style-note">{note}</p>}
    <div className="style-actions">
      <button type="button" aria-expanded={open} disabled={!document.pages.length} onClick={() => setOpen(value => !value)}>Add a state tile</button>
    </div>
    {open && <>
      <SelectField label="Page for the new tile" value={page?.id ?? ''} options={document.pages.map(item => ({ value: item.id, label: item.title }))} onChange={setPageId}/>
      <EntityPicker onPick={add} labels={newTileLabels}/>
    </>}
  </div>;
}

/** The tile bindings: which style each state tile applies, and its per-layer overrides. */
function TileBindings({ document, onChange }: { document: CompositionDocument; onChange: (next: CompositionDocument) => void }) {
  const tiles = stateTiles(document);
  return <section aria-label="State tiles"><h3>State tiles</h3>
    {!tiles.length && <p>No state tile uses the library yet. Add a state tile, then choose its style here.</p>}
    <AddStateTile document={document} onChange={onChange}/>
    {tiles.map(tile => <TileBindingEditor key={tile.id} tile={tile} document={document} onChange={onChange}/>)}
  </section>;
}

function TileBindingEditor({ tile, document, onChange }: { tile: StateTileNode; document: CompositionDocument; onChange: (next: CompositionDocument) => void }) {
  const library = document.stateStyles;
  const style = resolveTileStyle(tile.binding, library);
  const [state, setState] = useState('');
  const [name, setName] = useState('');
  const update = (change: (tile: StateTileNode) => StateTileNode) => onChange(updateStateTile(document, tile.id, change));
  const states = style ? statesOf(style) : [];
  const chosen = states.includes(state) ? state : states[0] ?? '';
  const override = overrideFor(tile.binding, chosen);
  const marks = overriddenLayers(tile.binding, chosen);
  const rule = style && chosen ? style.rules.find(item => item.states.includes(chosen)) ?? style.fallback : undefined;
  const options = rule ? indicatorOptions(rule) : [];
  const overrideClass = rule?.class ?? 'unknown';
  const styleOptions = [
    ...builtInStyles.filter(item => item.domain === tile.binding.entityId.split('.')[0]).map(item => ({ value: `built:${item.id}`, label: `${item.name} (built-in)` })),
    ...(library?.styles ?? []).filter(item => item.domain === tile.binding.entityId.split('.')[0]).map(item => ({ value: `saved:${item.id}`, label: item.name })),
  ];
  const selected = tile.binding.styleId ? `saved:${tile.binding.styleId}` : tile.binding.builtIn ? `built:${tile.binding.builtIn}` : '';
  const layer = (name: OverrideLayer, label: string) => {
    const value = override?.[name] ?? '';
    const marked = marks.includes(name);
    if (name === 'indicator' || name === 'colour') {
      const list = name === 'indicator' ? options.map(option => ({ value: option.value, label: option.available ? option.label : `${option.label} (${option.note})`, disabled: !option.available })) : stateColours.map(item => ({ value: item, label: colourLabels[item], disabled: !colourAllowed(overrideClass) }));
      const locked = name === 'colour' && !colourAllowed(overrideClass);
      return <label className="field" key={name}><span>{label}{marked ? ' (overridden)' : ''}</span>
        <select aria-label={`${label} override for ${chosen}`} value={value} disabled={locked} onChange={event => update(item => ({ ...item, binding: setOverride(item.binding, chosen, name, event.target.value) }))}>
          <option value="">From the style</option>
          {list.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
        </select>{locked && <small>{COLOUR_FOLLOWS_CLASS}</small>}</label>;
    }
    return <TextField key={name} label={`${label} override for ${chosen}${marked ? ' (overridden)' : ''}`} value={value}
      onChange={next => update(item => ({ ...item, binding: setOverride(item.binding, chosen, name, next) }))}/>;
  };
  return <article className="style-tile-binding" aria-label={`Tile ${tile.id}`}>
    <h4>{tile.id} <code>{tile.binding.entityId}</code></h4>
    <SelectField label={`Style for ${tile.id}`} value={selected} options={[{ value: '', label: 'Choose a style' }, ...styleOptions]} onChange={value => update(item => {
      const { styleId: _s, builtIn: _b, ...rest } = item.binding;
      return { ...item, binding: value.startsWith('saved:') ? { ...rest, styleId: value.slice(6), ...(tile.binding.builtIn ? { builtIn: tile.binding.builtIn } : {}) } : value.startsWith('built:') ? { ...rest, builtIn: value.slice(6) as never } : rest };
    })}/>
    {tile.binding.styleId && !library?.styles.some(item => item.id === tile.binding.styleId) && <p role="status" className="lifecycle-warning">This style is no longer in the library. The tile shows its built-in style.</p>}
    {style && <>
      <SelectField label={`State to override on ${tile.id}`} value={chosen} options={states} onChange={setState}/>
      <div className="style-override-fields">{overrideLayers.map(name => layer(name, ({ icon: 'Icon', text: 'Words', indicator: 'Indicator', colour: 'Colour' } as const)[name]))}</div>
      <div className="style-actions">
        <button type="button" disabled={!override} onClick={() => update(item => ({ ...item, binding: resetOverride(item.binding, chosen) }))}>Reset {chosen} to the style</button>
        {marks.map(item => <button key={item} type="button" aria-label={`Reset ${item} of ${chosen}`} onClick={() => update(tileItem => ({ ...tileItem, binding: resetOverride(tileItem.binding, chosen, item) }))}>Reset {item}</button>)}
      </div>
      <div className="style-actions">
        <TextField label={`Name for a new style from ${tile.id}`} value={name} onChange={setName}/>
        <button type="button" disabled={!name.trim() || !(tile.binding.overrides?.length)} onClick={() => {
          const saved = saveAsNewStyle(document, tile.binding, name.trim());
          if (saved) { onChange(updateStateTile({ ...document, stateStyles: saved.library }, tile.id, item => ({ ...item, binding: saved.binding }))); setName(''); }
        }}>Save as New Style</button>
      </div>
      <Preview style={style} overrides={tile.binding.overrides} nodeIcon={tile.icon.name}/>
    </>}
  </article>;
}

/** The Styles section: the style library, the state-map editor, the request phase, the entity picker, the tile bindings and the preview. */
export default function StateStyles({ document, onChange }: { document: CompositionDocument; onChange: (next: CompositionDocument) => void }) {
  const entries = libraryEntries(document);
  const [selectedId, setSelectedId] = useState(entries[0]?.style.id ?? '');
  const [note, setNote] = useState('');
  const [newState, setNewState] = useState('');
  const [renaming, setRenaming] = useState('');
  const [picked, setPicked] = useState<{ entity: PickerEntity; states: EntityStates }>();
  const entry = entries.find(item => item.style.id === selectedId) ?? entries[0];
  const style = entry?.style;
  const readOnly = !entry || entry.builtIn;
  const library = document.stateStyles;
  const setLibrary = (next: StateStyleLibrary) => onChange({ ...document, stateStyles: next });
  const edit = (next: StateStyleDefinition) => library && setLibrary(replaceStyle(library, next.id, next));
  const warning = entry && !entry.builtIn ? editWarning(entry.usedBy) : undefined;

  const duplicate = (source: StateStyleDefinition) => {
    const result = duplicateStyle(library, source);
    setLibrary(result.library); setSelectedId(result.id); setNote(`Duplicated ${source.name}.`);
  };
  const fromEntity = (entity: PickerEntity, states: EntityStates) => {
    const draft = buildStateMap(entity.entityId, states.states, states.history, states.deviceClass, states.openEnded);
    setPicked({ entity, states });
    const created = styleFromEntity(entity.entityId, `${entity.name} states`, draft);
    const base = suggestBuiltInStyle(entity.entityId, states.deviceClass);
    const next = { ...created, ...(base ? { base } : {}) };
    setLibrary({ type: 'state-styles@1', styles: [...(library?.styles ?? []), next] });
    setSelectedId(next.id);
    setNote(`Filled a state map from ${entity.name}: ${states.states.length} states from Home Assistant${draft.unclassified.length ? `, ${draft.unclassified.length} unclassified` : ''}.`);
  };
  const unclassified = picked ? buildStateMap(picked.entity.entityId, picked.states.states, picked.states.history, picked.states.deviceClass, picked.states.openEnded).unclassified : [];

  return <div className="state-styles">
    <p>A style is a state map: each Home Assistant state gets a class, a lit or unlit face, and optionally an icon, words, an indicator and a colour. Built-in styles are read-only; duplicate one to change it.</p>
    {note && <p role="status" className="style-note">{note}</p>}
    <section aria-label="Style library"><h3>Style library</h3>
      <ul className="style-library">
        {entries.map(item => {
          const blocked = deleteBlock(document, item.style.id);
          return <li key={item.style.id} aria-current={item.style.id === entry?.style.id ? 'true' : undefined}>
            <button type="button" className="style-select" aria-pressed={item.style.id === entry?.style.id} onClick={() => setSelectedId(item.style.id)}>
              <strong>{item.style.name}</strong> <span className="badge">{item.builtIn ? 'Built-in' : 'Saved'}</span>
              {!item.builtIn && <small> {usedByText(item.usedBy)}</small>}
            </button>
            <span className="style-actions">
              <button type="button" onClick={() => duplicate(item.style)}>Duplicate {item.style.name}</button>
              {!item.builtIn && (renaming === item.style.id
                ? <RenameField name={item.style.name} onRename={name => library && setLibrary(renameStyle(library, item.style.id, name))} onDone={() => setRenaming('')}/>
                : <button type="button" onClick={() => setRenaming(item.style.id)}>Rename {item.style.name}</button>)}
              {!item.builtIn && <button type="button" aria-disabled={Boolean(blocked)} aria-describedby={blocked ? `block-${item.style.id}` : undefined}
                onClick={() => { if (blocked) { setNote(blocked); return; } setLibrary(deleteStyle(document, item.style.id)); setSelectedId(''); setNote(`Deleted ${item.style.name}.`); }}>Delete {item.style.name}</button>}
            </span>
            {!item.builtIn && blocked && <small id={`block-${item.style.id}`} className="style-block">{blocked}</small>}
          </li>;
        })}
      </ul>
    </section>
    {style && <section aria-label={`Style ${style.name}`}>
      <h3>{style.name}</h3>
      {readOnly && <p className="style-note">Built-in styles are read-only. Duplicate it to edit the state map.</p>}
      {warning && <p role="status" className="lifecycle-warning">{warning} Edits to this style change every tile that uses it.</p>}
      <p>Domain <code>{style.domain}</code>{style.base ? <> · based on <code>{style.base}</code></> : null}</p>
      <h3>State map</h3>
      <ol className="style-rules">
        {style.rules.map((rule, index) => <RuleRow key={`${index}-${rule.states.join()}`} rule={rule} index={index} last={style.rules.length - 1} style={style} readOnly={readOnly} onChange={edit}/>)}
        <RuleRow rule={style.fallback} index={-1} last={-1} style={style} readOnly={readOnly} onChange={edit}/>
      </ol>
      {!readOnly && <div className="style-actions"><TextField label="Add a state" value={newState} onChange={setNewState} placeholder="for example: charging"/>
        <button type="button" disabled={!newState.trim()} onClick={() => { edit(addStyleRule(style, newState.trim())); setNewState(''); }}>Add state</button></div>}
      <RequestEditor style={style} readOnly={readOnly} onChange={edit}/>
      <Preview style={style}/>
    </section>}
    <EntityPicker onPick={fromEntity}/>
    {picked && <section aria-label="Filled from entity"><h3>Filled from {picked.entity.name}</h3>
      <p>States from Home Assistant: {picked.states.states.map(item => item.name ? `${item.state} (${item.name})` : item.state).join(', ') || (picked.states.openEnded ? 'open-ended: the map ends in a resting fallback' : 'none')}.</p>
      {unclassified.length > 0 && <p role="status" className="lifecycle-warning">Unclassified: {comma(unclassified)}. These are resting until you choose a class.</p>}
    </section>}
    <TileBindings document={document} onChange={onChange}/>
  </div>;
}
