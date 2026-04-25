# Canonical Daily Merge Design

## Goal

Add an adapt layer after raw data collection so all job sources can be converted into one canonical data model.

Each day should have one merged canonical file. Review UI users should not need to know how many Apify Tasks, sources, or raw runs produced that day's data.

## Pipeline

```text
Apify Task per source
  -> data/raw/<source>-<yyyy-mm-dd>-<hhmmss>.json
  -> manual incremental adapt + merge
  -> data/canonical/<yyyy-mm-dd>.json
  -> selection
  -> Review UI by date
  -> annotations by canonical job id
```

Raw files remain append-only source exports. The daily canonical file becomes the stable input for selection and review.

## Raw File Naming

Use local date/time in the filename because review is day-based in the user's local workflow.

```text
data/raw/linkedin-2026-04-25-114233.json
data/raw/stepstone-2026-04-25-121045.json
```

Parsing rule:

- `source`: segment before the first `-`.
- `date`: next three date segments joined as `yyyy-mm-dd`.
- `time`: remaining time segment, preferably `hhmmss`.

Internal metadata such as `importedAt` and `updatedAt` should still use ISO timestamps.

## Daily Canonical File

```ts
type CanonicalDailyFile = {
  schemaVersion: 1;
  date: string;
  updatedAt: string;
  mergeState: {
    lastRawFileTime?: string;
    processedRawFiles: string[];
  };
  sources: Array<{
    source: string;
    rawFile: string;
    rawFileTime: string;
    importedAt: string;
    rawCount: number;
    addedCount: number;
    duplicateCount: number;
  }>;
  items: CanonicalJob[];
};
```

`mergeState` is the per-day watermark. Merge scans `data/raw/`, selects files whose source/date can be parsed and whose date matches the target date, then only processes files newer than the stored raw file time. `processedRawFiles` keeps the operation idempotent when file times collide or a file is accidentally considered twice.

## Canonical Job Model

```ts
type CanonicalJob = {
  schemaVersion: 1;
  identity: {
    jobId: string;
    dedupeKey: string;
    source: string;
    sourceJobId?: string;
    sourceJobUrl?: string;
    sourceRunId?: string;
    sourceDatasetId?: string;
    sourceInputUrl?: string;
    rawFile: string;
  };
  title: {
    raw: string;
    normalized?: string;
  };
  company: {
    name: string;
    profileUrl?: string;
    logoUrl?: string;
    industry?: string;
  };
  location: {
    raw: string;
    city?: string;
    state?: string;
    country?: string;
    workplaceType: "remote" | "hybrid" | "on_site" | "unknown";
  };
  description: {
    text: string;
    html?: string;
    language?: string;
  };
  application: {
    jobUrl?: string;
    applyUrl?: string;
    applyMethod?: string;
    contactEmail?: string;
    contactTel?: string;
  };
  employment: {
    seniorityLevel?: string;
    employmentType?: string;
    jobFunction?: string;
    salaryText?: string;
    benefits?: string[];
  };
  timing: {
    postedAt?: string;
    expiresAt?: string;
    collectedAt: string;
  };
  sightings: Array<{
    source: string;
    rawFile: string;
    sourceJobId?: string;
    jobUrl?: string;
    seenAt: string;
  }>;
};
```

Do not include source-specific raw item copies in canonical jobs. Keep `rawFile`, source IDs, and URLs for traceability back to raw data.

## Merge Behavior

Manual merge for a date:

```text
read data/canonical/<date>.json, or create an empty file model
scan data/raw/
parse source/date/time from raw filenames
select files for the target date that are newer than mergeState.lastRawFileTime
skip files already listed in mergeState.processedRawFiles
adapt each raw item into CanonicalJob
merge by dedupeKey
append new jobs
for existing jobs, preserve non-empty canonical fields and only fill missing fields
append sightings for each occurrence
update sources, updatedAt, and mergeState
write data/canonical/<date>.json
```

The merge must not modify annotation files. Existing review state remains valid because annotations are keyed by canonical `jobId`.

## Deduplication

Use strong deduplication in the first implementation:

1. Same source and same source job ID.
2. Same normalized job URL.

Do not automatically merge by title, company, and location across channels in the first version. Similar thesis or internship roles can be distinct postings, and false merges would hide real opportunities. Weak cross-source matching can later be reported as `potentialDuplicates` for manual confirmation.

## Review UI Contract

Review UI should load by date:

```text
data/canonical/<date>.json
data/selected/<date>.json
data/annotations/<date>.json
```

When a later raw run is merged into the same daily canonical file:

- Previously annotated jobs keep their labels because `jobId` is stable.
- Unreviewed jobs remain in the queue.
- Newly merged jobs appear as unreviewed.
- Users do not need to select source or raw batch.

## LinkedIn Mapping Notes

Initial LinkedIn field mapping:

- `id` -> `identity.sourceJobId`
- `link` -> `application.jobUrl`, `identity.sourceJobUrl`
- `title` -> `title.raw`
- `standardizedTitle` -> `title.normalized`
- `companyName` -> `company.name`
- `companyLinkedinUrl` -> `company.profileUrl`
- `companyLogo` -> `company.logoUrl`
- `industries` -> `company.industry`
- `location` -> `location.raw`, parsed into city/state/country when possible
- `country` -> `location.country`
- `workplaceTypes` -> `location.workplaceType` when clear
- `workRemoteAllowed` -> fallback inference only; do not store separately
- `descriptionText` -> `description.text`
- `descriptionHtml` -> `description.html`
- `applyUrl` -> `application.applyUrl`
- `applyMethod` -> `application.applyMethod`
- `seniorityLevel`, `employmentType`, `jobFunction`, `salary`, `benefits` -> `employment`
- `postedAt` -> `timing.postedAt`
- `expireAt` -> `timing.expiresAt`
- raw file save/import time -> `timing.collectedAt`

If LinkedIn has empty `workplaceTypes` and `workRemoteAllowed` is false, map workplace type to `unknown`, not `on_site`.
