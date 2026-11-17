/**
 * The corpus cases of `sh.tile-ink-default@1`: a capability with no field, declared by every document the Studio compiles from now on
 * (`build/design/sim-fidelity-contract.md`, section 1). One compiling case per tile type that draws a glyph and a state line; an app that predates the id
 * refuses each with `unsupported_capability`, so they sit as `reject/pending-tile-ink-default-*`. There is no refusal: the id has no field to get wrong.
 *
 *   tsx scripts/generate-tile-ink-corpus.ts   # rewrites contract/corpus/reject/pending-tile-ink-default-*.json and their index entries
 *
 * The rest of the corpus is not regenerated: a publication made before the id lists the manifest without it, which the Studio still accepts. Demo ids only.
 */
import { demoSources, lit, node, symbolOf, writeFamily, type J, type TileCase } from './tilecontract-lib';

const cases: TileCase[] = [];
const accept = (name: string, note: string, components: J[], tweak?: TileCase['tweak']) =>
  cases.push({ name: `pending-tile-ink-default-${name}`, note, needs: ['tile-ink-default'], components, reject: false, tweak });

const sources: J[] = [
  ...demoSources,
  { id: 'power', kind: 'model', model: 'power-toggle@1', inputs: { entityId: lit('switch.demo_lamp') } },
  { id: 'rooms-lights', kind: 'model', model: 'home-status@1', labels: { idle: 'All Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'None', hidden: 'Hidden' },
    inputs: { projection: 'lights', format: 'room', entityIds: [lit('light.demo_a'), lit('light.demo_b')], awayEntityIds: [] } },
];

accept('state-tile', 'A state tile with no family and no tint: its glyph and its state line draw the primary ink when idle.', [node('blinds-tile', 'state-tile', {
  icon: symbolOf('blinds.horizontal.open'), binding: { entityId: 'cover.demo_blinds', builtIn: 'blind' }, props: {} })]);
accept('light-group-tile', 'A light group tile: the idle bulb and its "Off" line draw the primary ink.', [node('lamp', 'light-group-tile', { props: { sourceId: 'light-main' } })]);
accept('room-overview-tile', 'A room overview tile: the idle glyph and its count line draw the primary ink.', [node('room', 'room-overview-tile', {
  props: { sourceId: 'rooms-lights', states: [], fallback: { icon: symbolOf('lightbulb'), fill: { type: 'standard' } }, announcement: 'none', hidesContactSubtitle: false } })]);
accept('action-tile', 'A power action tile with the neutral family: its glyph and state line draw the primary ink when off.', [node('power-tile', 'action-tile', {
  icon: symbolOf('power'), binding: { sourceId: 'power', projection: 'power-tile@1' }, props: { family: 'neutral', bodyActionId: 'power', actionOrder: ['power'], stateText: 'provider', feedback: 'policy' },
  action: { type: 'domain', sourceId: 'power', intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } } })]);

writeFamily('tile-ink-default', cases, { 'tile-ink-default': 'sh.tile-ink-default@1' }, sources);
