# job-finder

Local workflow for collecting job-description data, filtering thesis/AI-related jobs, reviewing results, and tracking applications.

## Workflow

```text
Raw source channels
  -> Apify LinkedIn task channel (config key: apify_linkedin)
  -> Local LinkedIn assisted collector (config key: localLinkedin)
  -> data/raw/linkedin-YYYY-MM-DD-HHMMSS.json
  -> npm run review:finalize -- YYYY-MM-DD
     -> scripts/merge-canonical.mjs
     -> data/canonical/YYYY-MM-DD.json
     -> scripts/select-jobs.mjs + config/preferences.linkedin.json
     -> data/selected/YYYY-MM-DD.json
     -> scripts/enrich-jobs.mjs for selected jobs
     -> data/enrichments/YYYY-MM-DD.json
  -> Review UI selected/rejected queues
  -> data/annotations/YYYY-MM-DD.json
  -> Dashboard / accepted jobs / applications
  -> preference analysis proposal
  -> confirmed preference update
```

Raw-source channel configuration lives in `config/job-sources.manifest.json`. The manifest is tracked and contains only non-secret channel switches and paths. Local LinkedIn cookies and User-Agent stay in ignored local input at `config/local/linkedin-assisted.input.json`.

Manual LinkedIn JD import:

```text
Dashboard Add LinkedIn JD
  -> data/manual/linkedin-YYYY-MM-DD.json
  -> data/manual/audit/linkedin-manual-YYYY-MM-DD-HHMMSS.json
  -> accepted/application upsert
  -> scripts/merge-canonical.mjs can merge manual daily input
```

## Raw Source Channels

There are two supported job intake channels.

Apify LinkedIn channel:

```text
npm run review:today
  -> runs enabled TASKID_* Apify tasks from .env when channels.apify_linkedin.enabled is true
  -> writes one or more data/raw/linkedin-YYYY-MM-DD-HHMMSS.json files
  -> calls the shared review finalize flow
```

Local LinkedIn assisted channel:

```text
copy config/local/linkedin-assisted.input.example.json
  -> config/local/linkedin-assisted.input.json
npm run collect:linkedin:local
  -> opens one user-provided LinkedIn search page
  -> previews up to 25 job detail URLs
  -> waits for explicit YES confirmation
  -> extracts public job details
  -> writes data/raw/linkedin-YYYY-MM-DD-HHMMSS.json only when dryRun=false and writeRawSource=true
```

If both channels are used on the same date, run the finalize command once after both have produced raw files:

```powershell
npm run review:finalize -- 2026-05-07
```

`merge-canonical` reads all parseable raw files for that date and merges them into the same canonical review batch.

## Data Layout

- `config/job-sources.manifest.json`: tracked raw-source channel manifest with `apify_linkedin`, `localLinkedin`, and review finalize settings.
- `config/local/linkedin-assisted.input.json`: ignored local LinkedIn collector input containing search URL, Cookie path, and User-Agent.
- `data/raw/*.json`: raw source files from Apify and local collectors, named by source and timestamp.
- `data/manual/linkedin-YYYY-MM-DD.json`: daily aggregate for manually imported LinkedIn JDs, deduped by LinkedIn job id.
- `data/manual/audit/*.json`: one-file-per-manual-import audit records for debugging scraper/adapter behavior.
- `data/canonical/*.json`: merged canonical jobs across raw and manual sources.
- `data/selected/*.json`: selected jobs generated from canonical jobs and preferences.
- `data/enrichments/*.json`: selected-job AI enrichment records shown in Review/Dashboard.
- `data/annotations/*.json`: local review labels, notes, and tags.
- `data/accepted-jobs.json`: accepted jobs deduped across batches.
- `data/applications.json`: application timeline and status tracking.
- `config/preferences.linkedin.json`: editable input filter rules.

`data/annotations/`, `data/accepted-jobs.json`, `data/applications.json`, `data/canonical/`, `data/manual/`, `data/raw/`, and `data/selected/` are local runtime state and are ignored by git.

## Common Commands

Run all configured Apify LinkedIn `TASKID_*` tasks from `.env`, then finalize today's review batch:

```powershell
npm run review:today
```

Project-local skill: `.agents/skills/get-jobs/SKILL.md` maps requests like "get jobs" or "收集工作" to this command.

Run the local LinkedIn assisted collector:

```powershell
npm run collect:linkedin:local
```

Finalize a date after one or more raw-source channels have written raw files:

```powershell
npm run review:finalize -- 2026-05-07
```

Regenerate canonical and selected jobs manually:

```powershell
node scripts/merge-canonical.mjs 2026-04-25
node scripts/select-jobs.mjs data/canonical/2026-04-25.json data/selected/2026-04-25.json config/preferences.linkedin.json
```

Migrate legacy one-job manual raw files into the daily manual aggregate:

```powershell
node scripts/migrate-manual-linkedin.mjs
```

Start the Review UI with the latest raw batch:

```powershell
node scripts/start-review.mjs
```

Start without opening a browser:

```powershell
node scripts/start-review.mjs --no-open
```

Open Dashboard:

```text
http://127.0.0.1:4173/?source=linkedin&view=dashboard
```

Check dashboard data consistency:

```powershell
node scripts/check-dashboard-data.mjs
```

## Review UI

The Review UI has two queues:

- `Selected`: jobs that passed `config/preferences.linkedin.json`.
- `Rejected`: jobs that did not pass, plus jobs manually rejected later.

Each job supports:

- `accept`
- `reject`
- `maybe`
- tags
- natural-language notes

The shared filters support multi-select by:

- City
- State
- Company
- Workplace type
- Posted recency

## Dashboard

Accepted jobs are collected across batches. From the Dashboard, track:

- Applied, waiting for response
- Interview scheduled, preparing
- Interview completed, waiting for result
- Employer agreed, waiting for contract
- Closed / rejected / withdrawn

Dashboard `Reject` moves a job out of accepted/application tracking and writes it back as a rejected annotation.
Each dashboard job can also store a manual `Status` link for the employer application overview page, separate from the job description and apply links.
Stage notes are shown as a collapsed `Stage notes (N)` section on each dashboard card. Expanding it reveals only stage groups with notes; `accepted` provenance events are not counted as stage notes.

The Dashboard also supports manual LinkedIn JD import. Paste a LinkedIn job detail URL into `Add LinkedIn JD`; the app scrapes the public JD page, stores it in the daily manual aggregate, and upserts the job directly into Accepted/Application tracking. Manual imports intentionally leave `applyUrl` empty.

Manual import dedupe is explicit:

- Same job already in `data/manual/linkedin-YYYY-MM-DD.json`: update the daily manual item instead of appending a duplicate.
- Same job already in `data/accepted-jobs.json` or `data/applications.json`: update base job fields and preserve existing status, timeline, status URL, and stage notes.
- Same job already in canonical merge data: report the canonical duplicate in the Dashboard success message.

## Feedback Loops

Two feedback loops are intentionally separate.

Input preference loop:

- Answers: "Do I want to apply to this job?"
- Signals: Review `accept/reject/maybe`, Dashboard `applied`, Dashboard `reject`, and subjective notes.
- Output: proposed updates to `config/preferences.linkedin.json`.

Market-fit loop:

- Answers: "Does the employer or market respond positively?"
- Signals: interview stages, employer agreement, rejection, no response, and outcome notes.
- Output: future market-fit analysis and application strategy.
- It must not directly update `config/preferences.linkedin.json`.

## Preference Analysis

Use the global `preference-analyse` skill. Its scripts expect explicit paths:

```powershell
node C:\Users\Xiao\.codex\skills\preference-analyse\scripts\summarize-annotations.mjs data/canonical/2026-05-07.json data/selected/2026-05-07.json data/annotations/2026-05-07.json config/preferences.linkedin.json
```

For current batches, prefer canonical/selected review files generated by `npm run review:finalize -- YYYY-MM-DD`; raw-source files may be split across multiple `data/raw/linkedin-YYYY-MM-DD-HHMMSS.json` inputs for the same day.

Preference file updates should only be applied after explicit confirmation.

## Notes

- Do not trigger Apify runs unless explicitly requested.
- Treat `data/raw/` as append-only raw-source files.
- Keep filtering rules data-driven in `config/preferences.linkedin.json`.
- This project currently uses Node.js built-in modules and vanilla HTML/CSS/JS.
