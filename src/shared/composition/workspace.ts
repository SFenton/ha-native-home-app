import type { CompositionDocument, CompositionPublication } from './schema';
import type { CompositionIssue } from './json';

export type CompositionDraft = Omit<CompositionPublication, 'publishedAt'>;
export type CompositionAsset = CompositionDocument['assets'][number];
export type UploadedCompositionAsset = Omit<CompositionAsset, 'id' | 'role'>;

const issueHints: Record<CompositionIssue['code'], string> = {
  unsupported_schema: 'Use a schema-2.0 document.',
  unknown_field: 'Remove this field; the native contract is closed.',
  unknown_variant: 'Choose a supported variant or policy.',
  missing_required: 'Supply this required property.',
  invalid_value: 'Use a valid value within the contract bounds.',
  duplicate_key: 'Remove the duplicate JSON key.',
  limit_exceeded: 'Reduce this value or collection to the supported limit.',
  duplicate_id: 'IDs must be unique within their definition category.',
  invalid_reference: 'Choose an existing destination, tab, source or asset.',
  binding_type: 'The read type or power-model binding does not match its consumer.',
  invalid_combination: 'Check policy compatibility: initial tab/page agreement, root shell menu, modal toolbar, span and power-model pairing.',
  capability_manifest_mismatch: 'The capability manifest must exactly match the compiled document.',
  unsupported_capability: 'This curation is not implemented by the current native slice.',
  asset_integrity: 'Image bytes are missing or do not match the descriptor/manifest.',
};
export const formatCompositionIssue = (issue: CompositionIssue) =>
  `${issue.pointer || '/'}: ${issue.code}${issue.capability ? ` (${issue.capability})` : ''}. ${issueHints[issue.code]}`;

export const compositionSymbol = (name = 'square.grid.2x2'): CompositionDocument['pages'][number]['icon'] =>
  ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });

export function createCompositionPage(id: string): CompositionDocument['pages'][number] {
  const space = { type: 'token', name: 'm' } as const;
  return {
    id, title: 'New page', icon: compositionSymbol(), parameters: {}, toolbar: { type: 'inherit' },
    navigation: { type: 'stack' },
    layout: {
      type: 'column', padding: { top: space, leading: space, bottom: space, trailing: space },
      spacing: space, maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host',
    },
    components: [],
  };
}

/** A new namespace starts empty of house data and never imports the schema-1 workspace. */
export function createCompositionDocument(id: string): CompositionDocument {
  return {
    schemaVersion: '2.0', id, name: 'Native composition',
    theme: { appearance: 'dark', tokens: 'canonical@1', typography: 'dynamic-type@1', background: { type: 'solid', token: 'shell-base@1' } },
    navigation: {
      initialPageId: 'page-home', initialTabId: null, initialArguments: {}, tabs: [],
      policy: {
        type: 'canonical-shell@1', tabSwitch: 'preserve-cut@1', reselect: 'pop-root-then-scroll@1',
        stackMotion: 'canonical-stack@1', restoration: 'scene@1', selectionWhileModal: 'reject',
      },
      chrome: { groups: [{
        id: 'group-shell', placement: 'leading', horizontal: 'separate-circles@1', vertical: 'shared@1',
        items: [{ id: 'item-menu', type: 'shell-menu', label: 'Sections', icon: compositionSymbol('line.3.horizontal'), visibility: 'root-when-menu-available' }],
      }] },
    },
    pages: [{ ...createCompositionPage('page-home'), title: 'Home' }],
    modals: [], dataSources: [], variables: {}, assets: [], liveActivities: [],
  };
}
