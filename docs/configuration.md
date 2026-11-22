# Configuration

The Studio authors one document: the strict composition contract described in
[native-composition.md](native-composition.md). Its validators live in
`src/shared/composition/`; call `/native/api/validate` rather than treating the
generated JSON Schema (`/native/api/schema`) as the complete validator.

## API

All paths are relative to the Studio origin or its Ingress prefix. Errors are
JSON with `error`; validation failures also include `errors: string[]`. Every
write uses JSON and must be same-origin when a browser sends origin or fetch
metadata. Non-browser callers use bearer authentication in production. Do not put
credentials in URLs or documents.

The composition draft, publication, assets and Home Assistant publishing are the
`/native/api/*` surface; its table is in
[native-composition.md](native-composition.md#authenticated-native-api).
Beside it:

| Method and path | Request | Response |
| --- | --- | --- |
| `POST api/auth` | `{token}` | `{authenticated:true}` and an eight-hour HttpOnly, SameSite=Strict session cookie |
| `GET api/health` | None | `{status,mode,haConnected,draftRevision}`; `draftRevision` is the composition draft's |
| `GET api/native-home` | Authenticated session, bearer or verified admin Ingress | `NativeSnapshot`: `{mode:'live',houseConfig:{schema:2,hash,config},states,currentUser?}`; the house configuration `fenton_home` serves plus the projected states it references. Read-only; feeds the preview |

## House layout import

`POST /native/api/import-house-config` merges the room and chores layout into an
existing composition draft without publishing it. It never replaces a room,
source or sheet the draft already authors. Every added room is compiled as one
transaction with its sources, generated sheets and card actions; a compiler
rejection leaves the room absent and appears in the dropped-field report.

The importer recognizes a room light sheet only where the native room dispatch
is exact and unambiguous: one `rooms.lightGroups` entry has the exact room title,
its group entity equals the light card's entity, the member list is complete,
and no item-modal, personalized title or device-specific card dispatch takes
precedence. The generated sheet uses `home-light@1` and `light-group-tile`
controls, retaining configured member order. As in the compiled app, only a
group with multiple members and a `light` group entity gets a separate
whole-room control. The room card receives a `present` action to the sheet.

Unsupported, ambiguous or incomplete references remain explicit dropped fields.
They do not create a link to a guessed group, an invented entity or a partially
authored sheet. A sheet-id collision with an authored surface rolls the whole
room transaction back rather than overwriting it.

Unknown `/api/*` and `/native/api/*` paths answer `404`. The schema-1 routes
(`api/draft`, `api/validate`, `api/export`, `api/schema`, `api/data/:id`,
`api/read-endpoints`, `api/actions/execute`, `api/feedback`, `api/cameras/*`,
`api/native-wallpaper`) were removed with the 1.0 workspace.

## Storage and recovery

`DATA_DIR` defaults to `./data` locally and `/data/studio` in the packaged app.
It contains `native-v2/` (the composition draft, its immutable published
revisions and stored images) and `.studio.lock`. Writes use same-directory
temporary files, file sync, atomic rename and directory sync; an exclusive
directory lock prevents conflicting writers, and revision conflicts never
silently overwrite.

Files an earlier Studio wrote at the top level (`draft.json`, `published.json`,
`revisions/`, `feedback/`) are not read, validated, migrated or removed; they may
be archived or deleted by hand. A new directory does not create them.

Back up the directory while the app is stopped. Invalid or inconsistent
composition state fails startup without replacing data. After an unclean kill,
inspect `.studio.lock` and confirm its recorded process is no longer running
before removing that one file and restarting. Never remove a lock while another
server is writing. Normal SIGTERM/SIGINT releases it.
