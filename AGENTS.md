# Agent Rules

## Project Context

Read these first:

1. `project-context.md`
2. `tech-stack-investigate.md`

This project is a local job-data workflow:

```text
Raw source channels -> data/raw JSON -> canonical merge -> preference filter -> data/selected JSON -> selected-job enrichment -> Review UI -> data/annotations -> accepted-job registry -> application dashboard -> preference analysis -> confirmed preference update
```

Raw source channels are configured in `config/job-sources.manifest.json`:

- `channels.apify_linkedin`: Apify LinkedIn Task channel using `.env` and `TASKID_*`.
- `channels.localLinkedin`: local assisted LinkedIn collector using ignored local input at `config/local/linkedin-assisted.input.json`.

Both channels write parseable `data/raw/linkedin-YYYY-MM-DD-HHMMSS.json` files. Use `npm run review:finalize -- YYYY-MM-DD` after one or both channels have produced raw files for a date.

## Boundaries

- Do not trigger Apify runs unless the user explicitly asks; runs may cost credits.
- Preserve raw source output in `data/raw/`; do not mutate raw data during filtering.
- Do not print LinkedIn Cookie values or local Cookie file contents. Manifest files must not contain Cookie paths or User-Agent values.
- Keep preferences data-driven in `config/preferences.linkedin.json`.
- Do not hide selection logic inside skills or frontend code.
- Do not update preferences from annotations without user confirmation.
- Treat `data/*` as local runtime data unless the user explicitly asks to commit a data snapshot.

## Current Files

- `config/job-sources.manifest.json`: tracked channel manifest; current Apify channel key is `apify_linkedin`.
- `config/local/linkedin-assisted.input.json`: ignored local LinkedIn collector input.
- `data/raw/*.json`: raw source files from Apify and local collectors.
- `data/canonical/*.json`: merged canonical jobs.
- `data/selected/*.json`: filter output.
- `data/enrichments/*.json`: selected-job AI enrichment output.
- `config/preferences.linkedin.json`: current filter rules.
- `scripts/select-jobs.mjs`: deterministic selector.
- `scripts/finalize-review-batch.mjs`: shared merge/select/enrich finalizer.
- `scripts/local-linkedin-assisted-collector/`: local LinkedIn assisted collector.
- `data/annotations/*.json`: human review labels.
- `data/accepted-jobs.json`: accepted jobs deduped across batches.
- `data/applications.json`: application status and timeline events.

## Development Rules

- Prefer small, local Node.js scripts using built-in modules unless a dependency is clearly justified.
- Keep the first UI simple: local Node server plus vanilla HTML/CSS/JS.
- For filtering changes, update preference JSON first, then rerun `scripts/select-jobs.mjs`.
- For human feedback, write annotations separately instead of editing raw or selected files manually.
- For new source channels, add a manifest channel and make it produce raw source files before changing merge/select/review behavior.

## Verification

Before claiming raw-source pipeline work is done, run:

```powershell
node --test scripts/lib/tests/*.test.mjs
npm run review:finalize -- 2026-05-07
```

Before claiming local LinkedIn collector work is done, run:

```powershell
Push-Location scripts/local-linkedin-assisted-collector
npm test
Pop-Location
```

Before claiming Review UI work is done, start the local server and verify:

```powershell
node app/server.mjs
```

Then check that Selected and Rejected views load, annotation changes persist after refresh, and accepted jobs appear in the Dashboard.

Before claiming Dashboard work is done, run:

```powershell
node scripts/check-dashboard-data.mjs
```
