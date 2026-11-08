---
name: golden-map-atlas
description: Use when the user wants visual regression tests for a web app, or asks about Golden Map Atlas, atlas.config.ts, nodes, variants, golden screenshots, capture, check, stabilize, approve, the review page, the graph dashboard, the control panel, onboarding a new app, or a failed or flaky atlas run. Golden Map Atlas is a Playwright tool that maps an app's screens into golden screenshots and reviews visual changes with a person.
---

# Golden Map Atlas

Golden Map Atlas captures every screen of a web app, compares each one with an approved screenshot (a "golden"), and shows the results as a searchable graph. A person decides which visual changes are intended. The tool knows nothing about any one app: everything app-specific lives in `atlas.config.ts`. The engine in `core/` is generic.

The **atlas folder** is the folder that holds `atlas.config.ts`, `core/` and `package.json`. Run every command from there. Paths inside the config (`cwd`, `staticDir`) are relative to the atlas folder. The folder also holds `README.md` (the config reference) and `AGENTS.md` (short rules for agents). If this file and the code disagree, the code wins.

## How to work: onboarding an app

Follow these steps in order. Stop where the step says to stop.

1. **Inspect the app.** Find how it starts (the start command, the folder to run it in, the URL and port it serves), its pages and routes, and how it loads its data (an API, files, a database). Note what moves on its own: clocks, animations, random values, live data, canvases, dates computed on the server.
2. **Plan frozen data.** The atlas must capture a frozen snapshot of the app's data, never live data. If the app has no way to read a snapshot, tell the person before you go on.
3. **Write the config.** Before running `init`, check the destructive-step list below. Then run `npm run init -- --url <url> --command "<start command>"`, adding `--cwd <folder>` when the command must run in another folder. Leave out `--command` when the app is already running at `--url`. Read the generated `atlas.config.ts`.
4. **Write nodes.** Add one `page` node per screen, then `state` nodes for modals, tabs and other interactions. Give every node a real `ready` selector that appears only when the content has loaded. Never use `ready: 'body'` for real content. `npm run discover` lists navigation candidates on the start page, and `npm run crawl` follows links. Both only suggest; copy what you need.
5. **Capture.** Run `npm run capture`. On the first full run with no goldens, it also runs `stabilize` with two more runs.
6. **Stabilize.** Run `npm run stabilize -- --runs 3`. Read the table before you change anything. Its "likely cause" column names the kind of change.
7. **Fix.** Use a stricter `ready`, `readyAfter: 'networkidle'`, `afterResponse` on a step, `mask`, `freezeCss`, `freezeCanvas`, a `component` for a region that matters, or `volatile: true` for a part that cannot be made stable. Run stabilize again. Repeat until it ends with `[OK]`.
8. **Stop and ask the person to approve.** Tell them what you captured, what stabilize reported, and what you changed. Do not approve. Approval is the person's decision (see Rules).
9. **After the person approves**, run `npm run approve-new` for the first baseline, then `npm run check` three times in a row. Report each result.

## When and how to set up the config

Everything about the app lives in `atlas.config.ts`. Choose the method by what changed:

| Situation | Do this | Effect on goldens |
|---|---|---|
| First time on a new app, or the demo config is still in place | `npm run init -- --url <url> --command "<cmd>"` | Cleared. Check with the person first |
| The app's setup is wrong and the file has no hand-written screens worth keeping | `npm run config -- --answers '<json>' --force` | Kept. It warns that they may no longer fit |
| Add or change a screen, `ready`, `mask` or step | Edit `atlas.config.ts` by hand | Kept |
| The port, start command or folder changed | Edit `server` and `baseURL` by hand | Kept, and no shot goes `stale` |
| Add a variant such as dark or mobile | Add it to `variants` by hand | Kept. The new variant's shots are `new` |
| Stabilize reported a flaky shot | Edit the node or global option it points at | Kept. Affected shots go `stale` |

Never run `init` or `config --answers` to make a small change. Both write a starter file with a single `home` node, so they discard every hand-written screen. `init` also clears the goldens. The old file is kept as `atlas.config.demo.ts` (the demo) or `atlas.config.backup-<timestamp>.ts`.

After `init` or `config --answers`, the config has one screen, so the graph has one box. Writing the nodes is the next job.

**Setting up the server:**

| The app is | Use |
|---|---|
| In a folder next to the atlas folder | `server: { command: 'npm run dev', cwd: '../my-app' }` |
| The parent of the atlas folder | `server: { command: 'npm run dev', cwd: '..' }` |
| A folder of built files | `server: { staticDir: '../my-app/dist' }`, with the port in `baseURL` |
| Already running, started by someone else | No `server` entry |

`cwd` must be the folder holding the app's `package.json`, or the command fails before any shot is taken. `baseURL` must be the address the app really listens on. If something already answers on that address, the atlas uses it and does not run `command` or serve `staticDir`, so a wrong folder can go unnoticed. Check it by stopping that server, or by looking at what the first shot shows.

**What an edit resets.** Shots whose settings changed go `stale` and need a person's approval:

| Edited | Shots that go `stale` |
|---|---|
| A node | That node's shots, and those of nodes reached from it through `steps` |
| A variant | That variant's shots |
| A fixture | Shots of the chains that use it |
| `mask`, `freezeCss`, `freezeCanvas`, `theme`, `clock`, `seedRandom`, `settle` | All shots |
| `server`, `baseURL`, `workers`, `timeout`, `review` thresholds, `crawl` | None |

After any edit, run `npm run typecheck`, then `npm run capture`, and read the summary before going further.

## Commands

Run from the atlas folder. Each command finishes without prompts unless marked otherwise.

| Command | What it does |
|---|---|
| `npm run init -- --url <url> [--command "<cmd>"] [--cwd <dir>] [--static-dir <dir>] [--title <t>] [--path <p>] [--dark] [--mobile] [--theme-key <key>] [--crawl] [--force]` | Writes `atlas.config.ts` from flags. Moves the demo config aside. Clears `goldens/`, `review/`, `shots/` and `atlas.crawl.json`. Refuses to replace a non-demo config unless `--force` is given. `--cwd` needs `--command`. `--static-dir` needs a port in `--url`. `--path` must start with `/`. `--crawl` runs `crawl` afterwards |
| `npm run config -- --answers '<json>' [--force]` | Writes `atlas.config.ts` from a JSON object, no prompts. Fields: `title`, `kind` (`d` dev command, `s` static folder, `r` already running), `command`, `cwd`, `staticDir`, `port`, `baseURL`, `start`, `themeKey`, `dark`, `mobile`, `crawl`. Refuses an existing config unless `--force` is given. A backup is kept |
| `npm run capture` | Captures every shot into `review/actual/`. Writes records. Changes no goldens |
| `npm run check` | Captures, then exits 1 unless every shot is `match` or `volatile`. Prints what is open |
| `npm run stabilize -- --runs 3` | Captures N times into a scratch folder, lists shots that differ between runs, exits 1 if any. `--keep` keeps the scratch folder, `--all` lists stable shots too |
| `npm run approve-new` | Approves shots with status `new`. Refuses after a non-visual failure or when the stabilize report has unstable shots. `--force` overrides it |
| `npm run approve-all -- --yes` | Approves every open shot. Only with the person's explicit go-ahead. Never in CI |
| `npm run crawl` | Follows links from `crawl.start`, writes `atlas.crawl.json`. Its pages become nodes on the next capture |
| `npm run discover` | Writes `atlas.discovered.txt`: commented-out node candidates from the start page |
| `npm run clean` | Deletes generated files. `npm run clean -- --goldens` also deletes `goldens/` |
| `npm run typecheck` | Runs `tsc` over the config and `core/` |

To limit a run to some nodes or variants, call the CLI directly and pass Playwright arguments after `--`. For example: `node core/cli.mjs run check -- -g "settings" --project=light`. A filtered run keeps earlier records. Only a full run starts clean.

Capture-type commands (`capture`, `check`, `stabilize`, `crawl`, `discover`) install npm packages and Chromium when they are missing. That needs network access the first time.

**Do not run these.** They open a browser, wait until stopped, or prompt for input: `npm run review`, `npm run atlas`, `npm run build`, `npm run open`, `npm run report`, `npm run panel`, and `npm run config` without `--answers`. The control panel and the review page are for the person.

## Destructive steps: check with the person first

Each of these deletes or replaces something. Before running one, confirm that the person knows, and that goldens are committed to git if they matter.

- **`init`** clears `goldens/`, `review/`, `shots/` and `atlas.crawl.json`, and moves the existing config aside. With `--force` on a non-demo config, the old config is backed up as `atlas.config.backup-<timestamp>.ts`. Goldens are cleared either way, so restore them from git if needed.
- **`clean -- --goldens`** deletes `goldens/`, the approved baselines.
- **`config --force`** (or `--answers` with `--force`) replaces `atlas.config.ts`. A backup is kept, but the new file is what runs.

Editing `atlas.config.ts` does not delete goldens, but it changes the config hash. Every affected shot becomes `stale` until it is re-captured and approved.

## Rules

1. **Stabilize before approve.** Do not approve a baseline until `stabilize` ends with `[OK]`, or its findings are fixed and you have said so.
2. **Approval is the person's decision.** Run `approve-new` only for a first baseline (status `new`), and only after the person has said yes. Never approve `changed`, `stale` or `unsettled` shots unless the person has reviewed them.
3. **No `--force`** unless the person asks for it. A refusal means something is wrong. Find out what before overriding it.
4. **Never approve in CI.** CI runs `check`. Approval is for people.
5. **A new baseline is trusted after `check` passes three times in a row.**
6. **Capture frozen data, never live data.** Stop what moves with `mask`, `freezeCss`, `freezeCanvas`, `ready`, `readyAfter` or `volatile: true`. A mask or a volatile node must hide noise, not a real screen.
7. **Keep app-specific code out of `core/`.** All app details go in `atlas.config.ts`. Do not edit `core/` to make one app pass.
8. **Confirm before the destructive steps above.**
9. **Do not run commands that open a browser or never exit** (see Commands).
10. **Do not loosen a check to hide a change.** Raising `review.threshold`, masking a real region or setting `failOnHtml: false` on a markup test are decisions for the person.

## Writing `atlas.config.ts`

```ts
import { defineAtlas, click, fill, seq, afterResponse, fromCases, type UINode } from './core/atlas';

const nodes: UINode[] = [
  { id: 'home', label: 'Home', kind: 'page', url: '/', ready: '.product',
    components: [{ name: 'header', label: 'Top bar', selector: 'header' }],
    collection: { selector: '#grid .product', label: 'h3', idPrefix: 'product' } },
  { id: 'home:dialog', label: 'New item', kind: 'state', parent: 'home',
    steps: click('#newBtn'), ready: 'dialog[open] form' },
  { id: 'home:search', label: 'Search', kind: 'state', parent: 'home',
    steps: afterResponse('/api/search', fill('#q', 'ch')), ready: '#results li' },
];

export default defineAtlas({
  title: 'My App',
  baseURL: 'http://127.0.0.1:5173',
  server: { command: 'npm run dev', cwd: '../my-app' },
  variants: [
    { name: 'light', colorScheme: 'light' },
    { name: 'dark', colorScheme: 'dark' },
  ],
  nodes,
  root: 'home',
  mask: ['[data-testid=clock]'],
});
```

Node rules, enforced when the config loads:

- `id` is unique, and ids must not collide after sanitising (case-insensitive).
- A node has either `url` (a chain root) or `parent` with optional `steps`. Never both `url` and `steps`.
- `fixture` goes only on a node with `url`.
- A node hanging off a collection item needs its own `url`.
- No parent cycles.

Required fields: `title`, `baseURL`, `variants`, `nodes`. Options you will use most:

| Option | Default | Use |
|---|---|---|
| `server` | none | `{ command, cwd?, url?, timeout?, reuseExisting?, ready? }` or `{ staticDir, port?, url?, ready? }`. `cwd` is relative to the atlas folder |
| `server.ready` | none | Waits for a condition, not just a port: `{ url, status, bodyIncludes, until(body), timeout, interval }` |
| `fixtures` | none | Named `localStorage`, `sessionStorage`, `cookies`, `prepare`. Nodes opt in with `fixture` |
| `mask`, node `mask` | `[]` | Covers dynamic regions with a solid colour |
| `freezeCss` | none | Extra CSS injected before each shot |
| `freezeCanvas` | `'mask'` | `'mask'`, `'hide'` or `'keep'` |
| `clock` | `'2026-01-01T12:00:00Z'` | Fixed browser time, or `false`. It does not reach the backend |
| `seedRandom` | `true` | Deterministic `Math.random` |
| `stableShots` | `{ max: 5, interval: 150 }` | Retakes a shot until two takes match, or `false` |
| `settle` | none | Extra wait hook, for charts and similar |
| `theme` | none | `{ storageKey, light?, dark? }`. `colorScheme` on each variant is still needed |
| `warmup` | `true` | Loads `baseURL` once before the workers start |
| `workers`, `timeout`, `actionTimeout`, `retries` | 50% of CPUs, 60000, 15000, 1 | Playwright settings |
| `review.threshold` | `0.0005` | Share of the shot's pixels allowed to differ |
| `review.pixelThreshold` | `0.1` | Per-pixel colour tolerance |
| `review.port` | `8097` | Review page port |
| `review.htmlHash` | `true` | Markup signal. `false` turns it off |
| `review.ignoreAttributes` | `[]` | Attributes removed before hashing markup, for random values |
| `review.failOnHtml` | `false` | Makes a markup-only change fail. Use it where the markup is the output under test |
| `review.ignoreAntialiasing` | `true` | Leaves anti-aliased edge pixels out of the diff |
| `crawl` | none | `{ start, maxPages?, maxDepth?, include?, exclude?, ignoreQuery?, ready? }` |

Node fields: `label`, `kind` (`page`, `state`, `item`, `component`, or any string), `parent`, `group`, `tags`, `url`, `steps`, `ready` (default `body`), `readyAfter: 'networkidle'`, `fixture`, `volatile`, `hashInput`, `mask`, `components`, `collection`, `timeout`.

Step helpers, imported from `./core/atlas`: `click`, `hover`, `fill`, `press`, `check`, `select`, `wait`, `seq`, `clickUntil`, `afterResponse`. Prefer them to hand-written functions: their arguments go into the config hash in a readable way.

`fromCases({ dir, harness, parent, group })` makes one node per JSON file in `dir`. The app's harness page reads `?case=<name>`, renders into `#case-root`, then sets `document.body.dataset.ready = '1'`.

Components are sub-regions captured as their own shots, when visible. A collection makes one child node per matching element. A collection's child ids start with its `idPrefix`.

## How a node is captured

1. Walk up `parent` to the nearest node with a `url`.
2. Apply the clock, seeded random, storage, fixture and variant `prepare`. Open that URL.
3. For each node down the chain, wait for the previous `ready` and run the next `steps`.
4. Wait for the node's `ready` (20 s limit), after network idle if `readyAfter` is set.
5. Settle: fonts, images, `freezeCss`, the `settle` hook, 300 ms.
6. Shoot the page, then each visible component, then each collection item, retaking until two takes match.
7. Compare each shot with its golden and write its record.

Defaults: Chromium, 1280x800, scale 1, reduced motion, `en-US`, UTC.

## Statuses

Decided in this order:

| Status | Meaning | Action |
|---|---|---|
| `volatile` | Node is marked volatile, never compared | None |
| `unsettled` | Takes never matched: the page keeps changing | Run `stabilize`, freeze the cause |
| `new` | No golden yet | Stabilize, then the person approves |
| `match` | Size, pixels and config all agree | None |
| `stale` | Only the config hash differs | The person confirms the shot, then approves |
| `changed` | Size or pixels differ, or markup with `failOnHtml` | The person reviews, then approves or denies |

Reasons are `size`, `pixels`, `html`, `config` and `unsettled`. A markup-only change without `failOnHtml` stays `match` with `htmlChanged: true`. It is informational.

"Open" means not `match` and not `volatile`. Open shots fail `check`. A denial is tied to the exact image and config hash, so it clears when either changes.

## Reading a run

```
VISUAL     2  changed (needs review)
STALE      1  golden predates a config change: re-capture and approve
UNSETTLED  1  never stopped changing: run stabilize
INFRA      1  timeout waiting for '.product' (retried 1x, still failing)
```

The source is `review/run-summary.json`. Failure classes are `visual` (the shot differs), `infra` (timeouts, network errors, a closed browser) and `error` (anything else). Flaky tests and warnings are listed too. A warning can mean a canvas was found, or a collection's item count changed. Per-record details are in `review/records/<variant>/`, and diff images in `review/diff/`.

`stabilize` guesses a cause for each unstable shot from the shape of the difference:

- sizes differ: `size changes: content loaded late`
- a 1 or 2 pixel line: `thin line: border / loading bar`
- the box touches a canvas: `canvas animation`
- the box covers 40 % or more of the shot: `large area: late render or shifted content`
- markup differs between runs: `markup differs between runs`, fix with `review.ignoreAttributes` or `review.htmlHash: false`
- the shot is missing from some runs: `appears in only some runs: collection or conditional content not ready`
- a run left it unsettled: `never settled: still animating`
- a test failed: `error`, with its message as the cause
- anything else: `small region: animation or late content`

The report is `review/stabilize.json`. The last line is `[OK] N shots stable across R runs` or `[!] K of N shots unstable`.

## Common traps

| Symptom | Cause | Fix |
|---|---|---|
| `ENOENT ... package.json`, the server does not start | `server.cwd` is not the app's folder. The default `..` assumes the atlas folder sits inside the app | Set `cwd` to the app's folder, relative to the atlas folder |
| `check` passes on a blank or error page | `ready: 'body'` always matches | Wait for a selector that proves the page loaded |
| The shot shows content from before a search | `ready` matched old content | `readyAfter: 'networkidle'`, or `afterResponse` on the step |
| Large diff over a card, every run | Canvas or live region | `freezeCanvas`, `mask`, or `volatile` |
| 1px line differs | Border or progress bar | `freezeCss` or `mask` |
| Timeouts only at the start of a run | Cold start, too many workers | Keep `warmup`, lower `workers` |
| Shot count varies between runs | Collection shot before its data loaded | A stricter `ready` on the collection's page |
| Every shot is `stale` after editing the config | The config hash changed | Re-capture, then the person approves the shots they intend |
| `stale` never clears | The golden predates a config edit | Capture that node, then the person approves it |
| `approve-new` refuses | A non-visual failure, or unstable shots from stabilize | Fix the cause and run again. Do not use `--force` on your own |
| Dates look wrong | `clock` is far from the data, or the backend computes its own "today" | Move `clock` near the data, mask server-side dates |
| `a capture is already running` | `review/.capture.lock` is held | Wait. A lock from a dead process is replaced automatically |
| `server` never starts, or the wrong app is captured | Something else answers on the port, and `reuseExisting` is on by default | Stop the other process, or change the port |
| Static site returns "Not found" for a route | The static server has no SPA fallback | Every URL in the config must be an existing file |

## Where things live

| Path | What |
|---|---|
| `atlas.config.ts` | The only per-app file |
| `core/` | The generic engine. Do not edit it for one app |
| `goldens/<variant>/` | Approved `.png`, `.meta.json` and `.html`. Commit them in a real project |
| `goldens/denied.json` | Denied captures, with notes. Commit it |
| `review/` | Generated: `actual/`, `diff/`, `records/`, `run-summary.json`, `stabilize.json`, `.capture.lock` |
| `shots/`, `report/`, `test-results/`, `dashboard.html`, `.stabilize/` | Generated |
| `examples/demo-site/` | The bundled demo, which `atlas.config.demo.ts` maps |
| `examples/quiz-arch/` | A real-world reference config. It assumes the atlas folder sits at a fixed place inside its app, so its paths must be adjusted for your layout |

## The bundled demo

The bundled demo is a small static site, and `atlas.config.demo.ts` maps it. To see the flow without a real app, copy that file over `atlas.config.ts` (ask first if a real config is in place), then run `npm run capture`. Ask the person before any approval, even on the demo.

## The person's tools

The person can open the review page with `npm run review`. It runs until stopped with Ctrl+C, and it approves or denies shots. It listens on `127.0.0.1` at `review.port` (8097 by default). The person can also use `npm run panel`, a browser control panel on `127.0.0.1` that runs the same commands. Tell the person to use these when a human decision or a browser view is needed. Do not run them yourself.
