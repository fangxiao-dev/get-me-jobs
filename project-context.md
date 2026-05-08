# Project Context

## Project Summary

- Name: `job-finder`
- Project type: local data workflow / internal tool
- Purpose: collect job-description data from multiple raw-source channels, filter it with editable preferences, review accepted jobs, and track applications locally.
- Primary user: the repository owner, reviewing thesis/job opportunities locally.
- Current phase: bootstrap workflow and review loop.

## Workflow

```text
Raw source channels
  -> Apify LinkedIn task channel (apify_linkedin)
  -> Local LinkedIn assisted collector (localLinkedin)
  -> data/raw/linkedin-YYYY-MM-DD-HHMMSS.json
  -> scripts/finalize-review-batch.mjs
  -> data/canonical/YYYY-MM-DD.json
  -> scripts/select-jobs.mjs + config/preferences.linkedin.json
  -> data/selected/<date>.json
  -> data/enrichments/<date>.json for selected jobs
  -> local Review UI
  -> data/annotations/<date>.json
  -> data/accepted-jobs.json
  -> data/applications.json
  -> Application Dashboard
  -> preference-analyse skill
  -> confirmed preference update
```

## Current Milestone

Build a local review and application dashboard where selected/rejected jobs can be reviewed with:

- `accept`
- `reject`
- `maybe`
- natural-language notes
- optional tags

Then use annotations to infer preference improvements, proposed by a separate `preference-analyse` skill and applied only after user confirmation.

Accepted jobs are deduped across batches and collected into the dashboard. The dashboard tracks application status and timeline events.

Preference learning and market feedback are separate loops:

- Preference loop: user intent signals such as `accept`, `reject`, `maybe`, `applied`, Dashboard `reject`, and subjective notes. This can propose changes to `config/preferences.linkedin.json`.
- Market-fit loop: employer/market response signals such as interview stages, employer agreement, rejection, or no response. This is for future analysis and must not directly update input filters.

## Repository Facts

- `.env`: local Apify token and Task IDs. Do not commit.
- `config/job-sources.manifest.json`: tracked channel manifest for raw-source intake and review finalization.
- `config/local/linkedin-assisted.input.json`: ignored local input for the assisted LinkedIn collector. Do not commit.
- `data/raw/linkedin-YYYY-MM-DD-HHMMSS.json`: raw-source outputs from Apify LinkedIn tasks and local assisted collection.
- `data/canonical/YYYY-MM-DD.json`: merged canonical batch from all raw-source files for a date.
- `data/selected/YYYY-MM-DD.json`: filtered output from current preferences.
- `data/enrichments/YYYY-MM-DD.json`: AI enrichment for selected jobs.
- `config/preferences.linkedin.json`: data-driven filter rules.
- `scripts/select-jobs.mjs`: deterministic filtering script.
- `docs/plans/2026-04-25-review-ui-preference-analysis-design.md`: approved workflow design.
- `docs/plans/2026-04-25-review-ui-preference-analysis.md`: implementation plan.
- `docs/plans/2026-04-25-feedback-loops-design.md`: preference vs market-fit signal boundary.
- `data/accepted-jobs.json`: runtime accepted-job registry, created by the UI.
- `data/applications.json`: runtime application timeline store, created by the UI.
- `data/annotations/*.json`: human review labels.

## Scope

In scope:

- Raw source ingestion from Apify LinkedIn tasks and the local LinkedIn assisted collector.
- Local raw and selected JSON files.
- Editable preference rules.
- Human review annotations.
- Accepted-job registry and application status dashboard.
- Preference analysis and proposed preference updates.

Out of scope for now:

- Hosted production app.
- Database-backed storage.
- Automatic preference updates without confirmation.
- Fully automated LinkedIn crawling or background scheduling.

## Confirmed Facts

- Apify token is read locally from `.env`.
- Channel-specific Task IDs use names like `TASKID_LINKEDIN`.
- Raw-source channel switches are tracked in `config/job-sources.manifest.json`; the Apify channel key is `apify_linkedin`.
- Local LinkedIn assisted collector input is ignored at `config/local/linkedin-assisted.input.json`.
- Multiple raw files for the same date merge into one canonical review batch.
- Selected count is local filtering behavior, not a source-channel failure.

## Open Questions

- Final annotation tag vocabulary.
- Whether future storage should remain JSON files or move to SQLite.
- How much scoring/ranking should supplement hard include/exclude rules.
