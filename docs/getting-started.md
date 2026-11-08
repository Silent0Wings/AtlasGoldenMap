# Getting started

This guide takes you from nothing to a graph of screens. You work with buttons on a page in your browser. The only command-line step is starting the panel, and that is a double-click.

The page you use is the [control panel](control-panel.md). This guide walks through it. The panel's reference, with every rule, is in that file.

## What you need

- Windows, macOS or Linux.
- Node.js 18 or newer. The panel checks the version and shows it in the top bar. If Node is missing or older, install it from nodejs.org.
- An internet connection the first time. Set up downloads the packages Atlas uses and a Chromium browser for taking screenshots.
- For your own app: a way to run it on this computer. That is a start command (for example `npm run dev`), a folder with a built copy of the app, or an address where the app already runs.

## 1. Start the control panel

On Windows, double-click `script\panel.bat` in the Atlas folder, the folder that contains `script` and `core`. The panel opens in your browser at `http://127.0.0.1:8099/`. If no tab opens, type that address into your browser.

On macOS or Linux, run `./script/panel.sh` in a terminal. If it says permission denied, run `sh ./script/panel.sh` instead.

The panel keeps running while you work, in a small minimized window on Windows. Closing the tab does not stop it. To stop it, press **Shut down** in the top right corner. That also stops any job that is running.

## 2. Know the page

The top bar shows four chips: **Node**, **Dependencies**, **Config** and **Goldens**. They tell you what is in place. Hover over a chip to read what it means.

Under the top bar is the **Pipeline**: seven boxes, in the order you go through them. Click a box to run what it does. The sentence under the boxes always says what to do next.

Two more parts appear when they are needed. **Live output** shows what a running job prints. **Results** counts the screens that changed, are new, and so on. **All steps and options** is closed by default. It holds every button, including the ones that are not in the pipeline.

## 3. Run the pipeline on the bundled demo

Use the form to point Atlas at the demo. Do not rely on an `atlas.config.ts` that is already in the folder. The one in your copy may not be the demo's.

1. **Set up.** If the first box is not finished, press it. It installs what Atlas needs. The first time, this takes a few minutes. When it is done, the box shows a check mark and says Installed.
2. **Configure.** Press the **Configure** box and fill in the form:
   - App name: `Demo Shop`
   - How is the app served: **Static folder**
   - Static folder: `examples/demo-site`
   - Port: leave `8091`, or pick any free port
   - Leave **The app has a dark mode** and **Find pages by following links** checked.

   Press **Save config**. The **Demo** chip appears in the top bar.
3. **Crawl links.** This button is not one of the seven boxes. Open **All steps and options**, find **Crawl links** under Explore, and press it. The crawler follows links from the start page and writes the list of pages it finds. Run it before Capture, because Atlas reads that list when it loads the screens.
4. **Capture.** Press the **Capture** box. It takes a screenshot of every screen in every variant. Nothing is approved yet. Because this is the first capture, it also runs Stabilize, which is the box after Capture. Stabilize takes the screenshots again to find any that keep changing. If it reports some, the Results section says how to deal with them.
5. **Approve.** When Capture is done, the Approve box says how many screenshots are waiting. Press it, read the confirmation, and press **Approve new**. The first screenshots become the goldens (see below).
6. **Check.** Press **Check**. It compares the app with the goldens again. A passing check shows a check mark.
7. **Atlas.** Press **Build atlas and open**. The dashboard opens in your browser. That is the graph.

## 4. The pipeline in brief

| Box | What it does | When it is done |
|---|---|---|
| Set up | Installs the packages and the browser Atlas uses | Check mark, "Installed" |
| Configure | Writes the config file from the form | Check mark, your app's name |
| Capture | Screenshots every screen in every variant (light, dark, phone). Approves nothing | Check mark, "N shots" |
| Stabilize | Takes the screenshots again to find the ones that keep changing. Approves nothing | Check mark, "Steady" |
| Approve | Makes screenshots into goldens, or opens the review page so you can do it one by one | Check mark, "N goldens" |
| Check | Compares the app with the goldens. Changes nothing | Check mark, "Passing" |
| Atlas | Captures everything, builds the graph and opens it | Check mark, "Built" |

Each box also shows when it needs a look, when it is running, or when its last job failed. The [control panel reference](control-panel.md#pipeline-boxes) has the exact rule for every state.

A Check that finds differences shows its box as failed, with the note "Last run failed". That is expected when screens differ from their goldens. It means there is something to review, not that Atlas broke. Read the Results section, then open the review page from the Approve box.

## What a golden is

A golden is an approved screenshot. Each later Capture takes a new screenshot of the screen and compares it with its golden. If they match, the screen passes. If they differ, the screen waits for someone to look at it.

Atlas never makes a golden on its own. Only approving does. Approving copies the screenshot into the `goldens` folder. Denying a difference keeps the old golden.

In your own project, commit the `goldens` folder with your code, so everyone and the CI compare against the same images. The README explains the one line in `.gitignore` to remove: see [Using it in your own project](../README.md#using-it-in-your-own-project).

## Read the graph

**Build atlas and open** writes `dashboard.html` and opens it. The file works offline, from your disk.

- Each box is a screen, with its screenshot.
- Lines run from a screen to the screens it leads to. The start page is at the top. A dialog or menu opened from a screen hangs off that screen.
- Click a box to see the screenshot large, with its details and the steps that reach it.
- Press `/` to search by name, text or selector.
- A red ring marks a screen that changed. A blue dot marks a new screen.
- While the panel is running, a **Control panel** link at the top of the graph takes you back to it.

## Point Atlas at your own app

Start the same way as the demo: press **Configure**. Fill in the form from top to bottom.

**How is the app served?** Pick one:

- **Dev server command**: Atlas starts your app with a command such as `npm run dev`. Fill in the command, the folder to run it in, and the address the app answers at, for example `http://localhost:5173`.
- **Static folder**: you have a built copy of the app in a folder. Fill in that folder and a free port. Atlas serves the folder itself.
- **Already running**: you start the app yourself. Fill in its address. Atlas starts nothing.

**Run it in this folder.** This field appears only for a dev server command. It is counted from the Atlas folder, not from your app. The default `..` means "the folder above the Atlas folder". That is your app only when the Atlas folder sits directly inside the app's folder.

This is the most common mistake. If your app is somewhere else, type the path from the Atlas folder to the app, for example `../my-app`. A wrong folder means the app does not start, or Atlas captures a different app.

**Start page path.** The page Atlas opens first, such as `/`, or `/dashboard` for another page.

**The app has a dark mode.** On: every screen is also captured in dark mode. If the app saves its theme in the browser under a key, type that key in **Theme storage key**. Leave it empty if the app follows the operating system setting.

**Also capture a phone-sized view.** On: every screen is also captured at phone size.

**Find pages by following links.** On: Crawl links can list the pages of the app. If it is off, Crawl links fails with "Nothing crawled".

Press **Save config**. If a config already exists, tick **Replace the existing config** first. Atlas keeps the old file as `atlas.config.backup-<time>.ts`.

### One node is one box

The form writes one screen: the start page. The graph shows one box until you add more.

- **Crawl links** adds the pages it finds. Run it again when the app's pages change.
- A screen you reach by a click, such as a dialog, a tab or a menu, needs a node that you write by hand in `atlas.config.ts`. The panel does not edit nodes. The README has the [config reference](../README.md#config-reference), and [Adapting Atlas to a real app](../README.md#adapting-atlas-to-a-real-app) covers live data, waiting for the page to load, and masks.

After you add pages or nodes, run Capture again, then Approve and Check as before.

## Where to go next

- [Control panel reference](control-panel.md): every box, button, message and port.
- [Adapting Atlas to a real app](../README.md#adapting-atlas-to-a-real-app): frozen data, the clock, waiting for the page to be ready, and the fixes that Stabilize points to.
- [Using Atlas with an AI agent](using-with-an-agent.md): let an agent write the nodes and handle the first run.
- [Data formats](data-formats.md) and [Architecture](architecture.md): what the files hold and how the parts fit together.
