# Source-backed native preview fidelity

These are independently implemented **browser approximations**, based on the
completed native-home source review pinned to
`b6a02f0d13806b694ee4b34691b1db524f5e7e7b`. The installed native binary is
unknown and no iOS host was available. This is not hardware, native rendering,
ActivityKit, APNs, service execution, or unchanged-client SDUI validation.
No native-home implementation or assets were copied; public source visibility
was not treated as an OSS license.

## Functional mappings

| Surface | Browser behavior |
| --- | --- |
| Thermostat | The three configured entry descriptions route to Rooms, Automation, or Tracking in Advanced Controls. Room cards expose temperature and occupancy separately. Supported select options become single-checked choices; tracking rows become check rows. The existing actual-state, actual-limits, 270-degree dial remains unchanged. |
| Guests | One section is shown when any configured guest switch is on, retaining every configured tile. The body and power disc emit identical explicit `turn_on` / `turn_off` intents. Unavailable tiles are disabled. Explanatory text belongs to the editable group subtitle. |
| Remote | Pad order is Back/Up/Power, Left/Select/Right, Home/Down/optional Keyboard. Playback uses Pause/empty/Play. Only configured safe service commands are compiled. Ordered state cases select the first match; otherwise excludes every preceding state. Unknown adapters are disabled and their raw command objects are not stored. Power remains operable while off; navigation, playback, and volume do not. |
| Volume | The configured volume entity and actual volume feature determine availability. Drag changes remain local until release, keyboard adjustments commit on key release, and accessibility-only changes commit immediately. Percentages become `volume_level: percentage / 100`. |
| Vacuum | Controls, conditional Rooms, configured Auto-Clean, conditional Dock, and configured Info use one mounted sheet. Empty manual selection means Full Clean; room order is local preview state. Pause/Resume/Dock use their corresponding vacuum services; Stop uses `vacuum.stop` only in error, otherwise `return_to_base`. Actual feature bits and unavailable state gate commands. Clean uses only the configured script. |
| Sheet chrome | Inline centered titles replace large modal headings. Children use Back; climate children retain Close. Local selectors omit a single-tab bar, use compact icons only with symbols, regular labels, and an accessibility title menu. Portal-hosted selectors stay within the modal at 16 CSS-pixel outer sides, 8 bottom, and 4 inner padding. These CSS measurements are Studio approximations, not native-point validation. |

Source observations: native-home `UKThermostatPage`,
`UKThermostatControlsSheet`, `UKHomeGuestsSection`, `UKGuestToggleTile`,
`UKRobotVacuumSheet`, `UKRobotVacuumControlsTab`, `RobotVacuumRuntimeState`,
`UKMediaRemoteControls`, `MediaRemoteController`, and their local-tab/header
helpers. The completed 64-reference research artifact contains the exact
pinned paths and line ranges.

## Explicit limits

- Map and cleaning-report telemetry are absent from the safe browser contract.
  Their same-sheet subpages say unavailable; no map or room outcomes are invented.
- Selected-room script variables are not documented by the available adapter.
  Room selection is local only, and Clean is disabled with selected rooms
  rather than sending a misleading or guessed payload.
- Pending-resume and error-reason/low-battery policy inputs are not projected.
  Full setup is limited to known idle/docked states; error setup is withheld.
  Paused Resume uses the known start capability. No low-battery threshold is
  invented. This is a conservative subset, not complete native vacuum policy.
- Auto-Clean uses the configured zone helper entities as checked Included /
  unchecked Skipped rows. Their state stays separate from manual room selection.
  No map hatching or unprovided schedule data is invented.
- Eco option descriptions are not in the safe options projection; only actual
  supported option names are rendered. No unprovided explanation or selection
  is fabricated.
- Media input `source` is not an app name. Remote subtitles use state alone
  unless an explicit safe `appName` projection is supplied; the current server
  projection does not supply it.
- Data-source failures retain existing preview data but disable entity controls.
  Disabled/read-only ancestors also block nested volume keys and vacuum settings;
  inactive sheets hide their portaled selectors while retaining local state.
  The existing simulated action channel remains unchanged. No component makes
  network calls or operates a real device.

## Renderer integration

The renderer integration is applied in `DevicePreview.tsx`. It adds the
finite presentation gates at both layout filtering and node rendering, plugs in
the new controls, retains tab/subpage state, and exposes modal child-close policy.
It does not change mobile sensors, gestures, provider switching, search, floating
actions, the global Action type, persistence, or publishing.

### Semantic checks required in the shared schema

The shared schema enforces the following checks before accepting these props.
It rejects mismatches rather than repairing documents or accepting raw command
expressions. State lists allow at most 1000 nonblank strings of at most 160
characters; optional tile labels and map names allow at most 240 characters.
Bindings use the `native-states` / `house-states` source without a binding path;
array-backed static `native-states` simulations remain supported.
Existing safe-text, bounds, nesting, unique-ID, and Action validation still apply.
Older controls without this new metadata retain their existing binding contract.
Unconfigured placeholder rows must not carry `choiceList` or `checkRow`: those
markers are valid only on actual select/toggle control action tiles.

| Metadata | Required check |
| --- | --- |
| `presentation: guest-group` | Section with a `native-states` binding; children are `guest-toggle` action tiles bound to that source. Group visibility is any child entity on, not per-child filtering. No collection binding interpretation. |
| `presentation: guest-toggle` | Action tile with safe `entityId` and `native-states` binding; no alternate Action or destination, confirmation, or controlKind. Optional `activeText`, `inactiveText`, `unavailableText` are bounded plain strings. Runtime dispatch is explicit native setters, never a generic toggle. |
| `presentation: remote-key` | Action tile; `remoteKey` is one of `back/up/power/left/select/right/home/down/keyboard/pause/play/volumeDown/volumeMute/volumeUp`; safe `remoteMediaEntityId`, binding, and a validated ordinary Action, or disabled with no Action for an unsupported adapter. |
| `stateEntityId`, `matchStates`, `excludedStates`, `alternateForStates` | Only finite compiled remote actions. Safe entity ID and binding required. `matchStates` is a nonempty array of nonempty bounded strings; `excludedStates` is an optional bounded string array. `alternateForStates` is a bounded string array mutually exclusive with match/excluded metadata. Exclusions must equal the preceding case-state union for the same logical key. Reject raw `configuredCommand`, `configuredStateAction`, and arbitrary condition/command objects. Missing/unavailable runtime states select no branch. |
| `presentation: remote-pad` / `remote-playback` | Sections containing only corresponding remote-key slots (pad keys or pause/play). Multiple components for a slot must be mutually exclusive finite branches. Use three columns, nonadaptive layout. In editor mode every branch remains selectable without overlapping slots. |
| `presentation: remote-volume` | Section with `media_player` entityId, safe remoteMediaEntityId and binding. Children contain only configured volumeMute/volumeDown/volumeUp remote keys. Runtime state/feature/volume values are not document props. |
| `nativeKind: remote-sheet` | Tabs section with nonempty editable title, safe entityId and binding. Optional Apps/Devices/Hue Sync tabs contain only their configured content; no adapter or command guessing. |
| `presentation: vacuum-sheet` | Section bound to native-states, `vacuum` entityId; optional batteryEntityId and dockStatusEntityId are safe entity IDs. Exactly one Controls tab; known unique `vacuumTab` values only: controls/zones/autoClean/more/info. Optional same-sheet `vacuumPage` sections: area/report, unique. |
| `nativeKind: vacuum-room` | Action tile inside zones, with configured safe entityId and binding, optional bounded mapName; no direct toggle/service Action. Selection is local UI state, not the configured zone helper state. |
| `vacuumAction` | `clean` only in Controls, `dockClean` / `dockDry` only in Dock; action tile with a validated explicit `script.turn_on` Action and script entity target. Marker, not title text, identifies the configured intent. |
| `choiceList`, `checkRow` | Booleans on `presentation: control` action tiles only. choiceList requires select controlKind; checkRow requires toggle controlKind. Optional checkedText/uncheckedText are bounded plain strings on check rows. Options/state remain bound data, not invented document samples. |
| `presentation: climate-rooms` | Section containing the existing climate-room navigation tiles; configured room/temperature/occupancy metadata still requires safe entity IDs. |
| `childClose` | Boolean on a navigation-stack section only. Climate Advanced Controls sets true; absent/false uses Back-only child chrome. |
| `presentation: grouped-settings` | Section using existing editable controls/rows. Its subtitle is a footer, not a sensor value or executable expression. |

All action gates must additionally honor document readOnly/disabled, source
loading/error, editing, and inactive surfaces. Services use the existing simulated
Action channel; there are no new service parsers or global Action variants.

## Focused evidence

`npm test -- tests/native-preview.test.ts tests/native-destinations.test.ts
tests/native-controls.test.tsx tests/native-presentation.test.ts` covers synthetic
valid imports, no captured identity/state samples, branch exclusivity, Guests
setter parity, unavailable/off gating, volume commit behavior, vacuum Stop policy,
local room selection, mounted draft retention, and honest unsupported subpages.
Rendered browser acceptance is covered separately in
`tests/e2e/native-fidelity.spec.ts`; source inspection and unit tests alone do not
establish rendered geometry or native-device parity.

All four native-preview Chromium cases pass in the final 73-case integrated
run (`test-results/integrated-browser-final-r6.log`). They cover Guests setters,
thermostat descriptions/child chrome/Edit continuity, vacuum tabs/local selection
and unavailable pages, and remote branches/pad/volume. The full unit suite passes
599 tests; the production build and rebuilt-container smoke also pass. Detailed
artifacts and limits are in [the verification record](mobile-editor-evidence.md).

The expanded independent source review found four actionable gaps: ordinary
live-data toggles granting search consent, stale entity controls after failed
reads, composite controls bypassing parent gates, and inactive vacuum selectors
escaping their hidden surface. All four were corrected with focused regressions
before the final run. The review excluded the then-in-progress schema; the
separate schema handoff passed 182 focused cases and typecheck, followed by the
full integrated suite. No independent post-fix re-review or native-device result
is implied.

New import mappings do not rewrite existing user documents. Reviewing a Native
Home import remains a separate, undoable operation; saving and publishing are
still explicit operations.
