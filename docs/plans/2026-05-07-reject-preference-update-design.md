# Explicit Reject Preference Update Design

## Goal

Add an explicit local workflow that analyzes manually rejected jobs and proposes updates to `config/preferences.linkedin.json`, especially for false positives that passed selection but were later rejected by the user.

The workflow must preserve the existing Input preference loop contract:

- Human review signals are stored in `data/annotations/<date>.json`.
- `config/preferences.linkedin.json` remains the single source of truth for selection rules.
- Preference changes are proposed only when explicitly requested.
- A reject click must never mutate preference rules by itself.
- Applying a proposal requires explicit confirmation.

## Problem

The project already records review decisions and has an empty reject-rule placeholder:

```json
{
  "id": "not_obvious_exclusion_yet",
  "description": "Keep empty until false positives are reviewed.",
  "fields": ["title.raw", "description.text"],
  "terms": []
}
```

However, there is no project-local command or API that turns rejected annotations into a usable preference proposal. The current result is a manual gap:

```text
Review/Dashboard reject
  -> data/annotations/YYYY-MM-DD.json
  -> no local proposal command
  -> no confirmed update path
```

## Proposed Workflow

Introduce two explicit command modes under one npm script:

```powershell
npm run preferences:update-rejects -- 2026-05-07
npm run preferences:update-rejects -- 2026-05-07 --apply data/preference-proposals/rejects-2026-05-07.json
```

Default mode is proposal-only. It reads local data, analyzes rejected jobs, prints a summary, and writes a proposal artifact. It does not change `config/preferences.linkedin.json`.

Apply mode reads a previously generated proposal artifact, validates that it still matches the current preference file, updates `config/preferences.linkedin.json`, and reruns selection for the same date.

## Inputs

For a date such as `2026-05-07`, the command reads:

```text
data/canonical/2026-05-07.json
data/selected/2026-05-07.json
data/annotations/2026-05-07.json
config/preferences.linkedin.json
```

The command should fail with a clear message when canonical or annotations files are missing. If selected output is missing, it may regenerate selection first by running the existing selector logic.

## Outputs

Proposal mode writes:

```text
data/preference-proposals/rejects-2026-05-07.json
```

`data/preference-proposals/` is runtime state and should be git-ignored.

Apply mode writes:

```text
config/preferences.linkedin.json
data/selected/2026-05-07.json
```

Apply mode should also print a concise before/after summary:

- original selected count
- new selected count
- rejected false positives removed
- accepted or maybe jobs that would now be excluded

If accepted or maybe jobs would be excluded by the proposed terms, apply mode should stop unless a future `--force` flag is added.

## Data Model

### Annotation Signal

Only annotations with `decision: "reject"` are candidates.

The first implementation should focus on selected false positives:

```text
annotation.decision == "reject"
AND annotation.id exists in data/selected/<date>.json
```

Rejected jobs that were already filtered out by current preferences are useful as background evidence, but they should not drive exclude-rule changes in the first pass because they are not current false positives.

Dashboard `reject` already writes rejected annotations, so no extra Dashboard-specific input file is needed for the first version.

### Proposal Schema

The proposal file should be deterministic JSON:

```json
{
  "schemaVersion": 1,
  "type": "reject_preference_update",
  "date": "2026-05-07",
  "createdAt": "2026-05-07T10:00:00.000Z",
  "inputs": {
    "canonicalFile": "data/canonical/2026-05-07.json",
    "selectedFile": "data/selected/2026-05-07.json",
    "annotationsFile": "data/annotations/2026-05-07.json",
    "preferencesFile": "config/preferences.linkedin.json",
    "preferencesVersion": 1
  },
  "summary": {
    "canonicalCount": 100,
    "selectedCount": 28,
    "annotationCount": 20,
    "rejectedCount": 16,
    "selectedFalsePositiveCount": 14
  },
  "proposedRule": {
    "id": "manual_reject_patterns",
    "description": "Terms inferred from manually rejected selected jobs. Apply only after review.",
    "fields": ["title.raw", "description.text", "company.industry"],
    "terms": ["marketing", "sales", "chemistry synthesis"]
  },
  "evidence": [
    {
      "term": "marketing",
      "supportingRejectedJobIds": ["linkedin:123", "linkedin:456"],
      "rejectedMatches": 2,
      "acceptedOrMaybeMatches": 0,
      "selectedMatches": 2,
      "reason": "Appears in rejected selected jobs and does not appear in accepted/maybe selected jobs."
    }
  ],
  "warnings": []
}
```

The proposal must include enough evidence for human review. A proposal with no safe candidate terms is valid and should explain why no update is recommended.

## Preference Update Target

The apply step should prefer an exclude rule with this stable ID:

```json
{
  "id": "manual_reject_patterns",
  "description": "Terms inferred from manually rejected selected jobs. Apply only after review.",
  "fields": ["title.raw", "description.text", "company.industry"],
  "terms": []
}
```

If `manual_reject_patterns` already exists, append new unique terms in stable sorted order.

If it does not exist, convert the current placeholder rule when:

```text
rules.exclude[0].id == "not_obvious_exclusion_yet"
AND rules.exclude[0].terms is empty
```

Otherwise, append a new rule to `rules.exclude`.

The first implementation should not remove existing exclude terms. Removal is a separate preference-maintenance feature.

## Candidate Term Strategy

The first implementation should be conservative and deterministic.

Candidate sources:

- annotation tags
- annotation notes
- `title.raw`
- `description.text`
- `company.industry`
- optionally `employment.jobFunction`

Candidate normalization:

- trim whitespace
- lowercase ASCII terms when possible
- collapse repeated spaces
- ignore terms shorter than 3 characters, except known technical tokens such as `AI`, `ML`, `NLP`, and `LLM`
- dedupe by normalized value

Candidate filtering:

- candidate appears in at least two rejected selected jobs, or appears once when it comes from an explicit tag/note
- candidate does not appear in accepted selected jobs
- candidate does not appear in maybe selected jobs unless the proposal emits a warning instead of including it by default
- candidate is not already present in any existing exclude rule
- candidate is not part of the positive thesis/AI must-rule intent unless it is clearly a negative context from notes/tags

The command should avoid overfitting. For example, a single rejected company name should not become an exclude term unless the user explicitly wrote that company or industry as a negative note/tag.

## Matching Semantics

Proposal validation should reuse the same matching behavior as `scripts/select-jobs.mjs` where possible:

- read fields using dot paths
- join field text
- match terms case-insensitively
- preserve the short-token boundary behavior used by current selector logic

If the implementation needs helper exports from `scripts/select-jobs.mjs`, refactor shared pure functions into `scripts/lib/preferences.mjs` rather than duplicating matching behavior.

## CLI Contract

### Proposal Mode

Command:

```powershell
npm run preferences:update-rejects -- 2026-05-07
```

Behavior:

- load the date-scoped inputs
- identify rejected selected jobs
- generate candidate terms and evidence
- simulate the proposed exclude rule against current selected jobs
- write proposal JSON
- print the proposal path and summary
- do not mutate preferences
- do not rerun Apify

Example output:

```text
Reject preference proposal written: data/preference-proposals/rejects-2026-05-07.json
Selected false positives analyzed: 14
Recommended exclude terms: 3
Would remove selected jobs: 5
Accepted/maybe conflicts: 0
Apply with:
npm run preferences:update-rejects -- 2026-05-07 --apply data/preference-proposals/rejects-2026-05-07.json
```

### Apply Mode

Command:

```powershell
npm run preferences:update-rejects -- 2026-05-07 --apply data/preference-proposals/rejects-2026-05-07.json
```

Behavior:

- validate proposal schema and date
- validate the proposal was generated from the same preference version
- refuse to apply if accepted/maybe conflicts exist
- update `config/preferences.linkedin.json`
- rerun:

```powershell
node scripts/select-jobs.mjs data/canonical/2026-05-07.json data/selected/2026-05-07.json config/preferences.linkedin.json
```

- print before/after selection counts

Apply mode is the explicit confirmation boundary. The command itself is confirmation; no interactive prompt is required for npm/script usage.

## API And UI Scope

The first version should be CLI-only.

Do not add automatic update behavior to Review or Dashboard reject buttons.

A later UI can add a `Analyze rejects` button that calls an API endpoint, but it must preserve the same two-step contract:

```text
Analyze rejects -> proposal preview -> explicit Apply
```

## Implementation Plan

1. Add `scripts/update-reject-preferences.mjs`.
2. Add npm script:

   ```json
   "preferences:update-rejects": "node scripts/update-reject-preferences.mjs"
   ```

3. Add `data/preference-proposals/` to `.gitignore`.
4. Extract preference field access and term matching from `scripts/select-jobs.mjs` into `scripts/lib/preferences.mjs`, or export them if that remains clean.
5. Implement proposal mode.
6. Implement apply mode.
7. Add tests under `scripts/lib/tests/` covering proposal generation, conflict detection, and apply behavior.
8. Update README with the new command and confirmation boundary.

## Test Plan

Unit tests:

- rejects only: `decision: "reject"` annotations are analyzed
- false positives only: rejected jobs outside selected output are not primary evidence
- accepted conflict: a candidate that also matches accepted jobs is excluded from proposed terms or emits a blocking warning
- maybe conflict: a candidate that matches maybe jobs emits a warning
- existing term: duplicate terms are not proposed again
- placeholder conversion: empty `not_obvious_exclusion_yet` becomes `manual_reject_patterns`
- append behavior: existing `manual_reject_patterns` keeps old terms and adds unique new terms
- apply writes formatted JSON and reruns selection through `selectJobsFile`

Manual verification:

```powershell
npm run preferences:update-rejects -- 2026-05-07
Get-Content data\preference-proposals\rejects-2026-05-07.json
npm run preferences:update-rejects -- 2026-05-07 --apply data/preference-proposals/rejects-2026-05-07.json
npm test
```

## Non-Goals

- Do not trigger Apify.
- Do not mutate `data/raw/` or `data/canonical/`.
- Do not infer market-fit strategy from employer responses.
- Do not automatically rewrite preferences from every reject click.
- Do not use an LLM as the only source of candidate terms for the first implementation.
- Do not remove old preference terms automatically.

## Open Questions

- Should proposal mode support multiple dates, for example `--since 2026-05-01`, once daily evidence is too sparse?
- Should explicit tags such as `not_ai`, `not_thesis`, `too_sales`, or `bad_industry:<term>` get first-class handling?
- Should the proposal artifact include a JSON Patch in addition to the normalized `proposedRule`?
- Should `preferences.version` increment on apply, or remain a schema version while proposal validation uses a content hash?

