# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See [AGENTS.md](AGENTS.md) for agent rules, boundaries, and verification steps.

## Commands

Run Apify LinkedIn collection and finalize today's review batch:
```powershell
npm run review:today
```

Run local LinkedIn assisted collection:
```powershell
npm run collect:linkedin:local
```

Finalize all raw-source files for a date:
```powershell
npm run review:finalize -- 2026-05-07
```

Merge raw source data into canonical file:
```powershell
node scripts/merge-canonical.mjs
```

Regenerate selected jobs from canonical data:
```powershell
node scripts/select-jobs.mjs data/canonical/2026-04-25.json data/selected/2026-04-25.json config/preferences.linkedin.json
```

Start Review UI (opens browser automatically):
```powershell
node scripts/start-review.mjs
```

Start without opening a browser:
```powershell
node scripts/start-review.mjs --no-open
```

Run lib unit tests:
```powershell
node --test scripts/lib/tests/*.test.mjs
```

Check dashboard data consistency:
```powershell
node scripts/check-dashboard-data.mjs
```

## Architecture

**Runtime:** Node.js 22, no framework, no build step. Scripts use `.mjs` with Node built-in modules. Frontend is vanilla HTML/CSS/JS served by a lightweight local HTTP server (`app/server.mjs`).

**Pipeline:**
```
Raw source channels
  -> channels.apify_linkedin                         (Apify LinkedIn Task channel)
  -> channels.localLinkedin                          (local assisted LinkedIn collector)
  -> data/raw/<source>-<yyyy-mm-dd>-<hhmmss>.json    (append-only, never mutate)
  -> scripts/finalize-review-batch.mjs
     scripts/merge-canonical.mjs
     scripts/lib/adapt-linkedin.mjs                  (source adapter)
     scripts/lib/canonical-merge.mjs                 (dedup + merge logic)
  -> data/canonical/<date>.json                      (stable canonical schema)
  -> scripts/select-jobs.mjs
     + config/preferences.linkedin.json
  -> data/selected/<date>.json
  -> scripts/enrich-jobs.mjs
  -> data/enrichments/<date>.json                     (selected-job AI enrichment)
  -> app/server.mjs (Review UI)
  -> data/annotations/<date>.json                    (keyed by identity.jobId)
  -> data/accepted-jobs.json                         (deduped across batches)
  -> data/applications.json                          (application status + timeline)
  -> preference-analyse skill                        (proposal only, confirm before applying)
  -> config/preferences.linkedin.json
```

**Canonical schema** (`data/canonical/<date>.json`): Each item has `identity.jobId` (`"<source>:<id>"`), nested `title`, `company`, `location`, `description`, `links`, `employment`, `postedAt` objects, and `sightings[]` tracking every raw file the job appeared in. Deduplication keys are in `identity.dedupeKeys`.

**Source manifest** (`config/job-sources.manifest.json`): Tracked non-secret channel config. `channels.apify_linkedin` controls Apify LinkedIn task intake. `channels.localLinkedin` points to ignored local input at `config/local/linkedin-assisted.input.json`. Keep Cookie paths and User-Agent values out of the manifest.

**Planned: Feedback Loops** (`docs/plans/2026-04-25-feedback-loops-design.md`)  
Not yet implemented. Two loops stay strictly separate:
- **Input preference loop** — `accept/reject/maybe`, `applied`, Dashboard `reject`, and subjective notes → may propose changes to `config/preferences.linkedin.json`.
- **Market-fit loop** — interview, offer, and rejection signals → future analysis only, never writes to preference config.

**Planned: Feedback Loops** (`docs/plans/2026-04-25-feedback-loops-design.md`)  
Not yet implemented. Two loops stay strictly separate:
- **Input preference loop** — `accept/reject/maybe`, `applied`, Dashboard `reject`, and subjective notes → may propose changes to `config/preferences.linkedin.json`.
- **Market-fit loop** — interview, offer, and rejection signals → future analysis only, never writes to preference config.

## Key Constraints

- `config/preferences.linkedin.json` is the single source of truth for filtering rules. Change the JSON, then rerun `select-jobs.mjs` to regenerate selected output.
- Annotations (`data/annotations/<date>.json`) are keyed by `identity.jobId` (e.g., `"linkedin:123"`). Rerunning selection or merging new raw data must not touch annotation files.
- `data/raw/` is append-only.
- `.env` holds the local Apify token; do not commit it.
- `config/local/linkedin-assisted.input.json` holds local LinkedIn Cookie path and User-Agent; do not commit or print it.
