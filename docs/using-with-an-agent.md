# Using Golden Map Atlas with an AI agent

This page is for people who want an AI coding agent (Claude Code, or another agent that can run commands in a terminal) to set up Golden Map Atlas for their web app and do the routine work. It covers what the agent can and cannot do, how to install the skill, how to split the work, example prompts, what to review, and the safety rules.

For the tool itself without an agent, see [getting-started.md](getting-started.md). For the control panel, see [control-panel.md](control-panel.md).

## What the agent can and cannot do

**The agent can:**

- Read this repository and your app's code, and write `atlas.config.ts`.
- Run `init`, `capture`, `stabilize`, `check` and the other commands that finish without prompts (the full list is in [SKILL.md](SKILL.md)).
- Read the results: `review/run-summary.json`, the records in `review/records/`, and the stabilize report.
- Fix what the results point at: a stricter `ready` selector, a `mask`, a `freezeCss` rule, `readyAfter`, or `volatile` for a part that cannot be made stable.
- Explain each shot's status and reasons to you.

**The agent cannot, and should not:**

- Decide whether a visual change is intended. Only you can.
- Approve or deny shots on your behalf. It may run `approve-new` for a first baseline, and only after you say yes. It never approves in CI.
- Make your app's data stable. It can point the app at a snapshot if the app supports one, but it cannot make a server compute the same "today" on every run.
- Replace your review. It can tell you what changed, but you look at the images in the review page before anything becomes a golden.
- Open the review page or the dashboard for you. Those commands run until stopped, or open a browser. You run them.

## Installing the skill

The skill is [SKILL.md](SKILL.md) in this folder. It tells the agent how to work with the tool on any app. Install it as follows.

**Claude Code, for one project.** Copy the file into the project where the agent works:

```sh
mkdir -p .claude/skills/golden-map-atlas
cp <atlas folder>/docs/SKILL.md .claude/skills/golden-map-atlas/SKILL.md
```

**Claude Code, for every project on your machine.** Copy it to your user folder:

```sh
mkdir -p ~/.claude/skills/golden-map-atlas
cp <atlas folder>/docs/SKILL.md ~/.claude/skills/golden-map-atlas/SKILL.md
```

Start a new Claude Code session after copying, so the skill is picked up.

**Other agents.** Point the agent at [`AGENTS.md`](../AGENTS.md) in the atlas folder, which lists the commands and rules in short form, or at `docs/SKILL.md` directly. The skill is plain Markdown with a short header, so an agent that does not support skills can read it as an instruction file. Check how your agent loads instructions. This page does not cover every agent.

Whatever agent you use, it has to run from a place where it can reach the atlas folder. The skill refers to paths relative to the atlas folder, so run commands from there.

## The recommended split of work

| Who | Does what |
|---|---|
| **The agent** | Inspects the app, writes `atlas.config.ts`, writes nodes with real `ready` selectors, captures, runs stabilize, fixes flakes, runs `check`, and reports the results |
| **You** | Decide what the frozen data is, confirm each destructive step, review the captures and diffs in the review page, approve or deny, and commit the goldens |

The loop is:

1. The agent gets the atlas to a state where `stabilize` ends with `[OK]`.
2. The agent stops and tells you what it captured and what it changed.
3. You run `npm run review` yourself. Look at each `new` shot. Approve the ones you want, deny the others with a note.
4. You tell the agent to run `approve-new` for the first baseline, or you approve in the review page.
5. The agent runs `check` three times in a row and reports the result.
6. You commit `goldens/` and `atlas.config.ts` together.

## Example prompts

Paste these into your agent, one at a time, and change the bracketed parts. Each one assumes the skill is installed.

1. **Onboard the app.**
   > Onboard my app at `../my-app`. It starts with `npm run dev` in that folder and serves `http://localhost:5173`. Use the atlas in this folder and follow the golden-map-atlas skill. Stop before approving anything and tell me what you captured.

2. **Write the nodes.**
   > Add nodes for the home page, the settings page, and the "new item" dialog that opens from the home page. Give each one a `ready` selector for real content. Do not use `body`.

3. **Stabilize and fix.**
   > Run stabilize with three runs. For each unstable shot, read its likely cause, fix it with the smallest change that works, and run stabilize again. Do not approve anything.

4. **Explain a flaky shot.**
   > The "settings" shot changes on every run. Find the part that moves, freeze it with `mask` or `freezeCss`, and tell me what you changed and why.

5. **Check the state.**
   > Run `check` and list each shot that is not a match. For each one, give me its status and its reasons. Do not approve or deny anything.

6. **Ask why check failed.**
   > Why did `check` fail? Read `review/run-summary.json` and the records, and tell me the failure class of each problem and what fixes it.

7. **Approve the first baseline after your review.**
   > I have looked at the captures in the review page and I approve them. Run `approve-new` for the first baseline, then run `check` three times in a row and report each result.

8. **Set up CI without approval.**
   > Add a CI job that installs dependencies and runs `npm run check`. It must not run `approve-new`, `approve-all`, or anything with `--force`.

## What to review in what the agent produced

Read these before you accept the agent's work:

- **`atlas.config.ts`.** Check that `server.cwd` points at your app's folder, that `baseURL` and the start page are right, and that the node count roughly matches your app's screens. Look for `ready: 'body'` on real content.
- **Every `mask`, `freezeCss`, `freezeCanvas` and `volatile`.** These can hide real problems. A mask over a whole page, or a `volatile` on a screen you care about, means the test no longer checks that screen.
- **Changes to the thresholds.** A raised `review.threshold`, a `failOnHtml: false` on a formatter, or a loosened `pixelThreshold` should be a decision you made, not something the agent did to make `check` pass.
- **Data.** Confirm that the app reads a frozen snapshot, not live data. If the agent could not find a way to freeze the data, the captures will change over time.
- **Files outside the atlas.** Run `git status` after the agent is done. Changes to `core/` or to your app's code that you did not ask for need a reason.
- **The stabilize report.** It should end with `[OK]`, or its findings should be listed and explained.
- **The review page.** Look at each shot yourself, at actual and diff. The agent's description is not a substitute.
- **Goldens.** Before committing, check the list of new and changed `.png` files in `goldens/`. Each one should be a screen you meant to approve.

## Safety notes

**Commit goldens before any destructive step.** These commands delete or replace things:

- `init` clears `goldens/`, `review/`, `shots/` and `atlas.crawl.json`, and moves your config aside.
- `clean -- --goldens` deletes `goldens/`.
- `config --force` replaces `atlas.config.ts`. A backup is kept, but the new file is the one that runs.

Commit your goldens, or get your explicit go-ahead, before the agent runs any of them. The skill tells the agent to ask first.

**Frozen data.** The atlas is only useful if every run sees the same data. Ask the agent to find or build a snapshot of the app's data that the app reads when it starts. A snapshot can contain real user data, so check what it holds before committing it. Screenshots show whatever the app shows, and they are committed with the goldens.

**Do not give an agent approval in CI.** CI should run `check` only. `approve-new` and `approve-all` accept whatever was captured, and approval is a human decision. Never add `--force` to a CI job.

**Commands run on your machine.** The `server.command` in `atlas.config.ts` is a shell command that the atlas starts. Read it before you run capture. The same goes for any command the agent proposes to add.

**The skill tells the agent to avoid commands that open a browser or never exit.** If the agent starts `npm run review` or `npm run atlas` in a terminal, stop it. Run those yourself when you want to look at the results.
