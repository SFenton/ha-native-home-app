import { z } from 'zod/v4';
import { identifierSchema } from '../schema';

const text = (max: number, blank = false) => z.string().max(max).refine(value => blank || Boolean(value.trim()));
const entity = text(160);
const common = {
  sourceId: identifierSchema, icon: text(80), hint: text(2000, true),
  loadingText: text(240), unavailableText: text(240), errorText: text(240),
};
const choice = z.strictObject({ value: text(80), label: text(80), icon: text(80), detail: text(2000, true) });
const choices = z.array(choice).min(1).max(64);
const unit = z.enum(['°F', '°C']);
const status = z.strictObject({
  projection: z.enum(['state', 'action', 'temperature', 'occupancy', 'vent', 'recommendation', 'reason',
    'indoor', 'predicted', 'comfortLow', 'comfortHigh', 'forecastLow', 'forecastHigh', 'weather', 'adjustment',
    'comfortBand', 'forecastRange', 'explanation', 'predictive', 'trackingSelected', 'trackingCritical', 'trackingOccupiedOnly']),
  unit, states: z.array(z.strictObject({ state: text(80), text: text(240) })).max(64), fallbackText: text(240),
});
export const climatePropsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('dial'), dial: z.strictObject({
    minimum: z.number().min(-100).max(200), maximum: z.number().min(-100).max(200),
    step: z.number().min(0.01).max(10), unit, size: z.enum(['page', 'modal', 'compact']),
  }) }),
  z.strictObject({ ...common, kind: z.literal('toggle') }),
  z.strictObject({ ...common, kind: z.literal('check') }),
  z.strictObject({ ...common, kind: z.literal('explicit-switch'), status: status.optional() }),
  z.strictObject({ ...common, kind: z.literal('mode'), choices }),
  z.strictObject({ ...common, kind: z.literal('fan'), choices }),
  z.strictObject({ ...common, kind: z.literal('preset'), choices }),
  z.strictObject({ ...common, kind: z.literal('options'), choices }),
  z.strictObject({ ...common, kind: z.literal('hub'), hub: z.strictObject({
    modeLabel: text(80), fanLabel: text(80), modes: choices, fans: z.array(choice).max(64),
  }) }),
  z.strictObject({ ...common, kind: z.literal('notice'), notice: z.strictObject({
    useEffectiveMode: z.boolean(), isWarning: z.boolean(),
    awayText: text(2000), vacationText: text(2000), unknownText: text(240),
    unavailableModeText: text(240), reasonFallback: text(2000), separator: text(80, true),
  }) }),
  z.strictObject({ ...common, kind: z.literal('status'), status, presentation: z.enum(['row', 'metric', 'headline', 'paragraphs']).optional() }),
  z.strictObject({ ...common, kind: z.literal('link'), status }),
  z.strictObject({ ...common, kind: z.literal('room-tile'), paletteIndex: z.number().int().min(0).max(255).optional() }),
]);
export const climateSourceSchema = z.strictObject({
  id: identifierSchema, kind: z.literal('model'), model: z.literal('climate@1'),
  inputs: z.strictObject({
    entityId: entity, rangeCommitEntityIds: z.array(entity).max(64),
    actionEntityId: entity.optional(), sensorEntityId: entity.optional(), occupancyEntityId: entity.optional(),
    effectiveAway: z.strictObject({ ecoEntityId: entity, modeEntityId: entity, fallbackEntityId: entity }).optional(),
    trackingGate: z.strictObject({
      selectedEntityId: entity, criticalEntityId: entity.optional(), criticalOption: text(240).optional(),
      trackedEntityId: entity.optional(),
    }).optional(),
    homeAway: z.strictObject({
      modeEntityId: entity, reasonEntityId: entity, fallbackEntityId: entity, vacationEntityId: entity,
    }).optional(),
    tracking: z.strictObject({
      policyEntityId: entity, criticalOption: text(240),
      rooms: z.array(z.strictObject({
        selectedEntityId: entity, criticalEntityId: entity, occupiedOnlyEntityId: entity,
      })).min(1).max(64),
    }).optional(),
  }),
});
export type ClimateProps = z.infer<typeof climatePropsSchema>;
export type ClimateInputs = z.infer<typeof climateSourceSchema>['inputs'];
export const climateCapabilities = [
  'sh.climate-source@1', 'sh.climate-dial@1', 'sh.climate-toggle@1', 'sh.climate-mode@1',
  'sh.climate-fan@1', 'sh.climate-preset@1', 'sh.climate-options@1', 'sh.climate-status@1', 'sh.climate-hub@1', 'sh.climate-notice@1',
  'sh.climate-check@1', 'sh.climate-link@1', 'sh.climate-room-tile@1',
] as const;
export function climateCapability(kind: ClimateProps['kind']) {
  return `sh.climate-${kind === 'explicit-switch' ? 'toggle' : kind}@1`;
}

type Add = (code: 'invalid_value' | 'invalid_combination' | 'binding_type', path: string) => void;
export function validateClimateInputs(source: ClimateInputs, path: string, add: Add) {
  const entity = (value: string, key: string, domains: string[]) => {
    if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value)) add('invalid_value', `${path}/${key}`);
    else if (!domains.includes(value.split('.')[0])) add('invalid_combination', `${path}/${key}`);
  };
  entity(source.entityId, 'entityId', ['climate', 'switch', 'input_boolean', 'select', 'sensor', 'binary_sensor', 'cover']);
  source.rangeCommitEntityIds.forEach((value, i) => entity(value, `rangeCommitEntityIds/${i}`, ['climate']));
  if (new Set(source.rangeCommitEntityIds).size !== source.rangeCommitEntityIds.length
    || (source.rangeCommitEntityIds.length > 0 && !source.entityId.startsWith('climate.'))) add('invalid_combination', `${path}/rangeCommitEntityIds`);
  if (source.actionEntityId) entity(source.actionEntityId, 'actionEntityId', ['climate']);
  if (source.sensorEntityId) entity(source.sensorEntityId, 'sensorEntityId', ['sensor']);
  if (source.occupancyEntityId) entity(source.occupancyEntityId, 'occupancyEntityId', ['sensor', 'binary_sensor']);
  if (source.effectiveAway) {
    if (!source.entityId.startsWith('climate.')) add('invalid_combination', `${path}/effectiveAway`);
    entity(source.effectiveAway.ecoEntityId, 'effectiveAway/ecoEntityId', ['climate']);
    entity(source.effectiveAway.modeEntityId, 'effectiveAway/modeEntityId', ['sensor']);
    entity(source.effectiveAway.fallbackEntityId, 'effectiveAway/fallbackEntityId', ['binary_sensor', 'input_boolean']);
  }
  if (source.trackingGate) {
    const gate = source.trackingGate;
    entity(gate.selectedEntityId, 'trackingGate/selectedEntityId', ['switch', 'input_boolean']);
    if (gate.criticalEntityId) entity(gate.criticalEntityId, 'trackingGate/criticalEntityId', ['select']);
    if (gate.trackedEntityId) entity(gate.trackedEntityId, 'trackingGate/trackedEntityId', ['switch', 'input_boolean']);
    if ((gate.criticalEntityId === undefined) !== (gate.criticalOption === undefined)) add('invalid_combination', `${path}/trackingGate`);
  }
  if (source.homeAway) {
    entity(source.homeAway.modeEntityId, 'homeAway/modeEntityId', ['sensor']);
    entity(source.homeAway.reasonEntityId, 'homeAway/reasonEntityId', ['sensor']);
    entity(source.homeAway.fallbackEntityId, 'homeAway/fallbackEntityId', ['binary_sensor', 'input_boolean']);
    entity(source.homeAway.vacationEntityId, 'homeAway/vacationEntityId', ['switch', 'input_boolean']);
  }
  if (source.tracking) {
    entity(source.entityId, 'entityId', ['switch', 'input_boolean']);
    entity(source.tracking.policyEntityId, 'tracking/policyEntityId', ['select']);
    const ids = new Set<string>();
    source.tracking.rooms.forEach((room, index) => {
      for (const [key, id] of Object.entries(room)) {
        entity(id, `tracking/rooms/${index}/${key}`, ['switch', 'input_boolean']);
        if (ids.has(id)) add('invalid_combination', `${path}/tracking/rooms/${index}/${key}`);
        ids.add(id);
      }
    });
  }
}
export function validateClimateControl(props: ClimateProps, source: ClimateInputs, path: string, add: Add) {
  const domain = source.entityId.split('.')[0];
  const valid = props.kind === 'status' || props.kind === 'link' || (props.kind === 'toggle' || props.kind === 'check' ? ['switch', 'input_boolean'].includes(domain)
    : props.kind === 'explicit-switch' ? domain === 'switch' : props.kind === 'options' ? domain === 'select' : domain === 'climate');
  if (!valid) add('binding_type', `${path}/sourceId`);
  if (props.kind === 'notice' && !source.homeAway) add('binding_type', `${path}/sourceId`);
  if (props.kind === 'room-tile' && (!source.sensorEntityId || !source.occupancyEntityId)) add('binding_type', `${path}/sourceId`);
  if ('status' in props && props.status && ['trackingSelected', 'trackingCritical', 'trackingOccupiedOnly'].includes(props.status.projection)
      && !source.tracking) add('binding_type', `${path}/sourceId`);
  if (source.effectiveAway && !['dial', 'status', 'notice'].includes(props.kind)) add('invalid_combination', `${path}/sourceId`);
  if (props.kind === 'dial' && (props.dial.maximum <= props.dial.minimum || props.dial.step > props.dial.maximum - props.dial.minimum))
    add('invalid_combination', `${path}/dial`);
  if ('choices' in props && new Set(props.choices.map(choice => choice.value)).size !== props.choices.length)
    add('invalid_combination', `${path}/choices`);
  if (props.kind === 'hub') {
    if (new Set(props.hub.modes.map(choice => choice.value)).size !== props.hub.modes.length) add('invalid_combination', `${path}/hub/modes`);
    if (new Set(props.hub.fans.map(choice => choice.value)).size !== props.hub.fans.length) add('invalid_combination', `${path}/hub/fans`);
  }
  if ('status' in props && props.status && new Set(props.status.states.map(state => state.state)).size !== props.status.states.length)
    add('invalid_combination', `${path}/status/states`);
}
