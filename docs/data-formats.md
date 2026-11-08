# Data formats

Every file the atlas writes, what it means, whether it is committed, and which tools read it. Paths are relative to the project root unless stated otherwise. Record paths inside JSON use forward slashes.

This is a reference for developers and tool authors. The field lists follow the code in [core/store.mjs](../core/store.mjs), [core/golden.spec.ts](../core/golden.spec.ts) and [core/run-reporter.ts](../core/run-reporter.ts). The file formats are not a stable public API, and they can change between releases.

Related pages: [http-api.md](http-api.md) for the endpoints that serve these files, [architecture.md](architecture.md) for the pipeline.

`ATLAS_ROOT` (environment variable) moves the store and the capture: goldens, review, and shots are written under it, and the review and control servers read from it. The dashboard build and the crawl and discover outputs always use the project root. Stabilize sets `ATLAS_ROOT` for its scratch runs.

## Committed or generated

| Path | Kind | Git status | Notes |
|---|---|---|---|
| `atlas.config.ts` | your config | committed | Written once by `config` or `init`, then edited by hand. |
| `goldens/` | approved shots | committed in a real project | The demo ignores it. The `.gitignore` comment says to delete that line and commit `goldens/` in your project. |
| `review/` | generated | ignored | Captures, records, run data. |
| `shots/` | generated | ignored | Dashboard inputs. |
| `dashboard.html` | generated | ignored | One offline file. |
| `report/` | generated | ignored | Playwright HTML report. |
| `test-results/` | generated | ignored | Playwright's per-test output. |
| `.stabilize/` | generated scratch | ignored | Removed unless `stabilize --keep`. |
| `atlas.crawl.json` | generated | ignored | Output of `crawl`. |
| `atlas.discovered.txt` | generated | ignored | Output of `discover`. Never read by the atlas. |
| `atlas.config.demo.ts` | committed | tracked | The bundled demo's map. Copy it over `atlas.config.ts` to try the demo. |
| `atlas.config.backup-*.ts` | generated | ignored | Backup of the config when it is replaced. |
| `*.tmp` | temporary | ignored | Left behind only if an atomic write is interrupted. |

## Folder map

```
atlas.config.ts                 your config (committed)
goldens/                        approved shots (committed in a real project)
  denied.json                   denials, keyed by shot key
  <variant>/
    <file>.png                  approved capture
    <file>.meta.json            what was approved, and when
    <file>.html                 approved markup (when it was captured)
review/                         generated, ignored
  actual/<variant>/<file>.png   last capture
  actual/<variant>/<file>.html  last capture's markup
  diff/<variant>/<file>.png     differing pixels in red, same-size shots only
  records/<variant>/<file>.json one review record per shot
  collections/<variant>/<file>.json   item count of each collection node
  .visual-failures/<variant>/<file>.txt   failure carried into a retry
  .capture.lock                 present while a capture runs
  run-summary.json              result of the last Playwright run
  stabilize.json                last stabilize report
  run.log                       output of a run started from the review page
shots/                          generated, ignored
  meta.json                     viewer settings
  nodes/<variant>/<file>.json   one fragment per node and variant
dashboard.html                  built dashboard
report/index.html               Playwright report
test-results/                   Playwright output
.stabilize/run-<i>/             stabilize scratch runs (only with --keep)
atlas.crawl.json                pages found by the crawler
atlas.discovered.txt           navigation candidates (text, never read)
```

## Shot keys and file names

A shot has a **key**, `<variant>/<file>`, for example `light/home`. The key identifies the shot everywhere: record files, `denied.json`, and the `key` and `keys` values in the API.

The **file** name comes from the node id. The rule (`fileOf` in [core/atlas.ts](../core/atlas.ts)) replaces every character in these groups with `-`:

- control characters and space
- `! " # $ % & ' ( ) * + ,`
- `.` and `/`
- `: ; < = > ? @`
- `[`, `\`, `]`, `^`, `_` and the backtick (the underscore is replaced too)
- `{`, `|`, `}`, `~` and DEL

Letters, digits, `-` and non-ASCII characters are kept. Examples:

| Source | Shot file | Key |
|---|---|---|
| page node `home` | `home` | `light/home` |
| component `tabs` of node `settings` | `settings--tabs` | `light/settings--tabs` |
| collection item with prefix `product` and label "Office chair" | `product-office-chair` | `light/product-office-chair` |

Details:

- A component's record id is `<node>/<component>`, but its file adds `--<component>` to the node's file name.
- A collection item's id is `<prefix>:<key>`. The prefix defaults to `<node>:item`. The key is the label slug (lowercase, runs of other characters become `-`, at most 60 characters, `x` when empty), or the 1-based index when `idFromLabel` is false or the label is empty. A repeated key gets `-<n>` added, where `n` is the item's 1-based index.
- Two node ids that map to the same file name, ignoring case, stop the atlas from loading.

## Record JSON

One file per shot: `review/records/<variant>/<file>.json`. Written after every comparison. Read by the review server, the CLI, the panel, and stabilize. The fields are the same whether the shot was checked, captured or stabilized.

| Field | Type | Meaning | Null or empty when |
|---|---|---|---|
| `key` | string | `<variant>/<file>`. | never |
| `variant` | string | Playwright project name, and the golden folder. | never |
| `file` | string | File name without extension. | never |
| `id` | string | Node id. Component: `<node>/<component>`. Item: `<prefix>:<key>`. | never |
| `nodeId` | string | The node the shot belongs to (the page node for components and items). | never |
| `label` | string | Label shown in the review UI. | never |
| `kind` | string | `page`, `state`, `component`, `item`, or a kind from the config. | never |
| `group` | string or null | Group of the node, or of its nearest ancestor that has one. | no group in the chain |
| `tags` | string[] | Tags of the node or item. | `[]` when none |
| `volatile` | boolean | Node is marked volatile. Volatile shots are captured but never compared. | never |
| `actual` | string | `review/actual/<variant>/<file>.png`. | never |
| `approved` | string or null | `goldens/<variant>/<file>.png`. | no golden |
| `diff` | string or null | `review/diff/<variant>/<file>.png`, the differing pixels in red. | no golden, volatile, size change, or no differing pixels |
| `width`, `height` | number | Size of the capture in pixels. | never |
| `approvedWidth`, `approvedHeight` | number or null | Size of the golden. | no golden |
| `diffPixels` | number or null | Number of differing pixels, anti-aliasing ignored by default. `0` when identical. | no golden, volatile, or sizes differ |
| `diffRatio` | number or null | `diffPixels` divided by `width * height`. | same as `diffPixels` |
| `bbox` | object or null | `{ x1, y1, x2, y2 }`, the inclusive box around the differing pixels. | no differing pixels, or sizes differ |
| `threshold` | number | Largest `diffRatio` that still counts as a match. Default `0.0005`. | never |
| `options` | object | `{ pixelThreshold, ignoreAntialiasing, failOnHtml }` used by the comparison. Defaults `0.1`, `true`, `false`. | never |
| `htmlHash` | string or null | SHA-256 of this capture's normalized markup. | markup hashing is off (`review.htmlHash: false`) |
| `approvedHtmlHash` | string or null | `htmlHash` stored in the golden's meta file. | no meta file, or hashing was off when approved |
| `htmlChanged` | boolean | Markup differs from the golden, and `failOnHtml` is false. Informational only. | `false` otherwise |
| `configHash` | string | SHA-256 of the node definition, its ancestors, its fixture, the variant, the global settings and the per-shot settings. | never |
| `approvedConfigHash` | string or null | `configHash` stored in the golden's meta file. | no meta file |
| `actualHash` | string | SHA-256 of the captured PNG bytes. Approvals check it and denials are tied to it. | never |
| `settled` | boolean | `false` when the page kept changing across the stable takes. | never |
| `canvases` | object[] | Visible canvases as `{ x, y, width, height }`, relative to the shot. | `[]` when none |
| `status` | string | See the status table. | never |
| `reasons` | string[] | Why the shot is not a match: `size`, `pixels`, `html`, `config`, `unsettled`. `html` appears only with `failOnHtml`. | `[]` for `new`, `match` and `volatile` |
| `htmlIdentical` | boolean | The golden's markup hash equals this capture's. | `false` when there is no meta file |
| `decision` | string | `pending`, `approved` or `denied`. | never |
| `note` | string | Note of the approval or denial. | `""` when none |
| `capturedAt` | string | ISO time of this capture. | never |
| `decidedAt` | string or null | ISO time of the approval (match) or the denial. | `null` while pending |

### Status

| Status | When | Decision on arrival |
|---|---|---|
| `new` | No golden, and the shot settled. | `pending` |
| `match` | Same size, pixel difference within `threshold`, and no reason left. | `approved` |
| `changed` | A reason other than `config` alone: pixels or size differ, markup differs with `failOnHtml`, or config changed and pixels differ too. | `pending`, or `denied` if a denial matches |
| `stale` | Pixels match, but the config changed since approval. A golden with no meta file is always `stale` or `changed` until it is approved again. | `pending`, or `denied` |
| `unsettled` | The page kept changing across the stable takes. Reason `unsettled`. This applies even with no golden. | `pending`, or `denied` |
| `volatile` | Node is marked volatile. Not compared. | `approved` |

A denial applies only while the capture's `actualHash` and the `configHash` both match the ones stored with the denial. A new capture, or a config change, makes it pending again.

## Goldens

Committed in a real project. Written only by an approval: the review page, `approve-new`, `approve-all`, or `POST /api/approve`. Captures never write goldens.

### `goldens/<variant>/<file>.png`

The exact bytes of the capture at approval time. Read by the comparison (`check`, `capture`), by the review server (`GET /file`), and by the dashboard build when `review/actual/` has no copy.

### `goldens/<variant>/<file>.meta.json`

Written with each approval. Read by the comparison. Example from a real run:

```json
{
  "htmlHash": "53830d79f1bb2612d4a953f3b6e7dc2b8981d84ddb2cf66f65963f61c31d78d7",
  "configHash": "afc08be524bcd69cb38af255d18b8010659197d2b8c0964e4512f003b7d9cf04",
  "width": 1280,
  "height": 2175,
  "approvedAt": "2026-11-08T07:27:21.204Z",
  "note": ""
}
```

| Field | Type | Meaning |
|---|---|---|
| `htmlHash` | string or null | Markup hash at approval. `null` when markup hashing was off. |
| `configHash` | string | Config hash at approval. |
| `width`, `height` | number | Size of the golden. |
| `approvedAt` | string | ISO time of the approval. |
| `note` | string | Note given at approval, `""` when none. |

### `goldens/<variant>/<file>.html`

The markup of the golden, used by the review page's markup diff. For the page it is the body element, for a component or item it is that element. Before saving, the markup is cloned, scripts are removed, masked elements are emptied, `nonce` and any `review.ignoreAttributes` attributes are removed, and whitespace runs are collapsed to one space.

Written by an approval only when the capture had markup. An approval with no markup does not delete an older `.html`, so it can outlive a golden that has no markup of its own.

### `goldens/denied.json`

Denials, keyed by shot key:

```json
{
  "light/home": { "actualHash": "...", "configHash": "...", "note": "why", "at": "2026-11-08T07:30:00.000Z" }
}
```

Written by a denial, and an entry is removed when that key is approved. Read when a shot is compared. Because it lives in `goldens/`, it follows the goldens' commit policy.

## Run summary

`review/run-summary.json`, written by [core/run-reporter.ts](../core/run-reporter.ts) after each Playwright run that uses the reporter: the normal capture, the review page's run, and each stabilize run (into its own scratch copy). Crawl and discover runs do not write it, so it keeps the previous capture's result.

```json
{
  "finishedAt": "2026-11-08T07:29:59.782Z",
  "status": "passed",
  "total": 2,
  "failures": [],
  "flaky": [],
  "warnings": []
}
```

| Field | Type | Meaning |
|---|---|---|
| `finishedAt` | string | ISO time the run ended. |
| `status` | string | Playwright's overall result, for example `passed` or `failed`. |
| `total` | number | Number of tests the run finished. |
| `failures` | object[] | Tests that failed after their retries: `{ id, variant, class, message, retries }`. |
| `flaky` | object[] | Tests that failed and then passed on retry: `{ id, variant, retries, message }`. |
| `warnings` | object[] | `atlas-warning` annotations, one per distinct message per test: `{ id, variant, message }`. |

- `id` is the test title, which is the node id.
- `class` is `visual` when the message says `visual check failed`, `infra` for timeouts, network errors, and a closed browser, and `error` otherwise.
- `message` is the first non-empty line of the error, at most 300 characters.

Read by the CLI summary and by the approval gate: any `failures` entry whose class is not `visual` blocks `approve-new` and `approve-all` unless `--force` is given. Also read by the review page (`GET /api/summary`) and the panel (`summary` in `GET /api/state`).

## Stabilize report

`review/stabilize.json`, written by `stabilize` (and by the first capture, which runs stabilize with two runs when there are no goldens yet). The file is removed at the start of each full capture, but not when `-g` or `--project` limit the run. It is absent until stabilize has run.

Example:

```json
{
  "generatedAt": "2026-11-08T07:40:00.000Z",
  "runs": 3,
  "total": 45,
  "unstable": 1,
  "rows": [
    { "node": "home", "variant": "light", "key": "light/home", "stable": "no", "diffPixels": 812, "bbox": { "x1": 10, "y1": 20, "x2": 300, "y2": 90 }, "cause": "small region: animation or late content" }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `generatedAt` | string | ISO time of the report. |
| `runs` | number | Number of capture runs compared. |
| `total` | number | Shots compared, plus error rows. |
| `unstable` | number | Length of `rows`. |
| `rows` | object[] | Only the shots that are not stable (see below). |

Row fields: `node`, `variant`, `key` (null for error rows), `stable` (`no` or `error`), `diffPixels` (number or null), `bbox` (object or null), `cause` (text).

- `stable: "no"` covers shots missing from some runs, shots that never settled, markup that differs between runs (with `failOnHtml`), and pixel or size differences above the threshold.
- `stable: "error"` is a non-visual test failure seen in a stabilize run. `key` is null, and `cause` is the failure message.
- Rows never contain `stable: "yes"`. The types in [core/store.d.mts](../core/store.d.mts) list `"yes"` and a string `key`, which does not match what the code writes.

Read by the approval gate (`approve-new` is refused while `unstable` is above 0, unless `--force`) and by the panel (`stabilize` in `GET /api/state`).

## Collections

`review/collections/<variant>/<file>.json`, one per collection node (the node's file name, not each item's):

```json
{ "count": 5, "at": "2026-11-08T07:20:12.230Z" }
```

Written on every run, with the number of items captured and the time. Read at the next run: when the count differs, the run adds a warning (`collection "<selector>" gave N items, M last run: the page may not have been ready`).

## Visual failures

`review/.visual-failures/<variant>/<file>.txt`, plain text, one line per open record:

```
light/home: changed (pixels) pending
```

Written when a node's first attempt has at least one open shot (any status other than `match` or `volatile`, so new shots count too). The retry reads the file and fails at once with the same text, so a retry cannot pass on a lucky capture. The file is cleared at the start of each node's first attempt, so a clean run removes it. Not written by stabilize runs.

## Capture lock

`review/.capture.lock`, a single JSON line:

```json
{"pid":12345,"startedAt":"2026-11-08T07:29:00.000Z"}
```

Written by the CLI for `capture`, `check`, `atlas` and `stabilize`, and by the review page's run, for as long as they go. Removed on exit by the process that wrote it. A lock whose `pid` is no longer running is stale: the next run replaces it. The panel's `captureLock` field only checks that the file exists, so it can report a stale lock.

## Shot fragments and `shots/meta.json`

### `shots/meta.json`

Written at the start of each capture by [core/golden.spec.ts](../core/golden.spec.ts), atomically. Read by the dashboard build, the review server (`reviewPort`), and the panel (`variants`, `reviewPort`).

```json
{
  "title": "My app",
  "root": "home",
  "groups": {},
  "labels": {},
  "variants": [
    { "name": "light", "label": "Light", "colorScheme": "light" },
    { "name": "dark", "label": "Dark", "colorScheme": "dark" }
  ],
  "reviewPort": 8097
}
```

| Field | Type | Meaning |
|---|---|---|
| `title` | string | `title` from the config. |
| `root` | string | Config `root`, or the first node without a parent. |
| `groups` | object | Config `groups`, the viewer's group names. |
| `labels` | object | Config `labels`, the viewer's wording. |
| `variants` | object[] | `{ name, label, colorScheme }`. `label` defaults to `name`, `colorScheme` may be `null`. |
| `reviewPort` | number | Config `review.port`, default 8097. |

### `shots/nodes/<variant>/<file>.json`

One fragment per node and variant. The file is an array: the first entry is the page, and the rest are collection items. Written during the capture. Read by the dashboard build, which merges fragments of all variants by `id`. Removed at the start of each full capture.

| Field | Page entry | Item entry | Meaning |
|---|---|---|---|
| `id` | yes | yes | Node id, or item id. |
| `label` | yes | yes | Label. |
| `kind` | yes | yes | Kind. |
| `parent` | `null` or node id | node id | Parent node. |
| `group` | yes | yes | Group, or `null`. |
| `tags` | yes | yes | Tags. |
| `url` | root URL | `null` | URL of the chain's root node, the page the steps start from. |
| `volatile` | yes | no | Volatile flag. |
| `steps` | yes | no | Ids of the steps after the chain root (`[]` for a page reached by URL). |
| `text` | yes | no | Document title and heading texts, joined by ` · `, at most 600 characters. |
| `errors` | yes | no | Page error messages seen during the test. |
| `img` | yes | yes | File name of the page's or item's capture, for example `home.png`. |
| `selector` | no | yes | Locator used, `<collection selector> >> nth=<i>`. |
| `status` | yes | yes | Record status of the shot. |
| `components` | yes | `[]` | `{ id, label, selector, img, status }` for each visible component. |

The fragment is not written if the test throws before the capture finishes, so the dashboard has no data for that node in that variant.

## Crawl and discover outputs

### `atlas.crawl.json`

Written by `crawl` (`npm run crawl`). An array of nodes, read at load time by `loadNodes` in [core/atlas.ts](../core/atlas.ts). Pages whose URL a hand-written node already covers are skipped, and so are ids that already exist. Shape:

```json
[
  { "id": "page:about", "label": "About", "kind": "page", "url": "/about", "parentUrl": "/", "ready": "body", "tags": ["crawled", "/about"] }
]
```

- `id` is `page:` plus the slug of the URL path, `home` for `/`. A repeat gets `-` appended.
- `url` is relative to `baseURL`. Query strings are kept unless `crawl.ignoreQuery` is set.
- `parentUrl` is missing for the start pages. It links the page to the page it was found on.

Removed before each crawl, by `clean`, and by `init`.

### `atlas.discovered.txt`

Written by `discover` (`npm run discover`). Text only: a header with the start URL and date, then one commented-out node literal per candidate:

```
// { id: 'home:settings', label: 'Settings', kind: 'state', parent: 'home', steps: click('#settings'), ready: 'body' },
```

The atlas never reads this file. Copy the lines you want into `atlas.config.ts`. Removed before each discover and by `clean`.

## Other generated files

| Path | Written by | Notes |
|---|---|---|
| `dashboard.html` | `build` (the `atlas` mode also builds it) | One offline file: inlined libraries, the data as JSON, and WebP images. Inputs: `shots/meta.json`, `shots/nodes/`, `review/actual/`, `goldens/`, the icon, and the template. |
| `report/` | Playwright's HTML reporter | Every run except stabilize runs. |
| `test-results/` | Playwright | Per-test output of the run. |
| `review/run.log` | Review server, for a run started from the review page | Holds the latest run only. Replaced at each start. |
| `atlas.config.backup-<time>.ts` | `config` (when it replaces a config), `init` (when it moves one aside) | Old config. Not read. |
| `.stabilize/run-<i>/` | `stabilize` | Scratch copies of `review/` and `shots/`, with their own `test-results/`. Removed unless `--keep`. |

## Who reads and writes what

| File | Written by | Read by |
|---|---|---|
| `goldens/<v>/<f>.png` | `approve` (review page, `approve-new`, `approve-all`) | comparison (`check`, `capture`), review `GET /file`, dashboard build |
| `goldens/<v>/<f>.meta.json` | `approve` | comparison |
| `goldens/<v>/<f>.html` | `approve` | review `GET /api/html-diff` |
| `goldens/denied.json` | `deny`; `approve` removes an entry | comparison, `deny`, `approve` |
| `review/actual/<v>/<f>.png` and `.html` | comparison (each capture) | review `GET /file`, `approve`, dashboard build, stabilize (its own scratch copies) |
| `review/diff/<v>/<f>.png` | comparison (same-size shots with differing pixels) | review `GET /file` |
| `review/records/<v>/<f>.json` | comparison | review `GET /api/records`, panel state, CLI `check`, `approve-*`, stabilize |
| `review/collections/<v>/<f>.json` | golden test, each run | golden test (warning) |
| `review/.visual-failures/<v>/<f>.txt` | golden test, on a visual failure | golden test, on a retry |
| `review/.capture.lock` | CLI capture modes, review page run | CLI, review server, panel (existence only) |
| `review/run-summary.json` | run reporter, after each run | CLI summary and gate, review `GET /api/summary`, panel state, stabilize |
| `review/stabilize.json` | stabilize | CLI `approve-new` gate, panel state |
| `review/run.log` | review server | review `GET /api/run` |
| `shots/meta.json` | golden test, each capture | dashboard build, review server (`reviewPort`), panel (`variants`, `reviewPort`) |
| `shots/nodes/<v>/<f>.json` | golden test | dashboard build |
| `atlas.crawl.json` | `crawl` | atlas loader (`loadNodes`) |
| `atlas.discovered.txt` | `discover` | nobody (read by a person) |
| `dashboard.html` | dashboard build | panel (exists), `open` |
| `atlas.config.ts` | `config`, `init`, a person | golden test, `crawl`, `discover`, the panel |
