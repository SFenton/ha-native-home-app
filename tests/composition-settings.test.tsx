// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { compositionDocumentSchema, type CompositionDocument } from '../src/shared/composition/schema';
import { settingsKinds, settingsDomain, settingsDestination, settingsItem, settingsFixedItems } from '../src/shared/composition/settings';
import { compositionEditorSchema, fieldVariants } from '../src/composition-editor';
import CompositionFields from '../src/CompositionFields';

function fixture(): CompositionDocument {
  const document = JSON.parse(readFileSync(resolve('tests/fixtures/composition-first-slice.json'), 'utf8')).document as CompositionDocument;
  document.dataSources.push({ id: 'preferences', kind: 'model', model: 'settings-provider@1',
    inputs: { providerId: 'private-preferences', domain: 'preferences' } });
  document.pages[2].components = [{
    id: 'blur', title: 'Background Blur', type: 'settings-control', layout: { span: 1 },
    icon: { type: 'sf-symbol', name: 'gearshape', rendering: 'canonical', unavailable: 'fallback' },
    props: { sourceId: 'preferences', kind: 'background-blur', item: '', subtitle: '' },
  }];
  return document;
}
afterEach(cleanup);
describe('settings domain composition', () => {
  it('compiles every declared domain control with closed, correctly typed providers', () => {
    for (const kind of settingsKinds) {
      const document = fixture();
      const source = document.dataSources.at(-1)!;
      if (source.kind !== 'model' || source.model !== 'settings-provider@1') throw Error('Expected provider');
      source.inputs.domain = settingsDomain(kind);
      const node = document.pages[2].components[0];
      if (node.type !== 'settings-control') throw Error('Expected control');
      node.props.kind = kind;
      node.props.item = settingsFixedItems[kind]?.[0] ?? (settingsItem(kind) ? 'sample-item' : '');
      if (settingsDestination(kind)) node.props.destination = {
        type: 'push', pageId: document.pages[1].id, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest',
      };
      expect(compileCompositionDocument(document).capabilities).toContain('sh.settings-controls@1');
      source.inputs.domain = source.inputs.domain === 'profile' ? 'household' : 'profile';
      expect(() => compileCompositionDocument(document)).toThrow();
    }
  });
  it('rejects executable/controller fields, detached targets and missing navigation', () => {
    const document = fixture();
    const node = document.pages[2].components[0];
    expect(compositionDocumentSchema.safeParse({ ...document, pages: [{ ...document.pages[2],
      components: [{ ...node, controller: 'settings' }] }] }).success).toBe(false);
    if (node.type !== 'settings-control') throw Error('Expected control');
    node.props.item = 'unexpected';
    expect(() => compileCompositionDocument(document)).toThrow();
    node.props.kind = 'presence-room';
    expect(() => compileCompositionDocument(document)).toThrow();
  });
  it('accepts native Settings rows in module lists but rejects tile-shaped controls', () => {
    const document = fixture();
    const control = document.pages[2].components[0];
    const source = document.dataSources.at(-1)!;
    if (control.type !== 'settings-control' || source.kind !== 'model' || source.model !== 'settings-provider@1') throw Error('Expected settings');
    document.pages[2].components = [{
      id: 'preferences-list', title: 'Preferences', type: 'section', layout: { span: 1 },
      props: { header: 'Preferences', footer: '', style: 'module-list', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } },
      children: [control],
    }];
    expect(compileCompositionDocument(document).capabilities).toContain('sh.module-settings-rows@1');
    source.inputs.domain = 'household';
    control.props.kind = 'household-toggle';
    control.props.item = 'sample-switch';
    expect(() => compileCompositionDocument(document)).toThrowError(expect.objectContaining({
      issues: expect.arrayContaining([{ code: 'invalid_combination', pointer: '/document/pages/2/components/0/children/0/type' }]),
    }));
  });
  it('keeps native submit controls in pinned forms without accepting text fields', () => {
    const document = fixture();
    const control = document.pages[2].components[0];
    const source = document.dataSources.at(-1)!;
    if (control.type !== 'settings-control' || source.kind !== 'model' || source.model !== 'settings-provider@1') throw Error('Expected settings');
    source.inputs.domain = 'feedback';
    control.props.kind = 'feedback-submit';
    document.pages[2].components = [{
      id: 'submit-bar', title: 'Submit', type: 'pinned-actions', layout: { span: 1 },
      props: { style: 'form', items: [], searchPrompt: 'Search' }, children: [control],
    }];
    expect(compileCompositionDocument(document).capabilities).toContain('sh.pinned-form-actions@1');
    control.props.kind = 'feedback-field';
    control.props.item = 'description';
    expect(() => compileCompositionDocument(document)).toThrowError(expect.objectContaining({
      issues: expect.arrayContaining([{ code: 'invalid_combination', pointer: '/document/pages/2/components/0/children/0/type' }]),
    }));
  });
  it('exposes domain kind, target, subtitle and source relationship in the structured inspector', () => {
    let document = fixture();
    const nodeSchema = Object.values(compositionEditorSchema.definitions ?? {}).find(schema =>
      fieldVariants(schema).some(item => item.properties?.type?.const === 'settings-control'));
    expect(nodeSchema).toBeDefined();
    const schema = fieldVariants(nodeSchema!).find(item => item.properties?.type?.const === 'settings-control')!;
    render(<CompositionFields schema={schema}
      value={document.pages[2].components[0]} path={['pages', 2, 'components', 0]} label="Settings" document={document}
      onChange={next => { document = next; }} onError={message => { throw Error(message); }}/>);
    expect(screen.getByLabelText('Source Id').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Kind').tagName).toBe('SELECT');
    fireEvent.change(screen.getByLabelText('Subtitle'), { target: { value: 'Adjust the background' } });
    expect(document.pages[2].components[0]).toMatchObject({ props: { subtitle: 'Adjust the background' } });
  });
});
