import type { CompositionDocument } from '../shared/composition/schema';
import { solidColor } from '../shared/composition/fill-css';
import type { Json } from '../shared/types';
import type { House, Overlay, Projection } from './projections';
import { shownEntity } from './projections';

type Source = CompositionDocument['dataSources'][number];

const isDead = (state: string | undefined) => !state || ['unavailable', 'unknown'].includes(state.trim().toLowerCase());
const rgb = (fill: { type: string } | undefined) => solidColor(fill) ?? null;

/**
 * The models the panel drawings read, beside the ones `projectSource` resolves itself. `home-weather@1` gives the weather
 * entity's condition and temperature (no forecast: the snapshot carries none); `room-navigation@1` gives its authored items.
 * Any other model is `undefined`, which `projectSource` turns into an unavailable source.
 */
export function projectPanelSource(source: Source, house: House, overlay: Overlay): Projection | undefined {
  if (source.kind !== 'model') return undefined;
  switch (source.model) {
    case 'home-weather@1': {
      const found = shownEntity(house, overlay, source.inputs.weatherEntityId.value);
      const phase = !house.states ? 'loading' : !found || isDead(found.state) ? 'unavailable' : 'ready';
      const fields: Record<string, Json> = { phase };
      if (found && phase === 'ready') { fields.condition = found.state; fields.temperature = found.temperature ?? null; fields.unit = found.unit ?? null; }
      return { model: source.model, phase, fields };
    }
    case 'room-navigation@1': {
      const items: Json = source.items.map(item => ({
        id: item.id, title: item.title, icon: item.icon.name, fill: rgb(item.fill), bodyHint: item.bodyHint,
        visibilitySourceId: item.visibility?.sourceId ?? null, visibleStates: item.visibility?.states ?? null,
      }));
      return { model: source.model, phase: house.states ? 'ready' : 'loading', fields: { phase: house.states ? 'ready' : 'loading', items } };
    }
    default: return undefined;
  }
}
