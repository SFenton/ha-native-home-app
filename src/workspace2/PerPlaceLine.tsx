import { useId } from 'react';
import { Menu } from '@base-ui/react/menu';
import { COMPONENT_LIMITS } from '../shared/composition/components';
import type { ComponentEntry, CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { paramLabel, perPlaceParam, perPlaceTarget, sameEverywhere, setPerPlace } from './params';
import { useRows } from './rowsContext';

/**
 * The worded line under an entity or state field of a template (templates spec 3b-B): "Set Per Place" while the field is the template's alone, then
 * "Set per place as Light." with "Same Everywhere". With a setting of that kind already, Set Per Place offers a menu: "Use Light" for each, and "New
 * Setting". It is a change to the template, so with two or more places it goes through the edit question.
 */
export default function PerPlaceLine({ document, component, node, field }: { document: CompositionDocument; component: ComponentEntry; node: CompositionNode; field: string }) {
  const { onChange, onError } = useRows();
  const describe = useId(), limit = useId();
  const target = perPlaceTarget(document, component, node, field);
  if (!target) return null;
  const label = target.label;
  const param = perPlaceParam(document, component, node, field);
  const run = (change: () => CompositionDocument) => { try { onChange(change()); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  if (param) {
    return <div className="w2-per-place" data-on data-testid="per-place-line">
      <p id={describe} className="w2-caption">{`Set per place as ${paramLabel(param)}.`}</p>
      <button type="button" className="w2-per-place-button" aria-label={`Same Everywhere: ${label}`} aria-describedby={describe}
        onClick={() => run(() => sameEverywhere(document, component.id, node.id, field))}>Same Everywhere</button>
    </div>;
  }
  const same = (component.params ?? []).filter(item => item.kind === target.kind);
  const full = (component.params?.length ?? 0) >= COMPONENT_LIMITS.params && same.length === 0;
  const words = full ? `A template holds ${COMPONENT_LIMITS.params} parameters.` : undefined;
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
