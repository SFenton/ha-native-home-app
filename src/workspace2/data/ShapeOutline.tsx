import { useState, type KeyboardEvent } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Json } from '../../shared/types';
import { elementOf, withoutNull, type Shape } from '../../shared/composition/pipeline';
import { fieldSteps, fillsRow, kindWords, rowSlots, rowSlotWords, type FieldKind, type PipelineStepOp, type RowSlot } from './flow';
import { usePickSlot } from './focus';

/** One row of the outline: a field of the data, its path, one value from the data and its kind. */
export interface OutlineRow { name: string; path: string[]; depth: number; kind: FieldKind; values?: string[]; optional: boolean; example: string; hasChildren: boolean; length?: number }

const MAX_DEPTH = 3;
/** The text of one value in the data, for the outline's second column. Long text is cut; a group or list has none. */
export function exampleText(value: Json | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return '';
  const text = String(value);
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}
const at = (value: Json | undefined, name: string): Json | undefined => value && typeof value === 'object' && !Array.isArray(value) ? (value as { [key: string]: Json })[name] : undefined;
const firstOf = (value: Json | undefined): Json | undefined => Array.isArray(value) ? value[0] : value;

/**
 * The rows of an outline (studio-pipes D3): one per field of the item a point looks at, with a nested level for each group or list that is open. `value` is the
 * data at that point; its first item gives each field's example. A value that is not a group (a count) is one row named "value".
 */
export function outlineRows(shape: Shape, value: Json | undefined, open: ReadonlySet<string>, hide: boolean): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (current: Shape, data: Json | undefined, path: string[], depth: number) => {
    const element = elementOf(current), core = element ? withoutNull(element) : withoutNull(current);
    const members = core.kind === 'union' ? core.of : [core];
    const object = members.find(member => member.kind === 'object');
    if (!object || object.kind !== 'object') return;
    const item = firstOf(data);
    for (const [name, field] of Object.entries(object.fields)) {
      const words = kindWords(field.shape), here = [...path, name], child = at(item, name);
      const nested = words.kind === 'Group' || words.kind === 'List';
      rows.push({ name, path: here, depth, kind: words.kind, values: words.values, optional: words.optional || Boolean(field.optional), example: hide ? '' : exampleText(child), hasChildren: nested && depth < MAX_DEPTH, length: words.kind === 'List' && Array.isArray(child) ? child.length : undefined });
      if (nested && depth < MAX_DEPTH && open.has(here.join('.'))) walk(field.shape, child, here, depth + 1);
    }
  };
  if (rows.length === 0) {
    walk(shape, value, [], 0);
    if (rows.length === 0) {
      const words = kindWords(shape);
      rows.push({ name: 'value', path: [], depth: 0, kind: words.kind, values: words.values, optional: words.optional, example: hide ? '' : exampleText(value), hasChildren: false });
    }
  }
  return rows;
}

/** The kind chip's text: "Text · 3 Values", "Date · Optional", "List · 14". */
export function chipText(row: OutlineRow): string {
  const parts: string[] = [row.kind === 'List' && row.length !== undefined ? `List · ${row.length}` : row.kind];
  if (row.values?.length) parts[0] = `${row.kind} · ${row.values.length} ${row.values.length === 1 ? 'Value' : 'Values'}`;
  if (row.optional && row.kind !== 'Empty') parts.push('Optional');
  return parts.join(' · ');
}

/**
 * The typed outline (studio-pipes D3): a `tree` of the fields at one point of a flow. A click on a field fills the slot that has focus (pick mode), and with
 * none opens the field menu: "Add a Step" with the steps that fit it, "Use in Rows", "Copy Field Name". Arrow keys move and open; Enter is the click.
 */
export default function ShapeOutline({ shape, value, hide, label, rows: rowsOutput, onStep, onRow }: {
  shape: Shape; value?: Json; hide: boolean; /** What the tree is named. */ label: string;
  /** Whether the flow gives rows, so "Use in Rows" is offered. */ rows: boolean;
  onStep: (op: PipelineStepOp, field: string[], kind: FieldKind) => void; onRow: (slot: RowSlot, field: string[]) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ row: OutlineRow; anchor: HTMLElement }>();
  const slot = usePickSlot();
  const rows = outlineRows(shape, value, open, hide);
  const toggle = (row: OutlineRow) => setOpen(held => { const next = new Set(held), key = row.path.join('.'); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const press = (row: OutlineRow, anchor: HTMLElement) => {
    if (slot) { if (slot.accepts(row.kind)) slot.onPick(row.path); return; }
    if (row.path.length === 0) return;
    setMenu({ row, anchor });
  };
  const keys = (event: KeyboardEvent<HTMLUListElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-outline-row]')], current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => { event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus(); };
    const row = rows[current];
    if (event.key === 'ArrowDown') move(current + 1);
    else if (event.key === 'ArrowUp') move(current - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(buttons.length - 1);
    else if (event.key === 'ArrowRight' && row?.hasChildren && !open.has(row.path.join('.'))) { event.preventDefault(); toggle(row); }
    else if (event.key === 'ArrowLeft' && row?.hasChildren && open.has(row.path.join('.'))) { event.preventDefault(); toggle(row); }
  };
  return <div className="w2-outline" data-testid="shape-outline">
    {slot && <p className="w2-outline-pick" role="status">{`Choose a field for ${slot.label}. Esc cancels.`}</p>}
    <ul role="tree" aria-label={label} className="w2-outline-tree" onKeyDown={keys}>
      {rows.map((row, index) => {
        const expanded = open.has(row.path.join('.')), dimmed = Boolean(slot) && !slot!.accepts(row.kind);
        return <li key={row.path.join('.') || 'value'} role="none">
          <div role="treeitem" aria-level={row.depth + 1} aria-expanded={row.hasChildren ? expanded : undefined} aria-selected={false} aria-disabled={dimmed || undefined} className="w2-outline-item" style={{ paddingInlineStart: 8 + row.depth * 16 }}>
            {row.hasChildren ? <button type="button" className="w2-outline-twist" aria-label={`${expanded ? 'Close' : 'Open'} ${row.name}`} tabIndex={-1} onClick={() => toggle(row)}>{expanded ? <ChevronDown size={14} aria-hidden/> : <ChevronRight size={14} aria-hidden/>}</button> : <span className="w2-outline-twist" aria-hidden/>}
            <button type="button" className="w2-outline-row" data-outline-row data-dimmed={dimmed || undefined} tabIndex={index === 0 ? 0 : -1} aria-label={`${row.name}, ${chipText(row)}${row.example ? `, ${row.example}` : ''}`}
              onMouseDown={event => { if (slot) event.preventDefault(); }} onClick={event => press(row, event.currentTarget)}>
              <span className="w2-outline-name">{row.name}</span>
              {row.example && <span className="w2-outline-example">{row.example}</span>}
              <span className="w2-outline-kind" data-kind={row.kind}>{chipText(row)}</span>
            </button>
          </div>
        </li>;
      })}
    </ul>
    <Menu.Root open={Boolean(menu)} onOpenChange={next => { if (!next) setMenu(undefined); }}>
      <Menu.Portal><Menu.Positioner anchor={menu?.anchor} sideOffset={4} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" aria-label={menu ? `${menu.row.name}` : undefined}>
        {menu && <>
          <Menu.Group><Menu.GroupLabel className="w2-menu-label">Add a Step</Menu.GroupLabel>
            {fieldSteps(menu.row.kind).map(item => <Menu.Item key={item.op} className="w2-menu-item" onClick={() => onStep(item.op, menu.row.path, menu.row.kind)}>{item.label(menu.row.name)}</Menu.Item>)}
          </Menu.Group>
          {rowsOutput && <Menu.Group><Menu.GroupLabel className="w2-menu-label">Use in Rows</Menu.GroupLabel>
            {rowSlots.filter(item => item !== 'id').map(item => <Menu.Item key={item} className="w2-menu-item" disabled={!fillsRow(menu.row.kind)} onClick={() => onRow(item, menu.row.path)}>
              <span className="w2-choice-text">As {rowSlotWords[item]}{!fillsRow(menu.row.kind) && <small className="w2-choice-note">Text only</small>}</span></Menu.Item>)}
          </Menu.Group>}
          <Menu.Separator className="w2-menu-sep"/>
          <Menu.Item className="w2-menu-item" onClick={() => { void navigator.clipboard?.writeText(menu.row.path.join('.')); }}>Copy Field Name</Menu.Item>
        </>}
      </Menu.Popup></Menu.Positioner></Menu.Portal>
    </Menu.Root>
  </div>;
}
