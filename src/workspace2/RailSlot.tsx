import type { PreviewWindow } from '../preview2';
import SimulatorRail from './SimulatorRail';
import { useRailAnchor } from './useRailAnchor';

/**
 * Where the simulator rail sits beside (or under) the device. The anchor is measured after layout and held as state, so it is held
 * here and not in the workspace: a drop that opens the inspector moves the device, the measure then sets the anchor, and that
 * re-render must cost the rail alone, not the whole workspace tree a second time inside the same task.
 */
export default function RailSlot({ stage, enabled, deps, under, window: win, onWindow, textStep, onTextStep }: {
  stage: HTMLElement | null; enabled: boolean; /** What can move the device without resizing the stage. */ deps: readonly unknown[]; under: boolean;
  window: PreviewWindow; onWindow: (window: PreviewWindow) => void; textStep: number; onTextStep: (step: number) => void;
}) {
  const anchor = useRailAnchor(stage, enabled, deps, under);
  if (!enabled || !anchor) return null;
  return <div className="w2-rail-slot" data-under={anchor.under ? '' : undefined} style={{ left: anchor.left, top: anchor.top }}>
    <SimulatorRail window={win} onWindow={onWindow} textStep={textStep} onTextStep={onTextStep} orientation={anchor.under ? 'horizontal' : 'vertical'}/>
  </div>;
}
