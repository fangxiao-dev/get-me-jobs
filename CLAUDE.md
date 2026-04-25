# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See [.AGENTS.md](.AGENTS.md) for agent rules, boundaries, and verification steps.

## Commands

Regenerate selected jobs from raw data:
```powershell
node scripts/select-jobs.mjs data/raw/2026-04-25.json data/selected/2026-04-25.json config/preferences.linkedin.json
```

Start Review UI (opens browser automatically):
```powershell
node scripts/start-review.mjs
```

Start without opening a browser:
```powershell
node scripts/start-review.mjs --no-open
```

Check dashboard data consistency:
```powershell
node scripts/check-dashboard-data.mjs
```

## Architecture

**Runtime:** Node.js 22, no framework, no build step. Scripts use `.mjs` with Node built-in modules. Frontend is vanilla HTML/CSS/JS served by a lightweight local HTTP server (`app/server.mjs`).

**Pipeline (current):**
```
Apify Task
  -> data/raw/<date>.json           (append-only, never mutate)
  -> scripts/select-jobs.mjs
     + config/preferences.linkedin.json
  -> data/selected/<date>.json
  -> app/server.mjs (Review UI)
  -> data/annotations/<date>.<source>.json
  -> data/accepted-jobs.json        (deduped across batches)
  -> data/applications.json         (application status + timeline)
  -> preference-analyse skill       (proposal only, confirm before applying)
  -> config/preferences.linkedin.json
```

**Planned: Canonical Daily Merge** (`docs/plans/2026-04-25-canonical-daily-merge-design.md`)  
Not yet implemented. Will insert an adapt+merge step between `data/raw/` and selection, producing `data/canonical/<date>.json` as the stable input for selection and Review UI. Raw filenames will change to `<source>-<yyyy-mm-dd>-<hhmmss>.json`. Until this lands, the current flat `<date>.json` convention is authoritative.

**Planned: Feedback Loops** (`docs/plans/2026-04-25-feedback-loops-design.md`)  
Not yet implemented. Two loops stay strictly separate:
- **Input preference loop** — `accept/reject/maybe`, `applied`, Dashboard `reject`, and subjective notes → may propose changes to `config/preferences.linkedin.json`.
- **Market-fit loop** — interview, offer, and rejection signals → future analysis only, never writes to preference config.

## Key Constraints

- `config/preferences.linkedin.json` is the single source of truth for filtering rules. Change the JSON, then rerun `select-jobs.mjs` to regenerate selected output.
- Annotations are keyed by job ID. Rerunning selection or merging new raw data must not touch annotation files.
- `data/raw/` is append-only.
- `.env` holds the local Apify token; do not commit it.
