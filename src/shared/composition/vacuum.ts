import { z } from 'zod/v4';
import { identifierSchema as id } from '../schema';
import { visibilityFields } from './expression';

const object = z.strictObject;
const text = (max = 240) => z.string().max(max).refine(value => Boolean(value.trim()));
const entity = text(160);
const title = text();
const symbol = object({ type: z.literal('sf-symbol'), name: text(80),
  rendering: z.literal('canonical'), unavailable: z.literal('reject') });

/** Targets, room order and transforms are document values, not house-global defaults. */
export const vacuumDescriptorSchema = object({
  title, entityId: entity, batteryEntityId: entity, cleanScript: entity, errorEntityId: entity,
  passesEntityId: entity, statusEntityId: entity, statusFlagEntityId: entity,
  vacuumMapId: text(120), mapRoomSelection: z.boolean(),
  mapRotationDegrees: z.number().min(-360).max(360), mapScale: z.number().min(0.01).max(10),
  coordinatorSessionEntityId: entity.optional(), dockButtonEntityId: entity.optional(),
  modeEntityId: entity.optional(), modeTextEntityId: entity.optional(), fanEntityId: entity.optional(), waterEntityId: entity.optional(),
  dockControls: object({ cleanScript: entity, dryScript: entity, dockStatusEntityId: entity, mopAttachmentEntityId: entity }).optional(),
  areaCleaning: object({ minimumSizeCm: z.number().min(1).max(100000), script: entity }).optional(),
  mapFocus: object({
    maximumViewAreaRatio: z.number().min(0).max(1).optional(),
    minimumExcludedAreaM2: z.number().min(0).max(1000000).optional(),
    minimumExcludedFraction: z.number().min(0).max(1).optional(),
    paddingCm: z.number().min(0).max(100000).optional(), wallAssociationCm: z.number().min(0).max(100000).optional(),
    requiredSegments: z.array(object({ id: text(80), name: title.optional() })).min(1).max(64),
  }).optional(),
  consumables: z.array(object({ title, entityId: entity, icon: text(80), kind: z.enum(['duration', 'status']) })).max(64),
  autoCleanDisabledRooms: z.array(object({ title, entityId: entity, icon: text(80) })).max(64),
  autoCleanControl: object({ title, entityId: entity, kind: z.enum(['automation', 'pause']) }).optional(),
  outcomeRoomNames: z.array(object({ roomId: id, name: title })).max(128),
  outcomeReconciliations: z.array(object({ roomId: id, entityId: entity })).max(128),
  zoneDescription: z.array(title).max(16),
  zones: z.array(object({ title, entityId: entity, icon: text(80), mapName: title.optional(),
    mopRequired: z.boolean().optional(), mopRequiredEntityId: entity.optional() })).max(64),
});
const destination = z.discriminatedUnion('type', [
  object({ type: z.literal('push'), pageId: id, arguments: object({}), origin: z.literal('sender'), duplicate: z.literal('reuse-nearest') }),
  object({ type: z.literal('present'), modalId: id, arguments: object({}), ifPresented: z.literal('reject') }),
]);
export const vacuumPrimitiveSchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('card'), icon: symbol, commands: z.array(z.enum(['start_pause', 'dock'])).max(2), destination }),
  object({ kind: z.literal('map'), overlay: z.enum(['rooms', 'autoClean']),
    height: z.number().min(100).max(800), runtimeHeight: z.number().min(100).max(800),
    label: title, loadingText: title, unavailableText: title, locate: z.boolean() }),
  object({ kind: z.literal('status'), metric: z.enum(['status', 'battery', 'dock']) }),
  object({ kind: z.literal('notices') }),
  object({ kind: z.literal('auto-clean') }),
  object({ kind: z.literal('settings'), rows: z.array(object({
    role: z.enum(['mode', 'fan', 'water', 'passes']), title: text(80), hint: title,
  })).min(1).max(4) }),
  object({ kind: z.literal('command'), command: z.enum(['clean', 'cleanArea', 'dock', 'stop', 'resume', 'cancelResume',
    'pause', 'cancelSession', 'cleanDock', 'stopDockClean', 'dryMops', 'stopDrying', 'emptyBin']), icon: symbol }),
  object({ kind: z.literal('choice'), entityId: entity, selection: z.enum(['rooms', 'autoClean']) }),
  object({ kind: z.literal('consumable'), entityId: entity }),
  object({ kind: z.literal('report'), destination }),
  object({ kind: z.literal('outcomes') }),
  object({ kind: z.literal('target'), mode: z.enum(['rooms', 'area']), icon: symbol, destination }),
  object({ kind: z.literal('clear-area'), icon: symbol }),
  object({ kind: z.literal('area-editor'), height: z.number().min(320).max(1000),
    onUse: z.discriminatedUnion('type', [object({ type: z.literal('back') }), object({ type: z.literal('dismiss'), scope: z.literal('current-modal') })]),
    discardLabel: text(80),
    onDiscard: z.discriminatedUnion('type', [object({ type: z.literal('back') }), object({ type: z.literal('dismiss'), scope: z.literal('current-modal') })]) }),
]);
export const vacuumControlSchema = object({
  id, title, type: z.literal('vacuum-control'), layout: object({ span: z.number().int().min(1).max(4) }), ...visibilityFields,
  props: object({ sourceId: id, primitive: vacuumPrimitiveSchema }),
});
export type VacuumDescriptor = z.infer<typeof vacuumDescriptorSchema>;
export type VacuumPrimitive = z.infer<typeof vacuumPrimitiveSchema>;
export type VacuumControl = z.infer<typeof vacuumControlSchema>;
export const vacuumCapabilities = ['sh.vacuum@1', 'sh.vacuum-map@1', 'sh.vacuum-controls@1', 'sh.vacuum-outcomes@1', 'sh.vacuum-area@1', 'sh.vacuum-auto-clean@1'];
export function vacuumPrimitiveCapabilities(p: VacuumPrimitive): string[] {
  return p.kind === 'auto-clean' ? ['vacuum-auto-clean'] : p.kind === 'map' ? ['vacuum-map'] : p.kind === 'area-editor' ? ['vacuum-area', 'vacuum-map']
    : p.kind === 'report' || p.kind === 'outcomes' ? ['vacuum-outcomes'] : ['vacuum-controls'];
}
type Add = (code: 'invalid_value' | 'invalid_combination', pointer: string) => void;
export function validateVacuumDescriptor(d: VacuumDescriptor, p: string, add: Add) {
  function check(value: string | undefined, key: string, domains: string[]) {
    if (value === undefined) return;
    if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value)) add('invalid_value', `${p}/${key}`);
    else if (!domains.includes(value.split('.')[0])) add('invalid_combination', `${p}/${key}`);
  }
  check(d.entityId, 'entityId', ['vacuum']);
  for (const key of ['batteryEntityId', 'errorEntityId', 'statusEntityId', 'coordinatorSessionEntityId'] as const) check(d[key], key, ['sensor']);
  check(d.statusFlagEntityId, 'statusFlagEntityId', ['sensor', 'input_text']);
  check(d.passesEntityId, 'passesEntityId', ['select', 'input_select']);
  check(d.cleanScript, 'cleanScript', ['script']);
  check(d.dockButtonEntityId, 'dockButtonEntityId', ['button']);
  check(d.modeTextEntityId, 'modeTextEntityId', ['sensor', 'input_text']);
  if (d.autoCleanControl) check(d.autoCleanControl.entityId, 'autoCleanControl/entityId', [d.autoCleanControl.kind === 'pause' ? 'switch' : 'automation']);
  for (const key of ['modeEntityId', 'fanEntityId', 'waterEntityId'] as const) check(d[key], key, ['select', 'input_select']);
  if (d.areaCleaning) check(d.areaCleaning.script, 'areaCleaning/script', ['script']);
  if (d.dockControls) {
    check(d.dockControls.cleanScript, 'dockControls/cleanScript', ['script']);
    check(d.dockControls.dryScript, 'dockControls/dryScript', ['script']);
    check(d.dockControls.dockStatusEntityId, 'dockControls/dockStatusEntityId', ['sensor']);
    check(d.dockControls.mopAttachmentEntityId, 'dockControls/mopAttachmentEntityId', ['binary_sensor']);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(d.vacuumMapId)) add('invalid_value', `${p}/vacuumMapId`);
  d.zones.forEach((v, i) => { check(v.entityId, `zones/${i}/entityId`, ['input_boolean']); check(v.mopRequiredEntityId, `zones/${i}/mopRequiredEntityId`, ['sensor']); });
  d.autoCleanDisabledRooms.forEach((v, i) => check(v.entityId, `autoCleanDisabledRooms/${i}/entityId`, ['switch']));
  d.consumables.forEach((v, i) => check(v.entityId, `consumables/${i}/entityId`, ['sensor', 'binary_sensor']));
  d.outcomeReconciliations.forEach((v, i) => check(v.entityId, `outcomeReconciliations/${i}/entityId`, ['input_text']));
  for (const [key, ids] of [
    ['zones', d.zones.map(v => v.entityId)], ['autoCleanDisabledRooms', d.autoCleanDisabledRooms.map(v => v.entityId)],
    ['consumables', d.consumables.map(v => v.entityId)], ['outcomeRoomNames', d.outcomeRoomNames.map(v => v.roomId)],
    ['outcomeReconciliations', d.outcomeReconciliations.map(v => v.roomId)],
  ] as const) if (new Set(ids).size !== ids.length) add('invalid_combination', `${p}/${key}`);
}
export function validateVacuumControl(c: VacuumControl, d: VacuumDescriptor, p: string, add: Add) {
  const v = c.props.primitive;
  const valid = v.kind === 'auto-clean' ? Boolean(d.autoCleanControl) : v.kind === 'choice' ? (v.selection === 'rooms' ? d.zones : d.autoCleanDisabledRooms).some(r => r.entityId === v.entityId)
    : v.kind === 'consumable' ? d.consumables.some(r => r.entityId === v.entityId)
    : v.kind === 'area-editor' || v.kind === 'clear-area' || (v.kind === 'target' && v.mode === 'area')
      || (v.kind === 'command' && v.command === 'cleanArea') ? Boolean(d.areaCleaning)
    : v.kind === 'status' && v.metric === 'dock' ? Boolean(d.dockControls) : true;
  if (!valid) add('invalid_combination', `${p}/primitive`);
}
