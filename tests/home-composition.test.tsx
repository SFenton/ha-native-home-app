// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CompositionFields from '../src/CompositionFields';
import { componentLocations, compositionEditorSchema, fieldVariants, resolveField, valueAt, nodeDefinition } from '../src/composition-editor';
import { compileCompositionDocument, legacyManifest } from '../src/shared/composition/compiler';
import { compositionPublicationSchema } from '../src/shared/composition/schema';
import { homeRecipes, requireCompleteHomeRecipe } from './fixtures/home-recipes';
import fixture from './fixtures/home-primitives.json';

afterEach(cleanup);
const document = () => compileCompositionDocument(structuredClone(fixture.document)).document;

describe('Home primitives and exact closure', () => {
  it('matches the native synthetic wire fixture without changing first-slice requirements', () => {
    const value = compositionPublicationSchema.parse(fixture);
    expect(legacyManifest(compileCompositionDocument(value.document).capabilities)).toEqual(legacyManifest(value.capabilities));
    expect(componentLocations(value.document).map(entry => entry.node.id)).toContain('fixture-chip');
    const rail = value.document.pages[0].components[0];
    expect(rail.type === 'status-rail' && rail.children[0].type === 'status-chip' && rail.children[0].props.states[0].appearance.glyph)
      .toEqual({ type: 'solid-rgb', red: 255, green: 255, blue: 255 });
    expect(value.document.dataSources[1]).toMatchObject({
      model: 'home-weather@1', inputs: { weatherEntityId: { value: 'weather.demo_forecast' }, units: 'source@1' },
    });
  });

  it('rejects wrong adapters, duplicate states, invalid modes, and non-chip rail children', () => {
    const invalid = (mutate: (value: ReturnType<typeof document>) => void, pointer: string) => {
      const value = document(); mutate(value);
      try { compileCompositionDocument(value); throw new Error('Expected rejection'); }
      catch (error) { expect(error).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ pointer })]) }); }
    };
    invalid(value => {
      const grid = value.modals[0].components[0];
      const tile = grid.type === 'tile-grid' ? grid.children[0] : undefined;
      if (tile?.type === 'room-overview-tile') tile.props.fallback.glyph = { type: 'solid-rgb', red: 255, green: 255, blue: 255 };
    }, '/document/modals/0/components/0/children/0/props/fallback/glyph');
    invalid(value => {
      const summary = value.pages[0].components[1];
      if (summary.type === 'weather-panel') summary.props.sourceId = 'fixture-status';
    }, '/document/pages/0/components/1/props/sourceId');
    invalid(value => {
      const summary = value.pages[0].components[1];
      if (summary.type === 'weather-panel') summary.props.modes = ['wind'];
    }, '/document/pages/0/components/1/props/initialMode');
    invalid(value => {
      const summary = value.pages[0].components[1];
      if (summary.type === 'weather-panel') summary.props.modes = ['condition', 'condition'];
    }, '/document/pages/0/components/1/props/modes');
    invalid(value => {
      const highlights = value.modals[1].components[2];
      if (highlights.type === 'weather-panel') highlights.props.highlights = ['wind', 'wind'];
    }, '/document/modals/1/components/2/props/highlights');
    invalid(value => {
      const rail = value.pages[0].components[0];
      if (rail.type === 'status-rail') rail.children.push({ ...structuredClone(value.pages[0].components[1]), id: 'wrong-rail-type' });
    }, '/document/pages/0/components/0/children/1/type');
    invalid(value => {
      const rail = value.pages[0].components[0];
      const chip = rail.type === 'status-rail' ? rail.children[0] : undefined;
      if (chip?.type === 'status-chip') chip.props.states.push(structuredClone(chip.props.states[0]));
    }, '/document/pages/0/components/0/children/0/props/states/1/state');
    invalid(value => {
      const source = value.dataSources[1];
      if (source.kind === 'model' && source.model === 'home-weather@1') source.inputs.weatherEntityId.value = 'switch.demo_other';
    }, '/document/dataSources/1/inputs/weatherEntityId/value');
  });

  it('accounts for all 15 surfaces and refuses incomplete parent recipes', () => {
    const recipes = homeRecipes(document());
    expect(recipes).toHaveLength(15);
    expect(new Set(recipes.map(recipe => recipe.surfaceId)).size).toBe(15);
    for (const recipe of recipes) {
      if (recipe.publicationReady) expect(requireCompleteHomeRecipe(recipe)).toBe(recipe);
      else expect(() => requireCompleteHomeRecipe(recipe)).toThrow('Capability gap');
    }
    const overview = recipes.find(recipe => recipe.surfaceId === 'room-overview-contacts')!;
    expect(overview.dataSources[0]).toMatchObject({ model: 'home-status@1', inputs: { projection: 'contacts' } });
  });
});

describe('generated Home authoring controls', () => {
  it('edits weather paging and highlight order without raw JSON', () => {
    let value = document();
    const nodeSchema = nodeDefinition();
    expect(nodeSchema).toBeDefined();
    const schema = fieldVariants(nodeSchema!).find(variant => variant.properties?.type?.const === 'weather-panel')!;
    expect(schema).toBeDefined();
    const path = ['modals', 1, 'components', 2];
    const fields = () => <CompositionFields schema={schema} value={value.modals[1].components[2]} path={path} label="Highlights"
      document={value} onChange={next => { value = next; }} onError={message => { throw new Error(message); }}/>;
    const view = render(fields());
    fireEvent.change(screen.getByLabelText('Compact Hours'), { target: { value: '4' } });
    expect(valueAt(value, [...path, 'props', 'compactHours'])).toBe(4);
    view.rerender(fields());
    expect(screen.getByLabelText('Initial Mode')).toBeTruthy();
    fireEvent.click(screen.getByText('3. Item 3'));
    fireEvent.click(screen.getByLabelText('Move Item 3 up'));
    expect(valueAt(value, [...path, 'props', 'highlights'])).toEqual(['aqi', 'wind', 'precipitation', 'humidity', 'sun']);
    compileCompositionDocument(value);
  });

  it('exposes status mapping, fill, announcement and destination as schema fields', () => {
    const nodeSchema = nodeDefinition();
    const schema = fieldVariants(nodeSchema!).find(variant => variant.properties?.type?.const === 'status-chip')!;
    const props = resolveField(schema.properties!.props);
    expect(Object.keys(props?.properties ?? {})).toEqual(expect.arrayContaining(['sourceId', 'states', 'fallback', 'announcement']));
    expect(schema.properties?.action).toBeDefined();
  });
});
