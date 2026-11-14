import type { VacuumDescriptor, VacuumControl, VacuumPrimitive } from '../../src/shared/composition/vacuum';
import { createCompositionDocument } from '../../src/shared/composition/workspace';

export const vacuumDescriptor: VacuumDescriptor = {
  title: 'Demo Robot', entityId: 'vacuum.demo_robot', batteryEntityId: 'sensor.demo_battery',
  cleanScript: 'script.demo_clean', errorEntityId: 'sensor.demo_error', passesEntityId: 'input_select.demo_passes',
  statusEntityId: 'sensor.demo_status', statusFlagEntityId: 'input_text.demo_flag', vacuumMapId: 'demo_robot',
  mapRotationDegrees: 90, mapScale: 0.9, mapRoomSelection: true,
  areaCleaning: { minimumSizeCm: 50, script: 'script.demo_area' }, modeEntityId: 'select.demo_mode',
  consumables: [{ title: 'Brush', entityId: 'sensor.demo_brush', icon: 'mdi:brush', kind: 'duration' }],
  autoCleanDisabledRooms: [{ title: 'Demo Room', entityId: 'switch.demo_room_skip', icon: 'mdi:sofa' }],
  outcomeRoomNames: [{ roomId: 'demo-room', name: 'Demo Room' }],
  outcomeReconciliations: [{ roomId: 'demo-room', entityId: 'input_text.demo_reconciled' }],
  zoneDescription: ['Synthetic rooms'],
  zones: [{ title: 'Demo Room', entityId: 'input_boolean.demo_room', icon: 'mdi:sofa', mapName: 'Demo Segment', mopRequired: false }],
};
export const vacuumIcon = { type: 'sf-symbol', name: 'fan', rendering: 'canonical', unavailable: 'reject' } as const;
export function vacuumNode(primitive: VacuumPrimitive, id = 'robot-control'): VacuumControl {
  return { id, title: 'Configured Robot', type: 'vacuum-control', layout: { span: 1 }, props: { sourceId: 'source-robot', primitive } };
}
export function vacuumDocument(primitive: VacuumPrimitive = { kind: 'status', metric: 'battery' }) {
  const document = createCompositionDocument('demo-document');
  document.dataSources = [{ id: 'source-robot', kind: 'model', model: 'vacuum@1', inputs: structuredClone(vacuumDescriptor) }];
  document.pages[0].components = [vacuumNode(primitive)];
  return document;
}
