import { useMemo, useState, type ReactNode } from 'react';
import { vi } from 'vitest';
import { buildDocumentIndex } from '../../src/preview2/model';
import type { CompositionDocument } from '../../src/shared/composition/schema';
import { runChecks } from '../../src/workspace2/checks';
import type { PropertiesTarget, Workspace2 } from '../../src/workspace2/useWorkspace2';

/** What a test can say about the workspace a surface renders against. */
export interface Stub {
  /** More of the workspace than the defaults give: merged over them (`studio` is merged one level in). */
  extra?: Record<string, unknown> & { studio?: Record<string, unknown> };
  publication?: Workspace2['publication'];
  publicationError?: string;
  activity?: Workspace2['activity'];
  envelope?: Partial<NonNullable<Workspace2['studio']['envelope']>>;
  refreshPublication?: () => Promise<unknown>;
}

/** A workspace with just what the properties surface and the Project dialogs read from it. */
function workspace(document: CompositionDocument, target?: PropertiesTarget, stub: Stub = {}, apply: (next: CompositionDocument) => void = vi.fn()): Workspace2 {
  const publication = stub.publication;
  const { studio: studioExtra, ...extra } = stub.extra ?? {};
  return {
    document, previewDocument: document, index: buildDocumentIndex(document), checks: runChecks(document), problemCount: 0, target,
    studio: { canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn(), conflict: false, apply, setError: vi.fn(), envelope: { publisherId: 'publisher-1', capabilities: ['shell@1'], assetManifestSha256: 'a'.repeat(64), revision: 3, ...stub.envelope }, dirty: false, busy: false, error: '', importHouse: vi.fn(async () => true), ...studioExtra },
    activity: stub.activity ?? [], log: vi.fn(), publication, publicationError: stub.publicationError ?? '', liveRevision: publication?.current?.revision,
    refreshPublication: stub.refreshPublication ?? vi.fn(async () => publication), persist: vi.fn(async () => true),
    selectAnywhere: vi.fn(), select: vi.fn(), setSurface: vi.fn(), houseStates: { status: 'idle' },
    surface: { kind: 'page', id: document.navigation.initialPageId }, mode: 'edit', setMode: vi.fn(), status: { text: 'Draft · Saved', tone: 'neutral' }, flash: '', failedSave: false, saveReason: '',
    retrySave: vi.fn(), saveNow: vi.fn(), phase: 'idle', publishError: '', openPublish: vi.fn(), closePublish: vi.fn(), publish: vi.fn(async () => true), conflictDecided: false, decideLater: vi.fn(), reopenConflict: vi.fn(),
    ...extra,
  } as unknown as Workspace2;
}

/** The document with something in every Project dialog: launch text, a Live Activity, a camera, a link and its prefixes. */
function withEverything(document: CompositionDocument): CompositionDocument {
  const page = document.pages[0];
  return {
    ...document,
    bootstrap: {
      type: 'native-bootstrap@1', arrivalAnnouncement: 'Your home is ready.',
      recovery: { loadingTitle: 'Getting your layout', unavailableTitle: 'Layout unavailable', unavailableMessage: 'Try again in a moment.', retryLabel: 'Try Again' },
      setup: [{ permission: 'notifications', explanation: 'Choose.' }, { permission: 'time-sensitive', explanation: 'Review.' }, { permission: 'location', explanation: 'Share.' }],
    },
    liveActivities: [{ id: 'activity-1', jobId: 'dryer', type: 'activity-presentation@1', title: 'Dryer', glyph: 'dryer', tint: 'cleaning', source: 'activity-engine@1', privacy: 'system-sensitive@1', updates: 'engine@1', intents: 'engine-safe@1' }],
    extensions: {
      type: 'native-extensions@1', watch: 'stub@1', linkPrefixes: ['hc'], cameras: [{ entityId: 'camera.demo_front_door', title: 'Front door', liveLabel: 'Live', unavailableLabel: 'Unavailable' }],
      routes: [{ id: 'route-1', path: 'home', pageId: page.id, title: page.title, summary: page.title, icon: 'house' }],
    },
  } as CompositionDocument;
}

/** Renders `children(ws)` against a document the test edits through the dialogs, so each edit shows in the next render. */
function Live({ document, stub, children, seen }: { document: CompositionDocument; stub?: Stub; children: (ws: Workspace2) => ReactNode; seen?: (document: CompositionDocument) => void }) {
  const [current, setCurrent] = useState(document);
  const apply = useMemo(() => (next: CompositionDocument) => { seen?.(next); setCurrent(next); }, [seen]);
  const ws = useMemo(() => workspace(current, undefined, stub, apply), [current, stub, apply]);
  return <>{children(ws)}</>;
}

export const Project = { workspace, withEverything, Live };
