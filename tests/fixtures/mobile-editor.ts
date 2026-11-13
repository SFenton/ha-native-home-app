import type { Component, StudioDocument } from '../../src/shared/types';

export const mobileViewports = [
  { name: 'small', width: 320, height: 568 },
  { name: 'mini-like', width: 375, height: 812 },
  { name: 'ordinary', width: 390, height: 844 },
  { name: 'folded-like', width: 420, height: 880 },
  { name: 'unfolded-like-small', width: 752, height: 768 },
  { name: 'unfolded-like-large', width: 1024, height: 768 },
  { name: 'ipad-like-portrait', width: 820, height: 1180 },
  { name: 'ipad-like-landscape', width: 1180, height: 820 },
  { name: 'split-narrow', width: 507, height: 800 },
  { name: 'split-wide', width: 694, height: 800 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'keyboard-like', width: 390, height: 320 },
  { name: 'wide', width: 1440, height: 1000 },
] as const;

const text = (id: string, title: string): Component => ({
  id, type: 'text', title, props: { text: `${title} synthetic content` },
});
const link = (id: string, title: string, pageId: string): Component => ({
  id, type: 'navigation-tile', title, props: {}, action: { type: 'navigate', pageId },
});

export function mobileEditorDocument({ scrollable = false } = {}): StudioDocument {
  return {
    schemaVersion: '1.0',
    id: 'mobile-editor-fixture',
    name: 'Synthetic mobile editor',
    theme: { accent: '#dd784e', appearance: 'light', fontScale: 1 },
    navigation: {
      initialPageId: 'mobile-home',
      tabs: [
        { id: 'mobile-tab-home', label: 'Mobile home', icon: 'home', pageId: 'mobile-home' },
        { id: 'mobile-tab-other', label: 'Other', icon: 'grid', pageId: 'mobile-other' },
      ],
    },
    pages: [
      {
        id: 'mobile-home', title: 'Mobile home', icon: 'home',
        layout: { columns: 1, gap: 12 }, toolbar: [],
        components: [
          text('mobile-first', 'First item'),
          text('mobile-second', 'Second item'),
          {
            id: 'mobile-group', type: 'section', title: 'Nested group',
            props: { columns: 1 }, children: [text('mobile-child', 'Nested child')],
          },
          {
            id: 'mobile-service', type: 'action-tile', title: 'Synthetic light',
            props: {},
            action: { type: 'service', domain: 'light', service: 'turn_on', entityId: 'light.mobile_fixture', data: {} },
          },
          {
            id: 'mobile-sheet-link', type: 'action-tile', title: 'Open fixture sheet',
            props: {}, action: { type: 'modal', modalId: 'mobile-sheet' },
          },
          link('mobile-child-link', 'Child route', 'mobile-child-page'),
          link('mobile-shared-link', 'Shared route', 'mobile-shared-page'),
          ...(scrollable ? Array.from({ length: 28 }, (_, index) => text(`mobile-scroll-${index}`, `Scroll item ${index + 1}`)) : []),
        ],
      },
      {
        id: 'mobile-other', title: 'Other page', icon: 'grid',
        layout: { columns: 1, gap: 12 }, toolbar: [],
        components: [link('mobile-other-shared-link', 'Other shared route', 'mobile-shared-page')],
      },
      {
        id: 'mobile-child-page', title: 'Child page', icon: 'document',
        layout: { columns: 1, gap: 12 }, toolbar: [], components: [text('mobile-child-content', 'Child content')],
      },
      {
        id: 'mobile-shared-page', title: 'Shared page', icon: 'document',
        layout: { columns: 1, gap: 12 }, toolbar: [], components: [],
      },
      {
        id: 'mobile-unassigned', title: 'Unassigned page', icon: 'document',
        layout: { columns: 1, gap: 12 }, toolbar: [], components: [],
      },
    ],
    modals: [{
      id: 'mobile-sheet', title: 'Fixture sheet', icon: 'layers',
      presentation: 'sheet', detent: 'large', layout: { columns: 1, gap: 12 }, toolbar: [],
      components: [text('mobile-sheet-content', 'Sheet content')],
    }],
    liveActivities: [{
      id: 'mobile-activity', name: 'Fixture activity', enabled: true, attributes: { fixture: true },
      variants: {
        lockScreen: [text('mobile-lock', 'Lock content')],
        compactLeading: [text('mobile-leading', 'Leading content')],
        compactTrailing: [text('mobile-trailing', 'Trailing content')],
        minimal: [text('mobile-minimal', 'Minimal content')],
        expanded: [text('mobile-expanded', 'Expanded content')],
      },
    }],
    dataSources: [{
      id: 'mobile-sample', name: 'Synthetic sample', kind: 'static', refreshSeconds: 60,
      sample: { value: 'sample only', count: 2 },
    }],
    variables: { mobileVisible: true, mobileCount: 2 },
  };
}

export function mobileDescendants(components: Component[]): Component[] {
  return components.flatMap(component => [component, ...mobileDescendants(component.children ?? [])]);
}
