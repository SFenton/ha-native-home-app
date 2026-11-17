import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { compositionChildren, compositionDocumentSchema, type CompositionDocument, type CompositionNode } from '../src/shared/composition/schema';
import { compositionEditorSchema, defaultField, fieldVariants } from '../src/composition-editor';

function fixture(): CompositionDocument {
  const document: CompositionDocument = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  document.pages[2].components = [
    { id: 'list', title: 'Tasks', type: 'collection', layout: { span: 1 },
      props: { providerId: 'tasks', template: 'todo', loadingText: 'Loading', emptyText: 'No Tasks' },
      selection: { type: 'push', pageId: document.pages[1].id, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } },
    { id: 'editor', title: 'Edit Task', type: 'form', layout: { span: 1 },
      props: { providerId: 'task-edit', saveLabel: 'Save', selectionOnly: false,
        fields: [{ key: 'name', label: 'Task Name', control: 'text' }, { key: 'due', label: 'Due', control: 'date' }] },
      success: { type: 'back' } },
    { id: 'recipe', title: 'Ingredients', type: 'recipe-part', layout: { span: 1 },
      props: { providerId: 'recipes', part: 'ingredients' } },
    { id: 'actions', title: 'Actions', type: 'pinned-actions', layout: { span: 1 },
      props: { searchProviderId: 'tasks', searchPrompt: 'Search Tasks', items: [] } },
  ];
  return document;
}

describe('record composition contracts', () => {
  it('pins an existing primary control and inspects its closed child tree', () => {
    const document = fixture();
    const addition = JSON.parse(readFileSync('tests/fixtures/composition-presentation.json', 'utf8'));
    document.localState = addition.localState;
    document.pages[2].components = addition.components;
    const pinned = document.pages[2].components[2];
    if (pinned.type !== 'pinned-actions') throw Error('Expected pinned form actions');
    const primary = pinned.props.items.shift()!;
    pinned.children = [{ id: 'existing-primary', title: primary.title, type: 'primary-button',
      layout: { span: 1 }, props: {}, action: primary.action }];
    expect(compileCompositionDocument(document).capabilities).toContain('sh.pinned-form-actions@1');
    expect(compositionChildren(pinned).map(node => node.id)).toEqual(['existing-primary']);
    pinned.props.items.push(primary);
    expect(() => compileCompositionDocument(document)).toThrow();
    const encodedInspector = JSON.stringify(compositionEditorSchema);
    for (const property of ['presentationProviderId', 'scopeProviderId', 'stateProviderId', 'fullScreen', 'section-wide@1']) {
      expect(encodedInspector).toContain(property);
    }
  });
  it('negotiates live presentation, section geometry, real pinned form actions and full-screen modals', () => {
    const document = fixture();
    const addition = JSON.parse(readFileSync('tests/fixtures/composition-presentation.json', 'utf8'));
    document.localState = addition.localState;
    document.pages[2].components = addition.components;
    document.modals[0].presentation.fullScreen = true;
    expect(compileCompositionDocument(document).capabilities).toEqual(expect.arrayContaining([
      'sh.presentation-providers@1', 'sh.section-grid@1', 'sh.pinned-form-actions@1', 'sh.full-screen-modal@1', 'sh.module-settings-rows@1',
    ]));
    const grid = document.pages[2].components[0], tabs = document.pages[2].components[1], actions = document.pages[2].components[2];
    if (grid.type !== 'tile-grid' || tabs.type !== 'local-tabs' || actions.type !== 'pinned-actions') throw Error('Expected presentation primitives');
    grid.props.maxColumns = 3;
    expect(() => compileCompositionDocument(document)).toThrow();
    grid.props.maxColumns = 2;
    tabs.props.showsSelector = false;
    delete tabs.props.scopeProviderId;
    expect(() => compileCompositionDocument(document)).toThrow();
    tabs.props.scopeProviderId = 'summary';
    actions.props.style = 'floating';
    expect(() => compileCompositionDocument(document)).toThrow();
    actions.props.style = 'form';
    document.modals[0].presentation.adaptive = true;
    expect(() => compileCompositionDocument(document)).toThrow();
    document.modals[0].presentation.adaptive = false;
    document.modals[0].presentation.height = { type: 'fitted', follows: 'top-page', firstOpen: 'canonical@1' };
    expect(() => compileCompositionDocument(document)).toThrow();
  });
  it('compiles native notices, paged status values and transactional schedule fields', () => {
    const document = fixture();
    const atoms: CompositionNode[] = JSON.parse(readFileSync('tests/fixtures/composition-shell-atoms.json', 'utf8'));
    document.pages[2].components.push(...atoms);
    const form = document.pages[2].components[1];
    if (form.type !== 'form') throw Error('Expected form');
    form.props.fields.push({ key: 'start', label: 'Starts', control: 'schedule-date-time' });
    expect(compileCompositionDocument(document).capabilities).toEqual(expect.arrayContaining([
      'sh.info-box@1', 'sh.status-pill@1', 'sh.paged-row@1', 'sh.schedule-date-fields@1',
    ]));
    const pager = atoms[1];
    if (pager.type !== 'paged-row') throw Error('Expected pager');
    pager.props.perPage = 0;
    expect(() => compileCompositionDocument(document)).toThrow();
  });
  it('derives all four capabilities and validates selection actions', () => {
    const document = fixture();
    expect(compileCompositionDocument(document).capabilities).toEqual(expect.arrayContaining([
      'sh.collection@1', 'sh.form@1', 'sh.recipe-part@1', 'sh.pinned-actions@1',
    ]));
    const collection = document.pages[2].components[0];
    if (collection.type !== 'collection' || collection.selection?.type !== 'push') throw Error('Expected collection');
    collection.selection.pageId = 'missing';
    expect(() => compileCompositionDocument(document)).toThrow();
  });
  it('negotiates native column routes explicitly', () => {
    const document = fixture();
    document.pages[2].navigation = { type: 'navigation-columns', placeholder: 'Select an Item', standalone: false };
    expect(compileCompositionDocument(document).capabilities).toContain('sh.navigation-columns@1');
    expect(compositionDocumentSchema.safeParse({
      ...document, pages: document.pages.map((page, index) => index === 2 ? {
        ...page, navigation: { type: 'navigation-columns' },
      } : page),
    }).success).toBe(false);
  });
  it('negotiates adaptive modal placement and keeps the sheet shape closed', () => {
    const document = fixture();
    document.modals[0].presentation.adaptive = true;
    expect(compileCompositionDocument(document).capabilities).toContain('sh.adaptive-presentation@1');
    expect(compositionDocumentSchema.safeParse({
      ...document, modals: [{ ...document.modals[0], presentation: { ...document.modals[0].presentation, adaptive: 'automatic' } }],
    }).success).toBe(false);
  });
  it('requires an explicit expiry sensor for location-scoped inventory subtitles', () => {
    const document = fixture();
    const source = { id: 'space-count', kind: 'model', model: 'inventory-summary@1',
      inputs: { totalEntityId: { type: 'literal', value: 'sensor.demo_total' }, spaceEntityIds: [{ type: 'literal', value: 'sensor.demo_total' }],
        expiringLocation: 'frigo' },
      labels: { singular: 'Item', plural: 'Items', expiringSuffix: 'Expiring Soon', separator: ' / ', loadingText: 'Loading', unavailableText: 'Unavailable' },
    } as const;
    expect(() => compileCompositionDocument({ ...document, dataSources: [...document.dataSources, source] })).toThrow();
    expect(() => compileCompositionDocument({ ...document, dataSources: [...document.dataSources,
      { ...source, inputs: { ...source.inputs, expiringEntityId: { type: 'literal', value: 'sensor.demo_expiring' } } }],
    })).not.toThrow();
  });
  it('pins exactly one root tab bar with explicit icons and instance-scoped reset', () => {
    const document = fixture();
    const options = [{ id: 'general', label: 'General' }, { id: 'instructions', label: 'Instructions' }];
    document.localState = [{ id: 'panel', type: 'choice', initial: 'general', options }];
    const tabs: Extract<CompositionNode, { type: 'local-tabs' }> = {
      id: 'panels', title: 'Recipe Sections', type: 'local-tabs', layout: { span: 1 },
      props: { stateId: 'panel', transition: 'canonical-swap@1', pinned: true, resetOnPresentation: true },
      tabs: options.map(option => ({
        ...option, icon: document.pages[0].icon, children: [], centerWhenFits: option.id === 'instructions',
      })),
    };
    document.pages[2].components = [tabs];
    expect(compileCompositionDocument(document).capabilities).toContain('sh.pinned-tabs@1');
    delete tabs.tabs[0].icon;
    expect(() => compileCompositionDocument(document)).toThrow();
    tabs.tabs[0].icon = document.pages[0].icon;
    document.pages[2].components.push({ ...tabs, id: 'duplicate-bar' });
    expect(() => compileCompositionDocument(document)).toThrow();
  });
  it('keeps canonical header actions closed and rejects conflicting trailing groups', () => {
    const document = fixture();
    const action = { type: 'present', modalId: document.modals[0].id, arguments: {}, ifPresented: 'reject' } as const;
    document.navigation.chrome.groups[1].items = [{
      id: 'native-header', type: 'shell-header', visibility: 'always', quickLinksAction: action, profileAction: action,
    }];
    expect(compileCompositionDocument(document).capabilities).toContain('sh.shell-header@1');
    document.navigation.chrome.groups.push({ ...document.navigation.chrome.groups[1], id: 'extra', items: [] });
    expect(() => compileCompositionDocument(document)).toThrow();
  });
  it('negotiates provider-owned navigation titles and canonical chore families', () => {
    const document = fixture();
    document.pages[2].components = [{
      id: 'list-link', title: 'Tasks', type: 'navigation-tile', icon: document.pages[0].icon, layout: { span: 1 },
      props: { family: 'chore-resident-1', titleProviderId: 'demo-items', selected: 'navigation-path', subtitle: { type: 'literal', value: '' } },
      action: { type: 'push', pageId: document.pages[0].id, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
    }];
    expect(compileCompositionDocument(document).capabilities).toContain('sh.collection-navigation@1');
  });
  it('rejects unknown form controls, open properties, duplicate fields and unsafe success actions', () => {
    const document = fixture();
    const form = document.pages[2].components[1];
    if (form.type !== 'form') throw Error('Expected form');
    form.props.fields.push(form.props.fields[0]);
    expect(() => compileCompositionDocument(document)).toThrow();
    form.props.fields.pop();
    form.success = { type: 'select-tab', tabId: document.navigation.tabs[0].id };
    expect(() => compileCompositionDocument(document)).toThrow();
    expect(compositionDocumentSchema.safeParse({
      ...document, pages: document.pages.map((page, index) => index !== 2 ? page : {
        ...page, components: [{ ...form, props: { ...form.props, controller: 'arbitrary-page' } }],
      }),
    }).success).toBe(false);
  });
  it('exposes every field through generated inspectors with usable defaults', () => {
    const document = fixture();
    const schema = Object.values(compositionEditorSchema.definitions ?? {}).find(schema =>
      fieldVariants(schema).some(item => item.properties?.type?.const === 'collection'))!;
    const variants = fieldVariants(schema);
    for (const kind of ['collection', 'form', 'recipe-part', 'pinned-actions', 'info-box', 'status-pill', 'paged-row']) {
      const variant = variants.find(item => item.properties?.type?.const === kind)!;
      expect(variant).toBeDefined();
      const value = defaultField(variant, document) as unknown as CompositionNode;
      expect(value.type).toBe(kind);
      if (value.type === 'form') expect(value.props).toMatchObject({ providerId: 'sample-provider', saveLabel: 'Save' });
    }
  });
  it('rejects duplicate or nested chrome-owning nodes before runtime', () => {
    const document = fixture();
    const form = document.pages[2].components[1];
    document.pages[2].components.push({ ...form, id: 'second-editor' });
    expect(() => compileCompositionDocument(document)).toThrow();
    document.pages[2].components.pop();
    document.pages[2].components = [{
      id: 'group', title: 'Group', type: 'section', layout: { span: 1 },
      props: { header: '', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } },
      children: [form],
    }];
    expect(() => compileCompositionDocument(document)).toThrow();
  });
});
