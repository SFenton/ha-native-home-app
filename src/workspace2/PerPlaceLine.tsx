import { useId } from 'react';
import { Menu } from '@base-ui/react/menu';
import { COMPONENT_LIMITS } from '../shared/composition/components';
import type { ComponentEntry, CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { paramLabel, perPlaceParam, rowTarget, sameEverywhere, setPerPlace, shareable } from './params';
import { useRows } from './rowsContext';

/** The id of the sentence under a row that is set per place, so the box that set it can be described by it. */
export const perPlaceLineId = (nodeId: string, field: string): string => `per-place-${nodeId}-${field}`.replace(/[^A-Za-z0-9_-]+/g, '-');

/**
 * The worded line under a row of a template (templates spec 3b-B and "any field"). A row that is set per place says so: "Set per place as Light." with
 * "Same Everywhere". A row that is not set shows "Set Per Place" only when it holds an entity or a state, the fields a template nearly always sets; every
 * other row is set from Choose Fields. With a setting the row may share, Set Per Place offers a menu: "Use Light" for each, and "New Setting". It is a
 * change to the template, so with two or more places it goes through the edit question. In Use the line is only a caption, and while fields are being
 * chosen only the set rows carry one.
 */
export default function PerPlaceLine({ document, component, node, field, readOnly, choosing }: { document: CompositionDocument; component: ComponentEntry; node: CompositionNode; field: string; /** Use mode: the sentence alone. */ readOnly?: boolean; /** Fields are being chosen: the box sets and unsets, so only the set line shows. */ choosing?: boolean }) {
  const { onChange, onError } = useRows();
  const limit = useId();
  const target = rowTarget(document, component, node, field);
  if (!target) return null;
  const label = target.label;
  const param = perPlaceParam(document, component, node, field);
  const run = (change: () => CompositionDocument) => { try { onChange(change()); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const describe = perPlaceLineId(node.id, field);
  if (param) {
    return <div className="w2-per-place" data-on data-testid="per-place-line">
      <p id={describe} className="w2-caption">{`Set per place as ${paramLabel(param)}.`}</p>
      {!readOnly && !choosing && <button type="button" className="w2-per-place-button" aria-label={`Same Everywhere: ${label}`} aria-describedby={describe}
        onClick={() => run(() => sameEverywhere(document, component.id, node.id, field))}>Same Everywhere</button>}
    </div>;
  }
  if (readOnly || choosing || (target.kind !== 'entity-id' && target.kind !== 'state-id')) return null;
  const same = shareable(document, component, target);
  const full = (component.params?.length ?? 0) >= COMPONENT_LIMITS.params && same.length === 0;
  const words = full ? `A template holds ${COMPONENT_LIMITS.params} settings.` : undefined;
  // The name starts with the visible words, so a person who says "Set Per Place" to a voice control reaches the button (WCAG 2.5.3, label in name).
  const name = `Set Per Place: ${label}`;
  return <div className="w2-per-place" data-testid="per-place-line">
    {same.length === 0 || full
      ? <button type="button" className="w2-per-place-button" aria-label={name} disabled={full} aria-describedby={words ? limit : undefined} onClick={() => run(() => setPerPlace(document, component.id, node.id, field))}>Set Per Place</button>
      : <Menu.Root>
        <Menu.Trigger className="w2-per-place-button" aria-label={name}>Set Per Place</Menu.Trigger>
        <Menu.Portal><Menu.Positioner sideOffset={6} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" data-testid="per-place-menu">
          {same.map(item => <Menu.Item key={item.name} className="w2-menu-item" onClick={() => run(() => setPerPlace(document, component.id, node.id, field, item.name))}>{`Use ${paramLabel(item)}`}</Menu.Item>)}
          <Menu.Separator className="w2-menu-sep"/>
          <Menu.Item className="w2-menu-item" disabled={(component.params?.length ?? 0) >= COMPONENT_LIMITS.params} onClick={() => run(() => setPerPlace(document, component.id, node.id, field))}>New Setting</Menu.Item>
        </Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.Root>}
    {words && <p id={limit} className="w2-caption">{words}</p>}
  </div>;
}
