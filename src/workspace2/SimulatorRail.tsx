import { BookOpen, Columns2, RotateCw, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PreviewWindow } from '../preview2';
import { canPosture, canRotate, deviceOf, postureOf, rotated, stepText, textScales, withPosture, type Posture } from './simulator';

const postureControls: readonly { posture: Posture; label: string; icon: ReactNode }[] = [
  { posture: 'folded', label: 'Folded', icon: <Smartphone size={18} aria-hidden/> },
  { posture: 'partly', label: 'Partly Folded', icon: <BookOpen size={18} aria-hidden/> },
  { posture: 'unfolded', label: 'Unfolded', icon: <Columns2 size={18} aria-hidden/> },
];

/**
 * The simulator controls (Studio spec, Rule 3): Rotate, the Duo's three postures, and text size down and up. A control the
 * device cannot use is dimmed where it stands, so the rail never changes shape. Beside the device when wide (a column) and under
 * it on a phone (a row).
 */
export default function SimulatorRail({ window: win, onWindow, textStep, onTextStep, orientation = 'vertical' }: {
  window: PreviewWindow; onWindow: (window: PreviewWindow) => void; textStep: number; onTextStep: (step: number) => void; orientation?: 'vertical' | 'horizontal';
}) {
  const duo = deviceOf(win) === 'iPhone Duo', posture = postureOf(win);
  return <div className="w2-rail" role="toolbar" aria-label="Simulator" aria-orientation={orientation} data-orientation={orientation} data-testid="simulator-rail">
    <button type="button" className="w2-icon-button" aria-label="Rotate" title="Rotate" disabled={!canRotate(win)} onClick={() => onWindow(rotated(win))}><RotateCw size={18} aria-hidden/></button>
    {duo && <>
      <span className="w2-rail-sep" role="separator" aria-orientation={orientation === 'vertical' ? 'horizontal' : 'vertical'}/>
      {postureControls.map(item => <button key={item.posture} type="button" className="w2-icon-button" aria-label={item.label} title={item.label} aria-pressed={posture === item.posture}
        disabled={!canPosture(win, item.posture)} onClick={() => onWindow(withPosture(win, item.posture))}>{item.icon}</button>)}
    </>}
    <span className="w2-rail-sep" role="separator" aria-orientation={orientation === 'vertical' ? 'horizontal' : 'vertical'}/>
    <button type="button" className="w2-icon-button w2-rail-text" aria-label="Smaller Text" title="Smaller Text" disabled={textStep <= 0} onClick={() => onTextStep(stepText(textStep, -1))}><span aria-hidden style={{ fontSize: 12 }}>A</span></button>
    <button type="button" className="w2-icon-button w2-rail-text" aria-label="Larger Text" title="Larger Text" disabled={textStep >= textScales.length - 1} onClick={() => onTextStep(stepText(textStep, 1))}><span aria-hidden style={{ fontSize: 17, fontWeight: 700 }}>A</span></button>
  </div>;
}
