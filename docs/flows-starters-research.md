# Flows starters: evidence from the previous native app

Research for F7, 2026-11-20. **A saved flow earns its place only when a visible
field or list consumes its output. The Office PC's On/Off display is a plain
entity-state binding, not a flow.** The strongest actual flow starters are a
list of lights reporting On and a due-sorted list of overdue tasks. Reusable
Home/Away logic and contextual visibility rules solve different problems.

This research now has [compiler-proven configuration change files](../scripts/examples/starters/README.md)
and local simulation evidence in [Verification](#verification). It is not an
applied change, publication, or device test. The [F7 delivery contract][feedback],
[Flows decisions and grammar][flows], and [configuration/storage rules][configuration]
remain authoritative.

## Evidence boundary and entity provenance

The native evidence below is the traditional `HassCore` room, climate, remote,
and list implementation, not an inference from the new SDUI renderer.
[StateGoldenTests.swift:7][golden-origin] additionally pins the old app at
`4fe28061`; its explicit PC example is particularly strong historical evidence.
Current retained code can include later fixes, so it is not proof that every
line existed at that frozen revision.

**No real owner entity ID was verified.** Every HA ID in the sketches below is
synthetic and cited. Local source IDs such as `home-mode` are proposed
document identifiers, not invented HA entities. These are reviewable demo
recipes; they must not be presented as ready-to-publish edits to the owner's
house.

The suggested files do not contain a real-house inventory:

- [scripts/house-scan.json:1][house-scan] is a source-leak scan allowance/debt
  file, not a snapshot of entities.
- [import-house-config.ts:6][import-house] imports through the running Studio's
  HA connection; [import-native-layout.ts:1][import-layout] imports a supplied
  layout; [migrate-native-data.ts:1][migrate-data] operates on a supplied data
  directory. None supplies the owner's entity mapping. None was executed.
- [demo-house.ts:19][demo-house] invents domain-based example states. Those
  values are not observations; its generator does not even seed every domain
  used here, including the grocery `todo` and PC `input_text`.
- [device-house.ts:6][device-house] and
  [fidcamlists-story.ts:7][todo-fixture] explicitly use synthetic IDs.

| HA entity or selection used below | Provenance and meaning | Classification |
| --- | --- | --- |
| `input_boolean.demo_power_2`, `input_text.demo_power_1` | [DemoHouseDocument.swift:7061][pc-config]: Office, Computers, Alex's PC. Power and subtitle are separate inputs. | Native demo configuration |
| `binary_sensor.demo_office_pc_power` | [ClimateLogicTests.swift:100][pc-label-test] tests its label; [line 324][pc-heat-test] includes it in `active_activity_entities`. This does **not** establish it as the Office tile's power source or an alias of the input boolean. | Synthetic test input only |
| `sensor.demo_living_room_contact_1` | [DemoHouseDocument.swift:667][predictive-config] explicitly assigns this opaque demo ID to `predictiveSensorEntityId`. Do not infer its role from its misleading name. | Native demo configuration |
| `sensor.demo_away_1`, `binary_sensor.demo_contact_1` | [DemoHouseDocument.swift:659][away-config] effective Home/Away sensor and [line 601][away-fallback-config] fallback Away flag. | Native demo configuration |
| `binary_sensor.demo_office_2`, `alarm_control_panel.demo_alarm_control_panel_1` | [DemoHouseDocument.swift:6941][office-windows-config] Office Windows aggregate and [line 9010][alarm-config] alarm panel. | Native demo configuration |
| `light.demo_office_light_item_1`, `light.demo_kitchen_light_1`, `light.demo_gym_light_item_1` | [DemoHouseDocument.swift:5678][light-office-config], [5693][light-kitchen-config], [5641][light-gym-config]: Office Light, Kitchen Table Light, Gym Light. These three are a sample selection, not the whole house. | Native demo configuration |
| `todo.demo_past_due` | [fidcamlists-story.ts:25][todo-fixture-items]: two open dated tasks and one completed task. | Studio demo fixture |
| `todo.demo_todo_2` | [DemoHouseDocument.swift:240][groceries-config]: Groceries page and grocery list. | Native demo configuration |
| `media_player.demo_media_player_4` | [DemoHouseDocument.swift:2391][volume-config]: Bedroom 1 remote's **volume** entity; its control entity is separately assigned at [line 2174][remote-control-config]. | Native demo configuration |

## Native behavior inventory

| Native behavior | Source file:line | Entities involved | Actual native computation |
| --- | --- | --- | --- |
| Office PC state and status caption | [RoomController.swift:171][room-display]; [StateGoldenTests.swift:242][pc-golden]; [DemoHouseDocument.swift:7061][pc-config] | Demo PC boolean plus separate text helper above | Tile display uses its entity for state; configured subtitle entities are formatted and joined. The old golden says the helper text's first letter was raised, with examples `Demo ready` and `Demo Busy...`. It was not a flow deriving PC status from a power reading. |
| PC contributes heat to predictive comfort | [ClimateLogic.swift:374][predictive-logic], especially [402][predictive-loads]; [ClimateLogicTests.swift:319][pc-heat-test] | Predictive sensor's `active_activity_entities`; synthetic PC binary sensor appears in that array | Builds a reason bullet from the model's declared active device list. The native app does not infer a temperature effect merely because a PC tile is On. |
| Effective Home/Away and thermostat choice | [ClimateLogic.swift:73][effective-away]; [ClimateLogicTests.swift:107][effective-away-test] | Effective mode, fallback Away flag; global and eco-away thermostats | `Away` wins; `Home` overrides the fallback; `Unknown`/`Unavailable` uses the fallback. Chooses the eco-away dial and conditionally shows an explanatory notice. |
| Contact chip severity | [ContactChipState.swift:22][contact-logic]; [ChipRulesTests.swift:30][contact-tests] | Contact aggregate, alarm, effective Away inputs | Closed wins first; an open contact plus any armed mode/triggered alarm outranks Away, which outranks Home. Missing contact information is unavailable, not closed. |
| Lights overview | [RoomOverview.swift:28][room-overview], [75][room-sections], [235][room-lights] | Configured light-group members, deduplicated across groups | Counts active lights; groups rooms into Lights On/Off; drops an empty section. A closet light appearing in two groups counts once. |
| Occupancy overview and partial failure | [RoomOverview.swift:106][room-unavailable], [130][room-card-summary]; [RoomOverviewTests.swift:42][room-unavailable-test] | Configured room occupancy sensors; tests include Office | Any active sensor makes the room occupied. All unavailable becomes Unavailable. Partial failures add an unavailable-sensor count to spoken text; a never-loaded state is distinguished from a reported unavailable state. |
| Room climate range | [RoomOverview.swift:288][room-climate]; [RoomOverviewTests.swift:167][room-climate-test] | Office range helper; temperature sensors; vent members | Prefers a text range helper, regex-normalizes numbers by truncating to one decimal, otherwise uses numeric sensor min/max, otherwise reports sensor count. |
| Automatic Thermostat warning | [ClimateLogic.swift:124][thermostat-warning] | `ClimateConfig.integrationEntityId`, assigned in [DemoHouseDocument.swift:662][away-config] | Warning is visible only for explicitly `off`, not just absent. A simple state visibility rule is sufficient. |
| Remote availability and visibility | [MediaRemoteController.swift:129][remote-logic]; [MediaRemoteLogic.swift:5][remote-state] | Separate control and volume entities | Disables navigation/playback when control is off/unknown/unavailable. Hides volume when its entity is off and `showVolumeWhenOff` is false. Keyboard hiding is separately configurable. |
| Grocery/chores quick-link counts | [ChoresConfig.swift:232][chore-counts], [270][grocery-words] | Each configured todo entity's numeric state | Sums nonnegative open counts; formats zero/singular/plural and overdue buckets. A single grocery count is already supplied by HA; there is no need to fetch and count every row again. |
| Task list presentation | [TodoItem.swift:130][todo-due], [186][todo-sort]; [TodoListController.swift:114][todo-visible] | Todo subscription items (`uid`, `summary`, `status`, `due`) | Sorts earliest due first, calculates relative due words, hides completed rows except during the Undo grace period. |
| List-specific hiding and personalization | [ChoresConfig.swift:35][todo-visibility], [112][todo-empty] | Todo open counts, allowed viewer IDs, vacation mode, resident | Hides restricted lists before viewer identity is known; optionally hides zero-open lists; retains recently completed rows for Undo. Vacation changes configured empty copy. |
| Vacuum outcomes and safety | [VacuumOutcomes.swift:67][vacuum-outcomes], [91][vacuum-parser]; [VacuumStatus.swift:217][vacuum-status] | Main Floor coordinator session/status, vacuum, battery, error and status-flag entities; demo assignments at [DemoHouseDocument.swift:9356][vacuum-config] | Validates report version/completeness, event IDs and room relationships, reconciles explicit completion markers, distinguishes typed/legacy/protocol-error output; merges command policy restrictively. This is substantially more than filtering room records. |

## How to read and use the sketches

These are **JSON fragments of existing types**, not a new patch format and not
complete composition documents. Each block specifies its insertion point.
Preserve the owner's actual page, node, source and provider IDs when a document
is eventually available. New IDs below are proposed identifiers only.

The common source declarations go into `document.dataSources` as needed, using
the `ha-entity` variant of the source schema at [schema.ts:992][source-schema]:

```json
[
  {"id":"pc-status","kind":"ha-entity","entityId":{"type":"literal","value":"input_text.demo_power_1"}},
  {"id":"predictive","kind":"ha-entity","entityId":{"type":"literal","value":"sensor.demo_living_room_contact_1"}},
  {"id":"home-mode","kind":"ha-entity","entityId":{"type":"literal","value":"sensor.demo_away_1"}},
  {"id":"away-fallback","kind":"ha-entity","entityId":{"type":"literal","value":"binary_sensor.demo_contact_1"}},
  {"id":"office-windows","kind":"ha-entity","entityId":{"type":"literal","value":"binary_sensor.demo_office_2"}},
  {"id":"alarm","kind":"ha-entity","entityId":{"type":"literal","value":"alarm_control_panel.demo_alarm_control_panel_1"}},
  {"id":"groceries","kind":"ha-entity","entityId":{"type":"literal","value":"todo.demo_todo_2"}},
  {"id":"bedroom-volume","kind":"ha-entity","entityId":{"type":"literal","value":"media_player.demo_media_player_4"}}
]
```

Capabilities below name the additions associated with the recipe and consumer,
not the enclosing page/shell's complete manifest. The downstream content task
must derive the full set from `compileCompositionDocument` and check the actual
target manifest. There is no native capability for a Studio logic template:
[logic-library.ts:11][logic-expansion] expands it away. None of these recipes
requires the pending `sh.flow-average@1` or `sh.text-keep@1`.

For field logic, open its canvas, select **Simulated**, pin the cited input
blocks, inspect **Just the Values**, and save/run scenarios with explicit
expected outputs. The existing controls and no-device-write boundary are in
[SimulationHost.tsx:211][simulation]. For flows, pin the request stream or
entity inputs and inspect **Each Run & Items**. A `todo-items` test pins a
`{"items":[...]}` response; it does not call HA.

Always distinguish a **present string** `"unknown"`/`"unavailable"` from an
absent/loading read. `raw-state` preserves the former; the latter remains
Can't Tell ([evaluator.ts:54][raw-semantics]). An unanswered Choose can retain
previous text rather than reach its `otherwise` branch
([evaluator.ts:329][choose-semantics]). The recipes do not silently turn missing
data into Off, Closed, zero, or a successful action.

### 1. Office > Computers > PC: show On/Off without a flow

**Destination:** the Office page's existing PC tile, `binding.entityId` and
state words. Keep both residents' PC tiles where the old app put them; do not
add a disconnected Home-page flow just to demonstrate the feature.

**Minimum:** plain state-tile binding. If a separate lifecycle caption is
wanted, bind the existing text helper to `props.subtitle`. A template adds
nothing for one state read. A show/hide rule would be wrong for the main PC
tile: Off is useful information, and hiding it also hides the place to turn it
on. Native evidence: [PC config][pc-config], [old PC golden][pc-golden].

**Schema:** `stateTileBindingSchema`/`stateOverrideSchema`
([state-styles.ts:109][state-binding]); `stateTile`
([schema.ts:342][state-tile-schema]). **Compiler correction:** the built-in
switch style has domain `switch`; it rejects this `input_boolean` binding,
despite the Studio's suggestion helper offering it. Keep the cited power
helper and add this display-only entry to `document.stateStyles.styles`
(create the `{"type":"state-styles@1","styles":[...]}` library only if absent):

```json
{
  "id":"pc-power-display","name":"PC power display","domain":"input_boolean",
  "rules":[
    {"states":["on"],"class":"resting","active":true,"text":"On"},
    {"states":["off"],"class":"resting","active":false,"text":"Off"},
    {"states":["unknown","unavailable"],"class":"unknown","active":false,"text":"Unavailable"}
  ],
  "fallback":{"class":"unknown","active":false,"text":"Unavailable"}
}
```

It declares no service action and does not change the power helper's domain.

Insert/replace the corresponding tile node, preserving an existing action if
the downstream scope is display-only:

```json
{
  "id":"office-pc",
  "title":"Office PC",
  "type":"state-tile",
  "layout":{"span":1},
  "icon":{"type":"sf-symbol","name":"desktopcomputer","rendering":"canonical","unavailable":"fallback"},
  "binding":{
    "entityId":"input_boolean.demo_power_2",
    "styleId":"pc-power-display"
  },
  "props":{}
}
```

Optional `props.subtitle`, a `textValue` read slot
([slots.ts:21][text-slots]), not a flow:

```json
{
  "type":"read",
  "from":{"type":"source","sourceId":"pc-status","path":["state"]},
  "as":"string",
  "missing":"unavailable",
  "fallback":"PC status unavailable"
}
```

**Capabilities:** `sh.tiles@1`, `sh.state-style@1`; the optional helper subtitle
adds `sh.tile-parts@1`, `sh.bindings@1`, `sh.rules@1` for its fallback.

**Simulation:** pin power On then Off: the tile stays present and says the
matching word. Pin unknown/unavailable: it must not say Off. Independently
change helper text to `Demo ready`/`Demo Busy...`: only the helper caption
changes. This intentionally preserves helper text; it does not pretend a
boolean can reconstruct a boot/shutdown lifecycle.

### 2. Climate > Predictive Comfort: explain when PC heat matters

**Destination:** a text reason under Predictive Comfort, or a linked Office
Climate detail's reason section; field `visibleWhen` on that text node.
This is where PC-related logic genuinely adds information beyond On/Off.

**Minimum:** `list-includes` operand adapted to a predicate with `compare eq
true`, then a visibility rule. Read the model's own activity list, not the PC
tile's boolean. Native evidence: [ClimateLogic.swift:402][predictive-loads]
and its [explicit PC test][pc-heat-test].

**Schema:** `Operand` (`list-includes`) and `Predicate` (`compare`) at
[expression.ts:84][expression-types]; `visibilityFields` at
[expression.ts:969][visibility-schema]; `textNode` at
[schema.ts:213][text-node-schema].

Insert a text node in that details section:

```json
{
  "id":"pc-heat-explanation",
  "title":"PC heat contribution",
  "type":"text",
  "layout":{},
  "visibleWhen":{
    "type":"compare",
    "op":"eq",
    "left":{
      "type":"list-includes",
      "from":{"type":"source","sourceId":"predictive","path":["attributes","active_activity_entities"]},
      "value":{"type":"literal","value":"binary_sensor.demo_office_pc_power"}
    },
    "right":{"type":"literal","value":true}
  },
  "whenUnknown":"hide",
  "props":{
    "value":{"type":"literal","value":"The predictive model includes Office PC heat."},
    "style":"body",
    "unavailableText":"Predictive activity unavailable"
  }
}
```

**Capabilities:** `sh.text@1`, `sh.visible-when@1`, `sh.bindings@1`,
`sh.operands@1`, `sh.conditions@1`, `sh.list-read@1`.

**Simulation:** pin the attribute to an array containing the cited PC ID:
show the sentence. Pin `[]` or an array without it: hide. Pin a missing
attribute: Can't Tell/hide, not a claim that the PC is off. This is a
synthetic test-list example, **not an assertion that the owner's thermal model
uses this binary sensor**.

### 3. Climate > Whole Home: reusable effective-Away notice

**Destination:** Whole Home climate's notice `visibleWhen`; reuse the same
condition in contact severity (starter 4). It is a useful saved template
because it has two real consumer fields, not just a name in Flows.

**Minimum:** a condition template, not a pipeline. Two scalar sources and
precedence do not need an external request or list processing. Native source:
[ClimateLogic.swift:73][effective-away] and [tests][effective-away-test].

**Schema:** `LogicEntry`, `logicEntrySchema`, `logicRefSchema`, source-id holes
at [library-schema.ts:21][library-schema]; shared `Predicate` and `raw-state`
operand at [expression.ts:84][expression-types].

Add this entry to `document.logicLibrary`:

```json
{
  "id":"effective-away",
  "name":"Effective Away",
  "kind":"condition",
  "params":[
    {"name":"mode","kind":"source-id","label":"Effective mode","sample":"home-mode"},
    {"name":"fallback","kind":"source-id","label":"Away fallback","sample":"away-fallback"}
  ],
  "body":{
    "type":"any",
    "of":[
      {
        "type":"compare","op":"eq",
        "left":{"type":"raw-state","sourceId":{"type":"hole","name":"mode"}},
        "right":{"type":"literal","value":"Away"}
      },
      {
        "type":"all",
        "of":[
          {
            "type":"in",
            "value":{"type":"raw-state","sourceId":{"type":"hole","name":"mode"}},
            "in":[{"type":"literal","value":"unknown"},{"type":"literal","value":"unavailable"}]
          },
          {"type":"state","sourceId":{"type":"hole","name":"fallback"},"path":["state"],"in":["on"]}
        ]
      }
    ]
  }
}
```

Consumer node in Whole Home's explanatory section:

```json
{
  "id":"effective-away-notice",
  "title":"Home/Away notice",
  "type":"text",
  "layout":{},
  "visibleWhen":{"type":"logic-ref","logicId":"effective-away","args":{"mode":"home-mode","fallback":"away-fallback"}},
  "whenUnknown":"show",
  "props":{
    "value":{"type":"literal","value":"Check the effective Home/Away mode before changing targets."},
    "style":"body",
    "unavailableText":"Home/Away status unavailable"
  }
}
```

**Capabilities:** `sh.text@1`, `sh.visible-when@1`, `sh.bindings@1`,
`sh.operands@1`, `sh.conditions@1`, `sh.raw-state@1`; no template capability.

**Simulation:** `Home` + fallback On -> No/hide; `Away` + fallback Off ->
Yes/show; literal unknown/unavailable + fallback On -> Yes; the same with
fallback Off -> No. A genuinely missing mode -> Can't Tell/show neutral copy.
That missing-read policy is deliberately more explicit than the old native
nil-to-Unavailable fallback; it must not be advertised as perfect parity.
The notice does not change setpoints, switch the thermostat source, or
operate devices.

### 4. Office > Windows: distinguish open-at-home from open-and-armed

**Destination:** the Office Windows tile's `props.subtitle`, with the same
operand optionally consumed by a Home/Security contact-summary text node.
Leave the closed/unavailable tile navigable; do not hide the main diagnostic
surface.

**Minimum:** an inline Choose operand in a text slot, reusing the condition
template from starter 3. It combines independent facts; a plain binding
cannot express the alarm-first priority. Only extract a separate caption
template if multiple contact tiles actually use it.

Native evidence: [ContactChipState.swift:32][contact-logic] and
[ChipRulesTests.swift:30][contact-tests]. This is a text explanation of that
severity, not an attempt to reproduce every native color.
**Schema:** `Operand.choose`, `Predicate.in` ([expression.ts:84][expression-types]),
`textValue` ([slots.ts:32][text-slots]), `stateTile.props.subtitle`
([schema.ts:345][state-tile-schema]).

Set that subtitle slot to:

```json
{
  "type":"expr",
  "value":{
    "type":"choose",
    "cases":[
      {
        "when":{"type":"in","value":{"type":"raw-state","sourceId":"office-windows"},"in":[{"type":"literal","value":"off"},{"type":"literal","value":"closed"}]},
        "then":{"type":"literal","value":"All Closed"}
      },
      {
        "when":{"type":"in","value":{"type":"raw-state","sourceId":"office-windows"},"in":[{"type":"literal","value":"on"},{"type":"literal","value":"open"}]},
        "then":{
          "type":"choose",
          "cases":[
            {
              "when":{
                "type":"in",
                "value":{"type":"raw-state","sourceId":"alarm"},
                "in":[
                  {"type":"literal","value":"armed_home"},{"type":"literal","value":"armed_away"},
                  {"type":"literal","value":"armed_night"},{"type":"literal","value":"armed_vacation"},
                  {"type":"literal","value":"armed_custom_bypass"},{"type":"literal","value":"triggered"}
                ]
              },
              "then":{"type":"literal","value":"Open - security armed"}
            },
            {
              "when":{"type":"logic-ref","logicId":"effective-away","args":{"mode":"home-mode","fallback":"away-fallback"}},
              "then":{"type":"literal","value":"Open - household away"}
            }
          ],
          "otherwise":{"type":"literal","value":"Open - household home"}
        }
      }
    ],
    "otherwise":{"type":"literal","value":"Contact status unavailable"}
  },
  "fallback":"Contact status unavailable"
}
```

**Capabilities:** `sh.tile-parts@1` when on a state tile, `sh.rules@1`,
`sh.operands@1`, `sh.conditions@1`, `sh.raw-state@1`, `sh.bindings@1`.

**Simulation:** closed + armed -> All Closed; open + armed + away -> security
armed; open + disarmed + Away -> household away; open + disarmed + Home ->
household home. Explicit unknown/unavailable contact text -> status unavailable.
Missing input -> Can't Tell/normal retention, never manufacture a Closed answer.
The finite armed list matches the tested modes, not future arbitrary
`armed_*` values.

### 5. Home > Lights detail: a useful Lights On flow with visible rows

**Destination:** a `row-collection` on the Lights detail surface, next to or
below the full native-style overview. Its `props.providerId` is the use that
makes the saved flow visible. For a fixed number alone, prefer a `count`
operand; use this flow because the result is a filtered list.

Native basis: [RoomOverview.swift:75][room-sections] and
[235][room-lights]. This starter lists individual selected lights rather than
recreating room-card grouping. It deliberately does not claim that three
demonstration members cover the house.

**Schema:** `PipelineSource`/`pipelineSourceSchema`, request `entities`,
`PipelineStep.filter`/`map`, rows output
([pipeline/schema.ts:72][pipeline-steps], [124][pipeline-request],
[149][pipeline-output]); `Shape` ([shape.ts:22][shape]);
`rowCollection` ([schema.ts:424][rows-schema]).

Add a data source:

```json
{
  "id":"selected-lights-on",
  "kind":"model",
  "model":"pipeline@1",
  "inputs":{
    "title":"Selected Lights On",
    "parameters":[],
    "request":{
      "type":"entities",
      "entityIds":[
        {"type":"literal","value":"light.demo_office_light_item_1"},
        {"type":"literal","value":"light.demo_kitchen_light_1"},
        {"type":"literal","value":"light.demo_gym_light_item_1"}
      ],
      "attributes":[]
    },
    "steps":[
      {"id":"on","op":"filter","where":{"type":"compare","op":"eq","left":{"type":"item","path":["state"]},"right":{"type":"literal","value":"on"}}},
      {
        "id":"labels","op":"map",
        "fields":{
          "id":{"type":"item","path":["entityId"]},
          "title":{
            "type":"map",
            "of":{"type":"item","path":["entityId"]},
            "cases":[
              {"equals":"light.demo_office_light_item_1","then":{"type":"literal","value":"Office Light"}},
              {"equals":"light.demo_kitchen_light_1","then":{"type":"literal","value":"Kitchen Table Light"}},
              {"equals":"light.demo_gym_light_item_1","then":{"type":"literal","value":"Gym Light"}}
            ],
            "otherwise":{"type":"item","path":["entityId"]}
          }
        }
      }
    ],
    "output":{"kind":"rows","max":3,"row":{"id":{"type":"item","path":["id"]},"title":{"type":"item","path":["title"]},"subtitle":{"type":"literal","value":"On"}}},
    "schema":{"kind":"array","of":{"kind":"object","fields":{"id":{"shape":{"kind":"string"}},"title":{"shape":{"kind":"string"}}}}}
  }
}
```

Add its consumer to the Lights detail surface:

```json
{
  "id":"selected-lights-on-list",
  "title":"Selected Lights On",
  "type":"row-collection",
  "layout":{},
  "props":{
    "providerId":"selected-lights-on",
    "loadingText":"Loading light states",
    "emptyText":"No selected lights report On",
    "unavailableText":"Light states unavailable",
    "errorText":"Unable to read light states",
    "staleText":"Showing earlier light states"
  }
}
```

**Capabilities:** `sh.bindings@1`, `sh.pipeline@1`,
`sh.pipeline-operands@1`, `sh.row-collection@1`. Existing corpus precedent:
[pipeline-entities-count.json:1][entities-corpus]; this version keeps rows
instead of reducing to a count.

**Simulation:** Office On, Kitchen Off, Gym On -> two rows, Office then Gym.
All Off -> empty copy. Office unavailable, others Off -> the same accurately
qualified empty copy, **not** All Off. Missing entities become unavailable
strings in an entities request ([pipeline/sources.ts:49][entity-rows]); the
filter is not an availability monitor. Keep the existing full overview for
unavailable-room diagnostics.

### 6. Chores > Past Due: overdue rows sorted by due date

**Destination:** Chores' Past Due section, `row-collection.props.providerId`.
This is a read-only overview, not a replacement for the editable checklist or
its Undo behavior.

**Minimum:** a `todo-items` subscription pipeline: Get Items, Filter, Sort,
Map, Rows. Native basis: [TodoItem.swift:130][todo-due] and
[186][todo-sort]. The exact existing lowering precedent is
[pipeline-overdue-chores.json:1][overdue-corpus].

**Schema:** `PipelineSource`, `requestSchema` (`ha-subscription/todo-items`),
`stepSchema`, `outputSchema`, `Shape`; the fixed subscription item shape is
[pipeline/sources.ts:20][todo-shape]. This uses the existing calendar-day
recipe, not the native row's exact hours/weeks/months wording.

Add a data source:

```json
{
  "id":"past-due-rows",
  "kind":"model",
  "model":"pipeline@1",
  "inputs":{
    "title":"Past Due Tasks",
    "parameters":[],
    "request":{"type":"ha-subscription","kind":"todo-items","entityId":{"type":"literal","value":"todo.demo_past_due"}},
    "steps":[
      {"id":"items","op":"get","path":["items"]},
      {
        "id":"late","op":"filter",
        "where":{
          "type":"all",
          "of":[
            {"type":"compare","op":"eq","left":{"type":"item","path":["status"]},"right":{"type":"literal","value":"needs_action"}},
            {"type":"exists","value":{"type":"item","path":["due"]}},
            {"type":"compare","op":"above","left":{"type":"date","op":"days-between","from":{"type":"item","path":["due"]},"to":{"type":"clock","part":"today"}},"right":{"type":"literal","value":0}}
          ]
        }
      },
      {"id":"oldest","op":"sort","by":[{"value":{"type":"item","path":["due"]},"direction":"ascending","kind":"date"}]},
      {
        "id":"labels","op":"map",
        "fields":{
          "id":{"type":"item","path":["uid"]},
          "title":{"type":"item","path":["summary"]},
          "late":{"type":"date","op":"days-between","from":{"type":"item","path":["due"]},"to":{"type":"clock","part":"today"}}
        }
      }
    ],
    "output":{
      "kind":"rows","max":50,
      "row":{
        "id":{"type":"item","path":["id"]},
        "title":{"type":"item","path":["title"]},
        "subtitle":{
          "type":"map","of":{"type":"item","path":["late"]},
          "cases":[{"equals":1,"then":{"type":"literal","value":"1 day overdue"}}],
          "otherwise":{"type":"format","pattern":"{days} days overdue","args":{"days":{"type":"item","path":["late"]}}}
        }
      }
    },
    "schema":{"kind":"array","of":{"kind":"object","fields":{
      "id":{"shape":{"kind":"string"}},
      "title":{"shape":{"kind":"string"}},
      "late":{"shape":{"kind":"union","of":[{"kind":"null"},{"kind":"number","integer":true}]}}
    }}}
  }
}
```

Consumer in that section:

```json
{
  "id":"past-due-list",
  "title":"Past Due",
  "type":"row-collection",
  "layout":{},
  "props":{
    "providerId":"past-due-rows",
    "loadingText":"Loading past-due tasks",
    "emptyText":"No tasks overdue by a day",
    "unavailableText":"Tasks unavailable",
    "errorText":"Unable to read tasks",
    "staleText":"Showing earlier tasks"
  }
}
```

**Capabilities:** `sh.bindings@1`, `sh.pipeline@1`,
`sh.pipeline-operands@1`, `sh.row-collection@1`.

**Simulation:** pin the [three fixture items][todo-fixture-items] and a
2026-11-16 clock. Expect `p1` then `p2`, 7 and 4 days overdue; completed `p3`
is absent. Add a task due yesterday -> singular `1 day overdue`; due today,
future and undated tasks are absent. An empty answered list is empty; a failed
request is unavailable/error, not proof there are no tasks. Do not mark an
empty-list pin as a failed-request test.

### 7. Groceries: count words on the link, checklist semantics on the page

**Destinations:** the Groceries navigation tile's `props.subtitle`; the
Groceries page's collection provider and `inputs.lists[0].hideCompleted`.
Keep the navigation link available when empty so adding groceries stays
discoverable.

**Minimum:** a small Map/Format operand for plural words, plus the existing
`todo-collection@1` provider for checklist behavior. Neither needs a pipeline
or a template until reused. Native evidence: [ChoresConfig.swift:270][grocery-words],
[TodoListController.swift:114][todo-visible], and the actual
[demo Groceries page][groceries-config].

**Schema:** `Operand.map/read/format`, `textValue`; `todoCollectionSource`
([schema.ts:973][todo-schema]); `collection` ([schema.ts:434][collection-schema]).
Subtitle slot:

```json
{
  "type":"expr",
  "value":{
    "type":"map",
    "of":{"type":"read","from":{"type":"source","sourceId":"groceries","path":["state"]},"as":"number","missing":"unavailable"},
    "cases":[
      {"equals":0,"then":{"type":"literal","value":"No groceries listed"}},
      {"equals":1,"then":{"type":"literal","value":"1 item"}}
    ],
    "otherwise":{
      "type":"format","pattern":"{count} items",
      "args":{"count":{"type":"read","from":{"type":"source","sourceId":"groceries","path":["state"]},"as":"number","missing":"unavailable"}}
    }
  },
  "fallback":"Groceries unavailable"
}
```

Provider source, preserving the old grocery page's deliberate **not hidden
when empty** behavior:

```json
{
  "id":"grocery-checklist",
  "kind":"model",
  "model":"todo-collection@1",
  "inputs":{
    "title":"Groceries",
    "lists":[{"title":"Grocery List","entityId":{"type":"literal","value":"todo.demo_todo_2"},"hideCompleted":true,"hideWhenNoOpenItems":false}],
    "addAction":{"type":"grocery","entityId":{"type":"literal","value":"todo.demo_todo_2"}},
    "hideListHeaders":false,
    "hiddenByVacation":false,
    "empty":{"title":"No Groceries Listed","description":"Add some groceries to see them appear."}
  }
}
```

Consumer on Groceries:

```json
{
  "id":"grocery-items",
  "title":"Groceries",
  "type":"collection",
  "layout":{},
  "props":{"providerId":"grocery-checklist","template":"todo","loadingText":"Loading groceries","emptyText":"No Groceries Listed"}
}
```

**Capabilities:** caption `sh.rules@1`, `sh.operands@1`, `sh.bindings@1`;
list `sh.todo-collection@1`, `sh.collection@1`. A caption on a state tile also
needs `sh.tile-parts@1`; on a navigation tile it uses its existing subtitle.

**Simulation:** source state 0/1/3 -> zero/singular/plural; unavailable -> the
authored fallback, never zero. In the demo preview supply `todoList` data
using the [existing fixture pattern][todo-fixture-items]: one needs-action
item and one completed item. Only the open one draws; empty data leaves the
Groceries page usable. Do not click Add/Complete against HA. `hideCompleted`
is a provider behavior, not a flow-filter substitute for native Undo.
This assumes HA's valid nonnegative integer count; it does not recreate the
native controller's malformed-count sanitization.

### 8. Bedroom 1 > Streamer remote: hide unusable volume controls

**Destination:** the existing remote's `remote-control` node whose
`props.kind` is `volume`; set **node-level** `visibleWhen`/`whenUnknown`, not
unknown keys inside `props`. Preserve its provider binding, volume keys, and
the separate power controls.

**Minimum:** a visibility predicate. Native
[MediaRemoteController.swift:137][remote-logic] checks the volume entity, not
the control entity; this remote has
[`showVolumeWhenOff: false`][volume-flag]. The demo keyboard flag is false,
so this is **not** evidence for hiding its keyboard.

**Schema:** shared node `visibilityFields` ([schema.ts:123][node-schema]),
`Predicate.not/in` and `Operand.raw-state`; `remote-control` node
([schema.ts:487][remote-node-schema]) and volume primitive
([remote.ts:37][remote-schema]).

Merge these fields onto that existing volume node:

```json
{
  "visibleWhen":{
    "type":"not",
    "of":{
      "type":"in",
      "value":{"type":"raw-state","sourceId":"bedroom-volume"},
      "in":[{"type":"literal","value":"off"},{"type":"literal","value":"unknown"},{"type":"literal","value":"unavailable"}]
    }
  },
  "whenUnknown":"hide"
}
```

**Capabilities:** adds `sh.visible-when@1`, `sh.bindings@1`,
`sh.operands@1`, `sh.conditions@1`, `sh.raw-state@1` to the existing
`sh.media-remote@1`/`sh.remote-volume@1` node.

**Simulation:** volume entity On/Playing/Idle -> visible; Off, literal
unknown/unavailable, or missing -> hidden. Vary only the remote's separate
control entity: this visibility must not change. Power stays visible.
Verify visibility without operating a real volume slider. This is not a
claim that the generic browser remote exactly reproduces native optimistic
state or every disabled-control behavior.

## Gaps and deliberate non-proposals

### Native behaviors not generally expressible as today's authored logic

- **Free-form string parsing/replacement.** The closed operands have no regex,
  split, substring, arbitrary lowercase/trim or string-prefix operator.
  Consequently the exact old climate-helper range normalization
  ([RoomOverview.swift:288][room-climate]), battery-level extraction from a
  task's prose and DoneTick UID splitting
  ([TodoItem.swift:46][todo-identity], [155][todo-title]) cannot be reproduced
  as generic operands/flows. Reading an already-prepared helper, explicit
  finite mapping, and using a domain provider are different solutions.
- **Arbitrary future armed-state prefixes.** Native accepts any `armed_`
  prefix ([ContactChipState.swift:24][contact-logic]); a generic predicate
  can enumerate the current modes, not test that prefix. Starter 4 explicitly
  enumerates the modes evidenced by tests.
- **General imperative/stateful programs.** Flows cannot implement an
  arbitrary optimistic request state machine, delayed task completion with a
  five-second Undo grace window, subscriptions of arbitrary kinds, or
  platform text-input commands. Native examples are
  [TodoListController.swift:6][todo-optimistic] and
  [MediaRemoteLogic.swift:17][remote-state]. Existing action, state-style,
  todo and remote provider descriptors own supported behaviors; a flow is
  not a replacement for those implementations.
- **Full vacuum report validation/reconciliation in a generic pipeline.**
  Fixed-shape traversal is not proof of unique IDs, cross-record references,
  matching attempts, versions and completeness. The native parser checks
  those relationships ([VacuumOutcomes.swift:91][vacuum-parser]). Do not
  replace it with `get rooms -> filter status != completed` and call the
  output trustworthy.

### Supported contracts that still do not justify a starter/parity claim

- **Vacuum outcomes are already a domain primitive**, not a missing grammar
  proposal: `vacuumPrimitiveSchema` has `kind:"outcomes"` and the descriptor
  has coordinator/reconciliation inputs ([vacuum.ts:15][vacuum-schema]).
  However, the current Studio renderer only displays
  `"No cleaning outcome to show."` for an available vacuum
  ([preview2/nodes/vacuum.tsx:205][vacuum-preview]). A successful preview of
  that placeholder cannot verify the native typed report. This is why it is
  in the inventory but not one of the eight simulation-ready starters.
- The native `home-status@1` projection already has explicit members and
  climate/contact inputs ([schema.ts:997][home-status-schema]). Do not replace
  its unavailable-room/spoken-summary behavior with an incomplete simple
  count merely to fill the Flows library.
- Effective-Away on a genuinely missing source and exact relative due-time
  wording are the explicit parity limits in starters 3 and 6. Neither needs
  a new grammar proposal to be useful within its stated scope.
- `logicLibrary` is a Studio authoring facility and is expanded out before
  publication. Saving an unreferenced template or pipeline is not evidence
  that the app changed. Typed rows require a collection consumer; they are
  not scalar reads at `["value"]`.
- No inference here establishes real entity availability, native capability
  support on the owner's installed build, physical-device behavior,
  ActivityKit, APNs, or HA installation.

## Owner document reachability and eventual landing point

Only these permitted plain GETs were made, with no credentials, redirects,
other endpoints, writes, or HA contact:

| Request | Observation |
| --- | --- |
| `GET http://127.0.0.1:4801/` | Connection refused; curl exit 7; HTTP status `000` (no HTTP response). |
| `GET http://127.0.0.1:4800/` | Connection refused; curl exit 7; HTTP status `000` (no HTTP response). |

**The owner's real Studio document was not reachable through either permitted
origin at research time.** No server was started; no local data directory,
owner document, token file or private publish bundle was opened. Page/node
targets in this document are therefore semantic destinations, not claimed
observations of the owner's current document.

When an authorized content task has an available Studio and the actual base,
the change lands in that Studio's **composition draft**, through
[`scripts/studio-publish.ts` as documented][agent-publish], not by editing
the native repository, the Core integration, a demo fixture, or a live data
file. Its external `CHANGE` directory belongs under
`STUDIO_PUBLISH_HOME` (default `~/hass-agents/studio-publish`), outside every
repository. It records the base draft/live revisions, full candidate, narrow
scope pointers, hash-bound validation/screenshots/checks, and rollback data.

`check` is read-only; `apply` writes the draft with `expectedRevision`;
publication is a separate explicit operation (or the explicit `--publish`
option). The script refuses owner unpublished edits, stale bases, a mismatched
Studio/document, invalid evidence or excess scope. It must not be bypassed
with the import/migration scripts. The [F7 fallback][feedback] requires a
validated reviewable change plus corpus proof when no loopback Studio exists;
the [eight reviewable change files](../scripts/examples/starters/README.md)
and [their fixture-based compiler tests](../tests/flows-starters.test.ts) now
supply that offline delivery artifact. The real-ID mapping and actual Studio
base remain dependencies for owner-targeted content.

## Verification

Local verification on 2026-11-20 installed the lockfile with `npm ci` and ran
`npx vitest run tests/flows-starters.test.ts`: **72 tests passed**, comprising
eight independent compiler/manifest proofs, 63 simulation cases, and the
eight-file inventory check. `npm run typecheck` also passed. Unlike the
initial research checkout, this worktree has `tsx` available.

The required full checks also passed: `npm test` completed with **295 test
files passed, 15,175 tests passed, and 1 skipped**; `npm run build` completed
TypeScript checking and the Vite production build. These checks used isolated
test resources, not the owner's data. The build reported dependency annotation
and bundle-size warnings, not errors.

| Starter | Compiler and exact capabilities | Simulation results | Recipe corrections / limits proved |
| --- | --- | --- | --- |
| 1. Office PC | Pass | 6/6 pass | Replaced the rejected built-in `switch` binding with an `input_boolean` display style; unknown, unavailable and absent power never say Off. Caption remains an independent read. |
| 2. Predictive PC heat | Pass | 6/6 pass | No grammar correction. Missing attribute/model is Can't Tell and hidden; only inclusion in the model's declared activity list reveals the explanation. |
| 3. Effective Away | Pass | 11/11 pass | No grammar correction. Explicit unknown/unavailable mode uses the known fallback; a missing mode is Can't Tell with the neutral notice shown. The template expands away. |
| 4. Office Windows | Pass | 13/13 pass | No grammar correction. Closed first, armed before Away, explicit unavailable copy, and missing-read Choose stalling/retention all proved. The test-only tile uses the valid `notice` style for its binary sensor; no `contact` built-in exists. |
| 5. Selected Lights On | Pass | 5/5 pass | No grammar correction. Real `entityRows` preserves configured order and represents missing members as unavailable strings. Empty output says only "No selected lights report On," never "All Off." |
| 6. Past Due Tasks | Pass | 5/5 pass | No grammar correction. Oldest-first rows show 7/4 days overdue and singular yesterday; completed/today/future/undated rows are excluded. Both failed and not-yet-answered captures have no result and a missing-response diagnostic, not an empty-list claim. |
| 7. Groceries | Pass | 7/7 pass | No grammar correction. Real text evaluation and checklist rendering prove count words, unavailable fallback, completed-item hiding, empty-list visibility, and preservation of the navigation action. |
| 8. Bedroom volume | Pass | 10/10 pass | No grammar correction. Rule is on the node; missing volume is Can't Tell/hidden. Provider/volume keys and the separate visible power node are unchanged. Varying the synthetic control entity does not alter volume visibility. |

Every file under `scripts/examples/starters/` records its fixture-relative
RFC 6901 changes, purpose, semantic destination, synthetic entity mappings,
full compiler-derived capability manifest, simulations, and correction notes.
Tests clone documents from `tests/fixtures`; they never edit the fixtures or
the native-shared corpus. Starters 3 and 4 independently include the same
template so each file stands alone; a combined owner change must reuse it.
No starter was removed.

The real shared evaluator, pipeline evaluator, request-row builder, and
simulation host execute pinned inputs with the frozen clock
`2026-11-16T12:00:00`, UTC offset -480. Checklist cases render the existing
provider in jsdom; `fetch` is forbidden. Failed subscription cases deliberately
omit the captured response in the real simulation host rather than sending
`null`/`[]` through total pipeline steps and mistaking that output for success.
No HA, existing Studio, credential, development data, or live device was
contacted, and no server was started for these starter proofs.

These are local compiler/evaluator/provider proofs, **not** interactive
browser-scenario, owner-document, publish, native-runtime, or physical-device
proof. No owner draft was available or modified; the loopback Studio remains
not running. Follow only [the agent publish path][agent-publish] for any
eventual mapped owner change, with its own base, capability and screenshot
evidence.

## Source links

[feedback]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/docs/flows-canvas-feedback.md:85
[flows]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/docs/flows-canvas.md:9
[configuration]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/docs/configuration.md:1
[agent-publish]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/docs/agent-publish.md:1
[house-scan]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/scripts/house-scan.json:1
[import-house]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/scripts/import-house-config.ts:6
[import-layout]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/scripts/import-native-layout.ts:1
[migrate-data]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/scripts/migrate-native-data.ts:1
[demo-house]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/preview2/demo-house.ts:19
[device-house]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/preview2/fixtures/device-house.ts:6
[todo-fixture]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/preview2/fixtures/fidcamlists-story.ts:7
[todo-fixture-items]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/preview2/fixtures/fidcamlists-story.ts:21
[source-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/schema.ts:992
[home-status-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/schema.ts:997
[logic-expansion]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/logic-library.ts:11
[library-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/studio-logic/library-schema.ts:21
[expression-types]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/expression.ts:84
[visibility-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/expression.ts:969
[state-binding]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/state-styles.ts:109
[switch-style]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/state-styles.ts:224
[state-tile-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/schema.ts:342
[text-slots]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/slots.ts:21
[text-node-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/schema.ts:213
[node-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/schema.ts:123
[rows-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/schema.ts:424
[collection-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/schema.ts:434
[todo-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/schema.ts:973
[remote-node-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/schema.ts:487
[remote-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/remote.ts:37
[vacuum-schema]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/vacuum.ts:15
[vacuum-preview]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/preview2/nodes/vacuum.tsx:205
[pipeline-steps]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/pipeline/schema.ts:72
[pipeline-request]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/pipeline/schema.ts:124
[pipeline-output]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/pipeline/schema.ts:149
[shape]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/pipeline/shape.ts:22
[entity-rows]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/pipeline/sources.ts:49
[todo-shape]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/pipeline/sources.ts:20
[entities-corpus]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/contract/corpus/accept/pipeline-entities-count.json:1
[overdue-corpus]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/contract/corpus/accept/pipeline-overdue-chores.json:1
[raw-semantics]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/evaluator.ts:54
[choose-semantics]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/shared/composition/evaluator.ts:329
[simulation]: /Users/stephenfenton/.t3/worktrees/ha-native-home-app/t3-42f2a75d-607bde5811e4411c/src/workspace2/logic-simulation/SimulationHost.tsx:211
[golden-origin]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Tests/HassCoreTests/StateGoldenTests.swift:7
[pc-golden]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Tests/HassCoreTests/StateGoldenTests.swift:242
[pc-label-test]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Tests/HassCoreTests/ClimateLogicTests.swift:100
[pc-heat-test]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Tests/HassCoreTests/ClimateLogicTests.swift:319
[effective-away-test]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Tests/HassCoreTests/ClimateLogicTests.swift:107
[contact-tests]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Tests/HassCoreTests/ChipRulesTests.swift:30
[room-unavailable-test]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Tests/HassCoreTests/RoomOverviewTests.swift:42
[room-climate-test]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Tests/HassCoreTests/RoomOverviewTests.swift:167
[room-display]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Rooms/RoomController.swift:171
[room-overview]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Rooms/RoomOverview.swift:28
[room-sections]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Rooms/RoomOverview.swift:75
[room-lights]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Rooms/RoomOverview.swift:235
[room-unavailable]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Rooms/RoomOverview.swift:106
[room-card-summary]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Rooms/RoomOverview.swift:130
[room-climate]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Rooms/RoomOverview.swift:288
[predictive-logic]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Climate/ClimateLogic.swift:374
[predictive-loads]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Climate/ClimateLogic.swift:402
[effective-away]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Climate/ClimateLogic.swift:73
[thermostat-warning]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Climate/ClimateLogic.swift:124
[contact-logic]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Chips/ContactChipState.swift:22
[remote-logic]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/MediaRemote/MediaRemoteController.swift:129
[remote-state]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/MediaRemote/MediaRemoteLogic.swift:5
[chore-counts]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Config/ChoresConfig.swift:232
[grocery-words]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Config/ChoresConfig.swift:270
[todo-visibility]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Config/ChoresConfig.swift:35
[todo-empty]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Config/ChoresConfig.swift:112
[todo-identity]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Todo/TodoItem.swift:46
[todo-due]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Todo/TodoItem.swift:130
[todo-title]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Todo/TodoItem.swift:155
[todo-sort]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Todo/TodoItem.swift:186
[todo-visible]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Todo/TodoListController.swift:114
[todo-optimistic]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Todo/TodoListController.swift:6
[vacuum-outcomes]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Vacuums/VacuumOutcomes.swift:67
[vacuum-parser]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Vacuums/VacuumOutcomes.swift:91
[vacuum-status]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassCore/Vacuums/VacuumStatus.swift:217
[pc-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:7061
[predictive-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:667
[away-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:659
[away-fallback-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:601
[office-windows-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:6941
[alarm-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:9010
[light-office-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:5678
[light-kitchen-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:5693
[light-gym-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:5641
[groceries-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:240
[volume-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:2391
[remote-control-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:2174
[volume-flag]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:2351
[vacuum-config]: /Users/stephenfenton/repos/hass-repos/ha-native-home-repos/native-home/apple/Sources/HassDemoHouse/DemoHouseDocument.swift:9356
