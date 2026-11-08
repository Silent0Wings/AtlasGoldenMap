# HTTP API

Two small servers run on your computer. Both listen on `127.0.0.1` only, and each serves the page that calls it, so this document describes what the pages send and receive.

> **These are local tools, not a stable public API.** The endpoints, fields and status codes follow the code in this repository and can change in any release without notice. If a script depends on them, pin the commit it was written against.

Related pages: [data-formats.md](data-formats.md) describes the files these endpoints read and write. [control-panel.md](control-panel.md) describes the page itself. [architecture.md](architecture.md) shows how the pieces fit together.

## The two servers

| | Control panel | Review server |
|---|---|---|
| Source | [core/control-server.mjs](../core/control-server.mjs) | [core/review-server.mjs](../core/review-server.mjs) |
| Start | `node core/control-server.mjs [--port 8099] [--open]`, or `npm run panel` | `node core/review-server.mjs [--port 8097] [--open]`, or `npm run review` (the CLI starts it with `--open`) |
| Port | `--port`, default 8099. If the port is busy it tries the next ports, 10 in all. If the port already belongs to a control panel, it prints the address and exits with code 0. | `--port`, else `reviewPort` from `shots/meta.json`, else 8097. If the port is busy it exits with an error. |
| Page | `/` (serves `core/control.html`) | `/` (serves `core/review.html`) |
| Does | Runs the CLI jobs (capture, check, approve, and so on) one at a time, reports state, starts and stops the review server | Lists records, approves and denies shots, serves PNG files, runs one Playwright test run |

The control panel uses Node built-ins only, so it starts before `npm install`. The review server imports the store, which needs the npm packages, so it needs `npm install` first.

## Guards

Every request goes through these checks. Each failed check returns the status and message shown, as a JSON error body.

| Guard | Control panel | Review server | Failure |
|---|---|---|---|
| `Host` must be `127.0.0.1:<port>` or `localhost:<port>` | yes, every request | yes, every request | 403 `bad Host header` |
| `Origin` on a POST must be `http://127.0.0.1:<port>` or `http://localhost:<port>` (checked only when an `Origin` header is sent) | yes | no | 403 `bad Origin header` |
| POST body must have `Content-Type` starting with `application/json` | yes | yes | 415 `content-type must be application/json` |
| Body limit of 1 MB | yes | yes | 413 `request body is over 1 MB`, and the connection is closed |
| Body must parse as a JSON object (an empty body counts as `{}`) | yes | yes | 400 `body is not valid JSON` or `body must be a JSON object` |
| Method must match the route | yes | yes | 405 `method not allowed` |
| Path must exist | yes | yes | 404 `not found` |

Why the guards exist:

- The `Host` check stops DNS rebinding: a web page cannot reach these servers under another name.
- The JSON content-type rule matters because a cross-site HTML form cannot send `application/json` without a CORS preflight, and neither server grants one. The review server has no `Origin` check and relies on this rule alone.
- GET requests have no content-type or `Origin` check.

Responses: every JSON response has `Cache-Control: no-store`. An error body is `{"error": "<message>"}`, plus extra fields where noted below (`job`, `badKeys`, `records`).

### Clients never send commands

The control panel never accepts argv or a shell command. A request names an action and gives option values. The server maps the action to a fixed list of `core/cli.mjs` arguments (see the table below), and checks each option against an allowlist and a pattern. An unknown action or option is a 400.

The review server takes no command either. Its only run request accepts a `grep` and a `variant`, each checked against a pattern, and the server builds the `npx playwright test` line itself. The patterns exclude quotes, `%`, `^` and `&`. The control panel applies the same kind of rule to `grep` and `project`, because the CLI runs them through a shell.

## Control panel API

Base address: `http://127.0.0.1:8099` by default.

### `GET /`

Returns `core/control.html` as `text/html`. A missing file returns 404.

### `GET /icon.png`

Returns `assets/icon_transparent.png` as `image/png`. 404 if the file is missing.

### `GET /tooltip.js`

Returns `core/tooltip.js` as `text/javascript`.

### `GET /api/state`

Reports the state of the project. Used by the page to draw its status. Status 200.

| Field | Type | Meaning |
|---|---|---|
| `app` | string | Always `atlas-control`. The panel's own probe uses it to recognise a running panel. |
| `node` | string | Node.js version string, for example `v20.11.0`. |
| `nodeOk` | boolean | `true` when Node is version 18 or newer. |
| `depsInstalled` | boolean | `true` when `node_modules/@playwright/test` exists. |
| `configExists` | boolean | `true` when `atlas.config.ts` exists. |
| `configTitle` | string or null | The first `title:` string in `atlas.config.ts`, or null. |
| `isDemo` | boolean | `true` when the config mentions `examples/demo-site`. |
| `goldens` | number | Count of `.png` files under `goldens/`, nested folders included. |
| `records` | object | Count of record files under `review/records/`: `total`, then one count for each of `new`, `match`, `changed`, `stale`, `unsettled`, `volatile`. |
| `summary` | object or null | Contents of `review/run-summary.json`, or null. See [data-formats.md](data-formats.md#run-summary). |
| `stabilize` | object or null | From `review/stabilize.json`: `generatedAt`, `runs`, `total`, `unstable`. Null when the file is absent. |
| `dashboardExists` | boolean | `dashboard.html` exists. |
| `reportExists` | boolean | `report/index.html` exists. |
| `captureLock` | boolean | `review/.capture.lock` exists. It can be stale, see [data-formats.md](data-formats.md#capture-lock). |
| `job` | object or null | The current job, or the last one. See the job object below. |
| `review` | object | `{ running, port, external }`. `external` is true when the review server runs but this panel did not start it. |
| `variants` | string[] | Variant names from `shots/meta.json`, or an empty list. |

### `GET /api/job?since=<n>`

Returns the job and the output produced after byte offset `since`. Status 200. `since` must be a whole number of 0 or more, else 400 `since must be a whole number`.

```json
{ "job": { "...": "..." }, "output": "text since the offset", "offset": 1234, "truncated": false }
```

- `offset` is the total number of output bytes so far. Pass it back as `since` on the next poll.
- Output is the child's stdout and stderr, in arrival order. ANSI colour codes and carriage returns are removed.
- The panel keeps the last 2 MB of output. `truncated` becomes `true` once older bytes were dropped. A `since` older than the kept bytes returns from the start of what is kept.
- With no job yet: `{ "job": null, "output": "", "offset": 0, "truncated": false }`.

The job object:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | UUID of the job. |
| `action` | string | The action name sent in the request. |
| `label` | string | Human label, for example `Check`. |
| `argv` | string[] | The arguments given to `core/cli.mjs`, for example `["run", "check"]`. |
| `status` | string | `running`, `done` (exit code 0), `failed` (non-zero exit), or `stopped` (after `POST /api/stop`). |
| `exitCode` | number or null | Exit code of the process, null until it exits. |
| `startedAt` | string | ISO time. |
| `endedAt` | string or null | ISO time, null until the process exits. A stop request can return before this is set. |

### `POST /api/run`

Starts one job. Only one job runs at a time.

Request body:

```json
{ "action": "check", "options": { "grep": "home", "project": "light" } }
```

- `action` (string, required): one of the actions in the table below.
- `options` (object, optional): only the keys listed for that action. Anything else is a 400.

Responses:

- 202 `{ "job": <job object> }`: the job started.
- 400 `action is required`, `unknown action "<name>"`, `option "<key>" is not allowed for <action>`, or a value error (see the table).
- 409 `"<label>" is still running`, with `job` in the body. A job is already running.

Actions. "Runs" is the argument list the server builds for `core/cli.mjs`.

| Action | Options | Runs | Side effects |
|---|---|---|---|
| `deps` | none | `deps` | Installs npm packages and Chromium if missing. |
| `setup` | none | `setup` when `atlas.config.ts` exists, otherwise `deps` | Installs npm packages and Chromium. The panel sends `setup` only when a config exists, because the CLI would otherwise wait for keyboard input. |
| `config` | `answers` (object), `replace` (boolean) | `config --answers <json>`, with `--force` when `replace` is `true` | Writes `atlas.config.ts` and keeps a backup. 400 when a config exists and `replace` is not `true`. |
| `atlas` | `grep`, `project` | `run atlas` | Captures, builds `dashboard.html`, opens it. |
| `check` | `grep`, `project` | `run check` | Captures and compares. Changes no goldens. |
| `capture` | `grep`, `project`, `noStabilize` (boolean) | `run capture`, with `--no-stabilize` when `noStabilize` is `true` | Writes `review/` and `shots/`. |
| `stabilize` | `runs` (whole number 2 to 10), `keep`, `all` (booleans), `grep`, `project` | `run stabilize`, with `--runs <n>`, `--keep`, `--all` as given | Writes `review/stabilize.json`. |
| `approve-new` | `force` (boolean) | `run approve-new`, with `--force` when `force` is `true` | Writes goldens for every new shot. |
| `approve-all` | `confirm` (must be `true`), `force` (boolean) | `run approve-all --yes`, with `--force` when `force` is `true` | Writes goldens for every shot that is not `match` or `volatile` (new, changed, stale, unsettled). |
| `clean` | `goldens` (boolean), `confirm` (must be the text `delete goldens` when `goldens` is `true`) | `run clean`, with `--goldens` when `goldens` is `true` | Deletes generated folders, and `goldens/` with `goldens: true`. |
| `build`, `crawl`, `discover`, `open`, `report` | none | `run <action>` | `build` rewrites `dashboard.html`. `crawl` writes `atlas.crawl.json`. `discover` writes `atlas.discovered.txt`. `open` and `report` only open files. |

Option values for `grep` and `project`: text of up to 200 characters, made only of letters, digits, `_`, space, and `: . / @ -`, not starting with `-`. They are passed to Playwright as `-g <grep>` and `--project=<project>` after `--`. `project` is a variant name.

Answers for `config`: `answers` is an object whose keys are `kind`, `title`, `command`, `cwd`, `staticDir`, `port`, `baseURL`, `start`, `themeKey`, `dark`, `mobile`, `crawl`. Any other key is a 400.

- `kind`: `d` (dev server command), `s` (static folder) or `r` (already running).
- `title`, `command`, `cwd`, `staticDir`, `port`, `baseURL`, `start`, `themeKey`: one line of text, up to 500 characters, no line breaks or NUL characters.
- `dark`, `mobile`, `crawl`: booleans.
- A missing answer takes the same default as the CLI prompt.

### `POST /api/stop`

Stops the running job, and everything it started. Request body `{}` (the JSON content type is still required).

- 200 `{ "job": <job object> }`. The status reads `stopped`. `endedAt` is set when the process exits, so poll `GET /api/job` to see it.
- 409 `no job is running`.

### `POST /api/review`

Starts or stops the review server.

Request body: `{ "start": true }` or `{ "start": false }`.

Response, status 200: `{ "review": { "running": true, "port": 8097, "external": false } }`.

- `start: true` starts `core/review-server.mjs` on the review port unless it is already running, and waits until it answers. It returns `external: true` when the server was already running and this panel did not start it.
- `start: false` stops the server if this panel started it. If the server was started elsewhere, it returns 409 `the review server on port <n> was started outside this panel: stop it in its terminal`.
- 400 `start must be true or false`.
- 500 `the review server stopped while starting` if the process exited during start.

### `POST /api/shutdown`

Request body `{}`. Returns 200 `{ "ok": true }`, then the panel exits. Exit stops the running job and the review server if the panel started them.

## Review server API

Base address: `http://127.0.0.1:8097` by default, or the port in `shots/meta.json`.

File paths in requests and responses are relative to the project root and use forward slashes.

### `GET /`

Returns `core/review.html` as `text/html`. 500 if the file is missing.

### `GET /tooltip.js`

Returns `core/tooltip.js` as `text/javascript`.

### `GET /file?p=<path>`

Returns one PNG file as `image/png`. `p` must be inside one of the three review folders: `goldens/`, `review/actual/` or `review/diff/`.

| Status | Body | When |
|---|---|---|
| 200 | PNG bytes | The file exists and is allowed. |
| 400 | `missing p` | `p` is absent, empty, or contains NUL. |
| 403 | `path is outside the review folders` | The resolved path (symlinks included) is outside the three folders. Checked before the extension. |
| 415 | `only PNG files are served` | Not a `.png` file. |
| 404 | `not found` | The file is missing, or is not a regular file. |

### `GET /api/records`

Returns the review data.

```json
{ "records": [ <record>, ... ], "meta": { ... }, "running": false }
```

- `records`: every record in `review/records/`, sorted by `key`. The fields are in [data-formats.md](data-formats.md#record-json).
- `meta`: the contents of `shots/meta.json`, or `{}` when it is missing.
- `running`: `true` when a Playwright run started by this server is still going.

### `POST /api/approve`

Makes the current capture the golden for each key.

Request body:

```json
{ "keys": ["light/home"], "note": "optional text" }
```

- `keys` (array of strings, required, not empty): record keys, which have the form `<variant>/<file>`.
- `note` (string, optional): kept up to 1000 characters.

Responses:

- 200 `{ "records": [ ... ] }`: the records after the approval.
- 400 `keys must be a non-empty array of record keys`.
- 400 `no record or actual PNG for: <keys>. Nothing was changed.`, with `badKeys` listing the failing keys. All keys are checked first, so one bad key changes nothing.
- 400 `note must be a string`.
- 500 with the failure message and `records`: the approval failed partway through. `records` lists the keys already approved before the failure. For example, `actual changed since capture: re-capture <key>` means the shot must be captured again.

### `POST /api/deny`

Rejects the current capture for each key. Same request shape as approve, but `note` is required.

- 200 `{ "records": [ ... ] }`.
- 400 `note is required` when `note` is missing or null. An empty string is accepted.
- 400 `note must be a string`, plus the same key errors and partial-failure 500 as approve.

### `GET /api/run`

Reports the run started from this page.

```json
{ "running": false, "exitCode": 0, "command": "npx playwright test", "startedAt": "2026-01-01T00:00:00.000Z", "log": "last lines" }
```

- `exitCode` is null while a run is going, and before any run.
- `command` is an empty string before any run.
- `log` is the last 200 lines of `review/run.log`, which holds the latest run only.

### `POST /api/run`

Starts `npx playwright test` in the project, with optional filters.

Request body:

```json
{ "grep": "home", "variant": "light" }
```

- `grep` (string, optional): 1 to 200 characters from letters, digits, `_`, space, `. : @ / ( ) | [ ] + * ? -`.
- `variant` (string, optional): 1 to 64 characters from letters, digits, `_` and `-`. It is the Playwright project, so a variant name.
- `null` and `""` count as absent.

Responses:

- 202 `{ "running": true, "command": "npx playwright test --grep \"home\" --project \"light\"" }`.
- 400 `grep has characters that are not allowed` or `variant must be a plain name`.
- 409 `a run is already in progress` (this server).
- 409 `a capture is already running (pid <n>, started <time>)`. The capture lock is held by another process, see [data-formats.md](data-formats.md#capture-lock).

The run holds the capture lock while it goes, and writes its output to `review/run.log`.

### `GET /api/html-diff?key=<key>`

Compares the markup of the last capture with the markup of its golden.

- 200 `{ "available": true, "lines": [ { "op": " ", "text": "..." } ], "truncated": false }`.
  - `op` is `-` (golden only), `+` (capture only) or a space (context). Two lines of context are kept around each change.
  - `available` is `false` when the capture or the golden has no markup file. `lines` is then empty.
  - `truncated` is `true` when more than 400 lines were cut, or the file was too large to diff exactly (in that case every changed line is listed, not a minimal diff).
- 404 `unknown record key` when `key` is absent or names no record.

### `GET /api/summary`

Returns the contents of `review/run-summary.json`, or the JSON value `null` when the file is missing. Status 200 either way.

## Common mistakes

- A POST without `Content-Type: application/json` gets 415 even with a valid body.
- `keys` and `key` are different: POST endpoints take `keys` (an array), `GET /api/html-diff` takes one `key`.
- `POST /api/review` and the review server's `POST /api/run` are separate. The first starts the review server itself, the second starts a Playwright run through a running review server.

## Example requests

Read the state of the control panel:

```sh
curl -s http://127.0.0.1:8099/api/state
```

Start a check with a filter and follow its output:

```sh
curl -s -X POST http://127.0.0.1:8099/api/run -H "Content-Type: application/json" -d "{\"action\":\"check\",\"options\":{\"grep\":\"home\"}}"
curl -s "http://127.0.0.1:8099/api/job?since=0"
```

List the review records:

```sh
curl -s http://127.0.0.1:8097/api/records
```

The POST examples change state (a check writes `review/`, an approval writes goldens). Use them only on a project where that is intended.
