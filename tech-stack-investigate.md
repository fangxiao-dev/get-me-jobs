# Technology Investigation

## Role

This document records the current technical direction for `job-finder`. It complements `project-context.md` and should stay concise until the project needs heavier architecture.

## Current Direction

- Runtime: Node.js 22.
- Data format: JSON files for raw, selected, annotations, and preferences.
- Frontend: local browser UI with vanilla HTML/CSS/JS for the first milestone.
- Backend: lightweight local Node HTTP server.
- External integration: Apify REST API / Apify Task workflow.
- Skills:
  - `apify-task-runner` for Task execution and Dataset retrieval.
  - planned `preference-analyse` for annotation analysis and preference update proposals.

## Why This Fits

- The workflow is local-first and file-based.
- JSON keeps Apify raw output auditable and re-processable.
- A lightweight Node server can safely read/write local annotation files.
- Avoiding a database and frontend framework keeps the first review loop small.

## Current Commands

Re-run selection from raw data:

```powershell
node scripts/select-jobs.mjs raw/2026-04-25.json selected/2026-04-25.json config/preferences.linkedin.json
```

Planned local UI:

```powershell
node app/server.mjs
```

## Open Technical Questions

- Whether to introduce SQLite after annotations grow.
- Whether to add a scoring layer in addition to `must` / `exclude`.
- Whether to add a small package manifest once the local UI server exists.
