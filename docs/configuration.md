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

Authenticated `GET api/live/states` streams `snapshot`, `update` and connection `status` events; per draft revision, literal `ha-entity` sources also receive HA attributes explicitly read as `['attributes', name]` in a separate `attributes` map (dynamic entity-id operands are skipped). Reads follow compiler source scoping, including component-owned entity sources and flows that shadow global ids.

Custom attributes are forwarded only because the owner's own draft reads them
by name. The allowlist is defense in depth and cannot recognise every secret
format: owners must not read attributes that hold secrets. The requested name
must exactly match an own HA key; both must match `^[a-z0-9_]{1,64}$` (plain
lowercase ASCII, no decoding or case normalization). Names are refused when
their underscore-free form contains
`token`, `secret`, `password`, `passwd`, `credential`, `apikey`, `webhook`,
`bearer`, `session`, `cookie`, `signature`, `privatekey` or `pushurl`, or ends
with `auth`, `authorization` or `sig`; `access_token` and `entity_picture` are
refused.

A value must be a finite number with absolute value at most `1e15`, boolean,
null, string, or flat array of at most 32 such scalars. Objects, nested arrays
and non-JSON values are refused. Each string is limited to 256 UTF-16 code units,
must be unchanged by `normalize('NFKC')`, and permits only printable ASCII,
Unicode letters/numbers and space separators, plus common typographic dashes
(U+2010-U+2015), quotes (U+2018-U+201F) and ellipsis (U+2026). Strings are refused
if they contain `//` (including `://`), `?`, `%`, `=`, `@`, `{`, `[`, a backslash,
a control or format character (`\p{Cc}`/`\p{Cf}`), any fullwidth form
(U+FF00-U+FFEF), the word `bearer` (case-insensitive), a `data:` prefix after trimming leading
whitespace (case-insensitive), or a run of 24 or more Unicode letters/numbers
or `+`, `/`, `_`, `-` characters without whitespace. NFKC-changing characters,
including compatibility letters/digits, non-breaking spaces and ellipses, are
refused even when their character category is otherwise permitted.

Both initial snapshots and later updates check the live session's configured
HA, Supervisor and Studio auth credentials without logging them. For each
credential at least 8 UTF-16 code units long, define
`canon(t) = t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')`.
Concatenate the candidate's string items and `String(number)` items in order
(ignoring booleans and null), then apply `canon`. Refuse the entire attribute
if that result contains any 12-character window of `canon(credential)`, or the
whole canonical credential when it is shorter than 12 characters. If any array
item fails the type, size or string rules, the whole attribute is also dropped.
The conservative fragment check can also refuse unrelated values sharing a
window.
These checks enforce that the Studio's own configured credentials do not reach
the browser in compatibility-Unicode, space-/punctuation-separated, flat-array
or large-number representations covered above; they are not a guarantee for
arbitrary secrets. The existing exact configured-credential scrubber still
drops matching states, and known projected fields take precedence. This custom
attribute allowlist does not change native-house/configuration validation.

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
