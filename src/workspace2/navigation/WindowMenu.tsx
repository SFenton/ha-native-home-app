import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronDown, Smartphone, Tablet } from 'lucide-react';
import { foldReadout, splitReadout, type PreviewWindow } from '../../preview2';
import { deviceOf, devices, windowOfDevice, type DeviceName } from '../simulator';

/** The split read-out line for a window (spec 5.9), and under it the pose: "Fold: book, band 455 to 496 pt". */
export function SplitReadout({ window: win }: { window: PreviewWindow }) {
  return <>
    <p className="w2-window-readout" role="status" data-testid="split-readout">{splitReadout(win)}</p>
    <p className="w2-window-readout" role="status" data-testid="fold-readout">{foldReadout(win)}</p>
  </>;
}

/**
 * The Window button and its menu (wide): a pure list of devices by name, then the split read-out. Turning, folding and text size
 * are the simulator rail's, so choosing a device opens it in its first pose.
 */
export function WindowMenu({ window: current, onWindow, compact = false }: { window: PreviewWindow; onWindow: (window: PreviewWindow) => void; /** Under 720 px the button shows its glyph and chevron only; the name stays as its accessible name. */ compact?: boolean }) {
  return <Menu.Root>
    <Menu.Trigger className="w2-window-button" aria-label={compact ? `Window, ${deviceOf(current)}` : 'Window'} title={compact ? deviceOf(current) : undefined}>{compact ? (deviceOf(current) === 'iPad' ? <Tablet size={18} aria-hidden/> : <Smartphone size={18} aria-hidden/>) : deviceOf(current)}<ChevronDown size={14} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={8} className="w2-positioner"><Menu.Popup className="w2-scope w2-menu w2-window-menu">
      <Menu.RadioGroup value={deviceOf(current)} onValueChange={name => { if (name !== deviceOf(current)) onWindow(windowOfDevice(name as DeviceName)); }}>
        {devices.map(item => <Menu.RadioItem key={item.name} value={item.name} className="w2-menu-item" closeOnClick>{item.name}</Menu.RadioItem>)}
      </Menu.RadioGroup>
      <Menu.Separator className="w2-menu-sep"/>
      <SplitReadout window={current}/>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

/** The same devices as a list, for the narrow Project sheet's "Window" page. */
export function WindowChoices({ window: initial, onWindow }: { window: PreviewWindow; onWindow: (window: PreviewWindow) => void }) {
  // The sheet pushes this page once, so it keeps the choice itself rather than reading a prop that cannot change under it.
  const [current, setCurrent] = useState(initial);
  const choose = (next: PreviewWindow) => { setCurrent(next); onWindow(next); };
  return <div className="w2-window-choices">
    <ul className="w2-menu-list">{devices.map(item => <li key={item.name}>
      <button type="button" className="w2-list-row" aria-pressed={item.name === deviceOf(current)} onClick={() => item.name !== deviceOf(current) && choose(item.window)}>{item.name}</button></li>)}</ul>
    <SplitReadout window={current}/>
  </div>;
}
