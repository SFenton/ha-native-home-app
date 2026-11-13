# Registered read endpoints

Studio can read an administrator-registered JSON service or a fixed Home
Assistant entity/read endpoint. Documents contain **registration IDs**, never
upstream URLs, headers, credentials, or executable code. This is a Studio
capability only: the unchanged native iOS app does not consume these new fields.
Browser previews are not proof of native delivery or live-device behavior.

## Administrator setup

Put a UTF-8 JSON array in a regular file in storage already mounted into the
server, for example `/data/read-endpoints.json` in an existing container `/data`
mount. Do not put credentials in the file or in documents. Keep file ownership
and permissions restricted to the administrator and server process.

```json
[
  {
    "id": "room-temperature",
    "name": "Room temperature",
    "kind": "home-assistant",
    "path": "/api/states/sensor.room_temperature",
    "response": {
      "shape": "object",
      "fields": {
        "value": "state",
        "title": "attributes.friendly_name",
        "unit": "attributes.unit_of_measurement"
      }
    }
  },
  {
    "id": "catalog-search",
    "name": "Household catalog",
    "kind": "http",
    "url": "http://192.168.1.50:8080/catalog",
    "queryParam": "term",
    "bearerTokenEnv": "CATALOG_BEARER",
    "response": {
      "shape": "array",
      "path": "results",
      "fields": {
        "id": "id",
        "title": "name",
        "available": "in_stock"
      }
    }
  }
]
```

Set `STUDIO_READ_ENDPOINTS_FILE=/data/read-endpoints.json` in the server's
environment and restart Studio. Supply any referenced external bearer credential
through its named server environment variable (for example `CATALOG_BEARER`),
using your deployment's secret management. Do not paste credentials into shell
history, source, logs, or browser fields. This environment setup works for
standalone/container deployments and administrator-managed add-on environments;
there is currently no add-on `read_endpoints_file` options-form field. No new
mount is required or created.

Set `STUDIO_AUTH_TOKEN` using the existing authoring-token configuration (at
least 24 characters), or use verified Supervisor Ingress. This requirement also
applies in development whenever the registry is nonempty. An external-only
registry does not require an HA connection. HA registrations use only the
existing `HA_URL` plus `HA_TOKEN` connection, or Supervisor Core when configured.
These credentials are never forwarded to an external registration.

An omitted/empty file environment setting registers nothing. A specified file
must be an absolute path, regular, nonsymlinked, readable, valid JSON, and at most
256 KiB. Invalid files or definitions refuse startup without printing their
contents, filesystem path, or environment values. Configuration is loaded once
at startup; file changes require a restart.

## Definition rules

The array accepts at most 64 unique IDs. IDs use the document ID rules: 1-80
letters, digits, dots, underscores or hyphens, beginning with a letter or digit;
reserved prototype keys are forbidden. Names contain 1-240 trimmed characters.
Unknown definition fields are errors; arbitrary request headers, methods,
templates, interpolation, and embedded credentials are unsupported.

For `home-assistant`, `path` must be a fixed relative `/api/...` path.
Traversal, repeated/encoded separators, percent escapes, query strings,
fragments, backslashes, and protected auth, services, config, WebSocket,
stream/camera-proxy/HLS, Supervisor and webhook paths are refused. This is not a
general path proxy. Registration grants this exact GET read, not related reads
or service writes.

For `http`, `url` must be a fixed absolute HTTP(S) URL without userinfo, query
strings, or fragments. Redirects are rejected. Administrators are responsible
for selecting a trusted host and DNS/network boundary. Ordinary trusted LAN
HTTP is supported, but carries requests, queries, returned data, and any
external bearer credential without transport encryption; use HTTPS where
possible, especially beyond a controlled LAN.

`bearerTokenEnv` is supported only for external HTTP registrations. It must name
a nonempty, bounded, header-safe environment value. Reserved HA, Supervisor,
Studio and authoring credential variable names are refused, as are values
containing known HA/Supervisor/Studio credentials or their supported encodings.
Credentials are resolved server-side, not exposed by registry discovery.

`queryParam`, when provided, names exactly one upstream search parameter.
Queries are encoded with `URLSearchParams`, never substituted into a URL/path.
All URL query data must use this declared parameter; fixed URL queries are not
accepted. Without it, providing `q`, even empty, is an error.

`response.shape` is `object` or `array`. Optional `response.path` selects a
payload subtree first. Each `fields` entry maps an output key to a dot-separated
path relative to the selected object, or relative to each selected array record.
Paths use letters, digits, underscores and hyphens, separated by dots; numeric
array indexes are allowed. Paths are at most 500 characters/32 segments.
Prototype and sensitive credential-related names are forbidden in paths and
output keys. Output keys are 1-80 letters/digits/underscores/hyphens, without
dots. There must be 1-100 mappings.

Only declared fields are returned. Values must be strings (at most 16,384
characters), finite numbers, booleans, or null. Missing fields, nonprimitive
values, wrong shapes, records exceeding 100 own keys, and arrays exceeding 100
records fail explicitly rather than being repaired or truncated. The upstream
JSON response and the projected output are each capped at 1 MiB. Configured
credentials in projected output are rejected, including URI/form encodings,
repeated percent encoding, base64,
base64url, hex, JSON and common HTML escaping. Unmapped upstream fields and
response headers are never sent to the browser. The registry cannot recognize
every possible secret: administrators must still project only safe data.

## Authoring API

Requests use the existing author bearer token, author session, or verified
Ingress. An unverified Ingress header alone is not authentication.

`GET api/read-endpoints` returns only safe metadata:

```json
[
  {
    "id": "catalog-search",
    "name": "Household catalog",
    "kind": "http",
    "searchable": true
  }
]
```

The response contains no URL, HA path, query parameter name, response mappings,
header names, token values, or environment references. An empty registry returns
`[]`. Discovery accepts GET only and no query fields.

Save a data source through the ordinary draft API before reading it:

```json
{
  "id": "household-results",
  "name": "Household results",
  "kind": "endpoint",
  "endpoint": "catalog-search",
  "queryVariable": "catalogQuery",
  "refreshSeconds": 30,
  "sample": []
}
```

`queryVariable` is an optional document variable name used by Studio's preview;
it is not sent to or interpreted by the upstream server. Declare the variable
in the document. Save and publish remain distinct operations.

`GET api/data/household-results?q=tea%20%26%20coffee` looks up the **saved draft
source ID**, then its registered `endpoint` ID. It never uses an unsaved browser
source or browser-supplied URL. `q` is an optional string of at most 500
characters; duplicate fields, structured values, and all unknown query fields
are rejected. Queries containing configured credentials are rejected. Without
`q`, no upstream query parameter is added.

Successful registered reads always return the existing envelope:

```json
{
  "data": [
    { "id": "tea", "title": "Tea", "available": true }
  ],
  "mode": "live"
}
```

Object registrations return an object in `data`. Only GET is supported. Requests
have an eight-second total deadline and are aborted when the caller disconnects
or Studio shuts down. Safe `{ "error": "..." }` responses use 400 for invalid
queries, 401 for missing authentication, 404 for unknown saved sources or
registration IDs, 405 for unsupported discovery/endpoint read methods, 502 for
upstream/projection failures, 503 for empty/unconfigured registries or cancelled
reads, and 504 for timeouts. Errors never include upstream bodies, URLs, headers,
or credentials. There is no sample fallback for registered reads; static,
native-home, and ha-state sources retain their existing behavior.

App-owned request paths above are relative to the Studio base path so they also
work through Ingress. They do not expose an unauthenticated public data API.
