import type { CompositionDocument, CompositionNode } from '../../src/shared/composition/schema';

type Source = CompositionDocument['dataSources'][number];
export type HomeRecipe = {
  surfaceId: string; components: CompositionNode[]; dataSources: Source[];
  publicationReady: boolean; dependencies: string[];
};
const clone = <T>(value: T): T => structuredClone(value);
/** Source-backed decompositions. Dependency-bearing recipes must not be offered as complete pages. */
export function homeRecipes(document: CompositionDocument): HomeRecipe[] {
  const root = document.pages[0], detail = document.pages[1];
  const overview = document.modals[0], weather = document.modals[1];
  const rail = root.components.find(node => node.type === 'status-rail');
  if (!rail || rail.type !== 'status-rail') throw new Error('Home fixture requires its typed status rail');
  const summary = root.components.find(node => node.type === 'weather-panel');
  const panels = weather.components.filter(node => node.type === 'weather-panel');
  const grid = overview.components.find(node => node.type === 'tile-grid');
  if (!grid || grid.type !== 'tile-grid' || !summary || summary.type !== 'weather-panel') throw new Error('Home fixture is missing domain primitives');
  const status = document.dataSources.find(source => source.kind === 'model' && source.model === 'home-status@1');
  if (!status || status.kind !== 'model' || status.model !== 'home-status@1') throw new Error('Home fixture requires its projection model');
  const result: HomeRecipe[] = [];
  function add(surfaceId: string, components: CompositionNode[], dependencies: string[] = [], dataSources = document.dataSources) {
    result.push({ surfaceId, components: clone(components), dataSources: clone(dataSources), publicationReady: dependencies.length === 0, dependencies });
  }
  add('home', root.components, [
    'camera: stream tile/viewer capability and per-source retention',
    'shell: section-sides split recipe with rail spanning and AX wrap placement',
    'shell: entity-backed guest visibility and value attachments',
    'security: alarm sheet destination and provider confirmation contract',
  ]);
  for (const [suffix, projection, target] of [
    ['lights', 'lights', 'light.demo_study'],
    ['climate', 'climate', 'sensor.demo_temperature'],
    ['occupancy', 'occupancy', 'binary_sensor.demo_presence'],
    ['contacts', 'contacts', 'binary_sensor.demo_window'],
    ['air-quality', 'air-quality', 'sensor.demo_aqi'],
  ] as const) {
    const source: Source = { ...clone(status), inputs: {
      ...clone(status.inputs), projection, format: 'room', entityIds: [{ type: 'literal', value: target }],
      ...(projection === 'air-quality' ? { secondaryEntityId: { type: 'literal', value: 'sensor.demo_pm25' } } : {}),
    } };
    add(`room-overview-${suffix}`, [grid], [
      'shell: stable-keyed live grouped collection (active/idle sections, empty section removal) and live sheet subtitle',
      ...(projection === 'air-quality' ? [] : ['rooms: injected group-detail destination and member metadata, not room ranking']),
      ...(projection === 'lights' ? ['lights: canonical RoomLightsPowerActions disc attachment; no generic toggle substitution'] : []),
    ], [source]);
  }
  const header = (id: string, panel: 'hero' | 'briefing', title: string): CompositionNode => ({
    id, title, type: 'weather-panel', layout: { span: 1 }, props: { ...clone(summary.props), panel },
  });
  add('weather-sheet', [header('fixture-hero', 'hero', 'Weather'), header('fixture-briefing', 'briefing', 'Today'), ...panels], [
    'shell: condition-gradient modal backdrop, shared motion/scroll behavior and expand/collapse attachment',
  ]);
  add('light-group-tile', detail.components);
  add('room-overview-tile', grid.children, [
    'rooms: contact member kind/count metadata and detail routing',
    'lights: room-group power disc attachment for lights overview cards',
  ]);
  add('status-chip', rail.children, [
    'shell: helper-derived live fill/glyph value attachments; fixed authored state appearances work now',
  ]);
  add('status-rail', [rail]);
  add('chip-rail', [rail]);
  add('weather-summary-card', [summary]);
  add('weather-hourly-panel', panels.filter(node => node.props.panel === 'hourly'));
  add('weather-highlights-tiles', panels.filter(node => node.props.panel === 'highlights'));
  return result;
}

export function requireCompleteHomeRecipe(recipe: HomeRecipe): HomeRecipe {
  if (!recipe.publicationReady) throw new Error(`Capability gap for ${recipe.surfaceId}: ${recipe.dependencies.join('; ')}`);
  return recipe;
}
