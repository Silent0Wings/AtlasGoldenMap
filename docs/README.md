# Golden Map Atlas documentation

Golden Map Atlas captures every screen of a web app as a golden screenshot. A person approves each change in a review UI, and the tool builds one offline dashboard that shows the UI as a graph. The pages below cover each task. Find the row that matches what you want to do.

## I want to...

| I want to | Read |
|---|---|
| Set up the tool and do a first run | [Getting started](getting-started.md) |
| Let an AI agent run the atlas for me | [Using it with an agent](using-with-an-agent.md), and [SKILL.md](SKILL.md) for the agent skill |
| See the short rules an agent must follow | [AGENTS.md](../AGENTS.md) |
| Look up a config option, a step helper or a CLI mode | The config reference and run modes in the root [README](../README.md#config-reference) |
| Use the control panel without typing commands | [Control panel](control-panel.md) |
| Call the local endpoints of the review and control servers | [HTTP API](http-api.md) |
| Know what the files in `goldens/`, `review/` and `shots/` contain | [Data formats](data-formats.md) |
| Fix a failing, flaky or unstable run | [Troubleshooting](../README.md#troubleshooting-1), and [Stabilize](../README.md#stabilize) |
| Adapt the atlas to a real app with live data | [Adapting Atlas to a real app](../README.md#adapting-atlas-to-a-real-app) |
| Understand how the parts fit together | [Architecture](architecture.md) |
| Change the tool itself | [Contributing](contributing.md) |

## Where things are

- **The root [README](../README.md)** is the full reference: setup, every config option, every run mode, the review workflow and the troubleshooting table.
- **[AGENTS.md](../AGENTS.md)** holds the short rules for an AI agent: which commands to run, what not to run, and when a human must decide.
- **This folder** holds task-oriented guides. Each page says what it covers at the top.

The project's own `atlas.config.ts` is the only file you edit to describe your app. Everything in `core/` is the generic engine.
