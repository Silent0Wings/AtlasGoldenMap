# Golden Map Atlas: notes for AI agents

This folder is Golden Map Atlas, a visual-regression tool for a web app. The app's map is `atlas.config.ts`. Keep app-specific code out of `core/`. The full reference is `README.md`.

## Commands

Use these. Each one runs to completion without prompts.

```sh
npm run init -- --url <url> --command "<start command>"   # new app: writes atlas.config.ts; clears goldens (commit first)
npm run capture                                          # screenshots and records; changes no goldens
npm run stabilize -- --runs 3                            # shots that differ between runs; exit 1 if any
npm run check                                            # exit 1 unless every record is match or volatile
npm run approve-new                                      # first baseline only
```

Do not run `npm run config` (interactive), `npm run review` (keeps running until Ctrl+C), or `npm run atlas` and `npm run build` (they open a browser). `npm run clean -- --goldens` deletes goldens.

## Rules

1. Stabilize before approve. Do not run `approve-new` or `approve-all` until `npm run stabilize -- --runs 3` ends with `[OK]`, or until you have fixed what it reports.
2. Approval is a human decision. Use `approve-new` only for the first baseline. Do not approve `changed`, `stale` or `unsettled` shots unless a person has reviewed them.
3. Do not pass `--force` to an approval command unless a person asks for it.
4. Never approve in CI.
5. A new baseline is trusted only after `npm run check` passes three times in a row.
6. Capture frozen data, never live data. Stop what moves with `mask`, `freezeCss`, `freezeCanvas`, `ready`, `readyAfter` or `volatile: true`.
7. Read the stabilize table before changing anything. Its "likely cause" column names the kind of change.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Large diff over a card, changes every run | Canvas animation | `freezeCanvas` (default `mask`); a CSS animation needs a `freezeCss` rule |
| Thin line differs between runs | Border or loading bar mid-animation | Hide it with `freezeCss` or `mask` |
| Shot shows content from before a search | `ready` matched old content | `readyAfter: 'networkidle'`, or `afterResponse` on the step |
| `htmlChanged` with no pixel difference | Markup varies per render | Informational by default. `ignoreAttributes` for random values; `failOnHtml: true` if the markup is the test |
| Timeouts only in the first tests of a run | Cold start, too many workers | Keep `warmup` on, lower `workers` |
| `stale` after a config edit that never clears | Golden predates the edit | Re-capture that node, then approve it |
| Shot count varies between runs | Collection shot before its data loaded | Stricter `ready` on the collection's page |
| `approve-new` or `approve-all` refuses | A non-visual failure, an `unsettled` record, or unstable shots | Fix the cause, then run again. Do not use `--force` on your own |
