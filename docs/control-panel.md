# Control panel

The control panel is a page in your browser that runs Atlas for you. Each button runs one of the Atlas commands that you would otherwise type in a terminal, and the page shows the output as it runs.

For a first walkthrough, read [Getting started](getting-started.md). This file is the reference.

## Start and stop

| How | Command | Notes |
|---|---|---|
| Windows | Double-click `script\panel.bat` | Opens the page in your browser. The panel runs in a minimized window |
| macOS / Linux | `./script/panel.sh` | Opens the page in your browser |
| Any | `npm run panel` | The same as the scripts above |
| Terminal | `node core/control-server.mjs --port 8100` | Use this to choose another port, or to see the panel's messages. Add `--open` to open the browser |

To stop the panel, press **Shut down** in the top right corner and confirm. This stops any running job and closes a review page that the panel started. You can also press Ctrl+C in the terminal where the panel runs.

Closing the tab does not stop the panel. If the panel is already running, double-clicking `script\panel.bat` again opens the page of the running panel. It does not start a second one.

## The page

From top to bottom:

- **Top bar.** The name of your app, from the config. Four chips: **Node** (the version found; the panel needs 18 or newer), **Dependencies** (installed or missing), **Config** (ready or missing) and **Goldens** (how many approved screenshots exist). A **Demo** chip appears when the config points at the bundled demo. **Shut down** is on the right.
- **Pipeline.** Seven boxes, described below. The sentence under them says what to do next.
- **Live output.** Appears when a job has run. See [Live output](#live-output).
- **Results.** Counts from the last run. See [Results](#results).
- **All steps and options.** Closed by default. Every button, including the ones not in the pipeline. See [All steps and options](#all-steps-and-options).

If the page loses contact with the panel, a yellow line asks you to keep the tab open and to double-click `script\panel.bat` again.

## Pipeline

### Pipeline boxes

Each box is a button. Clicking it runs the box's action when it is enabled. The tip on the box says what it does, or why it cannot run yet.

| State | What you see | Meaning |
|---|---|---|
| Done | Green check mark | This step is finished |
| Optional | Green dash | Not needed right now. Only Stabilize can be optional |
| Do now | Number in the accent color, outlined | The first box that is not done, optional or needing attention. Look here next |
| Needs attention | Amber exclamation mark | Something needs a look. It shows this mark even when an earlier box is still to do |
| Running | Spinning ring, note "Running..." | Its job is running. The other boxes are disabled until it ends |
| Failed | Red cross, note "Last run failed" | Its last job ended with an error. It stays marked until another job starts, or the panel restarts |

These are the rules the page uses for each box:

| Box | Done when | Needs attention when | Otherwise |
|---|---|---|---|
| Set up | The Playwright package folder exists. This does not check the browser download | Never | "Not installed" |
| Configure | The config file exists. The note shows the app name from that file | Never | "No config yet" |
| Capture | At least one screenshot record exists. The note shows the count | Never | "No shots yet" |
| Stabilize | The last Stabilize result lists no unstable screenshots. The note says "Steady" | The last result lists unstable screenshots. The note says "N keep changing" | "Optional now" once goldens exist and no result exists. Otherwise "Not run" |
| Approve | No screenshot is new, changed, stale or unsettled, and goldens exist. The note shows the golden count | Never | "N to approve" while some are open. "Nothing yet" when none are open and there are no goldens |
| Check | The last run passed and nothing is open. The note says "Passing" | The last run had failures that were not visual differences. The note says "N could not run" | "Not confirmed" |
| Atlas | `dashboard.html` exists. The note says "Built" | Never | "Not built" |

Notes on the boxes:

- A box that needs attention keeps its own mark. The Do now mark goes to the first box that is not done, optional or needing attention, so it can sit on an earlier box.
- A full Capture (one with no filter) deletes the last Stabilize result. Once goldens exist, the Stabilize box then goes back to Optional. A filtered Capture keeps the result.
- A Check that finds differences exits with an error, so its box shows Failed with "Last run failed". This is the result you get when screens differ, not a crash. Read Results, then open the review page.
- The Approve box runs **Approve new** when there are no goldens yet and new screenshots exist. In every other case it opens the review page. It still opens the review page when it is done.
- The "N to approve" count includes screenshots you denied. The count uses each screenshot's status, not its decision, so a denied screenshot keeps counting until it matches its golden or is approved.

## Approve

There are three ways to approve. Each one has its own confirmation or limit.

**Approve new** makes each new screenshot, one that has no golden yet, into a golden. Screenshots that already have a golden are not touched.

- Greyed out with "No new screenshots to approve." when there are none.
- A dialog asks you to confirm and shows the count.
- Refused when the last run had failures other than visual differences, or when Stabilize found unstable screenshots. The job then ends as failed, and Live output says why. The dialog has a **Force** checkbox that goes ahead anyway. Use it only when you know those problems do not matter.

**Approve all** replaces the golden of every new, changed, stale or unsettled screenshot with its newest capture.

- Greyed out with "Nothing to approve: every screenshot already matches its golden." when none are open.
- A dialog asks you to confirm. The old images are replaced. If `goldens` is in git, you can restore them from there. Otherwise they are gone.
- Refused when the last run had failures other than visual differences, or when a screenshot never settled. Stabilize results do not block it. **Force** overrides the refusal.

**Open review** opens the review page in a new tab. It shows each screenshot beside its golden, and you approve or deny each one. Denying keeps the golden and stores your note. Open review is never greyed out by the gate. See [Moving between the panel, the review page and the graph](#moving-between-the-panel-the-review-page-and-the-graph).

Which one to use:

| Situation | Do this |
|---|---|
| First run, no goldens yet | **Approve new** (the Approve box does this for you) |
| Some screens changed and you want to look at them | **Open review** |
| You checked a redesign and every change is intended | **Approve all** |
| Stabilize lists unstable screenshots | Fix them in the app, or mask the part that moves. Then Capture and Stabilize again |

The three Approve buttons ignore the filters in [Filter by name and Variant](#filter-by-name-and-variant). They always act on every screenshot.

## All steps and options

This section is closed until you open it. Buttons are grouped as on the page.

| Button | What it does | Greyed out with |
|---|---|---|
| **Set up** | Installs what Atlas needs. If there is no config yet, it only installs, and you continue with Configure | "Needs Node.js 18 or newer" when Node is too old |
| **Install dependencies** | Installs missing packages and the browser. Does not change the config | Same as Set up |
| **Configure** | Opens the form, then saves the config. The old config is backed up first. See [Configure](#configure) | Same as Set up |
| **Capture** | Screenshots the screens, filtered if a filter is set. Approves nothing. Tick "Skip the automatic Stabilize step on the first capture" to leave out the extra step | "Needs Set up and Configure first." |
| **Check** | Compares the app with the goldens and lists differences. Changes nothing | Same as Capture |
| **Stabilize** | Takes the screenshots 2 to 10 more times (3 by default) and lists the ones that do not come out the same. Tick **Keep** to save the extra screenshots, or **Show every screenshot** to list all of them | Same as Capture |
| **Build atlas and open** | Captures, rebuilds the dashboard and opens it | Same as Capture |
| **Approve new**, **Approve all**, **Open review** | See [Approve](#approve) | See [Approve](#approve) |
| **Rebuild dashboard** | Rebuilds the dashboard from the latest results and opens it | Same as Capture |
| **Open dashboard** | Opens the dashboard from the last build. Nothing is rebuilt | "No dashboard yet. Rebuild the dashboard or Build atlas first." |
| **Open test report** | Opens the test report from the last Check or Capture | "No test report yet. Run Check or Capture first." |
| **Crawl links** | Follows the links from the start page and saves the pages it finds. No screenshots | Same as Capture |
| **Discover navigation** | Looks through the app's menus and links and saves the candidates to `atlas.discovered.txt`. No screenshots | Same as Capture |
| **Clean** | Deletes the generated results: review data, screenshots, reports, the dashboard and the crawl lists. Goldens are kept unless you tick **Also delete goldens**. Then you type `delete goldens` to confirm | Only while another job runs |

Other rules:

- While a job runs, the job buttons are greyed out with the tip "A job is running. Wait for it to finish, or stop it under Live output." Open review, Stop review, Copy output, Stop the job and Shut down stay active.
- A greyed out card shows its reason in grey text under its description.

### Configure

The form asks the same questions as the terminal setup. It starts from the standard answers. It does not read the config that is already there.

- **App name**: shown at the top of the panel.
- **How is the app served**: a dev server command, a static folder, or an app that is already running. The fields change with your choice.
- **Run it in this folder**: only for a dev server command. Counted from the Atlas folder. See [Getting started](getting-started.md#point-atlas-at-your-own-app).
- **Start page path**, **dark mode** and **theme storage key**, **phone view**, and **Find pages by following links**.
- **Replace the existing config**: appears when a config exists. You must tick it to save.

Saving writes `atlas.config.ts` and keeps the old one as `atlas.config.backup-<time>.ts`. The panel does not run a crawl after saving. Use **Crawl links** when you want the pages found.

## Results

The Results section shows the last run.

- **Tiles.** VISUAL is the number of screens that differ from their golden. STALE is the number of screens whose golden was made before a config change. UNSETTLED is the number of screens that kept changing. NEW is the number of screens with no golden yet. INFRA and FLAKY count tests from the last run: INFRA for tests that could not run (timeouts, connection problems), FLAKY for tests that failed once and passed on retry.
- **Last run.** When it finished, its status and the number of tests.
- **Failures.** The first 20 failed tests, with class, variant, screen id and message. The full list is in `review/run-summary.json`.
- **Warnings** and **Flaky** lists, in the same form.
- **Stabilize result.** When Stabilize ran, how many screenshots never settled, and how to fix them when some did.

Before the first run, Results says "No results yet." and tells you to press Capture.

## Live output

Live output appears when a job starts, and it stays after the job ends, until the panel restarts.

- The pill at the top says **Running**, **Finished**, **Failed (exit code N)**, **Failed** (when no exit code is known) or **Stopped**.
- The job's name and the elapsed time update while it runs.
- **Stop the job** stops the job and everything it started. It is enabled only while a job runs. The job then shows as Stopped.
- **Copy output** copies the log. If the browser blocks the copy, the text is selected, and you press Ctrl+C.
- The panel keeps the newest 2 MB of output. A note appears when older output was dropped.

## Filter by name and Variant

Both filters sit at the top of the **Capture and verify** group, inside All steps and options.

- **Filter by name** limits a run to screens whose name contains the text. A screen's name is its id, such as `home` or `settings:saved`, so `settings` matches the settings screens and their states. Up to 200 characters. Allowed characters are letters, digits, spaces, and `. : / @ - _`. It cannot start with `-`.
- **Variant** limits a run to one variant, such as light or dark. The list comes from the last Capture, so before the first Capture it shows only All variants.

The filters apply to Capture, Check, Stabilize and Build atlas and open, both from their buttons and from their pipeline boxes. They do not apply to the Approve buttons, Crawl links, Discover navigation, Rebuild dashboard, or Clean.

When a filter is on, a line under the pipeline reads "Filter is on: only ..." and names the filter. Change or clear it under All steps and options.

A filtered run covers only part of the app. A green Check after a filtered run says nothing about the screens left out, so clear the filter before you rely on Check for the whole app. A filtered Capture also keeps the previous Stabilize result and the other screens' results.

## Moving between the panel, the review page and the graph

- **Panel to review page.** Press **Open review** in the Approve group, or the Approve box when it opens the review page. The review page starts if it is not running, and opens in a new tab at `http://127.0.0.1:8097/` or the port in your config. While it runs, the card shows an **Open review page** link. **Stop review** appears only for a review page that the panel started.
- **Review page to panel.** The review page has no link back. Switch to the panel's tab, or type `http://127.0.0.1:8099/` in the browser.
- **Panel to graph.** **Open dashboard** opens the last built dashboard. **Build atlas and open** and **Rebuild dashboard** build a new one first. **Open dashboard** is greyed out until a dashboard exists.
- **Graph to panel.** While the panel is running, a **Control panel** link at the top of the graph goes back to it. The link appears when the panel answers at the address the dashboard was built with, which is normally `http://127.0.0.1:8099/`. The graph checks again when you return to its tab.

## Tooltips

Controls that have a tip show it in three ways:

- **Mouse.** Hover over the control. The tip appears after a short pause and hides when you move away.
- **Keyboard.** Move to the control with Tab. The tip appears while keyboard focus is on it. Press Esc to hide it.
- **Touch.** Tap the control. The tip stays for about four seconds, or until you tap somewhere else.

The same tips appear on the review page and in the graph. The text of a tip can change while you look at it, for example when a box's state changes.

## What the panel does not do

- It does not run `init`. Use the terminal for `init`, which also clears your goldens and generated files. The form in **Configure** writes the config without clearing anything.
- It does not take custom Playwright arguments. The only options it passes on are the filters above. Anything else is refused.
- It does not edit nodes. The form writes the whole config from the standard answers. To change nodes, edit `atlas.config.ts` in a text editor.
- It does not approve or deny one screen at a time. The review page does that.
- It does not run commands you type into the page. Each button runs one fixed action.
- It keeps no history of jobs. Live output is lost when the panel restarts. Results come from the files the last run wrote, so they stay until the next run replaces them.

## Network and ports

**The panel listens only on this computer.** It answers on `127.0.0.1`, so other computers cannot connect. It also answers only requests addressed to `127.0.0.1` or `localhost`, and it accepts changes only from its own page.

The review page also listens on `127.0.0.1` only.

**Panel port: 8099.** To use another port, start the panel from a terminal with `--port`, for example `node core/control-server.mjs --port 8100`. `script\panel.bat` and `script/panel.sh` always use 8099.

When 8099 is busy, the panel tries the next ports in turn, up to ten in all: 8099 to 8108. If a control panel already runs on one of them, the new one does not start. It reports the running panel and exits, and with `--open` it also opens that panel's page. If all ten are busy, it stops with the message "Ports 8099 to 8108 are busy. Stop the other process or pass --port <n>." The `.bat` file starts the panel in a minimized window, so run the panel from a terminal to read that message.

**Review port: 8097.** The review page uses `review.port` from `atlas.config.ts`, which defaults to 8097. The panel learns the port from the last Capture, so after you change `review.port`, run Capture again. The review page does not try another port. When its port is busy, Open review shows "the review server stopped while starting". Close the other program, or change `review.port` and capture again.

If a review page was started from a terminal, the panel shows it as "started outside this panel, so it cannot be stopped from here". Stop it in that terminal with Ctrl+C.

## If something goes wrong

| You see | What it means | What to do |
|---|---|---|
| "Lost contact with the control panel" | The page cannot reach the panel | Keep the tab open. Double-click `script\panel.bat` again, or start the panel from a terminal |
| "Needs Node.js 18 or newer" | Node is missing or too old | Install a newer Node.js from nodejs.org, then start the panel again |
| "Needs Set up and Configure first." | Packages or config are missing | Do the Set up and Configure boxes first |
| "A job is running. Wait for it to finish..." | Only one job runs at a time | Wait, or press **Stop the job** |
| "Filter by name can only use letters..." | The filter has a character that is not allowed | Use letters, digits, spaces and `. : / @ - _`, and do not start with `-` |
| Approve ends as failed, and Live output says "Refused" | A safety check stopped the approval | Read the reasons in Live output and fix them, then Capture again. Use **Force** only when you know they do not matter |
| "the review server stopped while starting" | Port 8097, or your `review.port`, is in use | Close the other program, or change `review.port` and capture again |
| "started outside this panel" | The review page runs in a terminal | Stop it in that terminal with Ctrl+C |
| The graph has one box | The config has only the start page | Run Crawl links, or add nodes to `atlas.config.ts` |
