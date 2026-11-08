# Contributing

This page is for people changing Golden Map Atlas itself. To use the tool, see [Getting started](getting-started.md). To understand how the parts fit, read [Architecture](architecture.md) first.

## Setup

- **Node.js 18 or newer**, as `engines` in `package.json` says.
- **Install.** Run `npm install`, or `npm run deps`. `deps` runs `npm install` when `@playwright/test` is missing, then `playwright install chromium`. On Windows, `script\deps.bat` does the same.
- **No build step.** `.mjs` and `.html` files run as they are. `.ts` files are run by Playwright's loader, and `npm run typecheck` checks them.
- **No test suite.** `package.json` has no test script. Check a change by running it, as described under [Verify a change](#verify-a-change).

## Keep core/ generic

`core/` must not know about any app. It holds no app names, paths, selectors or URLs. App knowledge belongs in the project's `atlas.config.ts`. The bundled demo is the only app the code names: `core/init.mjs` recognises the demo config by its path, `examples/demo-site`.

Defaults belong in the code that reads an option, not in the config. See [The config hash](architecture.md#the-config-hash) for why.

## Recipes

Each recipe lists the files it touches. Read each file's header comment before you edit it.

### Add a config option

1. **Type it.** Add the field to `AtlasConfig`, `UINode` or `Variant` in `core/atlas.ts`, with a doc comment. Authors read that comment in their editor.
2. **Read it.** Use it where it takes effect:
   - per shot: `core/golden.spec.ts`
   - server or warm-up: `core/global-setup.ts`
   - Playwright settings: `playwright.config.ts`
   - review thresholds and the markup signal: passed to `evaluate()` in `core/golden.spec.ts`, which applies them in `core/store.mjs`
   
   Apply the default at the point of use, so an unset option behaves as documented.
3. **Hash it, if it changes pixels or markup.** Put the raw value into `shared` or `global` in `core/golden.spec.ts`, with no default. An option that changes what a shot looks like must do this, or a config change would not make the shot stale. If it should not affect the hash, say so in its comment.
4. **Generate it, if `init` or `config` should write it.** `core/init.mjs` (`renderConfig`) and `core/cli.mjs` (`ANSWER_TYPES`, `DEFAULTS`, `writeConfig`). The panel form only needs it if you add it to `core/control-server.mjs` (`ANSWER_TEXT`, `ANSWER_BOOL`) and `core/control.html`.
5. **Document it.** The config reference in the root `README.md`, and any page in `docs/` that lists options.

### Add a step helper

1. **Write it in `core/atlas.ts`.** Build the step with `tag(async p => { ... }, src)`, where `src` is the call written out with every argument passed through `JSON.stringify`. `click`, `fill` and `select` do this. Export it.
2. **Document it.** Add a row to the step helpers table in the root `README.md`.
3. **Check the hash.** Use the helper in a node, run `check`, change one argument, and run `check` again. The shot must become `stale` with reason `config`. If it does not, the `src` tag is missing or wrong. A helper without a `src` tag hashes the same whatever its arguments are.

### Add a CLI mode

1. **`core/cli.mjs`.** Add the mode to `MODES`, which sets the menu and the help text. Add a `case` to the `switch` in `run()`. If the mode captures or builds, add it to `NEEDS_BROWSER`. If it needs the capture lock, call `acquireLock()`. If it approves shots, follow `approve-new`: call `blockers()` and `gate()` before it writes.
2. **`package.json`.** Add an npm script, `"name": "node core/cli.mjs run name"`.
3. **`script/`.** Usually nothing to change. `run.sh` and `run.bat` pass the mode through to `core/cli.mjs run`. Keep the `.bat` and `.sh` pairs in step if you add a wrapper.
4. **Panel, if it should have a button.** See [Add a panel action](#add-a-panel-action).
5. **Document it.** The run modes table in the root `README.md`, and the CLI page in `docs/`.

### Add a status

A status is a value of `status` on a record. The statuses are `new`, `match`, `changed`, `stale`, `unsettled` and `volatile`.

1. **`core/store.mjs`.** Add the rule to `evaluate()`, which sets `status`, `reasons` and `decision`.
2. **`core/store.d.mts`.** Add it to `ReviewStatus`.
3. **`core/golden.spec.ts`.** The test fails for any record that is not `match` or `volatile`, so a new non-passing status fails by default. Change the `problems` filter if it should not.
4. **`core/cli.mjs`.** `isOpen` treats every status except `match` and `volatile` as open. `summary()` prints one line for `changed`, `stale` and `unsettled`. Add a line there if the new status needs one.
5. **`core/review.html`.** Add it to `STATUSES`, which sets the counts and the filter chips, and add `.st-<name>` and `.dot.st-<name>` rules to the CSS.
6. **`core/template.html`.** Add its text to `STATUS_TIP`, add it to `REVIEW` if it needs a person, and add a `.legend i.ring-<name>` rule to the CSS if the graph should show it.
7. **`core/control-server.mjs`.** Add it to `RECORD_STATUSES`, which the panel counts.

### Add a panel action

The control panel runs commands for the browser. Its server builds the argv from an allowlist, so the browser sends only an action name and its options.

1. **`core/control-server.mjs`, `plan()`.** Add a `case` for the action. Declare its option names with `opts([...])`, which rejects any other option. Check every value with a type check or `safeText()`. Add a label to `LABELS`. A destructive option needs an explicit confirmation field, as `approve-all` (`confirm: true`) and the `goldens` option of `clean` (`confirm: 'delete goldens'`) do.
2. **`core/cli.mjs`.** The argv must be a mode the CLI already runs. Add the mode first if it does not exist ([Add a CLI mode](#add-a-cli-mode)).
3. **`core/control.html`.** Add the button, and have it send `{ action, options }` to `/api/run`. The page builds the text of its messages with `textContent`, so keep it that way.
4. **Document it.** [Control panel](control-panel.md) and [HTTP API](http-api.md) if they list actions.

## Invariants

These are the rules the existing code depends on. Do not break them without changing the code that depends on them too.

1. **Every step helper has a stable `src` tag.** The `src` is what the config hash sees for a step. Without it, changing an argument does not change the hash. See [Add a step helper](#add-a-step-helper).
2. **The hash rules hold.** `stable()` drops `undefined` values, so an unset option must contribute nothing to `shared` or `global`. Do not write defaults into the hashed objects. Keep per-run values out of the hash, such as timestamps, paths and random values, or every run would make every shot stale. Changing what the hash contains makes every existing approval `stale` once, so say so in the change.
3. **Capture never writes goldens.** Only `store.approve()` writes `goldens/<variant>/*.png` and `*.meta.json`, and only `store.deny()` writes `goldens/denied.json`. `golden.spec.ts` must keep calling `evaluate()` and nothing that writes to `goldens/`.
4. **The control server uses only Node built-ins and an allowlist.** Its imports are `fs`, `path`, `http`, `child_process`, `crypto`, `string_decoder` and `url`. Its argv comes from `plan()`. Every request must pass the Host check (`127.0.0.1` or `localhost` on its own port). Every POST must be `application/json`, and an `Origin` header, when present, must be the server's own address.
5. **No new path from browser text to a shell.** Two existing paths pass text from the browser into a shell, and each is limited by a character check:
   - `core/review-server.mjs` runs `npx playwright test` with `shell: true` for **Run capture**. `grep` must match `SAFE_GREP` and `variant` must match `SAFE_PROJECT`. Both reject quotes, `$`, backticks, `%`, `^` and `&`.
   - `core/control-server.mjs` passes its `grep` and `project` options to `core/cli.mjs`, and `cli.mjs` runs Playwright through a shell. `safeText()` allows only letters, digits, spaces and `: . / @ -`.
   
   Keep those checks as strict as they are. Do not add a route that sends free text to a shell.
6. **Escape text in pages.** `core/review.html` and `core/template.html` use `esc()`, and `core/build-dashboard.mjs` uses `escHtml()` for values it writes into the page's head. `core/control.html` never uses `innerHTML`, so keep it that way.
7. **Tooltips use `data-tip`.** Put the text in `data-tip`. `core/tooltip.js` reads it when the tip shows and every 250 ms while it is open. Do not add a second tooltip mechanism. A page that uses tooltips must load `tooltip.js`: the review and panel servers serve it, and the dashboard builder inlines it.
8. **Generic core.** See [Keep core/ generic](#keep-core-generic).

## Verify a change

Run the checks that match what you changed. They are listed from cheapest to most complete.

1. **Types.** `npm run typecheck` runs `tsc -p tsconfig.json`. It covers `atlas.config.ts`, `playwright.config.ts`, `core/**/*.ts` and `examples/**/*.ts`. It does not check `.mjs`, `.js` or `.html`.
2. **Syntax of plain JavaScript.** Run `node --check core/<file>.mjs` for each changed `.mjs` file.
3. **The demo, on a copy.** Run the capture against the demo, as below.
4. **The panel and the review UI.** For a change to `control.html` or `review.html`, start `npm run panel` or `npm run review` in the copy and use the page. The repository has no automated UI test.

### Test on a copy

Work on a copy of the repository, outside the repository, because `capture` writes into the folder and `init` and `clean --goldens` delete goldens. The root `atlas.config.ts` is not the demo config at the moment, so find the demo config first. It is the one whose `server` is `examples/demo-site`:

```sh
grep -l "examples/demo-site" atlas.config*.ts
```

Then:

1. **Copy the folder without `node_modules`.** Give the copy a link to the original `node_modules`: a junction made with `mklink /J` on Windows, or a symbolic link elsewhere.
2. **Put the demo config in the copy as `atlas.config.ts`.** Run the copy's `npm run capture`, which runs `stabilize` on the first capture. Then `npm run stabilize -- --runs 3`, which must end with `[OK]`. Then `npm run approve-new`.
3. **Check it three times.** Run `npm run check` three times in a row. Each run must exit 0, and no shot may be `stale` or `changed`. `AGENTS.md` requires three passes before a baseline is trusted, and a `stale` shot right after an approval means a hash is changing between runs.
4. **Remove the link before the copy.** Delete the `node_modules` link without recursion (`rmdir` without `/S` on Windows, or `rm` without `-r` on a symbolic link), then delete the copy. A recursive delete could follow the link into the original packages.
