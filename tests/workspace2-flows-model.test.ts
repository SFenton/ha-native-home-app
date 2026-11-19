import { expect, it } from 'vitest';
import { replaceAt } from '../src/composition-editor';
import { entityReaders, fieldsWithLogic, outputKind } from '../src/workspace2/flows/model';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { Operand, Predicate } from '../src/shared/composition/expression';
import gallery from '../src/preview2/fixtures/logic-gallery.json';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { documentDependencies, pruneEntitySources, sourceUses } from '../src/workspace2/dialogs/sources';
import firstSlice from './fixtures/composition-first-slice.json';
import { newFlow } from '../src/workspace2/data/flow';
import type { PipelineSource } from '../src/shared/composition/pipeline';
import { CompositionValidationError } from '../src/shared/composition/json';

const document = gallery.document as unknown as CompositionDocument;
const path = ['pages', 0, 'components', 0, 'children', 0];
const read: Operand = { type: 'read', from: { type: 'source', sourceId: 'demo-light-1', path: ['state'] }, as: 'number', missing: 'unavailable' };
const state: Predicate = { type: 'state', sourceId: 'demo-light-1', path: ['state'], in: ['on'] };
const entitySource = (id: string) => ({ id, kind: 'ha-entity', entityId: { type: 'literal', value: `sensor.demo_${id.replaceAll('-', '_')}` } } satisfies CompositionDocument['dataSources'][number]);
const sourceRead = (id: string) => ({ type: 'read', from: { type: 'source', sourceId: id, path: ['state'] }, as: 'string', missing: 'unavailable' } satisfies Operand);
const sourceState = (id: string): Predicate => ({ ...state, sourceId: id });
const textReader = (id: string) => ({
  id, title: id, type: 'text', layout: { span: 1 }, props: { value: sourceRead(id), style: 'body', unavailableText: 'Unavailable' },
} satisfies CompositionDocument['pages'][number]['components'][number]);
const toolbarReader = (id: string): CompositionDocument['navigation']['chrome']['groups'][number] => ({
  id: `${id}-group`, placement: 'trailing', horizontal: 'shared@1', vertical: 'shared@1',
  items: [{
    id, type: 'button', label: id, menuLabel: id, icon: document.pages[0].icon,
    visibility: 'always', priority: 'normal', rail: 'eligible', badge: { type: 'none' },
    action: { type: 'conditional', cases: [{ when: sourceState(id), then: { type: 'back' } }], otherwise: { type: 'none' } },
  }],
});
const withLevel = (): CompositionDocument => {
  const base = structuredClone(document);
  const { navigation: _navigation, ...surface } = base.pages[0];
  return {
    ...base, dataSources: [entitySource('level-reader'), entitySource('sample-source')], logicLibrary: [], componentLibrary: [],
    pages: [{ ...base.pages[0], components: [] }],
    modals: (firstSlice.document as unknown as CompositionDocument).modals.map(modal => ({ ...modal, components: [] })),
    levels: [{ ...surface, id: 'reader-level', title: 'Reader level', toolbar: { type: 'replace', groups: [] }, components: [] }],
  };
};
const parameterFlow = (id: string, sourceId: string): PipelineSource => {
  const source = newFlow(withLevel(), 'none', { title: id }).document.dataSources.at(-1)!;
  if (source.kind !== 'model' || source.model !== 'pipeline@1') throw new Error('Expected the new flow');
  return { ...source, id, inputs: { ...source.inputs, parameters: [{ name: 'input', type: 'string', value: sourceRead(sourceId) }], request: { type: 'none', value: { type: 'param', name: 'input' } } } };
};
const entityIdRead = (sourceId: string) => ({ ...sourceRead(sourceId), as: 'entity-id', from: { type: 'source', sourceId, path: ['attributes', 'entity_id'] } } satisfies Operand);

it('lists one field rather than its nested operands, and discovers conditions, looks and rules without duplicating children', () => {
  const fields = fieldsWithLogic(document);
  expect(fields.filter(field => field.title === 'Lights' && field.path.endsWith('/props/subtitle'))).toHaveLength(1);
  let edited = replaceAt(document, [...path, 'visibleWhen'], { type: 'all', of: [state, { type: 'not', of: state }] });
  edited = replaceAt(edited, [...path, 'props', 'activeWhen'], { type: 'not', of: state });
  edited = replaceAt(edited, [...path, 'props', 'filledWhen'], { type: 'numeric', sourceId: 'demo-light-1', path: ['state'], above: read });
  edited = replaceAt(edited, [...path, 'props', 'errorWhen'], { type: 'numeric', sourceId: 'demo-light-1', path: ['state'], above: { type: 'literal', value: 10 } });
  edited = replaceAt(edited, [...path, 'action'], { type: 'conditional', cases: [{ when: state, then: { type: 'none' } }], otherwise: { type: 'none' } });
  const paths = fieldsWithLogic(edited).map(field => field.path);
  for (const suffix of ['visibleWhen', 'props/activeWhen', 'props/filledWhen', 'action']) expect(paths).toContain(`${path.join('/')}/${suffix}`);
  expect(paths).not.toContain(`${path.join('/')}/props/errorWhen`);
  expect(paths).not.toContain(`${path.join('/')}/action/cases/0/when`);
  expect(fieldsWithLogic(replaceAt(document, [...path, 'visibleWhen'], state)).some(field => field.path === `${path.join('/')}/visibleWhen`)).toBe(false);
});

it('keeps output glyphs typed when a template body contains settings rather than concrete operands', () => {
  const params: NonNullable<CompositionDocument['logicLibrary']>[number]['params'] = [{ name: 'count', kind: 'number', sample: 3 }, { name: 'start', kind: 'text', display: 'time', sample: '07:00' }];
  expect(outputKind({ type: 'math', op: 'add', args: [{ type: 'hole', name: 'count' }, { type: 'literal', value: 1 }] }, document, params)).toBe('number');
  expect(outputKind({ type: 'hole', name: 'count' }, document, params)).toBe('number');
  expect(outputKind({ type: 'literal', value: { type: 'hole', name: 'start' } }, document, params)).toBe('time');
  expect(outputKind({ type: 'list', items: [{ type: 'hole', name: 'count' }] }, document, params)).toBe('list');
});

it('keeps compound template conditions at their owning field, including enabled conditions', () => {
  const logicLibrary: NonNullable<CompositionDocument['logicLibrary']> = [
    { id: 'check-one', name: 'First check', kind: 'condition', params: [], body: state },
    { id: 'check-two', name: 'Second check', kind: 'condition', params: [], body: state },
  ];
  const compound = { type: 'all', of: logicLibrary.map(entry => ({ type: 'logic-ref', logicId: entry.id, args: {} })) };
  let edited = replaceAt({ ...document, logicLibrary }, [...path, 'visibleWhen'], compound);
  edited = replaceAt(edited, [...path, 'enabledWhen'], { condition: { type: 'not', of: compound }, whenUnknown: 'disabled' });
  const fields = fieldsWithLogic(edited).filter(field => field.path.startsWith(path.join('/')));
  expect(fields.filter(field => field.path.startsWith(`${path.join('/')}/visibleWhen`))).toMatchObject([{ field: 'Only show when', path: `${path.join('/')}/visibleWhen`, kind: 'boolean' }]);
  expect(fields.filter(field => field.path.startsWith(`${path.join('/')}/enabledWhen`))).toMatchObject([{ field: 'Only enabled when', path: `${path.join('/')}/enabledWhen/condition`, kind: 'boolean' }]);
  expect(fields.some(field => field.field === 'Of')).toBe(false);
  const chime = fieldsWithLogic(document).filter(field => field.title === 'Doorbell Chime' && field.path.includes('enabledWhen'));
  expect(chime).toHaveLength(1);
  expect(chime[0].field).toBe('Only enabled when');
});

it.each([false, true])('excludes a single-entity equality regardless of operand order (reversed: %s)', reverse => {
  const literal = { type: 'literal', value: 1 };
  const edited = replaceAt(document, [...path, 'visibleWhen'], { type: 'compare', op: 'eq', left: reverse ? literal : read, right: reverse ? read : literal });
  expect(fieldsWithLogic(edited).some(field => field.path.startsWith(`${path.join('/')}/visibleWhen`))).toBe(false);
});

it('finds named transitive readers, not service intent names or literal words that look like entity ids', () => {
  let edited = replaceAt(document, [...path, 'props', 'primary'], { type: 'literal', value: 'sensor.demo_not_a_read' });
  edited = replaceAt(edited, [...path, 'props', 'subtitle'], { type: 'expr', value: read });
  const readers = entityReaders(edited);
  expect(readers.get('switch.demo_light_1')).toContain('Lights');
  expect(readers.has('power.toggle')).toBe(false);
  expect(readers.has('sensor.demo_not_a_read')).toBe(false);
  expect(readers.has('person.demo_sam')).toBe(false);
  const unusedModel: CompositionDocument['dataSources'][number] = { id: 'unused-model', kind: 'model', model: 'power-toggle@1', inputs: { entityId: { type: 'literal', value: 'switch.demo_not_read' } } };
  expect(entityReaders({ ...edited, dataSources: [...edited.dataSources, unusedModel] }).has('switch.demo_not_read')).toBe(false);
  expect(readers.get('switch.demo_light_1')).not.toContain('Power switch');
});

it('does not turn unused literal entity definitions in an extension catalog into readers', () => {
  const edited = withLevel();
  edited.extensions = { type: 'native-extensions@1', watch: 'stub@1', routes: [], cameras: [{ entityId: 'camera.demo_unused', title: 'Unused camera', liveLabel: 'Live', unavailableLabel: 'Unavailable' }] };
  compileCompositionDocument(edited);
  expect(entityReaders(edited).has('camera.demo_unused')).toBe(false);
});

it.each([false, true])('resolves placed private sources with entity overrides, including logic arguments (logic: %s)', throughLogic => {
  const node: NonNullable<CompositionDocument['componentLibrary']>[number]['node'] = {
    id: 'private-text', type: 'text', title: 'Actual temperature', layout: { span: 1 },
    props: { value: { type: 'read', from: { type: 'source', sourceId: 'private-source', path: ['state'] }, as: 'string', missing: 'unavailable' }, style: 'body', unavailableText: 'Unavailable' },
  };
  let edited: CompositionDocument = {
    ...document,
    ...(throughLogic ? { logicLibrary: [{
      id: 'private-value', name: 'Private value', kind: 'operand' as const,
      params: [{ name: 'src', kind: 'source-id' as const, sample: 'demo-light-1' }],
      body: { type: 'read', from: { type: 'source', sourceId: { type: 'hole', name: 'src' }, path: ['state'] }, as: 'string', missing: 'unavailable' },
    }] } : {}),
    componentLibrary: [{
      id: 'private-component', name: 'Temperature component', node,
      sources: [{ id: 'private-source', kind: 'ha-entity', entityId: { type: 'literal', value: 'light.demo_fallback' } }],
      params: [{ name: 'entity', kind: 'entity-id' }],
      bindings: [{ param: 'entity', sourceId: 'private-source', field: 'entityId/value' }],
    }],
    pages: [{ ...document.pages[0], components: [{ id: 'private-place', type: 'component-ref', componentId: 'private-component', layout: { span: 1 }, args: { entity: 'light.demo_actual' } }] }],
  };
  if (throughLogic) edited = replaceAt(edited, ['componentLibrary', 0, 'node', 'props', 'value'], { type: 'expr', value: { type: 'logic-ref', logicId: 'private-value', args: { src: 'private-source' } } });
  expect(() => compileCompositionDocument(edited)).not.toThrow();
  const readers = entityReaders(edited);
  expect(readers.get('light.demo_actual')).toContain('Actual temperature');
  expect(readers.get('light.demo_fallback')).toContain('Temperature component');
  expect(readers.get('light.demo_fallback')).not.toContain('Actual temperature');
});

it('includes navigation visibility, chrome items, and surface-owned readers', () => {
  let edited = replaceAt(document, ['navigation', 'tabs', 0, 'visibleWhen'], { type: 'not', of: state });
  edited = replaceAt(edited, ['navigation', 'chrome', 'groups'], [{ id: 'chrome', items: [{ id: 'chrome-read', title: 'Status action', visibleWhen: state }] }]);
  edited = replaceAt(edited, ['pages', 0, 'titleSourceId'], 'demo-light-1');
  const readers = entityReaders(edited).get('switch.demo_light_1');
  expect(readers).toContain(document.navigation.tabs[0].label);
  expect(readers).toContain('Status action');
  expect(readers).toContain(document.pages[0].title);
});

it.each(['component', 'toolbar', 'nested logic'] as const)('includes a sheet-level %s as the only reader of its source', kind => {
  let edited = withLevel();
  const level = edited.levels![0];
  if (kind === 'toolbar') level.toolbar = { type: 'replace', groups: [toolbarReader('level-reader')] };
  else level.components = [textReader('level-reader')];
  if (kind === 'nested logic') {
    edited.logicLibrary = [
      { id: 'inner', name: 'Inner', kind: 'condition', params: [{ name: 'src', kind: 'source-id', sample: 'sample-source' }], body: { ...state, sourceId: { type: 'hole', name: 'src' } } },
      { id: 'outer', name: 'Outer', kind: 'condition', params: [{ name: 'test', kind: 'condition', sample: sourceState('sample-source') }], body: { type: 'hole', name: 'test' } },
    ];
    edited = replaceAt(edited, ['levels', 0, 'components', 0, 'props', 'value'], { type: 'literal', value: 'Level' });
    edited = replaceAt(edited, ['levels', 0, 'components', 0, 'visibleWhen'], { type: 'logic-ref', logicId: 'outer', args: { test: { type: 'logic-ref', logicId: 'inner', args: { src: 'level-reader' } } } });
  }
  expect(() => compileCompositionDocument(edited)).not.toThrow();
  expect(sourceUses(edited).get('level-reader')).toBe(1);
  expect(entityReaders(edited).get('sensor.demo_level_reader')).toEqual(new Set(['level-reader']));
});

it('includes a private-source override inside a sheet level after nested logic expansion', () => {
  let edited = withLevel();
  edited.logicLibrary = [
    { id: 'inner', name: 'Inner', kind: 'operand', params: [{ name: 'src', kind: 'source-id', sample: 'sample-source' }], body: { ...sourceRead('sample-source'), from: { type: 'source', sourceId: { type: 'hole', name: 'src' }, path: ['state'] } } },
    { id: 'outer', name: 'Outer', kind: 'operand', params: [{ name: 'src', kind: 'source-id', sample: 'sample-source' }], body: { type: 'logic-ref', logicId: 'inner', args: { src: { type: 'hole', name: 'src' } } } },
  ];
  edited.componentLibrary = [{
    id: 'private-component', name: 'Saved level component', node: textReader('level-reader'),
    sources: [{ id: 'level-reader', kind: 'ha-entity', entityId: { type: 'literal', value: 'light.demo_fallback' } }],
    params: [{ name: 'entity', kind: 'entity-id' }], bindings: [{ param: 'entity', sourceId: 'level-reader', field: 'entityId/value' }],
  }];
  edited = replaceAt(edited, ['componentLibrary', 0, 'node', 'props', 'value'], { type: 'expr', value: { type: 'logic-ref', logicId: 'outer', args: { src: 'level-reader' } } });
  edited.levels![0].components = [{ id: 'private-place', type: 'component-ref', componentId: 'private-component', layout: { span: 1 }, args: { entity: 'light.demo_actual' } }];
  expect(() => compileCompositionDocument(edited)).not.toThrow();
  const readers = entityReaders(edited);
  expect(readers.get('light.demo_actual')).toEqual(new Set(['level-reader']));
  expect(readers.get('light.demo_fallback')).toEqual(new Set(['Saved level component']));
  expect(readers.has('sensor.demo_level_reader')).toBe(false);
  expect(sourceUses(edited).get('level-reader')).toBe(0);
});

it('agrees with pruning across pages, modals, levels, their toolbars, navigation and global chrome', () => {
  const edited = withLevel();
  const surfaces = [edited.pages[0], edited.modals[0], edited.levels![0]];
  const ids = ['page', 'modal', 'level'].flatMap(kind => [`${kind}-component`, `${kind}-toolbar`]);
  surfaces.forEach((surface, at) => {
    surface.components = [textReader(ids[at * 2])];
    surface.toolbar = { type: 'replace', groups: [toolbarReader(ids[at * 2 + 1])] };
  });
  const shellGroup = structuredClone(edited.navigation.chrome.groups.find(group => group.items.some(item => item.type === 'shell-menu'))!);
  shellGroup.id = 'page-shell-group';
  shellGroup.items = shellGroup.items.filter(item => item.type === 'shell-menu').map(item => ({ ...item, id: 'page-shell-menu' }));
  edited.pages[0].toolbar = { type: 'replace', groups: [shellGroup, toolbarReader('page-toolbar')] };
  edited.navigation.chrome.groups.push(toolbarReader('global-chrome'));
  edited.navigation.tabs[0] = { ...edited.navigation.tabs[0], label: 'navigation-tab', visibleWhen: sourceState('navigation-tab'), whenUnknown: 'hide' };
  ids.push('global-chrome', 'navigation-tab');
  edited.dataSources = [...ids, 'removed-reader'].map(entitySource);
  const before = { ...edited, pages: [{ ...edited.pages[0], components: [...edited.pages[0].components, textReader('removed-reader')] }] };
  compileCompositionDocument(before);
  compileCompositionDocument(edited);
  const uses = sourceUses(edited);
  const readers = entityReaders(edited);
  expect([...uses].filter(([, count]) => count > 0).map(([id]) => id).sort()).toEqual([...ids].sort());
  const pruned = pruneEntitySources(before, edited);
  expect(pruned.dataSources.map(source => source.id).sort()).toEqual([...ids].sort());
  expect([...readers.keys()].sort()).toEqual(ids.map(id => entitySource(id).entityId.value).sort());
  for (const id of ids) expect(readers.get(entitySource(id).entityId.value)).toEqual(new Set([id]));
  expect(() => compileCompositionDocument(pruned)).not.toThrow();
});

it.each(['private flow parameter', 'entity source', 'model input'] as const)('includes an unconsumed %s definition that reads another source', kind => {
  const edited = withLevel();
  if (kind === 'private flow parameter') {
    edited.componentLibrary = [{
      id: 'saved', name: 'Saved flow', node: { ...textReader('caption'), props: { value: { type: 'literal', value: 'No flow consumer' }, style: 'body', unavailableText: 'Unavailable' } },
      flows: [parameterFlow('private-flow', 'level-reader')],
      sources: [{ ...entitySource('level-reader'), entityId: { type: 'literal', value: 'sensor.demo_private_unused' } }],
    }];
  } else {
    edited.dataSources.push(kind === 'entity source'
      ? { id: 'dependent', kind: 'ha-entity', entityId: entityIdRead('level-reader') }
      : { id: 'dependent', kind: 'model', model: 'power-toggle@1', inputs: { entityId: entityIdRead('level-reader') } });
  }
  compileCompositionDocument(edited);
  const owner = kind === 'private flow parameter' ? ['componentLibrary', 0] : ['dataSources', 2];
  const location = kind === 'private flow parameter' ? [...owner, 'flows', 0, 'inputs', 'parameters', 0, 'value']
    : kind === 'entity source' ? [...owner, 'entityId'] : [...owner, 'inputs', 'entityId'];
  expect(documentDependencies(edited).edges.filter(edge => edge.target.type === 'source' && edge.target.id === 'level-reader')).toMatchObject([{
    path: [...location, 'from', 'sourceId'], reader: { path: owner }, kind: 'read',
  }]);
  expect(sourceUses(edited).get('level-reader')).toBe(1);
  expect(entityReaders(edited).get('sensor.demo_level_reader')).toEqual(new Set([kind === 'private flow parameter' ? 'Saved flow' : kind === 'entity source' ? 'Entity' : 'Power switch']));
  const before = { ...edited, pages: [{ ...edited.pages[0], components: [textReader('level-reader')] }] };
  expect(pruneEntitySources(before, edited).dataSources).toEqual(edited.dataSources);
});

it('agrees with compiler-required dependencies across every surface and source kind, with explicit editable-reader exceptions', () => {
  const edited = withLevel();
  const ids = ['page', 'modal', 'level', 'toolbar', 'chrome', 'navigation', 'entity-input', 'model-input', 'flow-input', 'private-flow-input', 'saved-sample', 'argument-only', 'unused'];
  edited.dataSources = ids.map(entitySource);
  edited.dataSources.push(
    { id: 'dependent-entity', kind: 'ha-entity', entityId: entityIdRead('entity-input') },
    { id: 'dependent-model', kind: 'model', model: 'power-toggle@1', inputs: { entityId: entityIdRead('model-input') } },
    parameterFlow('dependent-flow', 'flow-input'),
  );
  edited.pages[0].components = [textReader('page')];
  edited.modals[0].components = [textReader('modal')];
  edited.levels![0].components = [textReader('level')];
  edited.levels![0].toolbar = { type: 'replace', groups: [toolbarReader('toolbar')] };
  edited.navigation.chrome.groups.push(toolbarReader('chrome'));
  edited.navigation.tabs[0] = { ...edited.navigation.tabs[0], visibleWhen: sourceState('navigation'), whenUnknown: 'hide' };
  edited.componentLibrary = [{
    id: 'saved', name: 'Saved flow',
    node: { ...textReader('caption'), props: { value: { type: 'literal', value: 'No flow consumer' }, style: 'body', unavailableText: 'Unavailable' } },
    flows: [parameterFlow('private-flow', 'private-flow-input')], params: [{ name: 'retained', kind: 'source-id' }],
    sources: [{ ...entitySource('private-flow-input'), entityId: { type: 'literal', value: 'sensor.demo_private_unused' } }],
  }];
  edited.pages[0].components.push({ id: 'placed', type: 'component-ref', componentId: 'saved', layout: { span: 1 }, args: { retained: 'argument-only' } });
  edited.logicLibrary = [{ id: 'saved-logic', name: 'Editable sample', kind: 'operand', params: [{ name: 'value', kind: 'operand', sample: sourceRead('saved-sample') }], body: { type: 'hole', name: 'value' } }];
  compileCompositionDocument(edited);
  const before = { ...edited, pages: [{ ...edited.pages[0], components: [...edited.pages[0].components, ...ids.map(textReader)] }] };
  const pruned = pruneEntitySources(before, edited);
  compileCompositionDocument(pruned);
  const readers = entityReaders(edited), uses = sourceUses(edited);
  for (const id of ids) {
    let compilerNeeds = false;
    try { compileCompositionDocument({ ...edited, dataSources: edited.dataSources.filter(source => source.id !== id) }); }
    catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      compilerNeeds = error.issues.some(issue => issue.code === 'invalid_reference');
    }
    const editableSample = id === 'saved-sample', structuralArgument = id === 'argument-only';
    expect(compilerNeeds, id).toBe(!['saved-sample', 'unused'].includes(id));
    expect((uses.get(id) ?? 0) > 0, id).toBe(compilerNeeds || editableSample);
    expect(pruned.dataSources.some(source => source.id === id), id).toBe(compilerNeeds || editableSample);
    expect(readers.has(entitySource(id).entityId.value), id).toBe(compilerNeeds && !structuralArgument || editableSample);
  }
  expect(readers.get(entitySource('saved-sample').entityId.value)).toContain('Editable sample');
  expect([...readers.keys()].sort()).toEqual(ids.filter(id => id !== 'argument-only' && id !== 'unused').map(id => entitySource(id).entityId.value).sort());
});
