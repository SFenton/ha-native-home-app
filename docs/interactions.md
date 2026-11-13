# Configurable preview interactions

Pages and sheet/fullscreen modals support optional `floatingButtons` and `search`.
Bound lists support optional `rowActions`. All fields have ordinary inspector
controls; JSON is not required. These are configuration data, not executable code.
The global `Action` union is unchanged.

## Authoring and compatibility

Select a page/modal to edit **Floating actions** or **Search**. Floating controls
have editable labels, icons, opaque hex colors, actions, and top-to-bottom order.
The contextual **Add to Chores** action selects a nativeTodoPage root on that
surface. It reuses that root's configured Add capability and preview simulation;
it cannot grant permission or call a new mutation endpoint.

Select a bound list for **Row swipe / menu actions**. Both logical edges have
add/remove/reorder/move-side controls. Every descriptor has a label, icon, color,
action, optional full-swipe target, and optional confirmation with editable title,
message, button labels and destructive treatment. Chores toggle descriptors also
have an optional completed-row label. A newly chosen Delete operation starts with
confirmation; explicitly removing confirmation permits immediate simulated
deletion through both swipe and menu.

Omitted floating settings inherit legacy Add controls, resolved from existing
root/first-child addAction data. They move into one dock outside scroll content,
with no inline duplicate. Omitted row actions preserve legacy Chores defaults;
generic lists gain no actions. **Customize** materializes only command templates,
not live tasks or identity. **Disable** writes empty arrays. **Use legacy** removes
the optional field. Empty arrays never restore defaults. No defaults are inserted
when loading or saving an old document. Inherited overflow remains reachable;
explicit floating configurations must be reduced to four controls before saving.

The dock is scoped to the current native preview viewport/modal, respects logical
trailing and existing side-control geometry, and reserves measured scroll space.
Short-height/large-text configurations use an Actions overflow. This is browser
preview behavior, not proof of native hardware layout or SDUI delivery.

## Declarative shapes and validation

```ts
Page.floatingButtons?: {
  id: string; label: string; icon: string; color?: string;
  action: Action | { type: 'todo-add'; componentId: string };
}[];

Component.rowActions?: {
  keyPath?: string;
  leading: RowSwipeAction[];
  trailing: RowSwipeAction[];
};

type RowSwipeAction = {
  id: string; label: string; icon: string; color?: string;
  action: Action | {
    type: 'todo-row'; operation: 'toggle' | 'edit' | 'delete';
  };
  completedLabel?: string;
  fullSwipe?: boolean;
  confirmation?: {
    title: string; message?: string;
    confirmLabel: string; cancelLabel: string; destructive?: boolean;
  };
};
```

Floating arrays allow 0-4 controls. Both row edges are required and allow 0-3
descriptors each, unique IDs across both sides, and at most one full-swipe target
per side. Unmarked or unavailable full-swipe targets never fall back to another
action. IDs use the existing safe ID syntax. Labels are nonblank, at most 80
characters; search labels/placeholders and confirmation titles allow 120;
confirmation messages allow 1,000. Icons allow 80 characters, including empty.
New colors allow opaque `#RGB` or `#RRGGBB`; omission uses the theme accent with a
contrast-selected foreground.

Generic row actions require `keyPath` resolving stable, unique, nonblank string
keys of at most 512 characters. Authored samples are checked when validating;
malformed runtime keys show an error and block the affected collection rather
than using array-index action identity. Chores forbids keyPath and uses entity ID
plus task UID. Its contextual intents are legal only in the indicated descriptors,
not ordinary components, toolbars, Live Activities, or backend action execution.
Alerts and Live Activities cannot gain floating/search controls.

Chores keeps identity/resident restrictions, supported UID checks, ready and
enabled-list gates, grocery no-edit, admin rename/no-delete, intrinsic completion,
eligible edit accessories and five-second Undo. All descriptor activation paths
share dispatch and confirmation. Pending confirmations/forms are canceled when
their identity, exact row, descriptor, visibility or capability becomes stale.
Simulated records never modify saved samples or Home Assistant.

## Local filter

```ts
Page.search = {
  id: 'task-search', label: 'Find tasks', placeholder: 'Search task names',
  mode: 'filter', queryVariable: 'taskQuery',
  targetComponentIds: ['chores-root'], paths: ['summary'],
};
```

The referenced variable must already be a string, bounded to 500 characters.
The inspector creates an empty variable when enabling a local filter. Choose
1-8 unique same-surface supported bound lists or Chores roots and 1-4 unique safe
dot paths. A Chores root expands only its typed lists; overlapping group/child
targets are rejected. Unsupported requiredData collections are not searchable.

Filtering works offline. It composes identity/visibility and simulation, existing
exact filters, trimmed NFKC/case-insensitive scalar substring search, then existing
sorting. It does not serialize objects, interpret regex, mutate samples or make
network requests. Clearing restores eligible rows. No-match copy is distinct from
missing identity or unavailable data. Local query variables cannot also drive
endpoint sources.

## Registered endpoint search

```ts
Page.search = {
  id: 'recipe-search', label: 'Find recipes', placeholder: 'Search recipe titles',
  mode: 'endpoint', sourceId: 'recipe-results',
};
// The source owns queryVariable, not Page.search:
// { kind: 'endpoint', endpoint: 'registered-recipe-search',
//   queryVariable: 'recipeQuery', ... }
```

At least one component on that surface must bind to the endpoint source. Use its
actual configured bindings and projection; there is no invented result-record
schema. The server registry owns endpoint registration, searchable metadata,
credentials and projection policy. The source must reference a registered
`searchable: true` endpoint. Its query variable starts empty, and all actions that
set any query variable must use strings of at most 500 characters.

The preview displays configured samples and disables endpoint input until the
user explicitly chooses **Enable endpoint search reads**. Neither native auto-live
nor the ordinary live-data checkbox/footer grants this consent. That dedicated
button calls `enableQueryReads`; `changeLive(false)` revokes both live readings
and search consent. Input is an ephemeral preview override, not a document edit. Search
uses the source-owned variable, publishes only non-composing input, and delegates
reads to the agreed preview-data hook:

```ts
usePreviewData(document, savedSources, serverMode, notify,
  variables, activeQuerySourceIds);
```

App supplies only the current unobscured Interact page/modal's endpoint source;
Edit, management/dialog views, Live Activities, 3D presentation and background
pages supply none. The hook owns explicit opt-in/revocation, unchanged saved-source
checks, 300 ms debounce, abort/request generation, A-B-A late-response rejection,
identity/document resets and no query polling. Enter calls `fetchData(sourceId)`
immediately; Clear/blank cancels without requesting. Requests use the existing
relative saved-source `api/data/:id?q=...` API. No new mutation proxy or executable
row interpolation is introduced. Sample, idle, loading, results/empty, unsaved and
error states remain labeled; errors do not claim samples are successful results.

## Reference integration

`assertCanRemoveComponent(page, id)` rejects removal or cross-surface movement of
a floating/filter target, or the endpoint search's last bound component.
Same-surface reordering does not need this guard. `interactionReferences(document,
'source' | 'variable', id)` extends deletion checks for the new controls.
`duplicateComponent` regenerates subtree/row descriptor IDs and internal component
destinations. `duplicatePage` additionally regenerates search, floating and toolbar
IDs and remaps same-surface targets and self-navigation actions. External action
destinations remain unchanged. `deleteSurface` cleans navigation/modal actions in
all descriptor locations and removes initial destination/tab overrides when
clearing their component action.

Sidebar/cross-surface moves and ProjectPanels source/variable deletion use these
helpers. Server registry searchability remains server-owned. Integrated browser
coverage lives in `tests/e2e/interactions.spec.ts`; production mounted-path routing
is checked by `scripts/smoke-container.mjs`. Neither proves physical-device,
ActivityKit, APNs or unchanged native-client support.
