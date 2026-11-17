import { useEffect, useId, useRef, type ReactNode } from 'react';
import { findNode } from '../shared/composition/components';
import { Menu } from '@base-ui/react/menu';
import { COMPONENT_LIMITS } from '../shared/composition/components';
import type { ComponentEntry, CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { setChoosing } from './chooseStore';
import { gatherEntries, type ChooseRows } from './rows';
import { labelFor } from './labels';
import { paramLabel, perPlaceParam, rowTarget, sameEverywhere, setPerPlace, shareable, type PerPlaceTarget } from './params';
import { perPlaceLineId } from './PerPlaceLine';
import { useRows } from './rowsContext';
import type { EditorPath } from '../composition-editor';

/**
 * Choose Fields (templates spec, "any field", option C): one button in the template that shows a box on every row of the selected node. A ticked row is
 * set per place; each tick is applied at once as a change to the template (so it asks first when two or more places use it, and Undo reverts it).
 */

/** Whether the node at `path` has a row a place could set, for the button's disabled state. */
export function hasSettableRow(document: CompositionDocument, component: ComponentEntry, node: CompositionNode, path: EditorPath): boolean {
  return gatherEntries(document, path).some(entry => !labelFor(node.type, entry.rel)?.hidden && rowTarget(document, component, node, entry.rel.join('/')) !== undefined);
}

/** The button that starts choosing, under "A change here asks first." Edit only. */
export function ChooseFieldsButton({ document, component, node, path }: { document: CompositionDocument; component: ComponentEntry; node: CompositionNode; path: EditorPath }) {
  const reason = useId();
  const any = hasSettableRow(document, component, node, path);
  return <div className="w2-choose-start">
    <button type="button" className="w2-param-add" data-choose-button disabled={!any} aria-describedby={any ? undefined : reason}
      onClick={() => {
        setChoosing(component.id);
        // Focus goes to the first box once the rows have drawn them.
        setTimeout(() => window.document.querySelector<HTMLElement>('[data-tick]')?.focus(), 0);
      }}>Choose Fields…</button>
    {!any && <p id={reason} className="w2-caption">This element has no field a place can set.</p>}
  </div>;
}

/** Ends choosing and returns focus to the button that started it. */
export function endChoosing(): void {
  setChoosing(undefined);
  setTimeout(() => window.document.querySelector<HTMLElement>('[data-choose-button]')?.focus(), 0);
}

/**
 * Whether a modal question is open (the "Update everywhere?" question, its name step): Escape belongs to it, not to choosing. Only the Studio's own modals
 * count: an alert dialog, or a popup marked `data-modal` (the kit Modal, the save dialog, the wide row editor; Base UI sets no `aria-modal`). A preview sheet and a toast are `role="dialog"` too but are not modal, and a phone's
 * sheet around the bar does not count either.
 */
function questionOpen(): boolean {
  return [...window.document.querySelectorAll('[role="alertdialog"], [data-modal]')].some(dialog => !dialog.querySelector('[data-testid="choose-bar"]'));
}

/** The bar pinned to the top of the panel while fields are chosen: what to do, and Done. Escape ends it too. */
export function ChooseBar({ component }: { component: ComponentEntry }) {
  const full = (component.params?.length ?? 0) >= COMPONENT_LIMITS.params;
  const limit = useId();
  useEffect(() => {
    // Escape ends choosing and nothing else: the capture phase and stopPropagation keep a sheet from closing with it, and an open tick menu keeps its own Escape.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || window.document.querySelector('[data-testid="tick-menu"]') || questionOpen()) return;
      event.stopPropagation();
      endChoosing();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return <div className="w2-choose-bar" role="region" aria-label="Choose fields" aria-describedby={full ? limit : undefined} data-testid="choose-bar">
    <p>{full ? <span id={limit}>{`A template holds ${COMPONENT_LIMITS.params} settings.`}</span> : 'Select the fields each place sets.'}</p>
    <button type="button" className="w2-primary" onClick={endChoosing}>Done</button>
  </div>;
}

/**
 * The rows' side of choosing: which rows can be set, and the box that sets one. Ticking a row that no setting fits makes a new setting named by
 * `suggestName`; with settings it could share it opens a menu ("Use Light" for each, "New Setting"). Unticking is Same Everywhere.
 */
export function useChooseRows(document: CompositionDocument, component: ComponentEntry | undefined, node: CompositionNode | undefined, say?: (message: string) => void, asking = false): ChooseRows {
  const { onChange, onError } = useRows();
  // A status line is spoken once the change has been applied: a change held for the edit question says nothing until it is answered, and nothing after Cancel.
  const pending = useRef<{ text: string; applied: (next: CompositionDocument) => boolean } | undefined>(undefined);
  const isSet = (next: CompositionDocument, field: string) => {
    const entry = next.componentLibrary?.find(item => item.id === component?.id);
    const found = entry && node ? findNode(entry.node, node.id) : undefined;
    return Boolean(entry && found && perPlaceParam(next, entry, found, field));
  };
  useEffect(() => {
    const waiting = pending.current;
    if (!waiting || !waiting.applied(document)) return;
    pending.current = undefined;
    say?.(waiting.text);
  }, [document, say]);
  // When the question closes, a change that did not land was cancelled: its line is dropped, so a later Undo cannot speak it.
  const wasAsking = useRef(false);
  useEffect(() => {
    if (wasAsking.current && !asking) pending.current = undefined;
    wasAsking.current = asking;
  }, [asking]);
  const run = (change: () => CompositionDocument, spoken: string, applied: (next: CompositionDocument) => boolean) => {
    try { pending.current = { text: spoken, applied }; onChange(change()); } catch (error) { pending.current = undefined; onError(error instanceof Error ? error.message : String(error)); }
  };
  const full = (component?.params?.length ?? 0) >= COMPONENT_LIMITS.params;
  return {
    settable: rel => Boolean(component && node && rowTarget(document, component, node, rel.join('/'))),
    box: rel => {
      if (!component || !node) return null;
      const field = rel.join('/'), target = rowTarget(document, component, node, field) as PerPlaceTarget;
      const param = perPlaceParam(document, component, node, field);
      const uses = param ? [] : shareable(document, component, target);
      return <Tick label={`Set ${target.label} per place`} ticked={Boolean(param)} disabled={!param && full && uses.length === 0} describedBy={param ? perPlaceLineId(node.id, field) : undefined}
        uses={uses.map(item => ({ name: item.name, text: `Use ${paramLabel(item)}` }))} canAdd={!full}
        onTick={() => run(() => setPerPlace(document, component.id, node.id, field), `${target.label} is set per place.`, next => isSet(next, field))}
        onUntick={() => run(() => sameEverywhere(document, component.id, node.id, field), `${target.label} is the same everywhere.`, next => !isSet(next, field))}
        onUse={name => run(() => setPerPlace(document, component.id, node.id, field, name), `${target.label} is set per place.`, next => isSet(next, field))}/>;
    },
  };
}

/** One box. A native checkbox, or when the row could share a setting a button that opens the menu, drawn as the same box. */
function Tick({ label, ticked, disabled, describedBy, uses, canAdd, onTick, onUntick, onUse }: {
  label: string; ticked: boolean; disabled: boolean; describedBy?: string; uses: { name: string; text: string }[]; canAdd: boolean;
  onTick: () => void; onUntick: () => void; onUse: (name: string) => void;
}): ReactNode {
  const menu = !ticked && uses.length > 0;
  const kept = useRef(false);
  // The box is a menu button or a checkbox by what the row can share, so a change swaps one element for the other: focus follows it to the new one.
  const keep = (action: () => void) => () => { kept.current = true; action(); };
  useEffect(() => {
    if (!kept.current) return;
    kept.current = false;
    [...window.document.querySelectorAll<HTMLElement>('[data-tick]')].find(box => box.getAttribute('aria-label') === label)?.focus();
  }, [menu, ticked, label]);
  if (menu) {
    return <Menu.Root>
      <Menu.Trigger className="w2-tick" data-tick aria-label={label} disabled={disabled}/>
      <Menu.Portal><Menu.Positioner sideOffset={6} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" data-testid="tick-menu">
        {uses.map(item => <Menu.Item key={item.name} className="w2-menu-item" onClick={keep(() => onUse(item.name))}>{item.text}</Menu.Item>)}
        <Menu.Separator className="w2-menu-sep"/>
        <Menu.Item className="w2-menu-item" disabled={!canAdd} onClick={keep(onTick)}>New Setting</Menu.Item>
      </Menu.Popup></Menu.Positioner></Menu.Portal>
    </Menu.Root>;
  }
  return <input type="checkbox" className="w2-tick" data-tick aria-label={label} aria-describedby={describedBy} checked={ticked} disabled={disabled}
    onChange={keep(() => (ticked ? onUntick() : onTick()))}/>;
}
