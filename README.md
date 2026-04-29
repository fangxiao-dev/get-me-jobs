# job-finder

Local workflow for collecting job-description data, filtering thesis/AI-related jobs, reviewing results, and tracking applications.

## Workflow

```text
Apify Task
  -> data/raw/<source>-YYYY-MM-DD-HHMMSS.json
  -> scripts/merge-canonical.mjs
  -> data/canonical/YYYY-MM-DD.json
  -> scripts/select-jobs.mjs + config/preferences.linkedin.json
  -> data/selected/<batch>.json
  -> Review UI
  -> data/annotations/<batch>.json
  -> Dashboard
  -> preference-analyse
  -> confirmed preference update
```

Manual LinkedIn JD import:

```text
Dashboard Add LinkedIn JD
  -> data/manual/linkedin-YYYY-MM-DD.json
  -> data/manual/audit/linkedin-manual-YYYY-MM-DD-HHMMSS.json
  -> accepted/application upsert
  -> scripts/merge-canonical.mjs can merge manual daily input
```

## Data Layout

- `data/raw/*.json`: raw Apify dataset exports, named by source and timestamp.
- `data/manual/linkedin-YYYY-MM-DD.json`: daily aggregate for manually imported LinkedIn JDs, deduped by LinkedIn job id.
- `data/manual/audit/*.json`: one-file-per-manual-import audit records for debugging scraper/adapter behavior.
- `data/canonical/*.json`: merged canonical jobs across raw and manual sources.
- `data/selected/*.json`: selected jobs generated from canonical jobs and preferences.
- `data/annotations/*.json`: local review labels, notes, and tags.
- `data/accepted-jobs.json`: accepted jobs deduped across batches.
- `data/applications.json`: application timeline and status tracking.
- `config/preferences.linkedin.json`: editable input filter rules.

`data/annotations/`, `data/accepted-jobs.json`, `data/applications.json`, `data/canonical/`, `data/manual/`, `data/raw/`, and `data/selected/` are local runtime state and are ignored by git.

## Common Commands

Run all configured Apify `TASKID_*` tasks from `.env`, then merge/select today's review batch:

```powershell
npm run review:today
```

Project-local skill: `.agents/skills/get-jobs/SKILL.md` maps requests like "get jobs" or "收集工作" to this command.

Regenerate selected jobs:

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
node C:\Users\Xiao\.codex\skills\preference-analyse\scripts\summarize-annotations.mjs data/raw/2026-04-25.json data/selected/2026-04-25.json data/annotations/2026-04-25.linkedin.json config/preferences.linkedin.json
```

Preference file updates should only be applied after explicit confirmation.

## Notes

- Do not trigger Apify runs unless explicitly requested.
- Do not mutate files in `data/raw/`.
- Keep filtering rules data-driven in `config/preferences.linkedin.json`.
- This project currently uses Node.js built-in modules and vanilla HTML/CSS/JS.
