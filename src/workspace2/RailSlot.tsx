import type { PreviewWindow } from '../preview2';
import SimulatorRail from './SimulatorRail';

/**
 * Where the simulator rail sits: pinned to the canvas by CSS, never measured from the device. A pose change (fold, unfold, rotate) resizes
 * the device but not the canvas, so the rail stays under the pointer; it moves only when the window or the canvas resizes. The stage keeps
 * 80 px free at its trailing edge (or 66 px under it, on a canvas under 420 px) so the device never reaches the rail.
 */
export default function RailSlot({ enabled, under, window: win, onWindow, textStep, onTextStep }: {
  enabled: boolean; under: boolean;
  window: PreviewWindow; onWindow: (window: PreviewWindow) => void; textStep: number; onTextStep: (step: number) => void;
}) {
  if (!enabled) return null;
  return <div className="w2-rail-slot" data-under={under ? '' : undefined}>
    <SimulatorRail window={win} onWindow={onWindow} textStep={textStep} onTextStep={onTextStep} orientation={under ? 'horizontal' : 'vertical'}/>
  </div>;
}
