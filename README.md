# job-finder

Local workflow for collecting job-description data, filtering thesis/AI-related jobs, reviewing results, and tracking applications.

## Workflow

```text
Apify Task
  -> data/raw/<batch>.json
  -> scripts/select-jobs.mjs + config/preferences.linkedin.json
  -> data/selected/<batch>.json
  -> Review UI
  -> data/annotations/<batch>.<source>.json
  -> Dashboard
  -> preference-analyse
  -> confirmed preference update
```

## Data Layout

- `data/raw/*.json`: raw Apify dataset exports.
- `data/selected/*.json`: selected jobs generated from preferences.
- `data/annotations/*.json`: local review labels, notes, and tags.
- `data/accepted-jobs.json`: accepted jobs deduped across batches.
- `data/applications.json`: application timeline and status tracking.
- `config/preferences.linkedin.json`: editable input filter rules.

`data/annotations/`, `data/accepted-jobs.json`, and `data/applications.json` are local runtime state and are ignored by git.

## Common Commands

Regenerate selected jobs:

```powershell
node scripts/select-jobs.mjs data/raw/2026-04-25.json data/selected/2026-04-25.json config/preferences.linkedin.json
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
