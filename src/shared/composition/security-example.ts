import type { CompositionDocument, CompositionNode } from './schema';
import { createCompositionDocument } from './workspace';

// MARK: Synthetic composition example

/** An explicit recipe, not renderer defaults. No credentials, real house IDs or service execution. */
export function securityExample(): CompositionDocument {
  const document = createCompositionDocument('demo-security');
  const icon = (name: string) => ({ type: 'sf-symbol' as const, name, rendering: 'canonical' as const, unavailable: 'reject' as const });
  const fill = (red: number, green: number, blue: number) => ({ type: 'solid-rgb' as const, red, green, blue });
  const appearance = (text: string, name: string, color = fill(84, 110, 122)) => ({ text, icon: icon(name), fill: color });
  const panel: Extract<CompositionNode, { type: 'alarm-panel' }> = {
    id: 'demo-panel-control', title: 'Security System', type: 'alarm-panel', layout: { span: 1 },
    props: {
      sourceId: 'demo-alarm', modes: [
        { state: 'disarmed', label: 'Disarm', hint: 'Disarms the security system', icon: icon('shield.slash'), fill: fill(67, 160, 71) },
        { state: 'armed_home', label: 'Home', hint: 'Sets the security system to Home', icon: icon('house'), fill: fill(30, 136, 229) },
        { state: 'armed_away', label: 'Away', hint: 'Sets the security system to Away', icon: icon('figure.walk'), fill: fill(229, 57, 53) },
        { state: 'armed_night', label: 'Night', hint: 'Sets the security system to Night', icon: icon('moon'), fill: fill(142, 36, 170) },
      ],
      states: [
        { state: 'disarmed', appearance: appearance('Disarmed', 'shield.slash', fill(67, 160, 71)) },
        { state: 'armed_home', appearance: appearance('Armed Home', 'shield.lefthalf.filled', fill(30, 136, 229)) },
        { state: 'armed_away', appearance: appearance('Armed Away', 'shield', fill(229, 57, 53)) },
        { state: 'armed_night', appearance: appearance('Armed Night', 'moon', fill(142, 36, 170)) },
        { state: 'triggered', appearance: appearance('Alarm Triggered', 'exclamationmark.shield', fill(229, 57, 53)) },
        { state: 'arming', appearance: appearance('Arming', 'shield') },
        { state: 'disarming', appearance: appearance('Disarming', 'shield.slash') },
        { state: 'pending', appearance: appearance('Pending', 'shield') },
      ],
      fallback: appearance('Unknown', 'shield'), subtitle: 'Security System', sincePrefix: 'Since ', separator: ' · ',
      loadingText: 'Loading', unavailableText: 'Unavailable', hiddenText: 'Hidden',
      errorText: "Didn't Respond", pendingText: 'Sending command',
      confirmation: { title: 'Disarm the Security System?', message: 'Doors and motion stop triggering the alarm.', confirmLabel: 'Disarm', cancelLabel: 'Cancel' },
      triggeredWash: fill(215, 0, 21),
    },
  };
  const root = document.pages[0];
  root.title = 'Security controls';
  document.dataSources = [
    { id: 'demo-alarm', kind: 'model', model: 'alarm-mode@1', inputs: { entityId: { type: 'literal', value: 'alarm_control_panel.demo_unit' } } },
    { id: 'demo-lock', kind: 'model', model: 'security-door@1', inputs: { kind: 'lock', entityId: { type: 'literal', value: 'lock.demo_unit' } } },
    { id: 'demo-garage', kind: 'model', model: 'security-door@1', inputs: { kind: 'garage', entityId: { type: 'literal', value: 'cover.demo_unit' } } },
  ];
  const door = (kind: 'lock' | 'garage'): Extract<CompositionNode, { type: 'door-tile' }> => ({
    id: `demo-${kind}-control`, title: kind === 'lock' ? 'Entry' : 'Garage', type: 'door-tile', layout: { span: 1 },
    props: {
      sourceId: `demo-${kind}`, kind,
      states: (kind === 'lock' ? ['locked', 'unlocked', 'locking', 'unlocking', 'jammed', 'open'] as const
        : ['closed', 'open', 'opening', 'closing'] as const).map(state => ({
        state, appearance: appearance(state, kind === 'lock' ? 'lock' : 'door.garage.closed', fill(67, 160, 71)),
        active: state !== 'locked' && state !== 'closed', error: state === 'jammed',
      })),
      fallback: appearance('Unknown', kind === 'lock' ? 'lock' : 'door.garage.closed'),
      loadingText: 'Loading', unavailableText: 'Unavailable', hiddenText: 'Hidden', errorText: "Didn't Respond",
      sendingOpenText: 'Sending Open...', sendingCloseText: 'Sending Close...',
      openLabel: kind === 'lock' ? 'Unlock' : 'Open', closeLabel: kind === 'lock' ? 'Lock' : 'Close', reverseLabel: 'Reverse',
    },
  });
  root.components = [
    { ...structuredClone(panel), id: 'demo-root-panel' },
    { id: 'demo-doors', title: 'Doors', type: 'tile-grid', layout: { span: 1 },
      props: { minimum: 'tile-dynamic-type@1', maxColumns: 4, spacing: { type: 'points', value: 12 }, equalRowHeights: true, shortRow: 'share', fold: 'page' },
      children: [door('lock'), door('garage')] },
    { id: 'demo-open-links', title: 'Quick Links', type: 'navigation-tile', layout: { span: 1 }, icon: icon('square.grid.2x2'),
      props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: '' } },
      action: { type: 'present', modalId: 'demo-quick-links', arguments: {}, ifPresented: 'reject' } },
    { id: 'demo-open-alarm-sheet', title: 'Security System', type: 'navigation-tile', layout: { span: 1 }, icon: icon('shield'),
      props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: '' } },
      action: { type: 'present', modalId: 'demo-alarm-sheet', arguments: {}, ifPresented: 'reject' } },
  ];
  document.pages.push({
    ...structuredClone(root), id: 'demo-local-alarm', title: 'Security System',
    toolbar: { type: 'replace', groups: [] },
    layout: { ...structuredClone(root.layout), maxWidth: { type: 'points', value: 560 } },
    components: [panel],
  });
  const sheet = {
    type: 'sheet' as const, width: 'form' as const, height: { type: 'fitted' as const, follows: 'top-page' as const, firstOpen: 'canonical@1' as const },
    appearance: 'system' as const, placement: 'canonical-sheet@1' as const, grabber: 'canonical' as const, navigation: 'local-stack@1' as const,
    close: { type: 'close' as const, visibility: 'root-only' as const, placement: 'trailing' as const, rail: 'automatic' as const, guard: { type: 'none' as const } },
  };
  const modalSurface = {
    icon: root.icon, parameters: root.parameters, layout: root.layout,
  };
  document.modals = [
    { ...structuredClone(modalSurface), id: 'demo-quick-links', title: 'Quick Links', toolbar: { type: 'replace', groups: [] }, presentation: sheet,
      components: [{ id: 'demo-alarm-link', title: 'Security System', type: 'navigation-tile', layout: { span: 1 }, icon: icon('shield'),
        props: { family: 'neutral', selected: 'none', subtitle: { type: 'literal', value: '' },
          alarm: {
            sourceId: 'demo-alarm', projection: 'alarm-navigation@1',
            states: structuredClone(panel.props.states), fallback: structuredClone(panel.props.fallback),
            loadingText: panel.props.loadingText, unavailableText: panel.props.unavailableText,
            errorText: panel.props.errorText, hiddenText: panel.props.hiddenText,
          } },
        action: { type: 'push', pageId: 'demo-local-alarm', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } }] },
    { ...structuredClone(modalSurface), id: 'demo-alarm-sheet', title: 'Security System', toolbar: { type: 'replace', groups: [] }, presentation: sheet,
      layout: { ...structuredClone(root.layout), maxWidth: { type: 'points', value: 560 } },
      components: [{ ...structuredClone(panel), id: 'demo-sheet-panel' }] },
  ];
  return document;
}
