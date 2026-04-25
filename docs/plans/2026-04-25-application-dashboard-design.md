# Application Dashboard Design

## Goal

Extend the local job workflow from review-only into a full application tracking dashboard.

```text
raw/<date>.json
  -> selected/<date>.json + rejected set
  -> Review UI
  -> annotations/<date>.<source>.json
  -> data/accepted-jobs.json
  -> data/applications.json
  -> Dashboard
```

## Key Decisions

- The Review page should no longer show a standalone `Raw` tab. `Selected` plus `Rejected` already covers the whole raw batch.
- The Review page should dynamically default to the latest available batch.
- Accepted jobs from all batches should be centralized in a long-lived registry.
- Jobs accepted before should not reappear as new review candidates in later batches.
- The Dashboard UI should be English-only.
- Application tracking needs a timeline because many processes include two or more interview rounds.

## Data Model

Add long-lived project data files:

```text
data/accepted-jobs.json
data/applications.json
```

`data/accepted-jobs.json` stores deduplicated accepted jobs:

```json
{
  "version": 1,
  "items": [
    {
      "jobKey": "linkedin:4405313639",
      "source": "linkedin",
      "sourceJobId": "4405313639",
      "title": "Praktikum / Abschlussarbeit GenAI...",
      "companyName": "Volkswagen Group",
      "location": "Baunatal, Hesse, Germany",
      "link": "https://...",
      "applyUrl": "https://...",
      "firstSeenAt": "2026-04-25T00:00:00.000Z",
      "acceptedAt": "2026-04-25T00:00:00.000Z",
      "rawFile": "raw/2026-04-25.json",
      "annotationFile": "annotations/2026-04-25.linkedin.json"
    }
  ]
}
```

`data/applications.json` stores application status and timeline:

```json
{
  "version": 1,
  "items": [
    {
      "jobKey": "linkedin:4405313639",
      "currentStatus": "applied_waiting",
      "appliedAt": "2026-04-26",
      "nextActionAt": "2026-05-02",
      "ownerNote": "Prepare ML project examples",
      "events": [
        {
          "id": "evt_...",
          "type": "accepted",
          "date": "2026-04-25",
          "note": "Accepted from review UI"
        },
        {
          "id": "evt_...",
          "type": "applied",
          "date": "2026-04-26",
          "note": "Applied via company website"
        }
      ]
    }
  ]
}
```

## Deduplication

Use this stable key order:

1. `source + id`
2. canonicalized `link`
3. normalized `companyName + title + location`

Review filtering should classify jobs into:

- `duplicateAccepted`: already accepted before, hidden from the default review queue.
- `seenBefore`: appeared in an earlier raw batch but was not accepted; show a badge and keep reviewable.
- `new`: no prior appearance.

For the first version, default Review views should show:

- `Selected`: selected jobs excluding `duplicateAccepted`.
- `Rejected`: raw jobs not selected, excluding `duplicateAccepted`.

## Review UI

Top navigation:

```text
Review | Dashboard
```

Review page:

- Defaults to latest available date.
- Allows switching batch date.
- Shows only `Selected` and `Rejected`.
- Displays badges such as `Seen before` and `Accepted before`.
- `accept` writes annotation and upserts `data/accepted-jobs.json`.
- `accept` also creates or updates an application record with status `accepted`.
- `reject` and `maybe` write annotations only.

## Dashboard UI

The Dashboard should be a focused work surface, not a landing page.

Layout:

- Compact top bar with counts and search.
- Status filter tabs or columns.
- Dense job list on the left.
- Detail panel or expanded card on the right/within the list.
- Timeline visible for the selected job.

Statuses:

```text
Accepted
Applied, waiting for response
Interview scheduled, preparing
Interview completed, waiting for result
Employer agreed, waiting for contract
Closed / rejected / withdrawn
```

Actions:

- `Mark Applied`
- `Schedule Interview`
- `Mark Interview Completed`
- `Mark Employer Agreed`
- `Close`
- `Add Note`

Timeline event types:

```text
accepted
applied
interview_scheduled
interview_completed
employer_agreed
contract_signed
rejected
withdrawn
note
```

## Frontend Design Direction

Use an English, utilitarian dashboard style:

- Dense but readable cards.
- Clear status tabs.
- Compact buttons with stable sizes.
- No marketing hero section.
- No nested cards.
- No decorative gradients/orbs.
- Text must fit within controls at desktop and mobile widths.
- The Dashboard should optimize repeated use: scan, filter, update status, add note.

## Error Handling

- If `data/accepted-jobs.json` or `data/applications.json` is missing, create it lazily on first write.
- If a data file is malformed, back it up with `.bak.<timestamp>` before recreating.
- If latest batch cannot be found, show a clear empty state.
- Never mutate `raw/*.json`.

## Verification

- Latest batch endpoint chooses `2026-04-25` from existing files.
- Review page has `Selected` and `Rejected`, no `Raw`.
- Accepting a job creates annotation, accepted registry entry, and application entry.
- Accepted jobs do not reappear in later default review queues.
- Dashboard displays accepted jobs from all batches.
- Application status actions append timeline events and update current status.
