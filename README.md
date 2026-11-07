<p align="center"><img src="assets/banner.png" alt="Golden Map Atlas"></p>

# Golden Map Atlas

Golden Map Atlas works with any web app. Playwright drives the running app and captures every page, in-page state and sub-component, once per **variant** (light and dark themes, a mobile viewport, a locale, and so on). Each capture is compared with an approved **golden** image. A person reviews every change in a small review UI, and only an approval writes a new golden. The tool also builds one offline `dashboard.html` that shows the whole UI as a searchable graph of how screens connect. The only project-specific file is `atlas.config.ts`.

---

## Quick start

**Windows**

```bat
script\setup.bat             :: installs npm packages and Chromium, creates atlas.config.ts if missing
script\run.bat capture       :: first run: captures every screen into review/actual (no goldens yet)
script\run.bat approve-new   :: accepts those first captures as the goldens
script\run.bat atlas         :: later runs: captures again, builds dashboard.html and opens it
script\run.bat review        :: opens the review UI, where each change is approved or denied
```

**macOS / Linux**

```sh
./script/setup.sh
./script/run.sh capture
./script/run.sh approve-new
./script/run.sh atlas
```

**npm** (equivalent)

```sh
npm run setup
npm run capture
npm run approve-new
npm run atlas
```

The first run has no goldens, so every screen shows as `new`. Approve them once with `approve-new` (or one by one in the review UI), and from then on each run compares against them. Double-clicking a `.bat` file works too; the window stays open at the end so you can read the output.

### Requirements

- **Node.js 18+** (`node -v`).
- Internet access on the first run, for `npm install` and the Playwright Chromium download.
- No Python needed. The bundled static server is written in Node.

If a `.sh` wrapper reports "permission denied", run `chmod +x script/*.sh` once, or invoke it as `sh ./script/run.sh atlas`.

---

## Scripts

| Command | Windows | macOS / Linux | npm | What it does |
|---|---|---|---|---|
| setup | `script\setup.bat` | `./script/setup.sh` | `npm run setup` | Runs `deps`, then `config` if `atlas.config.ts` does not exist |
| deps | `script\deps.bat` | `./script/deps.sh` | `npm run deps` | `npm install` (if needed) and `playwright install chromium` |
| config | `script\config.bat` | `./script/config.sh` | `npm run config` | Interactive generator for `atlas.config.ts`; keeps a timestamped backup of the old file. `--force` skips the overwrite question |
| run | `script\run.bat [mode]` | `./script/run.sh [mode]` | `npm run <mode>` | Runs a mode. Without a mode it shows a menu |

### Run modes

| Mode | npm | What it does |
|---|---|---|
| `atlas` | `npm run atlas` | Capture into `review/actual` (goldens are not changed), build `dashboard.html`, open it |
| `capture` | `npm run capture` | Capture and write the records only. No goldens change |
| `check` | `npm run check` | Capture, then exit 1 unless every record is `match` or `volatile`. Prints the keys that need review. No goldens change |
| `review` | `npm run review` | Start the review server, open the review UI in the browser and keep running until Ctrl+C |
| `approve-new` | `npm run approve-new` | Approve every record with status `new`. Use it after the first capture. Prints how many it approved |
| `approve-all` | `npm run approve-all` | Approve every record that is not `match`, after you type `yes`. `--yes` skips the prompt |
| `build` | `npm run build` | Rebuild `dashboard.html` from the existing screenshots, then open it |
| `crawl` | `npm run crawl` | Follow links from `crawl.start` and write `atlas.crawl.json` (see [Config reference](#config-reference)) |
| `open` | `npm run open` | Open the last built `dashboard.html` |
| `report` | `npm run report` | Open the last Playwright HTML report |
| `clean` | `npm run clean` | Delete `review/`, `shots/`, `report/`, `test-results/`, `dashboard.html` and `atlas.crawl.json`. Goldens are kept |
| `clean --goldens` | `npm run clean -- --goldens` | The same, and also delete `goldens/` |

Only `approve-new`, `approve-all`, the **Approve** and **Deny** buttons in the review UI, and `clean --goldens` change what is approved or removed. Commit the goldens before you run `clean --goldens` if you want to keep them.

**Extra options**

- Arguments after `--` go to Playwright, for example `script\run.bat check -- --grep "Home"` or `./script/run.sh atlas -- --project=dark`.
- `build` accepts dashboard options (`--thumb`, `--full`, `--q`, `--out`), and so does `atlas` because it builds too: `./script/run.sh build --full 1400 --q 0.8`. Defaults: `--thumb 320 --full 1000 --q 0.72 --out dashboard.html`.

---

## Using it in your own project

1. **Copy the folder into your repository**, for example to `<your-repo>/tools/atlas`. The folder can have any name. The tool keeps its own `package.json` and `node_modules`, so your app's dependencies are untouched.
2. **Run `setup`** (`script\setup.bat` or `./script/setup.sh`). It installs the tool and asks a few questions to create `atlas.config.ts`. You can also run `config` at any time.
3. **Write your nodes** in `atlas.config.ts`. Start with one `page` node per screen, then add `state` nodes for modals, tabs and other interactions, `components` for regions you want to see on their own, and `collection` for repeated items such as cards or rows.
4. **Choose how the app is served.** Set `server` in the config, or leave it out.

   | Option | Config | When to use it |
   |---|---|---|
   | Dev server | `server: { command: 'npm run dev', cwd: '..' }` | Playwright starts the command and waits for `baseURL`. Reuses a server that is already running |
   | Static folder | `server: { staticDir: '../dist' }` | You have a built site. The bundled no-cache server serves it on the port from `baseURL` |
   | Already running | no `server` | You start the app yourself. It must answer at `baseURL` |

   The static server has no SPA fallback. Every URL you list must exist as a file in the folder.

5. **Run `capture`, then `approve-new`** to accept the first set of goldens. Then run `atlas` and review the dashboard.
6. **Commit the goldens.** The project's `.gitignore` ignores `goldens/` only because the bundled demo owns those files. In your repository, remove the `goldens/` line. Commit `goldens/` (the `.png` files, the `*.meta.json` files and `denied.json`) together with `atlas.config.ts`. Keep `review/`, `shots/`, `dashboard.html`, `report/` and `test-results/` ignored. Decide whether to commit `atlas.crawl.json`: it is generated by `crawl`, and CI needs it if you want the crawled pages in the comparison.

---

## Architecture

```
atlas.config.ts ──► golden.spec.ts ──► review/actual/<variant>/*.png    (latest capture, ignored)
  (your app)        (Playwright)   ├──► review/diff/<variant>/*.png      (pixel diff, ignored)
                                   ├──► review/records/<variant>/*.json  (status, reasons, decision)
                                   └──► shots/nodes/*.json, shots/meta.json

goldens/<variant>/*.png + *.meta.json ◄── store.mjs ◄── review-server.mjs ◄── review.html
goldens/denied.json                   ◄──┘   (approve / deny: the only writers of goldens)

build-dashboard.mjs  ◄── shots/, review/actual/, goldens/   ──►  dashboard.html
template.html  ─────────────────────────────────────────────►  dashboard.html   (one offline file: libs, data, WebP inlined)
```

Optional discovery: `crawl.spec.ts` writes `atlas.crawl.json`. `loadNodes()` in `core/atlas.ts` adds every crawled page that no hand-written node already covers.

### Files

| File | Role |
|---|---|
| `atlas.config.ts` | **The only project-specific file.** Nodes, variants, server, fixtures, masks, groups |
| `core/atlas.ts` | Public API: config types, `defineAtlas`, step helpers, node resolution |
| `core/golden.spec.ts` | One Playwright test per node per variant: full page, components, collection items. Captures each shot stably, compares it with its golden and writes a record. The test fails on any status other than `match` or `volatile` |
| `core/store.mjs` | Shared storage for the review workflow, used by the spec, the server and the CLI. Compares images, evaluates statuses, writes records, and approves or denies. The only module that writes `goldens/` |
| `core/review-server.mjs` | Local review server (`127.0.0.1`, zero dependencies). Serves the review UI, the records and the images, and runs captures from the UI |
| `core/review.html` | The review UI: queue, side-by-side / slider / overlay / diff views, approve and deny |
| `core/crawl.spec.ts` | Optional breadth-first link crawler (`crawl` mode) |
| `core/build-dashboard.mjs` | Merges the records, takes each image from `review/actual/` (or `goldens/`), converts screenshots to WebP through headless Chromium, inlines the libraries and writes `dashboard.html` |
| `core/template.html` | The dashboard UI (graph, search, details panel, status) |
| `core/serve.mjs` | Zero-dependency static server with `no-cache` headers, used for `staticDir` |
| `core/cli.mjs` | Command dispatcher behind every wrapper and npm script |
| `playwright.config.ts` | Generic. One project per variant, all settings read from `atlas.config.ts` |
| `script/setup.*`, `deps.*`, `config.*`, `run.*` | Thin `.bat` (Windows) and `.sh` (macOS / Linux) wrappers around `core/cli.mjs` |
| `assets/` | `banner.png`, `icon_blue.png`, `icon_transparent.png`. The dashboard inlines `icon_transparent.png` as its favicon and logo |

### Folder layout

```
<atlas folder>/
├── atlas.config.ts          your app's map (the only file you edit)
├── core/                    generic engine, do not edit per project
├── examples/
│   ├── demo-site/           a small static site used by the root config
│   └── quiz-arch/           a real-world port of the config
├── assets/
├── package.json · tsconfig.json · playwright.config.ts
├── script/                 setup.* · deps.* · config.* · run.* (.bat + .sh)
│
│  reviewed baselines (commit them in your project):
├── goldens/<variant>/*.png        approved images
├── goldens/<variant>/*.meta.json  approval metadata: hashes, size, approvedAt, note
├── goldens/denied.json            denied captures, with the note
│
│  generated (ignored by default):
├── review/                  actual/, diff/, records/, run.log
├── shots/                   nodes/<variant>/*.json, meta.json, intermediate records
├── dashboard.html
├── report/                  Playwright HTML report
├── test-results/
└── atlas.crawl.json
```

---

## Config reference

Everything is set in `atlas.config.ts` with `defineAtlas({ ... })`. Only `title`, `baseURL`, `variants` and `nodes` are required.

### AtlasConfig

| Field | Type | Default | Purpose |
|---|---|---|---|
| `title` | `string` | required | Shown in the dashboard header and tab title |
| `baseURL` | `string` | required | Where the app is served. Node `url`s are relative to it |
| `server` | `Server` | none | How to serve the app (see below) |
| `variants` | `Variant[]` | required | The variants to capture. Each becomes a Playwright project |
| `nodes` | `UINode[]` or `() => UINode[] \| Promise<UINode[]>` | required | The map. A function lets you generate nodes from your data |
| `root` | `string` | first node without a `parent` | Root node of the graph |
| `fixtures` | `Record<string, Fixture>` | none | Named storage or cookie setups that nodes opt into with `fixture` |
| `mask` | `string[]` | `[]` | Selectors masked in every screenshot (clocks, avatars, counters) |
| `freezeCss` | `string` | none | Extra CSS injected before each shot (hide overlays, confetti canvases) |
| `clock` | `string` or `false` | `'2026-01-01T12:00:00Z'` | Fixed time for `Date` and timers. `false` keeps real time |
| `seedRandom` | `boolean` | `true` | Deterministic `Math.random` |
| `textSelectors` | `string[]` | `h1, h2, h3, [role=heading]` | Elements whose visible text is indexed for search |
| `settle` | `(page) => Promise<void>` | none | Extra wait after `ready`, for charts, MathJax and similar |
| `groups` | `Record<string, string>` | none | Labels for the group filter, e.g. `{ billing: 'Billing' }` |
| `labels` | `{ item?, items? }` | `item` / `items` | Wording for collection items in the viewer |
| `crawl` | `Crawl` | none | Enables `crawl` mode |
| `workers` | `number` | 50% of CPUs | Parallel Playwright workers |
| `timeout` | `number` | `60000` | Default per-test timeout in ms |
| `actionTimeout` | `number` | `15000` | Timeout for each Playwright action. A renamed selector fails fast |
| | `review` | `ReviewOptions` | `{}` | Comparison thresholds, review server port and the markup signal. See [Review options](#review-options) |

### UINode

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | Unique. Used for deep links and the golden file name. Non-alphanumeric characters become `-` |
| `label` | `string` | Shown in the graph |
| `kind` | `'page' \| 'state' \| 'item' \| 'component' \| string` | Colour and grouping in the viewer. Any other string is allowed |
| `parent` | `string` | Parent node id. Draws the edge. Can also point at a collection item's id |
| `group` | `string` | Feature or section. Inherited by descendants |
| `tags` | `string[]` | Extra search terms |
| `url` | `string` | Makes this node a chain root: opened directly, relative to `baseURL` |
| `steps` | `Step` | Replayed after the parent is ready to reach this node |
| `ready` | `string` | Selector that must be visible before the shot (default `body`) |
| `fixture` | `string` | Fixture applied before the chain root loads. Put it on the node with `url` |
| `volatile` | `boolean` | Captured for the atlas but never compared (canvas, video, maps) |
| `hashInput` | `string` | Extra text mixed into the config hash, for example the contents of a case file. Changing it makes the shot `changed` with reason `config` |
| `mask` | `string[]` | Extra masks for this node only |
| `components` | `Component[]` | Sub-regions captured as their own child nodes, when visible |
| `collection` | `Collection` | One child node per matching element |
| `timeout` | `number` | Per-node test timeout in ms |

### Variant

| Field | Purpose |
|---|---|
| `name` | Playwright project name and folder: `goldens/<name>/`. Required |
| `label` | Label in the viewer's variant switcher |
| `colorScheme` | `'light' \| 'dark'`, emulated `prefers-color-scheme`. Also sets the viewer's own theme when this variant is shown |
| `viewport` | `{ width, height }` |
| `deviceScaleFactor` | Pixel ratio |
| `isMobile`, `hasTouch` | Mobile emulation |
| `locale`, `timezoneId` | Overrides the defaults `en-US` and `UTC` |
| `localStorage` | Entries set before the app loads, e.g. a theme key |
| `htmlAttributes` | Attributes set on `<html>` as soon as it exists, e.g. `{ class: 'dark' }` |
| `prepare` | `(page) => Promise<void>` for anything else: cookies, `page.route()` mocks, init scripts |

### Fixture

| Field | Purpose |
|---|---|
| `localStorage` / `sessionStorage` | Entries set before the app loads |
| `cookies` | Passed to `context.addCookies()` |
| `prepare` | `(page) => Promise<void>` |

### Server

| Form | Fields |
|---|---|
| Dev command | `{ command, url?, cwd?, timeout?, reuseExisting? }`. `cwd` is relative to the atlas folder. `reuseExisting` defaults to `true` |
| Static folder | `{ staticDir, port?, url? }`. `staticDir` is relative to the atlas folder. `port` defaults to the port in `baseURL` |

### Crawl

| Field | Default | Purpose |
|---|---|---|
| `start` | required | Start paths, relative to `baseURL` |
| `maxPages` | `200` | Stop after this many pages |
| `maxDepth` | `6` | Link depth limit |
| `include` / `exclude` | none | `RegExp` filters on the path |
| `ignoreQuery` | `false` | Strip query strings when deduplicating |
| `ready` | `body` | Selector to wait for on each page |

Pages found by the crawler are added as `page` nodes with `parentUrl` links. Modals, tabs and forms still need hand-written `steps`.

### Collection

| Field | Default | Purpose |
|---|---|---|
| `selector` | required | Elements to shoot, one child node each |
| `label` | the element's own text | Selector inside each element whose text is the item's label |
| `tags` | none | Selectors inside each element whose text becomes a search tag |
| `idPrefix` | `<node id>:item` | Child ids are `<prefix>:<slug of label>` or `<prefix>:<n>` |
| `idFromLabel` | `true` | Use the label slug, so ids survive reordering. `false` uses the index |
| `max` | none | Stop after this many items |
| `kind` | `'item'` | Kind of the emitted nodes |

Collection items exist only at capture time. A hand-written node can still use one as its `parent` by id, as long as the id starts with the collection's prefix.

### Component

`{ name, label, selector }`. The first match of `selector` is captured as `<node>--<name>`. A component that is not visible is skipped.

### Step helpers

Import them from `./core/atlas`. Each returns a `Step`, a function that takes a Playwright `Page`.

| Helper | Signature | What it does |
|---|---|---|
| `click` | `click(sel)` | Clicks the first match |
| `hover` | `hover(sel)` | Hovers the first match |
| `fill` | `fill(sel, value)` | Fills an input |
| `press` | `press(key, sel?)` | Presses a key on an element, or on the page if no selector |
| `check` | `check(sel, on = true)` | Sets a checkbox or radio (forced) |
| `select` | `select(sel, value)` | Selects an option in a `<select>` |
| `wait` | `wait(sel)` | Waits until the element is visible |
| `seq` | `seq(...steps)` | Runs several steps in order |
| `clickUntil` | `clickUntil(sel, until, tries = 10)` | Clicks `sel` until `until` is visible. For controls that are wired up late |

### Review options

`review` is optional. Every field has a default.

| Field | Type | Default | Purpose |
|---|---|---|---|
| `threshold` | `number` | `0.0005` | Share of the shot's pixels allowed to differ (0.05 %) before a shot is `changed`. Small changes on tall full-page shots can stay under it, see [Status rules](#status-rules) |
| `pixelThreshold` | `number` | `0.1` | Per-pixel colour tolerance for pixelmatch, from 0 to 1 |
| `port` | `number` | `8097` | Port for `review`. Read by the server from `shots/meta.json` |
| `htmlHash` | `boolean` | `true` | Set to `false` to turn off the markup signal and compare pixels only. The "HTML identical" hint is then never shown |
| `ignoreAttributes` | `string[]` | `[]` | Attributes removed from every element before the markup hash, for example per-run random `data-*` ids. `nonce` is always removed |

### Cases (isolated inputs)

A case is a small JSON file that holds one input for the app to render on its own, such as a formatter string or a card with unusual data. `fromCases` turns every `*.json` file in a folder into one node. Each node opens a **harness page** that the app provides. The harness reads `?case=<name>`, loads `cases/<name>.json` and renders it.

```ts
import { defineAtlas, fromCases } from './core/atlas';

const nodes: UINode[] = [
  // ...your nodes
  ...fromCases({ dir: 'examples/demo-site/cases', harness: '/harness.html', parent: 'home', group: 'cases' }),
];
```

A case file:

```json
{ "title": "Bold text", "tests": "formatText: **bold**", "tags": ["inline", "bold"], "input": "Some **bold** text" }
```

| Option | Default | Purpose |
|---|---|---|
| `dir` | required | Folder of case files, relative to the atlas folder |
| `harness` | required | URL of the harness page, for example `/harness.html` |
| `param` | `case` | Query parameter that carries the case name |
| `ready` | `body[data-ready="1"] #case-root` | Selector that must be visible before the shot, so the harness signals "done rendering" by setting `document.body.dataset.ready = '1'`. A case file can set its own `ready` |
| `parent`, `group` | none | Parent node id and group, as for any node |
| `kind` | `case` | Kind of the emitted nodes |
| `idPrefix` | `case` | Node ids are `<prefix>:<file name>` |
| `components` | none | Components to capture inside each case |

Each node takes its label from `title` (or the file name) and its tags from `tags` and `tests`. The whole file is hashed into the config hash, so editing a case makes its shot `changed` with reason `config`.

The harness page is ordinary app code. It should:

- load the app's real scripts (the demo loads `app.js`), so the case runs the real formatter;
- render the input into `#case-root` inside a box of fixed width (the demo uses 760 px), so screenshots stay stable.

The demo ships a harness (`examples/demo-site/harness.html` and `harness.js`) and eight cases (`examples/demo-site/cases/*.json`): bold, italic, code, link, list, table, a mixed "kitchen sink", and unsupported syntax, which pins the output for markup the formatter does not handle.

### Examples

A page node with components and a collection:

```ts
{
  id: 'home', label: 'Home', kind: 'page', url: '/index.html', group: 'shop',
  fixture: 'signed-in', ready: '.product', tags: ['landing'],
  components: [{ name: 'hero', label: 'Hero', selector: '.hero' }],
  collection: { selector: '#grid .product', label: 'h3', tags: ['.badge'], idPrefix: 'product' },
},
```

A state node reached by interacting with its parent:

```ts
{
  id: 'home:new-dialog', label: 'New product dialog', kind: 'state', parent: 'home',
  steps: click('#newBtn'), ready: '#newDialog[open] form', tags: ['modal'],
  components: [{ name: 'form', label: 'Dialog form', selector: '#newDialog form' }],
},
```

A state built from several steps:

```ts
{
  id: 'settings:saved', label: 'Settings saved', kind: 'state', parent: 'settings',
  steps: seq(fill('#displayName', 'Grace'), click('#saveBtn')), ready: '#saved',
},
```

---

## How a node is reached

1. **Find the chain.** Walk up the `parent` links until you reach a node with a `url`. That node is the chain root. If no ancestor has a `url`, the run fails with an error.
2. **Replay.** Open the root's `url` with its `fixture` and variant setup applied. Then, for each node down the chain: wait until the previous node's `ready` selector is visible, and run that node's `steps`.
3. **Wait** for the node's own `ready` selector (default `body`), with a 20-second limit.
4. **Settle.** Wait for fonts, MathJax if present, and images. Add the `freezeCss` styles, run the `settle` hook, and wait 300 ms.
5. **Shoot.** Take the full page, then each visible component, then each collection item. Record the text, the chain's steps and any JavaScript errors.

### Determinism

Goldens only work if the same app state produces the same pixels every time. The tool does the following by default:

| Setting | Behaviour |
|---|---|
| Viewport and pixel ratio | 1280 × 800 at 1× unless a variant overrides them |
| Locale and timezone | `en-US` and `UTC` |
| Reduced motion | `prefers-reduced-motion: reduce` |
| Animations and transitions | Disabled. `freezeCss` sets their duration to none and hides the text caret |
| Clock | Fixed to `clock` (default `2026-01-01T12:00:00Z`). Set `clock: false` to disable |
| `Math.random` | Seeded (`seedRandom`, default on) |
| Storage | Cleared on the first document of each test, then the variant and fixture values are written. The app's own writes survive navigation |
| Dialogs | Dismissed automatically |
| Masks | `mask` for every shot, plus `mask` on a node. Masked regions are covered with a solid colour |
| Volatile nodes | Captured, never compared |

Anything else that changes between runs needs a mask, a `freezeCss` rule, a `settle` hook, or `volatile: true`.

---

## Using the dashboard

Open `dashboard.html` in any modern browser. It works from `file://`, with no server and no network.

| Area | How to use it |
|---|---|
| **Graph** | Each node is a screenshot thumbnail. Click a node to select it. Drag to pan. Plain scroll pans, **Shift+scroll** pans sideways, **Ctrl+scroll** or trackpad pinch zooms around the cursor. The buttons at the bottom right zoom in steps, fit the visible graph, or re-layout it. Border colours show the kind: page, state, item and component |
| **Search** | Fuzzy search (press `/` to focus, Esc to clear) over labels, ids, tags, CSS selectors, URLs, component labels and the visible text on each screen. Matches are highlighted in the graph and listed in the sidebar |
| **Group filter** | Appears when the config has nodes with a `group`. Shows one group's branch, and keeps the ancestors needed to reach it |
| **All items** | Appears when the config has a `collection`. Off by default, so only items that lead somewhere are shown. On, every collection item is shown. The label comes from `labels.items` |
| **Components** | Adds the component nodes to the graph under their screens |
| **Variant switcher** | Appears with two or more variants. Switches every screenshot, and the viewer's own theme when the variant has a `colorScheme`. The choice is remembered in the browser |
| **Details panel** | Breadcrumb from the root, full screenshot, id, selector, URL, the steps that reach the node, tags, indexed text, JavaScript errors captured during the shot, component thumbnails and the nodes it leads to |
| **Compare variants** | In the details panel, or in the full-size view, shows every variant side by side |
| **Full size** | Opens a node's screenshot in the lightbox. Esc or a click outside closes it |
| **Deep links** | `dashboard.html#node=<id>` opens directly on that node, for example `#node=settings:saved`. The URL follows your selection |
| **Status** | A red ring marks a `changed` node and a blue dot marks a `new` one. The details panel shows the status and its reasons. The header counts the changed and new nodes. The **Changed only** chip shows just those nodes and their ancestors |

---

## Visual regression workflow

Every shot has a status. A person decides which changes are intended; nothing is approved automatically except `match` and `volatile` shots.

- **`capture`** writes the latest screenshots to `review/actual/` and one record per shot. It changes no goldens.
- **`check`** does the same capture, then exits with code 1 unless every record is `match` or `volatile`. It prints the keys that need attention.
- **`review`** opens the review UI, where each changed or new shot is approved or denied. Only approval writes a golden.
- **`approve-new`** and **`approve-all`** are the bulk versions, for the first baseline and for a redesign you have checked.

A full run (no Playwright arguments after `--`) starts from a clean slate: `capture`, `check` and `atlas` delete the fragments and captures of nodes that were removed from the config, so they no longer show in the review queue or the dashboard. Goldens are kept (see Troubleshooting).

A typical loop:

1. Make a UI change.
2. Run `check`. It lists the shots that changed.
3. Run `review`. Compare Approved, Actual and Diff, then approve the change or deny it with a note.
4. Commit the new goldens (`.png` and `.meta.json`) and `goldens/denied.json` with the code change.

Each shot is one Playwright test, named after its id, so `--grep` works. For example, `./script/run.sh check -- --grep "settings"`.

Only one capture runs at a time. A running capture holds the lock file `review/.capture.lock`. The CLI and the review server refuse to start a second capture while it is held, so wait for the first one to finish. A lock left behind by a crashed run is ignored automatically, because its process is no longer alive.

## Review workflow

### The loop

```
capture ──► review/actual/<variant>/<file>.png        (retaken until two captures are byte-identical)
   │
compare ──► goldens/<variant>/<file>.png              (pixelmatch + HTML hash + config hash)
   │
record  ──► review/records/<variant>/<file>.json      (status, reasons, decision; diff in review/diff/)
   │
review  ──► approve (a) ──► goldens/…png + …meta.json  (the only writer of goldens)
            deny    (d) ──► goldens/denied.json        (the golden stays as it was)
```

`capture` never writes a golden. Approval does, in the review UI or with `approve-new` and `approve-all`. A denial is stored with the capture's hashes, so the same unchanged capture is not asked about again.

### Status rules

| Situation | Status | Decision |
|---|---|---|
| The node is `volatile` | `volatile` | `approved` (never compared; the capture is still saved) |
| No golden exists yet | `new` | `pending` |
| Same size, same HTML hash, same config hash, and diff ratio within `threshold` | `match` | `approved` |
| Anything else | `changed`, with reasons | `denied` if `denied.json` has this key with the same `actualHash` and `configHash` (the note carries over), otherwise `pending` |

The reasons say what differs:

- `size`: the width or height differs from the golden.
- `pixels`: the size is the same, but more pixels differ than `threshold` allows.
- `html`: the markup of the shot target changed.
- `config`: the node's configuration changed, for example its steps, components, mask, variant, fixture or `hashInput`.

A golden without its `.meta.json` (for example one copied from an older version or from another project) has no stored hashes, so it is reported as `changed` with reasons `html` and `config`, even when its pixels match. Approve it once to write the metadata. `html` is only given while the markup signal is on.

`threshold` is `review.threshold` (default 0.0005, which is 0.05 % of the shot's pixels). `pixelThreshold` is the per-pixel tolerance, `review.pixelThreshold` (default 0.1).

`threshold` is a share of the whole shot's pixels, not of the changed area. On a tall full-page shot, a small pixel-only change (CSS, an image, a font) can stay under it, and the shot is then `match`. The same change is a larger share of a component or a collection item, which is shot at its own size, so it is caught there. Capture components for the regions that matter.

### Two signals: markup and pixels

The pixel diff says whether anything looks different. The HTML hash says whether the markup of the screen changed. The hash is computed from the outer HTML of the shot target, with scripts removed, masked text emptied, whitespace collapsed, and the attributes listed in `review.ignoreAttributes` removed (`nonce` is always removed). Use `ignoreAttributes` for attributes that change on every run, such as random `data-*` ids. Otherwise the markup signal reports a change on every run.

When the pixels change but the HTML does not, the change came from CSS, a font, an image, or the browser and OS that rendered the page. The review UI shows this as **HTML identical → change came from CSS, not markup** (`htmlIdentical: true`). Set `review.htmlHash: false` to turn the markup signal off and compare pixels only. With it off, the "HTML identical" hint is never shown, and the `html` reason is never given.

### Decisions and config changes

A decision applies to one capture under one configuration. The config hash covers the node's steps, components, collection, mask, variant (including its `prepare` function), fixture files and `hashInput`. If any of them changes, the approved golden no longer matches and the record goes back to `changed` with reason `config` and decision `pending`. An old denial does not carry over either.

How steps are hashed matters. Step helpers (`click`, `fill`, `seq`, and so on) are hashed with their arguments: each carries a `src` tag such as `click("#newBtn")`, so changing a selector or a value changes the hash. Hand-written `steps: async p => {…}` functions, and `prepare` hooks, are hashed by their source text. A change to a variable they close over is not detected, because the source text stays the same. When that happens, re-approve the affected shots, or change the node so its hash changes.

Approving writes the new hashes into `goldens/<variant>/<file>.meta.json`. After that, the same capture is a `match`.

### Review UI

```bat
script\run.bat review
```

The UI opens at `http://127.0.0.1:8097/` by default. Set `review.port` or pass `--port` to change it. It shows the records in a queue on the left, and the selected shot on the right.

| Key or control | Action |
|---|---|
| `j` / `k` | Next / previous record |
| `a` | Approve the current record |
| `d` | Deny the current record, with a note |
| Approve visible new | Approve every visible `new` record, after a confirmation |
| Run capture | Run Playwright (optionally filtered by `grep` or variant) and show the live log. The queue reloads when it finishes |

Filters: status (`new` and `changed` by default), decision, variant, kind, group and a text or tag search.

View modes for the shot:

- **Side by side**: Approved, Actual and Diff.
- **Slider**: drag a divider across Approved and Actual.
- **Overlay**: Actual on top of Approved, with an opacity slider.
- **Diff only**: the pixel diff.

Zoom is either fit-to-window or 100 %.

### CI

- Run `check` in CI and fail the build on drift. It exits with code 1 when any shot is not `match` or `volatile`.
- Commit `goldens/` with the `*.meta.json` files and `denied.json`. CI compares against these.
- Use the Node version and Chromium from `deps`.
- Goldens depend on the operating system, fonts and browser build. Generate them on the same OS and image that CI uses. Otherwise, text anti-aliasing will differ and tests will fail even though nothing changed. A common setup is to run `capture` and `approve-new` in a container that matches CI, then commit the goldens.
- Upload `review/` (`actual`, `diff`, `records`) and `report/` as build artifacts, so reviewers can see the changes.
- Do not run `approve-new` or `approve-all` in CI. They accept whatever was captured, and approval is for people.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `No atlas.config.ts: run config first.` | Run `config` or `setup`. The file must exist before any run mode |
| `duplicate node id "x"` | Two nodes share an `id`. Ids must be unique, including the ones generated by `collection` and `crawl` |
| `node "x" has unknown parent "y"` | `parent` names a node that does not exist. Check the id, or the collection prefix if it refers to an item |
| `node "x" needs a url or a parent` | A root node needs `url`. A child needs `parent` |
| `no ancestor of "x" has a url` | Follow the `parent` chain of `x` up to a node with `url` |
| `unknown fixture "x"` | `fixture` names a key that is not in `fixtures` |
| `waiting for locator(...)` | The selector changed in the app, or the element never appears. Update `ready`, `steps` or the component selectors. `actionTimeout` makes this fail quickly |
| `Failed to take two consecutive stable screenshots` | Something on the screen keeps moving. Mask it, add a `freezeCss` rule, or mark the node `volatile: true` |
| Many shots are `changed` by a few percent of pixels | The UI really changed (CSS, fonts), or the goldens were made on another OS. Open `review` and check whether the change is intended. If it is not, see the CI notes |
| Many pixel-only changes, and the review UI says "HTML identical" | The markup did not change, so the cause is CSS, a font, an image or the browser build. Typical after a font or CDN update. Approve the change if it is intended. If it is not, check the fonts and the browser version |
| Every shot is `new` after setup | There are no goldens yet. Run `capture`, then `approve-new`, or approve in `review` |
| Every shot is `pending` after editing `atlas.config.ts` | The config hash changed (steps, components, mask, variant, `hashInput`), so approvals and denials no longer match. Review the shots again |
| A shot is `changed` with reason `html` but looks the same | The markup changed without a visible effect, such as a class or an attribute. Check the source of the screen |
| A shot is `changed` on every run with no real change | Something moves: a clock, an animation or a random value. Mask it, add a `freezeCss` rule, or set `volatile: true` |
| A small change on a tall full-page shot is `match` | `threshold` is a share of the whole shot, so a small pixel-only change (CSS, an image, a font) can stay under it. Capture the region as a `component`, or lower `review.threshold` |
| A golden is `changed` with reasons `html` and `config`, and its pixels match | Its `.meta.json` is missing, so no hashes are stored. Approve it once in `review` (or with `approve-all`) |
| A shot is `changed` with reason `html` on every run, with no markup change | An attribute changes on every run, for example a random `data-*` id. List it in `review.ignoreAttributes` |
| A shot stays `match` after a variable used in a hand-written `steps` function changed | Hand-written step functions are hashed by their source text, not by what they close over. Re-approve the shot or change the node. Step helpers such as `click` are hashed with their arguments |
| A capture refuses to start | Another capture is running. Only one runs at a time, tracked by `review/.capture.lock`. Wait for it to finish. A lock from a crashed run is cleared automatically |
| `review` reports that the port is in use | Another process uses 8097. Pass `--port` or set `review.port` |
| Dates, counters or avatars differ between runs | Mask them with `mask`, or set `clock` for dates |
| A node times out | The default timeout is `timeout`, 60 s. Collection nodes get `60 s + 3 s × max` (or 100 items if `max` is unset). Raise `timeout` on the node |
| `Server` never starts, or the wrong app is captured | Playwright reuses whatever answers at the port (`reuseExisting` defaults to `true`). Stop the other process, or change the port |
| Static site returns "Not found" for a route | The static server does not rewrite URLs. Every URL in the config must be an existing file |
| Search does not find some text | Only elements matching `textSelectors` are indexed. Add a selector for the element that holds the text |
| A node in the graph has no picture | Its capture failed. The node stays in the graph. Run `atlas` again and read the failing test name in the output |
| `No shots/meta.json` or `No fragments in shots/nodes` | Nothing has been captured yet. Run `atlas` or `capture` first |
| `N golden(s) missing` during build | Some records point at files that are no longer in `goldens/`. Run `capture`, then approve the `new` shots |
| Removed nodes still show up in `goldens/` | Goldens are not deleted automatically. Delete their `.png` and `.meta.json` files in `goldens/<variant>/`, or run `clean --goldens` and capture again |
| `dashboard.html` is too large | Lower `--full` or `--q`, or leave out some collection items or variants |
| `Node ... is too old` | Install Node 18 or newer |
| Playwright or Chromium errors on first run | Run `deps` again. It installs the missing pieces |
| Crawl finds too few or too many pages | Adjust `include`, `exclude`, `maxPages` or `maxDepth`, then run `crawl` again |

---

## Examples

### `examples/demo-site` (root `atlas.config.ts`)

A small static shop with a home page, a product grid, a new-product dialog, a filter, a settings page with tabs and a save confirmation. The root `atlas.config.ts` maps it, with three variants (light, dark, mobile), one collection of product cards, and a `cases` group. The eight formatter cases are isolated inputs rendered by `harness.html` (see [Cases](#cases-isolated-inputs)).

```bat
script\run.bat capture
script\run.bat approve-new
script\run.bat atlas
```

The demo's goldens and `dashboard.html` are generated, and `.gitignore` ignores them.

### `examples/quiz-arch` (real-world port)

`examples/quiz-arch/atlas.config.ts` is a full port of a real quiz app. It shows:

- Nodes generated from the app's own data files (`quizzes/manifest.json` and each topic's config), so new topics and quizzes are picked up on the next run.
- Fixtures that seed a learner profile.
- A collection per topic whose items are quiz cards, with category and status tags.
- Nodes that hang off collection items. A sample quiz per topic gets a full chain: setup, question, feedback, results, review.
- A `freezeCss` rule for a confetti canvas, and a per-variant `localStorage` theme key.

It is a reference, not a plug-and-play config. It resolves the app root two levels above the tool folder, so copy the tool to `<app>/ignore/ui-atlas/`, copy `examples/quiz-arch/atlas.config.ts` over the tool's `atlas.config.ts`, and fix the import path to `./core/atlas`.
