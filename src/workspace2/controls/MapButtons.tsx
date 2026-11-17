import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronRight, GripVertical, Plus } from 'lucide-react';
import { type EditorPath, valueAt } from '../../composition-editor';
import { focusMapControl, useMapControlRequest } from '../../preview2/map-control-focus';
import { hasLocate, type SurfaceCorner } from '../../shared/composition/surface-controls';
import { addButton, freshId, moveToCorner, moveWithin, placeOf, removeButton, setAxis } from '../../shared/composition/surface-controls-edit';
import { cornerWords, overflowNotices } from '../../shared/composition/surface-controls-fit';
import { GlyphByName } from '../../preview2/nodes/shared';
import { usePush } from '../kit';
import { useRows } from '../rows';
import { Segmented, MoreMenu } from '../expr/ui';
import ButtonPage from './ButtonPage';
import { cornerOrder, doesWords, groupsOf, idBase, labelWords, mapNodeAt, newButton, withGroups, type NewKind } from './mapControls';
import './map-controls.css';

/** A corner's glyph: a square with a dot in the corner the section is. Decoration; the section's heading carries the name. */
function CornerGlyph({ corner }: { corner: SurfaceCorner }) {
  const x = corner.endsWith('trailing') ? 11 : 3, y = corner.startsWith('bottom') ? 11 : 3;
  return <svg className="w2-mc-corner" width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor"/><rect x={x} y={y} width="3" height="3" rx="1" fill="currentColor"/></svg>;
}

/**
 * The map's Map Buttons group: four sections in screen order (Top Leading, Top Trailing, Bottom Leading, Bottom Trailing). Each lists its buttons as
 * rows (grip, symbol, label, More); a row pushes the button's page. Add puts a new button last in a corner. Reorder by dragging the grip, or focus the
 * grip, Space to lift, arrows to move, Space to drop, or More, Move Up and Move Down. Move to a corner by More or the page's Corner pop-up (a drag
 * across sections is deferred: the menu and the pop-up are the required path). A polite line says each move.
 */
export default function MapButtons({ path }: { path: EditorPath }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const [lifted, setLifted] = useState<string>();
  const [drop, setDrop] = useState<{ corner: SurfaceCorner; index: number }>();
  const [said, setSaid] = useState('');
  const lists = useRef<Partial<Record<SurfaceCorner, HTMLOListElement | null>>>({});
  const map = mapNodeAt(document, path);
  const nodeId = (valueAt(document, path) as { id?: string } | undefined)?.id;
  const request = useMapControlRequest();
  const handled = useRef(0);
  const groups = map ? groupsOf(map) : [];
  const open = (id: string, focusLabel = false) => push?.push({ title: 'Map Button', body: <ButtonPage path={path} buttonId={id} focusLabel={focusLabel}/> });
  // A click on a button in the simulator while editing opens its page here.
  useEffect(() => {
    if (!request || request.at === handled.current || request.nodeId !== nodeId) return;
    handled.current = request.at;
    if (groups.some(group => group.buttons.some(button => button.id === request.buttonId))) push?.push({ title: 'Map Button', body: <ButtonPage path={path} buttonId={request.buttonId}/> });
  });
  if (!map || !nodeId) return null;
  const write = (next: typeof groups, say?: string) => { onChange(withGroups(document, map, next)); if (say) setSaid(say); };
  const titleOf = (id: string) => { const button = groups.flatMap(group => group.buttons).find(item => item.id === id); return button ? labelWords(button) : id; };
  const announce = (next: typeof groups, id: string) => { const place = placeOf(next, id); return place ? `${titleOf(id)} moved to ${cornerWords[place.corner]}, position ${place.index + 1} of ${place.count}.` : undefined; };
  const add = (corner: SurfaceCorner, kind: NewKind) => {
    const id = freshId(groups, idBase[kind]);
    write(addButton(groups, corner, newButton(kind, document, id)));
    window.requestAnimationFrame(() => open(id, true));
  };
  const reorder = (id: string, to: number) => { const next = moveWithin(groups, id, to); write(next, announce(next, id)); };
  const toCorner = (id: string, corner: SurfaceCorner) => { const next = moveToCorner(groups, id, corner); write(next, announce(next, id)); };
  const rowAt = (corner: SurfaceCorner, event: PointerEvent): number => {
    const rows = [...(lists.current[corner]?.querySelectorAll<HTMLElement>('[data-map-row]') ?? [])];
    const found = rows.findIndex(row => { const box = row.getBoundingClientRect(); return event.clientY < box.top + box.height / 2; });
    return found < 0 ? rows.length : found;
  };
  const keys = (event: KeyboardEvent, id: string, corner: SurfaceCorner) => {
    const place = placeOf(groups, id);
    if (!place) return;
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setLifted(current => { const next = current === id ? undefined : id; setSaid(next === undefined ? `${titleOf(id)} dropped.` : `${titleOf(id)} lifted, position ${place.index + 1} of ${place.count}.`); return next; }); return; }
    if (lifted !== id) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const to = place.index + (event.key === 'ArrowUp' ? -1 : 1);
      if (to >= 0 && to < place.count) { reorder(id, to); window.requestAnimationFrame(() => lists.current[corner]?.querySelectorAll<HTMLElement>('[data-grip]')[to]?.focus()); }
    }
    if (event.key === 'Escape') { setLifted(undefined); setSaid(`${titleOf(id)} put back.`); }
  };
  const notices = overflowNotices({ locate: map.primitive.locate, controls: map.primitive.controls, height: map.primitive.height });
  const locateOn = hasLocate(groups);
  return <section className="w2-group w2-mc" data-group="map-buttons" aria-label="Map Buttons">
    <h3 className="w2-group-title">Map Buttons</h3>
    {cornerOrder.map(corner => {
      const group = groups.find(item => item.corner === corner), count = group?.buttons.length ?? 0, name = cornerWords[corner];
      return <div key={corner} className="w2-mc-section" data-corner={corner} role="group" aria-label={name}>
        <div className="w2-mc-head"><CornerGlyph corner={corner}/><strong>{name}</strong><span className="w2-mc-count">{count === 0 ? 'Empty' : count}</span>
          {group && count >= 2 && <Segmented label={`${name} direction`} value={group.axis} options={[{ value: 'row', label: 'Row' }, { value: 'column', label: 'Column' }]} onChange={axis => write(setAxis(groups, corner, axis))}/>}
          <Menu.Root><Menu.Trigger className="w2-icon-button" aria-label={`Add a button to ${name}`}><Plus size={16} aria-hidden/></Menu.Trigger>
            <Menu.Portal><Menu.Positioner sideOffset={4} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
              <Menu.Item className="w2-menu-item" disabled={locateOn} onClick={() => add(corner, 'locate')}>Locate{locateOn ? ' (Already on the map)' : ''}</Menu.Item>
              <Menu.Item className="w2-menu-item" onClick={() => add(corner, 'command')}>Robot Command</Menu.Item>
              <Menu.Item className="w2-menu-item" onClick={() => add(corner, 'service')}>Service Call</Menu.Item>
              <Menu.Item className="w2-menu-item" onClick={() => add(corner, 'page')}>Go to Page or Sheet</Menu.Item>
            </Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root></div>
        {group && <ol ref={element => { lists.current[corner] = element; }} className="w2-expr-rulelist w2-mc-list" aria-label={`${name} buttons`}>
          {group.buttons.map((button, index) => <li key={button.id} data-map-row data-lifted={lifted === button.id || undefined} data-drop-before={drop?.corner === corner && drop.index === index || undefined}
            onMouseEnter={() => focusMapControl({ nodeId, buttonId: button.id })} onMouseLeave={() => focusMapControl(undefined)}>
            <button type="button" className="w2-expr-grip" data-grip aria-label={`${labelWords(button)}, ${index + 1} of ${count}: drag to move. Space lifts, arrows move.`} aria-pressed={lifted === button.id} disabled={count < 2}
              onKeyDown={event => keys(event, button.id, corner)}
              onPointerDown={event => { if (count < 2) return; event.currentTarget.setPointerCapture?.(event.pointerId); setLifted(button.id); setDrop({ corner, index }); }}
              onPointerMove={event => { if (lifted === button.id && event.buttons) setDrop({ corner, index: rowAt(corner, event) }); }}
              onPointerUp={event => { if (lifted !== button.id) return; const to = rowAt(corner, event); setLifted(undefined); setDrop(undefined); reorder(button.id, to > index ? to - 1 : to); }}
              onPointerCancel={() => { setLifted(undefined); setDrop(undefined); }}><GripVertical size={16} aria-hidden/></button>
            <button type="button" className="w2-expr-rulebtn" aria-label={`${labelWords(button)}: ${doesWords(button)}`} onClick={() => open(button.id)}>
              <span className="w2-mc-symbol" aria-hidden>{button.icon.type === 'sf-symbol' && <GlyphByName name={button.icon.name} size={18}/>}</span>
              <span className="w2-expr-ruletext"><span className="w2-expr-line1"><strong>{labelWords(button)}</strong></span><span className="w2-expr-line2">{doesWords(button)}</span></span><ChevronRight size={16} aria-hidden/></button>
            <MoreMenu label={`More for ${labelWords(button)}`} commands={[
              { label: 'Move Up', run: () => reorder(button.id, index - 1), disabled: index === 0 }, { label: 'Move Down', run: () => reorder(button.id, index + 1), disabled: index === count - 1 },
              ...cornerOrder.filter(other => other !== corner).map(other => ({ label: `Move to ${cornerWords[other]}`, run: () => toCorner(button.id, other) })),
              { label: 'Remove Button', run: () => write(removeButton(groups, button.id)), danger: true, separatorBefore: true }]}/>
          </li>)}
        </ol>}
      </div>;
    })}
    {notices.map(line => <p key={line} className="w2-caption w2-mc-notice" role="note" data-testid="map-overflow">{line}</p>)}
    <p className="w2-sr" role="status" aria-live="polite">{said}</p>
  </section>;
}
