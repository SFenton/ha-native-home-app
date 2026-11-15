/**
 * The shape rules for the Home Assistant services a published remote command names, mirroring the app's
 * `ServerUIServiceVocabulary.allows(_:in:)`. Any domain, service or script is allowed (the owner's full-control decision
 * replaced the earlier per-slot tables and the house-script membership check); only the call's shape is checked:
 * a target must belong to the domain being called, and a `script` call carries no target.
 */
export interface ServiceCallShape {
  domain: string;
  service: string;
  target?: string;
}
export interface SlotCalls {
  /** Pointer suffix of the slot relative to the remote configuration, as the app reports it. */
  field: string;
  calls: ServiceCallShape[];
}

/** Whether `call` has a well-formed shape. */
export function serviceCallAllowed(call: ServiceCallShape): boolean {
  if (call.domain === 'script') return call.target === undefined;
  return call.target === undefined || call.target.startsWith(`${call.domain}.`);
}

type Command = { type: string; call?: ServiceCallShape };
type Action = { type: 'command'; command: Command } | { type: 'state'; cases: { command: Command }[]; otherwise: Command };

/** Every service call an action can make. */
export function actionCalls(action: Action): ServiceCallShape[] {
  const one = (command: Command) => command.type === 'service' && command.call ? [command.call] : [];
  return action.type === 'command' ? one(action.command) : [...action.cases.flatMap(item => one(item.command)), ...one(action.otherwise)];
}

interface RemoteLike {
  power: { action: Action }; up: { action: Action }; left: { action: Action }; select: { action: Action };
  right: { action: Action }; down: { action: Action }; back: { action: Action }; home: { action: Action };
  keyboard?: { action: Action }; pause: { action: Action }; play: { action: Action };
  volumeDown: { action: Action }; volumeMute: { action: Action }; volumeUp: { action: Action };
  apps: { action: Action }[]; devices: { action?: Action }[]; cards: { configuration: { action?: Action } }[];
}

/** Every authored call of a remote configuration with the field it occupies, in the app's field naming. */
export function remoteSlotCalls(config: RemoteLike): SlotCalls[] {
  const result: SlotCalls[] = [];
  const buttons = ['power', 'up', 'left', 'select', 'right', 'down', 'back', 'home', 'keyboard', 'pause', 'play',
    'volumeDown', 'volumeMute', 'volumeUp'] as const;
  for (const name of buttons) {
    const button = config[name];
    if (button) result.push({ field: name, calls: actionCalls(button.action) });
  }
  config.apps.forEach((app, index) => result.push({ field: `apps/${index}`, calls: actionCalls(app.action) }));
  config.devices.forEach((device, index) => {
    if (device.action) result.push({ field: `devices/${index}`, calls: actionCalls(device.action) });
  });
  config.cards.forEach((card, index) => {
    if (card.configuration.action) result.push({ field: `cards/${index}/configuration`, calls: actionCalls(card.configuration.action) });
  });
  return result;
}
