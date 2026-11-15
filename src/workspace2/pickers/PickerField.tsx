import { useState, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { ChevronRight } from 'lucide-react';
import { useNarrow, usePush } from '../kit';
import { useWorkspaceData } from './WorkspaceData';
import EntityList from './EntityList';
import IconList from './IconList';
import ServiceList from './ServiceList';
import { GlyphByName } from '../../preview2/nodes/shared';
import { iconName } from './icons';
import { serviceTitle } from './services';
import type { EntityRow } from './entities';
import './pickers.css';

/**
 * A row whose control opens a picker: a popover under the field when wide, a page pushed inside the open surface when narrow
 * (spec section 8: "Each picker is a popover under its field when wide and a pushed page in the sheet when narrow").
 * `children` receives `close`, which a pick calls.
 */
export function PickerRow({ label, primary, secondary, title, path, children, glyph, stacked }: {
  label?: string; primary: ReactNode; secondary?: ReactNode; title: string; path?: string; children: (close: () => void) => ReactNode; glyph?: ReactNode; stacked?: boolean;
}) {
  const narrow = useNarrow(), push = usePush();
  const [open, setOpen] = useState(false);
  const face = <><span className="w2-picker-face">{glyph}<span className="w2-picker-text"><span className="w2-picker-primary">{primary}</span>{secondary && <code className="w2-picker-secondary">{secondary}</code>}</span></span><ChevronRight size={16} aria-hidden/></>;
  const labelled = label ?? title;
  const row = (button: ReactNode) => <div className="w2-picker-row" data-field-path={path} data-stacked={stacked || undefined}>{label && <span className="w2-row-label">{label}</span>}{button}</div>;
  if (narrow && push) return row(<button type="button" className="w2-picker-button" aria-label={labelled} onClick={() => push.push({ title, body: <div className="w2-picker-page">{children(push.pop)}</div> })}>{face}</button>);
  return row(<Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger className="w2-picker-button" aria-label={labelled}>{face}</Popover.Trigger>
    <Popover.Portal><Popover.Positioner sideOffset={6} align="end" className="w2-positioner"><Popover.Popup className="w2-scope w2-popover w2-picker-pop" aria-label={title}>
      <Popover.Title className="w2-sr">{title}</Popover.Title>{children(() => setOpen(false))}
    </Popover.Popup></Popover.Positioner></Popover.Portal>
  </Popover.Root>);
}

/** The entity field: friendly name first, the id second. `onPick` receives the row (or a typed id). */
export function EntityField({ label = 'Entity', entityId, domains, onPick, path }: { label?: string; entityId?: string; domains?: readonly string[]; onPick: (row: EntityRow) => void; path?: string }) {
  const { entities } = useWorkspaceData();
  const row = entities.find(item => item.entityId === entityId);
  return <PickerRow label={label} title={label === 'Entity' ? 'Entity' : label} path={path} primary={entityId ? row?.name ?? entityId : <span className="w2-placeholder">Choose</span>} secondary={entityId && row && row.name !== entityId ? entityId : undefined}>
    {close => <EntityList domains={domains} onPick={picked => { onPick(picked); close(); }}/>}
  </PickerRow>;
}

/** The icon field: the stand-in glyph, the plain name and the symbol name. */
export function IconField({ label = 'Icon', symbol, onPick, path }: { label?: string; symbol: string; onPick: (symbol: string) => void; path?: string }) {
  return <PickerRow label={label} title="Icon" path={path} glyph={<span className="w2-picker-glyph"><GlyphByName name={symbol} size={18}/></span>} primary={iconName(symbol) ?? symbol} secondary={iconName(symbol) ? symbol : undefined}>
    {close => <IconList value={symbol} onPick={picked => { onPick(picked); close(); }}/>}
  </PickerRow>;
}

/** The service field: "Light: Turn on" and `light.turn_on`. */
export function ServiceField({ domain, service, onPick }: { domain: string; service: string; onPick: (domain: string, service: string) => void }) {
  return <PickerRow label="Service" title="Service" path="service" primary={serviceTitle({ domain, service, name: '' })} secondary={`${domain}.${service}`}>
    {close => <ServiceList onPick={row => { onPick(row.domain, row.service); close(); }}/>}
  </PickerRow>;
}
