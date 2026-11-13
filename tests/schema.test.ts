import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { componentCatalog, createComponent } from '../src/shared/catalog';
import { createSampleDocument } from '../src/shared/sample';
import { evaluateCondition, readBindingPath, resolveBinding } from '../src/shared/runtime';
import { DocumentValidationError, validateDocument } from '../src/shared/schema';
import type { Component, StudioDocument } from '../src/shared/types';
import { choresDocument } from './fixtures/chores';

function interactionDocument() {
  const document = createSampleDocument();
  document.variables.lookup = '';
  document.dataSources.push({ id: 'interaction-records', name: 'Records', kind: 'static', refreshSeconds: 30, sample: [{ key: 'one', title: 'One' }] });
  const list: Component = { id: 'interaction-list', type: 'list', title: 'Records', props: {}, binding: { sourceId: 'interaction-records' }, rowActions: {
    keyPath: 'key', leading: [{ id: 'inspect', label: 'Inspect', icon: '', color: '#123', fullSwipe: true, action: { type: 'set', variable: 'lookup', value: 'one' }, confirmation: { title: 'Inspect?', confirmLabel: 'Yes', cancelLabel: 'No' } }], trailing: [],
  } };
  document.pages[0].components.push(list);
  document.pages[0].search = { id: 'lookup-search', label: 'Find records', placeholder: 'Search titles', mode: 'filter', queryVariable: 'lookup', paths: ['title'], targetComponentIds: [list.id] };
  document.pages[0].floatingButtons = [{ id: 'open-settings', label: 'Settings', icon: 'settings', action: { type: 'modal', modalId: document.modals[0].id } }];
  return document;
}

describe('additive interaction contract', () => {
  it('round-trips explicit controls and empties without inserting any defaults into old documents', () => {
    const old = createSampleDocument(), original = JSON.stringify(old);
    expect(validateDocument(old)).toEqual(old);
    expect(JSON.stringify(old)).toBe(original);
    expect(validateDocument(old).pages.every(page => page.floatingButtons === undefined && page.search === undefined)).toBe(true);
    const document = interactionDocument();
    expect(validateDocument(parse(stringify(document)))).toEqual(document);
    document.pages[0].floatingButtons = [];
    document.pages[0].components.at(-1)!.rowActions = { keyPath: 'key', leading: [], trailing: [] };
    expect(validateDocument(document)).toEqual(document);
  });
  it.each([
    ['duplicate row IDs across sides', (d: StudioDocument) => { const row = d.pages[0].components.at(-1)!.rowActions!; row.trailing.push(structuredClone(row.leading[0])); }],
    ['two full swipes', (d: StudioDocument) => { const row = d.pages[0].components.at(-1)!.rowActions!; row.leading.push({ ...row.leading[0], id: 'second' }); }],
    ['blank label', (d: StudioDocument) => { d.pages[0].floatingButtons![0].label = '  '; }],
    ['transparent color', (d: StudioDocument) => { d.pages[0].floatingButtons![0].color = '#11223300'; }],
    ['foreign filter target', (d: StudioDocument) => { if (d.pages[0].search?.mode === 'filter') d.pages[0].search.targetComponentIds = [d.pages[1].components[0].id]; }],
    ['unsafe search path', (d: StudioDocument) => { if (d.pages[0].search?.mode === 'filter') d.pages[0].search.paths = ['constructor.name']; }],
    ['duplicate paths', (d: StudioDocument) => { if (d.pages[0].search?.mode === 'filter') d.pages[0].search.paths = ['title', 'title']; }],
    ['duplicate sample keys', (d: StudioDocument) => { d.dataSources.at(-1)!.sample = [{ key: 'one' }, { key: 'one' }]; }],
    ['blank sample key', (d: StudioDocument) => { d.dataSources.at(-1)!.sample = [{ key: '  ' }]; }],
    ['numeric sample key', (d: StudioDocument) => { d.dataSources.at(-1)!.sample = [{ key: 1 }]; }],
    ['oversized query action', (d: StudioDocument) => { d.pages[0].floatingButtons![0].action = { type: 'set', variable: 'lookup', value: 'x'.repeat(501) }; }],
    ['wrong query action type', (d: StudioDocument) => { d.pages[0].components.at(-1)!.rowActions!.leading[0].action = { type: 'set', variable: 'lookup', value: false }; }],
    ['completed label outside toggle', (d: StudioDocument) => { d.pages[0].components.at(-1)!.rowActions!.leading[0].completedLabel = 'Done'; }],
    ['local row intent on generic list', (d: StudioDocument) => { d.pages[0].components.at(-1)!.rowActions!.leading[0].action = { type: 'todo-row', operation: 'delete' }; }],
    ['floating local intent outside context', (d: StudioDocument) => { d.pages[0].components[0].action = { type: 'todo-add', componentId: 'missing' } as never; }],
    ['too many floating buttons', (d: StudioDocument) => { d.pages[0].floatingButtons = Array.from({ length: 5 }, (_, i) => ({ id: `float-${i}`, label: 'Action', icon: '', action: { type: 'none' } })); }],
  ])('rejects %s', (_name, update) => { const document = interactionDocument(); update(document); expect(() => validateDocument(document)).toThrow(DocumentValidationError); });

  it('validates contextual Chores roots, overlap, and key ownership', () => {
    const document = choresDocument(), page = document.pages.find(page => page.id === 'chores')!;
    const root = page.components.find(component => component.props.nativeTodoPage)!;
    page.floatingButtons = [{ id: 'add', label: 'Add Task', icon: 'plus', action: { type: 'todo-add', componentId: root.id } }];
    document.variables.choreSearch = '';
    page.search = { id: 'chore-search', label: 'Search', placeholder: 'Search tasks', mode: 'filter', queryVariable: 'choreSearch', targetComponentIds: [root.id], paths: ['summary'] };
    root.children![0].rowActions = { leading: [{ id: 'done', label: 'Done', completedLabel: 'Reopen', icon: '', action: { type: 'todo-row', operation: 'toggle' } }], trailing: [] };
    expect(() => validateDocument(document)).not.toThrow();
    root.children![0].rowActions.keyPath = 'uid';
    expect(() => validateDocument(document)).toThrow();
    delete root.children![0].rowActions.keyPath;
    page.search.targetComponentIds.push(root.children![0].id);
    expect(() => validateDocument(document)).toThrow();
    page.search.targetComponentIds.pop();
    page.floatingButtons[0].action = { type: 'todo-add', componentId: document.modals[0].components[0].id };
    expect(() => validateDocument(document)).toThrow();
  });
  it('rejects alert and Activity interactions and duplicate search IDs', () => {
    const document = interactionDocument();
    document.modals[0].presentation = 'alert';
    document.modals[0].floatingButtons = [];
    expect(() => validateDocument(document)).toThrow();
    delete document.modals[0].floatingButtons;
    document.pages[1].search = structuredClone(document.pages[0].search);
    expect(() => validateDocument(document)).toThrow();
    delete document.pages[1].search;
    const list = document.pages[0].components.pop()!;
    document.liveActivities[0].variants.expanded.push(list);
    delete document.pages[0].search;
    expect(() => validateDocument(document)).toThrow();
  });
  it('keeps endpoint query ownership on its bound source and rejects filter/network variable sharing', () => {
    const document = interactionDocument(), source = document.dataSources.at(-1)!;
    source.kind = 'endpoint'; source.endpoint = 'registered-search'; source.queryVariable = 'lookup';
    expect(() => validateDocument(document)).toThrow();
    document.pages[0].search = { id: 'lookup-search', label: 'Find', placeholder: 'Search titles', mode: 'endpoint', sourceId: source.id };
    expect(() => validateDocument(document)).not.toThrow();
    document.variables.lookup = 'nonempty initial query';
    expect(() => validateDocument(document)).toThrow();
    document.variables.lookup = '';
    delete source.queryVariable;
    expect(() => validateDocument(document)).toThrow();
  });
});

describe('versioned document SDK', () => {
  it('rejects initial subpages outside the chosen sheet instead of opening a different destination', () => {
    const document = createSampleDocument(), stack = createComponent('section'), root = createComponent('section'), detail = createComponent('section');
    stack.props.presentation = 'navigation-stack'; stack.children = [root, detail];
    document.modals[0].components = [stack];
    const link = createComponent('navigation-tile');
    link.action = { type: 'modal', modalId: document.modals[0].id }; link.props.initialDestinationId = detail.id;
    document.pages[0].components.push(link);
    expect(() => validateDocument(document)).not.toThrow();
    link.props.initialDestinationId = document.pages[0].components[0].id;
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    link.props.initialDestinationId = detail.id; link.action = { type: 'navigate', pageId: document.pages[0].id };
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
  });
  it('accepts a complete large native control tree but keeps bounded component and sheet limits', () => {
    const document = createSampleDocument();
    const page = { ...document.pages[0], toolbar: [], components: Array.from({ length: 20 }, (_, group) => ({
      id: `group-${group}`, type: 'section' as const, title: '', props: {},
      children: Array.from({ length: 99 }, (_, child) => ({ id: `item-${group}-${child}`, type: 'text' as const, title: 'Control', props: {} })),
    })) };
    document.pages = [page]; document.liveActivities = []; document.navigation.tabs = [];
    document.modals = Array.from({ length: 64 }, (_, index) => ({ ...page, id: `sheet-${index}`, components: [], presentation: 'sheet', detent: 'large' }));
    expect(() => validateDocument(document)).not.toThrow();
    page.components[0].children.push({ id: 'one-too-many', type: 'text', title: 'Overflow', props: {} });
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    page.components[0].children.pop();
    document.modals.push({ ...document.modals[0], id: 'sheet-overflow' });
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
  });
  it('accepts weather destinations and rejects malformed native control presentations', () => {
    const document = createSampleDocument();
    const weather = createComponent('weather-summary');
    weather.action = { type: 'modal', modalId: document.modals[0].id };
    document.pages[0].components.push(weather);
    expect(() => validateDocument(document)).not.toThrow();
    const control = createComponent('action-tile');
    control.props = { presentation: 'control', controlKind: 'light', entityId: 'light.demo' };
    control.binding = { sourceId: document.dataSources[0].id };
    document.pages[0].components.push(control);
    expect(() => validateDocument(document)).not.toThrow();
    control.props.controlKind = 'javascript';
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    control.props.controlKind = 'light';
    control.type = 'weather-summary';
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    control.type = 'action-tile';
    control.binding = undefined;
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
  });
  it('persists safe wallpaper settings while rejecting executable or oversized images', () => {
    const document = createSampleDocument();
    document.theme.background = { image: '/wallpaper.jpg', dim: 0.2, blur: 4 };
    expect(validateDocument(parse(stringify(document))).theme.background).toEqual(document.theme.background);
    document.theme.background.image = 'data:image/jpeg;base64,/9j/AAAA';
    expect(() => validateDocument(document)).not.toThrow();
    for (const image of ['javascript:alert(1)', '//evil.example/image', 'data:image/svg+xml;base64,AAAA', 'https://user:pass@example.org/image', `data:image/jpeg;base64,/9j/${'A'.repeat(500_000)}`]) {
      document.theme.background.image = image;
      expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    }
  });
  it('validates the rich sample and JSON/YAML roundtrips without losing document data', () => {
    const sample = createSampleDocument();
    expect(validateDocument(sample)).toEqual(sample);
    expect(validateDocument(JSON.parse(JSON.stringify(sample)))).toEqual(sample);
    expect(validateDocument(parse(stringify(sample)))).toEqual(sample);
  });
  it.each([
    ['unknown version', (document: ReturnType<typeof createSampleDocument>) => ({ ...document, schemaVersion: '2.0' })],
    ['unknown field', (document: ReturnType<typeof createSampleDocument>) => ({ ...document, script: 'alert(1)' })],
    ['unknown component', (document: ReturnType<typeof createSampleDocument>) => { document.pages[0].components[0].type = 'webview' as never; return document; }],
    ['unknown action', (document: ReturnType<typeof createSampleDocument>) => { document.pages[0].components[0].action = { type: 'javascript' } as never; return document; }],
  ])('rejects %s', (_name, update) => { expect(() => validateDocument(update(createSampleDocument()))).toThrow(DocumentValidationError); });

  it.each([
    ['navigation.initialPageId', (document: ReturnType<typeof createSampleDocument>) => { document.navigation.initialPageId = 'missing'; }],
    ['navigation.tabs.0.pageId', (document: ReturnType<typeof createSampleDocument>) => { document.navigation.tabs[0].pageId = 'missing'; }],
    ['pages.0.components.0.action.pageId', (document: ReturnType<typeof createSampleDocument>) => { document.pages[0].components[0].action = { type: 'navigate', pageId: 'missing' }; }],
    ['pages.0.components.0.action.modalId', (document: ReturnType<typeof createSampleDocument>) => { document.pages[0].components[0].action = { type: 'modal', modalId: 'missing' }; }],
    ['pages.0.components.0.action.variable', (document: ReturnType<typeof createSampleDocument>) => { document.pages[0].components[0].action = { type: 'toggle', variable: 'missing' }; }],
    ['pages.0.components.0.binding.sourceId', (document: ReturnType<typeof createSampleDocument>) => { document.pages[0].components[0].binding = { sourceId: 'missing' }; }],
    ['pages.0.components.0.visibility.key', (document: ReturnType<typeof createSampleDocument>) => { document.pages[0].components[0].visibility = { source: 'variable', key: 'missing', operator: 'truthy' }; }],
    ['pages.0.toolbar.0.action.pageId', (document: ReturnType<typeof createSampleDocument>) => { document.pages[0].toolbar[0].action = { type: 'navigate', pageId: 'missing' }; }],
    ['liveActivities.0.variants.minimal.0.binding.sourceId', (document: ReturnType<typeof createSampleDocument>) => { document.liveActivities[0].variants.minimal[0].binding = { sourceId: 'missing' }; }],
  ])('reports helpful paths for broken reference %s', (expected, update) => {
    const document = createSampleDocument();
    update(document);
    try { validateDocument(document); throw new Error('Expected validation to fail'); }
    catch (error) {
      expect(error).toBeInstanceOf(DocumentValidationError);
      expect((error as DocumentValidationError).errors.join('\n')).toContain(expected);
    }
  });
  it('rejects duplicate IDs, unsafe URLs, prototype paths, and guessed bridge URLs', () => {
    const duplicate = createSampleDocument();
    duplicate.pages[0].components.push(structuredClone(duplicate.pages[0].components[0]));
    expect(() => validateDocument(duplicate)).toThrow();
    for (const url of ['javascript:alert(1)', '//evil.example/image', 'data:text/html,test', 'https://user:pass@example.org']) {
      const document = createSampleDocument();
      document.pages[0].components[0].action = { type: 'url', url };
      expect(() => validateDocument(document)).toThrow();
    }
    const document = createSampleDocument();
    document.pages[0].components[0].binding = { sourceId: 'household', path: '__proto__.polluted' };
    expect(() => validateDocument(document)).toThrow();
    document.pages[0].components[0].binding = undefined;
    document.dataSources[0].sample = { avatarUrl: 'javascript:alert(1)' };
    expect(() => validateDocument(document)).toThrow();
    document.dataSources[0].sample = null;
    document.dataSources[0] = { id: 'ssrf', name: 'Unsafe', kind: 'native-home', refreshSeconds: 30, endpoint: 'http://169.254.169.254/latest/meta-data/', sample: null };
    expect(() => validateDocument(document)).toThrow();
  });
  it('bounds recursive input before schema recursion and rejects cycles', () => {
    const document = createSampleDocument();
    let node = document.pages[0].components[0];
    for (let index = 0; index < 50; index++) { const child = createComponent('section'); node.children = [child]; node = child; }
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => validateDocument(cycle)).toThrow(/validation failed/i);
  });
  it('accepts registered endpoint references but rejects document URLs and invalid query bindings', () => {
    const document = createSampleDocument();
    document.variables.searchQuery = '';
    document.dataSources.push({ id: 'custom-search', name: 'Search', kind: 'endpoint', endpoint: 'recipes-search', queryVariable: 'searchQuery', refreshSeconds: 30, sample: [] });
    const source = document.dataSources.at(-1)!;
    expect(validateDocument(document).dataSources.at(-1)).toEqual(source);
    for (const endpoint of ['https://example.com/search', '/api/search', '__proto__', '']) {
      source.endpoint = endpoint;
      expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    }
    source.endpoint = 'recipes-search';
    for (const value of [false, null, 2, 'x'.repeat(501)]) {
      document.variables.searchQuery = value;
      expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    }
    document.variables.searchQuery = '';
    source.queryVariable = 'missing-query';
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    source.queryVariable = 'searchQuery';
    source.kind = 'static';
    delete source.endpoint;
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
  });
  it('accepts shared YAML-style values but rejects reserved object keys and oversized SDK documents', () => {
    const document = createSampleDocument();
    const shared = { note: 'An aliased YAML value' };
    document.pages[0].components[0].props = shared;
    document.pages[1].components[0].props = shared;
    expect(() => validateDocument(document)).not.toThrow();
    document.pages[0].components[0].props = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    document.pages[0].components[0].props = {};
    document.dataSources[0].sample = Array.from({ length: 100 }, () => 'x'.repeat(12000));
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
  });
  it('creates fresh catalog components that validate when inserted', () => {
    for (const entry of componentCatalog) {
      const document = createSampleDocument();
      const first = createComponent(entry.type), second = createComponent(entry.type);
      expect(first.id).not.toBe(second.id);
      document.pages[0].components.push(first);
      expect(() => validateDocument(document)).not.toThrow();
    }
  });
  it('rejects invisible non-container subtrees and unsupported tap actions', () => {
    const document = createSampleDocument();
    const parent = createComponent('text');
    parent.children = [createComponent('text')];
    document.pages[0].components.push(parent);
    expect(() => validateDocument(document)).toThrow(DocumentValidationError);
    parent.type = 'section';
    expect(() => validateDocument(document)).not.toThrow();
    delete parent.children;
    for (const type of ['camera-feed', 'spacer'] as const) {
      parent.type = type;
      parent.action = { type: 'navigate', pageId: document.pages[0].id };
      expect(() => validateDocument(document)).toThrow(DocumentValidationError);
      parent.action = { type: 'none' };
      expect(() => validateDocument(document)).not.toThrow();
    }
  });
});

describe('safe declarative runtime', () => {
  it('evaluates variables and entity conditions without coercing numeric comparisons', () => {
    expect(evaluateCondition(undefined, {})).toBe(true);
    expect(evaluateCondition({ source: 'variable', key: 'enabled', operator: 'truthy' }, { enabled: false })).toBe(false);
    expect(evaluateCondition({ source: 'entity', key: 'sensor.temp', operator: 'greater-than', value: 20 }, {}, { 'sensor.temp': 21 })).toBe(true);
    expect(evaluateCondition({ source: 'entity', key: 'sensor.temp', operator: 'greater-than', value: 20 }, {}, { 'sensor.temp': '21' })).toBe(false);
    expect(evaluateCondition({ source: 'variable', key: 'missing', operator: 'not-equals', value: false }, {})).toBe(false);
  });
  it('resolves sample bindings and refuses prototype or inherited property reads', () => {
    const document = createSampleDocument();
    expect(resolveBinding({ ...createComponent('text'), binding: { sourceId: 'household', path: 'name' } }, document)).toBe('Sam');
    expect(readBindingPath({ array: ['first'] }, 'array.0')).toBe('first');
    expect(readBindingPath({}, '__proto__')).toBeUndefined();
    expect(readBindingPath({}, 'toString')).toBeUndefined();
    expect(readBindingPath({}, 'constructor.name')).toBeUndefined();
  });
});
