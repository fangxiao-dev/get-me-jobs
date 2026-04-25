# Review Merge Button Design

## Goal

Add a `Merge Raw` action to the Review page so the user can ingest newly saved raw files for the current date without leaving the UI.

## Scope

The button only handles local raw files that already exist under `data/raw/`. It does not trigger Apify, upload files, or modify annotations.

## User Flow

```text
User saves new raw file into data/raw/
  -> opens Review page for a date
  -> clicks Merge Raw
  -> server incrementally merges new raw files into data/canonical/<date>.json
  -> server regenerates data/selected/<date>.json
  -> UI reloads Review state
  -> newly selected/rejected jobs appear while prior annotations remain
```

## UI

Place a `Merge Raw` button in the Review page header next to the existing summary area. The button should be disabled while a merge is running.

After completion, show a compact status message:

- `Merged 50 raw jobs, added 48, duplicates 2, selected 12`
- `No new raw files`
- `Skipped stepstone-2026-04-25-153000.json: no adapter for source "stepstone"`

If the request fails, display the existing error banner.

## API

Add:

```http
POST /api/merge
content-type: application/json

{
  "date": "2026-04-25"
}
```

Response:

```json
{
  "ok": true,
  "date": "2026-04-25",
  "canonicalFile": "data/canonical/2026-04-25.json",
  "selectedFile": "data/selected/2026-04-25.json",
  "canonicalItems": 50,
  "selectedCount": 8,
  "files": [
    {
      "file": "linkedin-2026-04-25-114234.json",
      "source": "linkedin",
      "rawCount": 50,
      "addedCount": 50,
      "duplicateCount": 0
    }
  ]
}
```

No-new-raw is a successful response:

```json
{
  "ok": true,
  "date": "2026-04-25",
  "canonicalItems": 50,
  "selectedCount": 8,
  "files": [
    {
      "file": "linkedin-2026-04-25-114234.json",
      "skipped": true,
      "reason": "not newer than canonical watermark"
    }
  ]
}
```

## Server Design

Do not shell out from the server. Extract reusable functions from the existing CLI scripts:

- `scripts/merge-canonical.mjs` should export a function such as `mergeCanonicalForDate(date, options)`.
- `scripts/select-jobs.mjs` should export a function such as `selectJobsFile(rawPath, selectedPath, preferencesPath)`.
- The CLI entry points should keep working by calling those functions only when run directly.
- `app/server.mjs` should import those functions and call them in `/api/merge`.

This keeps CLI and UI behavior aligned and avoids platform-specific process handling.

## Data Behavior

The merge step must keep the current canonical guarantees:

- Use the daily canonical file's `mergeState.lastRawFileTime` and `processedRawFiles`.
- Only process raw files for the requested date.
- Skip raw files that are not newer than the watermark.
- Skip already processed raw files.
- Report unsupported sources as skipped entries.
- Do not mutate `data/annotations/<date>.json`.
- Regenerate selected jobs after merge, even if no new raw files were added, so preference changes can still be reflected.

## Testing

Add focused tests where practical:

- A server/API-level test can call the extracted merge/select functions directly instead of booting the HTTP server.
- Existing merge and selection unit tests should keep passing.
- Manual verification should cover clicking the button with no new raw files and with one new raw file whose timestamp is greater than the watermark.
