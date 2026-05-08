# Technology Investigation

## Role

This document records the current technical direction for `job-finder`. It complements `project-context.md` and should stay concise until the project needs heavier architecture.

## Current Direction

- Runtime: Node.js 22.
- Data format: JSON files for raw, selected, annotations, and preferences.
- Frontend: local browser UI with vanilla HTML/CSS/JS for the first milestone.
- Backend: lightweight local Node HTTP server.
- External integration: Apify REST API / Apify Task workflow plus local LinkedIn assisted collection.
- Source orchestration: tracked raw-source manifest in `config/job-sources.manifest.json`.
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
npm run review:finalize -- 2026-05-07
```

Run local LinkedIn assisted collection:

```powershell
npm run collect:linkedin:local
```

Local UI:

```powershell
node app/server.mjs
```

## Open Technical Questions

- Whether to introduce SQLite after annotations grow.
- Whether to add a scoring layer in addition to `must` / `exclude`.
- Whether future source channels should get dedicated collectors or only raw-file adapters.
