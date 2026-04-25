# Review UI And Preference Analysis Design

## Goal

Build a local feedback loop for job-search results:

```text
raw/*.json
  -> scripts/select-jobs.mjs
  -> selected/*.json
  -> local Review UI
  -> annotations/*.json
  -> preference-analyse skill
  -> preference proposal / diff
  -> user confirmation
  -> config/preferences.linkedin.json update
```

## Current Context

The project currently has:

- `raw/2026-04-25.json`: Apify Dataset result from LinkedIn.
- `selected/2026-04-25.json`: rule-selected jobs.
- `config/preferences.linkedin.json`: data-driven LinkedIn filtering rules.
- `scripts/select-jobs.mjs`: deterministic selector.

The first successful Apify run returned 50 raw entries. The current preference rules select 8 entries. This is a local filtering result, not an Apify failure.

## Recommended Approach

Use a lightweight local Node server with static frontend assets.

```text
app/
  server.mjs
  public/
    index.html
    app.js
    styles.css

annotations/
  2026-04-25.linkedin.json

config/
  preferences.linkedin.json

scripts/
  select-jobs.mjs
```

This avoids unnecessary framework setup while still allowing reliable local file reads and writes.

## Review UI

The UI should open in `Selected` mode by default and allow switching between:

- `Selected`: jobs already selected by `config/preferences.linkedin.json`.
- `Raw`: all jobs from the raw Apify result.
- `Rejected`: jobs in raw but not selected.

Each job card should show enough information for quick review:

- title
- company
- location
- posted date
- LinkedIn URL / apply URL
- matched selection reasons when present
- description preview with expandable full text

Each item supports:

- `accept`
- `reject`
- `maybe`
- freeform natural-language `note`
- optional tags such as `good_topic`, `not_ai`, `not_thesis`, `too_broad`, `good_company`, `language_issue`

The UI should autosave after each decision or note update.

## Annotation Format

Annotations are raw human labels and should stay separate from preferences.

```json
{
  "source": "linkedin",
  "rawFile": "raw/2026-04-25.json",
  "selectedFile": "selected/2026-04-25.json",
  "createdAt": "2026-04-25T00:00:00.000Z",
  "updatedAt": "2026-04-25T00:00:00.000Z",
  "items": [
    {
      "id": "4405313639",
      "decision": "accept",
      "note": "GenAI + ML, thesis/internship acceptable, looks relevant",
      "tags": ["good_topic"],
      "reviewedAt": "2026-04-25T00:00:00.000Z"
    }
  ]
}
```

The job `id` should be the source job ID when present. The server can merge annotations with raw/selected data at read time.

## Preference Analysis Skill

Create a separate `preference-analyse` skill with bundled references and scripts:

```text
preference-analyse/
  SKILL.md
  references/
    annotation-schema.md
    preference-schema.md
    analysis-workflow.md
  scripts/
    summarize-annotations.mjs
    propose-preference-diff.mjs
```

Responsibilities:

- Scripts perform deterministic statistics:
  - accepted/rejected/maybe counts
  - selected false positives
  - raw false negatives
  - accepted common terms
  - rejected common terms
  - current rule match summaries
- Skill performs semantic analysis:
  - read user notes
  - infer preference patterns
  - propose preference changes
  - explain tradeoffs
  - produce a patch proposal
- The skill should not update `config/preferences.linkedin.json` without user confirmation.

## Boundaries

- `apify-task-runner`: fetches data from Apify.
- `scripts/select-jobs.mjs`: applies explicit preference rules.
- Review UI: captures human judgments and notes.
- `preference-analyse`: analyzes annotations and proposes preference changes.
- `config/preferences.linkedin.json`: remains the single source of truth for current rules.

## Error Handling

- If raw file is missing, the UI should show a clear local error.
- If selected file is missing, the UI can still show raw and treat selected as empty.
- If annotations are missing, the server should create a new annotation file on first save.
- If annotation JSON is malformed, preserve the broken file with a `.bak` copy before writing a clean file.

## Testing

Test the deterministic parts first:

- API list loading returns selected/raw/rejected counts.
- Updating annotation writes stable JSON.
- Selected and rejected sets are computed by job ID.
- Preference analysis scripts summarize annotations correctly.

Manual browser verification:

- Open local UI.
- Switch between Selected, Raw, Rejected.
- Accept/reject/maybe an item.
- Add and edit a note.
- Refresh page and confirm annotation persists.
