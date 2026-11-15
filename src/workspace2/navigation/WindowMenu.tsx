import { Menu } from '@base-ui/react/menu';
import { ChevronDown } from 'lucide-react';
import { canBook, isBook, previewWindows, splitReadout, windowLabel, withPose, type PreviewWindow } from '../../preview2';

/** The split read-out line for a window (spec 5.9). */
export function SplitReadout({ window: win }: { window: PreviewWindow }) {
  return <p className="w2-window-readout" role="status" data-testid="split-readout">{splitReadout(win)}</p>;
}

/** The Window button and its menu (wide): every window by size, "Flat / Book" for a Duo opened sideways, then the split read-out. */
export function WindowMenu({ window: current, onWindow }: { window: PreviewWindow; onWindow: (window: PreviewWindow) => void }) {
  return <Menu.Root>
    <Menu.Trigger className="w2-window-button" aria-label="Window">{windowLabel(current)}<ChevronDown size={14} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={8} className="w2-positioner"><Menu.Popup className="w2-scope w2-menu w2-window-menu">
      <Menu.RadioGroup value={current.name} onValueChange={name => { const next = previewWindows.find(item => item.name === name); if (next) onWindow(next); }}>
        {previewWindows.map(item => <Menu.RadioItem key={item.name} value={item.name} className="w2-menu-item">{windowLabel(item)}</Menu.RadioItem>)}
      </Menu.RadioGroup>
      {canBook(current) && <>
        <Menu.Separator className="w2-menu-sep"/>
        <Menu.RadioGroup value={isBook(current) ? 'book' : 'flat'} onValueChange={pose => onWindow(withPose(current, pose as 'flat' | 'book'))}>
          <Menu.RadioItem value="flat" className="w2-menu-item">Flat</Menu.RadioItem>
          <Menu.RadioItem value="book" className="w2-menu-item">Book</Menu.RadioItem>
        </Menu.RadioGroup>
      </>}
      <Menu.Separator className="w2-menu-sep"/>
      <SplitReadout window={current}/>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

/** The same choices as a list, for the narrow Project sheet's "Window" page. */
export function WindowChoices({ window: current, onWindow }: { window: PreviewWindow; onWindow: (window: PreviewWindow) => void }) {
  return <div className="w2-window-choices">
    <ul className="w2-menu-list">{previewWindows.map(item => <li key={item.name}>
      <button type="button" className="w2-list-row" aria-pressed={item.name === current.name} onClick={() => onWindow(item)}>{windowLabel(item)}</button></li>)}</ul>
    {canBook(current) && <div className="w2-segment" role="group" aria-label="Pose">
      {(['flat', 'book'] as const).map(pose => <button key={pose} type="button" aria-pressed={isBook(current) === (pose === 'book')} onClick={() => onWindow(withPose(current, pose))}>{pose === 'flat' ? 'Flat' : 'Book'}</button>)}
    </div>}
    <SplitReadout window={current}/>
  </div>;
}
