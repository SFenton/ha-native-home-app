import { Ellipsis } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { isEnabled, ruleHolds } from '../../shared/composition/evaluator';
import { effectiveControls, type SurfaceButton, type SurfaceGroup } from '../../shared/composition/surface-controls';
import { CONTROL_INSET, CONTROL_SIZE, fitMapControls } from '../../shared/composition/surface-controls-fit';
import type { VacuumControl } from '../../shared/composition/vacuum';
import { requestMapControl, useMapControlFocus } from '../map-control-focus';
import { useRender } from '../render-context';
import type { Device } from './device-shared';
import { PullDownMenu } from './PullDownMenu';
import { Glyph, useOperand, useSymbol } from './shared';

type MapPrimitive = Extract<VacuumControl['props']['primitive'], { kind: 'map' }>;
/** The words VoiceOver reads for the More button, and its menu's title. */
export const MORE_LABEL = 'More Map Controls';

/** The laid-out size of an element, kept current by a `ResizeObserver`; 0 by 0 until measured (and where there is no observer). */
function useElementSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => setSize(old => old.width === element.clientWidth && old.height === element.clientHeight ? old : { width: element.clientWidth, height: element.clientHeight });
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * Whether a button is on the map now. A map action (Locate) and a source command are always drawn here: the app hides Locate while the robot is
 * unavailable and dims a blocked command, and the preview draws the dimmed state. A service call or page button follows its own `visibleWhen`.
 */
function drawn(button: SurfaceButton, env: ReturnType<typeof useRender>['env'], mode: 'edit' | 'use'): boolean {
  return button.action.type === 'map' || button.action.type === 'source-command' || mode === 'edit' || ruleHolds(button, env);
}

/** One 44 pt button. The symbol and label follow their rules; a source command is dimmed while the robot cannot take it, with the reason as its value. */
function ControlButton({ nodeId, button, device, ringed }: { nodeId: string; button: SurfaceButton; device: Device; ringed: boolean }) {
  const { mode, env, run, note } = useRender();
  const symbol = useSymbol(button.icon, `${nodeId}/control/${button.id}/icon`);
  const words = useOperand(typeof button.label === 'string' ? { type: 'literal', value: button.label } : button.label, '', `${nodeId}/control/${button.id}/label`).text;
  const action = button.action;
  const blocked = action.type === 'source-command' && device.phase !== 'ready';
  const hidden = action.type !== 'map' && action.type !== 'source-command' && !ruleHolds(button, env);
  const off = blocked || hidden || !isEnabled(button.enabledWhen, env);
  const reason = blocked ? 'Robot unavailable' : undefined;
  return <button type="button" className="sh-dv-ctl-button" data-control={button.id} data-control-node={nodeId} data-ringed={ringed ? '' : undefined} data-dimmed={off ? '' : undefined}
    aria-label={words} aria-description={reason ?? button.hint} title={reason ?? button.hint} aria-disabled={off ? true : undefined}
    onClick={event => {
      if (mode === 'edit') { requestMapControl({ nodeId, buttonId: button.id }); return; }
      event.stopPropagation();
      if (off) return;
      if (action.type === 'map' || action.type === 'source-command') note?.(`${words}: simulated`);
      else run(action);
    }}><Glyph symbol={symbol} size={18}/></button>;
}

/** The More button: it opens a menu of the buttons that did not fit, each by its label. */
function MoreButton({ nodeId, buttons }: { nodeId: string; buttons: SurfaceButton[] }) {
  const { mode, run, note } = useRender();
  const options = buttons.map(button => ({ value: button.id, label: typeof button.label === 'string' ? button.label : button.id }));
  return <PullDownMenu title={MORE_LABEL} className="sh-dv-ctl-button" options={options} disabled={false}
    onSelect={id => {
      const button = buttons.find(item => item.id === id);
      if (!button) return;
      if (mode === 'edit') { requestMapControl({ nodeId, buttonId: id }); return; }
      if (button.action.type === 'map' || button.action.type === 'source-command') note?.(`${options.find(item => item.value === id)?.label}: simulated`);
      else run(button.action);
    }}><Ellipsis size={18} aria-label={MORE_LABEL}/></PullDownMenu>;
}

/**
 * The map's corner button groups (`UKVacuumMapFrame`'s corner groups): one glass shape per group (a circle for one button, a capsule for more), 44 pt
 * buttons on a 44 pt pitch, 8 pt from the card's two edges, with what does not fit behind More by the shared fit rule. With no `controls` it draws the
 * one default group: Locate at the top leading corner, as before. The groups pin to the card and never move or mirror with the picture.
 */
export function MapControls({ nodeId, primitive, device }: { nodeId: string; primitive: MapPrimitive; device: Device }) {
  const layer = useRef<HTMLDivElement>(null);
  const size = useElementSize(layer);
  const { env, mode } = useRender();
  const focus = useMapControlFocus();
  const groups = effectiveControls(primitive)
    .map((group): SurfaceGroup => ({ ...group, buttons: group.buttons.filter(button => drawn(button, env, mode)) })).filter(group => group.buttons.length > 0);
  const fit = size.width > 0 ? fitMapControls(size, groups.map(group => ({ corner: group.corner, axis: group.axis, count: group.buttons.length })))
    : groups.map(group => ({ corner: group.corner, shown: group.buttons.length, more: false, hidden: 0 }));
  return <div ref={layer} className="sh-dv-ctl-layer" data-testid="map-controls">{groups.map((group, index) => {
    const result = fit[index], shown = group.buttons.slice(0, result.shown), rest = group.buttons.slice(result.shown);
    const slots = shown.length + (result.more ? 1 : 0), single = slots === 1;
    const axis = single ? 'column' : group.axis;
    return <div key={group.corner} className={`sh-dv-ctl ${single && group.buttons[0].id === 'locate' && group.corner === 'top-leading' ? 'sh-dv-locate' : ''}`.trim()} role="group" aria-label={`${group.corner.replace('-', ' ')} map controls`}
      data-corner={group.corner} data-axis={axis} data-shown={shown.length} data-more={result.more ? rest.length : undefined}
      style={{ '--ctl-n': slots, '--ctl-size': `${CONTROL_SIZE}px`, '--ctl-inset': `${CONTROL_INSET}px` } as CSSProperties}>
      {shown.map(button => <ControlButton key={button.id} nodeId={nodeId} button={button} device={device} ringed={focus?.nodeId === nodeId && focus.buttonId === button.id}/>)}
      {result.more && <MoreButton nodeId={nodeId} buttons={rest}/>}
    </div>;
  })}</div>;
}
