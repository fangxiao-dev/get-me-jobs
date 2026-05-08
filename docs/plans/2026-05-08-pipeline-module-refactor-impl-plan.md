# Pipeline Module Refactor Patch Implementation Plan

## Goal

Make the current job pipeline easier to extend and test by moving three overloaded areas behind deeper modules:

1. selection/deletion classification
2. Review State assembly
3. manual add source adapters

The refactor must preserve current behavior:

- raw and canonical files remain unchanged
- hard-rule deleted jobs stay out of Selected and Rejected
- historical rejects and accepted duplicates stay hidden from active review queues
- accepted duplicates stay hidden from Selected, Rejected, and Deleted
- manual add still writes raw/audit records, upserts Accepted/Application, and enriches accepted jobs
- selector idempotence behavior is preserved; do not fix metadata-sensitive rewrites in this patch

## Accepted Review Decisions

Source review: `docs/exchange/grill-me-pipeline-module-refactor-20260508-140543.md`.

Accepted decisions for this implementation:

- Add shared identity helpers before moving Review State.
- `app/review-state.mjs` must not import from `app/server.mjs`; dependency direction is server -> review-state.
- Review State and batch metadata must support dependency injection for temp-root tests.
- `loadReviewState` supports both `acceptedJobs` data and `acceptedJobsPath`; tests should prefer direct `acceptedJobs`.
- Manual source adapters stay in `scripts/lib/manual-source-adapters.mjs`.
- Manual source detection must be adapter-driven through `supportsUrl(url)`.
- `classifyJobs` returns classifications and stats only, not ready-to-write documents.
- Preserve current selector idempotence instead of changing it in this refactor.
- Replace brittle source-string tests against `app/server.mjs` with adapter contract tests.
- Verification must test default manifest behavior, start the server before HTTP checks, and check `git status` afterward.
- Review State path and JSON helper contracts must be explicit, not implicit.
- Manual import AI enrichment verification must be deterministic and must not depend on real `codex` or `claude` CLI availability.
- Implementation must start with a dirty-worktree preflight and preserve existing user changes.

## Deferred

Do not include these in this patch:

- golden snapshot tests for complete selected/deleted files
- runtime adapter contract validation helper
- central source-label/source-registry abstraction
- expanding Review batch listing beyond the current seven most recent batches
- exporting classifier helper functions unless implementation proves it unavoidable

## Preflight

Before implementation:

```powershell
git status --short
```

Rules:

- Treat existing modified and untracked files as user or prior-session changes.
- Do not revert unrelated changes.
- If any target file already has changes, inspect it before editing and integrate with its current state.
- If a planned new module already exists, update the existing file instead of recreating it.
- Keep `data/*` as local runtime data unless the user explicitly asks to commit a data snapshot.

## Patch 0: Shared Job Identity Helpers

### Current Problem

Review State and dashboard logic rely on identity helpers currently private to `app/server.mjs`, including:

- `safeJobId`
- `jobKey`
- canonical URL normalization
- text normalization

Moving Review State without extracting these helpers would either create a circular import or duplicate identity semantics.

### Target Shape

Create:

```text
scripts/lib/job-identity.mjs
```

Export:

```js
safeJobId(item)
jobKey(source, item)
canonicalUrl(value)
normalizeText(value)
```

### Implementation Steps

1. Move the current helper behavior from `app/server.mjs` into `scripts/lib/job-identity.mjs`.
2. Update `app/server.mjs` to import these helpers.
3. Use the same helpers from `app/review-state.mjs` in Patch 2.
4. Keep behavior identical for identity fallback order and LinkedIn tracking-parameter removal.

### Required Tests

- Existing dashboard tests must keep passing.
- Add focused tests if identity behavior is not already covered by dashboard/review-state tests.

## Patch 1: Selection/Deletion Classifier

### Current Problem

`scripts/select-jobs.mjs` mixes rule evaluation, hard-rule deletion, selected/deleted output shape, idempotence checks, and file writing. This makes new hard rules and preference rules harder to add safely.

### Target Shape

Create a pure classifier module:

```text
scripts/lib/job-classifier.mjs
```

Interface:

```js
classifyJobs({ raw, preferences })
```

Returns classifications and stats only:

```js
{
  selected: [{ item, match }],
  deleted: [{ item, deleted }],
  stats: {
    rawCount,
    selectedCount,
    deletedCount
  }
}
```

`scripts/select-jobs.mjs` remains the file I/O wrapper:

- read canonical/raw file
- read preferences
- call `classifyJobs`
- format selected/deleted documents
- preserve current selected/deleted output schema
- preserve current idempotence comparison and `savedAt` behavior
- write `data/selected/YYYY-MM-DD.json`
- write `data/deleted/YYYY-MM-DD.json`
- preserve existing return fields and CLI behavior

Non-goal:

- Do not add `forceWrite` or metadata-sensitive rewrite behavior in this patch. That belongs to the reject-preference-update plan, not this refactor.

### Implementation Steps

1. Move these responsibilities from `scripts/select-jobs.mjs` into `scripts/lib/job-classifier.mjs`:
   - `toText`
   - `getField`
   - `pickFields`
   - `termMatches`
   - `evaluateRule`
   - freshness hard-rule evaluation
   - selected/deleted classification
2. `classifyJobs` must continue using `raw.date` as the batch date for freshness deletion.
3. Keep `selectJobsFile` as the only file I/O wrapper for this flow.
4. Export only `classifyJobs`; export small test-facing helpers only if implementation proves it unavoidable.
5. Keep output schema identical to current selected/deleted files.
6. Preserve current selector idempotence behavior, including same selected/deleted IDs plus same preferences metadata not rewriting `savedAt`.

### Required Tests

- AI/automation positive match.
- Exclude rule blocks selected.
- `posted_too_old` produces deleted metadata.
- Missing `postedAt` is not deleted.
- Invalid `postedAt` is not deleted.
- Missing or invalid `raw.date` does not hard-delete by freshness rule.
- Classifier tests assert match/deleted metadata shape, not only counts.
- `selectJobsFile` tests assert selected/deleted file schema preservation.
- `selectJobsFile` tests assert current idempotence behavior is preserved.

## Patch 2: Review State Module

### Current Problem

`app/server.mjs` builds Review State inline while also serving HTTP, dashboard state, manual imports, and application events. The selected/rejected/deleted derivation is important domain logic and should be testable without importing the server.

### Target Shape

Create:

```text
app/review-state.mjs
```

Interface:

```js
loadReviewState({
  rootDir,
  batchId,
  canonicalFile,
  selectedFile,
  dirs,
  readJson,
  acceptedJobs,
  acceptedJobsPath
})
```

Accepted-job input behavior:

- Prefer `acceptedJobs` when provided; this is the test-friendly path.
- Otherwise read from `acceptedJobsPath` when provided.
- Otherwise default to `data/accepted-jobs.json` under `rootDir`.

Returns the same API shape currently returned by `/api/state`:

```js
{
  date,
  batchId,
  files,
  counts,
  items,
  annotations,
  enrichments
}
```

Also move batch listing:

```js
listBatchMetadata({
  rootDir,
  dirs,
  readJson,
  acceptedJobs,
  acceptedJobsPath
})
```

`dirs` shape:

```js
{
  canonicalDir,
  selectedDir,
  deletedDir,
  annotationsDir,
  enrichmentsDir
}
```

All directory values are optional and default under `rootDir/data`.

`readJson` contract:

```js
readJson(filePath, fallback)
```

The injected reader must return `fallback` for missing files and throw for malformed JSON, matching current `app/server.mjs` behavior.

Dependency rule:

- `app/server.mjs` imports `loadReviewState` and `listBatchMetadata`.
- `app/review-state.mjs` must not import from `app/server.mjs`.
- Shared identity behavior comes from `scripts/lib/job-identity.mjs`.

### Implementation Steps

1. Move Review-only helpers into `app/review-state.mjs`:
   - historical reject id loading
   - annotation map creation
   - selected/rejected/deleted item derivation
   - duplicate accepted filtering
   - batch metadata counts
   - `batchIdFromFile`
   - latest canonical file resolution
   - review data file resolution for canonical/selected overrides
   - annotation/deleted/enrichment path resolution
2. Use `safeJobId` and `jobKey` from `scripts/lib/job-identity.mjs`.
3. Keep generic dashboard/application helpers in `app/server.mjs` unless they are needed by Review State.
4. Update `app/server.mjs` so `/api/state` and `/api/batches` call `loadReviewState` and `listBatchMetadata`.
5. Existing Review State tests in `application-dashboard.test.mjs` should import from `app/review-state.mjs`.
6. Dashboard/application tests should continue importing dashboard helpers from `app/server.mjs`.
7. Leave HTTP route behavior unchanged.

### Required Tests

- Deleted items do not count as Rejected.
- Historical rejects do not re-enter Selected.
- Accepted duplicates are hidden from Selected.
- Accepted duplicates are hidden from Rejected.
- Accepted duplicates are hidden from Deleted.
- Batch metadata keeps `totalCount = selectedCount + rejectedCount`.
- Batch metadata includes `deletedCount` but excludes deleted from `totalCount`.
- Missing deleted file behaves as empty deleted queue for older batches.
- Review State tests use temp roots and injected `acceptedJobs` where practical.
- Review State tests cover custom `dirs` and injected `readJson(filePath, fallback)` behavior.
- Server route tests or smoke checks confirm `/api/state` and `/api/batches` response shape is unchanged.

## Patch 3: Manual Add Source Adapter Flow

### Current Problem

Manual add logic in `app/server.mjs` knows too much about each source:

- scrape function
- raw item conversion
- canonical adapter
- raw store writer
- audit writer
- source labels
- URL source detection

This will become noisy as more job sources are added.

### Target Shape

Create:

```text
scripts/lib/manual-source-adapters.mjs
```

Interface:

```js
detectManualImportSource(url)
manualSourceAdapter(source)
manualSourceAdapters
```

Adapter shape:

```js
{
  source,
  sourceLabel,
  supportsUrl(url),
  scrape(url),
  toRawItem(extracted, now),
  adapt(rawItem, context),
  upsertRaw(rootDir, rawItem, now),
  writeAudit(rootDir, rawItem, now)
}
```

Source detection must iterate `manualSourceAdapters` and use `supportsUrl(url)`.

`app/server.mjs` keeps orchestration only:

```text
url -> adapter -> raw/audit -> adapted job -> accepted/application upsert -> AI enrichment
```

The adapter module must not import `app/server.mjs`.

Manual import orchestration must remain testable without real network scraping or real AI CLI calls. If needed, export a testable orchestration function from `app/server.mjs` with dependency injection for:

- selected adapter or adapter resolver
- `rootDir`
- current time
- accepted/application load and save functions
- canonical duplicate lookup
- AI enrichment function

Default route behavior must continue to use the real scraper, real stores, and `upsertManualImportAiEnrichment`.

### Implementation Steps

1. Move `manualImportConfigs` and source detection from `app/server.mjs` to `scripts/lib/manual-source-adapters.mjs`.
2. Implement LinkedIn and Stepstone `supportsUrl(url)` methods.
3. Keep existing LinkedIn and Stepstone scraping, raw conversion, canonical adaptation, raw-store, audit-store, and labels identical.
4. Update `importManualJobUrl` to call `manualSourceAdapter(source)` when `payload.source` is provided.
5. Update `importManualJobUrl` to call `detectManualImportSource(url)` when `payload.source` is omitted.
6. Preserve unsupported auto-detection error wording exactly:

   ```text
   Unsupported job URL source. Supported sources: LinkedIn, Stepstone
   ```

7. Preserve explicit unsupported source error behavior:

   ```text
   Unsupported manual import source: <source>
   ```

8. Replace the current test that reads `app/server.mjs` source text with adapter contract tests.
9. Add deterministic tests for manual import orchestration by injecting fake adapter functions and fake AI enrichment.

### Required Tests

- LinkedIn URL selects LinkedIn adapter.
- Stepstone URL selects Stepstone adapter.
- Unsupported URL gives the existing auto-detection error wording.
- Explicit unsupported source gives the existing explicit-source error wording.
- LinkedIn adapter exposes all required functions.
- Stepstone adapter exposes all required functions.
- Existing manual import upsert/dedupe tests keep passing.
- Manual import orchestration calls AI enrichment after Accepted/Application upsert, verified with an injected fake enrichment function.
- `upsertManualImportAiEnrichment` remains covered with injected `analyze` and must not require real `codex` or `claude` CLI in tests.

## Rollout and Verification

Run after each patch:

```powershell
node --test scripts/lib/tests/*.test.mjs
```

Run a pipeline smoke check with the default manifest path:

```powershell
node --input-type=module -e "import { finalizeReviewBatch } from './scripts/lib/review-finalize.mjs'; console.log(JSON.stringify(finalizeReviewBatch('2026-05-08', { logger: console }), null, 2));"
```

Also run the project-required finalize command for raw-source pipeline work:

```powershell
npm run review:finalize -- 2026-05-07
```

Start the local server in the background before HTTP verification:

```powershell
$env:PORT = "4173"
$serverProcess = Start-Process -FilePath node -ArgumentList 'app/server.mjs' -WorkingDirectory (Get-Location) -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
```

Verify Review State, then stop the server:

```powershell
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:$env:PORT/api/state?batch=2026-05-08"
  Invoke-RestMethod -Uri "http://127.0.0.1:$env:PORT/api/batches"
} finally {
  Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
}
```

If port `4173` is already in use, use another local port:

```powershell
$env:PORT = "4174"
```

Then run the same `Start-Process` and `Invoke-RestMethod` commands with `$env:PORT`.

Before claiming Review UI behavior is preserved, verify in the local UI or browser automation:

- Selected view loads.
- Rejected view loads.
- Deleted view loads.
- Annotation changes persist after refresh.
- Accepted jobs appear in the Dashboard.

Before claiming Dashboard behavior is preserved, run:

```powershell
node scripts/check-dashboard-data.mjs
```

Check workspace state after verification:

```powershell
git status --short
```

Treat `data/*` changes from smoke checks as local runtime data unless the user explicitly asks to commit a data snapshot.

## Acceptance Criteria

- All tests pass.
- Default manifest works without passing `manifestPath`.
- `npm run review:finalize -- 2026-05-07` passes.
- `node scripts/check-dashboard-data.mjs` passes.
- `data/selected/2026-05-08.json` keeps the same schema.
- `data/deleted/2026-05-08.json` keeps the same schema.
- Review UI still returns separate Selected, Rejected, and Deleted queues.
- Selected, Rejected, and Deleted views load in the UI.
- Annotation changes persist after refresh.
- Accepted jobs appear in the Dashboard.
- Hard-rule deleted jobs stay out of Rejected and out of `totalCount`.
- Historical rejects stay hidden from active Selected.
- Accepted duplicates stay hidden from Selected, Rejected, and Deleted.
- Manual LinkedIn and Stepstone imports still write raw/audit records.
- Manual LinkedIn and Stepstone imports still upsert Accepted/Application records.
- Manual LinkedIn and Stepstone imports still upsert AI enrichment.
- Tests do not require real `codex` or `claude` CLI availability for manual import AI enrichment.
- `app/review-state.mjs` does not import `app/server.mjs`.
- `scripts/lib/manual-source-adapters.mjs` does not import `app/server.mjs`.
